import { randomBytes, randomUUID } from "node:crypto";
import type { Db, DemoQuotaLimits } from "@relay/db";
import { startTestDatabase, type TestDatabase } from "@relay/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

type App = ReturnType<typeof buildApp>;
type TestEventBody = {
  eventId: string;
  quota: { ip: { used: number; limit: number }; global: { used: number; limit: number } };
};

let testDatabase: TestDatabase;
let db: Db;
const apps: App[] = [];

const salt = "test-salt-with-enough-characters";
const panelOrigin = "http://localhost:3100";

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await testDatabase.stop();
});

let addressNumber = 0;
function freshAddress() {
  addressNumber += 1;
  return `203.0.113.${String(addressNumber)}`;
}

async function createScenario(
  options: { trustProxy?: string[] | false; limits?: DemoQuotaLimits } = {},
) {
  const slug = randomUUID();
  const endpoint = await db.endpoint.create({
    data: { slug, name: slug, signatureScheme: "none" },
  });
  const app = buildApp({
    db,
    encryptionKey: randomBytes(32),
    demoEndpointSlug: slug,
    demoQuotaSalt: salt,
    panelOrigin,
    ...(options.limits ? { demoQuotaLimits: options.limits } : {}),
    ...(options.trustProxy !== undefined ? { trustProxy: options.trustProxy } : {}),
    version: "test",
    commit: "test",
    logLevel: "silent",
  });
  apps.push(app);
  return { app, endpointId: endpoint.id, slug };
}

function clickFrom(app: App, remoteAddress: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/panel/test-event", remoteAddress, headers });
}

async function globalUsed() {
  const rows = await db.demoQuota.findMany({ where: { kind: "global" } });
  return rows.reduce((total, row) => total + row.count, 0);
}

async function demoEvents(endpointId: string) {
  return db.event.findMany({ where: { endpointId, eventType: "demo.test" } });
}

describe("POST /panel/test-event, the event", () => {
  it("saves a demo.test event on the demo endpoint and answers 201 with its id and the quota", async () => {
    const { app, endpointId } = await createScenario();

    const response = await clickFrom(app, freshAddress());

    expect(response.statusCode).toBe(201);
    const body = response.json<TestEventBody>();
    const events = await demoEvents(endpointId);
    expect(events.map((event) => event.id)).toEqual([body.eventId]);
    expect(body.quota.ip).toMatchObject({ used: 1, limit: 5 });
    expect(body.quota.global).toMatchObject({ limit: 200 });
  });

  it("puts a JSON body in the event that says it is a demonstration", async () => {
    const { app, endpointId } = await createScenario();

    await clickFrom(app, freshAddress());

    const [event] = await demoEvents(endpointId);
    const body = JSON.parse(Buffer.from(event?.body ?? []).toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual(["demo", "sentAt"]);
    expect(body.demo).toBe(true);
    expect(typeof body.sentAt).toBe("string");
    expect(Number.isNaN(Date.parse(String(body.sentAt)))).toBe(false);
  });

  it("makes a new event on every click, each with its own idempotency key", async () => {
    const { app, endpointId } = await createScenario();
    const address = freshAddress();

    await clickFrom(app, address);
    await clickFrom(app, address);

    const events = await demoEvents(endpointId);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.idempotencyKey)).size).toBe(2);
    for (const event of events) expect(event.idempotencyKey).toMatch(/^demo-test-[0-9a-f-]{36}$/);
  });

  it("creates a delivery for each active destination subscribed to it, and for no other", async () => {
    const { app, endpointId } = await createScenario();
    const make = (url: string, eventTypes: string[], isActive = true) =>
      db.destination.create({
        data: { endpointId, url, secretEncrypted: "x", eventTypes, isActive },
      });
    const all = await make("https://all.example.com/hook", ["*"]);
    const exact = await make("https://exact.example.com/hook", ["demo.test"]);
    await make("https://other.example.com/hook", ["push"]);
    await make("https://off.example.com/hook", ["*"], false);

    const response = await clickFrom(app, freshAddress());

    const deliveries = await db.delivery.findMany({
      where: { eventId: response.json<TestEventBody>().eventId },
    });
    expect(deliveries.map((delivery) => delivery.destinationId).sort()).toEqual(
      [all.id, exact.id].sort(),
    );
  });
});

