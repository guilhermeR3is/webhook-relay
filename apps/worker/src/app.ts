import { checkDatabase, checkQueue, type Queryable } from "@relay/db";
import Fastify from "fastify";

interface AppOptions {
  db: Queryable;
  version: string;
  commit: string;
  logLevel: string;
}

export function buildApp({ db, version, commit, logLevel }: AppOptions) {
  const app = Fastify({ logger: { level: logLevel } });

  app.get("/health", async (_request, reply) => {
    const [database, queue] = await Promise.all([checkDatabase(db), checkQueue(db)]);
    if (database.status === "error") {
      app.log.error({ err: database.error }, "database health check failed");
    }
    if (queue.status === "error") {
      app.log.error({ err: queue.error }, "queue health check failed");
    }

    const healthy = database.status === "ok" && queue.status === "ok";
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      version,
      commit,
      checks: { database: database.status, queue: queue.status },
      queueDepth: queue.status === "ok" ? queue.depth : null,
    });
  });

  return app;
}
