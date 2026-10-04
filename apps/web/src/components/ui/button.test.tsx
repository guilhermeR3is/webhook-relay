// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("is 44 px tall on phones and 36 px from the desktop layout up when large", () => {
    render(<Button size="lg">Buscar</Button>);

    const classes = screen.getByRole("button").classList;
    expect(classes).toContain("h-11");
    expect(classes).toContain("md:h-9");
  });

  it("presses in with a scale instead of moving down, and only when motion is welcome", () => {
    render(<Button>Reenviar</Button>);

    const classes = screen.getByRole("button").classList;
    expect(classes).toContain("motion-safe:active:not-aria-[haspopup]:scale-[0.97]");
    expect(classes).not.toContain("active:not-aria-[haspopup]:translate-y-px");
  });

  it("names the properties it transitions, because all of them would include the scrollbar and the outline", () => {
    render(<Button>Reenviar</Button>);

    const classes = screen.getByRole("button").classList;
    expect(classes).not.toContain("transition-all");
    expect(classes).toContain("transition-[color,background-color,border-color,box-shadow,scale]");
  });

  it("keeps the small button on the type scale, at 12 px", () => {
    render(<Button size="sm">Atualizar</Button>);

    const classes = screen.getByRole("button").classList;
    expect(classes).toContain("text-xs");
    expect([...classes].some((name) => name.startsWith("text-["))).toBe(false);
  });
});
