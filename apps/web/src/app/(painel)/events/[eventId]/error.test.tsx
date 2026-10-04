// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventDetailError from "./error";

afterEach(cleanup);

describe("the event detail error screen", () => {
  it("is the event that failed, not the whole list", () => {
    render(<EventDetailError error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Evento" })).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Não foi possível carregar o evento" }),
    ).not.toBeNull();
  });
});
