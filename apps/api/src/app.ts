import { checkDatabase, type Db, type DemoQuotaLimits } from "@relay/db";
import Fastify from "fastify";
import { flakyRoutes } from "./flaky.js";
import { ingestRoutes } from "./ingest.js";
import { panelRoutes } from "./panel.js";
import { DEMO_QUOTA_LIMITS, testEventRoutes } from "./test-event.js";

interface AppOptions {
  db: Db;
  encryptionKey: Buffer;
  demoEndpointSlug: string;
  demoQuotaSalt: string;
  panelOrigin: string;
  demoQuotaLimits?: DemoQuotaLimits;
  trustProxy?: string[] | false;
  version: string;
  commit: string;
  logLevel: string;
}

export function buildApp({
  db,
  encryptionKey,
  demoEndpointSlug,
  demoQuotaSalt,
  panelOrigin,
  demoQuotaLimits = DEMO_QUOTA_LIMITS,
  trustProxy = false,
  version,
  commit,
  logLevel,
}: AppOptions) {
  const app = Fastify({ logger: { level: logLevel }, trustProxy });

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
  void app.register(panelRoutes, { db, demoEndpointSlug });
  void app.register(flakyRoutes, {});
  void app.register(testEventRoutes, {
    db,
    demoEndpointSlug,
    quotaSalt: demoQuotaSalt,
    panelOrigin,
    limits: demoQuotaLimits,
  });

  return app;
}
