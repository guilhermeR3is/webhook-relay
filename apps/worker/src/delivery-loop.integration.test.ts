import { setTimeout as sleep } from "node:timers/promises";
import { Registry } from "@prometheus-io/client";
import { seedDeliveries, startTestDatabase, type TestDatabase } from "@relay/db/testing";
import { createDb, reserveDeliveries, resendDeliveries, type Db } from "@relay/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startDeliveryLoop, type SendDelivery } from "./delivery-loop.js";
import { createDeliveryMetrics, type DeliveryMetrics } from "./metrics.js";
import type { PostResult } from "./post-webhook.js";

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let testDatabase: TestDatabase;
let db: Db;
let metrics: DeliveryMetrics;
const runningLoops: ReturnType<typeof startDeliveryLoop>[] = [];
const extraClients: Db[] = [];

function answered(status: number, retryAfter: string | null = null): PostResult {
  return {
    reply: { kind: "response", status, retryAfter },
    startedAt: new Date(),
    durationMs: 5,
    httpStatus: status,
  };
}

const accepted: SendDelivery = () => Promise.resolve(answered(200));

function openExtraClient() {
  const client = createDb(testDatabase.connectionUri);
  extraClients.push(client);
  return client;
}

type LoopOverrides = { batchSize?: number; db?: Db; random?: () => number };

// quase 10 s de espera na primeira falha: nenhuma entrega reagendada volta durante o teste
function startLoop(send: SendDelivery, overrides: LoopOverrides = {}) {
  const loop = startDeliveryLoop({
    db,
    send,
    log: silentLog,
    pollIntervalMs: 20,
    batchSize: 10,
    leaseSeconds: 60,
    metrics,
    random: () => 0.99,
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

async function destinationOf(deliveryId: string) {
  const { destinationId } = await db.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
  return destinationId;
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

function waitForStatus(id: string, status: "pending" | "dead" | "succeeded") {
  return vi.waitFor(
    async () => {
      const delivery = await db.delivery.findUniqueOrThrow({ where: { id } });
      expect(delivery.status).toBe(status);
      return delivery;
    },
    { timeout: 5000 },
  );
}

async function secondsUntilDue(id: string) {
  const rows = await db.$queryRaw<{ seconds: number }[]>`
    SELECT extract(epoch FROM next_attempt_at - now())::float8 AS seconds
    FROM delivery WHERE id = ${id}::uuid`;
  return rows[0]?.seconds ?? Number.NaN;
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
}, 120_000);

beforeEach(async () => {
  vi.clearAllMocks();
  metrics = createDeliveryMetrics(new Registry());
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
      return accepted(delivery);
    });
    await waitForSucceeded(25);

    expect(sentIds.sort()).toEqual(ids.sort());
  });

  it("records one attempt per send, with the time the send took", async () => {
    const ids = await seedDeliveries(db, 3);

    startLoop(async () => {
      await sleep(30);
      return { ...answered(200), durationMs: 31 };
    });
    await waitForSucceeded(3);

    const attempts = await db.attempt.findMany({ where: { deliveryId: { in: ids } } });
    expect(attempts).toHaveLength(3);
    expect(attempts.every((attempt) => attempt.error === null)).toBe(true);
    expect(
      attempts.every((attempt) => attempt.httpStatus === 200 && attempt.durationMs === 31),
    ).toBe(true);
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
      return answered(200);
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
      return answered(200);
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
      return accepted(delivery);
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

  it("treats a send that throws as a failed attempt and keeps going", async () => {
    const brokenId = await seedOneDelivery();
    await seedDeliveries(db, 2);

    startLoop((delivery) => {
      if (delivery.id === brokenId) throw new Error("boom");
      return accepted(delivery);
    });
    await waitForSucceeded(2);

    expect(await waitForRescheduled(brokenId)).toMatchObject({
      status: "pending",
      lastError: "boom",
    });
    expect(silentLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: brokenId }),
      "send threw instead of returning a result",
    );
  });
});

