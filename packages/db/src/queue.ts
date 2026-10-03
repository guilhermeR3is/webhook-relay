import type { Db } from "./client.js";

export type ReservedDelivery = {
  id: string;
  eventId: string;
  destinationId: string;
  attemptCount: number;
};

type ReserveOptions = { limit: number; leaseSeconds: number };

type RescheduleOptions = { error: string; retryInSeconds: number };

// sem SKIP LOCKED, workers simultâneos reservam em dobro (sem trava) ou dão deadlock (só FOR UPDATE)
export function reserveDeliveries(
  db: Db,
  { limit, leaseSeconds }: ReserveOptions,
): Promise<ReservedDelivery[]> {
  return db.$queryRaw<ReservedDelivery[]>`
    UPDATE delivery
    SET status = 'in_progress',
        attempt_count = attempt_count + 1,
        locked_until = now() + make_interval(secs => ${leaseSeconds}::double precision)
    WHERE id IN (
      SELECT id FROM delivery
      WHERE (status = 'pending' AND next_attempt_at <= now())
         OR (status = 'in_progress' AND locked_until < now())
      ORDER BY next_attempt_at
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id,
              event_id AS "eventId",
              destination_id AS "destinationId",
              attempt_count AS "attemptCount"`;
}

// attempt_count na condição impede que um worker lento, com a posse expirada, sobrescreva a reserva nova
export async function completeDelivery(
  db: Db,
  { id, attemptCount }: ReservedDelivery,
): Promise<boolean> {
  const updatedRows = await db.$executeRaw`
    UPDATE delivery
    SET status = 'succeeded', succeeded_at = now(), locked_until = NULL, last_error = NULL
    WHERE id = ${id}::uuid AND status = 'in_progress' AND attempt_count = ${attemptCount}::int`;
  return updatedRows === 1;
}

export async function rescheduleDelivery(
  db: Db,
  { id, attemptCount }: ReservedDelivery,
  { error, retryInSeconds }: RescheduleOptions,
): Promise<boolean> {
  const updatedRows = await db.$executeRaw`
    UPDATE delivery
    SET status = 'pending',
        locked_until = NULL,
        last_error = ${error},
        next_attempt_at = now() + make_interval(secs => ${retryInSeconds}::double precision)
    WHERE id = ${id}::uuid AND status = 'in_progress' AND attempt_count = ${attemptCount}::int`;
  return updatedRows === 1;
}
