import { z } from "zod";

const receiverSchema = z.object({
  RECEIVER_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  RECEIVER_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(0),
});

const seedSchema = z.object({
  DATABASE_URL: z.url(),
  ENCRYPTION_KEY: z.base64().refine((key) => Buffer.from(key, "base64").length === 32, {
    error: "must decode to exactly 32 bytes",
  }),
  LOAD_DESTINATION_URL: z.url().default("http://receiver:4000/hook"),
});

const positiveInt = (fallback: number) => z.coerce.number().int().min(1).default(fallback);

const chaosSchema = seedSchema
  .extend({
    RECEIVER_URL: z.url().default("http://localhost:4000"),
    CHAOS_RECEIVER_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(100),
    CHAOS_RATE: positiveInt(200),
    CHAOS_DURATION_SECONDS: positiveInt(120),
    CHAOS_KILL_AFTER_SECONDS: positiveInt(45),
    CHAOS_DOWN_SECONDS: positiveInt(10),
    CHAOS_SETTLE_TIMEOUT_SECONDS: positiveInt(900),
  })
  .refine((env) => env.CHAOS_KILL_AFTER_SECONDS < env.CHAOS_DURATION_SECONDS, {
    path: ["CHAOS_KILL_AFTER_SECONDS"],
    error:
      "must be shorter than CHAOS_DURATION_SECONDS, or the worker would not die during the load",
  });

function parseEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function loadReceiverEnv(source: NodeJS.ProcessEnv = process.env) {
  return parseEnv(receiverSchema, source);
}

export function loadSeedEnv(source: NodeJS.ProcessEnv = process.env) {
  return parseEnv(seedSchema, source);
}

export function loadChaosEnv(source: NodeJS.ProcessEnv = process.env) {
  return parseEnv(chaosSchema, source);
}
