// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError } from "@/lib/api";
import { explainLoadError } from "./explain-load-error";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const invalidCursor = {
  text: "O ponto de partida não é reconhecido.",
  action: <a href="/x">Voltar</a>,
};

describe("explainLoadError", () => {
  it("says the demonstration is waking up when the API is asleep", () => {
    render(explainLoadError(new ApiUnavailableError("down")));

    expect(screen.getByText("Acordando a demonstração")).not.toBeNull();
  });

  it("explains a demo endpoint that the API does not know", () => {
    render(explainLoadError(new ApiError(404, "demo_endpoint_not_found")));

    expect(screen.getByText("Endpoint de demonstração não encontrado")).not.toBeNull();
    expect(screen.getByText(/DEMO_ENDPOINT_SLUG/)).not.toBeNull();
  });

  it("explains an old page link with the text and the action of the page", () => {
    render(explainLoadError(new ApiError(400, "invalid_cursor"), invalidCursor));

    expect(screen.getByText("Esse link de página não vale mais")).not.toBeNull();
    expect(screen.getByText("O ponto de partida não é reconhecido.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Voltar" }).getAttribute("href")).toBe("/x");
  });

  it("leaves an old page link to the error screen when the page has no pages", () => {
    expect(explainLoadError(new ApiError(400, "invalid_cursor"))).toBeNull();
  });

  it("returns nothing for the errors it does not explain", () => {
    expect(explainLoadError(new ApiError(500, "internal"))).toBeNull();
    expect(explainLoadError(new ApiError(404, "event_not_found"))).toBeNull();
    expect(explainLoadError(new Error("boom"))).toBeNull();
    expect(explainLoadError("text")).toBeNull();
  });
});
