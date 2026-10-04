import { describe, expect, it } from "vitest";
import { countOf } from "./plural";

describe("countOf", () => {
  it("uses the singular only for exactly one", () => {
    expect(countOf(1, "entrega", "entregas")).toBe("1 entrega");
  });

  it("uses the plural for zero and for more than one", () => {
    expect(countOf(0, "entrega", "entregas")).toBe("0 entregas");
    expect(countOf(2, "entrega", "entregas")).toBe("2 entregas");
    expect(countOf(25, "entrega", "entregas")).toBe("25 entregas");
  });
});
