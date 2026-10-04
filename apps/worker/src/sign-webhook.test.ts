import { describe, expect, it } from "vitest";
import { signWebhook } from "./sign-webhook.js";

// vetores calculados à parte com hmac do Python, não com este código
// montado em tempo de execução: o literal whsec_ + base64 dispara o alerta de segredo do GitHub
const secret = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
const id = "0199aaaa-0000-7000-8000-000000000001";
const now = new Date("2026-10-03T12:00:00Z");
const textBody = new TextEncoder().encode('{"action":"opened"}');
const binaryBody = Uint8Array.from([0xff, 0xfe, 0x00, 0x80, 0x7b, 0x7d]);

describe("signWebhook", () => {
  it("signs id, timestamp and body the Standard Webhooks way", () => {
    expect(signWebhook({ id, now, body: textBody, secret })).toEqual({
      "webhook-id": id,
      "webhook-timestamp": "1791028800",
      "webhook-signature": "v1,eVVaChggULvWLWpp6yCM843wmWhbPIX5ZfNHp1z9Ipk=",
    });
  });

  it("signs the exact bytes, even when they are not valid text", () => {
    const headers = signWebhook({ id, now, body: binaryBody, secret });
    expect(headers["webhook-signature"]).toBe("v1,dO675OFqpkXjHS29S5QD8kbOXABz95ZMHECUzCXo37c=");
  });

  it("sends the timestamp in whole seconds, rounded down", () => {
    const headers = signWebhook({
      id,
      now: new Date("2026-10-03T12:00:00.999Z"),
      body: textBody,
      secret,
    });
    expect(headers["webhook-timestamp"]).toBe("1791028800");
  });

  it("changes the signature when the body, the id or the second changes", () => {
    const base = signWebhook({ id, now, body: textBody, secret })["webhook-signature"];
    const otherBody = signWebhook({ id, now, body: binaryBody, secret })["webhook-signature"];
    const otherId = signWebhook({ id: `${id}0`, now, body: textBody, secret })["webhook-signature"];
    const nextSecond = signWebhook({
      id,
      now: new Date("2026-10-03T12:00:01Z"),
      body: textBody,
      secret,
    })["webhook-signature"];

    expect(new Set([base, otherBody, otherId, nextSecond]).size).toBe(4);
  });

  it("signs an empty body", () => {
    const headers = signWebhook({ id, now, body: new Uint8Array(), secret });
    expect(headers["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/]{43}=$/);
  });

  it.each(["", "abc.def", `${id}.`])("refuses the id %j", (badId) => {
    expect(() => signWebhook({ id: badId, now, body: textBody, secret })).toThrow(/webhook id/);
  });

  it.each([
    ["no prefix", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="],
    ["empty after the prefix", "whsec_"],
    ["not base64", "whsec_not base64!"],
    ["base64url alphabet", "whsec_MDEy-_"],
  ])("refuses a secret with %s without echoing it", (_label, badSecret) => {
    const refusal = () => signWebhook({ id, now, body: textBody, secret: badSecret });

    expect(refusal).toThrow(/destination secret/);
    expect(refusal).not.toThrow(badSecret);
  });
});
