import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { FLAKY_SLOW_LIMIT, FLAKY_SLOW_MS, flakyRoutes } from "./flaky.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function sequence(...values: number[]) {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error("the test asked for more random numbers than it gave");
    return value;
  };
}

function build(options: Parameters<typeof flakyRoutes>[1] = {}) {
  const app = Fastify();
  void app.register(flakyRoutes, options);
  apps.push(app);
  return app;
}

async function post(app: FastifyInstance, payload = "{}", contentType = "application/json") {
  const response = await app.inject({
    method: "POST",
    url: "/demo/flaky",
    payload,
    headers: { "content-type": contentType },
  });
  return response;
}

function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("POST /demo/flaky, the answers", () => {
  it("answers 200 when the draw is above both the failure and the slow bands", async () => {
    const response = await post(build({ random: sequence(0.5) }));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
  });

  it("fails just below the failure rate and does not fail at it", async () => {
    const failing = await post(build({ random: sequence(0.3999, 0.9) }));
    const passing = await post(build({ random: sequence(0.4), sleep: () => Promise.resolve() }));

    expect(failing.statusCode).toBe(503);
    expect(passing.statusCode).toBe(200);
  });

  it("fails with 503 most of the time, saying the service is unavailable", async () => {
    const response = await post(build({ random: sequence(0, 0.69) }));

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "demo_flaky_unavailable" });
    expect(response.headers["retry-after"]).toBeUndefined();
  });

  it("answers 429 with a Retry-After for the other share of the failures", async () => {
    const response = await post(build({ random: sequence(0, 0.29) }));

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.json()).toEqual({ error: "demo_flaky_rate_limited" });
  });

  it("splits the failures 70 percent 503 and 30 percent 429 exactly at the boundary", async () => {
    const atBoundary = await post(build({ random: sequence(0, 0.3) }));
    const justBelow = await post(build({ random: sequence(0, 0.2999) }));

    expect(atBoundary.statusCode).toBe(503);
    expect(justBelow.statusCode).toBe(429);
  });

  it("accepts any body, even invalid JSON, and any content type", async () => {
    const app = build({ random: sequence(0.9, 0.9, 0.9) });

    const brokenJson = await post(app, "{not json", "application/json");
    const text = await post(app, "hello", "text/plain");
    const empty = await app.inject({ method: "POST", url: "/demo/flaky" });

    expect([brokenJson.statusCode, text.statusCode, empty.statusCode]).toEqual([200, 200, 200]);
  });
});

describe("POST /demo/flaky, the slow answers", () => {
  it("waits fifteen seconds for the draws in the slow band, then answers 200", async () => {
    const waits: number[] = [];
    const gate = deferred();
    const app = build({
      random: sequence(0.4),
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return gate.promise;
      },
    });

    let answered = false;
    const pending = post(app).then((response) => {
      answered = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answered).toBe(false);
    gate.release();
    const response = await pending;

    expect(waits).toEqual([FLAKY_SLOW_MS]);
    expect(FLAKY_SLOW_MS).toBe(15_000);
    expect(response.statusCode).toBe(200);
  });

  it("is slow just below the end of the slow band and not at it", async () => {
    const waits: number[] = [];
    const sleep = (milliseconds: number) => {
      waits.push(milliseconds);
      return Promise.resolve();
    };

    await post(build({ random: sequence(0.4999), sleep }));
    await post(build({ random: sequence(0.5), sleep }));

    expect(waits).toEqual([FLAKY_SLOW_MS]);
  });

  it("answers at once, without waiting, when too many slow answers are already open", async () => {
    const gate = deferred();
    let sleeps = 0;
    const app = build({
      random: () => 0.45,
      slowLimit: 2,
      sleep: () => {
        sleeps += 1;
        return gate.promise;
      },
    });

    const first = post(app);
    const second = post(app);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const third = await post(app);

    expect(third.statusCode).toBe(200);
    expect(sleeps).toBe(2);
    gate.release();
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
  });

  it("allows five slow answers at once by default, and no more", async () => {
    const gate = deferred();
    let sleeps = 0;
    const app = build({
      random: () => 0.45,
      sleep: () => {
        sleeps += 1;
        return gate.promise;
      },
    });

    const open = Array.from({ length: FLAKY_SLOW_LIMIT }, () => post(app));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const beyond = await post(app);
    gate.release();
    await Promise.all(open);

    expect(FLAKY_SLOW_LIMIT).toBe(5);
    expect(sleeps).toBe(5);
    expect(beyond.statusCode).toBe(200);
  });

  it("does not hide an unexpected failure while waiting, and still frees the place", async () => {
    let sleeps = 0;
    const app = build({
      random: () => 0.45,
      slowLimit: 1,
      sleep: () => {
        sleeps += 1;
        return Promise.reject(new Error("boom"));
      },
    });

    const first = await post(app);
    const second = await post(app);

    expect(first.statusCode).toBe(500);
    expect(second.statusCode).toBe(500);
    expect(sleeps).toBe(2);
  });

  it("frees the place when a slow answer finishes", async () => {
    let sleeps = 0;
    const app = build({
      random: () => 0.45,
      slowLimit: 1,
      sleep: () => {
        sleeps += 1;
        return Promise.resolve();
      },
    });

    await post(app);
    await post(app);
    await post(app);

    expect(sleeps).toBe(3);
  });

  it("frees the place when the caller gives up before the answer", async () => {
    const aborted = deferred();
    let sleeps = 0;
    const app = build({
      random: () => 0.45,
      slowLimit: 1,
      sleep: (_milliseconds, signal) => {
        sleeps += 1;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted.release();
            reject(new Error("aborted"));
          });
        });
      },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;

    const leaving = httpRequest({
      port,
      host: "127.0.0.1",
      method: "POST",
      path: "/demo/flaky",
      agent: false,
    });
    leaving.on("error", () => undefined);
    leaving.end("{}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    leaving.destroy();
    await aborted.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));

    const next = httpRequest({
      port,
      host: "127.0.0.1",
      method: "POST",
      path: "/demo/flaky",
      agent: false,
    });
    next.on("error", () => undefined);
    next.end("{}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    next.destroy();

    expect(sleeps).toBe(2);
  });
});
