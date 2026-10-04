import { createDb } from "@relay/db";
import { loadSeedEnv } from "./env.ts";
import { createLoadTarget, removeLoadTarget } from "./load-target.ts";

const env = loadSeedEnv();
const db = createDb(env.DATABASE_URL);

try {
  const report =
    process.argv[2] === "unseed"
      ? { action: "removed", ...(await removeLoadTarget(db)) }
      : {
          action: "ready",
          ...(await createLoadTarget(db, {
            encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64"),
            destinationUrl: env.LOAD_DESTINATION_URL,
          })),
        };
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await db.$disconnect();
}
