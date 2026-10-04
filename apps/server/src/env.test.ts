import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://relay:relay@localhost:5432/relay",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  DEMO_QUOTA_SALT: "test-salt-with-enough-characters",
};

describe("loadServerEnv", () => {
  it("serves the api on PORT", () => {
    const env = loadServerEnv({ ...base, PORT: "10000" });

    expect(env.api.API_PORT).toBe(10000);
  });

  it("prefers PORT over API_PORT", () => {
    const env = loadServerEnv({ ...base, PORT: "10000", API_PORT: "4000" });

    expect(env.api.API_PORT).toBe(10000);
  });

  it("falls back to API_PORT and then to 3000 when PORT is missing", () => {
    expect(loadServerEnv({ ...base, API_PORT: "4000" }).api.API_PORT).toBe(4000);
    expect(loadServerEnv(base).api.API_PORT).toBe(3000);
  });

  it("keeps the worker on WORKER_PORT even when PORT is set", () => {
    const env = loadServerEnv({ ...base, PORT: "10000", WORKER_PORT: "4001" });

    expect(env.worker.WORKER_PORT).toBe(4001);
  });

  it("reports the first 7 characters of RENDER_GIT_COMMIT as the commit of both apps", () => {
    const env = loadServerEnv({ ...base, RENDER_GIT_COMMIT: "0123456789abcdef0123456789abcdef" });

    expect(env.api.GIT_COMMIT).toBe("0123456");
    expect(env.worker.GIT_COMMIT).toBe("0123456");
  });

  it("prefers GIT_COMMIT over RENDER_GIT_COMMIT and falls back to unknown without either", () => {
    const both = loadServerEnv({
      ...base,
      GIT_COMMIT: "dev",
      RENDER_GIT_COMMIT: "0123456789abcdef",
    });

    expect(both.api.GIT_COMMIT).toBe("dev");
    expect(loadServerEnv(base).api.GIT_COMMIT).toBe("unknown");
  });

  it("rejects a missing DEMO_QUOTA_SALT, which only the api requires", () => {
    expect(() => loadServerEnv({ ...base, DEMO_QUOTA_SALT: undefined })).toThrow(/DEMO_QUOTA_SALT/);
  });
});
