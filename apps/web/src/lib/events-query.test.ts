import { describe, expect, it } from "vitest";
import { MAX_SEARCH_LENGTH, eventsHref, parseEventsQuery } from "./events-query";

describe("parseEventsQuery", () => {
  it("reads a valid status, search and cursor", () => {
    expect(parseEventsQuery({ status: "dead", search: "invoice", cursor: "abc" })).toEqual({
      status: "dead",
      search: "invoice",
      cursor: "abc",
    });
  });

  it("returns no filter for an empty URL", () => {
    expect(parseEventsQuery({})).toEqual({});
  });

  it("drops a status that does not exist instead of failing", () => {
    expect(parseEventsQuery({ status: "archived" })).toEqual({});
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseEventsQuery({ status: ["pending", "dead"], search: ["a", "b"] })).toEqual({
      status: "pending",
      search: "a",
    });
  });

  it("trims the search and drops it when it is blank", () => {
    expect(parseEventsQuery({ search: "  push  " })).toEqual({ search: "push" });
    expect(parseEventsQuery({ search: "   " })).toEqual({});
  });

  it("cuts a search longer than the API accepts", () => {
    const query = parseEventsQuery({ search: "a".repeat(MAX_SEARCH_LENGTH + 50) });

    expect(query.search).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe("eventsHref", () => {
  it("points to the plain list when there is nothing to filter", () => {
    expect(eventsHref({})).toBe("/events");
  });

  it("keeps every parameter that is set", () => {
    expect(eventsHref({ status: "dead", search: "push", cursor: "abc" })).toBe(
      "/events?status=dead&search=push&cursor=abc",
    );
  });

  it("encodes characters that would break the URL", () => {
    const href = eventsHref({ search: "a&b=c d#e" });

    expect(href).toBe("/events?search=a%26b%3Dc+d%23e");
    expect(new URL(href, "http://x").searchParams.get("search")).toBe("a&b=c d#e");
  });
});
