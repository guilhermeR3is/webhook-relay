import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("uses the local API when nothing is set", () => {
    expect(loadEnv({})).toEqual({
      API_URL: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:3000",
    });
  });

  it("takes the API address from the environment", () => {
    expect(loadEnv({ API_URL: "http://api:3000" }).API_URL).toBe("http://api:3000");
  });

  it("rejects an API address that is not a URL", () => {
    expect(() => loadEnv({ API_URL: "not a url" })).toThrow(/API_URL/);
  });

  it("keeps the address the browser uses apart from the one the server uses", () => {
    const env = loadEnv({ API_URL: "http://api:3000", PUBLIC_API_URL: "https://api.example.com" });

    expect(env).toEqual({ API_URL: "http://api:3000", PUBLIC_API_URL: "https://api.example.com" });
  });

  it("rejects a public API address that is not a URL", () => {
    expect(() => loadEnv({ PUBLIC_API_URL: "api" })).toThrow(/PUBLIC_API_URL/);
  });
});
