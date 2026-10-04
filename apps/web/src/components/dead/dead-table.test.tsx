// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeadDelivery } from "@/lib/dead-deliveries";
import { DeadTable } from "./dead-table";

afterEach(cleanup);

const now = new Date("2026-10-04T15:00:00Z");

function delivery(overrides: Partial<DeadDelivery> = {}): DeadDelivery {
  return {
    id: "d1",
    eventId: "e1",
    eventType: "invoice.paid",
    destination: { id: "x1", displayUrl: "https://hooks.example.com/webhook/…" },
    attemptCount: 8,
    lastError: "destination answered 503, gave up after 8 attempts",
    createdAt: new Date("2026-10-04T14:50:00Z"),
    lastAttempt: { startedAt: new Date("2026-10-04T14:59:00Z"), durationMs: 120, httpStatus: 503 },
    ...overrides,
  };
}

function show(
  deliveries: DeadDelivery[],
  selected: string[] = [],
  onToggle: (deliveryId: string) => void = vi.fn(),
) {
  render(
    <DeadTable
      deliveries={deliveries}
      selected={new Set(selected)}
      onToggle={onToggle}
      now={now}
    />,
  );
}

function rowOf(eventType: string) {
  const row = screen.getByRole("link", { name: eventType }).closest("tr");
  if (!row) throw new Error("the event has no row");
  return row;
}

describe("DeadTable", () => {
  it("describes the table and names its columns", () => {
    show([delivery()]);

    expect(screen.getByRole("table", { name: /Entregas mortas/ })).not.toBeNull();
    for (const name of ["Evento", "Destino", "Último erro", "Última resposta", "Recebido"]) {
      expect(screen.getByRole("columnheader", { name })).not.toBeNull();
    }
  });

  it("shows one row per delivery, with the event linking to its detail", () => {
    show([delivery(), delivery({ id: "d2", eventId: "e2", eventType: "order.created" })]);

    expect(screen.getByRole("link", { name: "invoice.paid" }).getAttribute("href")).toBe(
      "/events/e1",
    );
    expect(screen.getByRole("link", { name: "order.created" }).getAttribute("href")).toBe(
      "/events/e2",
    );
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("shows the destination, the last error, the last answer and the attempts", () => {
    show([delivery()]);
    const row = within(rowOf("invoice.paid"));

    expect(row.getByText("https://hooks.example.com/webhook/…")).not.toBeNull();
    expect(row.getByText(/gave up after 8 attempts/)).not.toBeNull();
    expect(row.getByText("503 · 120 ms")).not.toBeNull();
    expect(row.getByText("8 tentativas")).not.toBeNull();
  });

  it("says when a delivery never sent anything, when there was no answer and when there is no error", () => {
    show([
      delivery({ id: "d1", eventType: "never", lastAttempt: null, lastError: null }),
      delivery({
        id: "d2",
        eventType: "timeout",
        attemptCount: 1,
        lastAttempt: { startedAt: now, durationMs: 10_000, httpStatus: null },
      }),
    ]);

    const never = within(rowOf("never"));
    expect(never.getByText("nunca enviou")).not.toBeNull();
    expect(never.getByText("sem erro registrado")).not.toBeNull();
    const timeout = within(rowOf("timeout"));
    expect(timeout.getByText("sem resposta · 10 s")).not.toBeNull();
    expect(timeout.getByText("1 tentativa")).not.toBeNull();
  });

  it("allows the destination to break only after a slash, keeping the whole text", () => {
    show([delivery()]);
    const row = rowOf("invoice.paid");

    const cell = row.querySelectorAll("td")[2];
    expect(cell?.textContent).toBe("https://hooks.example.com/webhook/…");
    expect(cell?.querySelectorAll("wbr")).toHaveLength(4);
  });

  it("shows when the event arrived, in Brasília time, and how long ago", () => {
    show([delivery()]);
    const row = within(rowOf("invoice.paid"));

    expect(row.getByText("04/10 11:50:00")).not.toBeNull();
    expect(row.getByText("há 10 min")).not.toBeNull();
  });

  it("gives each row a checkbox named after its event and destination", () => {
    show([delivery()]);

    expect(
      screen.getByRole("checkbox", {
        name: "Selecionar invoice.paid para https://hooks.example.com/webhook/…",
      }),
    ).not.toBeNull();
  });

  it("checks the rows that are selected and only those", () => {
    show([delivery(), delivery({ id: "d2", eventType: "order.created" })], ["d2"]);

    const [first, second] = screen.getAllByRole("checkbox");
    expect(first?.getAttribute("aria-checked")).toBe("false");
    expect(second?.getAttribute("aria-checked")).toBe("true");
  });

  it("asks to toggle the delivery of the row that was clicked", () => {
    const onToggle = vi.fn();
    show([delivery(), delivery({ id: "d2", eventType: "order.created" })], [], onToggle);

    fireEvent.click(screen.getAllByRole("checkbox")[1] as HTMLElement);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("d2");
  });

  it("hides the column headers from the eye on phones but not from screen readers", () => {
    show([delivery()]);

    const header = screen.getAllByRole("columnheader")[0]?.closest("thead");
    expect(header?.classList).toContain("sr-only");
    expect(header?.classList).not.toContain("hidden");
  });

  it("lights up the row under the mouse at once, with no fade", () => {
    show([delivery()]);

    const row = rowOf("invoice.paid");
    expect(row.className).toContain("hover:bg-muted/60");
    expect(row.className).not.toContain("transition");
  });
});
