// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError } from "@/lib/api";
import { fetchEventDetail, type EventDetail } from "@/lib/event-detail";
import EventDetailPage, { metadata } from "./page";

vi.mock("@/lib/event-detail", () => ({ fetchEventDetail: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const fetchMock = vi.mocked(fetchEventDetail);

const eventId = "0199a3b4-7c1e-7a52-9d3f-2b8e4c6a1f07";

function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: eventId,
    eventType: "invoice.paid",
    idempotencyKey: "order-1001",
    receivedAt: new Date("2026-10-03T15:00:05Z"),
    headers: { "content-type": "application/json" },
    body: { size: 13, text: '{"amount":10}', truncated: false },
    deliveries: [
      {
        id: "d1",
        status: "succeeded",
        attemptCount: 1,
        nextAttemptAt: new Date("2026-10-03T15:00:05Z"),
        lastError: null,
        succeededAt: new Date("2026-10-03T15:00:06Z"),
        createdAt: new Date("2026-10-03T15:00:05Z"),
        destination: { id: "x1", displayUrl: "https://hooks.example.com/webhook/…" },
        sequences: [
          {
            number: 1,
            resentAt: null,
            attempts: [
              {
                id: "a1",
                startedAt: new Date("2026-10-03T15:00:06Z"),
                durationMs: 120,
                httpStatus: 200,
                responseSnippet: "ok",
                error: null,
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function props(id = eventId) {
  return { params: Promise.resolve({ eventId: id }), searchParams: Promise.resolve({}) };
}

async function renderPage(id = eventId) {
  render(await EventDetailPage(props(id)));
}

beforeEach(() => {
  fetchMock.mockResolvedValue(detail());
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("the event detail page", () => {
  it("gives the page its own title instead of the name of the product", () => {
    expect(metadata.title).toBe("Evento");
  });

  it("asks for the event of the address", async () => {
    await renderPage("abc");

    expect(fetchMock).toHaveBeenCalledWith("abc");
  });

  it("shows the type as the title, the key and the id, with a way back", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "invoice.paid" })).not.toBeNull();
    expect(screen.getByText("order-1001")).not.toBeNull();
    expect(screen.getByText(eventId)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Eventos" }).getAttribute("href")).toBe("/events");
  });

  it("gives the way back a touch height of 44 px on phones", async () => {
    await renderPage();

    expect(screen.getByRole("link", { name: "Eventos" }).classList).toContain("min-h-11");
  });

  it("shows the time received in Brasília time", async () => {
    await renderPage();

    expect(screen.getByText("03/10/2026 12:00:05 BRT")).not.toBeNull();
  });

  it("shows a panel for each delivery, then the body and the headers", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "Entregas" })).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "https://hooks.example.com/webhook/…" }),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Corpo recebido" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Cabeçalhos guardados" })).not.toBeNull();
  });

  it("says the page updates by itself while a delivery is waiting to be sent", async () => {
    const waiting = detail().deliveries[0];
    if (!waiting) throw new Error("the fixture has a delivery");
    fetchMock.mockResolvedValue(
      detail({ deliveries: [{ ...waiting, status: "in_progress", succeededAt: null }] }),
    );

    await renderPage();

    expect(screen.getByRole("status").textContent).toBe("Atualizando sozinha");
  });

  it("does not poll when every delivery is finished", async () => {
    await renderPage();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the announcer for screen readers even when the page stops updating itself", async () => {
    await renderPage();

    expect(document.querySelector("[aria-live=polite]")).not.toBeNull();
  });

  it("tells screen readers how the deliveries are when the page loads again", async () => {
    const waiting = detail().deliveries[0];
    if (!waiting) throw new Error("the fixture has a delivery");
    fetchMock.mockResolvedValue(
      detail({ deliveries: [{ ...waiting, status: "pending", succeededAt: null }] }),
    );
    const { rerender } = render(await EventDetailPage(props()));

    fetchMock.mockResolvedValue(detail());
    rerender(await EventDetailPage(props()));

    expect(document.querySelector("[aria-live=polite]")?.textContent).toBe(
      "Atualizado: 1 entregue; 1 tentativa.",
    );
  });

  it("explains that nothing was sent when no destination was subscribed", async () => {
    fetchMock.mockResolvedValue(detail({ deliveries: [] }));

    await renderPage();

    expect(screen.getByRole("heading", { name: "Nada foi enviado" })).not.toBeNull();
  });

  it("shows the waking message when the API is asleep", async () => {
    fetchMock.mockRejectedValue(new ApiUnavailableError("down"));

    await renderPage();

    expect(screen.getByRole("heading", { name: "Acordando a demonstração" })).not.toBeNull();
  });

  it("goes to the not-found page when the API says the event does not exist", async () => {
    fetchMock.mockRejectedValue(new ApiError(404, "event_not_found"));

    await expect(EventDetailPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
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

    await expect(EventDetailPage(props())).rejects.toMatchObject({
      status: 500,
    });
  });
});
