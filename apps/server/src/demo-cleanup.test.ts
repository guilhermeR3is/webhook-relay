import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDemoCleanup } from "./demo-cleanup.js";

const nothingDeleted = { events: 0, quotaWindows: 0 };

function setup(run: () => Promise<Record<string, number>>) {
  const log = { info: vi.fn(), error: vi.fn() };
  const cleanup = startDemoCleanup({ run, intervalMs: 1000, log });
  return { cleanup, log };
}

function deferred() {
  let finish: (deleted: Record<string, number>) => void = () => undefined;
  const promise = new Promise<Record<string, number>>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startDemoCleanup", () => {
  it("runs right away and then once per interval", async () => {
    const run = vi.fn(() => Promise.resolve(nothingDeleted));
    const { cleanup } = setup(run);

    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);

    await cleanup.stop();
  });

  it("does not start a new run while the previous one is still going", async () => {
    const slow = deferred();
    const run = vi.fn(() => slow.promise);
    const { cleanup } = setup(run);

    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
    slow.finish(nothingDeleted);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    await cleanup.stop();
  });

  it("logs what each run deleted", async () => {
    const { cleanup, log } = setup(() => Promise.resolve({ events: 4, quotaWindows: 2 }));

    await vi.advanceTimersByTimeAsync(0);

    expect(log.info).toHaveBeenCalledWith(
      { job: "demo-cleanup", events: 4, quotaWindows: 2 },
      "demo cleanup finished",
    );
    await cleanup.stop();
  });

  it("logs a failed run and keeps running on the next interval", async () => {
    const failure = new Error("connection refused");
    const run = vi
      .fn<() => Promise<Record<string, number>>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(nothingDeleted);
    const { cleanup, log } = setup(run);

    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledWith(
      { job: "demo-cleanup", err: failure },
      "demo cleanup failed",
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(run).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledTimes(1);
    await cleanup.stop();
  });

  it("waits for the run in flight on stop and schedules nothing after it", async () => {
    const slow = deferred();
    const run = vi.fn(() => slow.promise);
    const { cleanup } = setup(run);
    await vi.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = cleanup.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    slow.finish(nothingDeleted);
    await stopping;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stopped).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run again after stop() between two runs", async () => {
    const run = vi.fn(() => Promise.resolve(nothingDeleted));
    const { cleanup } = setup(run);
    await vi.advanceTimersByTimeAsync(0);

    await cleanup.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(run).toHaveBeenCalledTimes(1);
  });
});
