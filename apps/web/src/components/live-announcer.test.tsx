// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveAnnouncer } from "./live-announcer";

afterEach(cleanup);

function region() {
  const element = document.querySelector("[aria-live]");
  if (!element) throw new Error("the announcer has no live region");
  return element;
}

describe("LiveAnnouncer", () => {
  it("is a polite live region, hidden from the eye, and says nothing on the first render", () => {
    render(<LiveAnnouncer report="1 pendente; 0 tentativas" />);

    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(region().getAttribute("aria-atomic")).toBe("true");
    expect(region().classList).toContain("sr-only");
    expect(region().textContent).toBe("");
  });

  it("says what the page is like now when the report changes", () => {
    const { rerender } = render(<LiveAnnouncer report="1 pendente; 2 tentativas" />);

    rerender(<LiveAnnouncer report="1 entregue; 3 tentativas" />);

    expect(region().textContent).toBe("Atualizado: 1 entregue; 3 tentativas.");
  });

  it("keeps the last message while the report stays the same", () => {
    const { rerender } = render(<LiveAnnouncer report="a" />);
    rerender(<LiveAnnouncer report="b" />);

    rerender(<LiveAnnouncer report="b" />);

    expect(region().textContent).toBe("Atualizado: b.");
  });

  it("follows each change in turn", () => {
    const { rerender } = render(<LiveAnnouncer report="a" />);
    rerender(<LiveAnnouncer report="b" />);

    rerender(<LiveAnnouncer report="c" />);

    expect(region().textContent).toBe("Atualizado: c.");
  });
});
