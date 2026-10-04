import { randomBytes, randomUUID } from "node:crypto";
import {
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_SECONDS,
  type Db,
  type DeliveryStatus,
} from "@relay/db";
import { startTestDatabase, type TestDatabase } from "@relay/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

type App = ReturnType<typeof buildApp>;
type EventsBody = { events: { id: string }[]; nextCursor: string | null };
type DeadBody = { deliveries: { id: string }[]; nextCursor: string | null };

let testDatabase: TestDatabase;
let db: Db;
const apps: App[] = [];

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 3, 12, 0, seconds));
const tokenUrl = "https://hooks.example.com/webhook/3f1c2d4e-9a7b-4c1d-8e2f-5a6b7c8d9e0f?key=abc";

async function createScenario() {
  const slug = randomUUID();
  const endpoint = await db.endpoint.create({
    data: { slug, name: slug, signatureScheme: "none" },
  });
  const app = buildPanelApp(slug);
  return { app, endpointId: endpoint.id };
}

function buildPanelApp(demoEndpointSlug: string) {
  const app = buildApp({
    db,
    encryptionKey: randomBytes(32),
    demoEndpointSlug,
    demoQuotaSalt: "test-salt-with-enough-characters",
    panelOrigin: "http://localhost:3100",
    version: "test",
    commit: "test",
    logLevel: "silent",
  });
  apps.push(app);
  return app;
}

function createDestination(endpointId: string, url = tokenUrl) {
  return db.destination.create({
    data: { endpointId, url, secretEncrypted: "stored-secret-marker", eventTypes: ["*"] },
  });
}

type EventOverrides = {
  eventType?: string;
  receivedAt?: Date;
  body?: Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
};

function createEvent(
  endpointId: string,
  {
    eventType = "push",
    receivedAt = at(0),
    body = Buffer.from("{}"),
    headers = {},
  }: EventOverrides = {},
) {
  return db.event.create({
    data: { endpointId, eventType, idempotencyKey: randomUUID(), receivedAt, headers, body },
  });
}

function createDelivery(
  eventId: string,
  destinationId: string,
  status: DeliveryStatus,
  createdAt = at(0),
) {
  return db.delivery.create({ data: { eventId, destinationId, status, createdAt } });
}

function get(app: App, url: string) {
  return app.inject({ method: "GET", url });
}

function post(app: App, url: string, payload?: object) {
  return app.inject({ method: "POST", url, payload });
}

async function createDeadDelivery(endpointId: string, attempts: number) {
  const destination = await createDestination(endpointId);
  const event = await createEvent(endpointId);
  const delivery = await createDelivery(event.id, destination.id, "dead");
  await db.attempt.createMany({
    data: Array.from({ length: attempts }, (_, index) => ({
      deliveryId: delivery.id,
      startedAt: at(10 + index),
      durationMs: 5,
      httpStatus: 503,
    })),
  });
  return { event, delivery, destination };
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await testDatabase.stop();
});

