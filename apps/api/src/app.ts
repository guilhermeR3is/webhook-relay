import { checkDatabase, type Db } from "@relay/db";
import Fastify from "fastify";
import { ingestRoutes } from "./ingest.js";

interface AppOptions {
  db: Db;
  encryptionKey: Buffer;
  version: string;
  commit: string;
  logLevel: string;
}

export function buildApp({ db, encryptionKey, version, commit, logLevel }: AppOptions) {
  const app = Fastify({ logger: { level: logLevel } });

  app.get("/health", async (_request, reply) => {
    const database = await checkDatabase(db);
    if (database.status === "error") {
      app.log.error({ err: database.error }, "database health check failed");
    }

    const healthy = database.status === "ok";
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      version,
      commit,
      checks: { database: database.status },
    });
  });

  void app.register(ingestRoutes, { db, encryptionKey });

  return app;
}
