import { readFileSync } from "node:fs";
import { createDb } from "@relay/db";
import { loadEnv } from "./env.js";
import { startApi } from "./start.js";

const env = loadEnv();
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const db = createDb(env.DATABASE_URL);
const api = await startApi(env, db, version);

// Sem isso o Docker espera 10 s e mata o processo com SIGKILL, cortando requisições em andamento
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void api.stop().then(() => db.$disconnect());
  });
}
