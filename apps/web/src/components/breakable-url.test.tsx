// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BreakableUrl } from "./breakable-url";

afterEach(cleanup);

function show(url: string) {
  const { container } = render(
    <p>
      <BreakableUrl url={url} />
    </p>,
  );
  return container.querySelector("p") as HTMLParagraphElement;
}

describe("BreakableUrl", () => {
  it("keeps the whole text of the URL", () => {
    expect(show("https://hooks.example.com/webhook/destino-1").textContent).toBe(
      "https://hooks.example.com/webhook/destino-1",
    );
  });

  it("allows a break after each slash and nowhere else", () => {
    const paragraph = show("https://hooks.example.com/webhook/destino-1");

    expect(paragraph.querySelectorAll("wbr")).toHaveLength(4);
    expect(paragraph.innerHTML).toBe(
      "https:/<wbr>/<wbr>hooks.example.com/<wbr>webhook/<wbr>destino-1",
    );
  });

  it("has no break point in a text without slashes", () => {
    expect(show("destino-1").querySelectorAll("wbr")).toHaveLength(0);
  });

  it("copes with an empty text", () => {
    expect(show("").textContent).toBe("");
  });
});
