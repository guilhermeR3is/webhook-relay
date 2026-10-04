// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventsError from "./error";

afterEach(cleanup);

describe("the events error screen", () => {
  it("is the events list that failed", () => {
    render(<EventsError error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Eventos" })).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Não foi possível carregar os eventos" }),
    ).not.toBeNull();
  });
});
