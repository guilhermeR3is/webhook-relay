import { createDb } from "@relay/db";
import { loadSeedEnv, seedDemo } from "./demo-seed.js";

const env = loadSeedEnv();
const db = createDb(env.DATABASE_URL);

try {
  const seeded = await seedDemo(db, {
    slug: env.DEMO_ENDPOINT_SLUG,
    publicApiUrl: env.PUBLIC_API_URL,
    encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64"),
  });
  const report = { action: "ready", databaseHost: new URL(env.DATABASE_URL).host, ...seeded };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stderr.write("Guarde o endpointSecret agora: o banco só guarda a versão cifrada.\n");
} finally {
  await db.$disconnect();
}
