// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TrackMark } from "@/lib/circuit";
import { CircuitTrack } from "./circuit-track";

afterEach(cleanup);

function show(marks: TrackMark[]) {
  const { container } = render(<CircuitTrack marks={marks} />);
  const track = container.querySelector("[data-track]") as HTMLElement;
  return {
    track,
    stations: track.children.length,
    crosses: track.querySelectorAll('svg[data-status="dead"]').length,
    testing: track.querySelectorAll('svg[data-status="in_progress"]').length,
    empty: track.children.length - track.querySelectorAll("svg").length,
  };
}

describe("CircuitTrack", () => {
  it("draws one station per mark", () => {
    expect(show(["empty", "empty", "empty"]).stations).toBe(3);
    expect(show(["empty", "empty", "empty", "empty", "empty"]).stations).toBe(5);
  });

  it("draws a cross for each failure and a hollow ring for each station still free", () => {
    const track = show(["failure", "failure", "empty", "empty", "empty"]);

    expect(track.crosses).toBe(2);
    expect(track.empty).toBe(3);
    expect(track.testing).toBe(0);
  });

  it("draws the half filled mark for the station being tested", () => {
    const track = show(["failure", "failure", "failure", "failure", "testing"]);

    expect(track.crosses).toBe(4);
    expect(track.testing).toBe(1);
    expect(track.empty).toBe(0);
  });

  it("draws every station as a cross for an open circuit", () => {
    const track = show(["failure", "failure", "failure", "failure", "failure"]);

    expect(track.crosses).toBe(5);
    expect(track.empty).toBe(0);
  });

  it("stays out of the screen reader, because the text next to it says the same", () => {
    expect(show(["empty"]).track.getAttribute("aria-hidden")).toBe("true");
  });
});
