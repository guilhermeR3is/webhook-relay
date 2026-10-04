import type { Db } from "@relay/db";
import { buildApp } from "./app.js";
import { startDeliveryLoop } from "./delivery-loop.js";
import type { Env } from "./env.js";
import { createWorkerMetrics } from "./metrics.js";
import { createSendDelivery } from "./send-delivery.js";

const BATCH_SIZE = 10;
// maior que o timeout de envio, senão outro worker pegaria a entrega no meio da tentativa
const LEASE_SECONDS = 60;
const SEND_TIMEOUT_MS = 10_000;

export async function startWorker(
  env: Env,
  db: Db,
  version: string,
): Promise<{ stop: () => Promise<void> }> {
  const metrics = createWorkerMetrics(db);
  const app = buildApp({
    db,
    metricsRegistry: env.METRICS_ENABLED ? metrics.registry : undefined,
    version,
    commit: env.GIT_COMMIT,
    logLevel: env.LOG_LEVEL,
  });

  await app.listen({ port: env.WORKER_PORT, host: "0.0.0.0" });

  if (env.ALLOW_PRIVATE_DESTINATIONS) {
    app.log.warn("private and loopback destinations are allowed; keep this for development only");
  }

  const deliveryLoop = startDeliveryLoop({
    db,
    send: createSendDelivery(db, {
      timeoutMs: SEND_TIMEOUT_MS,
      allowPrivateAddresses: env.ALLOW_PRIVATE_DESTINATIONS,
      encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64"),
    }),
    log: app.log,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    leaseSeconds: LEASE_SECONDS,
    metrics,
  });

  return {
    async stop() {
      await deliveryLoop.stop();
      await app.close();
    },
  };
}
