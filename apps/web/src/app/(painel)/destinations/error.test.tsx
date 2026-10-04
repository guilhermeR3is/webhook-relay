// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DestinationsError from "./error";

afterEach(cleanup);

describe("the destinations error screen", () => {
  it("is the destinations screen that failed", () => {
    render(<DestinationsError error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Destinos" })).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Não foi possível carregar os destinos" }),
    ).not.toBeNull();
  });
});
