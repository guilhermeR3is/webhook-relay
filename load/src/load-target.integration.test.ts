import { decryptSecret, ingestEvent, type Db } from "@relay/db";
import { startTestDatabase, testEncryptionKey, type TestDatabase } from "@relay/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLoadTarget, LOAD_ENDPOINT_SLUG, removeLoadTarget } from "./load-target.ts";

let testDatabase: TestDatabase;
let db: Db;

const options = { encryptionKey: testEncryptionKey, destinationUrl: "http://receiver:4000/hook" };

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

beforeEach(async () => {
  await db.event.deleteMany();
  await db.destination.deleteMany();
  await db.endpoint.deleteMany();
});

afterAll(async () => {
  await testDatabase.stop();
});

async function receiveLoadEvent(bodyText: string) {
  const endpoint = await db.endpoint.findUniqueOrThrow({ where: { slug: LOAD_ENDPOINT_SLUG } });
  return ingestEvent(db, {
    endpointId: endpoint.id,
    idempotencyKey: bodyText,
    eventType: "load.test",
    headers: {},
    body: Buffer.from(bodyText),
  });
}

describe("createLoadTarget", () => {
  it("creates an unsigned endpoint and one destination that takes every event type", async () => {
    await createLoadTarget(db, options);

    expect(await db.endpoint.findMany()).toMatchObject([
      { slug: LOAD_ENDPOINT_SLUG, signatureScheme: "none", secretEncrypted: null },
    ]);
    const [destination] = await db.destination.findMany();
    expect(destination).toMatchObject({
      url: "http://receiver:4000/hook",
      eventTypes: ["*"],
      isActive: true,
      circuitState: "closed",
    });
    expect(decryptSecret(destination?.secretEncrypted ?? "", testEncryptionKey)).toMatch(
      /^whsec_[A-Za-z0-9+/]{43}=$/,
    );
  });

  it("makes each event of the endpoint produce a delivery to the destination", async () => {
    await createLoadTarget(db, options);

    await receiveLoadEvent("one");

    expect(await db.delivery.count({ where: { status: "pending" } })).toBe(1);
  });

  it("can run again without duplicating anything, keeping the secret and the ids", async () => {
    const first = await createLoadTarget(db, options);
    const secretBefore = (
      await db.destination.findUniqueOrThrow({ where: { id: first.destinationId } })
    ).secretEncrypted;

    const second = await createLoadTarget(db, options);

    expect(second).toEqual(first);
    expect(await db.endpoint.count()).toBe(1);
    expect(await db.destination.count()).toBe(1);
    expect(
      (await db.destination.findUniqueOrThrow({ where: { id: second.destinationId } }))
        .secretEncrypted,
    ).toBe(secretBefore);
  });

  it("starts each round from the same state: right url, active and with the circuit closed", async () => {
    const { destinationId } = await createLoadTarget(db, options);
    await db.destination.update({
      where: { id: destinationId },
      data: {
        url: "http://old:1/hook",
        isActive: false,
        circuitState: "open",
        consecutiveFailures: 7,
        circuitOpenedAt: new Date(),
      },
    });

    await createLoadTarget(db, options);

    expect(await db.destination.findUniqueOrThrow({ where: { id: destinationId } })).toMatchObject({
      url: "http://receiver:4000/hook",
      isActive: true,
      circuitState: "closed",
      consecutiveFailures: 0,
      circuitOpenedAt: null,
    });
  });
});

describe("removeLoadTarget", () => {
  it("removes the endpoint, its destination, events, deliveries and attempts, and nothing else", async () => {
    await createLoadTarget(db, options);
    await receiveLoadEvent("one");
    await receiveLoadEvent("two");
    const other = await db.endpoint.create({
      data: { slug: "other", name: "other", signatureScheme: "none" },
    });
    await db.event.create({
      data: {
        endpointId: other.id,
        idempotencyKey: "k",
        eventType: "x",
        headers: {},
        body: Buffer.from("x"),
      },
    });

    const removed = await removeLoadTarget(db);

    expect(removed).toEqual({ events: 2 });
    expect(await db.endpoint.findMany({ select: { slug: true } })).toEqual([{ slug: "other" }]);
    expect(await db.event.count()).toBe(1);
    expect(await db.destination.count()).toBe(0);
    expect(await db.delivery.count()).toBe(0);
  });

  it("does nothing when there is nothing to remove", async () => {
    expect(await removeLoadTarget(db)).toEqual({ events: 0 });
  });
});
