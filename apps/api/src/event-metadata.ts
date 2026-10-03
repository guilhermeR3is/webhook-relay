import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { SignatureScheme } from "@relay/db";

const MAX_HEADER_LENGTH = 255;

// lista de permitidos: um header sensível que não conhecemos nunca chega ao banco nem ao painel
const STORED_HEADERS = [
  "content-type",
  "user-agent",
  "idempotency-key",
  "x-event-type",
  "x-github-event",
  "x-github-delivery",
];

const EVENT_TYPE_HEADERS: Record<SignatureScheme, string> = {
  none: "x-event-type",
  generic_hmac: "x-event-type",
  github: "x-github-event",
};

const PROVIDER_EVENT_ID_HEADERS: Partial<Record<SignatureScheme, string>> = {
  github: "x-github-delivery",
};

export type EventMetadata = {
  idempotencyKey: string;
  eventType: string;
  storedHeaders: Record<string, string | string[]>;
};

type ExtractInput = {
  scheme: SignatureScheme;
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
};

function readHeader(headers: IncomingHttpHeaders, name: string) {
  const headerValue = headers[name];
  if (typeof headerValue !== "string") {
    return undefined;
  }
  const trimmed = headerValue.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_HEADER_LENGTH ? trimmed : undefined;
}

export function extractEventMetadata({ scheme, headers, rawBody }: ExtractInput): EventMetadata {
  const providerEventIdHeader = PROVIDER_EVENT_ID_HEADERS[scheme];
  const idempotencyKey =
    readHeader(headers, "idempotency-key") ??
    (providerEventIdHeader === undefined
      ? undefined
      : readHeader(headers, providerEventIdHeader)) ??
    createHash("sha256").update(rawBody).digest("hex");

  const storedHeaders: EventMetadata["storedHeaders"] = {};
  for (const name of STORED_HEADERS) {
    const storedValue = headers[name];
    if (storedValue !== undefined) {
      storedHeaders[name] = storedValue;
    }
  }

  return {
    idempotencyKey,
    eventType: readHeader(headers, EVENT_TYPE_HEADERS[scheme]) ?? "unknown",
    storedHeaders,
  };
}
