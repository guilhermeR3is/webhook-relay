import { describe, expect, it } from "vitest";
import type { DeliveryDetail } from "./event-detail";
import { describeProgress, needsLiveUpdate } from "./live-update";

const now = new Date("2026-10-04T15:00:00Z");

function delivery(
  status: DeliveryDetail["status"],
  nextAttemptAt = new Date("2026-10-04T15:00:00Z"),
): DeliveryDetail {
  return {
    id: "d1",
    status,
    attemptCount: 0,
    nextAttemptAt,
    lastError: null,
    succeededAt: null,
    createdAt: now,
    destination: { id: "x1", displayUrl: "https://hooks.example.com/" },
    sequences: [],
  };
}

function inSeconds(seconds: number) {
  return new Date(now.getTime() + seconds * 1000);
}

describe("needsLiveUpdate", () => {
  it("is false with no deliveries", () => {
    expect(needsLiveUpdate([], now)).toBe(false);
  });

  it("is true while a delivery is in progress, however far the next attempt is", () => {
    expect(needsLiveUpdate([delivery("in_progress", inSeconds(3600))], now)).toBe(true);
  });

  it("is true for a pending delivery whose attempt is due now or overdue", () => {
    expect(needsLiveUpdate([delivery("pending", inSeconds(0))], now)).toBe(true);
    expect(needsLiveUpdate([delivery("pending", inSeconds(-300))], now)).toBe(true);
  });

  it("is true up to one minute ahead and false from one second more", () => {
    expect(needsLiveUpdate([delivery("pending", inSeconds(60))], now)).toBe(true);
    expect(needsLiveUpdate([delivery("pending", inSeconds(61))], now)).toBe(false);
  });

  it("is false when everything is finished", () => {
    expect(needsLiveUpdate([delivery("succeeded"), delivery("dead")], now)).toBe(false);
  });

  it("looks at every delivery, not only the first", () => {
    expect(
      needsLiveUpdate([delivery("dead"), delivery("succeeded"), delivery("in_progress")], now),
    ).toBe(true);
  });

  it("ignores the next attempt of a delivery that is not pending", () => {
    expect(
      needsLiveUpdate([delivery("dead", inSeconds(0)), delivery("succeeded", inSeconds(0))], now),
    ).toBe(false);
  });
});

function attempts(amount: number) {
  return Array.from({ length: amount }, (_, index) => ({
    id: `a${String(index)}`,
    startedAt: now,
    durationMs: 100,
    httpStatus: 503,
    responseSnippet: null,
    error: null,
  }));
}

function withSequences(base: DeliveryDetail, amounts: number[]): DeliveryDetail {
  return {
    ...base,
    sequences: amounts.map((amount, index) => ({
      number: index + 1,
      resentAt: null,
      attempts: attempts(amount),
    })),
  };
}

describe("describeProgress", () => {
  it("counts the deliveries by state, worst first, and the attempts of every sequence", () => {
    expect(
      describeProgress([
        withSequences(delivery("dead"), [3, 2]),
        withSequences(delivery("pending"), [1]),
        withSequences(delivery("succeeded"), [1]),
      ]),
    ).toBe("1 morta, 1 pendente, 1 entregue; 7 tentativas");
  });

  it("uses the singular for one attempt", () => {
    expect(describeProgress([withSequences(delivery("succeeded"), [1])])).toBe(
      "1 entregue; 1 tentativa",
    );
  });

  it("says there is nothing yet when there are no deliveries", () => {
    expect(describeProgress([])).toBe("sem entregas; 0 tentativas");
  });

  it("changes when an attempt is added, even if no delivery changed state", () => {
    const before = describeProgress([withSequences(delivery("pending"), [2])]);
    const after = describeProgress([withSequences(delivery("pending"), [3])]);

    expect(after).not.toBe(before);
  });
});
