import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { reserveDeliveries, type Db, type ReservedDelivery } from "@relay/db";
import { seedDeliveries, startTestDatabase, type TestDatabase } from "@relay/db/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startDeliveryLoop } from "./delivery-loop.js";
import { createSendDelivery } from "./send-delivery.js";

type ReceivedRequest = {
  method: string | undefined;
  url: string | undefined;
  contentType: string | undefined;
  body: Buffer;
};

let testDatabase: TestDatabase;
let db: Db;
let server: Server;
let serverUrl: string;
let received: ReceivedRequest[];
let respond: (request: IncomingMessage, response: ServerResponse) => void;

const send = (timeoutMs = 2000) => createSendDelivery(db, { timeoutMs });

async function reserveOne(): Promise<ReservedDelivery> {
  const [reserved] = await reserveDeliveries(db, { limit: 1, leaseSeconds: 60 });
  if (reserved === undefined) {
    throw new Error("no delivery to reserve");
  }
  return reserved;
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        method: request.method,
        url: request.url,
        contentType: request.headers["content-type"],
        body: Buffer.concat(chunks),
      });
      respond(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 120_000);

beforeEach(async () => {
  received = [];
  respond = (_request, response) => response.writeHead(200).end();
  await db.delivery.deleteMany();
  await db.event.deleteMany();
});

afterEach(() => {
  server.closeAllConnections();
});

afterAll(async () => {
  server.close();
  await testDatabase.stop();
});

describe("createSendDelivery", () => {
  it("posts the stored body byte for byte with its content-type", async () => {
    const body = Buffer.from([0xff, 0x00, 0xfe, 0x80, 0x0a, 0x7b]);
    await seedDeliveries(db, 1, {
      destinationUrl: `${serverUrl}/hook`,
      headers: { "content-type": "application/json" },
      body,
    });

    const outcome = await send()(await reserveOne());

    expect(outcome).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      method: "POST",
      url: "/hook",
      contentType: "application/json",
    });
    expect(Buffer.compare(received[0]?.body ?? Buffer.alloc(0), body)).toBe(0);
  });

  it("falls back to application/octet-stream when no content-type was stored", async () => {
    await seedDeliveries(db, 1, { destinationUrl: serverUrl });

    await send()(await reserveOne());

    expect(received[0]?.contentType).toBe("application/octet-stream");
  });

  it("treats any 2xx as success", async () => {
    respond = (_request, response) => response.writeHead(204).end();
    await seedDeliveries(db, 1, { destinationUrl: serverUrl });

    expect(await send()(await reserveOne())).toEqual({ ok: true });
  });

  it("reports the status when the destination does not answer 2xx", async () => {
    respond = (_request, response) => response.writeHead(503).end("busy");
    await seedDeliveries(db, 1, { destinationUrl: serverUrl });

    expect(await send()(await reserveOne())).toEqual({
      ok: false,
      error: "destination answered 503",
    });
  });

  it("does not follow redirects", async () => {
    respond = (request, response) => {
      if (request.url === "/hook") {
        response.writeHead(302, { location: "/elsewhere" }).end();
      } else {
        response.writeHead(200).end();
      }
    };
    await seedDeliveries(db, 1, { destinationUrl: `${serverUrl}/hook` });

    const outcome = await send()(await reserveOne());

    expect(outcome).toEqual({ ok: false, error: "destination answered 302" });
    expect(received.map((request) => request.url)).toEqual(["/hook"]);
  });

  it("gives up when the destination takes longer than the timeout", async () => {
    respond = () => undefined;
    await seedDeliveries(db, 1, { destinationUrl: serverUrl });

    const outcome = await send(100)(await reserveOne());

    expect(outcome).toEqual({ ok: false, error: "timed out after 100 ms" });
  });

  it("reports the real reason when the destination is unreachable", async () => {
    const closedServer = createServer();
    await new Promise<void>((resolve) => closedServer.listen(0, "127.0.0.1", resolve));
    const closedPort = (closedServer.address() as AddressInfo).port;
    await new Promise((resolve) => closedServer.close(resolve));
    await seedDeliveries(db, 1, { destinationUrl: `http://127.0.0.1:${String(closedPort)}` });

    const outcome = await send()(await reserveOne());

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.error).toContain("ECONNREFUSED");
  });
});

describe("delivery loop with the real sender", () => {
  it("delivers every pending delivery to the destination", async () => {
    await seedDeliveries(db, 12, {
      destinationUrl: `${serverUrl}/hook`,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"ok":true}'),
    });
    const loop = startDeliveryLoop({
      db,
      send: send(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      pollIntervalMs: 20,
      batchSize: 10,
      leaseSeconds: 60,
      retryInSeconds: 600,
    });

    await vi.waitFor(
      async () => {
        expect(await db.delivery.count({ where: { status: "succeeded" } })).toBe(12);
      },
      { timeout: 5000 },
    );
    await loop.stop();

    expect(received).toHaveLength(12);
  });
});
