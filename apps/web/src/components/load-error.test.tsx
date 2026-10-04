// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadError } from "./load-error";

afterEach(cleanup);

function show(error: Error & { digest?: string }, retry = vi.fn()) {
  render(
    <LoadError heading="Eventos" title="Não foi possível carregar" error={error} retry={retry} />,
  );
  return retry;
}

describe("LoadError", () => {
  it("keeps the page heading and says what failed, without showing the raw error", () => {
    show(new Error("ZodError: events expected array"));

    expect(screen.getByRole("heading", { level: 1, name: "Eventos" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Não foi possível carregar" })).not.toBeNull();
    expect(screen.queryByText(/ZodError/)).toBeNull();
  });

  it("shows the error code, so someone can find it in the server log", () => {
    show(Object.assign(new Error("boom"), { digest: "2810555924" }));

    expect(screen.getByText("2810555924")).not.toBeNull();
  });

  it("shows no code line when the error has none", () => {
    show(new Error("boom"));

    expect(screen.queryByText(/Código do erro/)).toBeNull();
  });

  it("tries to load the page again when asked", () => {
    const retry = show(new Error("boom"));

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
