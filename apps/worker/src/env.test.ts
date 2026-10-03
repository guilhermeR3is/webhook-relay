import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const validEnv = {
  DATABASE_URL: "postgresql://relay:relay@localhost:5433/relay",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("loadEnv", () => {
  it("applies defaults for optional variables", () => {
    expect(loadEnv(validEnv)).toMatchObject({
      WORKER_PORT: 3001,
      WORKER_POLL_INTERVAL_MS: 1000,
      LOG_LEVEL: "info",
      GIT_COMMIT: "unknown",
    });
  });

  it("converts the port to a number", () => {
    expect(loadEnv({ ...validEnv, WORKER_PORT: "4100" }).WORKER_PORT).toBe(4100);
  });

  it("rejects a poll interval that would hammer the database", () => {
    expect(() => loadEnv({ ...validEnv, WORKER_POLL_INTERVAL_MS: "10" })).toThrow(
      /WORKER_POLL_INTERVAL_MS/,
    );
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadEnv({ ENCRYPTION_KEY: validEnv.ENCRYPTION_KEY })).toThrow(/DATABASE_URL/);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    const shortKey = Buffer.alloc(16, 1).toString("base64");

    expect(() => loadEnv({ ...validEnv, ENCRYPTION_KEY: shortKey })).toThrow(/32 bytes/);
  });

  it("rejects an unknown log level", () => {
    expect(() => loadEnv({ ...validEnv, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});
