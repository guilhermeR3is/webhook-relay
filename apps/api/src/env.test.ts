import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const validEnv = {
  DATABASE_URL: "postgresql://relay:relay@localhost:5433/relay",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  DEMO_QUOTA_SALT: "a-salt-with-enough-characters",
};

describe("loadEnv", () => {
  it("applies defaults for optional variables", () => {
    expect(loadEnv(validEnv)).toMatchObject({
      API_PORT: 3000,
      DEMO_ENDPOINT_SLUG: "demo",
      LOG_LEVEL: "info",
      GIT_COMMIT: "unknown",
    });
  });

  it("takes the demo endpoint slug from the environment and refuses an empty one", () => {
    expect(loadEnv({ ...validEnv, DEMO_ENDPOINT_SLUG: "vitrine" }).DEMO_ENDPOINT_SLUG).toBe(
      "vitrine",
    );
    expect(() => loadEnv({ ...validEnv, DEMO_ENDPOINT_SLUG: "" })).toThrow(/DEMO_ENDPOINT_SLUG/);
  });

  it("converts the port to a number", () => {
    expect(loadEnv({ ...validEnv, API_PORT: "4100" }).API_PORT).toBe(4100);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    const shortKey = Buffer.alloc(16, 1).toString("base64");

    expect(() => loadEnv({ ...validEnv, ENCRYPTION_KEY: shortKey })).toThrow(/32 bytes/);
  });

  it("rejects an unknown log level", () => {
    expect(() => loadEnv({ ...validEnv, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });

  it("trusts no proxy by default", () => {
    expect(loadEnv(validEnv).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...validEnv, TRUST_PROXY: "" }).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...validEnv, TRUST_PROXY: " , " }).TRUST_PROXY).toBe(false);
  });

  it("reads the trusted proxies as a list of addresses, ranges and names", () => {
    const env = loadEnv({
      ...validEnv,
      TRUST_PROXY: " 10.0.0.1, 172.16.0.0/12 ,uniquelocal, 2001:db8::/32 ",
    });

    expect(env.TRUST_PROXY).toEqual(["10.0.0.1", "172.16.0.0/12", "uniquelocal", "2001:db8::/32"]);
  });

  it.each([
    "true",
    "*",
    "1",
    "0.0.0.0/33",
    "2001:db8::/129",
    "10.0.0.1/abc",
    "10.0.0.1/8/8",
    "not-an-address",
    "10.0.0.1,everyone",
  ])("rejects %s as a trusted proxy, so no one trusts all by mistake", (value) => {
    expect(() => loadEnv({ ...validEnv, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
  });

  it("accepts the edges of the prefix of each address family", () => {
    expect(
      loadEnv({ ...validEnv, TRUST_PROXY: "10.0.0.1/32,2001:db8::/128,0.0.0.0/0" }).TRUST_PROXY,
    ).toEqual(["10.0.0.1/32", "2001:db8::/128", "0.0.0.0/0"]);
  });

  it("requires a salt for the visitor key, and a long enough one", () => {
    expect(() => loadEnv({ ...validEnv, DEMO_QUOTA_SALT: undefined })).toThrow(/DEMO_QUOTA_SALT/);
    expect(() => loadEnv({ ...validEnv, DEMO_QUOTA_SALT: "short" })).toThrow(/DEMO_QUOTA_SALT/);
    expect(loadEnv({ ...validEnv, DEMO_QUOTA_SALT: "x".repeat(16) }).DEMO_QUOTA_SALT).toHaveLength(
      16,
    );
    expect(() => loadEnv({ ...validEnv, DEMO_QUOTA_SALT: "x".repeat(15) })).toThrow(
      /DEMO_QUOTA_SALT/,
    );
  });

  it("takes the panel origin from the environment, keeping only the origin", () => {
    expect(loadEnv(validEnv).PANEL_ORIGIN).toBe("http://localhost:3100");
    expect(
      loadEnv({ ...validEnv, PANEL_ORIGIN: "https://painel.example.com/events?x=1" }).PANEL_ORIGIN,
    ).toBe("https://painel.example.com");
    expect(() => loadEnv({ ...validEnv, PANEL_ORIGIN: "painel" })).toThrow(/PANEL_ORIGIN/);
  });
});
