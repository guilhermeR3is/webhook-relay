import { describe, expect, it } from "vitest";
import { formatBodySize } from "./body-size";

describe("formatBodySize", () => {
  it.each([
    [0, "0 bytes"],
    [1, "1 byte"],
    [13, "13 bytes"],
    [1023, "1023 bytes"],
    [1024, "1 KiB"],
    [1536, "1,5 KiB"],
    [16 * 1024, "16 KiB"],
    [1024 * 1024 - 1, "1 MiB"],
    [1024 * 1024, "1 MiB"],
  ])("writes %i as %s", (bytes, text) => {
    expect(formatBodySize(bytes)).toBe(text);
  });
});
