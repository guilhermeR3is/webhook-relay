// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError } from "@/lib/api";
import { fetchDestinations, type DestinationsList } from "@/lib/destinations";
import DestinationsPage, { metadata } from "./page";

vi.mock("@/lib/destinations", () => ({ fetchDestinations: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const fetchMock = vi.mocked(fetchDestinations);
const now = new Date("2026-10-04T15:00:00Z");

type Item = DestinationsList["destinations"][number];

function item(url: string, overrides: Partial<Item> = {}): Item {
  return {
    id: url,
    displayUrl: url,
    isActive: true,
    eventTypes: ["*"],
    circuit: { state: "closed", consecutiveFailures: 0, since: null, pausedUntil: null },
    deliveries: { dead: 0, pending: 0, in_progress: 0, succeeded: 1 },
    ...overrides,
  };
}

const open = (url: string) =>
  item(url, {
    circuit: {
      state: "open",
      consecutiveFailures: 5,
      since: new Date("2026-10-04T14:58:00Z"),
      pausedUntil: new Date("2026-10-04T15:03:00Z"),
    },
  });

async function renderPage() {
  render(await DestinationsPage());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  fetchMock.mockResolvedValue({
    failureThreshold: 5,
    destinations: [item("https://healthy.example.com/hook")],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  fetchMock.mockReset();
});

describe("the destinations page", () => {
  it("gives the page its own title instead of the name of the product", () => {
    expect(metadata.title).toBe("Destinos");
  });

  it("shows the title, explains the circuit with the real limit and lists the destinations", async () => {
    fetchMock.mockResolvedValue({
      failureThreshold: 7,
      destinations: [item("https://healthy.example.com/hook")],
    });

    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Destinos" })).not.toBeNull();
    expect(
      screen.getByText(/Depois de 7 falhas seguidas o circuito do destino abre/),
    ).not.toBeNull();
    expect(screen.getByTitle("https://healthy.example.com/hook")).not.toBeNull();
  });

  it("draws the table with the limit the API gave, not a fixed one", async () => {
    fetchMock.mockResolvedValue({
      failureThreshold: 7,
      destinations: [
        item("https://flaky.example.com/hook", {
          circuit: { state: "closed", consecutiveFailures: 2, since: null, pausedUntil: null },
        }),
      ],
    });

    await renderPage();

    expect(screen.getByText(/2 de 7 falhas seguidas/)).not.toBeNull();
  });

  it("puts the destination that needs attention first", async () => {
    fetchMock.mockResolvedValue({
      failureThreshold: 5,
      destinations: [
        item("https://healthy.example.com/hook"),
        open("https://sick.example.com/hook"),
      ],
    });

    await renderPage();

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]?.textContent).toContain("https://sick.example.com/hook");
    expect(rows[1]?.textContent).toContain("https://healthy.example.com/hook");
  });

  it("says the page updates by itself while a circuit is open", async () => {
    fetchMock.mockResolvedValue({
      failureThreshold: 5,
      destinations: [open("https://sick.example.com/hook")],
    });

    await renderPage();

    expect(screen.getByRole("status").textContent).toBe("Atualizando sozinha");
  });

  it("does not update by itself when every circuit is closed", async () => {
    await renderPage();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the announcer for screen readers when every circuit is closed", async () => {
    await renderPage();

    expect(document.querySelector("[aria-live=polite]")).not.toBeNull();
  });

  it("tells screen readers when a circuit closes again", async () => {
    fetchMock.mockResolvedValue({
      failureThreshold: 5,
      destinations: [open("https://a.example.com/")],
    });
    const { rerender } = render(await DestinationsPage());

    fetchMock.mockResolvedValue({
      failureThreshold: 5,
      destinations: [item("https://a.example.com/")],
    });
    rerender(await DestinationsPage());

    expect(document.querySelector("[aria-live=polite]")?.textContent).toBe(
      "Atualizado: circuitos: 1 fechado.",
    );
  });

  it("counts the time left in the pause from the moment of the page", async () => {
    fetchMock.mockResolvedValue({
      failureThreshold: 5,
      destinations: [open("https://sick.example.com/hook")],
    });

    await renderPage();

    expect(screen.getByText(/pausado até 12:03:00 \(em 3 min\)/)).not.toBeNull();
  });

  it("says there is no destination, and who creates them", async () => {
    fetchMock.mockResolvedValue({ failureThreshold: 5, destinations: [] });

    await renderPage();

    expect(screen.getByRole("heading", { name: "Nenhum destino cadastrado" })).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the waking message when the API is asleep", async () => {
    fetchMock.mockRejectedValue(new ApiUnavailableError("down"));

    await renderPage();

    expect(screen.getByRole("heading", { name: "Acordando a demonstração" })).not.toBeNull();
  });

  it("explains a missing demo endpoint", async () => {
    fetchMock.mockRejectedValue(new ApiError(404, "demo_endpoint_not_found"));

    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Endpoint de demonstração não encontrado" }),
    ).not.toBeNull();
  });

  it("lets any other failure reach the error screen", async () => {
    fetchMock.mockRejectedValue(new ApiError(500, "unknown"));

    await expect(DestinationsPage()).rejects.toMatchObject({ status: 500 });
  });
});
