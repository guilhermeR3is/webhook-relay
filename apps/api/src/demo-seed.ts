import { randomBytes } from "node:crypto";
import { encryptSecret, type Db } from "@relay/db";
import { z } from "zod";

const seedEnvSchema = z.object({
  DATABASE_URL: z.url(),
  ENCRYPTION_KEY: z.base64().refine((key) => Buffer.from(key, "base64").length === 32, {
    error: "must decode to exactly 32 bytes",
  }),
  DEMO_ENDPOINT_SLUG: z.string().min(1).default("demo"),
  // sem valor padrão: um seed em produção apontando para localhost faria o worker recusar todas as entregas
  PUBLIC_API_URL: z.url(),
});

export function loadSeedEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = seedEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

type SeedDemoOptions = {
  slug: string;
  publicApiUrl: string;
  encryptionKey: Buffer;
};

export async function seedDemo(db: Db, { slug, publicApiUrl, encryptionKey }: SeedDemoOptions) {
  const endpointSecret = randomBytes(32).toString("hex");
  const flakyDestinationSecret = `whsec_${randomBytes(32).toString("base64")}`;
  const flakyUrl = new URL("/demo/flaky", publicApiUrl).href;

  const endpoint = await db.$transaction(async (tx) => {
    // os eventos primeiro: a chave estrangeira do endpoint é Restrict e as entregas saem em cascata
    await tx.event.deleteMany({ where: { endpoint: { slug } } });
    await tx.endpoint.deleteMany({ where: { slug } });
    await tx.demoQuota.deleteMany();

    return tx.endpoint.create({
      data: {
        slug,
        name: "Demonstração",
        signatureScheme: "generic_hmac",
        secretEncrypted: encryptSecret(endpointSecret, encryptionKey),
        destinations: {
          create: {
            url: flakyUrl,
            secretEncrypted: encryptSecret(flakyDestinationSecret, encryptionKey),
            eventTypes: ["demo.test"],
          },
        },
      },
    });
  });

  return { endpointId: endpoint.id, endpointSecret, flakyUrl };
}
