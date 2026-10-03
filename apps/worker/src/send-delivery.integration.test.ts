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
const runningLoops: ReturnType<typeof startDeliveryLoop>[] = [];

const send = (options: { timeoutMs?: number; allowPrivateAddresses?: boolean } = {}) =>
  createSendDelivery(db, { timeoutMs: 2000, allowPrivateAddresses: true, ...options });

function startRealLoop(options: { allowPrivateAddresses?: boolean; random?: () => number } = {}) {
  const { random = () => 0.99, ...senderOptions } = options;
  const loop = startDeliveryLoop({
    db,
    send: send(senderOptions),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    pollIntervalMs: 20,
    batchSize: 10,
    leaseSeconds: 60,
    random,
  });
  runningLoops.push(loop);
  return loop;
}

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

afterEach(async () => {
  await Promise.all(runningLoops.splice(0).map((loop) => loop.stop()));
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

    const result = await send()(await reserveOne());

    expect(result.reply).toEqual({ kind: "response", status: 200, retryAfter: null });
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

  it("refuses a loopback destination unless private addresses are allowed", async () => {
    await seedDeliveries(db, 1, { destinationUrl: serverUrl });

    const result = await send({ allowPrivateAddresses: false })(await reserveOne());

    expect(result.reply).toEqual({
      kind: "no-response",
      error: "refused: 127.0.0.1 is not a public address",
    });
    expect(received).toEqual([]);
  });
});

describe("delivery loop with the real sender", () => {
  it("delivers every pending delivery to the destination", async () => {
    await seedDeliveries(db, 12, {
      destinationUrl: `${serverUrl}/hook`,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"ok":true}'),
    });
    startRealLoop();

    await vi.waitFor(
      async () => {
        expect(await db.delivery.count({ where: { status: "succeeded" } })).toBe(12);
      },
      { timeout: 5000 },
    );

    expect(received).toHaveLength(12);
  });

  it("retries a failing destination until it answers, keeping every attempt in order", async () => {
    const [id] = await seedDeliveries(db, 1, { destinationUrl: serverUrl });
    let calls = 0;
    respond = (_request, response) => {
      calls += 1;
      response.writeHead(calls < 3 ? 503 : 200).end(calls < 3 ? "busy" : "ok");
    };
    startRealLoop({ random: () => 0 });

    await vi.waitFor(
      async () => {
        expect(await db.delivery.count({ where: { status: "succeeded" } })).toBe(1);
      },
      { timeout: 5000 },
    );

    expect(await db.delivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      attemptCount: 3,
      lastError: null,
    });
    const attempts = await db.attempt.findMany({
      where: { deliveryId: id },
      orderBy: { startedAt: "asc" },
    });
    expect(
      attempts.map(({ httpStatus, responseSnippet, error }) => [
        httpStatus,
        responseSnippet,
        error,
      ]),
    ).toEqual([
      [503, "busy", "destination answered 503"],
      [503, "busy", "destination answered 503"],
      [200, "ok", null],
    ]);
    expect(
      await db.destination.findFirstOrThrow({ where: { deliveries: { some: { id } } } }),
    ).toMatchObject({ circuitState: "closed", consecutiveFailures: 0 });
  });

  it("stops calling a destination that keeps failing and holds its deliveries back", async () => {
    const ids = await seedDeliveries(db, 5, { destinationUrl: serverUrl });
    respond = (_request, response) => response.writeHead(503).end();
    startRealLoop({ random: () => 0 });

    await vi.waitFor(
      async () => {
        const postponed = await db.$queryRaw<{ total: bigint }[]>`
          SELECT count(*) AS total FROM delivery
          WHERE next_attempt_at > now() + interval '200 seconds'`;
        expect(postponed[0]?.total).toBe(5n);
      },
      { timeout: 5000 },
    );

    expect(received).toHaveLength(5);
    expect(await db.delivery.count({ where: { id: { in: ids }, attemptCount: 1 } })).toBe(5);
    expect(
      await db.destination.findFirstOrThrow({ where: { deliveries: { some: { id: ids[0] } } } }),
    ).toMatchObject({ circuitState: "open" });
  });

  it("never calls a private destination when they are not allowed, and says why", async () => {
    const [id] = await seedDeliveries(db, 1, { destinationUrl: serverUrl });
    startRealLoop({ allowPrivateAddresses: false });

    await vi.waitFor(
      async () => {
        expect((await db.delivery.findUniqueOrThrow({ where: { id } })).lastError).not.toBeNull();
      },
      { timeout: 5000 },
    );

    expect(received).toEqual([]);
    expect(await db.delivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "pending",
      lastError: "refused: 127.0.0.1 is not a public address",
    });
    expect(await db.attempt.findMany({ where: { deliveryId: id } })).toMatchObject([
      { httpStatus: null, error: "refused: 127.0.0.1 is not a public address" },
    ]);
  });
});
