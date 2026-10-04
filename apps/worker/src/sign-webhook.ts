import { createHmac } from "node:crypto";

const SECRET_PREFIX = "whsec_";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type WebhookHeaders = {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
};

type SignInput = { id: string; now: Date; body: Uint8Array; secret: string };

export function signWebhook({ id, now, body, secret }: SignInput): WebhookHeaders {
  // o ponto separa as partes do texto assinado; um id com ponto permitiria forjar outra combinação
  if (id === "" || id.includes(".")) {
    throw new Error("webhook id must be non-empty and contain no dots");
  }
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = createHmac("sha256", decodeSecret(secret))
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest("base64");

  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
}

// a mensagem de erro nunca cita o segredo, porque ela vai para o log e para o lastError
function decodeSecret(secret: string) {
  if (!secret.startsWith(SECRET_PREFIX)) {
    throw new Error(`destination secret must start with ${SECRET_PREFIX}`);
  }
  const encoded = secret.slice(SECRET_PREFIX.length);
  if (!BASE64.test(encoded)) {
    throw new Error("destination secret is not valid base64 after the prefix");
  }
  return Buffer.from(encoded, "base64");
}
