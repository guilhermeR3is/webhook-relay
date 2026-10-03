import { readFileSync } from "node:fs";
import { createDb } from "@relay/db";
import { buildApp } from "./app.js";
import { startDeliveryLoop } from "./delivery-loop.js";
import { loadEnv } from "./env.js";
import { createSendDelivery } from "./send-delivery.js";

const BATCH_SIZE = 10;
// maior que o timeout de envio, senão outro worker pegaria a entrega no meio da tentativa
const LEASE_SECONDS = 60;
const SEND_TIMEOUT_MS = 10_000;
// provisório: a fase 4 troca por backoff exponencial
const PROVISIONAL_RETRY_SECONDS = 10;

const env = loadEnv();
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const db = createDb(env.DATABASE_URL);
const app = buildApp({ db, version, commit: env.GIT_COMMIT, logLevel: env.LOG_LEVEL });

await app.listen({ port: env.WORKER_PORT, host: "0.0.0.0" });

const deliveryLoop = startDeliveryLoop({
  db,
  send: createSendDelivery(db, { timeoutMs: SEND_TIMEOUT_MS }),
  log: app.log,
  pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
  batchSize: BATCH_SIZE,
  leaseSeconds: LEASE_SECONDS,
  retryInSeconds: PROVISIONAL_RETRY_SECONDS,
});

// Sem isso o Docker espera 10 s e mata o processo com SIGKILL, cortando requisições e envios em andamento
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void deliveryLoop
      .stop()
      .then(() => app.close())
      .then(() => db.$disconnect());
  });
}
