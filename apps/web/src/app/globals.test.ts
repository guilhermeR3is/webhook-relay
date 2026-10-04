import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function token(name: string) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css);
  if (!match?.[1]) throw new Error(`token --${name} not found in globals.css`);
  return match[1];
}

function channel(hex: string, start: number) {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(first: string, second: string) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

const pageSurfaces = ["card", "background", "muted"];

describe("the color tokens", () => {
  it.each(pageSurfaces)("keeps the field and checkbox border at 3:1 on %s", (surface) => {
    expect(contrast(token("input"), token(surface))).toBeGreaterThanOrEqual(3);
  });

  it.each(["state-succeeded", "state-pending", "state-dead"])(
    "keeps the %s mark at 3:1 on the card and on the page",
    (state) => {
      expect(contrast(token(state), token("card"))).toBeGreaterThanOrEqual(3);
      expect(contrast(token(state), token("background"))).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(["foreground", "muted-foreground"])(
    "keeps the %s text at 4.5:1 on every surface",
    (text) => {
      for (const surface of pageSurfaces) {
        expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("keeps the blue readable as text and as a button", () => {
    expect(contrast(token("primary"), token("card"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("primary"), token("background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("primary-foreground"), token("primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the text of the rail readable on the dark panel", () => {
    expect(contrast(token("sidebar-foreground"), token("sidebar"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("sidebar-muted-foreground"), token("sidebar"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("does not switch every animation off for people who asked for less motion", () => {
    expect(css).not.toContain("0.01ms");
  });
});
