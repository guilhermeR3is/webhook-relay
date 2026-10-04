import { parseArgs } from "node:util";
import { createDb } from "@relay/db";
import { redactDestinationUrl } from "./destination-url.js";
import { addEndpoint, loadAddEndpointEnv, parseAddEndpointArgs } from "./endpoint-add.js";

async function main() {
  const env = loadAddEndpointEnv();
  const { values } = parseArgs({
    options: {
      slug: { type: "string" },
      name: { type: "string" },
      scheme: { type: "string" },
      "destination-url": { type: "string" },
      "event-types": { type: "string" },
    },
  });
  const args = parseAddEndpointArgs(values);

  const db = createDb(env.DATABASE_URL);
  try {
    const added = await addEndpoint(db, {
      ...args,
      encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64"),
    });
    const report = {
      action: "created",
      databaseHost: new URL(env.DATABASE_URL).host,
      ingestPath: `/in/${args.slug}`,
      scheme: args.scheme,
      eventTypes: args.eventTypes,
      destinationUrl: redactDestinationUrl(args.destinationUrl),
      ...added,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.stderr.write("Guarde os segredos agora: o banco só guarda a versão cifrada.\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
