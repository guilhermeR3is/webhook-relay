import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./signature.js";

const secret = "whsec_test";
const rawBody = Buffer.from('{"action":"opened","note":"ção"}');

function sign(body: Buffer, key = secret) {
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}

describe("verifySignature with generic_hmac", () => {
  const verify = (headers: Record<string, string | string[] | undefined>, body = rawBody) =>
    verifySignature({ scheme: "generic_hmac", secret, rawBody: body, headers });

  it("accepts a valid signature", () => {
    expect(verify({ "x-signature-256": sign(rawBody) })).toEqual({ ok: true });
  });

  it("accepts uppercase hex", () => {
    const upper = `sha256=${sign(rawBody).slice(7).toUpperCase()}`;

    expect(verify({ "x-signature-256": upper })).toEqual({ ok: true });
  });

  it("rejects a signature made with another secret", () => {
    expect(verify({ "x-signature-256": sign(rawBody, "other") })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects a body changed by a single byte", () => {
    const tampered = Buffer.from(rawBody);
    tampered.writeUInt8(tampered.readUInt8(0) ^ 1, 0);

    expect(verify({ "x-signature-256": sign(rawBody) }, tampered)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects a request without the signature header", () => {
    expect(verify({})).toEqual({ ok: false, reason: "missing" });
  });

  it.each([
    ["no sha256 prefix", sign(rawBody).slice(7)],
    ["a different algorithm prefix", sign(rawBody).replace("sha256", "sha1")],
    ["a digest that is too short", "sha256=abcd"],
    ["a digest with non-hex characters", `sha256=${"z".repeat(64)}`],
    ["trailing whitespace", `${sign(rawBody)} `],
    ["an empty value", ""],
  ])("rejects %s as malformed", (_name, header) => {
    expect(verify({ "x-signature-256": header })).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a repeated header even when one copy is valid", () => {
    expect(verify({ "x-signature-256": [sign(rawBody), sign(rawBody)] })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("ignores the github header", () => {
    expect(verify({ "x-hub-signature-256": sign(rawBody) })).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});

describe("verifySignature with github", () => {
  const verify = (headers: Record<string, string | undefined>, body = rawBody) =>
    verifySignature({ scheme: "github", secret, rawBody: body, headers });

  it("accepts a valid signature in x-hub-signature-256", () => {
    expect(verify({ "x-hub-signature-256": sign(rawBody) })).toEqual({ ok: true });
  });

  it("matches the example published in the GitHub documentation", () => {
    const documentedExample = verifySignature({
      scheme: "github",
      secret: "It's a Secret to Everybody",
      rawBody: Buffer.from("Hello, World!"),
      headers: {
        "x-hub-signature-256":
          "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      },
    });

    expect(documentedExample).toEqual({ ok: true });
  });

  it("rejects an invalid signature", () => {
    expect(verify({ "x-hub-signature-256": sign(rawBody, "other") })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects a request without the signature header", () => {
    expect(verify({})).toEqual({ ok: false, reason: "missing" });
  });

  it("ignores the generic header", () => {
    expect(verify({ "x-signature-256": sign(rawBody) })).toEqual({ ok: false, reason: "missing" });
  });
});

describe("verifySignature with none", () => {
  it("accepts a request without any signature", () => {
    expect(verifySignature({ scheme: "none", secret: null, rawBody, headers: {} })).toEqual({
      ok: true,
    });
  });
});

describe("verifySignature with a misconfigured endpoint", () => {
  it("throws when a signed scheme has no secret", () => {
    expect(() => verifySignature({ scheme: "github", secret: null, rawBody, headers: {} })).toThrow(
      "no secret",
    );
  });
});
