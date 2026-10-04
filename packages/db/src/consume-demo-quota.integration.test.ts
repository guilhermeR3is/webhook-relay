import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./client.js";
import { consumeDemoQuota } from "./demo-quota.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let db: Db;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

const limits = { ip: 5, global: 200 };

// cada teste usa o seu dia: o contador global é um só e os testes não podem se atrapalhar
let dayNumber = 0;
function freshDay() {
  dayNumber += 1;
  return new Date(Date.UTC(2027, 0, dayNumber, 12, 30, 0));
}

const key = () => `visitor-${randomUUID()}`;

async function countOf(kind: "ip" | "global", rowKey: string) {
  const rows = await db.demoQuota.findMany({ where: { kind, key: rowKey } });
  return rows.reduce((total, row) => total + row.count, 0);
}

describe("consumeDemoQuota", () => {
  it("allows the first use and says how much is used and when each window ends", async () => {
    const now = freshDay();

    const result = await consumeDemoQuota(db, { ipKey: key(), limits, now });

    expect(result).toEqual({
      allowed: true,
      ip: { used: 1, limit: 5, resetsAt: new Date(Date.UTC(2027, 0, dayNumber, 13, 0, 0)) },
      global: {
        used: 1,
        limit: 200,
        resetsAt: new Date(Date.UTC(2027, 0, dayNumber + 1, 0, 0, 0)),
      },
    });
  });

  it("counts up for the same visitor and refuses the sixth use in the hour", async () => {
    const now = freshDay();
    const ipKey = key();

    for (let use = 1; use <= 5; use++) {
      const result = await consumeDemoQuota(db, { ipKey, limits, now });
      expect(result).toMatchObject({ allowed: true, ip: { used: use } });
    }
    const sixth = await consumeDemoQuota(db, { ipKey, limits, now });

    expect(sixth).toEqual({
      allowed: false,
      scope: "ip",
      retryAt: new Date(Date.UTC(2027, 0, dayNumber, 13, 0, 0)),
    });
    expect(await countOf("ip", ipKey)).toBe(5);
  });

  it("keeps a separate counter for each visitor, and one global counter for all", async () => {
    const now = freshDay();
    const first = key();
    for (let use = 1; use <= 5; use++) await consumeDemoQuota(db, { ipKey: first, limits, now });

    const other = await consumeDemoQuota(db, { ipKey: key(), limits, now });

    expect(other).toMatchObject({ allowed: true, ip: { used: 1 }, global: { used: 6 } });
  });

  it("does not spend the global counter when the visitor is refused", async () => {
    const now = freshDay();
    const ipKey = key();
    const oneEach = { ip: 1, global: 200 };
    await consumeDemoQuota(db, { ipKey, limits: oneEach, now });

    const refused = await consumeDemoQuota(db, { ipKey, limits: oneEach, now });

    expect(refused).toMatchObject({ allowed: false, scope: "ip" });
    const next = await consumeDemoQuota(db, { ipKey: key(), limits: oneEach, now });
    expect(next).toMatchObject({ allowed: true, global: { used: 2 } });
  });

  it("starts a new hour with a new visitor counter and keeps counting the day", async () => {
    const now = freshDay();
    const ipKey = key();
    for (let use = 1; use <= 5; use++) await consumeDemoQuota(db, { ipKey, limits, now });
    await expect(consumeDemoQuota(db, { ipKey, limits, now })).resolves.toMatchObject({
      allowed: false,
    });

    const exactlyNextHour = new Date(Date.UTC(2027, 0, dayNumber, 13, 0, 0, 0));
    const again = await consumeDemoQuota(db, { ipKey, limits, now: exactlyNextHour });

    expect(again).toMatchObject({ allowed: true, ip: { used: 1 }, global: { used: 6 } });
  });

  it("is still the old hour one millisecond before the next one", async () => {
    const now = freshDay();
    const ipKey = key();
    const oneUse = { ip: 1, global: 200 };
    await consumeDemoQuota(db, { ipKey, limits: oneUse, now });

    const lastMillisecond = new Date(Date.UTC(2027, 0, dayNumber, 12, 59, 59, 999));
    const result = await consumeDemoQuota(db, { ipKey, limits: oneUse, now: lastMillisecond });

    expect(result).toMatchObject({ allowed: false, scope: "ip" });
  });

  it("refuses by the global limit, gives the end of the day and starts over the next day", async () => {
    const now = freshDay();
    const tight = { ip: 5, global: 2 };
    await consumeDemoQuota(db, { ipKey: key(), limits: tight, now });
    await consumeDemoQuota(db, { ipKey: key(), limits: tight, now });

    const refused = await consumeDemoQuota(db, { ipKey: key(), limits: tight, now });
    const tomorrow = new Date(Date.UTC(2027, 0, dayNumber + 1, 0, 0, 0, 0));
    const next = await consumeDemoQuota(db, { ipKey: key(), limits: tight, now: tomorrow });

    expect(refused).toEqual({ allowed: false, scope: "global", retryAt: tomorrow });
    expect(next).toMatchObject({ allowed: true, global: { used: 1 } });
  });

  it("does not spend the visitor counter when the global limit refuses", async () => {
    const now = freshDay();
    const tight = { ip: 5, global: 1 };
    await consumeDemoQuota(db, { ipKey: key(), limits: tight, now });
    const refusedKey = key();

    const refused = await consumeDemoQuota(db, { ipKey: refusedKey, limits: tight, now });

    expect(refused).toMatchObject({ allowed: false, scope: "global" });
    expect(await db.demoQuota.count({ where: { kind: "ip", key: refusedKey } })).toBe(0);
  });

  it("lets only five of twenty simultaneous requests from one visitor through", async () => {
    const now = freshDay();
    const ipKey = key();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeDemoQuota(db, { ipKey, limits, now })),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(await countOf("ip", ipKey)).toBe(5);
  });

  it("lets only seven of twenty simultaneous visitors through the global limit, spending nothing on the rest", async () => {
    const now = freshDay();
    const tight = { ip: 5, global: 7 };
    const keys = Array.from({ length: 20 }, () => key());

    const results = await Promise.all(
      keys.map((ipKey) => consumeDemoQuota(db, { ipKey, limits: tight, now })),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(7);
    expect(results.filter((result) => !result.allowed && result.scope === "global")).toHaveLength(
      13,
    );
    const spent = await db.demoQuota.findMany({ where: { kind: "ip", key: { in: keys } } });
    expect(spent).toHaveLength(7);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a visitor limit of %s", async (ip) => {
    await expect(
      consumeDemoQuota(db, { ipKey: key(), limits: { ip, global: 200 }, now: freshDay() }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it.each([0, -1, 2.5, Number.NaN])("refuses a global limit of %s", async (global) => {
    await expect(
      consumeDemoQuota(db, { ipKey: key(), limits: { ip: 5, global }, now: freshDay() }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("lets a database failure through instead of calling it a refusal", async () => {
    const failing = vi
      .spyOn(db, "$transaction")
      .mockRejectedValueOnce(new Error("connection lost"));

    await expect(consumeDemoQuota(db, { ipKey: key(), limits, now: freshDay() })).rejects.toThrow(
      "connection lost",
    );

    failing.mockRestore();
  });

  it("uses the clock of the database when no time is given", async () => {
    const result = await consumeDemoQuota(db, { ipKey: key(), limits });

    const [clock] = await db.$queryRaw<{ hourEnd: Date }[]>`
      SELECT date_trunc('hour', now(), 'UTC') + interval '1 hour' AS "hourEnd"`;
    expect(result).toMatchObject({ allowed: true });
    expect(result.allowed && result.ip.resetsAt.getTime()).toBe(clock?.hourEnd.getTime());
  });
});
