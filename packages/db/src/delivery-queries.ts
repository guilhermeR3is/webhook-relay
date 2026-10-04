import type { Db } from "./client.js";
import type { CircuitState, DeliveryStatus } from "./generated/enums.js";
import { assertPageLimit } from "./pagination.js";

export type DeadDeliveryCursor = { createdAt: Date; id: string };

export type DeadDelivery = {
  id: string;
  eventId: string;
  eventType: string;
  destinationId: string;
  destinationUrl: string;
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  lastAttempt: { startedAt: Date; durationMs: number; httpStatus: number | null } | null;
};

export type DeadDeliveryPage = { deliveries: DeadDelivery[]; next: DeadDeliveryCursor | null };

type DeadDeliveryOptions = {
  endpointId: string;
  after?: DeadDeliveryCursor;
  limit: number;
};

type DeadDeliveryRow = {
  id: string;
  event_id: string;
  event_type: string;
  destination_id: string;
  destination_url: string;
  attempt_count: number;
  last_error: string | null;
  created_at: Date;
  attempt_started_at: Date | null;
  attempt_duration_ms: number | null;
  attempt_http_status: number | null;
};

// a entrega não guarda quando morreu; a ordem é a de chegada do evento (created_at)
export async function listDeadDeliveries(
  db: Db,
  { endpointId, after, limit }: DeadDeliveryOptions,
): Promise<DeadDeliveryPage> {
  assertPageLimit(limit);

  const rows = await db.$queryRaw<DeadDeliveryRow[]>`
    SELECT d.id, d.event_id, e.event_type, d.destination_id, dest.url AS destination_url,
           d.attempt_count, d.last_error, d.created_at,
           a.started_at AS attempt_started_at, a.duration_ms AS attempt_duration_ms,
           a.http_status AS attempt_http_status
    FROM (
      SELECT d.id, d.event_id, d.destination_id, d.attempt_count, d.last_error, d.created_at
      FROM delivery d
      JOIN event ev ON ev.id = d.event_id
      WHERE ev.endpoint_id = ${endpointId}::uuid
        AND d.status = 'dead'
        AND (${after?.createdAt ?? null}::timestamptz IS NULL
          OR (d.created_at, d.id) < (${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ${limit + 1}
    ) d
    JOIN event e ON e.id = d.event_id
    JOIN destination dest ON dest.id = d.destination_id
    LEFT JOIN LATERAL (
      SELECT started_at, duration_ms, http_status
      FROM attempt WHERE delivery_id = d.id
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    ) a ON true
    ORDER BY d.created_at DESC, d.id DESC`;

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    deliveries: page.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventType: row.event_type,
      destinationId: row.destination_id,
      destinationUrl: row.destination_url,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      createdAt: row.created_at,
      lastAttempt:
        row.attempt_started_at && row.attempt_duration_ms !== null
          ? {
              startedAt: row.attempt_started_at,
              durationMs: row.attempt_duration_ms,
              httpStatus: row.attempt_http_status,
            }
          : null,
    })),
    next: rows.length > limit && last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

export type DestinationSummary = {
  id: string;
  url: string;
  isActive: boolean;
  eventTypes: string[];
  circuitState: CircuitState;
  consecutiveFailures: number;
  circuitOpenedAt: Date | null;
  deliveries: Record<DeliveryStatus, number>;
};

type DestinationRow = {
  id: string;
  url: string;
  is_active: boolean;
  event_types: string[];
  circuit_state: CircuitState;
  consecutive_failures: number;
  circuit_opened_at: Date | null;
  pending: number;
  in_progress: number;
  succeeded: number;
  dead: number;
};

export async function listDestinations(
  db: Db,
  { endpointId }: { endpointId: string },
): Promise<DestinationSummary[]> {
  const rows = await db.$queryRaw<DestinationRow[]>`
    SELECT dest.id, dest.url, dest.is_active, dest.event_types, dest.circuit_state,
           dest.consecutive_failures, dest.circuit_opened_at,
           c.pending, c.in_progress, c.succeeded, c.dead
    FROM destination dest
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE d.status = 'pending')::int AS pending,
             count(*) FILTER (WHERE d.status = 'in_progress')::int AS in_progress,
             count(*) FILTER (WHERE d.status = 'succeeded')::int AS succeeded,
             count(*) FILTER (WHERE d.status = 'dead')::int AS dead
      FROM delivery d WHERE d.destination_id = dest.id
    ) c
    WHERE dest.endpoint_id = ${endpointId}::uuid
    ORDER BY dest.created_at, dest.id`;

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    isActive: row.is_active,
    eventTypes: row.event_types,
    circuitState: row.circuit_state,
    consecutiveFailures: row.consecutive_failures,
    circuitOpenedAt: row.circuit_opened_at,
    deliveries: {
      pending: row.pending,
      in_progress: row.in_progress,
      succeeded: row.succeeded,
      dead: row.dead,
    },
  }));
}
