import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import type { DeliveryStatus } from "./generated/enums.js";
import { checkQueue } from "./health.js";
import {
  buryDelivery,
  completeDelivery,
  releaseDelivery,
  reserveDeliveries,
  rescheduleDelivery,
  type AttemptRecord,
  type ReservedDelivery,
} from "./queue.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

const reserveOptions = { limit: 10, leaseSeconds: 60 };

let testDatabase: TestDatabase;
let db: Db;
let endpointId: string;
let destinationId: string;

function anAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return { startedAt: new Date(), durationMs: 25, ...overrides };
}

function createDestination() {
  return db.destination.create({
    data: {
      endpointId,
      url: `http://localhost:9999/${randomUUID()}`,
      secretEncrypted: "x",
      eventTypes: ["*"],
    },
  });
}

// o banco arredonda o default para o milissegundo, então a entrega nova já nasce vencida há um minuto
async function createDelivery(
  status: DeliveryStatus = "pending",
  dueInSeconds = -60,
  forDestinationId = destinationId,
) {
  const event = await db.event.create({
    data: {
      endpointId,
      idempotencyKey: randomUUID(),
      eventType: "push",
      headers: {},
      body: Buffer.from("{}"),
    },
  });
  const delivery = await db.delivery.create({
    data: { eventId: event.id, destinationId: forDestinationId, status },
  });
  await db.$executeRaw`
    UPDATE delivery SET next_attempt_at = now() + make_interval(secs => ${dueInSeconds}::double precision)
    WHERE id = ${delivery.id}::uuid`;
  return delivery.id;
}

function readAttempts(deliveryId: string) {
  return db.attempt.findMany({ where: { deliveryId }, orderBy: { startedAt: "asc" } });
}

async function expireLease(id: string) {
  await db.$executeRaw`
    UPDATE delivery SET locked_until = now() - interval '1 second' WHERE id = ${id}::uuid`;
}

function readDelivery(id: string) {
  return db.delivery.findUniqueOrThrow({ where: { id } });
}

async function secondsUntilUnlock(id: string) {
  const rows = await db.$queryRaw<{ seconds: number }[]>`
    SELECT extract(epoch FROM locked_until - now())::float8 AS seconds
    FROM delivery WHERE id = ${id}::uuid`;
  return rows[0]?.seconds;
}

async function reserveOnly(id: string): Promise<ReservedDelivery> {
  const reserved = await reserveDeliveries(db, reserveOptions);
  const delivery = reserved.find((candidate) => candidate.id === id);
  if (delivery === undefined) {
    throw new Error(`delivery ${id} was not reserved`);
  }
  return delivery;
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
  const endpoint = await db.endpoint.create({
    data: { slug: "github-main", name: "GitHub", signatureScheme: "none" },
  });
  endpointId = endpoint.id;
  const destination = await db.destination.create({
    data: {
      endpointId,
      url: "http://localhost:9999/hook",
      secretEncrypted: "x",
      eventTypes: ["*"],
    },
  });
  destinationId = destination.id;
}, 120_000);

beforeEach(async () => {
  await db.delivery.deleteMany();
  await db.event.deleteMany();
});

afterAll(async () => {
  await testDatabase.stop();
});