describe("what the loop does with each answer", () => {
  it("retries a 5xx later, with the backoff delay, and keeps the status and snippet of the attempt", async () => {
    const id = await seedOneDelivery();

    startLoop(() => Promise.resolve({ ...answered(503), responseSnippet: "busy" }), {
      random: () => 0.5,
    });
    const rescheduled = await waitForRescheduled(id);

    expect(rescheduled).toMatchObject({
      status: "pending",
      attemptCount: 1,
      lastError: "destination answered 503",
      lockedUntil: null,
    });
    expect(await secondsUntilDue(id)).toBeGreaterThan(4);
    expect(await secondsUntilDue(id)).toBeLessThanOrEqual(5);
    expect(await db.attempt.findMany({ where: { deliveryId: id } })).toMatchObject([
      { httpStatus: 503, responseSnippet: "busy", error: "destination answered 503" },
    ]);
  });

  it("sends a 4xx straight to the dead queue without touching the circuit", async () => {
    const id = await seedOneDelivery();
    const send = vi.fn(() => Promise.resolve(answered(400)));

    startLoop(send);
    const dead = await waitForStatus(id, "dead");

    expect(dead).toMatchObject({ attemptCount: 1, lastError: "destination answered 400" });
    expect(
      await db.destination.findUniqueOrThrow({ where: { id: await destinationOf(id) } }),
    ).toMatchObject({ circuitState: "closed", consecutiveFailures: 0, isActive: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("waits for the time the destination asked for on a 429 with Retry-After", async () => {
    const id = await seedOneDelivery();
    const send = vi.fn(() => Promise.resolve(answered(429, "600")));

    startLoop(send);
    await waitForRescheduled(id);

    expect(await secondsUntilDue(id)).toBeGreaterThan(595);
    expect(await secondsUntilDue(id)).toBeLessThanOrEqual(600);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("gives up and moves the delivery to the dead queue after 8 attempts", async () => {
    const id = await seedOneDelivery();
    const send = vi.fn(() => Promise.resolve(answered(429, "0")));

    startLoop(send);
    const dead = await waitForStatus(id, "dead");

    expect(dead).toMatchObject({
      attemptCount: 8,
      lastError: "destination answered 429, gave up after 8 attempts",
    });
    expect(send).toHaveBeenCalledTimes(8);
    expect(await db.attempt.count({ where: { deliveryId: id } })).toBe(8);
  });

  it("delivers a dead delivery once it is resent, starting a fresh run of attempts at 1", async () => {
    const id = await seedOneDelivery();
    const failing = startLoop(() => Promise.resolve(answered(429, "0")));
    await waitForStatus(id, "dead");
    await failing.stop();
    const { event } = await db.delivery.findUniqueOrThrow({
      where: { id },
      select: { event: { select: { endpointId: true } } },
    });

    const result = await resendDeliveries(db, {
      endpointId: event.endpointId,
      deliveryIds: [id],
    });
    startLoop(accepted);
    const delivered = await waitForStatus(id, "succeeded");

    expect(result.resent).toEqual([id]);
    expect(delivered).toMatchObject({ attemptCount: 1, lastError: null });
    expect(await db.attempt.count({ where: { deliveryId: id } })).toBe(9);
    expect(await db.resend.findMany({ where: { deliveryId: id } })).toMatchObject([
      { attemptsBefore: 8 },
    ]);
  });

  it("on a 410 deactivates the destination and buries the deliveries still waiting for it", async () => {
    const ids = await seedDeliveries(db, 3);
    const send = vi.fn(() => Promise.resolve(answered(410)));

    startLoop(send, { batchSize: 1 });
    await vi.waitFor(
      async () => {
        expect(await db.delivery.count({ where: { status: "dead" } })).toBe(3);
      },
      { timeout: 5000 },
    );

    const reasons = (await db.delivery.findMany({ where: { id: { in: ids } } }))
      .map((delivery) => delivery.lastError)
      .sort();
    expect(reasons).toEqual([
      "destination answered 410, destination deactivated",
      "destination deactivated after a 410 answer",
      "destination deactivated after a 410 answer",
    ]);
    expect(
      await db.destination.findUniqueOrThrow({ where: { id: await destinationOf(ids[0] ?? "") } }),
    ).toMatchObject({ isActive: false });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("the circuit breaker inside the loop", () => {
  it("stops calling a destination after it keeps failing, and postpones its deliveries without spending attempts", async () => {
    const ids = await seedDeliveries(db, 6);
    const send = vi.fn(() => Promise.resolve(answered(503)));

    startLoop(send, { random: () => 0 });
    await vi.waitFor(
      async () => {
        const postponed = await db.$queryRaw<{ total: bigint }[]>`
          SELECT count(*) AS total FROM delivery
          WHERE next_attempt_at > now() + interval '200 seconds'`;
        expect(postponed[0]?.total).toBe(6n);
      },
      { timeout: 5000 },
    );

    expect(send).toHaveBeenCalledTimes(6);
    expect(await db.delivery.count({ where: { attemptCount: 1, status: "pending" } })).toBe(6);
    expect(await db.attempt.count({ where: { deliveryId: { in: ids } } })).toBe(6);
    expect(
      await db.destination.findUniqueOrThrow({ where: { id: await destinationOf(ids[0] ?? "") } }),
    ).toMatchObject({ circuitState: "open", consecutiveFailures: 6 });
  });

  it("lets one delivery probe the destination once the pause is over, and resumes everything when it answers", async () => {
    const ids = await seedDeliveries(db, 4);
    const destinationId = await destinationOf(ids[0] ?? "");
    await db.$executeRaw`
      UPDATE destination
      SET circuit_state = 'open', consecutive_failures = 5, circuit_opened_at = now() - interval '301 seconds'
      WHERE id = ${destinationId}::uuid`;
    const send = vi.fn(() => Promise.resolve(answered(200)));

    startLoop(send);
    await waitForSucceeded(1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.destination.findUniqueOrThrow({ where: { id: destinationId } })).toMatchObject({
      circuitState: "closed",
      consecutiveFailures: 0,
      circuitOpenedAt: null,
    });
    expect(await db.delivery.count({ where: { status: "pending", attemptCount: 0 } })).toBe(3);

    await db.$executeRaw`
      UPDATE delivery SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`;
    await waitForSucceeded(4);

    expect(send).toHaveBeenCalledTimes(4);
  });

  it("reopens the pause when the probe fails, and the other delivery only waits for the probe", async () => {
    const ids = await seedDeliveries(db, 2);
    const destinationId = await destinationOf(ids[0] ?? "");
    await db.$executeRaw`
      UPDATE destination
      SET circuit_state = 'open', consecutive_failures = 5, circuit_opened_at = now() - interval '301 seconds'
      WHERE id = ${destinationId}::uuid`;
    const send = vi.fn(() => Promise.resolve(answered(503)));

    startLoop(send, { random: () => 0 });
    await vi.waitFor(
      async () => {
        const postponed = await db.$queryRaw<{ total: bigint }[]>`
          SELECT count(*) AS total FROM delivery
          WHERE next_attempt_at > now() + interval '200 seconds'`;
        expect(postponed[0]?.total).toBe(1n);
      },
      { timeout: 5000 },
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.destination.findUniqueOrThrow({ where: { id: destinationId } })).toMatchObject({
      circuitState: "open",
    });
    expect(await db.delivery.count({ where: { status: "pending", attemptCount: 0 } })).toBe(1);
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
        return answered(200);
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

  it("sends exactly one probe to a paused destination, whichever worker gets there first", async () => {
    const ids = await seedDeliveries(db, 40);
    const destinationId = await destinationOf(ids[0] ?? "");
    await db.$executeRaw`
      UPDATE destination
      SET circuit_state = 'open', consecutive_failures = 5, circuit_opened_at = now() - interval '301 seconds'
      WHERE id = ${destinationId}::uuid`;
    const send = vi.fn(async () => {
      await sleep(100);
      return answered(200);
    });

    startLoop(send, { batchSize: 5 });
    startLoop(send, { batchSize: 5, db: openExtraClient() });
    await waitForSucceeded(1);
    await sleep(150);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.delivery.count({ where: { status: "succeeded" } })).toBe(1);
  });
});

async function deliveriesCounted(result: string) {
  const { values } = await metrics.deliveries.get();
  return values.find((entry) => entry.labels.result === result)?.value ?? 0;
}

async function secondsTimed(statusClass: string) {
  const { values } = await metrics.sendDuration.get();
  const total = values.find(
    (entry) =>
      entry.metricName === "relay_send_duration_seconds_sum" &&
      entry.labels.status_class === statusClass,
  );
  return total?.value ?? 0;
}

async function sendsTimed(statusClass: string) {
  const { values } = await metrics.sendDuration.get();
  const total = values.find(
    (entry) =>
      entry.metricName === "relay_send_duration_seconds_count" &&
      entry.labels.status_class === statusClass,
  );
  return total?.value ?? 0;
}

function waitForCount(result: string, expected: number) {
  return vi.waitFor(
    async () => {
      expect(await deliveriesCounted(result)).toBe(expected);
    },
    { timeout: 5000 },
  );
}

describe("what the loop counts", () => {
  it("counts each succeeded delivery and times each send under its status class", async () => {
    await seedDeliveries(db, 3);

    startLoop(accepted);
    await waitForCount("succeeded", 3);

    expect(await sendsTimed("2xx")).toBe(3);
    // cada envio de teste durou 5 ms, e o histograma guarda segundos
    expect(await secondsTimed("2xx")).toBeCloseTo(0.015, 6);
  });

  it("counts a 5xx as retried and a 4xx as dead, each under its own status class", async () => {
    await seedDeliveries(db, 2);
    const [retriedId] = await db.delivery.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });

    startLoop((delivery) => Promise.resolve(answered(delivery.id === retriedId?.id ? 503 : 400)));
    await waitForCount("retried", 1);
    await waitForCount("dead", 1);

    expect(await sendsTimed("5xx")).toBe(1);
    expect(await sendsTimed("4xx")).toBe(1);
  });

  it("counts a send that throws as retried, under the status class none", async () => {
    await seedOneDelivery();

    startLoop(() => {
      throw new Error("boom");
    });
    await waitForCount("retried", 1);

    expect(await sendsTimed("none")).toBe(1);
  });

  it("counts a delivery to a paused destination as postponed, without timing a send", async () => {
    const id = await seedOneDelivery();
    await db.destination.update({
      where: { id: await destinationOf(id) },
      data: { circuitState: "open", circuitOpenedAt: new Date() },
    });

    startLoop(accepted);
    await waitForCount("postponed", 1);

    expect(await sendsTimed("2xx")).toBe(0);
  });

  it("counts a result as lease_lost when the delivery was taken over during the send", async () => {
    const id = await seedOneDelivery();

    startLoop(async () => {
      await db.delivery.update({ where: { id }, data: { attemptCount: { increment: 1 } } });
      return answered(200);
    });
    await waitForCount("lease_lost", 1);

    expect(await deliveriesCounted("succeeded")).toBe(0);
  });

  it("counts a failure to record the result as error", async () => {
    await seedOneDelivery();

    startLoop(() => Promise.resolve({ ...answered(200), durationMs: 2 ** 31 }));
    await waitForCount("error", 1);

    expect(await deliveriesCounted("succeeded")).toBe(0);
  });
});
