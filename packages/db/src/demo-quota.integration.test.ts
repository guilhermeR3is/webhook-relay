import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let db: Db;

const hourStart = new Date("2026-10-03T12:00:00.000Z");
const nextHourStart = new Date("2026-10-03T13:00:00.000Z");

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

describe("demo quota table", () => {
  it("starts a window at zero, even when inserted without Prisma", async () => {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO demo_quota (id, kind, key, window_start)
      VALUES (${randomUUID()}::uuid, 'ip', 'raw-insert', ${hourStart}::timestamptz)
      RETURNING count`;

    expect(rows).toEqual([{ count: 0 }]);
  });

  it("allows one row for each kind, key and window", async () => {
    await db.demoQuota.create({ data: { kind: "ip", key: "visitor-1", windowStart: hourStart } });

    await expect(
      db.demoQuota.create({ data: { kind: "ip", key: "visitor-1", windowStart: hourStart } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps a separate counter for the next window, for another key and for the other kind", async () => {
    await db.demoQuota.create({ data: { kind: "ip", key: "visitor-2", windowStart: hourStart } });

    await db.demoQuota.createMany({
      data: [
        { kind: "ip", key: "visitor-2", windowStart: nextHourStart },
        { kind: "ip", key: "visitor-3", windowStart: hourStart },
        { kind: "global", key: "visitor-2", windowStart: hourStart },
      ],
    });

    expect(await db.demoQuota.count({ where: { key: { in: ["visitor-2", "visitor-3"] } } })).toBe(
      4,
    );
  });

  it("refuses a kind outside ip and global", async () => {
    await expect(
      db.$executeRaw`
        INSERT INTO demo_quota (id, kind, key, window_start)
        VALUES (${randomUUID()}::uuid, 'user', 'x', ${hourStart}::timestamptz)`,
    ).rejects.toThrow(/demo_quota_kind/);
  });

  it("refuses a row without a window start", async () => {
    await expect(
      db.$executeRaw`
        INSERT INTO demo_quota (id, kind, key) VALUES (${randomUUID()}::uuid, 'ip', 'no-window')`,
    ).rejects.toThrow(/window_start/);
  });
});
