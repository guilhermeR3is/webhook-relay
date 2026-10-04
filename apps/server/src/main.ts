import { readFileSync } from "node:fs";
import { startApi } from "@relay/api";
import { createDb, deleteExpiredDemoData } from "@relay/db";
import { startWorker } from "@relay/worker";
import { startDemoCleanup } from "./demo-cleanup.js";
import { loadServerEnv } from "./env.js";

const DEMO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const env = loadServerEnv();
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

// um pool para os dois, em vez de um por app, para abrir menos conexões no banco gratuito
const db = createDb(env.api.DATABASE_URL);
const api = await startApi(env.api, db, version);
const worker = await startWorker(env.worker, db, version);
const cleanup = startDemoCleanup({
  run: () =>
    deleteExpiredDemoData(db, {
      endpointSlug: env.api.DEMO_ENDPOINT_SLUG,
      olderThan: new Date(Date.now() - DEMO_RETENTION_MS),
    }),
  intervalMs: CLEANUP_INTERVAL_MS,
  log: api.log,
});

// Sem isso o container ignora o SIGTERM e leva SIGKILL depois do prazo, cortando requisições e envios em andamento
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void cleanup
      .stop()
      .then(() => api.stop())
      .then(() => worker.stop())
      .then(() => db.$disconnect());
  });
}