describe("reserveDeliveries", () => {
  it("takes only due pending deliveries, oldest first, up to the limit", async () => {
    const middle = await createDelivery("pending", -60);
    const oldest = await createDelivery("pending", -300);
    const newest = await createDelivery("pending", -10);
    await createDelivery("pending", 600);
    await createDelivery("succeeded");
    await createDelivery("dead");

    const reserved = await reserveDeliveries(db, { limit: 2, leaseSeconds: 60 });

    // o RETURNING não segue o ORDER BY da subconsulta; importa quais foram escolhidas
    expect(reserved.map((delivery) => delivery.id).sort()).toEqual([oldest, middle].sort());
    expect(reserved[0]).toMatchObject({ destinationId, attemptCount: 1 });
    expect(await readDelivery(oldest)).toMatchObject({ status: "in_progress", attemptCount: 1 });
    expect(await secondsUntilUnlock(oldest)).toBeGreaterThan(55);
    expect(await secondsUntilUnlock(oldest)).toBeLessThanOrEqual(60);
    expect((await readDelivery(newest)).status).toBe("pending");
  });

  it("does not hand out a delivery again while its lease is valid", async () => {
    await createDelivery();
    await reserveDeliveries(db, reserveOptions);

    const secondReservation = await reserveDeliveries(db, reserveOptions);

    expect(secondReservation).toEqual([]);
  });

  it("hands out a delivery abandoned by a dead worker once its lease expires", async () => {
    const id = await createDelivery();
    await reserveDeliveries(db, reserveOptions);
    await expireLease(id);

    const retaken = await reserveDeliveries(db, reserveOptions);

    expect(retaken).toHaveLength(1);
    expect(retaken[0]).toMatchObject({ id, attemptCount: 2 });
    expect(await secondsUntilUnlock(id)).toBeGreaterThan(55);
  });

  it("gives each delivery to exactly one of 4 workers reserving at the same time", async () => {
    const ids = await Promise.all(Array.from({ length: 120 }, () => createDelivery()));

    async function drainQueue() {
      const taken: ReservedDelivery[] = [];
      for (;;) {
        const batch = await reserveDeliveries(db, reserveOptions);
        if (batch.length === 0) return taken;
        taken.push(...batch);
      }
    }
    const takenByWorker = await Promise.all([
      drainQueue(),
      drainQueue(),
      drainQueue(),
      drainQueue(),
    ]);

    const allTaken = takenByWorker.flat();
    expect(allTaken).toHaveLength(ids.length);
    expect(new Set(allTaken.map((delivery) => delivery.id))).toEqual(new Set(ids));
    expect(allTaken.every((delivery) => delivery.attemptCount === 1)).toBe(true);
  });
});

describe("completeDelivery", () => {
  it("marks the delivery as succeeded and releases the lease", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);

    const applied = await completeDelivery(db, reserved, { attempt: anAttempt() });

    expect(applied).toBe(true);
    expect(await readDelivery(id)).toMatchObject({
      status: "succeeded",
      lockedUntil: null,
      lastError: null,
    });
    expect((await readDelivery(id)).succeededAt).not.toBeNull();
    expect(await reserveDeliveries(db, reserveOptions)).toEqual([]);
  });

  it("records the attempt with the status, snippet and duration, and no error", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);
    const startedAt = new Date("2026-10-03T12:00:00.000Z");

    await completeDelivery(db, reserved, {
      attempt: { startedAt, durationMs: 87, httpStatus: 200, responseSnippet: "ok" },
    });

    expect(await readAttempts(id)).toMatchObject([
      { startedAt, durationMs: 87, httpStatus: 200, responseSnippet: "ok", error: null },
    ]);
  });

  it("ignores a slow worker whose lease expired and was reserved again", async () => {
    const id = await createDelivery();
    const slowWorkerReservation = await reserveOnly(id);
    await expireLease(id);
    const newReservation = await reserveOnly(id);

    const slowApplied = await completeDelivery(db, slowWorkerReservation, {
      attempt: anAttempt(),
    });

    expect(slowApplied).toBe(false);
    expect(await readDelivery(id)).toMatchObject({ status: "in_progress", attemptCount: 2 });
    expect(await completeDelivery(db, newReservation, { attempt: anAttempt() })).toBe(true);
  });

  it("still records the attempt of a worker that lost its lease, because the send happened", async () => {
    const id = await createDelivery();
    const slowWorkerReservation = await reserveOnly(id);
    await expireLease(id);
    await reserveOnly(id);

    await completeDelivery(db, slowWorkerReservation, { attempt: anAttempt() });

    expect(await readAttempts(id)).toHaveLength(1);
  });

  it("does nothing when the delivery already succeeded", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);
    await completeDelivery(db, reserved, { attempt: anAttempt() });

    expect(await completeDelivery(db, reserved, { attempt: anAttempt() })).toBe(false);
  });
});

