import { createHmac, randomBytes } from "node:crypto";
import { encryptSecret, type Db, type SignatureScheme } from "@relay/db";
import { startTestDatabase, type TestDatabase } from "@relay/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

const encryptionKey = randomBytes(32);
const secret = "whsec_test";

let testDatabase: TestDatabase;
let db: Db;
let app: ReturnType<typeof buildApp>;

function createEndpoint(slug: string, signatureScheme: SignatureScheme, withSecret = true) {
  return db.endpoint.create({
    data: {
      slug,
      name: slug,
      signatureScheme,
      secretEncrypted: withSecret ? encryptSecret(secret, encryptionKey) : null,
    },
  });
}

function sign(body: Buffer | string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function post(slug: string, body: Buffer | string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: `/in/${slug}`,
    headers: { "content-type": "application/json", ...headers },
    payload: body,
  });
}

function countEvents(slug: string) {
  return db.event.count({ where: { endpoint: { slug } } });
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
  app = buildApp({
    db,
    encryptionKey,
    demoEndpointSlug: "demo",
    demoQuotaSalt: "test-salt-with-enough-characters",
    panelOrigin: "http://localhost:3100",
    version: "test",
    commit: "test",
    logLevel: "silent",
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  await testDatabase.stop();
});

describe("POST /in/:slug without signature", () => {
  it("answers 202 with the event id and stores the body and the allowed headers", async () => {
    await createEndpoint("open", "none", false);

    const response = await post("open", '{"hello":"world"}', {
      "x-event-type": "greeting",
      authorization: "Bearer should-not-be-stored",
    });

    expect(response.statusCode).toBe(202);
    const stored = await db.event.findUniqueOrThrow({
      where: { id: response.json<{ id: string }>().id },
    });
    expect(Buffer.from(stored.body).toString()).toBe('{"hello":"world"}');
    expect(stored.eventType).toBe("greeting");
    expect(stored.headers).toEqual({
      "content-type": "application/json",
      "user-agent": "lightMyRequest",
      "x-event-type": "greeting",
    });
  });

  it("answers 200 with the original id and does not duplicate when the body repeats", async () => {
    await createEndpoint("repeat", "none", false);

    const first = await post("repeat", '{"n":1}');
    const second = await post("repeat", '{"n":1}');

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await countEvents("repeat")).toBe(1);
  });

  it("creates a delivery for the subscribed destination only on the first request", async () => {
    const endpoint = await createEndpoint("with-destination", "none", false);
    await db.destination.create({
      data: {
        endpointId: endpoint.id,
        url: "http://localhost:9999/hook",
        secretEncrypted: encryptSecret(secret, encryptionKey),
        eventTypes: ["greeting"],
      },
    });
    const headers = { "x-event-type": "greeting" };

    const first = await post("with-destination", '{"n":1}', headers);
    await post("with-destination", '{"n":1}', headers);

    const deliveries = await db.delivery.findMany({
      where: { event: { endpointId: endpoint.id } },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.eventId).toBe(first.json<{ id: string }>().id);
  });

  it("treats the same Idempotency-Key as the same event even if the body changes", async () => {
    await createEndpoint("keyed", "none", false);

    const first = await post("keyed", '{"n":1}', { "idempotency-key": "order-42" });
    const second = await post("keyed", '{"n":2}', { "idempotency-key": "order-42" });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it("accepts a body without content-type or content", async () => {
    await createEndpoint("bare", "none", false);

    const response = await app.inject({ method: "POST", url: "/in/bare" });

    expect(response.statusCode).toBe(202);
    const stored = await db.event.findUniqueOrThrow({
      where: { id: response.json<{ id: string }>().id },
    });
    expect(stored.body).toHaveLength(0);
  });

  it("accepts a body of exactly 1 MiB and rejects one byte more with 413", async () => {
    await createEndpoint("limit", "none", false);
    const limit = 1024 * 1024;

    const atLimit = await post("limit", Buffer.alloc(limit, "a"));
    const overLimit = await post("limit", Buffer.alloc(limit + 1, "b"));

    expect(atLimit.statusCode).toBe(202);
    expect(overLimit.statusCode).toBe(413);
    expect(await countEvents("limit")).toBe(1);
  });

  it("answers 404 for an unknown slug", async () => {
    const response = await post("does-not-exist", "{}");

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /in/:slug with generic_hmac", () => {
  it("accepts a valid signature", async () => {
    await createEndpoint("hmac-ok", "generic_hmac");
    const body = '{"amount":10}';

    const response = await post("hmac-ok", body, { "x-signature-256": sign(body) });

    expect(response.statusCode).toBe(202);
  });

  it("verifies the signature over the exact bytes, including odd spacing and non-UTF-8", async () => {
    await createEndpoint("hmac-bytes", "generic_hmac");
    const body = Buffer.concat([Buffer.from('{ "a" :   1 }\n'), Buffer.from([0xff, 0xfe])]);

    const response = await post("hmac-bytes", body, { "x-signature-256": sign(body) });

    expect(response.statusCode).toBe(202);
    const stored = await db.event.findUniqueOrThrow({
      where: { id: response.json<{ id: string }>().id },
    });
    expect(Buffer.compare(stored.body, body)).toBe(0);
  });

  it("accepts a signed empty body", async () => {
    await createEndpoint("hmac-empty", "generic_hmac");

    const response = await app.inject({
      method: "POST",
      url: "/in/hmac-empty",
      headers: { "x-signature-256": sign("") },
    });

    expect(response.statusCode).toBe(202);
  });

  it.each([
    ["missing", {}],
    ["malformed", { "x-signature-256": "not-a-signature" }],
    ["made with another secret", { "x-signature-256": `sha256=${"0".repeat(64)}` }],
  ])("answers 401 and stores nothing when the signature is %s", async (problem, headers) => {
    const slug = `hmac-bad-${problem.replaceAll(" ", "-")}`;
    await createEndpoint(slug, "generic_hmac");

    const response = await post(slug, '{"amount":10}', headers);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_signature" });
    expect(await countEvents(slug)).toBe(0);
  });

  it("rejects a valid signature when the body was altered", async () => {
    await createEndpoint("hmac-tampered", "generic_hmac");

    const response = await post("hmac-tampered", '{"amount":9999}', {
      "x-signature-256": sign('{"amount":10}'),
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /in/:slug with github", () => {
  it("uses X-GitHub-Event and deduplicates by X-GitHub-Delivery", async () => {
    await createEndpoint("gh", "github");
    const headers = (body: string) => ({
      "x-hub-signature-256": sign(body),
      "x-github-event": "push",
      "x-github-delivery": "delivery-1",
    });

    const first = await post("gh", '{"ref":"main"}', headers('{"ref":"main"}'));
    const redelivery = await post(
      "gh",
      '{"ref":"main","redelivered":true}',
      headers('{"ref":"main","redelivered":true}'),
    );

    expect(first.statusCode).toBe(202);
    expect(redelivery.statusCode).toBe(200);
    expect(redelivery.json()).toEqual(first.json());
    const stored = await db.event.findUniqueOrThrow({
      where: { id: first.json<{ id: string }>().id },
    });
    expect(stored.eventType).toBe("push");
    expect(stored.idempotencyKey).toBe("delivery-1");
  });

  it("does not accept the generic header on a github endpoint", async () => {
    await createEndpoint("gh-wrong-header", "github");

    const response = await post("gh-wrong-header", "{}", { "x-signature-256": sign("{}") });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /in/:slug on the demo endpoint", () => {
  it("refuses with 500 and stores nothing while the endpoint has no signature scheme", async () => {
    await createEndpoint("demo", "none", false);

    const response = await post("demo", '{"spam":true}');

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "demo_endpoint_unsigned" });
    expect(await countEvents("demo")).toBe(0);
  });

  it("rejects a visitor who cannot sign and accepts a valid signature once it is signed", async () => {
    await db.endpoint.update({
      where: { slug: "demo" },
      data: {
        signatureScheme: "generic_hmac",
        secretEncrypted: encryptSecret(secret, encryptionKey),
      },
    });
    const body = '{"from":"the owner"}';

    const unsigned = await post("demo", body);
    const wrongSignature = await post("demo", body, { "x-signature-256": sign("another body") });
    const signed = await post("demo", body, { "x-signature-256": sign(body) });

    expect(unsigned.statusCode).toBe(401);
    expect(wrongSignature.statusCode).toBe(401);
    expect(signed.statusCode).toBe(202);
    expect(await countEvents("demo")).toBe(1);
  });

  it("accepts the github scheme as well, since any signed scheme closes the door", async () => {
    await db.endpoint.update({ where: { slug: "demo" }, data: { signatureScheme: "github" } });
    const body = '{"ref":"main"}';

    const response = await post("demo", body, {
      "x-hub-signature-256": sign(body),
      "x-github-event": "push",
      "x-github-delivery": "demo-delivery-1",
    });

    expect(response.statusCode).toBe(202);
  });

  it("leaves other endpoints without signature working", async () => {
    await createEndpoint("not-the-demo", "none", false);

    const response = await post("not-the-demo", "{}");

    expect(response.statusCode).toBe(202);
  });
});

describe("POST /in/:slug with a misconfigured endpoint", () => {
  it("answers 500 when a signed endpoint has no secret", async () => {
    await createEndpoint("no-secret", "generic_hmac", false);

    const response = await post("no-secret", "{}", { "x-signature-256": sign("{}") });

    expect(response.statusCode).toBe(500);
    expect(await countEvents("no-secret")).toBe(0);
  });
});

describe("the ingest metrics", () => {
  let metricsApp: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    metricsApp = buildApp({
      db,
      encryptionKey,
      demoEndpointSlug: "demo",
      demoQuotaSalt: "test-salt-with-enough-characters",
      panelOrigin: "http://localhost:3100",
      exposeMetrics: true,
      version: "test",
      commit: "test",
      logLevel: "silent",
    });
    await metricsApp.ready();
  });

  afterAll(async () => {
    await metricsApp.close();
  });

  async function readMetric(line: string) {
    const { body } = await metricsApp.inject({ method: "GET", url: "/metrics" });
    const match = new RegExp(
      `^${line.replace(/[{}"]/g, "\\$&")} (\\d+(?:\\.\\d+)?(?:e-\\d+)?)$`,
      "m",
    ).exec(body);
    return match === null ? 0 : Number(match[1]);
  }

  it("counts each outcome of the route and times each answer by status code", async () => {
    await createEndpoint("metered", "none", false);
    await createEndpoint("metered-signed", "generic_hmac");
    const send = (slug: string, headers: Record<string, string> = {}) =>
      metricsApp.inject({
        method: "POST",
        url: `/in/${slug}`,
        headers: { "content-type": "application/json", ...headers },
        payload: '{"n":1}',
      });

    await send("metered");
    await send("metered");
    await send("metered-signed");
    await send("metered-signed", { "x-signature-256": sign('{"n":1}') });
    await send("nobody-here");

    await vi.waitFor(async () => {
      expect(await readMetric('relay_events_received_total{result="created"}')).toBe(2);
      expect(await readMetric('relay_events_received_total{result="duplicate"}')).toBe(1);
      expect(await readMetric('relay_events_received_total{result="invalid_signature"}')).toBe(1);
      expect(await readMetric('relay_events_received_total{result="unknown_endpoint"}')).toBe(1);
      expect(await readMetric('relay_ingest_duration_seconds_count{status_code="202"}')).toBe(2);
      expect(await readMetric('relay_ingest_duration_seconds_count{status_code="200"}')).toBe(1);
      expect(await readMetric('relay_ingest_duration_seconds_count{status_code="401"}')).toBe(1);
      expect(await readMetric('relay_ingest_duration_seconds_count{status_code="404"}')).toBe(1);
    });

    const secondsSpent = await readMetric('relay_ingest_duration_seconds_sum{status_code="202"}');
    expect(secondsSpent).toBeGreaterThan(0);
    // em milissegundos a soma de duas respostas passaria de 1 com folga
    expect(secondsSpent).toBeLessThan(1);
  });
});
