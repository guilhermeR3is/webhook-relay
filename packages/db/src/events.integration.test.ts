import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import { ingestEvent, saveEvent, type NewEvent } from "./events.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let db: Db;
let endpointId: string;

function newEvent(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    endpointId,
    idempotencyKey: "key-1",
    eventType: "push",
    headers: { "content-type": "application/json" },
    body: Buffer.from('{"ok":true}'),
    ...overrides,
  };
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
  const endpoint = await db.endpoint.create({
    data: { slug: "github-main", name: "GitHub", signatureScheme: "none" },
  });
  endpointId = endpoint.id;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

describe("saveEvent", () => {
  it("stores a new event and keeps the body byte for byte", async () => {
    const body = Buffer.from([0xff, 0x00, 0xfe, 0x80, 0x0a, 0x7b]);

    const saved = await saveEvent(db, newEvent({ idempotencyKey: "binary", body }));

    expect(saved.created).toBe(true);
    const row = await db.event.findUniqueOrThrow({ where: { id: saved.id } });
    expect(Buffer.compare(row.body, body)).toBe(0);
    expect(row.headers).toEqual({ "content-type": "application/json" });
    expect(row.eventType).toBe("push");
  });

  it("returns the original id and keeps the original event when the key repeats", async () => {
    const first = await saveEvent(db, newEvent({ idempotencyKey: "repeat" }));
    const second = await saveEvent(
      db,
      newEvent({ idempotencyKey: "repeat", body: Buffer.from("different"), eventType: "other" }),
    );

    expect(second).toEqual({ id: first.id, created: false });
    const rows = await db.event.findMany({ where: { endpointId, idempotencyKey: "repeat" } });
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]?.body ?? []).toString()).toBe('{"ok":true}');
    expect(rows[0]?.eventType).toBe("push");
  });

  it("treats the same key on another endpoint as a different event", async () => {
    const other = await db.endpoint.create({
      data: { slug: "other", name: "Other", signatureScheme: "none" },
    });

    const first = await saveEvent(db, newEvent({ idempotencyKey: "shared" }));
    const second = await saveEvent(
      db,
      newEvent({ idempotencyKey: "shared", endpointId: other.id }),
    );

    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  it("creates exactly one event when 20 requests with the same key arrive at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => saveEvent(db, newEvent({ idempotencyKey: "race" }))),
    );

    expect(results.filter((saved) => saved.created)).toHaveLength(1);
    expect(new Set(results.map((saved) => saved.id)).size).toBe(1);
    const rows = await db.event.findMany({ where: { endpointId, idempotencyKey: "race" } });
    expect(rows).toHaveLength(1);
  });
});

async function createEndpoint(slug: string) {
  const endpoint = await db.endpoint.create({
    data: { slug, name: slug, signatureScheme: "none" },
  });
  return endpoint.id;
}

function createDestination(
  destinationEndpointId: string,
  overrides: { eventTypes?: string[]; isActive?: boolean } = {},
) {
  return db.destination.create({
    data: {
      endpointId: destinationEndpointId,
      url: "http://localhost:9999/hook",
      secretEncrypted: "x",
      eventTypes: ["push"],
      ...overrides,
    },
  });
}

async function deliveredDestinationIds(eventId: string) {
  const deliveries = await db.delivery.findMany({
    where: { eventId },
    select: { destinationId: true },
  });
  return deliveries.map((delivery) => delivery.destinationId).sort();
}

describe("ingestEvent", () => {
  it("creates one delivery for each active destination subscribed to the event type", async () => {
    const fanoutEndpointId = await createEndpoint("fanout");
    const exact = await createDestination(fanoutEndpointId, { eventTypes: ["push"] });
    const wildcard = await createDestination(fanoutEndpointId, { eventTypes: ["*"] });
    await createDestination(fanoutEndpointId, { eventTypes: ["issues"] });
    await createDestination(fanoutEndpointId, { eventTypes: [] });
    await createDestination(fanoutEndpointId, { isActive: false });
    await createDestination(await createEndpoint("fanout-other"));

    const saved = await ingestEvent(db, newEvent({ endpointId: fanoutEndpointId }));

    expect(saved.created).toBe(true);
    expect(await deliveredDestinationIds(saved.id)).toEqual([exact.id, wildcard.id].sort());
  });

  it("saves the event with no deliveries when no destination matches", async () => {
    const lonelyEndpointId = await createEndpoint("lonely");

    const saved = await ingestEvent(db, newEvent({ endpointId: lonelyEndpointId }));

    expect(saved.created).toBe(true);
    expect(await db.delivery.count({ where: { eventId: saved.id } })).toBe(0);
  });

  it("does not create deliveries again when the event repeats", async () => {
    const repeatEndpointId = await createEndpoint("repeat");
    await createDestination(repeatEndpointId);
    const first = await ingestEvent(db, newEvent({ endpointId: repeatEndpointId }));
    await createDestination(repeatEndpointId);

    const second = await ingestEvent(db, newEvent({ endpointId: repeatEndpointId }));

    expect(second).toEqual({ id: first.id, created: false });
    expect(await db.delivery.count({ where: { eventId: first.id } })).toBe(1);
  });

  it("keeps no event when creating its deliveries fails", async () => {
    const failingEndpointId = await createEndpoint("failing");
    await createDestination(failingEndpointId);
    await db.$executeRawUnsafe(`
      CREATE FUNCTION reject_delivery() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'delivery rejected'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_delivery BEFORE INSERT ON delivery
        FOR EACH ROW EXECUTE FUNCTION reject_delivery();
    `);

    try {
      await expect(ingestEvent(db, newEvent({ endpointId: failingEndpointId }))).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`
        DROP TRIGGER reject_delivery ON delivery;
        DROP FUNCTION reject_delivery();
      `);
    }

    expect(await db.event.count({ where: { endpointId: failingEndpointId } })).toBe(0);
  });

  it("creates one delivery per destination when 10 requests with the same key arrive at once", async () => {
    const raceEndpointId = await createEndpoint("race");
    await createDestination(raceEndpointId);
    await createDestination(raceEndpointId);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => ingestEvent(db, newEvent({ endpointId: raceEndpointId }))),
    );

    expect(results.filter((saved) => saved.created)).toHaveLength(1);
    const eventId = results[0]?.id ?? "";
    expect(await db.delivery.count({ where: { eventId } })).toBe(2);
  });
});

describe("event listing index", () => {
  it("serves the newest-first order of the event list without sorting", async () => {
    const listingEndpointId = await createEndpoint("listing");
    await db.event.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        endpointId: listingEndpointId,
        idempotencyKey: `listing-${String(index)}`,
        eventType: "push",
        headers: {},
        body: Buffer.from("{}"),
        receivedAt: new Date(Date.UTC(2026, 9, 3, 12, 0, index % 20)),
      })),
    });

    const plan = await db.$transaction(async (tx) => {
      // com só 60 linhas o planejador prefere varrer a tabela, e o teste não provaria nada
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
      const rows = await tx.$queryRaw<{ "QUERY PLAN": string }[]>`
        EXPLAIN SELECT id FROM event
        WHERE endpoint_id = ${listingEndpointId}::uuid
        ORDER BY received_at DESC, id DESC LIMIT 20`;
      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    });

    expect(plan).toContain("event_endpoint_id_received_at_id_idx");
    expect(plan).not.toContain("Sort");
  });
});
