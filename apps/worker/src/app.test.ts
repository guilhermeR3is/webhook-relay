import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

type CheckResults = {
  database?: () => Promise<unknown>;
  queue?: () => Promise<unknown>;
};

function buildTestApp({
  database = () => Promise.resolve([]),
  queue = () => Promise.resolve([{ depth: 0 }]),
}: CheckResults = {}) {
  const queryRaw = vi.fn((query: TemplateStringsArray) =>
    query.join("").includes("delivery") ? queue() : database(),
  );
  return buildApp({
    db: { $queryRaw: queryRaw },
    version: "1.2.3",
    commit: "a1b2c3d",
    logLevel: "silent",
  });
}

describe("GET /health", () => {
  it("answers 200 and reports the queue depth when everything responds", async () => {
    const app = buildTestApp({ queue: () => Promise.resolve([{ depth: 3 }]) });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      version: "1.2.3",
      commit: "a1b2c3d",
      checks: { database: "ok", queue: "ok" },
      queueDepth: 3,
    });
  });

  it("answers 503 and reports degraded when the database fails", async () => {
    const app = buildTestApp({ database: () => Promise.reject(new Error("connection refused")) });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "degraded",
      checks: { database: "error", queue: "ok" },
    });
  });

  it("answers 503 with no queue depth when only the queue check fails", async () => {
    const app = buildTestApp({
      queue: () => Promise.reject(new Error('relation "delivery" does not exist')),
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "degraded",
      checks: { database: "ok", queue: "error" },
      queueDepth: null,
    });
  });
});
