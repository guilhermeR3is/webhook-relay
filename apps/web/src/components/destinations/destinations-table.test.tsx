// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DestinationSummary } from "@/lib/destinations";
import { DestinationsTable } from "./destinations-table";

afterEach(cleanup);

const now = new Date("2026-10-04T15:00:00Z");

function destination(overrides: Partial<DestinationSummary> = {}): DestinationSummary {
  return {
    id: "x1",
    displayUrl: "https://hooks.example.com/webhook/…",
    isActive: true,
    eventTypes: ["*"],
    circuit: { state: "closed", consecutiveFailures: 0, since: null, pausedUntil: null },
    deliveries: { dead: 1, pending: 0, in_progress: 0, succeeded: 2 },
    ...overrides,
  };
}

function show(destinations: DestinationSummary[], threshold = 5) {
  const { container } = render(
    <DestinationsTable destinations={destinations} threshold={threshold} now={now} />,
  );
  return container;
}

function rowOf(url: string) {
  const row = screen.getByTitle(url).closest("tr");
  if (!row) throw new Error("the destination has no row");
  return row;
}

describe("DestinationsTable", () => {
  it("describes the table and names its columns", () => {
    show([destination()]);

    expect(screen.getByRole("table", { name: /Destinos e o estado do circuito/ })).not.toBeNull();
    for (const name of ["Destino", "Circuito", "Entregas"]) {
      expect(screen.getByRole("columnheader", { name })).not.toBeNull();
    }
  });

  it("shows one row per destination, with its URL and what it receives", () => {
    show([
      destination(),
      destination({
        id: "x2",
        displayUrl: "https://other.example.com/hook",
        eventTypes: ["push", "issues"],
      }),
    ]);

    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(
      within(rowOf("https://hooks.example.com/webhook/…")).getByText("Recebe todos os eventos"),
    ).not.toBeNull();
    expect(
      within(rowOf("https://other.example.com/hook")).getByText("Recebe push, issues"),
    ).not.toBeNull();
  });

  it("shows the deliveries of the destination as a strip of stations", () => {
    show([destination()]);

    expect(
      within(rowOf("https://hooks.example.com/webhook/…")).getByRole("img", {
        name: "1 morta, 2 entregues",
      }),
    ).not.toBeNull();
  });

  it("says a clean circuit is closed, with no failures to count", () => {
    show([destination()]);
    const row = rowOf("https://hooks.example.com/webhook/…");

    expect(row.textContent).toContain("Fechado");
    expect(row.textContent).not.toContain("falhas");
    expect(row.querySelector("[data-track]")?.querySelectorAll("svg")).toHaveLength(0);
    expect(row.querySelector("[data-track]")?.children).toHaveLength(5);
  });

  it("counts the failures in a row against the limit and draws them on the track", () => {
    show(
      [
        destination({
          circuit: { state: "closed", consecutiveFailures: 3, since: null, pausedUntil: null },
        }),
      ],
      5,
    );
    const row = rowOf("https://hooks.example.com/webhook/…");

    expect(row.textContent).toContain("Fechado · 3 de 5 falhas seguidas");
    expect(
      row.querySelector("[data-track]")?.querySelectorAll('svg[data-status="dead"]'),
    ).toHaveLength(3);
  });

  it("uses the limit it was given, not a fixed number", () => {
    show(
      [
        destination({
          circuit: { state: "closed", consecutiveFailures: 1, since: null, pausedUntil: null },
        }),
      ],
      8,
    );
    const row = rowOf("https://hooks.example.com/webhook/…");

    expect(row.textContent).toContain("1 de 8 falhas seguidas");
    expect(row.querySelector("[data-track]")?.children).toHaveLength(8);
  });

  it("says when the pause ends and how long is left, and marks the row for attention", () => {
    show([
      destination({
        circuit: {
          state: "open",
          consecutiveFailures: 5,
          since: new Date("2026-10-04T14:58:00Z"),
          pausedUntil: new Date("2026-10-04T15:03:00Z"),
        },
      }),
    ]);
    const row = rowOf("https://hooks.example.com/webhook/…");

    expect(row.textContent).toContain("Aberto · pausado até 12:03:00 (em 3 min)");
    expect(row.getAttribute("data-attention")).toBe("true");
    expect(
      row.querySelector("[data-track]")?.querySelectorAll('svg[data-status="dead"]'),
    ).toHaveLength(5);
  });

  it("says the pause is over and the next delivery will test the destination", () => {
    show([
      destination({
        circuit: {
          state: "open",
          consecutiveFailures: 5,
          since: new Date("2026-10-04T14:40:00Z"),
          pausedUntil: new Date("2026-10-04T14:45:00Z"),
        },
      }),
    ]);

    expect(rowOf("https://hooks.example.com/webhook/…").textContent).toContain(
      "Aberto · esperando a próxima entrega para testar",
    );
  });

  it("says a half open circuit is testing, with the last station half filled", () => {
    show([
      destination({
        circuit: { state: "half_open", consecutiveFailures: 5, since: now, pausedUntil: null },
      }),
    ]);
    const row = rowOf("https://hooks.example.com/webhook/…");

    expect(row.textContent).toContain("Meio-aberto · testando agora");
    expect(row.querySelectorAll('svg[data-status="in_progress"]').length).toBeGreaterThanOrEqual(1);
    expect(row.getAttribute("data-attention")).toBe("true");
  });

  it("says a deactivated destination is deactivated, without marking it for attention", () => {
    show([destination({ isActive: false })]);
    const row = rowOf("https://hooks.example.com/webhook/…");

    expect(row.textContent).toContain("Desativado · em geral porque respondeu 410");
    expect(row.getAttribute("data-attention")).toBe("false");
    expect(row.querySelector("[data-track]")).toBeNull();
  });

  it("does not mark a closed circuit for attention, even with failures", () => {
    show([
      destination({
        circuit: { state: "closed", consecutiveFailures: 4, since: null, pausedUntil: null },
      }),
    ]);

    expect(rowOf("https://hooks.example.com/webhook/…").getAttribute("data-attention")).toBe(
      "false",
    );
  });

  it("keeps the whole URL in the text and allows it to break after the slashes", () => {
    show([destination({ displayUrl: "https://a.example.com/b/c" })]);

    const cell = rowOf("https://a.example.com/b/c").querySelector("td");
    expect(cell?.textContent).toContain("https://a.example.com/b/c");
    expect(cell?.querySelectorAll("wbr")).toHaveLength(4);
  });

  it("hides the column headers from the eye on phones but not from screen readers", () => {
    show([destination()]);

    const header = screen.getAllByRole("columnheader")[0]?.closest("thead");
    expect(header?.classList).toContain("sr-only");
    expect(header?.classList).not.toContain("hidden");
  });

  it("labels the delivery strip on phones, where the column header is not drawn, and keeps the label from screen readers", () => {
    show([destination()]);

    const label = within(rowOf("https://hooks.example.com/webhook/…")).getByText("Entregas");
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(label.classList).toContain("md:hidden");
  });
});
