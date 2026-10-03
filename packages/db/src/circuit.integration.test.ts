import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admitSend,
  FAILURE_THRESHOLD,
  OPEN_SECONDS,
  PROBE_LEASE_SECONDS,
  PROBE_RETRY_SECONDS,
  recordAlive,
  recordFailure,
} from "./circuit.js";
import { createDb, type Db } from "./client.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

const t0 = new Date("2026-10-03T12:00:00.000Z");

function at(secondsAfterT0: number) {
  return new Date(t0.getTime() + secondsAfterT0 * 1000);
}

let testDatabase: TestDatabase;
let db: Db;
let secondWorkerDb: Db;
let endpointId: string;

async function createDestination() {
  const destination = await db.destination.create({
    data: {
      endpointId,
      url: `http://localhost:9999/${randomUUID()}`,
      secretEncrypted: "x",
      eventTypes: ["*"],
    },
  });
  return destination.id;
}

function readCircuit(id: string) {
  return db.destination.findUniqueOrThrow({
    where: { id },
    select: { circuitState: true, consecutiveFailures: true, circuitOpenedAt: true },
  });
}

async function failTimes(id: string, times: number, now = t0) {
  for (let failure = 0; failure < times; failure += 1) {
    await recordFailure(db, id, { now });
  }
}

async function createOpenCircuit() {
  const id = await createDestination();
  await failTimes(id, FAILURE_THRESHOLD);
  return id;
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  db = testDatabase.db;
  secondWorkerDb = createDb(testDatabase.connectionUri);
  const endpoint = await db.endpoint.create({
    data: { slug: "github-main", name: "GitHub", signatureScheme: "none" },
  });
  endpointId = endpoint.id;
}, 120_000);

afterAll(async () => {
  await secondWorkerDb.$disconnect();
  await testDatabase.stop();
});

describe("recordFailure", () => {
  it("keeps the circuit closed below the threshold and counts each failure", async () => {
    const id = await createDestination();

    await failTimes(id, FAILURE_THRESHOLD - 1);

    expect(await readCircuit(id)).toEqual({
      circuitState: "closed",
      consecutiveFailures: FAILURE_THRESHOLD - 1,
      circuitOpenedAt: null,
    });
  });

  it("opens the circuit on the fifth consecutive failure and stamps the time it was given", async () => {
    const id = await createDestination();
    await failTimes(id, FAILURE_THRESHOLD - 1);

    const state = await recordFailure(db, id, { now: t0 });

    expect(state).toBe("open");
    expect(await readCircuit(id)).toEqual({
      circuitState: "open",
      consecutiveFailures: FAILURE_THRESHOLD,
      circuitOpenedAt: t0,
    });
  });

  it("does not push the end of the pause forward when late failures arrive while open", async () => {
    const id = await createOpenCircuit();

    const state = await recordFailure(db, id, { now: at(100) });

    expect(state).toBe("open");
    expect(await readCircuit(id)).toMatchObject({
      consecutiveFailures: FAILURE_THRESHOLD + 1,
      circuitOpenedAt: t0,
    });
  });

  it("loses no failure when two workers report at the same time", async () => {
    const id = await createDestination();
    const reportFrom = (worker: Db) =>
      Array.from({ length: 20 }, () => recordFailure(worker, id, { now: t0 }));

    await Promise.all([...reportFrom(db), ...reportFrom(secondWorkerDb)]);

    expect(await readCircuit(id)).toMatchObject({
      circuitState: "open",
      consecutiveFailures: 40,
    });
  });

  it("fails clearly for a destination that does not exist", async () => {
    await expect(recordFailure(db, randomUUID())).rejects.toThrow(/not found/);
  });
});

describe("recordAlive", () => {
  it("resets the count, so five failures in a row have to start over", async () => {
    const id = await createDestination();
    await failTimes(id, FAILURE_THRESHOLD - 1);

    await recordAlive(db, id);
    await failTimes(id, FAILURE_THRESHOLD - 1);

    expect(await readCircuit(id)).toMatchObject({
      circuitState: "closed",
      consecutiveFailures: FAILURE_THRESHOLD - 1,
    });
  });

  it("closes the circuit when the probe gets an answer", async () => {
    const id = await createOpenCircuit();
    await admitSend(db, id, { now: at(OPEN_SECONDS) });

    await recordAlive(db, id);

    expect(await readCircuit(id)).toEqual({
      circuitState: "closed",
      consecutiveFailures: 0,
      circuitOpenedAt: null,
    });
  });

  it("does not close an open circuit because of an answer to a send made before it opened", async () => {
    const id = await createOpenCircuit();

    await recordAlive(db, id);

    expect(await readCircuit(id)).toEqual({
      circuitState: "open",
      consecutiveFailures: 0,
      circuitOpenedAt: t0,
    });
  });
});

