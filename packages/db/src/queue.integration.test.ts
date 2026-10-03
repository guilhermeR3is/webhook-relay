import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import type { DeliveryStatus } from "./generated/enums.js";
import { checkQueue } from "./health.js";
import {
  completeDelivery,
  reserveDeliveries,
  rescheduleDelivery,
  type ReservedDelivery,
} from "./queue.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

const reserveOptions = { limit: 10, leaseSeconds: 60 };

let testDatabase: TestDatabase;
let db: Db;
let endpointId: string;
let destinationId: string;

// o banco arredonda o default para o milissegundo, então a entrega nova já nasce vencida há um minuto
async function createDelivery(status: DeliveryStatus = "pending", dueInSeconds = -60) {
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
    data: { eventId: event.id, destinationId, status },
  });
  await db.$executeRaw`
    UPDATE delivery SET next_attempt_at = now() + make_interval(secs => ${dueInSeconds}::double precision)
    WHERE id = ${delivery.id}::uuid`;
  return delivery.id;
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

    const applied = await completeDelivery(db, reserved);

    expect(applied).toBe(true);
    expect(await readDelivery(id)).toMatchObject({
      status: "succeeded",
      lockedUntil: null,
      lastError: null,
    });
    expect((await readDelivery(id)).succeededAt).not.toBeNull();
    expect(await reserveDeliveries(db, reserveOptions)).toEqual([]);
  });

  it("ignores a slow worker whose lease expired and was reserved again", async () => {
    const id = await createDelivery();
    const slowWorkerReservation = await reserveOnly(id);
    await expireLease(id);
    const newReservation = await reserveOnly(id);

    const slowApplied = await completeDelivery(db, slowWorkerReservation);

    expect(slowApplied).toBe(false);
    expect(await readDelivery(id)).toMatchObject({ status: "in_progress", attemptCount: 2 });
    expect(await completeDelivery(db, newReservation)).toBe(true);
  });

  it("does nothing when the delivery already succeeded", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);
    await completeDelivery(db, reserved);

    expect(await completeDelivery(db, reserved)).toBe(false);
  });
});

describe("rescheduleDelivery", () => {
  it("returns the delivery to pending, records the error and delays the next attempt", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);

    const applied = await rescheduleDelivery(db, reserved, {
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

  it("makes the delivery available again once the delay passes", async () => {
    const id = await createDelivery();
    const reserved = await reserveOnly(id);
    await rescheduleDelivery(db, reserved, { error: "timeout", retryInSeconds: 600 });
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
      error: "late failure",
      retryInSeconds: 10,
    });

    expect(applied).toBe(false);
    expect(await readDelivery(id)).toMatchObject({ status: "in_progress", lastError: null });
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
