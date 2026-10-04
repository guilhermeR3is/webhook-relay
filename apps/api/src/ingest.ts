import { decryptSecret, ingestEvent, type Db } from "@relay/db";
import type { FastifyPluginCallback } from "fastify";
import { extractEventMetadata } from "./event-metadata.js";
import type { ApiMetrics } from "./metrics.js";
import { verifySignature } from "./signature.js";

const MAX_BODY_BYTES = 1024 * 1024;

type IngestOptions = {
  db: Db;
  encryptionKey: Buffer;
  metrics: Pick<ApiMetrics, "eventsReceived" | "ingestDuration">;
};

export const ingestRoutes: FastifyPluginCallback<IngestOptions> = (
  app,
  { db, encryptionKey, metrics },
  done,
) => {
  // a assinatura cobre os bytes exatos; o parser padrão de JSON os descartaria
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.addHook("onResponse", (_request, reply, done) => {
    metrics.ingestDuration.observe({ status_code: reply.statusCode }, reply.elapsedTime / 1000);
    done();
  });

  app.post<{ Params: { slug: string }; Body: Buffer | undefined }>(
    "/in/:slug",
    { bodyLimit: MAX_BODY_BYTES },
    async (request, reply) => {
      const { slug } = request.params;
      const endpoint = await db.endpoint.findUnique({ where: { slug } });
      if (endpoint === null) {
        metrics.eventsReceived.inc({ result: "unknown_endpoint" });
        return reply.code(404).send({ error: "endpoint_not_found" });
      }

      const rawBody = Buffer.from(request.body ?? []);
      const signatureCheck = verifySignature({
        scheme: endpoint.signatureScheme,
        secret:
          endpoint.secretEncrypted === null
            ? null
            : decryptSecret(endpoint.secretEncrypted, encryptionKey),
        rawBody,
        headers: request.headers,
      });
      if (!signatureCheck.ok) {
        metrics.eventsReceived.inc({ result: "invalid_signature" });
        request.log.warn({ slug, reason: signatureCheck.reason }, "signature rejected");
        return reply.code(401).send({ error: "invalid_signature" });
      }

      const { idempotencyKey, eventType, storedHeaders } = extractEventMetadata({
        scheme: endpoint.signatureScheme,
        headers: request.headers,
        rawBody,
      });
      const savedEvent = await ingestEvent(db, {
        endpointId: endpoint.id,
        idempotencyKey,
        eventType,
        headers: storedHeaders,
        body: rawBody,
      });

      metrics.eventsReceived.inc({ result: savedEvent.created ? "created" : "duplicate" });
      return reply.code(savedEvent.created ? 202 : 200).send({ id: savedEvent.id });
    },
  );

  done();
};
