import type { Db } from "@relay/db";
import type { FastifyBaseLogger } from "fastify";
import { buildApp } from "./app.js";
import type { Env } from "./env.js";

export async function startApi(
  env: Env,
  db: Db,
  version: string,
): Promise<{ stop: () => Promise<void>; log: FastifyBaseLogger }> {
  const app = buildApp({
    db,
    encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64"),
    demoEndpointSlug: env.DEMO_ENDPOINT_SLUG,
    demoQuotaSalt: env.DEMO_QUOTA_SALT,
    panelOrigin: env.PANEL_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    exposeMetrics: env.METRICS_ENABLED,
    version,
    commit: env.GIT_COMMIT,
    logLevel: env.LOG_LEVEL,
  });

  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });

  return { stop: () => app.close(), log: app.log };
}
