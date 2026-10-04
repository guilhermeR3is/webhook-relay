// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliveryDetail } from "@/lib/event-detail";
import { DeliveryPanel } from "./delivery-panel";

vi.mock("./resend-action", () => ({ resendDeliveryAction: vi.fn() }));

afterEach(cleanup);

const now = new Date("2026-10-03T15:00:00Z");
const receivedAt = new Date("2026-10-03T14:59:00Z");

function delivery(overrides: Partial<DeliveryDetail> = {}): DeliveryDetail {
  return {
    id: "d1",
    status: "dead",
    attemptCount: 8,
    nextAttemptAt: new Date("2026-10-03T15:00:00Z"),
    lastError: null,
    succeededAt: null,
    createdAt: receivedAt,
    destination: { id: "x1", displayUrl: "https://hooks.example.com/webhook/…" },
    sequences: [
      {
        number: 1,
        resentAt: null,
        attempts: [
          {
            id: "a1",
            startedAt: new Date("2026-10-03T14:59:05Z"),
            durationMs: 120,
            httpStatus: 503,
            responseSnippet: null,
            error: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function attemptsIn(sequenceNumber: number, count: number, resentAt: Date | null = null) {
  return {
    number: sequenceNumber,
    resentAt,
    attempts: Array.from({ length: count }, (_, index) => ({
      id: `s${String(sequenceNumber)}a${String(index)}`,
      startedAt: new Date(Date.UTC(2026, 9, 3, 14, 59, 5 + index)),
      durationMs: 100,
      httpStatus: 503,
      responseSnippet: null,
      error: null,
    })),
  };
}

function show(overrides: Partial<DeliveryDetail> = {}) {
  render(<DeliveryPanel delivery={delivery(overrides)} receivedAt={receivedAt} now={now} />);
}

describe("DeliveryPanel", () => {
  it("names the destination and describes the state in words", () => {
    show();

    expect(
      screen.getByRole("heading", { name: "https://hooks.example.com/webhook/…" }),
    ).not.toBeNull();
    expect(screen.getByText(/^Morta · 1 tentativa$/)).not.toBeNull();
  });

  it("counts the attempts the timeline shows, in the singular and the plural", () => {
    show({ sequences: [attemptsIn(1, 8)] });
    expect(screen.getByText(/^Morta · 8 tentativas$/)).not.toBeNull();

    cleanup();
    show({ sequences: [attemptsIn(1, 1)] });
    expect(screen.getByText(/^Morta · 1 tentativa$/)).not.toBeNull();
  });

  it("adds up the attempts of every sequence, not the counter the database restarted", () => {
    show({
      status: "succeeded",
      succeededAt: new Date("2026-10-03T15:00:30Z"),
      attemptCount: 2,
      sequences: [attemptsIn(1, 8), attemptsIn(2, 2, new Date("2026-10-03T15:00:00Z"))],
    });

    expect(screen.getByText(/10 tentativas em 2 sequências/)).not.toBeNull();
  });

  it("says a resent delivery that has not tried yet has the old attempts and one sequence more", () => {
    show({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: new Date("2026-10-03T15:00:10Z"),
      sequences: [attemptsIn(1, 8), attemptsIn(2, 0, new Date("2026-10-03T15:00:00Z"))],
    });

    expect(
      screen.getByText(/Pendente · próxima tentativa agora · 8 tentativas em 2 sequências/),
    ).not.toBeNull();
  });

  it("says when a delivered one arrived", () => {
    show({ status: "succeeded", succeededAt: new Date("2026-10-03T15:00:30Z"), attemptCount: 1 });

    expect(screen.getByText(/Entregue às 12:00:30/)).not.toBeNull();
  });

  it("gives the date when it was delivered on another day than it was received", () => {
    show({ status: "succeeded", succeededAt: new Date("2026-10-04T03:15:00Z") });

    expect(screen.getByText(/Entregue em 04\/10 às 00:15:00/)).not.toBeNull();
  });

  it("says when the next attempt will be for a pending delivery", () => {
    show({ status: "pending", nextAttemptAt: new Date("2026-10-03T15:03:00Z") });

    expect(screen.getByText(/Pendente · próxima tentativa em 3 min/)).not.toBeNull();
  });

  it("says it is the first attempt when a pending delivery has not tried yet", () => {
    show({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: new Date("2026-10-03T15:00:10Z"),
      sequences: [],
    });

    expect(screen.getByText(/Pendente · primeira tentativa agora · 0 tentativas/)).not.toBeNull();
    expect(screen.getByText("Nenhuma tentativa foi feita ainda.")).not.toBeNull();
  });

  it("says the delivery is in progress, with how many attempts it has made", () => {
    show({ status: "in_progress", sequences: [attemptsIn(1, 2)] });

    expect(screen.getByText(/^Em andamento · 2 tentativas$/)).not.toBeNull();
  });

  it("shows the last error only when there is one", () => {
    show({ lastError: "destination answered 503, gave up after 8 attempts" });
    expect(screen.getByText(/gave up after 8 attempts/)).not.toBeNull();

    cleanup();
    show({ lastError: null });
    expect(screen.queryByText(/Último erro/)).toBeNull();
  });

  it("offers to resend a dead delivery, naming its destination", () => {
    show({ status: "dead" });

    expect(
      screen.getByRole("button", { name: "Reenviar para https://hooks.example.com/webhook/…" }),
    ).not.toBeNull();
  });

  it.each(["pending", "in_progress", "succeeded"] as const)(
    "does not offer to resend a delivery that is %s",
    (status) => {
      show({ status });

      expect(screen.queryByRole("button", { name: /Reenviar/ })).toBeNull();
    },
  );

  it("shows the timeline of attempts when there are attempts", () => {
    show();

    expect(screen.getByRole("list", { name: "Tentativas de envio" })).not.toBeNull();
  });
});
