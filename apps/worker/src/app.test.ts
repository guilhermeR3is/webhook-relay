import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

function buildTestApp(queryRaw: () => Promise<unknown>) {
  return buildApp({
    db: { $queryRaw: vi.fn(queryRaw) },
    version: "1.2.3",
    commit: "a1b2c3d",
    logLevel: "silent",
  });
}

describe("GET /health", () => {
  it("answers 200 when the database responds", async () => {
    const app = buildTestApp(() => Promise.resolve([]));

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      version: "1.2.3",
      commit: "a1b2c3d",
      checks: { database: "ok" },
    });
  });

  it("answers 503 and reports degraded when the database fails", async () => {
    const app = buildTestApp(() => Promise.reject(new Error("connection refused")));

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", checks: { database: "error" } });
  });
});
