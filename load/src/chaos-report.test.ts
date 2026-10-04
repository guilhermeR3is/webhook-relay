import { describe, expect, it } from "vitest";
import { summarizeChaos, type ChaosInput } from "./chaos-report.ts";

const healthyRun: ChaosInput = {
  accepted: 1000,
  eventsInDatabase: 1000,
  deliveries: { succeeded: 1000, pending: 0, in_progress: 0, dead: 0 },
  redeliveredAfterKill: 12,
  receiver: { received: 1008, distinct: 1000, duplicates: 8 },
};

describe("summarizeChaos", () => {
  it("says zero events lost when everything accepted was stored and delivered, and still reports the duplicates", () => {
    expect(summarizeChaos(healthyRun)).toMatchObject({
      lostEvents: 0,
      undeliveredEvents: 0,
      duplicateDeliveries: 8,
      verdict: "zero events lost",
    });
  });

  it("counts an event answered with 202 but missing from the database as lost", () => {
    const report = summarizeChaos({
      ...healthyRun,
      eventsInDatabase: 997,
      deliveries: { succeeded: 997, pending: 0, in_progress: 0, dead: 0 },
      receiver: { received: 997, distinct: 997, duplicates: 0 },
    });

    expect(report).toMatchObject({ lostEvents: 3, verdict: "events lost" });
  });

  it("counts an event stored but never received by the destination as lost", () => {
    const report = summarizeChaos({
      ...healthyRun,
      receiver: { received: 995, distinct: 995, duplicates: 0 },
    });

    expect(report).toMatchObject({ undeliveredEvents: 5, verdict: "events lost" });
  });

  it("counts a delivery in the dead queue as lost, even if the destination got everything", () => {
    const report = summarizeChaos({
      ...healthyRun,
      deliveries: { succeeded: 999, pending: 0, in_progress: 0, dead: 1 },
    });

    expect(report.verdict).toBe("events lost");
  });

  it("does not judge while deliveries are still waiting or in progress", () => {
    expect(
      summarizeChaos({
        ...healthyRun,
        deliveries: { succeeded: 900, pending: 90, in_progress: 10, dead: 0 },
      }).verdict,
    ).toBe("not settled");
  });

  it("is not settled while a single delivery is still pending, even with none in progress", () => {
    expect(
      summarizeChaos({
        ...healthyRun,
        deliveries: { succeeded: 999, pending: 1, in_progress: 0, dead: 0 },
      }).verdict,
    ).toBe("not settled");
  });

  it("is not settled while a single delivery is still in progress, even with none pending", () => {
    expect(
      summarizeChaos({
        ...healthyRun,
        deliveries: { succeeded: 999, pending: 0, in_progress: 1, dead: 0 },
      }).verdict,
    ).toBe("not settled");
  });

  it("flags numbers that cannot happen, like more events stored than answered with 202", () => {
    expect(summarizeChaos({ ...healthyRun, eventsInDatabase: 1001 }).verdict).toBe(
      "numbers inconsistent",
    );
    expect(
      summarizeChaos({ ...healthyRun, receiver: { received: 1002, distinct: 1001, duplicates: 1 } })
        .verdict,
    ).toBe("numbers inconsistent");
  });

  it("does not count duplicates as lost", () => {
    const report = summarizeChaos({
      ...healthyRun,
      receiver: { received: 2000, distinct: 1000, duplicates: 1000 },
    });

    expect(report).toMatchObject({
      lostEvents: 0,
      duplicateDeliveries: 1000,
      verdict: "zero events lost",
    });
  });
});
