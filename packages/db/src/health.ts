export interface Queryable {
  $queryRaw: (query: TemplateStringsArray) => PromiseLike<unknown>;
}

export type DatabaseCheck = { status: "ok" } | { status: "error"; error: unknown };

export async function checkDatabase(db: Queryable): Promise<DatabaseCheck> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return { status: "error", error };
  }
}

export type QueueCheck = { status: "ok"; depth: number } | { status: "error"; error: unknown };

// mesma condição da reserva: pronta para enviar agora, ou abandonada com a posse vencida
export async function checkQueue(db: Queryable): Promise<QueueCheck> {
  try {
    const rows = (await db.$queryRaw`
      SELECT count(*)::int AS depth FROM delivery
      WHERE (status = 'pending' AND next_attempt_at <= now())
         OR (status = 'in_progress' AND locked_until < now())`) as { depth: number }[];
    return { status: "ok", depth: rows[0]?.depth ?? 0 };
  } catch (error) {
    return { status: "error", error };
  }
}
