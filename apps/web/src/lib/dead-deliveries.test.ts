import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { fetchDeadDeliveries } from "./dead-deliveries";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

const delivery = {
  id: "d1",
  eventId: "e1",
  eventType: "invoice.paid",
  destination: { id: "x1", displayUrl: "https://hooks.example.com/webhook/…" },
  attemptCount: 8,
  lastError: "destination answered 503, gave up after 8 attempts",
  createdAt: "2026-10-03T15:00:05.123Z",
  lastAttempt: { startedAt: "2026-10-03T15:20:00.000Z", durationMs: 120, httpStatus: 503 },
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("fetchDeadDeliveries", () => {
  it("asks for one page and turns the dates into Dates", async () => {
    apiFetchMock.mockResolvedValue({ deliveries: [delivery], nextCursor: "next" });

    const page = await fetchDeadDeliveries({});

    expect(apiFetchMock).toHaveBeenCalledWith("/panel/dead-deliveries?limit=25");
    expect(page.nextCursor).toBe("next");
    expect(page.deliveries[0]?.createdAt).toEqual(new Date("2026-10-03T15:00:05.123Z"));
    expect(page.deliveries[0]?.lastAttempt?.startedAt).toEqual(
      new Date("2026-10-03T15:20:00.000Z"),
    );
  });

  it("sends the cursor when there is one, escaped", async () => {
    apiFetchMock.mockResolvedValue({ deliveries: [], nextCursor: null });

    await fetchDeadDeliveries({ cursor: "a b&c" });

    const [path] = apiFetchMock.mock.calls[0] ?? [];
    const params = new URL(path ?? "", "http://x").searchParams;
    expect(Object.fromEntries(params)).toEqual({ limit: "25", cursor: "a b&c" });
  });

  it("accepts a delivery that never sent anything and one that timed out", async () => {
    apiFetchMock.mockResolvedValue({
      deliveries: [
        { ...delivery, id: "d2", lastAttempt: null },
        { ...delivery, id: "d3", lastAttempt: { ...delivery.lastAttempt, httpStatus: null } },
        { ...delivery, id: "d4", lastError: null },
      ],
      nextCursor: null,
    });

    const page = await fetchDeadDeliveries({});

    expect(page.deliveries.map((d) => d.lastAttempt?.httpStatus)).toEqual([undefined, null, 503]);
    expect(page.deliveries[2]?.lastError).toBeNull();
  });

  it.each([
    ["a negative attempt count", { ...delivery, attemptCount: -1 }],
    ["a missing destination", { ...delivery, destination: undefined }],
    ["a date that is not a date", { ...delivery, createdAt: "yesterday" }],
    [
      "an attempt with a negative duration",
      { ...delivery, lastAttempt: { ...delivery.lastAttempt, durationMs: -5 } },
    ],
  ])("refuses an answer with %s", async (_name, broken) => {
    apiFetchMock.mockResolvedValue({ deliveries: [broken], nextCursor: null });

    await expect(fetchDeadDeliveries({})).rejects.toThrow();
  });

  it("refuses an answer that is not a page", async () => {
    apiFetchMock.mockResolvedValue({ items: [] });

    await expect(fetchDeadDeliveries({})).rejects.toThrow();
  });
});
