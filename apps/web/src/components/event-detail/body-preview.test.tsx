// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BodyPreview } from "./body-preview";

afterEach(cleanup);

describe("BodyPreview", () => {
  it("shows the text as it came, with the size, in a box the keyboard can scroll", () => {
    render(<BodyPreview body={{ size: 13, text: '{"amount":10}', truncated: false }} />);

    expect(screen.getByText("13 bytes")).not.toBeNull();
    const box = screen.getByText('{"amount":10}');
    expect(box.tagName).toBe("PRE");
    expect(box.getAttribute("tabindex")).toBe("0");
  });

  it("says only the start is shown when the body was cut", () => {
    render(<BodyPreview body={{ size: 40_000, text: "abc", truncated: true }} />);

    expect(screen.getByText(/39,1 KiB, mostrando só o começo/)).not.toBeNull();
  });

  it("explains a body that is not text instead of showing garbage", () => {
    render(<BodyPreview body={{ size: 4, text: null, truncated: false }} />);

    expect(screen.getByText(/binário ou não está em UTF-8/)).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Corpo recebido" })).not.toBeNull();
  });

  it("says an empty body is empty", () => {
    render(<BodyPreview body={{ size: 0, text: "", truncated: false }} />);

    expect(screen.getByText("O corpo está vazio.")).not.toBeNull();
  });

  it("shows markup in the body as plain text", () => {
    render(
      <BodyPreview body={{ size: 30, text: "<script>alert(1)</script>", truncated: false }} />,
    );

    expect(screen.getByText("<script>alert(1)</script>").tagName).toBe("PRE");
  });
});
