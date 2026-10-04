import { Registry } from "@prometheus-io/client";
import { createDb } from "@relay/db";
import { describe, expect, it, vi } from "vitest";
import { startDeliveryLoop } from "./delivery-loop.js";
import { createDeliveryMetrics } from "./metrics.js";

describe("startDeliveryLoop", () => {
  it("logs the failure and keeps polling while the database is unreachable", async () => {
    const db = createDb("postgresql://relay:relay@127.0.0.1:1/relay");
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const send = vi.fn();

    const loop = startDeliveryLoop({
      db,
      send,
      log,
      pollIntervalMs: 10,
      batchSize: 10,
      leaseSeconds: 60,
      metrics: createDeliveryMetrics(new Registry()),
    });
    await vi.waitFor(
      () => {
        expect(log.error.mock.calls.length).toBeGreaterThanOrEqual(3);
      },
      { timeout: 5000 },
    );
    await loop.stop();
    await db.$disconnect();

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() as unknown }),
      "failed to reserve deliveries",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
