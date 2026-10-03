import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client.js";
import { saveEvent, type NewEvent } from "./events.js";

const migrationsDir = join(import.meta.dirname, "../prisma/migrations");

let container: StartedPostgreSqlContainer;
let db: Db;
let endpointId: string;

async function applyMigrations() {
  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrationNames) {
    await db.$executeRawUnsafe(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
  }
}

function newEvent(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    endpointId,
    idempotencyKey: "key-1",
    eventType: "push",
    headers: { "content-type": "application/json" },
    body: Buffer.from('{"ok":true}'),
    ...overrides,
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  db = createDb(container.getConnectionUri());
  await applyMigrations();
  const endpoint = await db.endpoint.create({
    data: { slug: "github-main", name: "GitHub", signatureScheme: "none" },
  });
  endpointId = endpoint.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
  await container.stop();
});

describe("saveEvent", () => {
  it("stores a new event and keeps the body byte for byte", async () => {
    const body = Buffer.from([0xff, 0x00, 0xfe, 0x80, 0x0a, 0x7b]);

    const saved = await saveEvent(db, newEvent({ idempotencyKey: "binary", body }));

    expect(saved.created).toBe(true);
    const row = await db.event.findUniqueOrThrow({ where: { id: saved.id } });
    expect(Buffer.compare(row.body, body)).toBe(0);
    expect(row.headers).toEqual({ "content-type": "application/json" });
    expect(row.eventType).toBe("push");
  });

  it("returns the original id and keeps the original event when the key repeats", async () => {
    const first = await saveEvent(db, newEvent({ idempotencyKey: "repeat" }));
    const second = await saveEvent(
      db,
      newEvent({ idempotencyKey: "repeat", body: Buffer.from("different"), eventType: "other" }),
    );

    expect(second).toEqual({ id: first.id, created: false });
    const rows = await db.event.findMany({ where: { endpointId, idempotencyKey: "repeat" } });
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]?.body ?? []).toString()).toBe('{"ok":true}');
    expect(rows[0]?.eventType).toBe("push");
  });

  it("treats the same key on another endpoint as a different event", async () => {
    const other = await db.endpoint.create({
      data: { slug: "other", name: "Other", signatureScheme: "none" },
    });

    const first = await saveEvent(db, newEvent({ idempotencyKey: "shared" }));
    const second = await saveEvent(
      db,
      newEvent({ idempotencyKey: "shared", endpointId: other.id }),
    );

    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  it("creates exactly one event when 20 requests with the same key arrive at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => saveEvent(db, newEvent({ idempotencyKey: "race" }))),
    );

    expect(results.filter((saved) => saved.created)).toHaveLength(1);
    expect(new Set(results.map((saved) => saved.id)).size).toBe(1);
    const rows = await db.event.findMany({ where: { endpointId, idempotencyKey: "race" } });
    expect(rows).toHaveLength(1);
  });
});
