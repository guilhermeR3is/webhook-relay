import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type Db } from "./client.js";
import { encryptSecret } from "./crypto.js";

const migrationsDir = join(import.meta.dirname, "../prisma/migrations");

async function applyMigrations(db: Db) {
  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrationNames) {
    await db.$executeRawUnsafe(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
  }
}

export type TestDatabase = Awaited<ReturnType<typeof startTestDatabase>>;

export async function startTestDatabase() {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const connectionUri = container.getConnectionUri();
  const db = createDb(connectionUri);
  await applyMigrations(db);

  return {
    db,
    connectionUri,
    async stop() {
      await db.$disconnect();
      await container.stop();
    },
  };
}

export const testEncryptionKey = Buffer.alloc(32, 7);
export const testDestinationSecret = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;

type SeedOptions = {
  destinationUrl?: string;
  destinationSecret?: string;
  headers?: Record<string, string>;
  body?: Uint8Array<ArrayBuffer>;
};

export async function seedDeliveries(
  db: Db,
  count: number,
  {
    destinationUrl = "http://localhost:9999/hook",
    destinationSecret = testDestinationSecret,
    headers = {},
    body = Buffer.from("{}"),
  }: SeedOptions = {},
) {
  const endpoint = await db.endpoint.create({
    data: { slug: randomUUID(), name: "seed", signatureScheme: "none" },
  });
  const destination = await db.destination.create({
    data: {
      endpointId: endpoint.id,
      url: destinationUrl,
      secretEncrypted: encryptSecret(destinationSecret, testEncryptionKey),
      eventTypes: ["*"],
    },
  });
  const events = await db.event.createManyAndReturn({
    data: Array.from({ length: count }, () => ({
      endpointId: endpoint.id,
      idempotencyKey: randomUUID(),
      eventType: "push",
      headers,
      body,
    })),
    select: { id: true },
  });
  const deliveries = await db.delivery.createManyAndReturn({
    data: events.map(({ id }) => ({ eventId: id, destinationId: destination.id })),
    select: { id: true },
  });
  const deliveryIds = deliveries.map(({ id }) => id);
  // o banco arredonda o default para o milissegundo; vencidas há um minuto, nenhuma reserva chega cedo demais
  await db.$executeRaw`
    UPDATE delivery SET next_attempt_at = now() - interval '1 minute'
    WHERE id = ANY(${deliveryIds}::uuid[])`;
  return deliveryIds;
}
