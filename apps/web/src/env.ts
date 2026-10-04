import { z } from "zod";

const envSchema = z.object({
  API_URL: z.url().default("http://localhost:3000"),
  PUBLIC_API_URL: z.url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
