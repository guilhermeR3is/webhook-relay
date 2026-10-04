import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";

const id = "0199a3b4-7c1e-7a52-9d3f-2b8e4c6a1f07";
const at = new Date("2026-10-03T12:00:05.123Z");

describe("cursor", () => {
  it("gives back the same date, down to the millisecond, and the same id", () => {
    expect(decodeCursor(encodeCursor({ at, id }))).toEqual({ at, id });
  });

  it("is safe to put in a URL", () => {
    expect(encodeCursor({ at, id })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["an empty value", ""],
    ["text that is not a cursor", "not a cursor"],
    ["base64 of something else", Buffer.from("hello").toString("base64url")],
    [
      "a date that does not exist",
      Buffer.from(`2026-13-45T25:61:61.000Z_${id}`).toString("base64url"),
    ],
    [
      "an id in upper case",
      Buffer.from(`${at.toISOString()}_${id.toUpperCase()}`).toString("base64url"),
    ],
    ["an id that is not a uuid", Buffer.from(`${at.toISOString()}_123`).toString("base64url")],
    [
      "a date without milliseconds",
      Buffer.from(`2026-10-03T12:00:05Z_${id}`).toString("base64url"),
    ],
  ])("refuses %s", (_name, value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});
