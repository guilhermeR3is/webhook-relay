// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavRail } from "./nav-rail";

const pathname = vi.hoisted(() => ({ current: "/events" }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

afterEach(cleanup);

function currentLinks() {
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

describe("NavRail", () => {
  it("links to the three areas of the panel", () => {
    render(<NavRail />);

    const hrefs = ["Eventos", "Mortas", "Destinos"].map((name) =>
      screen.getByRole("link", { name }).getAttribute("href"),
    );
    expect(hrefs).toEqual(["/events", "/dead", "/destinations"]);
  });

  it("marks only the area being viewed as the current page", () => {
    pathname.current = "/dead";

    render(<NavRail />);

    expect(currentLinks()).toEqual(["Mortas"]);
  });

  it("keeps the area marked inside its detail pages", () => {
    pathname.current = "/events/0199a3b4-7c1e-7a52-9d3f-2b8e4c6a1f07";

    render(<NavRail />);

    expect(currentLinks()).toEqual(["Eventos"]);
  });

  it("does not mark an area whose name only starts the same way", () => {
    pathname.current = "/events-archive";

    render(<NavRail />);

    expect(currentLinks()).toEqual([]);
  });

  it("changes color at once, with no fade, because the menu is used all day", () => {
    render(<NavRail />);

    for (const name of ["Eventos", "Mortas", "Destinos"]) {
      expect(screen.getByRole("link", { name }).className).not.toContain("transition");
    }
  });
});
