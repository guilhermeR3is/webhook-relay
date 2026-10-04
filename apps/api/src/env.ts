import { isIP } from "node:net";
import { z } from "zod";

const TRUSTED_KEYWORDS = ["loopback", "linklocal", "uniquelocal"];

// o Fastify só aceita lista de endereços, faixas ou estes nomes: contar saltos foi desativado por segurança
function isTrustedProxyEntry(entry: string) {
  if (TRUSTED_KEYWORDS.includes(entry)) return true;
  const [address = "", prefix, ...rest] = entry.split("/");
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^\d+$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128);
}

const trustProxy = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  )
  .pipe(
    z.array(
      z.string().refine(isTrustedProxyEntry, {
        error: "must be an IP, an IP/prefix or one of loopback, linklocal, uniquelocal",
      }),
    ),
  )
  .transform((entries) => (entries.length === 0 ? false : entries));

const envSchema = z.object({
  DATABASE_URL: z.url(),
  ENCRYPTION_KEY: z.base64().refine((key) => Buffer.from(key, "base64").length === 32, {
    error: "must decode to exactly 32 bytes",
  }),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DEMO_ENDPOINT_SLUG: z.string().min(1).default("demo"),
  TRUST_PROXY: trustProxy,
  DEMO_QUOTA_SALT: z.string().min(16),
  PANEL_ORIGIN: z
    .url()
    .transform((value) => new URL(value).origin)
    .default("http://localhost:3100"),
  METRICS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
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
