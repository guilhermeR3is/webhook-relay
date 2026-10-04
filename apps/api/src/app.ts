import { checkDatabase, type Db, type DemoQuotaLimits } from "@relay/db";
import Fastify from "fastify";
import { flakyRoutes } from "./flaky.js";
import { ingestRoutes } from "./ingest.js";
import { createApiMetrics } from "./metrics.js";
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
  exposeMetrics?: boolean;
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
  exposeMetrics = false,
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

  const metrics = createApiMetrics();
  if (exposeMetrics) {
    app.get("/metrics", async (_request, reply) =>
      reply
        .header("content-type", metrics.registry.contentType)
        .send(await metrics.registry.metrics()),
    );
  }

  void app.register(ingestRoutes, { db, encryptionKey, demoEndpointSlug, metrics });
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