describe("GET /panel/events", () => {
  it("lists the newest events of the demo endpoint with their delivery counts and tells caches to keep out", async () => {
    const { app, endpointId } = await createScenario();
    const other = await createScenario();
    const destination = await createDestination(endpointId);
    const older = await createEvent(endpointId, { receivedAt: at(1) });
    const newer = await createEvent(endpointId, { receivedAt: at(2) });
    await createDelivery(newer.id, destination.id, "dead");
    await createEvent(other.endpointId);

    const response = await get(app, "/panel/events");

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<EventsBody>();
    expect(body.events).toMatchObject([
      { id: newer.id, deliveries: { pending: 0, in_progress: 0, succeeded: 0, dead: 1 } },
      { id: older.id, deliveries: { pending: 0, in_progress: 0, succeeded: 0, dead: 0 } },
    ]);
    expect(body.nextCursor).toBeNull();
  });

  it("pages with an opaque cursor until it runs out", async () => {
    const { app, endpointId } = await createScenario();
    const created = [];
    for (const second of [1, 2, 3, 4, 5]) {
      created.push(await createEvent(endpointId, { receivedAt: at(second) }));
    }

    const walked: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const url: string =
        cursor === null ? "/panel/events?limit=2" : `/panel/events?limit=2&cursor=${cursor}`;
      const body = (await get(app, url)).json<EventsBody>();
      walked.push(...body.events.map((event) => event.id));
      pageSizes.push(body.events.length);
      cursor = body.nextCursor;
    } while (cursor !== null);

    expect(walked).toEqual(created.map((event) => event.id).reverse());
    expect(pageSizes).toEqual([2, 2, 1]);
  });

  it("filters by the status of a delivery and by a search text", async () => {
    const { app, endpointId } = await createScenario();
    const destination = await createDestination(endpointId);
    const failed = await createEvent(endpointId, { eventType: "push", receivedAt: at(3) });
    const delivered = await createEvent(endpointId, {
      eventType: "pull_request",
      receivedAt: at(2),
    });
    const waiting = await createEvent(endpointId, { eventType: "issues", receivedAt: at(1) });
    await createDelivery(failed.id, destination.id, "dead");
    await createDelivery(delivered.id, destination.id, "succeeded");
    await createDelivery(waiting.id, destination.id, "pending");

    const ids = async (query: string) =>
      (await get(app, `/panel/events?${query}`)).json<EventsBody>().events.map((event) => event.id);

    expect(await ids("status=dead")).toEqual([failed.id]);
    expect(await ids("search=PULL")).toEqual([delivered.id]);
    expect(await ids("status=succeeded&search=push")).toEqual([]);
    expect(await ids("search=%20pull%20")).toEqual([delivered.id]);
  });

  it.each([
    ["a status that does not exist", "status=archived", "status"],
    ["a limit of zero", "limit=0", "limit"],
    ["a limit above 100", "limit=101", "limit"],
    ["a limit that is not a number", "limit=many", "limit"],
    ["a search text above 100 characters", `search=${"a".repeat(101)}`, "search"],
  ])("answers 400 for %s", async (_name, query, field) => {
    const { app } = await createScenario();

    const response = await get(app, `/panel/events?${query}`);

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string; fields: Record<string, string[]> }>()).toMatchObject({
      error: "invalid_query",
      fields: { [field]: expect.any(Array) as string[] },
    });
  });

  it("answers 400 for a cursor that is not one", async () => {
    const { app } = await createScenario();

    const response = await get(app, "/panel/events?cursor=garbage");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_cursor" });
  });
});

