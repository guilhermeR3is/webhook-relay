import type { Db } from "./client.js";
import type { CircuitState } from "./generated/enums.js";

export const FAILURE_THRESHOLD = 5;
export const OPEN_SECONDS = 300;
export const PROBE_LEASE_SECONDS = 60;
// o envio dura no máximo 10 s: 5 s é uma espera curta sem perguntar toda hora
export const PROBE_RETRY_SECONDS = 5;

export type SendAdmission =
  { kind: "send" } | { kind: "probe" } | { kind: "wait"; retryInSeconds: number };

type Clock = { now?: Date };

type CircuitSnapshot = { circuitState: CircuitState; secondsUntilProbe: number | null };

export async function admitSend(
  db: Db,
  destinationId: string,
  { now }: Clock = {},
): Promise<SendAdmission> {
  const rows = await db.$queryRaw<CircuitSnapshot[]>`
    SELECT circuit_state::text AS "circuitState",
           extract(epoch FROM circuit_opened_at
                              + make_interval(secs => ${OPEN_SECONDS}::double precision)
                              - COALESCE(${now ?? null}::timestamptz, now()))::float8 AS "secondsUntilProbe"
    FROM destination WHERE id = ${destinationId}::uuid`;
  const circuit = rows[0];
  if (circuit === undefined) {
    throw new Error(`destination ${destinationId} not found`);
  }

  if (circuit.circuitState === "closed") {
    return { kind: "send" };
  }
  if (await claimProbe(db, destinationId, now)) {
    return { kind: "probe" };
  }
  const pauseLeft = circuit.secondsUntilProbe ?? 0;
  const stillPaused = circuit.circuitState === "open" && pauseLeft > 0;
  return { kind: "wait", retryInSeconds: stillPaused ? pauseLeft : PROBE_RETRY_SECONDS };
}

// com dois workers, o segundo reavalia o WHERE depois do primeiro e não encontra mais a linha elegível
async function claimProbe(db: Db, destinationId: string, now: Date | undefined) {
  const claimedRows = await db.$executeRaw`
    UPDATE destination
    SET circuit_state = 'half_open', circuit_opened_at = COALESCE(${now ?? null}::timestamptz, now())
    WHERE id = ${destinationId}::uuid
      AND ((circuit_state = 'open'
            AND circuit_opened_at <= COALESCE(${now ?? null}::timestamptz, now())
                                     - make_interval(secs => ${OPEN_SECONDS}::double precision))
        OR (circuit_state = 'half_open'
            AND circuit_opened_at <= COALESCE(${now ?? null}::timestamptz, now())
                                     - make_interval(secs => ${PROBE_LEASE_SECONDS}::double precision)))`;
  return claimedRows === 1;
}

// o CASE roda sobre a linha travada; uma leitura separada antes poderia estar velha
export async function recordFailure(
  db: Db,
  destinationId: string,
  { now }: Clock = {},
): Promise<CircuitState> {
  const rows = await db.$queryRaw<{ circuitState: CircuitState }[]>`
    UPDATE destination
    SET consecutive_failures = consecutive_failures + 1,
        circuit_state = CASE
          WHEN circuit_state = 'open'
            OR (circuit_state = 'closed' AND consecutive_failures + 1 < ${FAILURE_THRESHOLD}::int)
            THEN circuit_state
          ELSE 'open'::circuit_state
        END,
        circuit_opened_at = CASE
          WHEN circuit_state = 'open'
            OR (circuit_state = 'closed' AND consecutive_failures + 1 < ${FAILURE_THRESHOLD}::int)
            THEN circuit_opened_at
          ELSE COALESCE(${now ?? null}::timestamptz, now())
        END
    WHERE id = ${destinationId}::uuid
    RETURNING circuit_state::text AS "circuitState"`;
  const updated = rows[0];
  if (updated === undefined) {
    throw new Error(`destination ${destinationId} not found`);
  }
  return updated.circuitState;
}

export async function recordAlive(db: Db, destinationId: string): Promise<void> {
  await db.$executeRaw`
    UPDATE destination
    SET consecutive_failures = 0,
        circuit_state = CASE
          WHEN circuit_state = 'half_open' THEN 'closed'::circuit_state
          ELSE circuit_state
        END,
        circuit_opened_at = CASE WHEN circuit_state = 'half_open' THEN NULL ELSE circuit_opened_at END
    WHERE id = ${destinationId}::uuid`;
}
