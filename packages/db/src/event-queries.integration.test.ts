import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import { getEventDetail, listEvents, type EventCursor } from "./event-queries.js";
import type { DeliveryStatus } from "./generated/enums.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let db: Db;

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 3, 12, 0, seconds));

function createDestination(endpointId: string, name: string) {
  return db.destination.create({
    data: {
      endpointId,
      url: `http://localhost:9999/${name}`,
      secretEncrypted: "x",
      eventTypes: ["*"],
    },
  });
}

async function createScenario() {
  const endpoint = await db.endpoint.create({
    data: { slug: randomUUID(), name: "scenario", signatureScheme: "none" },
  });
  const destinationA = await createDestination(endpoint.id, "a");
  const destinationB = await createDestination(endpoint.id, "b");
  return { endpointId: endpoint.id, destinationA, destinationB };
}

type EventOverrides = {
  eventType?: string;
  idempotencyKey?: string;
  receivedAt?: Date;
  body?: Uint8Array<ArrayBuffer>;
};

function createEvent(
  endpointId: string,
  {
    eventType = "push",
    idempotencyKey = randomUUID(),
    receivedAt = at(0),
    body = Buffer.from("{}"),
  }: EventOverrides = {},
) {
  return db.event.create({
    data: { endpointId, eventType, idempotencyKey, receivedAt, headers: {}, body },
  });
}

function createDelivery(eventId: string, destinationId: string, status: DeliveryStatus) {
  return db.delivery.create({ data: { eventId, destinationId, status } });
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

describe("listEvents", () => {
  it("lists the newest events first and breaks ties by id", async () => {
    const { endpointId } = await createScenario();
    const older = await createEvent(endpointId, { receivedAt: at(0) });
    const tied = await Promise.all(
      [1, 2, 3].map(() => createEvent(endpointId, { receivedAt: at(10) })),
    );

    const page = await listEvents(db, { endpointId, limit: 10 });

    const tiedIdsNewestFirst = tied
      .map((event) => event.id)
      .sort()
      .reverse();
    expect(page.events.map((event) => event.id)).toEqual([...tiedIdsNewestFirst, older.id]);
  });

  it("walks every event exactly once with the cursor, even when received_at repeats", async () => {
    const { endpointId } = await createScenario();
    await db.event.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        endpointId,
        idempotencyKey: randomUUID(),
        eventType: "push",
        headers: {},
        body: Buffer.from("{}"),
        receivedAt: at(index % 5),
      })),
    });
    const everything = await listEvents(db, { endpointId, limit: 100 });

    const walked: string[] = [];
    let after: EventCursor | undefined;
    do {
      const page = await listEvents(db, { endpointId, limit: 7, after });
      walked.push(...page.events.map((event) => event.id));
      after = page.next ?? undefined;
    } while (after);

    expect(walked).toEqual(everything.events.map((event) => event.id));
    expect(new Set(walked).size).toBe(25);
  });

  it("returns no cursor when the last page is exactly full", async () => {
    const { endpointId } = await createScenario();
    for (const second of [1, 2, 3]) await createEvent(endpointId, { receivedAt: at(second) });

    expect((await listEvents(db, { endpointId, limit: 3 })).next).toBeNull();
    expect((await listEvents(db, { endpointId, limit: 2 })).next).not.toBeNull();
  });

  it("refuses a limit below 1", async () => {
    const { endpointId } = await createScenario();

    await expect(listEvents(db, { endpointId, limit: 0 })).rejects.toThrow(RangeError);
  });

  it("counts the deliveries of each event by status", async () => {
    const { endpointId } = await createScenario();
    const mixed = await createEvent(endpointId, { receivedAt: at(2) });
    const statuses: DeliveryStatus[] = [
      ...Array<DeliveryStatus>(1).fill("pending"),
      ...Array<DeliveryStatus>(2).fill("in_progress"),
      ...Array<DeliveryStatus>(3).fill("succeeded"),
      ...Array<DeliveryStatus>(4).fill("dead"),
    ];
    for (const [index, status] of statuses.entries()) {
      const destination = await createDestination(endpointId, `count-${String(index)}`);
      await createDelivery(mixed.id, destination.id, status);
    }
    const withoutDeliveries = await createEvent(endpointId, { receivedAt: at(1) });

    const page = await listEvents(db, { endpointId, limit: 10 });

    expect(page.events).toMatchObject([
      { id: mixed.id, deliveries: { pending: 1, in_progress: 2, succeeded: 3, dead: 4 } },
      {
        id: withoutDeliveries.id,
        deliveries: { pending: 0, in_progress: 0, succeeded: 0, dead: 0 },
      },
    ]);
  });

  it("keeps an event when any of its deliveries has the status asked for", async () => {
    const { endpointId, destinationA, destinationB } = await createScenario();
    const deadAndSucceeded = await createEvent(endpointId, { receivedAt: at(3) });
    await createDelivery(deadAndSucceeded.id, destinationA.id, "dead");
    await createDelivery(deadAndSucceeded.id, destinationB.id, "succeeded");
    const onlySucceeded = await createEvent(endpointId, { receivedAt: at(2) });
    await createDelivery(onlySucceeded.id, destinationA.id, "succeeded");
    await createEvent(endpointId, { receivedAt: at(1) });

    const dead = await listEvents(db, { endpointId, status: "dead", limit: 10 });
    const succeeded = await listEvents(db, { endpointId, status: "succeeded", limit: 10 });

    expect(dead.events.map((event) => event.id)).toEqual([deadAndSucceeded.id]);
    expect(succeeded.events.map((event) => event.id)).toEqual([
      deadAndSucceeded.id,
      onlySucceeded.id,
    ]);
  });

  it("searches the event type, the idempotency key and a piece of the id, ignoring case", async () => {
    const { endpointId } = await createScenario();
    const pullRequest = await createEvent(endpointId, {
      eventType: "pull_request",
      receivedAt: at(3),
    });
    const order = await createEvent(endpointId, {
      idempotencyKey: "Order-1001",
      receivedAt: at(2),
    });
    const push = await createEvent(endpointId, { eventType: "push", receivedAt: at(1) });

    const ids = async (search: string) =>
      (await listEvents(db, { endpointId, search, limit: 10 })).events.map((event) => event.id);

    expect(await ids("PULL_")).toEqual([pullRequest.id]);
    expect(await ids("order-100")).toEqual([order.id]);
    expect(await ids(push.id.slice(24, 32).toUpperCase())).toEqual([push.id]);
    expect(await ids("no such text")).toEqual([]);
  });

  it("treats % and _ in the search as plain characters", async () => {
    const { endpointId } = await createScenario();
    const percent = await createEvent(endpointId, { eventType: "100%", receivedAt: at(2) });
    await createEvent(endpointId, { eventType: "1000", receivedAt: at(1) });
    const underscore = await createEvent(endpointId, { eventType: "a_b", receivedAt: at(4) });
    await createEvent(endpointId, { eventType: "axb", receivedAt: at(3) });

    const ids = async (search: string) =>
      (await listEvents(db, { endpointId, search, limit: 10 })).events.map((event) => event.id);

    expect(await ids("0%")).toEqual([percent.id]);
    expect(await ids("a_b")).toEqual([underscore.id]);
  });

  it("combines the status, the search and the cursor", async () => {
    const { endpointId, destinationA } = await createScenario();
    const wanted = [];
    for (const second of [1, 2, 3, 4]) {
      const event = await createEvent(endpointId, {
        eventType: "invoice.paid",
        receivedAt: at(second),
      });
      await createDelivery(event.id, destinationA.id, "dead");
      wanted.push(event.id);
    }
    const otherType = await createEvent(endpointId, { eventType: "push", receivedAt: at(5) });
    await createDelivery(otherType.id, destinationA.id, "dead");
    const stillPending = await createEvent(endpointId, {
      eventType: "invoice.paid",
      receivedAt: at(6),
    });
    await createDelivery(stillPending.id, destinationA.id, "pending");

    const first = await listEvents(db, { endpointId, status: "dead", search: "invoice", limit: 2 });
    const second = await listEvents(db, {
      endpointId,
      status: "dead",
      search: "invoice",
      limit: 2,
      after: first.next ?? undefined,
    });

    expect([...first.events, ...second.events].map((event) => event.id)).toEqual(wanted.reverse());
    expect(second.next).toBeNull();
  });

  it("lists only the events of the endpoint asked for", async () => {
    const mine = await createScenario();
    const theirs = await createScenario();
    const ownEvent = await createEvent(mine.endpointId);
    await createEvent(theirs.endpointId);

    const page = await listEvents(db, { endpointId: mine.endpointId, limit: 10 });

    expect(page.events.map((event) => event.id)).toEqual([ownEvent.id]);
  });
});

