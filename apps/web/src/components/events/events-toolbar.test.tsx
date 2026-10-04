// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_SEARCH_LENGTH } from "@/lib/events-query";
import { EventsToolbar } from "./events-toolbar";

afterEach(cleanup);

function chips() {
  const filterNav = screen.getByRole("navigation", { name: /Filtrar/ });
  return within(filterNav)
    .getAllByRole("link")
    .filter((link) => link.textContent !== "Limpar filtros");
}

describe("EventsToolbar", () => {
  it("offers all the states, worst first, after the link for everything", () => {
    render(<EventsToolbar query={{}} />);

    expect(chips().map((link) => link.getAttribute("href"))).toEqual([
      "/events",
      "/events?status=dead",
      "/events?status=pending",
      "/events?status=in_progress",
      "/events?status=succeeded",
    ]);
    expect(chips().map((link) => link.textContent)).toEqual([
      "Todos",
      "mortas",
      "pendentes",
      "em andamento",
      "entregues",
    ]);
  });

  it("marks only the state being filtered, and 'Todos' when there is none", () => {
    const { rerender } = render(<EventsToolbar query={{}} />);
    expect(
      chips()
        .filter((link) => link.hasAttribute("aria-current"))
        .map((link) => link.textContent),
    ).toEqual(["Todos"]);

    rerender(<EventsToolbar query={{ status: "pending" }} />);

    expect(
      chips()
        .filter((link) => link.hasAttribute("aria-current"))
        .map((link) => link.textContent),
    ).toEqual(["pendentes"]);
  });

  it("keeps the search text when a state is chosen", () => {
    render(<EventsToolbar query={{ search: "push events" }} />);

    expect(chips().map((link) => link.getAttribute("href"))).toEqual([
      "/events?search=push+events",
      "/events?status=dead&search=push+events",
      "/events?status=pending&search=push+events",
      "/events?status=in_progress&search=push+events",
      "/events?status=succeeded&search=push+events",
    ]);
  });

  it("fills the search box and limits it to what the API accepts", () => {
    render(<EventsToolbar query={{ search: "invoice" }} />);

    const box = screen.getByRole("searchbox", { name: "Buscar eventos" });
    expect(box).toHaveProperty("value", "invoice");
    expect(box.getAttribute("maxlength")).toBe(String(MAX_SEARCH_LENGTH));
  });

  it("keeps the chosen state when a new search is sent", () => {
    const { container } = render(<EventsToolbar query={{ status: "dead" }} />);

    const hidden = container.querySelector('form input[type="hidden"]');
    expect(hidden?.getAttribute("name")).toBe("status");
    expect(hidden?.getAttribute("value")).toBe("dead");
    expect(container.querySelector("form")?.getAttribute("method")).toBe("get");
  });

  it("sends no state when none is chosen", () => {
    const { container } = render(<EventsToolbar query={{}} />);

    expect(container.querySelector('form input[type="hidden"]')).toBeNull();
  });

  it("keeps the search, the filters and the clear link 44 px tall on phones", () => {
    render(<EventsToolbar query={{ search: "x" }} />);

    const controls = [
      screen.getByRole("searchbox", { name: "Buscar eventos" }),
      ...chips(),
      screen.getByRole("link", { name: "Limpar filtros" }),
    ];
    for (const control of controls) {
      expect(control.classList).toContain("h-11");
      expect(control.classList).toContain("md:h-9");
    }
  });

  it("makes the filters press in with a scale that the transition covers, only when motion is welcome", () => {
    render(<EventsToolbar query={{}} />);

    for (const chip of chips()) {
      expect(chip.classList).toContain("transition-[background-color,scale]");
      expect(chip.classList).toContain("motion-safe:active:scale-[0.97]");
    }
  });

  it("offers to clear the filters only when there are filters", () => {
    const { rerender } = render(<EventsToolbar query={{}} />);
    expect(screen.queryByRole("link", { name: "Limpar filtros" })).toBeNull();

    rerender(<EventsToolbar query={{ search: "x" }} />);
    expect(screen.getByRole("link", { name: "Limpar filtros" }).getAttribute("href")).toBe(
      "/events",
    );

    rerender(<EventsToolbar query={{ status: "dead" }} />);
    expect(screen.getByRole("link", { name: "Limpar filtros" })).not.toBeNull();
  });
});
