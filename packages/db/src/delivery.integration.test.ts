import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./client.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let db: Db;
let endpointId: string;
let destinationId: string;

function createEvent() {
  return db.event.create({
    data: {
      endpointId,
      idempotencyKey: randomUUID(),
      eventType: "push",
      headers: {},
      body: Buffer.from("{}"),
    },
  });
}

async function secondsFromDatabaseNow(deliveryId: string) {
  const rows = await db.$queryRaw<{ seconds: number }[]>`
    SELECT extract(epoch FROM next_attempt_at - now())::float8 AS seconds
    FROM delivery WHERE id = ${deliveryId}::uuid`;
  return rows[0]?.seconds ?? Number.NaN;
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
  const endpoint = await db.endpoint.create({
    data: { slug: "github-main", name: "GitHub", signatureScheme: "none" },
  });
  endpointId = endpoint.id;
  const destination = await db.destination.create({
    data: {
      endpointId,
      url: "http://localhost:9999/hook",
      secretEncrypted: "x",
      eventTypes: ["*"],
    },
  });
  destinationId = destination.id;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

describe("delivery table", () => {
  it("starts pending, unlocked and due right away", async () => {
    const event = await createEvent();

    const delivery = await db.delivery.create({ data: { eventId: event.id, destinationId } });

    expect(delivery).toMatchObject({
      status: "pending",
      attemptCount: 0,
      lockedUntil: null,
      lastError: null,
      succeededAt: null,
    });
    expect(Math.abs(await secondsFromDatabaseNow(delivery.id))).toBeLessThan(1);
  });

  it("takes next_attempt_at from the database clock, not from the Node process", async () => {
    const event = await createEvent();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);

    const delivery = await db.delivery
      .create({ data: { eventId: event.id, destinationId } })
      .finally(() => vi.useRealTimers());

    expect(Math.abs(await secondsFromDatabaseNow(delivery.id))).toBeLessThan(1);
  });

  it("allows only one delivery per event and destination", async () => {
    const event = await createEvent();
    await db.delivery.create({ data: { eventId: event.id, destinationId } });

    await expect(
      db.delivery.create({ data: { eventId: event.id, destinationId } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("deletes its deliveries together with the event", async () => {
    const event = await createEvent();
    await db.delivery.create({ data: { eventId: event.id, destinationId } });

    await db.event.delete({ where: { id: event.id } });

    expect(await db.delivery.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("refuses to delete a destination that still has deliveries", async () => {
    const event = await createEvent();
    const destination = await db.destination.create({
      data: {
        endpointId,
        url: "http://localhost:9999/other",
        secretEncrypted: "x",
        eventTypes: [],
      },
    });
    await db.delivery.create({ data: { eventId: event.id, destinationId: destination.id } });

    await expect(db.destination.delete({ where: { id: destination.id } })).rejects.toMatchObject({
      code: "P2003",
    });
  });
});

describe("attempt table", () => {
  async function createDelivery() {
    const event = await createEvent();
    return db.delivery.create({ data: { eventId: event.id, destinationId } });
  }

  it("keeps the status and snippet of an answer and leaves the error empty", async () => {
    const delivery = await createDelivery();

    const attempt = await db.attempt.create({
      data: {
        deliveryId: delivery.id,
        startedAt: new Date(),
        durationMs: 120,
        httpStatus: 503,
        responseSnippet: "upstream unavailable",
      },
    });

    expect(attempt).toMatchObject({
      durationMs: 120,
      httpStatus: 503,
      responseSnippet: "upstream unavailable",
      error: null,
    });
  });

  it("keeps the error of a call that got no answer and leaves the status empty", async () => {
    const delivery = await createDelivery();

    const attempt = await db.attempt.create({
      data: {
        deliveryId: delivery.id,
        startedAt: new Date(),
        durationMs: 10_000,
        error: "timed out after 10000 ms",
      },
    });

    expect(attempt).toMatchObject({
      httpStatus: null,
      responseSnippet: null,
      error: "timed out after 10000 ms",
    });
  });

  it("refuses an attempt for a delivery that does not exist", async () => {
    await expect(
      db.attempt.create({
        data: { deliveryId: randomUUID(), startedAt: new Date(), durationMs: 1, httpStatus: 200 },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("deletes its attempts together with the event, through the delivery", async () => {
    const delivery = await createDelivery();
    await db.attempt.createMany({
      data: [1, 2].map((durationMs) => ({
        deliveryId: delivery.id,
        startedAt: new Date(),
        durationMs,
        httpStatus: 500,
      })),
    });

    await db.event.delete({ where: { id: delivery.eventId } });

    expect(await db.attempt.count({ where: { deliveryId: delivery.id } })).toBe(0);
  });
});

describe("destination circuit breaker columns", () => {
  it("starts closed, with no failures and no opening time, even when inserted without Prisma", async () => {
    const rows = await db.$queryRaw<
      { circuit_state: string; consecutive_failures: number; circuit_opened_at: Date | null }[]
    >`
      INSERT INTO destination (id, endpoint_id, url, secret_encrypted, event_types)
      VALUES (${randomUUID()}::uuid, ${endpointId}::uuid, 'http://localhost:9999/raw', 'x', ARRAY[]::text[])
      RETURNING circuit_state, consecutive_failures, circuit_opened_at`;

    expect(rows).toEqual([
      { circuit_state: "closed", consecutive_failures: 0, circuit_opened_at: null },
    ]);
  });

  it("refuses a circuit state outside closed, open and half_open", async () => {
    await expect(
      db.$executeRaw`UPDATE destination SET circuit_state = 'broken' WHERE id = ${destinationId}::uuid`,
    ).rejects.toThrow(/circuit_state/);
  });
});