describe("rescheduleDelivery", () => {
  it("returns the delivery to pending, records the error and delays the next attempt", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);

    const applied = await rescheduleDelivery(db, reserved, {
      attempt: anAttempt(),
      error: "destination answered 503",
      retryInSeconds: 600,
    });

    expect(applied).toBe(true);
    expect(await readDelivery(id)).toMatchObject({
      status: "pending",
      lockedUntil: null,
      lastError: "destination answered 503",
      attemptCount: 1,
    });
    expect(await reserveDeliveries(db, reserveOptions)).toEqual([]);
  });

  it("records the failed attempt with its status and the reason as the error", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);

    await rescheduleDelivery(db, reserved, {
      attempt: anAttempt({ httpStatus: 503, responseSnippet: "upstream down" }),
      error: "destination answered 503",
      retryInSeconds: 600,
    });

    expect(await readAttempts(id)).toMatchObject([
      { httpStatus: 503, responseSnippet: "upstream down", error: "destination answered 503" },
    ]);
  });

  it("keeps one attempt per try, in order, as the delivery is retried", async () => {
    const id = await createDelivery();
    for (const startedAt of [new Date("2026-10-03T12:00:00Z"), new Date("2026-10-03T12:05:00Z")]) {
      const reserved = await reserveOnly(id);
      await rescheduleDelivery(db, reserved, {
        attempt: anAttempt({ startedAt }),
        error: "timeout",
        retryInSeconds: 0,
      });
      await db.$executeRaw`
        UPDATE delivery SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}::uuid`;
    }

    const attempts = await readAttempts(id);

    expect(attempts.map((attempt) => attempt.startedAt.toISOString())).toEqual([
      "2026-10-03T12:00:00.000Z",
      "2026-10-03T12:05:00.000Z",
    ]);
  });

  it("makes the delivery available again once the delay passes", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);
    await rescheduleDelivery(db, reserved, {
      attempt: anAttempt(),
      error: "timeout",
      retryInSeconds: 600,
    });
    await db.$executeRaw`
      UPDATE delivery SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}::uuid`;

    const retaken = await reserveDeliveries(db, reserveOptions);

    expect(retaken[0]).toMatchObject({ id, attemptCount: 2 });
  });

  it("ignores a slow worker that fails after the delivery was reserved again", async () => {
    const id = await createDelivery();
    const slowWorkerReservation = await reserveOnly(id);
    await expireLease(id);
    await reserveOnly(id);

    const applied = await rescheduleDelivery(db, slowWorkerReservation, {
      attempt: anAttempt(),
      error: "late failure",
      retryInSeconds: 10,
    });

    expect(applied).toBe(false);
    expect(await readDelivery(id)).toMatchObject({ status: "in_progress", lastError: null });
  });
});

