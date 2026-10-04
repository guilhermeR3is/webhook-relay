import { setTimeout as sleep } from "node:timers/promises";
import {
  admitSend,
  buryDelivery,
  completeDelivery,
  recordAlive,
  recordFailure,
  releaseDelivery,
  rescheduleDelivery,
  reserveDeliveries,
  type AttemptRecord,
  type Db,
  type ReservedDelivery,
} from "@relay/db";
import type { FastifyBaseLogger } from "fastify";
import { statusClass, type DeliveryMetrics } from "./metrics.js";
import type { PostResult } from "./post-webhook.js";
import { decideDelivery, type CircuitSignal, type DeliveryDecision } from "./retry-policy.js";

export type SendDelivery = (delivery: ReservedDelivery) => Promise<PostResult>;

type DeliveryLoopOptions = {
  db: Db;
  send: SendDelivery;
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  pollIntervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  metrics: DeliveryMetrics;
  random?: () => number;
};

export function startDeliveryLoop(options: DeliveryLoopOptions) {
  const stopRequest = new AbortController();
  const finished = runLoop(options, stopRequest.signal);

  return {
    async stop() {
      stopRequest.abort();
      await finished;
    },
  };
}

async function runLoop(options: DeliveryLoopOptions, stopSignal: AbortSignal) {
  const { db, log, pollIntervalMs, batchSize, leaseSeconds } = options;

  while (!stopSignal.aborted) {
    let batch: ReservedDelivery[] = [];
    try {
      batch = await reserveDeliveries(db, { limit: batchSize, leaseSeconds });
    } catch (error) {
      log.error({ err: error }, "failed to reserve deliveries");
    }

    if (batch.length === 0) {
      await pause(pollIntervalMs, stopSignal);
      continue;
    }
    // em paralelo: a posse de 60 s não cobre dez envios de até 10 s um depois do outro
    await Promise.all(batch.map((delivery) => processDelivery(options, delivery)));
  }
}

async function processDelivery(options: DeliveryLoopOptions, delivery: ReservedDelivery) {
  const { db, log, metrics } = options;
  try {
    const admission = await admitSend(db, delivery.destinationId);
    if (admission.kind === "wait") {
      await postpone(options, delivery, admission.retryInSeconds);
      return;
    }
    if (admission.kind === "probe") {
      log.info(
        { destinationId: delivery.destinationId },
        "sending the probe to a paused destination",
      );
    }

    const result = await sendSafely(options, delivery);
    metrics.sendDuration.observe(
      { status_class: statusClass(result.httpStatus) },
      result.durationMs / 1000,
    );
    const decision = decideDelivery({
      reply: result.reply,
      attempt: delivery.attemptCount,
      random: options.random,
    });
    await recordDecision(options, delivery, result, decision);
    await recordCircuit(options, delivery.destinationId, decision.circuitSignal);
  } catch (error) {
    metrics.deliveries.inc({ result: "error" });
    // sem registrar o resultado, a posse expira e outra tentativa acontece (pelo menos uma vez)
    log.error({ err: error, deliveryId: delivery.id }, "failed to process the delivery");
  }
}

async function postpone(
  { db, log, metrics }: DeliveryLoopOptions,
  delivery: ReservedDelivery,
  retryInSeconds: number,
) {
  const released = await releaseDelivery(db, delivery, { retryInSeconds });
  const fields = { deliveryId: delivery.id, destinationId: delivery.destinationId, retryInSeconds };
  if (released) {
    metrics.deliveries.inc({ result: "postponed" });
    log.info(fields, "destination is paused, delivery postponed");
  } else {
    metrics.deliveries.inc({ result: "lease_lost" });
    log.warn(fields, "lease lost before the delivery could be postponed");
  }
}

async function sendSafely({ send, log }: DeliveryLoopOptions, delivery: ReservedDelivery) {
  const startedAt = new Date();
  const startedClock = performance.now();
  try {
    return await send(delivery);
  } catch (error) {
    log.error({ err: error, deliveryId: delivery.id }, "send threw instead of returning a result");
    return {
      reply: {
        kind: "no-response",
        error: error instanceof Error ? error.message : String(error),
      },
      startedAt,
      durationMs: Math.round(performance.now() - startedClock),
    } satisfies PostResult;
  }
}

const RESULT_BY_ACTION = { succeed: "succeeded", retry: "retried", dead: "dead" } as const;

async function recordDecision(
  { db, log, metrics }: DeliveryLoopOptions,
  delivery: ReservedDelivery,
  { startedAt, durationMs, httpStatus, responseSnippet }: PostResult,
  decision: DeliveryDecision,
) {
  const attempt: AttemptRecord = { startedAt, durationMs, httpStatus, responseSnippet };
  const recorded = await applyDecision(db, delivery, attempt, decision);
  const fields = {
    deliveryId: delivery.id,
    attempt: delivery.attemptCount,
    action: decision.action,
    httpStatus,
  };
  metrics.deliveries.inc({ result: recorded ? RESULT_BY_ACTION[decision.action] : "lease_lost" });
  if (!recorded) {
    log.warn(fields, "lease lost before the result was recorded");
  } else if (decision.action === "dead") {
    log.warn({ ...fields, reason: decision.reason }, "delivery moved to the dead queue");
  } else {
    log.info(fields, "delivery processed");
  }
}

function applyDecision(
  db: Db,
  delivery: ReservedDelivery,
  attempt: AttemptRecord,
  decision: DeliveryDecision,
) {
  switch (decision.action) {
    case "succeed":
      return completeDelivery(db, delivery, { attempt });
    case "retry":
      return rescheduleDelivery(db, delivery, {
        attempt,
        error: decision.reason,
        retryInSeconds: decision.delaySeconds,
      });
    case "dead":
      return buryDelivery(db, delivery, {
        attempt,
        error: decision.reason,
        deactivateDestination: decision.deactivateDestination,
      });
  }
}

async function recordCircuit(
  { db, log }: DeliveryLoopOptions,
  destinationId: string,
  signal: CircuitSignal,
) {
  if (signal === "alive") {
    await recordAlive(db, destinationId);
    return;
  }
  const circuitState = await recordFailure(db, destinationId);
  if (circuitState === "open") {
    log.warn({ destinationId }, "destination keeps failing, circuit is open");
  }
}

async function pause(milliseconds: number, stopSignal: AbortSignal) {
  try {
    await sleep(milliseconds, undefined, { signal: stopSignal });
  } catch (error) {
    if (!stopSignal.aborted) {
      throw error;
    }
  }
}
