import type { Db } from "./client.js";
import type { DeliveryStatus } from "./generated/enums.js";
import { assertPageLimit } from "./pagination.js";

export type EventCursor = { receivedAt: Date; id: string };

export type EventSummary = {
  id: string;
  eventType: string;
  idempotencyKey: string;
  receivedAt: Date;
  deliveries: Record<DeliveryStatus, number>;
};

export type EventPage = { events: EventSummary[]; next: EventCursor | null };

type EventListOptions = {
  endpointId: string;
  status?: DeliveryStatus;
  search?: string;
  after?: EventCursor;
  limit: number;
};

type EventSummaryRow = {
  id: string;
  event_type: string;
  idempotency_key: string;
  received_at: Date;
  pending: number;
  in_progress: number;
  succeeded: number;
  dead: number;
};

export async function listEvents(
  db: Db,
  { endpointId, status, search, after, limit }: EventListOptions,
): Promise<EventPage> {
  assertPageLimit(limit);
  const term = search !== undefined && search !== "" ? search : null;

  // strpos em vez de ILIKE: o % e o _ digitados na busca valem como texto comum
  const rows = await db.$queryRaw<EventSummaryRow[]>`
    SELECT e.id, e.event_type, e.idempotency_key, e.received_at,
           c.pending, c.in_progress, c.succeeded, c.dead
    FROM (
      SELECT id, event_type, idempotency_key, received_at
      FROM event
      WHERE endpoint_id = ${endpointId}::uuid
        AND (${status ?? null}::delivery_status IS NULL OR EXISTS (
          SELECT 1 FROM delivery f
          WHERE f.event_id = event.id AND f.status = ${status ?? null}::delivery_status))
        AND (${term}::text IS NULL
          OR strpos(lower(event_type), lower(${term}::text)) > 0
          OR strpos(lower(idempotency_key), lower(${term}::text)) > 0
          OR strpos(id::text, lower(${term}::text)) > 0)
        AND (${after?.receivedAt ?? null}::timestamptz IS NULL
          OR (received_at, id) < (${after?.receivedAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
      ORDER BY received_at DESC, id DESC
      LIMIT ${limit + 1}
    ) e
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE d.status = 'pending')::int AS pending,
             count(*) FILTER (WHERE d.status = 'in_progress')::int AS in_progress,
             count(*) FILTER (WHERE d.status = 'succeeded')::int AS succeeded,
             count(*) FILTER (WHERE d.status = 'dead')::int AS dead
      FROM delivery d WHERE d.event_id = e.id
    ) c
    ORDER BY e.received_at DESC, e.id DESC`;

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    events: page.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      idempotencyKey: row.idempotency_key,
      receivedAt: row.received_at,
      deliveries: {
        pending: row.pending,
        in_progress: row.in_progress,
        succeeded: row.succeeded,
        dead: row.dead,
      },
    })),
    next: rows.length > limit && last ? { receivedAt: last.received_at, id: last.id } : null,
  };
}

export function getEventDetail(
  db: Db,
  { endpointId, eventId }: { endpointId: string; eventId: string },
) {
  return db.event.findFirst({
    where: { id: eventId, endpointId },
    include: {
      deliveries: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          destination: { select: { id: true, url: true } },
          attempts: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
          resends: { orderBy: [{ requestedAt: "asc" }, { id: "asc" }] },
        },
      },
    },
  });
}

export type EventDetail = NonNullable<Awaited<ReturnType<typeof getEventDetail>>>;
