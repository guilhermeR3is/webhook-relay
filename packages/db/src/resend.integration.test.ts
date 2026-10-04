import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./client.js";
import type { DeliveryStatus } from "./generated/enums.js";
import { reserveDeliveries } from "./queue.js";
import { resendDeliveries } from "./resend.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let db: Db;

async function createScenario() {
  const endpoint = await db.endpoint.create({
    data: { slug: randomUUID(), name: "scenario", signatureScheme: "none" },
  });
  const destination = await createDestination(endpoint.id, true);
  return { endpointId: endpoint.id, destinationId: destination.id };
}

function createDestination(endpointId: string, isActive: boolean) {
  return db.destination.create({
    data: {
      endpointId,
      url: "http://localhost:9999/hook",
      secretEncrypted: "x",
      eventTypes: ["*"],
      isActive,
    },
  });
}

async function createDelivery(
  endpointId: string,
  destinationId: string,
  status: DeliveryStatus,
  attempts = 0,
) {
  const event = await db.event.create({
    data: {
      endpointId,
      idempotencyKey: randomUUID(),
      eventType: "push",
      headers: {},
      body: Buffer.from("{}"),
    },
  });
  const delivery = await db.delivery.create({
    data: {
      eventId: event.id,
      destinationId,
      status,
      attemptCount: attempts,
      lastError: status === "dead" ? "gave up after 8 attempts" : null,
      lockedUntil: status === "in_progress" ? new Date(Date.now() + 60_000) : null,
      nextAttemptAt: status === "dead" ? new Date(Date.now() + 3_600_000) : undefined,
    },
  });
  await addAttempts(delivery.id, attempts);
  return delivery;
}

function addAttempts(deliveryId: string, count: number) {
  return db.attempt.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      deliveryId,
      startedAt: new Date(Date.now() - (count - index) * 1000),
      durationMs: 5,
      httpStatus: 503,
    })),
  });
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

