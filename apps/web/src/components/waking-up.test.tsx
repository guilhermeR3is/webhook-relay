// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WakingUp } from "./waking-up";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
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

describe("WakingUp", () => {
  it("says what is happening, to screen readers too", () => {
    render(<WakingUp />);

    expect(screen.getByRole("status").textContent).toContain("Acordando a demonstração");
    expect(screen.queryByText(/demorando/)).toBeNull();
  });

  it("asks the page to load again every few seconds", () => {
    render(<WakingUp />);

    act(() => {
      vi.advanceTimersByTime(4000 - 1);
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1 + 4000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not load the page again while the tab is hidden", () => {
    setVisibility("hidden");
    render(<WakingUp />);

    act(() => {
      vi.advanceTimersByTime(4000 * 3);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops trying when the component leaves the screen", () => {
    const { unmount } = render(<WakingUp />);
    unmount();

    act(() => {
      vi.advanceTimersByTime(4000 * 5);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("admits it is slow after a while and lets the person try right away", () => {
    render(<WakingUp />);

    act(() => {
      vi.advanceTimersByTime(90_000 - 1);
    });
    expect(screen.queryByText(/demorando/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    refresh.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Tentar agora" }));

    expect(screen.getByText(/demorando mais do que o normal/)).not.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("hides the waiting bar for people who asked for less motion, so it does not look like progress", () => {
    const { container } = render(<WakingUp />);

    const track = container.querySelector(".animate-waking")?.parentElement;
    expect(track?.classList).toContain("motion-reduce:hidden");
  });
});
