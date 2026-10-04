import { describe, expect, it } from "vitest";
import { loadSeedEnv } from "./demo-seed.js";

const base = {
  DATABASE_URL: "postgresql://relay:relay@localhost:5433/relay",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  PUBLIC_API_URL: "https://relay.example.com",
};

describe("loadSeedEnv", () => {
  it("defaults the slug to demo", () => {
    expect(loadSeedEnv(base).DEMO_ENDPOINT_SLUG).toBe("demo");
  });

  it("requires PUBLIC_API_URL instead of falling back to localhost", () => {
    expect(() => loadSeedEnv({ ...base, PUBLIC_API_URL: undefined })).toThrow(/PUBLIC_API_URL/);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() =>
      loadSeedEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") }),
    ).toThrow(/ENCRYPTION_KEY/);
  });
});
