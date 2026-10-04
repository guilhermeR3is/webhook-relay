// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EventSummary } from "@/lib/events";
import { EventsTable } from "./events-table";

afterEach(cleanup);

const now = new Date("2026-10-03T15:03:05Z");

function event(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: "0199a3b4-7c1e-7a52-9d3f-2b8e4c6a1f07",
    eventType: "invoice.paid",
    idempotencyKey: "order-1001",
    receivedAt: new Date("2026-10-03T15:00:05Z"),
    deliveries: { dead: 1, pending: 0, in_progress: 0, succeeded: 2 },
    ...overrides,
  };
}

describe("EventsTable", () => {
  it("is a table with a name for screen readers and a header for each column", () => {
    render(<EventsTable events={[event()]} now={now} />);

    expect(screen.getByRole("table", { name: /Eventos recebidos/ })).not.toBeNull();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Recebido",
      "Tipo",
      "Chave",
      "Entregas",
    ]);
  });

  it("shows when the event arrived in Brasília time, and how long ago", () => {
    render(<EventsTable events={[event()]} now={now} />);

    const time = screen.getByText(/12:00:05/).closest("time");
    expect(time?.textContent).toContain("03/10 12:00:05");
    expect(time?.textContent).toContain("há 3 min");
    expect(time?.getAttribute("datetime")).toBe("2026-10-03T15:00:05.000Z");
  });

  it("opens the event from its type, and shows the key and the deliveries", () => {
    render(<EventsTable events={[event()]} now={now} />);

    expect(screen.getByRole("link", { name: "invoice.paid" }).getAttribute("href")).toBe(
      "/events/0199a3b4-7c1e-7a52-9d3f-2b8e4c6a1f07",
    );
    expect(screen.getByText("order-1001")).not.toBeNull();
    expect(screen.getByRole("img", { name: "1 morta, 2 entregues" })).not.toBeNull();
  });

  it("keeps the order the API gave, one row per event", () => {
    const events = [
      event({ id: "a", eventType: "newest" }),
      event({ id: "b", eventType: "middle" }),
      event({ id: "c", eventType: "oldest" }),
    ];

    render(<EventsTable events={events} now={now} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("puts the full text in a tooltip, so a cut value can still be read", () => {
    const longType = "x".repeat(200);

    render(
      <EventsTable
        events={[event({ eventType: longType, idempotencyKey: "k".repeat(255) })]}
        now={now}
      />,
    );

    expect(screen.getByRole("link").getAttribute("title")).toBe(longType);
    expect(screen.getByText("k".repeat(255)).getAttribute("title")).toBe("k".repeat(255));
  });

  it("says an event without deliveries has none", () => {
    const empty = { dead: 0, pending: 0, in_progress: 0, succeeded: 0 };

    render(<EventsTable events={[event({ deliveries: empty })]} now={now} />);

    expect(screen.getByText("sem entregas")).not.toBeNull();
  });

  it("hides the column headers from the eye on phones but not from screen readers", () => {
    render(<EventsTable events={[event()]} now={now} />);

    const header = screen.getAllByRole("columnheader")[0]?.closest("thead");
    expect(header?.classList).toContain("sr-only");
    expect(header?.classList).not.toContain("hidden");
  });

  it("lights up the row under the mouse at once, with no fade", () => {
    render(<EventsTable events={[event()]} now={now} />);

    const row = screen.getAllByRole("row")[1];
    expect(row?.className).toContain("hover:bg-muted/60");
    expect(row?.className).not.toContain("transition");
  });
});
