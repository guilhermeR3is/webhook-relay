import { setTimeout as sleep } from "node:timers/promises";
import {
  completeDelivery,
  rescheduleDelivery,
  reserveDeliveries,
  type Db,
  type ReservedDelivery,
} from "@relay/db";
import type { FastifyBaseLogger } from "fastify";

export type DeliveryOutcome = { ok: true } | { ok: false; error: string };

export type SendDelivery = (delivery: ReservedDelivery) => Promise<DeliveryOutcome>;

type DeliveryLoopOptions = {
  db: Db;
  send: SendDelivery;
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  pollIntervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  retryInSeconds: number;
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

async function processDelivery(
  { db, send, log, retryInSeconds }: DeliveryLoopOptions,
  delivery: ReservedDelivery,
) {
  let outcome: DeliveryOutcome;
  try {
    outcome = await send(delivery);
  } catch (error) {
    log.error(
      { err: error, deliveryId: delivery.id },
      "send threw instead of returning an outcome",
    );
    outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const recorded = outcome.ok
      ? await completeDelivery(db, delivery)
      : await rescheduleDelivery(db, delivery, { error: outcome.error, retryInSeconds });
    if (recorded) {
      log.info(
        { deliveryId: delivery.id, attempt: delivery.attemptCount, ok: outcome.ok },
        "delivery processed",
      );
    } else {
      log.warn(
        { deliveryId: delivery.id, attempt: delivery.attemptCount },
        "lease lost before the result was recorded",
      );
    }
  } catch (error) {
    // sem registrar o resultado, a posse expira e outra tentativa acontece (pelo menos uma vez)
    log.error({ err: error, deliveryId: delivery.id }, "failed to record the delivery result");
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
