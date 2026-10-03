import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  ENCRYPTION_KEY: z.base64().refine((key) => Buffer.from(key, "base64").length === 32, {
    error: "must decode to exactly 32 bytes",
  }),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  GIT_COMMIT: z.string().min(1).default("unknown"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
