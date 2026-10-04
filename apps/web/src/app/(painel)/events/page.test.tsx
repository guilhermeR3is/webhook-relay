// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError } from "@/lib/api";
import { fetchEvents, type EventSummary } from "@/lib/events";
import { sendTestEvent } from "@/lib/test-event";
import EventsPage, { metadata } from "./page";

vi.mock("@/lib/events", () => ({ fetchEvents: vi.fn() }));
vi.mock("@/lib/test-event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/test-event")>()),
  sendTestEvent: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const fetchEventsMock = vi.mocked(fetchEvents);

function event(id: string, eventType: string): EventSummary {
  return {
    id,
    eventType,
    idempotencyKey: `key-${id}`,
    receivedAt: new Date("2026-10-03T15:00:05Z"),
    deliveries: { dead: 0, pending: 0, in_progress: 0, succeeded: 1 },
  };
}

async function renderPage(search: Record<string, string> = {}) {
  render(await EventsPage({ params: Promise.resolve({}), searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  fetchEventsMock.mockResolvedValue({ events: [event("a", "push")], nextCursor: null });
});

afterEach(() => {
  cleanup();
  fetchEventsMock.mockReset();
});

describe("the events page", () => {
  it("gives the page its own title instead of the name of the product", () => {
    expect(metadata.title).toBe("Eventos");
  });

  it("shows the events in a table under the filters", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Eventos" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "push" })).not.toBeNull();
    expect(screen.getByRole("search")).not.toBeNull();
    expect(screen.queryByRole("navigation", { name: "Páginas da lista" })).toBeNull();
  });

  it("offers the test event button next to the title, with the API address of the browser", async () => {
    await renderPage();

    expect(screen.getByRole("button", { name: "Enviar evento de teste" })).not.toBeNull();
  });

  it("gives the button the address of the API that the browser reaches, not the one of the server", async () => {
    vi.stubEnv("API_URL", "http://api:3000");
    vi.stubEnv("PUBLIC_API_URL", "https://public.example.com");
    vi.mocked(sendTestEvent).mockResolvedValue({ kind: "failed", status: 500 });
    await renderPage();

    await userEvent.setup().click(screen.getByRole("button", { name: "Enviar evento de teste" }));

    expect(sendTestEvent).toHaveBeenCalledWith("https://public.example.com");
    vi.unstubAllEnvs();
  });

  it("does not offer the button while the API is asleep", async () => {
    fetchEventsMock.mockRejectedValue(new ApiUnavailableError("down"));

    await renderPage();

    expect(screen.queryByRole("button", { name: "Enviar evento de teste" })).toBeNull();
  });

  it("passes what is in the URL to the API, and nothing invalid", async () => {
    await renderPage({ status: "dead", search: " invoice ", cursor: "c1" });
    expect(fetchEventsMock).toHaveBeenLastCalledWith({
      status: "dead",
      search: "invoice",
      cursor: "c1",
    });

    cleanup();
    await renderPage({ status: "archived" });
    expect(fetchEventsMock).toHaveBeenLastCalledWith({});
  });

  it("links to the older events keeping the filters", async () => {
    fetchEventsMock.mockResolvedValue({ events: [event("a", "push")], nextCursor: "next-1" });

    await renderPage({ status: "dead", search: "push" });

    const link = screen.getByRole("link", { name: "Mais antigos" });
    expect(link.getAttribute("href")).toBe("/events?status=dead&search=push&cursor=next-1");
    expect(link.getAttribute("rel")).toBe("next");
    expect(screen.queryByRole("link", { name: "Voltar ao início" })).toBeNull();
  });

  it("offers to go back to the start from a later page, keeping the filters", async () => {
    await renderPage({ status: "dead", cursor: "c1" });

    expect(screen.getByRole("link", { name: "Voltar ao início" }).getAttribute("href")).toBe(
      "/events?status=dead",
    );
    expect(screen.queryByRole("link", { name: "Mais antigos" })).toBeNull();
  });

  it("says there are no events yet when nothing was received", async () => {
    fetchEventsMock.mockResolvedValue({ events: [], nextCursor: null });

    await renderPage();

    expect(screen.getByRole("heading", { name: "Nenhum evento ainda" })).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says nothing matches when a filter leaves no events, which is another message", async () => {
    fetchEventsMock.mockResolvedValue({ events: [], nextCursor: null });

    await renderPage({ status: "dead" });

    expect(screen.getByRole("heading", { name: "Nenhum evento com esse filtro" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Nenhum evento ainda" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Limpar filtros" }).length).toBeGreaterThan(0);
  });

  it("shows the waking message, and no filters, when the API is asleep", async () => {
    fetchEventsMock.mockRejectedValue(new ApiUnavailableError("down"));

    await renderPage();

    expect(screen.getByRole("heading", { name: "Acordando a demonstração" })).not.toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("explains an expired page link and leads back to the start", async () => {
    fetchEventsMock.mockRejectedValue(new ApiError(400, "invalid_cursor"));

    await renderPage({ cursor: "old" });

    expect(
      screen.getByRole("heading", { name: "Esse link de página não vale mais" }),
    ).not.toBeNull();
    expect(
      screen.getByText("O ponto de partida dessa página da lista não é reconhecido."),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "Voltar ao início" }).getAttribute("href")).toBe(
      "/events",
    );
  });

  it("explains a missing demo endpoint", async () => {
    fetchEventsMock.mockRejectedValue(new ApiError(404, "demo_endpoint_not_found"));

    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Endpoint de demonstração não encontrado" }),
    ).not.toBeNull();
  });

  it("lets any other failure reach the error screen", async () => {
    fetchEventsMock.mockRejectedValue(new ApiError(500, "unknown"));

    await expect(
      EventsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
