import { readFileSync } from "node:fs";
import { createDb } from "@relay/db";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const db = createDb(env.DATABASE_URL);
const app = buildApp({ db, version, commit: env.GIT_COMMIT, logLevel: env.LOG_LEVEL });

// Sem isso o Docker espera 10 s e mata o processo com SIGKILL, cortando requisições em andamento
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => db.$disconnect());
  });
}

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