describe("getEventDetail", () => {
  it("returns the event with its body, destinations and attempts in the order they started", async () => {
    const { endpointId, destinationA, destinationB } = await createScenario();
    const body = Buffer.from([0xff, 0x00, 0x7b]);
    const event = await createEvent(endpointId, { body });
    const deadDelivery = await createDelivery(event.id, destinationA.id, "dead");
    await createDelivery(event.id, destinationB.id, "pending");
    await db.attempt.create({
      data: { deliveryId: deadDelivery.id, startedAt: at(20), durationMs: 5, httpStatus: 503 },
    });
    await db.attempt.create({
      data: { deliveryId: deadDelivery.id, startedAt: at(10), durationMs: 7, httpStatus: 502 },
    });

    const detail = await getEventDetail(db, { endpointId, eventId: event.id });

    expect(Buffer.compare(detail?.body ?? Buffer.alloc(0), body)).toBe(0);
    expect(detail?.deliveries.map((delivery) => delivery.destination.url)).toEqual([
      "http://localhost:9999/a",
      "http://localhost:9999/b",
    ]);
    expect(detail?.deliveries[0]?.attempts.map((attempt) => attempt.httpStatus)).toEqual([
      502, 503,
    ]);
    expect(detail?.deliveries[1]?.attempts).toEqual([]);
  });

  it("returns the resends of each delivery, oldest first", async () => {
    const { endpointId, destinationA, destinationB } = await createScenario();
    const event = await createEvent(endpointId);
    const resent = await createDelivery(event.id, destinationA.id, "pending");
    await createDelivery(event.id, destinationB.id, "pending");
    await db.resend.create({
      data: { deliveryId: resent.id, attemptsBefore: 5, requestedAt: at(20) },
    });
    await db.resend.create({
      data: { deliveryId: resent.id, attemptsBefore: 2, requestedAt: at(10) },
    });

    const detail = await getEventDetail(db, { endpointId, eventId: event.id });

    expect(detail?.deliveries[0]?.resends.map((resend) => resend.attemptsBefore)).toEqual([2, 5]);
    expect(detail?.deliveries[1]?.resends).toEqual([]);
  });

  it("returns null for an event of another endpoint", async () => {
    const mine = await createScenario();
    const theirs = await createScenario();
    const foreignEvent = await createEvent(theirs.endpointId);

    expect(
      await getEventDetail(db, { endpointId: mine.endpointId, eventId: foreignEvent.id }),
    ).toBeNull();
  });

  it("returns null for an id that does not exist", async () => {
    const { endpointId } = await createScenario();

    expect(await getEventDetail(db, { endpointId, eventId: randomUUID() })).toBeNull();
  });
});
