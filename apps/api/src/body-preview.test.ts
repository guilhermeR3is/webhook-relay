import { describe, expect, it } from "vitest";
import { previewBody } from "./body-preview.js";

const PREVIEW_BYTES = 16 * 1024;

describe("previewBody", () => {
  it("returns text as it is, with the size in bytes and not in characters", () => {
    expect(previewBody(Buffer.from("olá"))).toEqual({ size: 4, text: "olá", truncated: false });
  });

  it("treats an empty body as empty text", () => {
    expect(previewBody(Buffer.alloc(0))).toEqual({ size: 0, text: "", truncated: false });
  });

  it("gives no text for a body that is not UTF-8", () => {
    expect(previewBody(Buffer.from([0x7b, 0xff, 0x00, 0xfe]))).toEqual({
      size: 4,
      text: null,
      truncated: false,
    });
  });

  it("keeps a body of exactly the preview size whole", () => {
    const preview = previewBody(Buffer.alloc(PREVIEW_BYTES, "a"));

    expect(preview.truncated).toBe(false);
    expect(preview.text?.length).toBe(PREVIEW_BYTES);
  });

  it("cuts a longer body at the preview size and says so", () => {
    const preview = previewBody(Buffer.alloc(PREVIEW_BYTES + 10, "a"));

    expect(preview).toMatchObject({ size: PREVIEW_BYTES + 10, truncated: true });
    expect(preview.text?.length).toBe(PREVIEW_BYTES);
  });

  it("drops a character the cut split in half instead of showing a replacement mark", () => {
    const body = Buffer.concat([Buffer.alloc(PREVIEW_BYTES - 1, "a"), Buffer.from("é and more")]);

    const preview = previewBody(body);

    expect(preview.truncated).toBe(true);
    expect(preview.text).toBe("a".repeat(PREVIEW_BYTES - 1));
  });

  it("decides on the whole body, so invalid bytes after the preview still give no text", () => {
    const body = Buffer.concat([Buffer.alloc(PREVIEW_BYTES + 5, "a"), Buffer.from([0xff])]);

    expect(previewBody(body).text).toBeNull();
  });
});
