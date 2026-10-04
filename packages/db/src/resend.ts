import type { Db } from "./client.js";

export type ResendSkipReason = "not_found" | "not_dead" | "destination_inactive";

export type ResendResult = {
  resent: string[];
  skipped: { id: string; reason: ResendSkipReason }[];
};

type ResentRow = { id: string; attempts_before: number };
type SkippedRow = { id: string; status: string };

export async function resendDeliveries(
  db: Db,
  { endpointId, deliveryIds }: { endpointId: string; deliveryIds: string[] },
): Promise<ResendResult> {
  const ids = [...new Set(deliveryIds)];
  if (ids.length === 0) return { resent: [], skipped: [] };

  return db.$transaction(async (tx) => {
    // o status 'dead' no WHERE faz um segundo reenvio simultâneo da mesma entrega não achar nada
    const resentRows = await tx.$queryRaw<ResentRow[]>`
      UPDATE delivery d
      SET status = 'pending', attempt_count = 0, next_attempt_at = now()
      FROM event e, destination dest
      WHERE d.id = ANY(${ids}::uuid[])
        AND d.status = 'dead'
        AND e.id = d.event_id AND e.endpoint_id = ${endpointId}::uuid
        AND dest.id = d.destination_id AND dest.is_active
      RETURNING d.id, (SELECT count(*) FROM attempt a WHERE a.delivery_id = d.id)::int AS attempts_before`;

    // quantas tentativas já existiam, e não o horário: o relógio do worker e o do banco podem divergir
    await tx.resend.createMany({
      data: resentRows.map((row) => ({ deliveryId: row.id, attemptsBefore: row.attempts_before })),
    });

    const resent = new Set(resentRows.map((row) => row.id));
    const leftOver = ids.filter((id) => !resent.has(id));
    const found = await tx.$queryRaw<SkippedRow[]>`
      SELECT d.id, d.status
      FROM delivery d
      JOIN event e ON e.id = d.event_id
      WHERE d.id = ANY(${leftOver}::uuid[]) AND e.endpoint_id = ${endpointId}::uuid`;
    const statusById = new Map(found.map((row) => [row.id, row.status]));

    return {
      resent: ids.filter((id) => resent.has(id)),
      skipped: leftOver.map((id) => {
        const status = statusById.get(id);
        if (status === undefined) return { id, reason: "not_found" };
        // entrega morta que sobrou só pode ter o destino desativado
        return { id, reason: status === "dead" ? "destination_inactive" : "not_dead" };
      }),
    };
  });
}
