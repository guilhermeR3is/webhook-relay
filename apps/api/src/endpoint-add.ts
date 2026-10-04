import { randomBytes } from "node:crypto";
import { encryptSecret, type Db } from "@relay/db";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  ENCRYPTION_KEY: z.base64().refine((key) => Buffer.from(key, "base64").length === 32, {
    error: "must decode to exactly 32 bytes",
  }),
});

export function loadAddEndpointEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

const argsSchema = z.object({
  // o slug vira parte do caminho público /in/:slug
  slug: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      error: "use lowercase letters, digits and single hyphens",
    }),
  name: z.string().min(1).optional(),
  scheme: z.enum(["none", "generic_hmac", "github"]).default("generic_hmac"),
  // só o protocolo: o httpUrl() do zod exige domínio com extensão e recusaria localhost, usado em desenvolvimento
  "destination-url": z.url({ protocol: /^https?$/ }),
  "event-types": z
    .string()
    .default("*")
    .transform((list) => list.split(",").map((type) => type.trim()))
    .pipe(z.array(z.string().regex(/^[\w.*-]+$/, { error: "invalid event type" })).min(1)),
});

export function parseAddEndpointArgs(values: Record<string, string | undefined>) {
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) {
    throw new Error(`Invalid arguments:\n${z.prettifyError(parsed.error)}`);
  }
  const args = parsed.data;
  return {
    slug: args.slug,
    name: args.name ?? args.slug,
    scheme: args.scheme,
    destinationUrl: args["destination-url"],
    eventTypes: args["event-types"],
  };
}

type AddEndpointOptions = ReturnType<typeof parseAddEndpointArgs> & { encryptionKey: Buffer };

function isUniqueViolation(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "P2002";
}

export async function addEndpoint(
  db: Db,
  { slug, name, scheme, destinationUrl, eventTypes, encryptionKey }: AddEndpointOptions,
) {
  const endpointSecret = scheme === "none" ? null : randomBytes(32).toString("hex");
  const destinationSecret = `whsec_${randomBytes(32).toString("base64")}`;

  try {
    const endpoint = await db.endpoint.create({
      data: {
        slug,
        name,
        signatureScheme: scheme,
        secretEncrypted:
          endpointSecret === null ? null : encryptSecret(endpointSecret, encryptionKey),
        destinations: {
          create: {
            url: destinationUrl,
            secretEncrypted: encryptSecret(destinationSecret, encryptionKey),
            eventTypes,
          },
        },
      },
      include: { destinations: { select: { id: true } } },
    });
    return {
      endpointId: endpoint.id,
      destinationId: endpoint.destinations[0]?.id ?? "",
      endpointSecret,
      destinationSecret,
    };
  } catch (error) {
    // a restrição única do banco decide; assim não sobrescrevemos o segredo de um endpoint que já existe
    if (isUniqueViolation(error)) {
      throw new Error(`An endpoint with slug "${slug}" already exists; nothing was changed`, {
        cause: error,
      });
    }
    throw error;
  }
}
