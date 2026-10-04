// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRefresh } from "./live-refresh";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  refresh.mockReset();
});

describe("LiveRefresh", () => {
  it("says the page updates by itself, to screen readers too", () => {
    render(<LiveRefresh />);

    expect(screen.getByRole("status").textContent).toBe("Atualizando sozinha");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks the page to load again every three seconds", () => {
    render(<LiveRefresh />);

    advance(3000 - 1);
    expect(refresh).not.toHaveBeenCalled();

    advance(1 + 3000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not load the page again while the tab is hidden", () => {
    setVisibility("hidden");
    render(<LiveRefresh />);

    advance(3000 * 5);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops when the component leaves the screen", () => {
    const { unmount } = render(<LiveRefresh />);
    unmount();

    advance(3000 * 5);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("is still updating one millisecond before ten minutes", () => {
    render(<LiveRefresh />);

    advance(600_000 - 1);

    expect(screen.getByRole("status").textContent).toBe("Atualizando sozinha");
  });

  it("gives up after ten minutes and says so", () => {
    render(<LiveRefresh />);
    advance(600_000);
    refresh.mockClear();

    advance(3000 * 5);

    expect(screen.getByRole("status").textContent).toBe("Atualização pausada");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("gives Atualizar a touch area of 44 px around its 28 px", () => {
    render(<LiveRefresh />);
    advance(600_000);

    expect(screen.getByRole("button", { name: "Atualizar" }).classList).toContain("after:-inset-2");
  });

  it("updates right away on Atualizar and starts a new ten minutes", () => {
    render(<LiveRefresh />);
    advance(600_000);
    refresh.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("Atualizando sozinha");
    advance(3000);
    expect(refresh).toHaveBeenCalledTimes(2);
    advance(600_000 - 3000 - 1);
    expect(screen.getByRole("status").textContent).toBe("Atualizando sozinha");
  });

  it("stops the pulse of the dot for people who asked for less motion", () => {
    const { container } = render(<LiveRefresh />);

    const dot = container.querySelector("[aria-hidden=true]");
    expect(dot?.classList).toContain("animate-pulse");
    expect(dot?.classList).toContain("motion-reduce:animate-none");
  });
});
