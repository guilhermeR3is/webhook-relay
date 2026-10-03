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
