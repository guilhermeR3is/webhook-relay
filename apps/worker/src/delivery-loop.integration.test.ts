import { setTimeout as sleep } from "node:timers/promises";
import { seedDeliveries, startTestDatabase, type TestDatabase } from "@relay/db/testing";
import { createDb, reserveDeliveries, type Db } from "@relay/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startDeliveryLoop, type SendDelivery } from "./delivery-loop.js";

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let testDatabase: TestDatabase;
let db: Db;
const runningLoops: ReturnType<typeof startDeliveryLoop>[] = [];
const extraClients: Db[] = [];

function openExtraClient() {
  const client = createDb(testDatabase.connectionUri);
  extraClients.push(client);
  return client;
}

function startLoop(send: SendDelivery, overrides: { batchSize?: number; db?: Db } = {}) {
  const loop = startDeliveryLoop({
    db,
    send,
    log: silentLog,
    pollIntervalMs: 20,
    batchSize: 10,
    leaseSeconds: 60,
    retryInSeconds: 600,
    ...overrides,
  });
  runningLoops.push(loop);
  return loop;
}

async function seedOneDelivery() {
  const [id] = await seedDeliveries(db, 1);
  if (id === undefined) {
    throw new Error("seedDeliveries returned no delivery");
  }
  return id;
}

function waitForSucceeded(expectedCount: number, timeout = 5000) {
  return vi.waitFor(
    async () => {
      expect(await db.delivery.count({ where: { status: "succeeded" } })).toBe(expectedCount);
    },
    { timeout },
  );
}

function waitForRescheduled(id: string) {
  return vi.waitFor(
    async () => {
      const delivery = await db.delivery.findUniqueOrThrow({ where: { id } });
      expect(delivery.lastError).not.toBeNull();
      return delivery;
    },
    { timeout: 5000 },
  );
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delivery.deleteMany();
  await db.event.deleteMany();
});

afterEach(async () => {
  await Promise.all(runningLoops.splice(0).map((loop) => loop.stop()));
  await Promise.all(extraClients.splice(0).map((client) => client.$disconnect()));
});

afterAll(async () => {
  await testDatabase.stop();
});

describe("delivery loop", () => {
  it("sends every pending delivery once and marks it as succeeded", async () => {
    const ids = await seedDeliveries(db, 25);
    const sentIds: string[] = [];

    startLoop((delivery) => {
      sentIds.push(delivery.id);
      return Promise.resolve({ ok: true });
    });
    await waitForSucceeded(25);

    expect(sentIds.sort()).toEqual(ids.sort());
  });

  it("reschedules the delivery with the error when the send fails", async () => {
    const id = await seedOneDelivery();

    startLoop(() => Promise.resolve({ ok: false, error: "destination answered 503" }));
    const rescheduled = await waitForRescheduled(id);

    expect(rescheduled).toMatchObject({
      status: "pending",
      attemptCount: 1,
      lastError: "destination answered 503",
      lockedUntil: null,
    });
  });

  it("treats a send that throws as a failed attempt and keeps going", async () => {
    const brokenId = await seedOneDelivery();
    await seedDeliveries(db, 2);

    startLoop((delivery) => {
      if (delivery.id === brokenId) throw new Error("boom");
      return Promise.resolve({ ok: true });
    });
    await waitForSucceeded(2);

    expect(await waitForRescheduled(brokenId)).toMatchObject({
      status: "pending",
      lastError: "boom",
    });
    expect(silentLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: brokenId }),
      "send threw instead of returning an outcome",
    );
  });

  it("sends the reserved batch in parallel", async () => {
    await seedDeliveries(db, 5);
    let inFlight = 0;
    let maxInFlight = 0;

    startLoop(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(50);
      inFlight -= 1;
      return { ok: true };
    });
    await waitForSucceeded(5);

    expect(maxInFlight).toBe(5);
  });

  it("waits for the deliveries in progress before stopping", async () => {
    const id = await seedOneDelivery();
    let sendStarted = false;
    let finishSend: () => void = () => undefined;
    const sendCanFinish = new Promise<void>((resolve) => {
      finishSend = resolve;
    });

    const loop = startLoop(async () => {
      sendStarted = true;
      await sendCanFinish;
      return { ok: true };
    });
    await vi.waitFor(
      () => {
        expect(sendStarted).toBe(true);
      },
      { timeout: 5000 },
    );
    const stopping = loop.stop();
    const raceWinner = await Promise.race([stopping.then(() => "stopped"), sleep(100, "waiting")]);
    finishSend();
    await stopping;

    expect(raceWinner).toBe("waiting");
    expect((await db.delivery.findUniqueOrThrow({ where: { id } })).status).toBe("succeeded");
  });

  it("retakes a delivery abandoned by a dead worker once its lease expires", async () => {
    const id = await seedOneDelivery();
    const abandoned = await reserveDeliveries(db, { limit: 10, leaseSeconds: 60 });
    expect(abandoned.map((delivery) => delivery.id)).toEqual([id]);
    const sentIds: string[] = [];

    startLoop((delivery) => {
      sentIds.push(delivery.id);
      return Promise.resolve({ ok: true });
    });
    await db.$executeRaw`
      UPDATE delivery SET locked_until = now() - interval '1 second' WHERE id = ${id}::uuid`;
    await waitForSucceeded(1);

    expect(sentIds).toEqual([id]);
    expect(await db.delivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "succeeded",
      attemptCount: 2,
    });
  });
});

describe("two workers on the same queue", () => {
  it("delivers 500 deliveries without sending any of them twice", async () => {
    const ids = await seedDeliveries(db, 500);
    const sentByFirst: string[] = [];
    const sentBySecond: string[] = [];
    const recordingSend =
      (sent: string[]): SendDelivery =>
      async (delivery) => {
        sent.push(delivery.id);
        await sleep(2);
        return { ok: true };
      };

    startLoop(recordingSend(sentByFirst));
    startLoop(recordingSend(sentBySecond), { db: openExtraClient() });
    await waitForSucceeded(500, 20_000);

    const allSent = [...sentByFirst, ...sentBySecond];
    expect(allSent).toHaveLength(500);
    expect(new Set(allSent)).toEqual(new Set(ids));
    expect(sentByFirst.length).toBeGreaterThan(0);
    expect(sentBySecond.length).toBeGreaterThan(0);
    expect(await db.delivery.count({ where: { attemptCount: { not: 1 } } })).toBe(0);
    expect(silentLog.error).not.toHaveBeenCalled();
  }, 30_000);
});
