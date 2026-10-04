import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({ Public_Sans: () => ({ variable: "font-public-sans" }) }));

const { metadata } = await import("./layout");

describe("the root layout", () => {
  it("puts the name of the product after the title of each page", () => {
    expect(metadata.title).toEqual({
      default: "Webhook Relay",
      template: "%s · Webhook Relay",
    });
  });
});
