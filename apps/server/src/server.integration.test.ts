import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startApi } from "@relay/api";
import { encryptSecret } from "@relay/db";
import {
  startTestDatabase,
  testDestinationSecret,
  testEncryptionKey,
  type TestDatabase,
} from "@relay/db/testing";
import { startWorker } from "@relay/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadServerEnv } from "./env.js";

type ReceivedRequest = { headers: IncomingHttpHeaders; body: string };

let testDatabase: TestDatabase;
let receiver: Server;
const received: ReceivedRequest[] = [];
let apiUrl: string;
let workerUrl: string;
let api: Awaited<ReturnType<typeof startApi>>;
let worker: Awaited<ReturnType<typeof startWorker>>;

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  const { db } = testDatabase;

  receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks).toString() });
      response.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const receiverPort = (receiver.address() as AddressInfo).port;

  const endpoint = await db.endpoint.create({
    data: { slug: "shared-process", name: "shared-process", signatureScheme: "none" },
  });
  await db.destination.create({
    data: {
      endpointId: endpoint.id,
      url: `http://127.0.0.1:${String(receiverPort)}/hook`,
      secretEncrypted: encryptSecret(testDestinationSecret, testEncryptionKey),
      eventTypes: ["*"],
    },
  });

  const apiPort = await freePort();
  const workerPort = await freePort();
  apiUrl = `http://127.0.0.1:${String(apiPort)}`;
  workerUrl = `http://127.0.0.1:${String(workerPort)}`;
  const env = loadServerEnv({
    DATABASE_URL: testDatabase.connectionUri,
    ENCRYPTION_KEY: testEncryptionKey.toString("base64"),
    DEMO_QUOTA_SALT: "test-salt-with-enough-characters",
    PORT: String(apiPort),
    WORKER_PORT: String(workerPort),
    WORKER_POLL_INTERVAL_MS: "100",
    ALLOW_PRIVATE_DESTINATIONS: "true",
    LOG_LEVEL: "silent",
  });
  api = await startApi(env.api, db, "test");
  worker = await startWorker(env.worker, db, "test");
}, 120_000);

afterAll(async () => {
  await api.stop();
  await worker.stop();
  await new Promise((resolve) => receiver.close(resolve));
  await testDatabase.stop();
});

describe("api and worker in one process", () => {
  it("delivers through the worker an event the api accepted", async () => {
    const response = await fetch(`${apiUrl}/in/shared-process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"hello":"world"}',
    });

    expect(response.status).toBe(202);
    await expect.poll(() => received.length, { timeout: 5000 }).toBe(1);
    expect(received[0]?.body).toBe('{"hello":"world"}');
    expect(received[0]?.headers["webhook-id"]).toBeDefined();
  });

  it("answers /health on both ports", async () => {
    const apiHealth = await fetch(`${apiUrl}/health`);
    const workerHealth = await fetch(`${workerUrl}/health`);

    expect(apiHealth.status).toBe(200);
    expect(workerHealth.status).toBe(200);
    expect(await workerHealth.json()).toMatchObject({ checks: { database: "ok", queue: "ok" } });
  });

  it("stops serving on both ports after stop()", async () => {
    await api.stop();
    await worker.stop();

    await expect(fetch(`${apiUrl}/health`)).rejects.toThrow();
    await expect(fetch(`${workerUrl}/health`)).rejects.toThrow();
  });
});
