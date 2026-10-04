import { describe, expect, it } from "vitest";
import { groupAttemptSequences } from "./attempt-sequences.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 3, 12, 0, seconds));
const attempts = ["a1", "a2", "a3", "a4", "a5", "a6"];

describe("groupAttemptSequences", () => {
  it("returns nothing for a delivery that never tried and was never resent", () => {
    expect(groupAttemptSequences([], [])).toEqual([]);
  });

  it("keeps every attempt in one sequence when there was no resend", () => {
    expect(groupAttemptSequences(attempts, [])).toEqual([{ number: 1, resentAt: null, attempts }]);
  });

  it("starts a new sequence at the attempt count the resend recorded", () => {
    const sequences = groupAttemptSequences(attempts, [{ requestedAt: at(30), attemptsBefore: 4 }]);

    expect(sequences).toEqual([
      { number: 1, resentAt: null, attempts: ["a1", "a2", "a3", "a4"] },
      { number: 2, resentAt: at(30), attempts: ["a5", "a6"] },
    ]);
  });

  it("splits into as many sequences as there are resends", () => {
    const sequences = groupAttemptSequences(attempts, [
      { requestedAt: at(30), attemptsBefore: 2 },
      { requestedAt: at(60), attemptsBefore: 5 },
    ]);

    expect(sequences.map((sequence) => sequence.attempts)).toEqual([
      ["a1", "a2"],
      ["a3", "a4", "a5"],
      ["a6"],
    ]);
    expect(sequences.map((sequence) => sequence.number)).toEqual([1, 2, 3]);
  });

  it("shows an empty last sequence while a resent delivery has not tried yet", () => {
    const sequences = groupAttemptSequences(attempts.slice(0, 3), [
      { requestedAt: at(30), attemptsBefore: 3 },
    ]);

    expect(sequences).toEqual([
      { number: 1, resentAt: null, attempts: ["a1", "a2", "a3"] },
      { number: 2, resentAt: at(30), attempts: [] },
    ]);
  });

  it("gives a first sequence with no attempts when a delivery was resent without ever sending", () => {
    expect(groupAttemptSequences([], [{ requestedAt: at(30), attemptsBefore: 0 }])).toEqual([
      { number: 1, resentAt: null, attempts: [] },
      { number: 2, resentAt: at(30), attempts: [] },
    ]);
  });

  it("does not change the list it was given", () => {
    const original = [...attempts];

    groupAttemptSequences(original, [{ requestedAt: at(30), attemptsBefore: 4 }]);

    expect(original).toEqual(attempts);
  });
});