describe("resendDeliveries", () => {
  it("puts a dead delivery back in the queue with a fresh count and records the resend", async () => {
    const { endpointId, destinationId } = await createScenario();
    const delivery = await createDelivery(endpointId, destinationId, "dead", 3);

    const result = await resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] });

    expect(result).toEqual({ resent: [delivery.id], skipped: [] });
    const after = await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after).toMatchObject({
      status: "pending",
      attemptCount: 0,
      lockedUntil: null,
      lastError: "gave up after 8 attempts",
    });
    expect(Math.abs(after.nextAttemptAt.getTime() - Date.now())).toBeLessThan(5000);
    expect(await db.resend.findMany({ where: { deliveryId: delivery.id } })).toMatchObject([
      { attemptsBefore: 3 },
    ]);
    expect(await db.attempt.count({ where: { deliveryId: delivery.id } })).toBe(3);
  });

  it("makes the delivery reservable again, starting a new run of attempts at 1", async () => {
    const { endpointId, destinationId } = await createScenario();
    const delivery = await createDelivery(endpointId, destinationId, "dead", 8);
    await resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] });

    await vi.waitFor(async () => {
      const reserved = await reserveDeliveries(db, { limit: 50, leaseSeconds: 60 });
      expect(reserved.find((row) => row.id === delivery.id)).toMatchObject({ attemptCount: 1 });
    });
  });

  it.each<[DeliveryStatus]>([["pending"], ["in_progress"], ["succeeded"]])(
    "refuses a delivery that is %s and changes nothing",
    async (status) => {
      const { endpointId, destinationId } = await createScenario();
      const delivery = await createDelivery(endpointId, destinationId, status, 2);

      const result = await resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] });

      expect(result).toEqual({
        resent: [],
        skipped: [{ id: delivery.id, reason: "not_dead" }],
      });
      expect(await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
        status,
        attemptCount: 2,
      });
      expect(await db.resend.count({ where: { deliveryId: delivery.id } })).toBe(0);
    },
  );

  it("refuses a dead delivery whose destination was deactivated", async () => {
    const { endpointId } = await createScenario();
    const inactive = await createDestination(endpointId, false);
    const delivery = await createDelivery(endpointId, inactive.id, "dead", 1);

    const result = await resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] });

    expect(result.skipped).toEqual([{ id: delivery.id, reason: "destination_inactive" }]);
    expect((await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe(
      "dead",
    );
  });

  it("treats an unknown id and a delivery of another endpoint as not found", async () => {
    const mine = await createScenario();
    const theirs = await createScenario();
    const foreign = await createDelivery(theirs.endpointId, theirs.destinationId, "dead");
    const unknown = randomUUID();

    const result = await resendDeliveries(db, {
      endpointId: mine.endpointId,
      deliveryIds: [foreign.id, unknown],
    });

    expect(result.skipped).toEqual([
      { id: foreign.id, reason: "not_found" },
      { id: unknown, reason: "not_found" },
    ]);
    expect((await db.delivery.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
      "dead",
    );
  });

  it("resends what it can in a batch and says why it skipped the rest, in the order asked", async () => {
    const { endpointId, destinationId } = await createScenario();
    const first = await createDelivery(endpointId, destinationId, "dead", 2);
    const waiting = await createDelivery(endpointId, destinationId, "pending");
    const second = await createDelivery(endpointId, destinationId, "dead", 4);

    const result = await resendDeliveries(db, {
      endpointId,
      deliveryIds: [second.id, waiting.id, first.id, second.id],
    });

    expect(result).toEqual({
      resent: [second.id, first.id],
      skipped: [{ id: waiting.id, reason: "not_dead" }],
    });
    expect(await db.resend.count({ where: { deliveryId: { in: [first.id, second.id] } } })).toBe(2);
  });

  it("does nothing for an empty list", async () => {
    const { endpointId } = await createScenario();

    expect(await resendDeliveries(db, { endpointId, deliveryIds: [] })).toEqual({
      resent: [],
      skipped: [],
    });
  });

  it("lets only one of 10 simultaneous resends of the same delivery through", async () => {
    const { endpointId, destinationId } = await createScenario();
    const delivery = await createDelivery(endpointId, destinationId, "dead", 8);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] }),
      ),
    );

    expect(results.filter((result) => result.resent.length === 1)).toHaveLength(1);
    expect(
      results.flatMap((result) => result.skipped).every((skip) => skip.reason === "not_dead"),
    ).toBe(true);
    expect(await db.resend.count({ where: { deliveryId: delivery.id } })).toBe(1);
  });

  it("records each resend with the attempts that existed at that moment", async () => {
    const { endpointId, destinationId } = await createScenario();
    const delivery = await createDelivery(endpointId, destinationId, "dead", 3);
    await resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] });
    await addAttempts(delivery.id, 2);
    await db.delivery.update({ where: { id: delivery.id }, data: { status: "dead" } });

    await resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] });

    const resends = await db.resend.findMany({
      where: { deliveryId: delivery.id },
      orderBy: { attemptsBefore: "asc" },
    });
    expect(resends.map((resend) => resend.attemptsBefore)).toEqual([3, 5]);
  });

  it("keeps the delivery dead when the resend cannot be recorded", async () => {
    const { endpointId, destinationId } = await createScenario();
    const delivery = await createDelivery(endpointId, destinationId, "dead", 2);
    await db.$executeRawUnsafe(`
      CREATE FUNCTION reject_resend() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'resend rejected'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_resend BEFORE INSERT ON resend
        FOR EACH ROW EXECUTE FUNCTION reject_resend();
    `);

    try {
      await expect(
        resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] }),
      ).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`
        DROP TRIGGER reject_resend ON resend;
        DROP FUNCTION reject_resend();
      `);
    }

    expect((await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe(
      "dead",
    );
  });
});

describe("resend table", () => {
  it("takes requested_at from the database clock, not from the Node process", async () => {
    const { endpointId, destinationId } = await createScenario();
    const delivery = await createDelivery(endpointId, destinationId, "dead");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);

    await resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] }).finally(() =>
      vi.useRealTimers(),
    );

    const rows = await db.$queryRaw<{ seconds: number }[]>`
      SELECT extract(epoch FROM requested_at - now())::float8 AS seconds
      FROM resend WHERE delivery_id = ${delivery.id}::uuid`;
    expect(Math.abs(rows[0]?.seconds ?? Number.NaN)).toBeLessThan(5);
  });

  it("deletes its rows together with the event, through the delivery", async () => {
    const { endpointId, destinationId } = await createScenario();
    const delivery = await createDelivery(endpointId, destinationId, "dead");
    await resendDeliveries(db, { endpointId, deliveryIds: [delivery.id] });

    await db.event.delete({ where: { id: delivery.eventId } });

    expect(await db.resend.count({ where: { deliveryId: delivery.id } })).toBe(0);
  });

  it("refuses a resend for a delivery that does not exist", async () => {
    await expect(
      db.resend.create({ data: { deliveryId: randomUUID(), attemptsBefore: 0 } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