describe("releaseDelivery", () => {
  async function secondsUntilDue(id: string) {
    const rows = await db.$queryRaw<{ seconds: number }[]>`
      SELECT extract(epoch FROM next_attempt_at - now())::float8 AS seconds
      FROM delivery WHERE id = ${id}::uuid`;
    return rows[0]?.seconds;
  }

  async function makeDue(id: string) {
    await db.$executeRaw`
      UPDATE delivery SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}::uuid`;
  }

  it("returns the delivery to pending without counting the attempt or recording one", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);

    const applied = await releaseDelivery(db, reserved, { retryInSeconds: 300 });

    expect(applied).toBe(true);
    expect(await readDelivery(id)).toMatchObject({
      status: "pending",
      attemptCount: 0,
      lockedUntil: null,
      lastError: null,
    });
    expect(await secondsUntilDue(id)).toBeGreaterThan(295);
    expect(await secondsUntilDue(id)).toBeLessThanOrEqual(300);
    expect(await readAttempts(id)).toEqual([]);
    expect(await reserveDeliveries(db, reserveOptions)).toEqual([]);
  });

  it("is reserved again with the same attempt number once it is due", async () => {
    const id = await createDelivery();
    await releaseDelivery(db, await reserveOnly(id), { retryInSeconds: 300 });
    await makeDue(id);

    const retaken = await reserveDeliveries(db, reserveOptions);

    expect(retaken).toMatchObject([{ id, attemptCount: 1 }]);
  });

  it("ignores a worker whose lease was lost", async () => {
    const id = await createDelivery();
    const slowWorkerReservation = await reserveOnly(id);
    await expireLease(id);
    await reserveOnly(id);

    const applied = await releaseDelivery(db, slowWorkerReservation, { retryInSeconds: 300 });

    expect(applied).toBe(false);
    expect(await readDelivery(id)).toMatchObject({ status: "in_progress", attemptCount: 2 });
  });

  it("keeps a stale reservation from touching the delivery after others released and took it again", async () => {
    const id = await createDelivery();
    const staleReservation = await reserveOnly(id);
    await expireLease(id);
    await releaseDelivery(db, await reserveOnly(id), { retryInSeconds: 0 });
    await makeDue(id);
    await reserveOnly(id);

    const applied = await completeDelivery(db, staleReservation, { attempt: anAttempt() });

    expect(applied).toBe(false);
    expect(await readDelivery(id)).toMatchObject({ status: "in_progress", attemptCount: 2 });
  });
});

describe("buryDelivery", () => {
  it("moves the delivery to dead, keeps the reason and releases the lease", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);

    const applied = await buryDelivery(db, reserved, {
      attempt: anAttempt({ httpStatus: 404 }),
      error: "destination answered 404",
      deactivateDestination: false,
    });

    expect(applied).toBe(true);
    expect(await readDelivery(id)).toMatchObject({
      status: "dead",
      lockedUntil: null,
      lastError: "destination answered 404",
      attemptCount: 1,
      succeededAt: null,
    });
    expect(await readAttempts(id)).toMatchObject([
      { httpStatus: 404, error: "destination answered 404" },
    ]);
    await db.$executeRaw`UPDATE delivery SET next_attempt_at = now() - interval '1 hour'`;
    expect(await reserveDeliveries(db, reserveOptions)).toEqual([]);
  });

  it("leaves the destination and its other deliveries alone when no deactivation is asked", async () => {
    const destination = await createDestination();
    const buried = await createDelivery("pending", -60, destination.id);
    const sibling = await createDelivery("pending", -30, destination.id);
    const reserved = await reserveOnly(buried);

    await buryDelivery(db, reserved, {
      attempt: anAttempt({ httpStatus: 400 }),
      error: "destination answered 400",
      deactivateDestination: false,
    });

    expect((await readDelivery(sibling)).status).toBe("in_progress");
    expect(await db.destination.findUniqueOrThrow({ where: { id: destination.id } })).toMatchObject(
      { isActive: true },
    );
  });

  it("on a 410 deactivates the destination and buries only its pending deliveries", async () => {
    const gone = await createDestination();
    const other = await createDestination();
    const first = await createDelivery("pending", -60, gone.id);
    const waiting = await createDelivery("pending", 3600, gone.id);
    const alreadySucceeded = await createDelivery("succeeded", -60, gone.id);
    const beingSent = await createDelivery("in_progress", -60, gone.id);
    const ofAnotherDestination = await createDelivery("pending", 3600, other.id);
    await db.$executeRaw`UPDATE delivery SET locked_until = now() + interval '60 seconds' WHERE id = ${beingSent}::uuid`;
    const reserved = await reserveOnly(first);

    const applied = await buryDelivery(db, reserved, {
      attempt: anAttempt({ httpStatus: 410 }),
      error: "destination answered 410, destination deactivated",
      deactivateDestination: true,
    });

    expect(applied).toBe(true);
    expect(await db.destination.findUniqueOrThrow({ where: { id: gone.id } })).toMatchObject({
      isActive: false,
    });
    expect(await db.destination.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({
      isActive: true,
    });
    expect(await readDelivery(first)).toMatchObject({
      status: "dead",
      lastError: "destination answered 410, destination deactivated",
    });
    expect(await readDelivery(waiting)).toMatchObject({
      status: "dead",
      lastError: "destination deactivated after a 410 answer",
    });
    expect((await readDelivery(alreadySucceeded)).status).toBe("succeeded");
    expect((await readDelivery(beingSent)).status).toBe("in_progress");
    expect((await readDelivery(ofAnotherDestination)).status).toBe("pending");
    expect(await readAttempts(waiting)).toEqual([]);
  });

  it("changes nothing about the destination when the worker had already lost its lease", async () => {
    const destination = await createDestination();
    const id = await createDelivery("pending", -60, destination.id);
    const waiting = await createDelivery("pending", 3600, destination.id);
    const slowWorkerReservation = await reserveOnly(id);
    await expireLease(id);
    await reserveOnly(id);

    const applied = await buryDelivery(db, slowWorkerReservation, {
      attempt: anAttempt({ httpStatus: 410 }),
      error: "destination answered 410, destination deactivated",
      deactivateDestination: true,
    });

    expect(applied).toBe(false);
    expect(await readDelivery(id)).toMatchObject({ status: "in_progress", lastError: null });
    expect((await readDelivery(waiting)).status).toBe("pending");
    expect(await db.destination.findUniqueOrThrow({ where: { id: destination.id } })).toMatchObject(
      { isActive: true },
    );
    expect(await readAttempts(id)).toHaveLength(1);
  });
});

