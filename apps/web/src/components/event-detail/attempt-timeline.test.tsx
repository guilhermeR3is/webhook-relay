// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AttemptDetail, AttemptSequence } from "@/lib/event-detail";
import { AttemptTimeline } from "./attempt-timeline";

afterEach(cleanup);

const receivedAt = new Date("2026-10-03T15:00:00Z");
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 3, 15, 0, seconds));

function attempt(second: number, overrides: Partial<AttemptDetail> = {}): AttemptDetail {
  return {
    id: `a${String(second)}`,
    startedAt: at(second),
    durationMs: 120,
    httpStatus: 503,
    responseSnippet: null,
    error: null,
    ...overrides,
  };
}

function sequence(
  number: number,
  attempts: AttemptDetail[],
  resentAt: Date | null = null,
): AttemptSequence {
  return { number, resentAt, attempts };
}

function render1(sequences: AttemptSequence[]) {
  return render(<AttemptTimeline sequences={sequences} receivedAt={receivedAt} />);
}

function items() {
  return within(screen.getByRole("list", { name: "Tentativas de envio" })).getAllByRole("listitem");
}

describe("AttemptTimeline", () => {
  it("has one station for each attempt, with the time and the HTTP code", () => {
    render1([sequence(1, [attempt(1), attempt(11, { httpStatus: 200 })])]);

    expect(items()).toHaveLength(2);
    expect(items()[0]?.textContent).toContain("12:00:01");
    expect(items()[0]?.textContent).toContain("503");
    expect(items()[1]?.textContent).toContain("200");
  });

  it("marks a 2xx as delivered and everything else as a failure", () => {
    const { container } = render1([
      sequence(1, [attempt(1), attempt(2, { httpStatus: 200 }), attempt(3, { httpStatus: null })]),
    ]);

    expect(
      [...container.querySelectorAll("svg[data-status]")].map((mark) =>
        mark.getAttribute("data-status"),
      ),
    ).toEqual(["dead", "succeeded", "dead"]);
  });

  it("says there was no response when there is no HTTP code", () => {
    render1([sequence(1, [attempt(1, { httpStatus: null, error: "timed out after 10000 ms" })])]);

    expect(screen.getByText("sem resposta")).not.toBeNull();
    expect(screen.getByText(/timed out after 10000 ms/)).not.toBeNull();
  });

  it("shows how long after the previous attempt each one came, which is the backoff", () => {
    render1([sequence(1, [attempt(1), attempt(43), attempt(103)])]);

    expect(items()[0]?.textContent).not.toContain("+");
    expect(items()[1]?.textContent).toContain("+42 s");
    expect(items()[2]?.textContent).toContain("+1 min");
  });

  it("draws the bars on one scale: the longest fills the width and a tiny one stays visible", () => {
    const { container } = render1([
      sequence(1, [
        attempt(1, { durationMs: 10_000 }),
        attempt(20, { durationMs: 5000 }),
        attempt(40, { durationMs: 5 }),
      ]),
    ]);

    const widths = [...container.querySelectorAll<HTMLElement>("span[style]")].map(
      (bar) => bar.style.width,
    );
    expect(widths).toEqual(["100%", "50%", "2%"]);
  });

  it("writes the duration of each attempt", () => {
    render1([sequence(1, [attempt(1, { durationMs: 5 }), attempt(9, { durationMs: 1234 })])]);

    expect(items()[0]?.textContent).toContain("5 ms");
    expect(items()[1]?.textContent).toContain("1,2 s");
  });

  it("shows the start of the answer, and the error when there was one", () => {
    render1([
      sequence(1, [
        attempt(1, { responseSnippet: "upstream unavailable" }),
        attempt(9, { httpStatus: null, error: "connection refused" }),
      ]),
    ]);

    expect(items()[0]?.textContent).toContain("upstream unavailable");
    expect(items()[1]?.textContent).toContain("connection refused");
  });

  it("puts the date before the time only when the attempt is on another day", () => {
    const nextDay = new Date("2026-10-04T12:30:00Z");

    render1([sequence(1, [attempt(1), attempt(1, { id: "late", startedAt: nextDay })])]);

    expect(items()[0]?.textContent).not.toContain("03/10");
    expect(items()[1]?.textContent).toContain("04/10 09:30:00");
  });

  it("separates the sequences with the moment of the resend, and counts the attempts again from 1", () => {
    render1([
      sequence(1, [attempt(1), attempt(11)]),
      sequence(2, [attempt(100), attempt(110)], at(90)),
    ]);

    expect(items()).toHaveLength(5);
    expect(items()[2]?.textContent).toBe("Reenviada em 03/10 12:01:30");
    expect(screen.getAllByText("Tentativa 1:", { exact: false })).toHaveLength(2);
  });

  it("measures the first attempt after a resend from the resend, not from the last old attempt", () => {
    render1([sequence(1, [attempt(1)]), sequence(2, [attempt(100)], at(90))]);

    const first = items()[2];
    expect(first?.textContent).toContain("+10 s");
    expect(
      within(first as HTMLElement)
        .getByText("+10 s")
        .getAttribute("title"),
    ).toBe("10 s depois do reenvio");
  });

  it("waits, in words, when the delivery was resent and has not tried yet", () => {
    render1([sequence(1, [attempt(1)]), sequence(2, [], at(90))]);

    expect(items()[2]?.textContent).toBe("Aguardando a primeira tentativa");
  });
});
