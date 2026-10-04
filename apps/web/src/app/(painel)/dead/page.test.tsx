// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeadQueue } from "@/components/dead/dead-queue";
import { ApiError, ApiUnavailableError } from "@/lib/api";
import { fetchDeadDeliveries, type DeadDeliveriesPage } from "@/lib/dead-deliveries";
import DeadPage, { metadata } from "./page";

vi.mock("@/lib/dead-deliveries", () => ({ fetchDeadDeliveries: vi.fn() }));
vi.mock("@/components/dead/resend-batch-action", () => ({ resendBatchAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const fetchMock = vi.mocked(fetchDeadDeliveries);

function page(overrides: Partial<DeadDeliveriesPage> = {}): DeadDeliveriesPage {
  return {
    deliveries: [
      {
        id: "d1",
        eventId: "e1",
        eventType: "invoice.paid",
        destination: { id: "x1", displayUrl: "https://hooks.example.com/webhook/…" },
        attemptCount: 8,
        lastError: "destination answered 503, gave up after 8 attempts",
        createdAt: new Date("2026-10-04T14:50:00Z"),
        lastAttempt: {
          startedAt: new Date("2026-10-04T14:59:00Z"),
          durationMs: 120,
          httpStatus: 503,
        },
      },
    ],
    nextCursor: null,
    ...overrides,
  };
}

function props(search: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(search) };
}

async function renderPage(search: Record<string, string | string[]> = {}) {
  render(await DeadPage(props(search)));
}

function findQueue(node: ReactNode): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const found = findQueue(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === DeadQueue) return node;
  return findQueue(node.props.children);
}

beforeEach(() => {
  fetchMock.mockResolvedValue(page());
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("the dead queue page", () => {
  it("gives the page its own title instead of the name of the product", () => {
    expect(metadata.title).toBe("Mortas");
  });

  it("asks for the first page when the address has no cursor", async () => {
    await renderPage();

    expect(fetchMock).toHaveBeenCalledWith({});
  });

  it("asks for the page of the cursor in the address", async () => {
    await renderPage({ cursor: "c1" });

    expect(fetchMock).toHaveBeenCalledWith({ cursor: "c1" });
  });

  it("shows the title, what the queue is and the deliveries", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Mortas" })).not.toBeNull();
    expect(
      screen.getByText(/esgotaram as tentativas ou foram recusadas pelo destino/),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "invoice.paid" })).not.toBeNull();
  });

  it("says the queue is empty when there is nothing dead", async () => {
    fetchMock.mockResolvedValue(page({ deliveries: [] }));

    await renderPage();

    expect(screen.getByRole("heading", { name: "Nenhuma entrega morta" })).not.toBeNull();
  });

  it("has no page links when everything fits in the first page", async () => {
    await renderPage();

    expect(screen.queryByRole("navigation", { name: "Páginas da fila" })).toBeNull();
  });

  it("links to the older deliveries when there are more", async () => {
    fetchMock.mockResolvedValue(page({ nextCursor: "next 1" }));

    await renderPage();

    const next = screen.getByRole("link", { name: "Mais antigas" });
    expect(next.getAttribute("href")).toBe("/dead?cursor=next+1");
    expect(next.getAttribute("rel")).toBe("next");
    expect(screen.queryByRole("link", { name: "Voltar ao início" })).toBeNull();
  });

  it("links back to the start from a later page", async () => {
    await renderPage({ cursor: "c1" });

    expect(screen.getByRole("link", { name: "Voltar ao início" }).getAttribute("href")).toBe(
      "/dead",
    );
  });

  it("starts the queue over, with nothing selected, on every page", async () => {
    const first = findQueue(await DeadPage(props()));
    const second = findQueue(await DeadPage(props({ cursor: "c1" })));
    const third = findQueue(await DeadPage(props({ cursor: "c2" })));

    expect(first?.key).toBe("first");
    expect(second?.key).toBe("c1");
    expect(third?.key).toBe("c2");
  });

  it("tells the queue whether it is the first page", async () => {
    const first = findQueue(await DeadPage(props()));
    const later = findQueue(await DeadPage(props({ cursor: "c1" })));

    expect((first?.props as { firstPage: boolean }).firstPage).toBe(true);
    expect((later?.props as { firstPage: boolean }).firstPage).toBe(false);
  });

  it("shows the waking message when the API is asleep", async () => {
    fetchMock.mockRejectedValue(new ApiUnavailableError("down"));

    await renderPage();

    expect(screen.getByRole("heading", { name: "Acordando a demonstração" })).not.toBeNull();
  });

  it("explains an expired page link and offers the way back", async () => {
    fetchMock.mockRejectedValue(new ApiError(400, "invalid_cursor"));

    await renderPage({ cursor: "old" });

    expect(
      screen.getByRole("heading", { name: "Esse link de página não vale mais" }),
    ).not.toBeNull();
    expect(
      screen.getByText("O ponto de partida dessa página da fila não é reconhecido."),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "Voltar ao início" }).getAttribute("href")).toBe(
      "/dead",
    );
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

    await expect(DeadPage(props())).rejects.toMatchObject({ status: 500 });
  });
});
