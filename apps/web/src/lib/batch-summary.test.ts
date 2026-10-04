import { describe, expect, it } from "vitest";
import { skipReasonTexts, summarizeBatch } from "./batch-summary";
import type { DeadDelivery } from "./dead-deliveries";

function delivery(id: string, eventType: string, displayUrl: string): DeadDelivery {
  return {
    id,
    eventId: `e-${id}`,
    eventType,
    destination: { id: `x-${id}`, displayUrl },
    attemptCount: 8,
    lastError: null,
    createdAt: new Date("2026-10-04T15:00:00Z"),
    lastAttempt: null,
  };
}

const sent = [
  delivery("d1", "invoice.paid", "https://a.example.com/hook"),
  delivery("d2", "order.created", "https://b.example.com/hook"),
  delivery("d3", "push", "https://c.example.com/hook"),
];

describe("summarizeBatch", () => {
  it("counts what was resent", () => {
    const summary = summarizeBatch({ resent: ["d1", "d2"], skipped: [] }, sent);

    expect(summary).toEqual({ resentCount: 2, skipped: [] });
  });

  it("names each skipped delivery by its event and destination, and keeps the reason", () => {
    const summary = summarizeBatch(
      {
        resent: ["d1"],
        skipped: [
          { id: "d2", reason: "destination_inactive" },
          { id: "d3", reason: "not_dead" },
        ],
      },
      sent,
    );

    expect(summary.skipped).toEqual([
      {
        id: "d2",
        reason: "destination_inactive",
        eventType: "order.created",
        destination: "https://b.example.com/hook",
      },
      {
        id: "d3",
        reason: "not_dead",
        eventType: "push",
        destination: "https://c.example.com/hook",
      },
    ]);
  });

  it("falls back to the id when the delivery is not among the ones that were sent", () => {
    const summary = summarizeBatch(
      { resent: [], skipped: [{ id: "zz", reason: "not_found" }] },
      sent,
    );

    expect(summary.skipped).toEqual([
      { id: "zz", reason: "not_found", eventType: "zz", destination: "" },
    ]);
  });
});

describe("skipReasonTexts", () => {
  it("explains every reason in plain words", () => {
    expect(skipReasonTexts.destination_inactive).toContain("desativado");
    expect(skipReasonTexts.destination_inactive).toContain("410");
    expect(skipReasonTexts.not_dead).toContain("Já não estava morta");
    expect(skipReasonTexts.not_found).toContain("Não existe mais");
  });
});
