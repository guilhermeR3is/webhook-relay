import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto.js";

const key = randomBytes(32);

function flipBit(payload: string, index: number) {
  const bytes = Buffer.from(payload, "base64");
  bytes.writeUInt8(bytes.readUInt8(index) ^ 1, index);
  return bytes.toString("base64");
}

describe("encryptSecret and decryptSecret", () => {
  it("recovers the original secret", () => {
    const secret = "whsec_Zm9vYmFy-çãõ";

    expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
  });

  it("recovers an empty secret", () => {
    expect(decryptSecret(encryptSecret("", key), key)).toBe("");
  });

  it("produces a different payload each time for the same secret", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("does not leak the plaintext in the payload", () => {
    const payload = encryptSecret("super-secret-value", key);

    expect(Buffer.from(payload, "base64").toString("utf8")).not.toContain("super-secret-value");
  });

  it("rejects a payload decrypted with another key", () => {
    const payload = encryptSecret("secret", key);

    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
  });

  it("rejects a payload with a flipped bit in the ciphertext", () => {
    const payload = encryptSecret("secret", key);
    const lastByte = Buffer.from(payload, "base64").length - 1;

    expect(() => decryptSecret(flipBit(payload, lastByte), key)).toThrow();
  });

  it("rejects a payload with a flipped bit in the auth tag", () => {
    const payload = encryptSecret("secret", key);

    expect(() => decryptSecret(flipBit(payload, 12), key)).toThrow();
  });

  it("rejects a payload shorter than iv plus tag", () => {
    expect(() => decryptSecret("AAAA", key)).toThrow("too short");
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret("secret", randomBytes(16))).toThrow("32 bytes");
    expect(() => decryptSecret("AAAA", randomBytes(16))).toThrow("32 bytes");
  });
});
