// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeadError from "./error";

afterEach(cleanup);

describe("the dead queue error screen", () => {
  it("is the dead queue that failed", () => {
    render(<DeadError error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Mortas" })).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Não foi possível carregar as entregas mortas" }),
    ).not.toBeNull();
  });
});
