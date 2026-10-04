import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { createWorkerMetrics } from "./metrics.js";

type CheckResults = {
  database?: () => Promise<unknown>;
  queue?: () => Promise<unknown>;
  exposeMetrics?: boolean;
};

function buildTestApp({
  database = () => Promise.resolve([]),
  queue = () => Promise.resolve([{ depth: 0 }]),
  exposeMetrics = false,
}: CheckResults = {}) {
  const queryRaw = vi.fn((query: TemplateStringsArray) =>
    query.join("").includes("delivery") ? queue() : database(),
  );
  const db = { $queryRaw: queryRaw };
  return buildApp({
    db,
    metricsRegistry: exposeMetrics ? createWorkerMetrics(db).registry : undefined,
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

describe("GET /metrics", () => {
  it("does not exist unless the registry is handed to the app", async () => {
    const app = buildTestApp();

    const response = await app.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(404);
  });

  it("serves the delivery metrics and the queue depth read at scrape time", async () => {
    const app = buildTestApp({
      exposeMetrics: true,
      queue: () => Promise.resolve([{ depth: 7 }]),
    });

    const response = await app.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("relay_queue_depth 7");
    expect(response.body).toContain("# TYPE relay_deliveries_total counter");
    expect(response.body).toContain("# TYPE relay_send_duration_seconds histogram");
    expect(response.body).toContain("process_cpu_user_seconds_total");
  });

  it("reports the queue depth as NaN, not 0 or the old value, when the queue check fails", async () => {
    let queueDepth: () => Promise<unknown> = () => Promise.resolve([{ depth: 4 }]);
    const app = buildTestApp({ exposeMetrics: true, queue: () => queueDepth() });
    const healthy = await app.inject({ method: "GET", url: "/metrics" });

    queueDepth = () => Promise.reject(new Error("connection refused"));
    const failing = await app.inject({ method: "GET", url: "/metrics" });

    expect(healthy.body).toContain("relay_queue_depth 4");
    expect(failing.statusCode).toBe(200);
    expect(failing.body).toMatch(/^relay_queue_depth nan$/im);
  });
});