describe("POST /panel/test-event, the quota", () => {
  it("counts the clicks of a visitor and refuses the sixth with 429, the scope and when to come back", async () => {
    const { app, endpointId } = await createScenario();
    const address = freshAddress();
    for (let click = 1; click <= 5; click++) {
      const response = await clickFrom(app, address);
      expect(response.json<TestEventBody>().quota.ip.used).toBe(click);
    }

    const sixth = await clickFrom(app, address);

    expect(sixth.statusCode).toBe(429);
    const body = sixth.json<{ error: string; scope: string; limit: number; retryAt: string }>();
    expect(body).toMatchObject({ error: "quota_exceeded", scope: "ip", limit: 5 });
    const waitMs = new Date(body.retryAt).getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(0);
    expect(waitMs).toBeLessThanOrEqual(3_600_000);
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(sixth.headers["retry-after"])).toBeLessThanOrEqual(3600);
    expect(await demoEvents(endpointId)).toHaveLength(5);
  });

  it("keeps one counter per visitor", async () => {
    const { app } = await createScenario();
    const first = freshAddress();
    for (let click = 1; click <= 5; click++) await clickFrom(app, first);

    const other = await clickFrom(app, freshAddress());

    expect(other.statusCode).toBe(201);
    expect(other.json<TestEventBody>().quota.ip.used).toBe(1);
  });

  it("refuses by the global limit for everyone and creates no event", async () => {
    const used = await globalUsed();
    const { app, endpointId } = await createScenario({ limits: { ip: 5, global: used + 2 } });
    await clickFrom(app, freshAddress());
    await clickFrom(app, freshAddress());

    const third = await clickFrom(app, freshAddress());

    expect(third.statusCode).toBe(429);
    expect(third.json<{ scope: string; limit: number }>()).toMatchObject({
      scope: "global",
      limit: used + 2,
    });
    expect(await demoEvents(endpointId)).toHaveLength(2);
  });

  it("keeps in the database only a hash of the address, never the address", async () => {
    const { app } = await createScenario();
    const address = freshAddress();

    await clickFrom(app, address);

    const rows = await db.demoQuota.findMany({ where: { kind: "ip" } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.key).toMatch(/^[0-9a-f]{64}$/);
      expect(row.key).not.toContain(address);
    }
  });

  it("counts an IPv4 address and the same address written inside IPv6 as one visitor", async () => {
    const { app } = await createScenario();
    const address = freshAddress();
    for (let click = 1; click <= 5; click++) await clickFrom(app, address);

    const mapped = await clickFrom(app, `::ffff:${address}`);

    expect(mapped.statusCode).toBe(429);
  });

  it("counts every address of the same /64 block as one visitor", async () => {
    const { app } = await createScenario();
    const block = `2001:db8:${(addressNumber + 1000).toString(16)}:1`;
    for (let click = 1; click <= 5; click++) {
      await clickFrom(app, `${block}::${click.toString(16)}`);
    }

    const sixth = await clickFrom(app, `${block}:ffff:ffff:ffff:ffff`);

    expect(sixth.statusCode).toBe(429);
  });
});

