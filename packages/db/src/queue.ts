import type { Db } from "./client.js";

export type ReservedDelivery = {
  id: string;
  eventId: string;
  destinationId: string;
  attemptCount: number;
};

export type AttemptRecord = {
  startedAt: Date;
  durationMs: number;
  httpStatus?: number;
  responseSnippet?: string;
};

type Transaction = Pick<Db, "attempt" | "$executeRaw">;

type ReserveOptions = { limit: number; leaseSeconds: number };

type CompleteOptions = { attempt: AttemptRecord };

type RescheduleOptions = { attempt: AttemptRecord; error: string; retryInSeconds: number };

type ReleaseOptions = { retryInSeconds: number };

type BuryOptions = { attempt: AttemptRecord; error: string; deactivateDestination: boolean };

const DESTINATION_DEACTIVATED = "destination deactivated after a 410 answer";

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
export function completeDelivery(
  db: Db,
  { id, attemptCount }: ReservedDelivery,
  { attempt }: CompleteOptions,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const updatedRows = await tx.$executeRaw`
      UPDATE delivery
      SET status = 'succeeded', succeeded_at = now(), locked_until = NULL, last_error = NULL
      WHERE id = ${id}::uuid AND status = 'in_progress' AND attempt_count = ${attemptCount}::int`;
    await recordAttempt(tx, id, attempt, null);
    return updatedRows === 1;
  });
}

export function rescheduleDelivery(
  db: Db,
  { id, attemptCount }: ReservedDelivery,
  { attempt, error, retryInSeconds }: RescheduleOptions,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const updatedRows = await tx.$executeRaw`
      UPDATE delivery
      SET status = 'pending',
          locked_until = NULL,
          last_error = ${error},
          next_attempt_at = now() + make_interval(secs => ${retryInSeconds}::double precision)
      WHERE id = ${id}::uuid AND status = 'in_progress' AND attempt_count = ${attemptCount}::int`;
    await recordAttempt(tx, id, attempt, error);
    return updatedRows === 1;
  });
}

// o destino não foi chamado, então a reserva não conta como tentativa
export async function releaseDelivery(
  db: Db,
  { id, attemptCount }: ReservedDelivery,
  { retryInSeconds }: ReleaseOptions,
): Promise<boolean> {
  const updatedRows = await db.$executeRaw`
    UPDATE delivery
    SET status = 'pending',
        attempt_count = attempt_count - 1,
        locked_until = NULL,
        next_attempt_at = now() + make_interval(secs => ${retryInSeconds}::double precision)
    WHERE id = ${id}::uuid AND status = 'in_progress' AND attempt_count = ${attemptCount}::int`;
  return updatedRows === 1;
}

export function buryDelivery(
  db: Db,
  { id, attemptCount, destinationId }: ReservedDelivery,
  { attempt, error, deactivateDestination }: BuryOptions,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const updatedRows = await tx.$executeRaw`
      UPDATE delivery
      SET status = 'dead', locked_until = NULL, last_error = ${error}
      WHERE id = ${id}::uuid AND status = 'in_progress' AND attempt_count = ${attemptCount}::int`;
    await recordAttempt(tx, id, attempt, error);
    const applied = updatedRows === 1;
    if (applied && deactivateDestination) {
      await tx.$executeRaw`UPDATE destination SET is_active = false WHERE id = ${destinationId}::uuid`;
      await tx.$executeRaw`
        UPDATE delivery
        SET status = 'dead', locked_until = NULL, last_error = ${DESTINATION_DEACTIVATED}
        WHERE destination_id = ${destinationId}::uuid AND status = 'pending'`;
    }
    return applied;
  });
}

// o envio aconteceu de verdade, então a tentativa é gravada mesmo que a posse tenha sido perdida
function recordAttempt(
  tx: Transaction,
  deliveryId: string,
  attempt: AttemptRecord,
  error: string | null,
) {
  return tx.attempt.create({ data: { deliveryId, ...attempt, error } });
}
