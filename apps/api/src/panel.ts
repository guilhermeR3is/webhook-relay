import {
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_SECONDS,
  getEventDetail,
  listDeadDeliveries,
  listDestinations,
  listEvents,
  resendDeliveries,
  type Db,
  type DeliveryStatus,
} from "@relay/db";
import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import { groupAttemptSequences } from "./attempt-sequences.js";
import { previewBody } from "./body-preview.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { redactDestinationUrl } from "./destination-url.js";

type PanelOptions = {
  db: Db;
  demoEndpointSlug: string;
};

const deliveryStatuses = [
  "pending",
  "in_progress",
  "succeeded",
  "dead",
] as const satisfies readonly DeliveryStatus[];

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

const eventsQuery = pageQuery.extend({
  status: z.enum(deliveryStatuses).optional(),
  search: z.string().trim().max(100).optional(),
});

const eventParams = z.object({ eventId: z.uuid() });
const deliveryParams = z.object({ deliveryId: z.uuid() });
const resendBody = z.object({ deliveryIds: z.array(z.uuid()).min(1).max(100) });

const resendRefusals = {
  not_dead: "delivery_not_dead",
  destination_inactive: "destination_inactive",
} as const;

function invalidQuery(error: z.ZodError) {
  return { error: "invalid_query", fields: z.flattenError(error).fieldErrors };
}

export const panelRoutes: FastifyPluginCallback<PanelOptions> = (
  app,
  { db, demoEndpointSlug },
  done,
) => {
  // os dados mudam a cada retentativa; ninguém deve guardar a resposta
  app.addHook("onRequest", (_request, reply, hookDone) => {
    void reply.header("cache-control", "no-store");
    hookDone();
  });

  async function findDemoEndpointId() {
    const endpoint = await db.endpoint.findUnique({
      where: { slug: demoEndpointSlug },
      select: { id: true },
    });
    return endpoint?.id ?? null;
  }

  app.get("/panel/events", async (request, reply) => {
    const query = eventsQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send(invalidQuery(query.error));
    const after = query.data.cursor === undefined ? undefined : decodeCursor(query.data.cursor);
    if (after === null) return reply.code(400).send({ error: "invalid_cursor" });

    const endpointId = await findDemoEndpointId();
    if (endpointId === null) return reply.code(404).send({ error: "demo_endpoint_not_found" });

    const page = await listEvents(db, {
      endpointId,
      status: query.data.status,
      search: query.data.search,
      after: after && { receivedAt: after.at, id: after.id },
      limit: query.data.limit,
    });
    return {
      events: page.events,
      nextCursor: page.next && encodeCursor({ at: page.next.receivedAt, id: page.next.id }),
    };
  });

  app.get("/panel/events/:eventId", async (request, reply) => {
    const params = eventParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "event_not_found" });

    const endpointId = await findDemoEndpointId();
    if (endpointId === null) return reply.code(404).send({ error: "demo_endpoint_not_found" });

    const event = await getEventDetail(db, { endpointId, eventId: params.data.eventId });
    if (event === null) return reply.code(404).send({ error: "event_not_found" });

    return {
      id: event.id,
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
      receivedAt: event.receivedAt,
      headers: event.headers,
      body: previewBody(event.body),
      deliveries: event.deliveries.map((delivery) => ({
        id: delivery.id,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        nextAttemptAt: delivery.nextAttemptAt,
        lastError: delivery.lastError,
        succeededAt: delivery.succeededAt,
        createdAt: delivery.createdAt,
        destination: {
          id: delivery.destination.id,
          displayUrl: redactDestinationUrl(delivery.destination.url),
        },
        sequences: groupAttemptSequences(
          delivery.attempts.map((attempt) => ({
            id: attempt.id,
            startedAt: attempt.startedAt,
            durationMs: attempt.durationMs,
            httpStatus: attempt.httpStatus,
            responseSnippet: attempt.responseSnippet,
            error: attempt.error,
          })),
          delivery.resends,
        ),
      })),
    };
  });

  app.get("/panel/dead-deliveries", async (request, reply) => {
    const query = pageQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send(invalidQuery(query.error));
    const after = query.data.cursor === undefined ? undefined : decodeCursor(query.data.cursor);
    if (after === null) return reply.code(400).send({ error: "invalid_cursor" });

    const endpointId = await findDemoEndpointId();
    if (endpointId === null) return reply.code(404).send({ error: "demo_endpoint_not_found" });

    const page = await listDeadDeliveries(db, {
      endpointId,
      after: after && { createdAt: after.at, id: after.id },
      limit: query.data.limit,
    });
    return {
      deliveries: page.deliveries.map((delivery) => ({
        id: delivery.id,
        eventId: delivery.eventId,
        eventType: delivery.eventType,
        destination: {
          id: delivery.destinationId,
          displayUrl: redactDestinationUrl(delivery.destinationUrl),
        },
        attemptCount: delivery.attemptCount,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt,
        lastAttempt: delivery.lastAttempt,
      })),
      nextCursor: page.next && encodeCursor({ at: page.next.createdAt, id: page.next.id }),
    };
  });

  app.get("/panel/destinations", async (_request, reply) => {
    const endpointId = await findDemoEndpointId();
    if (endpointId === null) return reply.code(404).send({ error: "demo_endpoint_not_found" });

    const destinations = await listDestinations(db, { endpointId });
    return {
      failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
      destinations: destinations.map((destination) => ({
        id: destination.id,
        displayUrl: redactDestinationUrl(destination.url),
        isActive: destination.isActive,
        eventTypes: destination.eventTypes,
        circuit: {
          state: destination.circuitState,
          consecutiveFailures: destination.consecutiveFailures,
          since: destination.circuitOpenedAt,
          pausedUntil:
            destination.circuitState === "open" && destination.circuitOpenedAt
              ? new Date(destination.circuitOpenedAt.getTime() + CIRCUIT_OPEN_SECONDS * 1000)
              : null,
        },
        deliveries: destination.deliveries,
      })),
    };
  });

  app.post("/panel/deliveries/:deliveryId/resend", async (request, reply) => {
    const params = deliveryParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "delivery_not_found" });

    const endpointId = await findDemoEndpointId();
    if (endpointId === null) return reply.code(404).send({ error: "demo_endpoint_not_found" });

    const result = await resendDeliveries(db, {
      endpointId,
      deliveryIds: [params.data.deliveryId],
    });
    const refusal = result.skipped[0];
    if (refusal === undefined) return { resent: true };
    if (refusal.reason === "not_found")
      return reply.code(404).send({ error: "delivery_not_found" });
    return reply.code(409).send({ error: resendRefusals[refusal.reason] });
  });

  app.post("/panel/dead-deliveries/resend", async (request, reply) => {
    const body = resendBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", fields: z.flattenError(body.error).fieldErrors });
    }

    const endpointId = await findDemoEndpointId();
    if (endpointId === null) return reply.code(404).send({ error: "demo_endpoint_not_found" });

    return resendDeliveries(db, { endpointId, deliveryIds: body.data.deliveryIds });
  });

  done();
};
