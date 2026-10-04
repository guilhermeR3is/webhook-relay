import { describe, expect, it } from "vitest";
import { headerState, selectedOf, toggleAllDeliveries, toggleDelivery } from "./selection";

const visible = ["a", "b", "c"];

describe("toggleDelivery", () => {
  it("adds a delivery that was not selected", () => {
    expect([...toggleDelivery(new Set(["a"]), "b")]).toEqual(["a", "b"]);
  });

  it("removes a delivery that was selected", () => {
    expect([...toggleDelivery(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("does not change the set it was given", () => {
    const before = new Set(["a"]);

    toggleDelivery(before, "b");

    expect([...before]).toEqual(["a"]);
  });
});

describe("selectedOf", () => {
  it("keeps the order of the list, not the order of the clicks", () => {
    expect(selectedOf(new Set(["c", "a"]), visible)).toEqual(["a", "c"]);
  });

  it("drops ids that are no longer on the screen", () => {
    expect(selectedOf(new Set(["a", "gone"]), visible)).toEqual(["a"]);
  });

  it("is empty when nothing is selected", () => {
    expect(selectedOf(new Set(), visible)).toEqual([]);
  });
});

describe("headerState", () => {
  it("is none with nothing selected, and also when only gone ids are", () => {
    expect(headerState(new Set(), visible)).toBe("none");
    expect(headerState(new Set(["gone"]), visible)).toBe("none");
  });

  it("is some while part of the list is selected", () => {
    expect(headerState(new Set(["a"]), visible)).toBe("some");
    expect(headerState(new Set(["a", "b"]), visible)).toBe("some");
  });

  it("is all when every visible delivery is selected", () => {
    expect(headerState(new Set(["a", "b", "c"]), visible)).toBe("all");
  });

  it("stays all when ids that are gone are also in the set", () => {
    expect(headerState(new Set(["a", "b", "c", "gone"]), visible)).toBe("all");
  });

  it("is none for an empty list", () => {
    expect(headerState(new Set(), [])).toBe("none");
  });
});

describe("toggleAllDeliveries", () => {
  it("selects every visible delivery from none", () => {
    expect([...toggleAllDeliveries(new Set(), visible)]).toEqual(visible);
  });

  it("selects every visible delivery from some, instead of clearing", () => {
    expect([...toggleAllDeliveries(new Set(["b"]), visible)]).toEqual(visible);
  });

  it("clears everything from all", () => {
    expect(toggleAllDeliveries(new Set(visible), visible).size).toBe(0);
  });
});
