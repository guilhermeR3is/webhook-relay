import { createHmac } from "node:crypto";
import { decryptSecret, ingestEvent, type Db } from "@relay/db";
import { startTestDatabase, testEncryptionKey, type TestDatabase } from "@relay/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { seedDemo } from "./demo-seed.js";

let testDatabase: TestDatabase;
let db: Db;

const seed = () =>
  seedDemo(db, {
    slug: "demo",
    publicApiUrl: "http://localhost:3000/",
    encryptionKey: testEncryptionKey,
  });

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

describe("seedDemo", () => {
  it("creates the signed demo endpoint and the flaky destination subscribed to demo.test", async () => {
    const seeded = await seed();

    const endpoint = await db.endpoint.findUniqueOrThrow({
      where: { slug: "demo" },
      include: { destinations: true },
    });
    expect(endpoint.id).toBe(seeded.endpointId);
    expect(endpoint.signatureScheme).toBe("generic_hmac");
    expect(decryptSecret(endpoint.secretEncrypted ?? "", testEncryptionKey)).toBe(
      seeded.endpointSecret,
    );
    expect(endpoint.destinations).toHaveLength(1);
    const [flaky] = endpoint.destinations;
    expect(flaky?.url).toBe("http://localhost:3000/demo/flaky");
    expect(flaky?.eventTypes).toEqual(["demo.test"]);
    expect(flaky?.isActive).toBe(true);
    expect(flaky?.circuitState).toBe("closed");
    const destinationSecret = decryptSecret(flaky?.secretEncrypted ?? "", testEncryptionKey);
    expect(destinationSecret.startsWith("whsec_")).toBe(true);
    expect(Buffer.from(destinationSecret.slice("whsec_".length), "base64")).toHaveLength(32);
  });

  it("returns a secret that the real ingest route accepts and refuses unsigned calls", async () => {
    const seeded = await seed();
    const app = buildApp({
      db,
      encryptionKey: testEncryptionKey,
      demoEndpointSlug: "demo",
      demoQuotaSalt: "test-salt-with-enough-characters",
      panelOrigin: "http://localhost:3100",
      version: "test",
      commit: "test",
      logLevel: "silent",
    });
    const body = '{"from":"the owner"}';
    const signature = `sha256=${createHmac("sha256", seeded.endpointSecret).update(body).digest("hex")}`;

    const unsigned = await app.inject({ method: "POST", url: "/in/demo", payload: body });
    const signed = await app.inject({
      method: "POST",
      url: "/in/demo",
      headers: { "x-signature-256": signature },
      payload: body,
    });
    await app.close();

    expect(unsigned.statusCode).toBe(401);
    expect(signed.statusCode).toBe(202);
  });

  it("gives a demo.test event a delivery to the flaky destination", async () => {
    const seeded = await seed();

    const event = await ingestEvent(db, {
      endpointId: seeded.endpointId,
      idempotencyKey: "after-seed",
      eventType: "demo.test",
      headers: {},
      body: Buffer.from("{}"),
    });

    const deliveries = await db.delivery.findMany({
      where: { eventId: event.id },
      include: { destination: true },
    });
    expect(deliveries.map((delivery) => delivery.destination.url)).toEqual([
      "http://localhost:3000/demo/flaky",
    ]);
  });

  it("wipes the old demo data and rotates the secret when run again, leaving other endpoints alone", async () => {
    const first = await seed();
    const oldEvent = await ingestEvent(db, {
      endpointId: first.endpointId,
      idempotencyKey: "old-event",
      eventType: "demo.test",
      headers: {},
      body: Buffer.from("{}"),
    });
    const oldDelivery = await db.delivery.findFirstOrThrow({ where: { eventId: oldEvent.id } });
    await db.attempt.create({
      data: { deliveryId: oldDelivery.id, startedAt: new Date(), durationMs: 12, httpStatus: 503 },
    });
    await db.demoQuota.create({
      data: { kind: "global", key: "all", windowStart: new Date(), count: 3 },
    });
    const other = await db.endpoint.create({
      data: { slug: "someone-else", name: "Someone else", signatureScheme: "none" },
    });
    await db.destination.create({
      data: {
        endpointId: other.id,
        url: "https://example.com/hook",
        secretEncrypted: "unused",
        eventTypes: ["*"],
      },
    });
    await ingestEvent(db, {
      endpointId: other.id,
      idempotencyKey: "keep-me",
      eventType: "push",
      headers: {},
      body: Buffer.from("{}"),
    });

    const second = await seed();

    expect(second.endpointId).not.toBe(first.endpointId);
    expect(second.endpointSecret).not.toBe(first.endpointSecret);
    expect(await db.endpoint.count({ where: { slug: "demo" } })).toBe(1);
    expect(await db.event.count({ where: { endpointId: first.endpointId } })).toBe(0);
    expect(await db.delivery.count({ where: { id: oldDelivery.id } })).toBe(0);
    expect(await db.attempt.count({ where: { deliveryId: oldDelivery.id } })).toBe(0);
    expect(await db.destination.count({ where: { endpointId: first.endpointId } })).toBe(0);
    expect(await db.demoQuota.count()).toBe(0);
    expect(await db.event.count({ where: { endpointId: other.id } })).toBe(1);
    expect(await db.destination.count({ where: { endpointId: other.id } })).toBe(1);
  });
});
