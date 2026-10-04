import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import {
  listDeadDeliveries,
  listDestinations,
  type DeadDeliveryCursor,
} from "./delivery-queries.js";
import type { DeliveryStatus } from "./generated/enums.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let db: Db;

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 3, 12, 0, seconds));

async function createEndpoint() {
  const endpoint = await db.endpoint.create({
    data: { slug: randomUUID(), name: "scenario", signatureScheme: "none" },
  });
  return endpoint.id;
}

function createDestination(endpointId: string, name = "a", createdAt = at(0)) {
  return db.destination.create({
    data: {
      endpointId,
      url: `http://localhost:9999/${name}`,
      secretEncrypted: "x",
      eventTypes: ["*"],
      createdAt,
    },
  });
}

function createEvent(endpointId: string, eventType = "push") {
  return db.event.create({
    data: {
      endpointId,
      eventType,
      idempotencyKey: randomUUID(),
      headers: {},
      body: Buffer.from("{}"),
    },
  });
}

type DeliveryOverrides = {
  createdAt?: Date;
  attemptCount?: number;
  lastError?: string;
};

function createDelivery(
  eventId: string,
  destinationId: string,
  status: DeliveryStatus,
  overrides: DeliveryOverrides = {},
) {
  return db.delivery.create({ data: { eventId, destinationId, status, ...overrides } });
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

describe("listDeadDeliveries", () => {
  it("lists only the dead deliveries of the endpoint asked for", async () => {
    const endpointId = await createEndpoint();
    const statuses: DeliveryStatus[] = ["pending", "in_progress", "succeeded", "dead"];
    const deliveries = [];
    for (const [index, status] of statuses.entries()) {
      const destination = await createDestination(endpointId, `d-${String(index)}`);
      const event = await createEvent(endpointId);
      deliveries.push(await createDelivery(event.id, destination.id, status));
    }
    const otherEndpointId = await createEndpoint();
    const otherDestination = await createDestination(otherEndpointId);
    const otherEvent = await createEvent(otherEndpointId);
    await createDelivery(otherEvent.id, otherDestination.id, "dead");

    const page = await listDeadDeliveries(db, { endpointId, limit: 10 });

    expect(page.deliveries.map((delivery) => delivery.id)).toEqual([deliveries[3]?.id]);
  });

  it("shows what is needed to decide on a resend", async () => {
    const endpointId = await createEndpoint();
    const destination = await createDestination(endpointId, "billing");
    const event = await createEvent(endpointId, "invoice.paid");
    const delivery = await createDelivery(event.id, destination.id, "dead", {
      attemptCount: 8,
      lastError: "gave up after 8 attempts",
    });

    const page = await listDeadDeliveries(db, { endpointId, limit: 10 });

    expect(page.deliveries).toEqual([
      {
        id: delivery.id,
        eventId: event.id,
        eventType: "invoice.paid",
        destinationId: destination.id,
        destinationUrl: "http://localhost:9999/billing",
        attemptCount: 8,
        lastError: "gave up after 8 attempts",
        createdAt: delivery.createdAt,
        lastAttempt: null,
      },
    ]);
  });

  it("walks every dead delivery exactly once, newest first, even when created_at repeats", async () => {
    const endpointId = await createEndpoint();
    const destination = await createDestination(endpointId);
    const created = [];
    for (let index = 0; index < 25; index++) {
      const event = await createEvent(endpointId);
      created.push(
        await createDelivery(event.id, destination.id, "dead", { createdAt: at(index % 5) }),
      );
    }
    const newestFirst = created
      .map((delivery) => ({
        id: delivery.id,
        key: `${delivery.createdAt.toISOString()} ${delivery.id}`,
      }))
      .sort((first, second) => (first.key < second.key ? 1 : -1))
      .map((delivery) => delivery.id);

    const walked: string[] = [];
    let after: DeadDeliveryCursor | undefined;
    do {
      const page = await listDeadDeliveries(db, { endpointId, limit: 7, after });
      walked.push(...page.deliveries.map((delivery) => delivery.id));
      after = page.next ?? undefined;
    } while (after);

    expect(walked).toEqual(newestFirst);
  });

  it("reports the latest attempt, and none for a delivery buried without sending", async () => {
    const endpointId = await createEndpoint();
    const destination = await createDestination(endpointId);
    const sent = await createDelivery((await createEvent(endpointId)).id, destination.id, "dead", {
      createdAt: at(2),
    });
    await createDelivery((await createEvent(endpointId)).id, destination.id, "dead", {
      createdAt: at(1),
    });
    await db.attempt.create({
      data: { deliveryId: sent.id, startedAt: at(30), durationMs: 10_000, error: "timeout" },
    });
    await db.attempt.create({
      data: { deliveryId: sent.id, startedAt: at(10), durationMs: 5, httpStatus: 503 },
    });

    const page = await listDeadDeliveries(db, { endpointId, limit: 10 });

    expect(page.deliveries.map((delivery) => delivery.lastAttempt)).toEqual([
      { startedAt: at(30), durationMs: 10_000, httpStatus: null },
      null,
    ]);
  });

  it("returns no cursor on a full last page and refuses a limit below 1", async () => {
    const endpointId = await createEndpoint();
    const destination = await createDestination(endpointId);
    for (const second of [1, 2, 3]) {
      await createDelivery((await createEvent(endpointId)).id, destination.id, "dead", {
        createdAt: at(second),
      });
    }

    expect((await listDeadDeliveries(db, { endpointId, limit: 3 })).next).toBeNull();
    expect((await listDeadDeliveries(db, { endpointId, limit: 2 })).next).not.toBeNull();
    await expect(listDeadDeliveries(db, { endpointId, limit: 0 })).rejects.toThrow(RangeError);
  });
});

describe("listDestinations", () => {
  it("lists the destinations of the endpoint in creation order, with their circuit", async () => {
    const endpointId = await createEndpoint();
    const second = await createDestination(endpointId, "second", at(2));
    const first = await createDestination(endpointId, "first", at(1));
    await db.destination.update({
      where: { id: first.id },
      data: { circuitState: "open", consecutiveFailures: 5, circuitOpenedAt: at(40) },
    });
    await db.destination.update({ where: { id: second.id }, data: { isActive: false } });
    await createDestination(await createEndpoint(), "someone-else");

    const destinations = await listDestinations(db, { endpointId });

    expect(destinations).toMatchObject([
      {
        id: first.id,
        url: "http://localhost:9999/first",
        isActive: true,
        eventTypes: ["*"],
        circuitState: "open",
        consecutiveFailures: 5,
        circuitOpenedAt: at(40),
      },
      {
        id: second.id,
        isActive: false,
        circuitState: "closed",
        consecutiveFailures: 0,
        circuitOpenedAt: null,
      },
    ]);
  });

  it("counts the deliveries of each destination by status", async () => {
    const endpointId = await createEndpoint();
    const busy = await createDestination(endpointId, "busy", at(1));
    const idle = await createDestination(endpointId, "idle", at(2));
    const statuses: DeliveryStatus[] = [
      ...Array<DeliveryStatus>(1).fill("pending"),
      ...Array<DeliveryStatus>(2).fill("in_progress"),
      ...Array<DeliveryStatus>(3).fill("succeeded"),
      ...Array<DeliveryStatus>(4).fill("dead"),
    ];
    for (const status of statuses) {
      await createDelivery((await createEvent(endpointId)).id, busy.id, status);
    }

    const destinations = await listDestinations(db, { endpointId });

    expect(destinations.map(({ id, deliveries }) => ({ id, deliveries }))).toEqual([
      { id: busy.id, deliveries: { pending: 1, in_progress: 2, succeeded: 3, dead: 4 } },
      { id: idle.id, deliveries: { pending: 0, in_progress: 0, succeeded: 0, dead: 0 } },
    ]);
  });
});