describe("recording the result and the attempt together", () => {
  // não cabe num INTEGER de 32 bits: o INSERT do Attempt falha depois de o UPDATE da entrega já ter rodado
  const unwritableAttempt = anAttempt({ durationMs: 2 ** 31 });

  it.each([
    [
      "completeDelivery",
      (reserved: ReservedDelivery) =>
        completeDelivery(db, reserved, { attempt: unwritableAttempt }),
    ],
    [
      "rescheduleDelivery",
      (reserved: ReservedDelivery) =>
        rescheduleDelivery(db, reserved, {
          attempt: unwritableAttempt,
          error: "boom",
          retryInSeconds: 10,
        }),
    ],
    [
      "buryDelivery",
      (reserved: ReservedDelivery) =>
        buryDelivery(db, reserved, {
          attempt: unwritableAttempt,
          error: "boom",
          deactivateDestination: false,
        }),
    ],
  ])("%s leaves the delivery untouched if the attempt cannot be written", async (_name, record) => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);

    await expect(record(reserved)).rejects.toThrow();

    expect(await readDelivery(id)).toMatchObject({
      status: "in_progress",
      lastError: null,
      succeededAt: null,
    });
    expect(await readAttempts(id)).toEqual([]);
  });
});

describe("checkQueue", () => {
  it("counts the deliveries ready to send, including those abandoned with an expired lease", async () => {
    const abandoned = await createDelivery("pending", -30);
    await reserveOnly(abandoned);
    await expireLease(abandoned);
    await createDelivery("pending", -60);
    await createDelivery("pending", -5);
    await createDelivery("pending", 600);
    await createDelivery("succeeded");
    await createDelivery("dead");

    expect(await checkQueue(db)).toEqual({ status: "ok", depth: 3 });
  });

  it("does not count a delivery whose lease is still valid", async () => {
    const reserved = await createDelivery();
    await reserveOnly(reserved);

    expect(await checkQueue(db)).toEqual({ status: "ok", depth: 0 });
  });
});