describe("GET /panel/events/:eventId", () => {
  it("returns the event with a text preview of the body and its deliveries with attempts, without the real URL", async () => {
    const { app, endpointId } = await createScenario();
    const destination = await createDestination(endpointId);
    const event = await createEvent(endpointId, {
      eventType: "invoice.paid",
      body: Buffer.from('{"amount":10}'),
      headers: { "content-type": "application/json" },
    });
    const delivery = await createDelivery(event.id, destination.id, "dead");
    await db.attempt.create({
      data: { deliveryId: delivery.id, startedAt: at(20), durationMs: 10_000, error: "timeout" },
    });
    await db.attempt.create({
      data: {
        deliveryId: delivery.id,
        startedAt: at(10),
        durationMs: 5,
        httpStatus: 503,
        responseSnippet: "unavailable",
      },
    });

    const response = await get(app, `/panel/events/${event.id}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: event.id,
      eventType: "invoice.paid",
      headers: { "content-type": "application/json" },
      body: { size: 13, text: '{"amount":10}', truncated: false },
      deliveries: [
        {
          id: delivery.id,
          status: "dead",
          destination: {
            id: destination.id,
            displayUrl: "https://hooks.example.com/webhook/…",
          },
          sequences: [
            {
              number: 1,
              resentAt: null,
              attempts: [
                { httpStatus: 503, responseSnippet: "unavailable", error: null },
                { httpStatus: null, durationMs: 10_000, error: "timeout" },
              ],
            },
          ],
        },
      ],
    });
    for (const secret of ["3f1c2d4e", "key=abc", "stored-secret-marker", "lockedUntil"]) {
      expect(response.body).not.toContain(secret);
    }
  });

  it("says the body is binary instead of sending it", async () => {
    const { app, endpointId } = await createScenario();
    const event = await createEvent(endpointId, { body: Buffer.from([0xff, 0x00]) });

    const response = await get(app, `/panel/events/${event.id}`);

    expect(response.json<{ body: unknown }>().body).toEqual({
      size: 2,
      text: null,
      truncated: false,
    });
  });

  it("answers 404 for an event of another endpoint, an unknown id and an id that is not a uuid", async () => {
    const { app } = await createScenario();
    const other = await createScenario();
    const foreignEvent = await createEvent(other.endpointId);

    for (const eventId of [foreignEvent.id, randomUUID(), "abc"]) {
      const response = await get(app, `/panel/events/${eventId}`);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "event_not_found" });
    }
  });
});

describe("GET /panel/dead-deliveries", () => {
  it("lists only the dead deliveries of the demo endpoint, newest first, with the last attempt and a hidden URL", async () => {
    const { app, endpointId } = await createScenario();
    const other = await createScenario();
    const destination = await createDestination(endpointId);
    const otherDestination = await createDestination(other.endpointId);
    const dead = [];
    for (const second of [1, 2, 3]) {
      const event = await createEvent(endpointId, { eventType: "invoice.paid" });
      dead.push(await createDelivery(event.id, destination.id, "dead", at(second)));
    }
    await createDelivery((await createEvent(endpointId)).id, destination.id, "pending");
    await createDelivery((await createEvent(other.endpointId)).id, otherDestination.id, "dead");
    await db.attempt.create({
      data: { deliveryId: dead[2]?.id ?? "", startedAt: at(30), durationMs: 7, httpStatus: 500 },
    });

    const first = await get(app, "/panel/dead-deliveries?limit=2");
    const firstBody = first.json<DeadBody>();
    const second = await get(
      app,
      `/panel/dead-deliveries?limit=2&cursor=${firstBody.nextCursor ?? ""}`,
    );
    const secondBody = second.json<DeadBody>();

    expect(first.statusCode).toBe(200);
    expect(firstBody.deliveries).toMatchObject([
      {
        id: dead[2]?.id,
        eventType: "invoice.paid",
        destination: { displayUrl: "https://hooks.example.com/webhook/…" },
        lastAttempt: { durationMs: 7, httpStatus: 500 },
      },
      { id: dead[1]?.id, lastAttempt: null },
    ]);
    expect(secondBody.deliveries.map((delivery) => delivery.id)).toEqual([dead[0]?.id]);
    expect(secondBody.nextCursor).toBeNull();
    expect(first.body).not.toContain("key=abc");
  });

  it.each([
    ["a bad cursor", "cursor=garbage", "invalid_cursor"],
    ["a limit of zero", "limit=0", "invalid_query"],
  ])("answers 400 for %s", async (_name, query, error) => {
    const { app } = await createScenario();

    const response = await get(app, `/panel/dead-deliveries?${query}`);

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe(error);
  });
});

describe("GET /panel/destinations", () => {
  it("reports the circuit, and the end of the pause only while it is open", async () => {
    const { app, endpointId } = await createScenario();
    const closed = await createDestination(endpointId, "https://closed.example.com/hook");
    const open = await createDestination(endpointId, "https://open.example.com/hook");
    const probing = await createDestination(endpointId, "https://probing.example.com/hook");
    await db.destination.update({
      where: { id: open.id },
      data: { circuitState: "open", consecutiveFailures: 5, circuitOpenedAt: at(40) },
    });
    await db.destination.update({
      where: { id: probing.id },
      data: { circuitState: "half_open", consecutiveFailures: 5, circuitOpenedAt: at(50) },
    });

    const response = await get(app, "/panel/destinations");

    const byId = new Map(
      response
        .json<{ destinations: { id: string; circuit: unknown }[] }>()
        .destinations.map((destination) => [destination.id, destination.circuit]),
    );
    expect(response.statusCode).toBe(200);
    expect(byId.get(closed.id)).toEqual({
      state: "closed",
      consecutiveFailures: 0,
      since: null,
      pausedUntil: null,
    });
    expect(byId.get(open.id)).toEqual({
      state: "open",
      consecutiveFailures: 5,
      since: at(40).toISOString(),
      pausedUntil: new Date(at(40).getTime() + CIRCUIT_OPEN_SECONDS * 1000).toISOString(),
    });
    expect(byId.get(probing.id)).toEqual({
      state: "half_open",
      consecutiveFailures: 5,
      since: at(50).toISOString(),
      pausedUntil: null,
    });
  });

  it("says how many failures in a row open the circuit, so the screen does not guess", async () => {
    const { app } = await createScenario();

    const response = await get(app, "/panel/destinations");

    expect(response.json<{ failureThreshold: number }>().failureThreshold).toBe(
      CIRCUIT_FAILURE_THRESHOLD,
    );
  });

  it("shows the deliveries by status, hides the real URL and never exposes the secret", async () => {
    const { app, endpointId } = await createScenario();
    const destination = await createDestination(endpointId);
    await createDelivery((await createEvent(endpointId)).id, destination.id, "pending");
    for (let count = 0; count < 2; count++) {
      await createDelivery((await createEvent(endpointId)).id, destination.id, "dead");
    }

    const response = await get(app, "/panel/destinations");

    expect(response.json()).toMatchObject({
      destinations: [
        {
          displayUrl: "https://hooks.example.com/webhook/…",
          isActive: true,
          eventTypes: ["*"],
          deliveries: { pending: 1, in_progress: 0, succeeded: 0, dead: 2 },
        },
      ],
    });
    for (const secret of ["3f1c2d4e", "key=abc", "stored-secret-marker"]) {
      expect(response.body).not.toContain(secret);
    }
  });
});

describe("attempt sequences in GET /panel/events/:eventId", () => {
  it("splits the attempts where each resend happened", async () => {
    const { app, endpointId } = await createScenario();
    const { event, delivery } = await createDeadDelivery(endpointId, 3);
    await db.resend.create({
      data: { deliveryId: delivery.id, attemptsBefore: 3, requestedAt: at(40) },
    });
    await db.attempt.createMany({
      data: [50, 60].map((second) => ({
        deliveryId: delivery.id,
        startedAt: at(second),
        durationMs: 7,
        httpStatus: 200,
      })),
    });

    const response = await get(app, `/panel/events/${event.id}`);

    const sequences = response.json<{
      deliveries: {
        sequences: { number: number; resentAt: string | null; attempts: unknown[] }[];
      }[];
    }>().deliveries[0]?.sequences;
    expect(sequences?.map((sequence) => [sequence.number, sequence.resentAt])).toEqual([
      [1, null],
      [2, at(40).toISOString()],
    ]);
    expect(sequences?.map((sequence) => sequence.attempts.length)).toEqual([3, 2]);
  });
});

describe("POST /panel/deliveries/:deliveryId/resend", () => {
  it("puts a dead delivery back in the queue and the detail shows a new, empty sequence", async () => {
    const { app, endpointId } = await createScenario();
    const { event, delivery } = await createDeadDelivery(endpointId, 2);

    const response = await post(app, `/panel/deliveries/${delivery.id}/resend`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ resent: true });
    expect(response.headers["cache-control"]).toBe("no-store");
    const stored = await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(stored).toMatchObject({ status: "pending", attemptCount: 0 });
    const detail = (await get(app, `/panel/events/${event.id}`)).json<{
      deliveries: { status: string; sequences: { number: number; attempts: unknown[] }[] }[];
    }>();
    expect(detail.deliveries[0]?.status).toBe("pending");
    expect(detail.deliveries[0]?.sequences.map((sequence) => sequence.attempts.length)).toEqual([
      2, 0,
    ]);
  });

  it("answers 409 the second time, because the delivery is no longer dead", async () => {
    const { app, endpointId } = await createScenario();
    const { delivery } = await createDeadDelivery(endpointId, 1);
    await post(app, `/panel/deliveries/${delivery.id}/resend`);

    const second = await post(app, `/panel/deliveries/${delivery.id}/resend`);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "delivery_not_dead" });
    expect(await db.resend.count({ where: { deliveryId: delivery.id } })).toBe(1);
  });

  it("answers 409 when the destination was deactivated", async () => {
    const { app, endpointId } = await createScenario();
    const { delivery, destination } = await createDeadDelivery(endpointId, 1);
    await db.destination.update({ where: { id: destination.id }, data: { isActive: false } });

    const response = await post(app, `/panel/deliveries/${delivery.id}/resend`);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "destination_inactive" });
  });

  it("answers 404 for an unknown delivery, a delivery of another endpoint and an id that is not a uuid", async () => {
    const { app } = await createScenario();
    const other = await createScenario();
    const { delivery: foreign } = await createDeadDelivery(other.endpointId, 1);

    for (const deliveryId of [randomUUID(), foreign.id, "abc"]) {
      const response = await post(app, `/panel/deliveries/${deliveryId}/resend`);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "delivery_not_found" });
    }
    expect((await db.delivery.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
      "dead",
    );
  });
});

describe("POST /panel/dead-deliveries/resend", () => {
  it("resends the dead ones and says why it skipped the others", async () => {
    const { app, endpointId } = await createScenario();
    const { delivery: first } = await createDeadDelivery(endpointId, 2);
    const { delivery: second } = await createDeadDelivery(endpointId, 1);
    const destination = await createDestination(endpointId);
    const waiting = await createDelivery(
      (await createEvent(endpointId)).id,
      destination.id,
      "pending",
    );
    const unknown = randomUUID();

    const response = await post(app, "/panel/dead-deliveries/resend", {
      deliveryIds: [first.id, waiting.id, second.id, unknown],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      resent: [first.id, second.id],
      skipped: [
        { id: waiting.id, reason: "not_dead" },
        { id: unknown, reason: "not_found" },
      ],
    });
    expect(
      await db.delivery.count({ where: { id: { in: [first.id, second.id] }, status: "pending" } }),
    ).toBe(2);
  });

  it("accepts 100 ids and refuses 101", async () => {
    const { app } = await createScenario();
    const ids = (count: number) => Array.from({ length: count }, () => randomUUID());

    const accepted = await post(app, "/panel/dead-deliveries/resend", { deliveryIds: ids(100) });
    const refused = await post(app, "/panel/dead-deliveries/resend", { deliveryIds: ids(101) });

    expect(accepted.statusCode).toBe(200);
    expect(refused.statusCode).toBe(400);
  });

  it.each([
    ["no body at all", undefined],
    ["a body without the list", {}],
    ["an empty list", { deliveryIds: [] }],
    ["an id that is not a uuid", { deliveryIds: ["abc"] }],
    ["a list of numbers", { deliveryIds: [1, 2] }],
  ])("answers 400 for %s", async (_name, payload) => {
    const { app } = await createScenario();

    const response = await post(app, "/panel/dead-deliveries/resend", payload);

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string; fields: Record<string, string[]> }>()).toMatchObject({
      error: "invalid_body",
      fields: { deliveryIds: expect.any(Array) as string[] },
    });
  });
});

describe("when the demo endpoint does not exist", () => {
  it.each([
    "/panel/events",
    `/panel/events/${randomUUID()}`,
    "/panel/dead-deliveries",
    "/panel/destinations",
  ])("answers 404 for GET %s", async (url) => {
    const app = buildPanelApp(randomUUID());

    const response = await get(app, url);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "demo_endpoint_not_found" });
  });

  it.each([
    ["/panel/dead-deliveries/resend", { deliveryIds: [randomUUID()] }],
    [`/panel/deliveries/${randomUUID()}/resend`, undefined],
  ])("answers 404 for POST %s", async (url, payload) => {
    const app = buildPanelApp(randomUUID());

    const response = await post(app, url, payload);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "demo_endpoint_not_found" });
  });
});
