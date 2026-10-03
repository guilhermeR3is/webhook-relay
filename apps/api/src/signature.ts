import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { SignatureScheme } from "@relay/db";

export type SignatureCheck =
  { ok: true } | { ok: false; reason: "missing" | "malformed" | "mismatch" };

const SIGNATURE_HEADERS = {
  generic_hmac: "x-signature-256",
  github: "x-hub-signature-256",
} as const;

const SIGNATURE_FORMAT = /^sha256=([0-9a-f]{64})$/i;

type VerifyInput = {
  scheme: SignatureScheme;
  secret: string | null;
  rawBody: Buffer;
  headers: IncomingHttpHeaders;
};

export function verifySignature({ scheme, secret, rawBody, headers }: VerifyInput): SignatureCheck {
  if (scheme === "none") {
    return { ok: true };
  }
  if (secret === null) {
    throw new Error(`Endpoint with scheme "${scheme}" has no secret configured`);
  }

  const received = headers[SIGNATURE_HEADERS[scheme]];
  if (received === undefined) {
    return { ok: false, reason: "missing" };
  }
  // Header repetido chega como array; aceitar uma das cópias deixaria o atacante escolher qual é conferida
  const receivedHex =
    typeof received === "string" ? SIGNATURE_FORMAT.exec(received)?.[1] : undefined;
  if (receivedHex === undefined) {
    return { ok: false, reason: "malformed" };
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  // timingSafeEqual lança se os tamanhos diferem; o regex já garante 32 bytes
  return timingSafeEqual(expected, Buffer.from(receivedHex, "hex"))
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}
