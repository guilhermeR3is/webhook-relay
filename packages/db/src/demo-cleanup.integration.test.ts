import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import { deleteExpiredDemoData } from "./demo-cleanup.js";
import type { DeliveryStatus } from "./generated/enums.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

const cutoff = new Date("2026-10-04T12:00:00Z");
const old = new Date("2026-09-20T12:00:00Z");
const recent = new Date("2026-10-05T12:00:00Z");

let testDatabase: TestDatabase;
let db: Db;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

async function createEndpoint() {
  const slug = randomUUID();
  const endpoint = await db.endpoint.create({
    data: { slug, name: slug, signatureScheme: "none" },
  });
  return { slug, endpointId: endpoint.id };
}

async function createDestination(endpointId: string) {
  const destination = await db.destination.create({
    data: {
      endpointId,
      url: `https://example.com/${randomUUID()}`,
      secretEncrypted: "unused",
      eventTypes: ["*"],
    },
  });
  return destination.id;
}

async function createEvent(endpointId: string, receivedAt: Date, statuses: DeliveryStatus[] = []) {
  const event = await db.event.create({
    data: {
      endpointId,
      idempotencyKey: randomUUID(),
      eventType: "demo.test",
      headers: {},
      body: Buffer.from("{}"),
      receivedAt,
    },
  });
  const deliveryIds: string[] = [];
  for (const status of statuses) {
    const delivery = await db.delivery.create({
      data: { eventId: event.id, destinationId: await createDestination(endpointId), status },
    });
    deliveryIds.push(delivery.id);
  }
  return { eventId: event.id, deliveryIds };
}

const eventExists = async (eventId: string) =>
  (await db.event.count({ where: { id: eventId } })) === 1;

describe("deleteExpiredDemoData", () => {
  it("deletes old events with their deliveries, attempts and resends, and keeps the recent ones", async () => {
    const { slug, endpointId } = await createEndpoint();
    const expired = await createEvent(endpointId, old, ["dead"]);
    const [deliveryId = ""] = expired.deliveryIds;
    await db.attempt.create({
      data: { deliveryId, startedAt: old, durationMs: 10, httpStatus: 503 },
    });
    await db.resend.create({ data: { deliveryId, attemptsBefore: 8 } });
    const fresh = await createEvent(endpointId, recent, ["succeeded"]);
    const atTheCutoff = await createEvent(endpointId, cutoff, ["succeeded"]);

    const deleted = await deleteExpiredDemoData(db, { endpointSlug: slug, olderThan: cutoff });

    expect(deleted.events).toBe(1);
    expect(await eventExists(expired.eventId)).toBe(false);
    expect(await db.delivery.count({ where: { id: deliveryId } })).toBe(0);
    expect(await db.attempt.count({ where: { deliveryId } })).toBe(0);
    expect(await db.resend.count({ where: { deliveryId } })).toBe(0);
    expect(await eventExists(fresh.eventId)).toBe(true);
    expect(await eventExists(atTheCutoff.eventId)).toBe(true);
  });

  it.each<[DeliveryStatus, boolean]>([
    ["pending", true],
    ["in_progress", true],
    ["succeeded", false],
    ["dead", false],
  ])("an old event with a %s delivery is kept: %s", async (status, kept) => {
    const { slug, endpointId } = await createEndpoint();
    const event = await createEvent(endpointId, old, [status]);

    await deleteExpiredDemoData(db, { endpointSlug: slug, olderThan: cutoff });

    expect(await eventExists(event.eventId)).toBe(kept);
  });

  it("keeps an old event while any one of its deliveries is unfinished", async () => {
    const { slug, endpointId } = await createEndpoint();
    const event = await createEvent(endpointId, old, ["succeeded", "pending"]);

    await deleteExpiredDemoData(db, { endpointSlug: slug, olderThan: cutoff });

    expect(await eventExists(event.eventId)).toBe(true);
  });

  it("deletes an old event that has no delivery at all", async () => {
    const { slug, endpointId } = await createEndpoint();
    const event = await createEvent(endpointId, old);

    await deleteExpiredDemoData(db, { endpointSlug: slug, olderThan: cutoff });

    expect(await eventExists(event.eventId)).toBe(false);
  });

  it("leaves the events of other endpoints alone", async () => {
    const demo = await createEndpoint();
    const other = await createEndpoint();
    const otherEvent = await createEvent(other.endpointId, old, ["succeeded"]);

    await deleteExpiredDemoData(db, { endpointSlug: demo.slug, olderThan: cutoff });

    expect(await eventExists(otherEvent.eventId)).toBe(true);
  });

  it("deletes only the quota windows older than the cutoff", async () => {
    await db.demoQuota.createMany({
      data: [
        { kind: "global", key: "all", windowStart: old, count: 3 },
        { kind: "ip", key: "visitor", windowStart: old, count: 2 },
        { kind: "global", key: "all", windowStart: recent, count: 1 },
      ],
    });
    const { slug } = await createEndpoint();

    const deleted = await deleteExpiredDemoData(db, { endpointSlug: slug, olderThan: cutoff });

    expect(deleted.quotaWindows).toBe(2);
    expect(await db.demoQuota.findMany({ select: { windowStart: true } })).toEqual([
      { windowStart: recent },
    ]);
  });

  it("deletes nothing and does not fail for a slug that does not exist", async () => {
    const deleted = await deleteExpiredDemoData(db, { endpointSlug: "nobody", olderThan: cutoff });

    expect(deleted.events).toBe(0);
  });
});