describe("POST /panel/test-event, which address is the visitor's", () => {
  it("ignores X-Forwarded-For when no proxy is trusted, so it cannot be used to dodge the limit", async () => {
    const { app } = await createScenario();
    const address = freshAddress();
    for (let click = 1; click <= 5; click++) {
      await clickFrom(app, address, { "x-forwarded-for": `198.51.100.${String(click)}` });
    }

    const sixth = await clickFrom(app, address, { "x-forwarded-for": "198.51.100.99" });

    expect(sixth.statusCode).toBe(429);
  });

  it("takes the address from X-Forwarded-For when the connection comes from a trusted proxy", async () => {
    const { app } = await createScenario({ trustProxy: ["10.0.0.1"] });
    const visitorA = freshAddress();
    const visitorB = freshAddress();
    for (let click = 1; click <= 5; click++) {
      await clickFrom(app, "10.0.0.1", { "x-forwarded-for": visitorA });
    }

    const blocked = await clickFrom(app, "10.0.0.1", { "x-forwarded-for": visitorA });
    const other = await clickFrom(app, "10.0.0.1", { "x-forwarded-for": visitorB });

    expect(blocked.statusCode).toBe(429);
    expect(other.statusCode).toBe(201);
  });

  it("does not let the caller choose: the address the trusted proxy added wins over the ones before it", async () => {
    const { app } = await createScenario({ trustProxy: ["10.0.0.1"] });
    const real = freshAddress();
    for (let click = 1; click <= 5; click++) {
      await clickFrom(app, "10.0.0.1", {
        "x-forwarded-for": `192.0.2.${String(click)}, ${real}`,
      });
    }

    const sixth = await clickFrom(app, "10.0.0.1", { "x-forwarded-for": `192.0.2.200, ${real}` });

    expect(sixth.statusCode).toBe(429);
  });

  it("ignores X-Forwarded-For from a connection that is not a trusted proxy", async () => {
    const { app } = await createScenario({ trustProxy: ["10.0.0.1"] });
    const direct = freshAddress();
    for (let click = 1; click <= 5; click++) {
      await clickFrom(app, direct, { "x-forwarded-for": `192.0.2.${String(click)}` });
    }

    const sixth = await clickFrom(app, direct, { "x-forwarded-for": "192.0.2.200" });

    expect(sixth.statusCode).toBe(429);
  });

  it("trusts a whole range and the private-network name, and nothing outside them", async () => {
    const { app } = await createScenario({ trustProxy: ["172.16.0.0/12", "uniquelocal"] });
    const visitor = freshAddress();
    for (let click = 1; click <= 5; click++) {
      await clickFrom(app, "172.20.1.1", { "x-forwarded-for": visitor });
    }

    const viaRange = await clickFrom(app, "172.31.255.1", { "x-forwarded-for": visitor });
    const viaName = await clickFrom(app, "10.9.8.7", { "x-forwarded-for": visitor });
    const outside = await clickFrom(app, "172.32.0.1", { "x-forwarded-for": visitor });

    expect(viaRange.statusCode).toBe(429);
    expect(viaName.statusCode).toBe(429);
    expect(outside.statusCode).toBe(201);
  });
});

describe("POST /panel/test-event, the panel and the demo endpoint", () => {
  it("lets only the panel origin read the answer, on success and on refusal", async () => {
    const { app } = await createScenario({ limits: { ip: 1, global: 200 } });
    const address = freshAddress();

    const created = await clickFrom(app, address);
    const refused = await clickFrom(app, address);

    for (const response of [created, refused]) {
      expect(response.headers["access-control-allow-origin"]).toBe(panelOrigin);
      expect(String(response.headers.vary).toLowerCase()).toContain("origin");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("does not open the read routes of the panel to other origins", async () => {
    const { app } = await createScenario();

    const response = await app.inject({ method: "GET", url: "/panel/events" });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers 404 when the demo endpoint does not exist, with the origin header and without spending quota", async () => {
    const { app, slug } = await createScenario();
    await db.endpoint.delete({ where: { slug } });
    const before = await globalUsed();

    const response = await clickFrom(app, freshAddress());

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "demo_endpoint_not_found" });
    expect(response.headers["access-control-allow-origin"]).toBe(panelOrigin);
    expect(await globalUsed()).toBe(before);
  });
});
