import { describe, expect, it, vi } from "vitest";
import { MAX_DELAY_SECONDS, nextDelay } from "./backoff.js";

const halfway = () => 0.5;

describe("nextDelay", () => {
  it.each([
    [1, 5],
    [2, 10],
    [3, 20],
    [4, 40],
    [5, 80],
    [6, 160],
    [7, 320],
    [8, 640],
  ])("attempt %i with a fixed generator of 0.5 waits %i seconds", (attempt, expectedSeconds) => {
    expect(nextDelay(attempt, halfway)).toBe(expectedSeconds);
  });

  it("covers the whole range from zero up to the ceiling (full jitter)", () => {
    expect(nextDelay(3, () => 0)).toBe(0);
    expect(nextDelay(3, () => 0.999)).toBeCloseTo(39.96);
  });

  it("never passes one hour, however high the attempt number gets", () => {
    expect(nextDelay(10, () => 0.9999999)).toBeLessThan(MAX_DELAY_SECONDS);
    expect(nextDelay(10, halfway)).toBe(MAX_DELAY_SECONDS / 2);
    expect(nextDelay(5000, halfway)).toBe(MAX_DELAY_SECONDS / 2);
  });

  it("draws from Math.random when no generator is given", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    expect(nextDelay(2)).toBe(5);
    random.mockRestore();
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects attempt %s", (attempt) => {
    expect(() => nextDelay(attempt, halfway)).toThrow(RangeError);
  });
});
