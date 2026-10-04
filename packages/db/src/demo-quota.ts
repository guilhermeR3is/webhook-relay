import type { Db } from "./client.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const GLOBAL_KEY = "all";

export type DemoQuotaLimits = { ip: number; global: number };

export type QuotaUse = { used: number; limit: number; resetsAt: Date };

export type DemoQuotaResult =
  | { allowed: true; ip: QuotaUse; global: QuotaUse }
  | { allowed: false; scope: "ip" | "global"; retryAt: Date };

type Queryable = Pick<Db, "$queryRaw">;

class QuotaExceeded extends Error {
  constructor(
    readonly scope: "ip" | "global",
    readonly retryAt: Date,
  ) {
    super(`demo quota exceeded (${scope})`);
  }
}

function assertLimit(name: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`${name} limit must be an integer >= 1, got ${String(limit)}`);
  }
}

async function readWindows(db: Queryable, now: Date | undefined) {
  const [windows] = await db.$queryRaw<{ hour: Date; day: Date }[]>`
    SELECT date_trunc('hour', t.at, 'UTC') AS hour, date_trunc('day', t.at, 'UTC') AS day
    FROM (SELECT COALESCE(${now ?? null}::timestamptz, now()) AS at) t`;
  if (!windows) throw new Error("the database returned no clock reading");
  return windows;
}

// o WHERE do DO UPDATE é reavaliado sobre a linha já bloqueada: dois pedidos juntos não passam do limite
async function takeOne(
  db: Queryable,
  kind: "ip" | "global",
  key: string,
  windowStart: Date,
  limit: number,
) {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO demo_quota (id, kind, key, window_start, count)
    VALUES (gen_random_uuid(), ${kind}::demo_quota_kind, ${key}, ${windowStart}::timestamptz, 1)
    ON CONFLICT (kind, key, window_start)
    DO UPDATE SET count = demo_quota.count + 1 WHERE demo_quota.count < ${limit}::int
    RETURNING count`;
  return rows[0]?.count ?? null;
}

export async function consumeDemoQuota(
  db: Db,
  { ipKey, limits, now }: { ipKey: string; limits: DemoQuotaLimits; now?: Date },
): Promise<DemoQuotaResult> {
  assertLimit("ip", limits.ip);
  assertLimit("global", limits.global);
  const { hour, day } = await readWindows(db, now);

  try {
    return await db.$transaction(
      async (tx) => {
        const ipCount = await takeOne(tx, "ip", ipKey, hour, limits.ip);
        if (ipCount === null) throw new QuotaExceeded("ip", new Date(hour.getTime() + HOUR_MS));

        const globalCount = await takeOne(tx, "global", GLOBAL_KEY, day, limits.global);
        if (globalCount === null)
          throw new QuotaExceeded("global", new Date(day.getTime() + DAY_MS));

        return {
          allowed: true as const,
          ip: { used: ipCount, limit: limits.ip, resetsAt: new Date(hour.getTime() + HOUR_MS) },
          global: {
            used: globalCount,
            limit: limits.global,
            resetsAt: new Date(day.getTime() + DAY_MS),
          },
        };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  } catch (error) {
    // lançar desfaz a transação: um pedido recusado não gasta a cota do outro contador
    if (error instanceof QuotaExceeded) {
      return { allowed: false, scope: error.scope, retryAt: error.retryAt };
    }
    throw error;
  }
}
