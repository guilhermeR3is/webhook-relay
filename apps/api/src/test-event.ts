import { randomUUID } from "node:crypto";
import { consumeDemoQuota, ingestEvent, type Db, type DemoQuotaLimits } from "@relay/db";
import type { FastifyPluginCallback } from "fastify";
import { visitorKey } from "./visitor-key.js";

export const DEMO_QUOTA_LIMITS: DemoQuotaLimits = { ip: 5, global: 200 };

type TestEventOptions = {
  db: Db;
  demoEndpointSlug: string;
  quotaSalt: string;
  panelOrigin: string;
  limits: DemoQuotaLimits;
};

export const testEventRoutes: FastifyPluginCallback<TestEventOptions> = (
  app,
  { db, demoEndpointSlug, quotaSalt, panelOrigin, limits },
  done,
) => {
  // o painel chama esta rota do navegador (a API enxerga o IP do visitante); sem isso ele não leria a resposta
  app.addHook("onRequest", (_request, reply, hookDone) => {
    void reply
      .header("access-control-allow-origin", panelOrigin)
      .header("vary", "origin")
      .header("cache-control", "no-store");
    hookDone();
  });

  app.post("/panel/test-event", async (request, reply) => {
    const endpoint = await db.endpoint.findUnique({
      where: { slug: demoEndpointSlug },
      select: { id: true },
    });
    if (!endpoint) return reply.code(404).send({ error: "demo_endpoint_not_found" });

    const quota = await consumeDemoQuota(db, {
      ipKey: visitorKey(request.ip, quotaSalt),
      limits,
    });
    if (!quota.allowed) {
      const waitSeconds = Math.max(1, Math.ceil((quota.retryAt.getTime() - Date.now()) / 1000));
      return reply.code(429).header("retry-after", String(waitSeconds)).send({
        error: "quota_exceeded",
        scope: quota.scope,
        limit: limits[quota.scope],
        retryAt: quota.retryAt,
      });
    }

    const event = await ingestEvent(db, {
      endpointId: endpoint.id,
      idempotencyKey: `demo-test-${randomUUID()}`,
      eventType: "demo.test",
      headers: {},
      body: Buffer.from(JSON.stringify({ demo: true, sentAt: new Date().toISOString() })),
    });
    return reply
      .code(201)
      .send({ eventId: event.id, quota: { ip: quota.ip, global: quota.global } });
  });

  done();
};
