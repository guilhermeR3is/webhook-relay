import { describe, expect, it } from "vitest";
import { deadHref, parseDeadQuery } from "./dead-query";

describe("parseDeadQuery", () => {
  it("reads the cursor", () => {
    expect(parseDeadQuery({ cursor: "abc" })).toEqual({ cursor: "abc" });
  });

  it("takes the first when the cursor is repeated", () => {
    expect(parseDeadQuery({ cursor: ["a", "b"] })).toEqual({ cursor: "a" });
  });

  it("treats a missing or empty cursor as the first page", () => {
    expect(parseDeadQuery({})).toEqual({});
    expect(parseDeadQuery({ cursor: "" })).toEqual({});
    expect(parseDeadQuery({ cursor: [] })).toEqual({});
  });

  it("ignores everything else in the URL", () => {
    expect(parseDeadQuery({ status: "dead", search: "x" })).toEqual({});
  });
});

describe("deadHref", () => {
  it("points at the first page without a cursor", () => {
    expect(deadHref({})).toBe("/dead");
  });

  it("escapes the cursor", () => {
    expect(deadHref({ cursor: "a b&c=" })).toBe("/dead?cursor=a+b%26c%3D");
  });
});
