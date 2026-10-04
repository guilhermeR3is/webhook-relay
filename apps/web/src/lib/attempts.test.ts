import { describe, expect, it } from "vitest";
import { barRatio, formatSpan, isSuccessStatus } from "./attempts";

describe("formatSpan", () => {
  it.each([
    [0, "0 ms"],
    [5, "5 ms"],
    [999, "999 ms"],
    [1000, "1 s"],
    [1234, "1,2 s"],
    [9949, "9,9 s"],
    [10_000, "10 s"],
    [42_400, "42 s"],
    [59_400, "59 s"],
    [60_000, "1 min"],
    [125_000, "2 min 5 s"],
    [599_000, "9 min 59 s"],
    [600_000, "10 min"],
    [725_000, "12 min"],
    [3_600_000, "1 h"],
    [3_900_000, "1 h 5 min"],
  ])("writes %i ms as %s", (milliseconds, text) => {
    expect(formatSpan(milliseconds)).toBe(text);
  });

  it("treats a negative span as zero", () => {
    expect(formatSpan(-300)).toBe("0 ms");
  });
});

describe("barRatio", () => {
  it("gives the longest attempt the whole width and the others their share", () => {
    expect(barRatio(10_000, 10_000)).toBe(1);
    expect(barRatio(5000, 10_000)).toBe(0.5);
  });

  it("keeps a very short attempt visible next to a very long one", () => {
    expect(barRatio(5, 10_000)).toBe(0.02);
  });

  it("never goes past the whole width", () => {
    expect(barRatio(20_000, 10_000)).toBe(1);
  });

  it("does not divide by zero when every attempt took no time", () => {
    expect(barRatio(0, 0)).toBe(0.02);
  });
});

describe("isSuccessStatus", () => {
  it.each([200, 201, 204, 299])("accepts %i", (status) => {
    expect(isSuccessStatus(status)).toBe(true);
  });

  it.each([199, 300, 301, 400, 410, 503, null])("refuses %s", (status) => {
    expect(isSuccessStatus(status)).toBe(false);
  });
});
