import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractEventMetadata } from "./event-metadata.js";

const rawBody = Buffer.from('{"action":"opened"}');
const bodyHash = createHash("sha256").update(rawBody).digest("hex");

describe("extractEventMetadata idempotency key", () => {
  it("prefers the Idempotency-Key header over the provider id", () => {
    const metadata = extractEventMetadata({
      scheme: "github",
      headers: { "idempotency-key": "client-key", "x-github-delivery": "gh-id" },
      rawBody,
    });

    expect(metadata.idempotencyKey).toBe("client-key");
  });

  it("uses the GitHub delivery id when there is no Idempotency-Key", () => {
    const metadata = extractEventMetadata({
      scheme: "github",
      headers: { "x-github-delivery": "gh-id" },
      rawBody,
    });

    expect(metadata.idempotencyKey).toBe("gh-id");
  });

  it("ignores the GitHub delivery id on a generic endpoint", () => {
    const metadata = extractEventMetadata({
      scheme: "generic_hmac",
      headers: { "x-github-delivery": "gh-id" },
      rawBody,
    });

    expect(metadata.idempotencyKey).toBe(bodyHash);
  });

  it("falls back to the SHA-256 of the raw body", () => {
    const metadata = extractEventMetadata({ scheme: "none", headers: {}, rawBody });

    expect(metadata.idempotencyKey).toBe(bodyHash);
  });

  it("gives different keys to bodies that differ by one byte", () => {
    const other = Buffer.from('{"action":"opened"} ');

    expect(
      extractEventMetadata({ scheme: "none", headers: {}, rawBody: other }).idempotencyKey,
    ).not.toBe(bodyHash);
  });

  it.each([
    ["blank", "   "],
    ["empty", ""],
    ["longer than 255 characters", "k".repeat(256)],
    ["repeated", ["a", "b"]],
  ])("falls through when the Idempotency-Key header is %s", (_name, header) => {
    const metadata = extractEventMetadata({
      scheme: "none",
      headers: { "idempotency-key": header },
      rawBody,
    });

    expect(metadata.idempotencyKey).toBe(bodyHash);
  });

  it("trims whitespace around the header", () => {
    const metadata = extractEventMetadata({
      scheme: "none",
      headers: { "idempotency-key": "  client-key " },
      rawBody,
    });

    expect(metadata.idempotencyKey).toBe("client-key");
  });
});

describe("extractEventMetadata event type", () => {
  it("reads X-Event-Type on generic and unsigned endpoints", () => {
    const headers = { "x-event-type": "invoice.paid" };

    expect(extractEventMetadata({ scheme: "generic_hmac", headers, rawBody }).eventType).toBe(
      "invoice.paid",
    );
    expect(extractEventMetadata({ scheme: "none", headers, rawBody }).eventType).toBe(
      "invoice.paid",
    );
  });

  it("reads X-GitHub-Event on a github endpoint and ignores X-Event-Type", () => {
    const metadata = extractEventMetadata({
      scheme: "github",
      headers: { "x-github-event": "push", "x-event-type": "other" },
      rawBody,
    });

    expect(metadata.eventType).toBe("push");
  });

  it("uses unknown when the header is missing or unusable", () => {
    expect(extractEventMetadata({ scheme: "generic_hmac", headers: {}, rawBody }).eventType).toBe(
      "unknown",
    );
    expect(
      extractEventMetadata({
        scheme: "generic_hmac",
        headers: { "x-event-type": "t".repeat(256) },
        rawBody,
      }).eventType,
    ).toBe("unknown");
  });
});

describe("extractEventMetadata stored headers", () => {
  it("keeps only the allowed headers", () => {
    const metadata = extractEventMetadata({
      scheme: "github",
      headers: {
        "content-type": "application/json",
        "user-agent": "GitHub-Hookshot/abc",
        "x-github-event": "push",
        authorization: "Bearer secret-token",
        cookie: "session=abc",
        "x-hub-signature-256": "sha256=abc",
        "x-api-key": "key",
      },
      rawBody,
    });

    expect(metadata.storedHeaders).toEqual({
      "content-type": "application/json",
      "user-agent": "GitHub-Hookshot/abc",
      "x-github-event": "push",
    });
  });

  it("returns an empty object when no allowed header is present", () => {
    const metadata = extractEventMetadata({
      scheme: "none",
      headers: { authorization: "Bearer secret-token" },
      rawBody,
    });

    expect(metadata.storedHeaders).toEqual({});
  });
});