describe("admitSend", () => {
  it("lets the send through while the circuit is closed", async () => {
    const id = await createDestination();
    await failTimes(id, FAILURE_THRESHOLD - 1);

    expect(await admitSend(db, id, { now: t0 })).toEqual({ kind: "send" });
  });

  it("makes the delivery wait for what is left of the pause while the circuit is open", async () => {
    const id = await createOpenCircuit();

    expect(await admitSend(db, id, { now: at(100) })).toEqual({
      kind: "wait",
      retryInSeconds: OPEN_SECONDS - 100,
    });
    expect(await admitSend(db, id, { now: at(OPEN_SECONDS - 1) })).toEqual({
      kind: "wait",
      retryInSeconds: 1,
    });
    expect((await readCircuit(id)).circuitState).toBe("open");
  });

  it("gives the probe to the first delivery once the pause is over", async () => {
    const id = await createOpenCircuit();

    const admission = await admitSend(db, id, { now: at(OPEN_SECONDS) });

    expect(admission).toEqual({ kind: "probe" });
    expect(await readCircuit(id)).toMatchObject({
      circuitState: "half_open",
      circuitOpenedAt: at(OPEN_SECONDS),
    });
  });

  it("makes the other deliveries wait while the probe is running", async () => {
    const id = await createOpenCircuit();
    await admitSend(db, id, { now: at(OPEN_SECONDS) });

    expect(await admitSend(db, id, { now: at(OPEN_SECONDS + 1) })).toEqual({
      kind: "wait",
      retryInSeconds: PROBE_RETRY_SECONDS,
    });
  });

  it("opens a full new pause when the probe fails", async () => {
    const id = await createOpenCircuit();
    await admitSend(db, id, { now: at(OPEN_SECONDS) });

    const state = await recordFailure(db, id, { now: at(OPEN_SECONDS + 2) });

    expect(state).toBe("open");
    expect(await readCircuit(id)).toMatchObject({ circuitOpenedAt: at(OPEN_SECONDS + 2) });
    expect(await admitSend(db, id, { now: at(OPEN_SECONDS + 3) })).toEqual({
      kind: "wait",
      retryInSeconds: OPEN_SECONDS - 1,
    });
  });

  it("hands the probe to someone else when the worker running it died", async () => {
    const id = await createOpenCircuit();
    await admitSend(db, id, { now: at(OPEN_SECONDS) });

    expect(await admitSend(db, id, { now: at(OPEN_SECONDS + PROBE_LEASE_SECONDS - 1) })).toEqual({
      kind: "wait",
      retryInSeconds: PROBE_RETRY_SECONDS,
    });
    expect(await admitSend(db, id, { now: at(OPEN_SECONDS + PROBE_LEASE_SECONDS) })).toEqual({
      kind: "probe",
    });
  });

  it("gives the probe to exactly one of two workers asking at the same time", async () => {
    const id = await createOpenCircuit();
    const askFrom = (worker: Db) =>
      Array.from({ length: 10 }, () => admitSend(worker, id, { now: at(OPEN_SECONDS + 1) }));

    const admissions = await Promise.all([...askFrom(db), ...askFrom(secondWorkerDb)]);

    expect(admissions.filter((admission) => admission.kind === "probe")).toHaveLength(1);
    expect(admissions.filter((admission) => admission.kind === "wait")).toEqual(
      Array.from({ length: 19 }, () => ({ kind: "wait", retryInSeconds: PROBE_RETRY_SECONDS })),
    );
  });

  it("uses the database clock when no time is given", async () => {
    const id = await createDestination();
    for (let failure = 0; failure < FAILURE_THRESHOLD; failure += 1) {
      await recordFailure(db, id);
    }

    const admission = await admitSend(db, id);

    expect(admission.kind).toBe("wait");
    if (admission.kind === "wait") {
      expect(admission.retryInSeconds).toBeGreaterThan(OPEN_SECONDS - 5);
      expect(admission.retryInSeconds).toBeLessThanOrEqual(OPEN_SECONDS);
    }
  });

  it("fails clearly for a destination that does not exist", async () => {
    await expect(admitSend(db, randomUUID())).rejects.toThrow(/not found/);
  });
});
