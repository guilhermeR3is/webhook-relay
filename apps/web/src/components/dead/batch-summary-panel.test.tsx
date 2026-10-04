// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchSummary } from "@/lib/batch-summary";
import { BatchSummaryPanel } from "./batch-summary-panel";

afterEach(cleanup);

function show(summary: BatchSummary, onDismiss: () => void = vi.fn()) {
  render(<BatchSummaryPanel summary={summary} onDismiss={onDismiss} />);
}

const skipped = {
  id: "d2",
  reason: "destination_inactive",
  eventType: "order.created",
  destination: "https://b.example.com/hook",
} as const;

describe("BatchSummaryPanel", () => {
  it("gives the close button a touch area of 44 px around its 32 px", () => {
    show({ resentCount: 1, skipped: [] });

    expect(screen.getByRole("button", { name: "Fechar resumo" }).classList).toContain(
      "after:-inset-1.5",
    );
  });

  it("says how many were resent when none was skipped", () => {
    show({ resentCount: 3, skipped: [] });

    expect(screen.getByRole("heading", { name: "3 entregas reenviadas" })).not.toBeNull();
    expect(
      screen.getByText(/Voltaram para a fila e cada uma começa uma nova sequência/),
    ).not.toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("uses the singular for one delivery", () => {
    show({ resentCount: 1, skipped: [] });

    expect(screen.getByRole("heading", { name: "1 entrega reenviada" })).not.toBeNull();
    expect(screen.getByText(/Voltou para a fila e começa uma nova sequência/)).not.toBeNull();
  });

  it("counts both sides when some were skipped, and names each skipped one with its reason", () => {
    show({
      resentCount: 2,
      skipped: [skipped, { ...skipped, id: "d3", reason: "not_dead", eventType: "push" }],
    });

    expect(screen.getByRole("heading", { name: "2 reenviadas, 2 não reenviadas" })).not.toBeNull();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("order.created");
    expect(items[0]?.textContent).toContain("https://b.example.com/hook");
    expect(items[0]?.textContent).toContain("O destino está desativado");
    expect(items[1]?.textContent).toContain("push");
    expect(items[1]?.textContent).toContain("Já não estava morta");
  });

  it("uses the singular for one skipped delivery", () => {
    show({ resentCount: 4, skipped: [skipped] });

    expect(screen.getByRole("heading", { name: "4 reenviadas, 1 não reenviada" })).not.toBeNull();
  });

  it("says nothing was resent, without the line about the queue", () => {
    show({ resentCount: 0, skipped: [skipped] });

    expect(screen.getByRole("heading", { name: "Nenhuma entrega foi reenviada" })).not.toBeNull();
    expect(screen.queryByText(/Voltou|Voltaram/)).toBeNull();
  });

  it("leaves out the destination when it is not known", () => {
    show({ resentCount: 0, skipped: [{ ...skipped, destination: "" }] });

    expect(screen.getByRole("listitem").textContent).not.toContain("https://");
  });

  it("lets the person close it", () => {
    const onDismiss = vi.fn();
    show({ resentCount: 1, skipped: [] }, onDismiss);

    fireEvent.click(screen.getByRole("button", { name: "Fechar resumo" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
