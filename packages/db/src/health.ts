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
