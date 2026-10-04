import { createHmac } from "node:crypto";
import { decryptSecret, type Db } from "@relay/db";
import { startTestDatabase, testEncryptionKey, type TestDatabase } from "@relay/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { addEndpoint, parseAddEndpointArgs } from "./endpoint-add.js";

let testDatabase: TestDatabase;
let db: Db;

const add = (args: Record<string, string>) =>
  addEndpoint(db, {
    ...parseAddEndpointArgs({ "destination-url": "https://n8n.example.com/webhook/abc", ...args }),
    encryptionKey: testEncryptionKey,
  });

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

afterAll(async () => {
  await testDatabase.stop();
});

describe("addEndpoint", () => {
  it("creates the endpoint and one destination with both secrets stored encrypted", async () => {
    const added = await add({ slug: "github", scheme: "github", "event-types": "push,issues" });

    const endpoint = await db.endpoint.findUniqueOrThrow({
      where: { slug: "github" },
      include: { destinations: true },
    });
    expect(endpoint.id).toBe(added.endpointId);
    expect(endpoint.signatureScheme).toBe("github");
    expect(decryptSecret(endpoint.secretEncrypted ?? "", testEncryptionKey)).toBe(
      added.endpointSecret,
    );
    expect(endpoint.destinations).toHaveLength(1);
    const [destination] = endpoint.destinations;
    expect(destination?.id).toBe(added.destinationId);
    expect(destination?.url).toBe("https://n8n.example.com/webhook/abc");
    expect(destination?.eventTypes).toEqual(["push", "issues"]);
    const destinationSecret = decryptSecret(destination?.secretEncrypted ?? "", testEncryptionKey);
    expect(destinationSecret).toBe(added.destinationSecret);
    expect(destinationSecret.startsWith("whsec_")).toBe(true);
    expect(Buffer.from(destinationSecret.slice("whsec_".length), "base64")).toHaveLength(32);
  });

  it("stores no secret for an endpoint without signature", async () => {
    const added = await add({ slug: "open", scheme: "none" });

    const endpoint = await db.endpoint.findUniqueOrThrow({ where: { slug: "open" } });
    expect(added.endpointSecret).toBeNull();
    expect(endpoint.secretEncrypted).toBeNull();
  });

  it("returns a secret the real ingest route accepts, and only subscribed events get a delivery", async () => {
    const added = await add({ slug: "github-flow", scheme: "github", "event-types": "push" });
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
    const body = '{"ref":"refs/heads/main"}';
    const signature = `sha256=${createHmac("sha256", added.endpointSecret ?? "")
      .update(body)
      .digest("hex")}`;
    const send = (event: string, delivery: string) =>
      app.inject({
        method: "POST",
        url: "/in/github-flow",
        headers: {
          "x-hub-signature-256": signature,
          "x-github-event": event,
          "x-github-delivery": delivery,
        },
        payload: body,
      });

    const push = await send("push", "delivery-push");
    const star = await send("star", "delivery-star");
    await app.close();

    expect(push.statusCode).toBe(202);
    expect(star.statusCode).toBe(202);
    const deliveries = await db.delivery.findMany({
      where: { event: { endpointId: added.endpointId } },
      include: { event: true },
    });
    expect(deliveries.map((delivery) => delivery.event.eventType)).toEqual(["push"]);
  });

  it("refuses a slug that already exists and leaves the first endpoint untouched", async () => {
    const first = await add({ slug: "taken", scheme: "github" });

    await expect(
      add({
        slug: "taken",
        scheme: "generic_hmac",
        "destination-url": "https://other.example.com",
      }),
    ).rejects.toThrow(/already exists; nothing was changed/);

    const endpoint = await db.endpoint.findUniqueOrThrow({
      where: { slug: "taken" },
      include: { destinations: true },
    });
    expect(endpoint.id).toBe(first.endpointId);
    expect(endpoint.signatureScheme).toBe("github");
    expect(decryptSecret(endpoint.secretEncrypted ?? "", testEncryptionKey)).toBe(
      first.endpointSecret,
    );
    expect(endpoint.destinations.map((destination) => destination.url)).toEqual([
      "https://n8n.example.com/webhook/abc",
    ]);
    expect(await db.destination.count({ where: { url: "https://other.example.com/" } })).toBe(0);
  });
});
