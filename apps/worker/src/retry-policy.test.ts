import { describe, expect, it } from "vitest";
import {
  decideDelivery,
  MAX_ATTEMPTS,
  type DeliveryDecision,
  type DestinationReply,
} from "./retry-policy.js";

const halfway = () => 0.5;
const now = new Date("2026-10-03T12:00:00Z");

function respond(status: number, retryAfter: string | null = null): DestinationReply {
  return { kind: "response", status, retryAfter };
}

function decide(reply: DestinationReply, attempt = 1): DeliveryDecision {
  return decideDelivery({ reply, attempt, random: halfway, now });
}

describe("decideDelivery", () => {
  it.each([200, 201, 204])("%i succeeds and shows the destination is alive", (status) => {
    expect(decide(respond(status))).toEqual({ action: "succeed", circuitSignal: "alive" });
  });

  it.each([500, 502, 503, 504])("%i retries and counts against the circuit", (status) => {
    expect(decide(respond(status))).toEqual({
      action: "retry",
      reason: `destination answered ${String(status)}`,
      delaySeconds: 5,
      circuitSignal: "failure",
    });
  });

  it("408 retries and counts against the circuit", () => {
    expect(decide(respond(408))).toEqual({
      action: "retry",
      reason: "destination answered 408",
      delaySeconds: 5,
      circuitSignal: "failure",
    });
  });

  it.each([301, 302, 307, 308])(
    "%i goes straight to dead without following the redirect",
    (status) => {
      expect(decide(respond(status))).toEqual({
        action: "dead",
        reason: `destination answered ${String(status)}, redirects are not followed`,
        deactivateDestination: false,
        circuitSignal: "alive",
      });
    },
  );

  it.each([400, 401, 403, 404, 422])("%i goes straight to dead without retrying", (status) => {
    expect(decide(respond(status))).toEqual({
      action: "dead",
      reason: `destination answered ${String(status)}`,
      deactivateDestination: false,
      circuitSignal: "alive",
    });
  });

  it("410 goes to dead and asks to deactivate the destination", () => {
    expect(decide(respond(410))).toEqual({
      action: "dead",
      reason: "destination answered 410, destination deactivated",
      deactivateDestination: true,
      circuitSignal: "alive",
    });
  });

  it.each(["timed out after 10000 ms", "fetch failed: connect ECONNREFUSED 127.0.0.1:9"])(
    "no response (%s) retries and counts against the circuit",
    (error) => {
      expect(decide({ kind: "no-response", error })).toEqual({
        action: "retry",
        reason: error,
        delaySeconds: 5,
        circuitSignal: "failure",
      });
    },
  );

  it("an unexpected status such as 100 is retried as a failure", () => {
    expect(decide(respond(100))).toMatchObject({ action: "retry", circuitSignal: "failure" });
  });

  describe("429 and Retry-After", () => {
    it("without the header, falls back to the backoff", () => {
      expect(decide(respond(429))).toEqual({
        action: "retry",
        reason: "destination answered 429",
        delaySeconds: 5,
        circuitSignal: "alive",
      });
    });

    it("uses the number of seconds the destination asked for", () => {
      expect(decide(respond(429, "30"))).toMatchObject({ action: "retry", delaySeconds: 30 });
    });

    it("converts an HTTP date into the wait from now", () => {
      expect(decide(respond(429, "Sat, 03 Oct 2026 12:01:00 GMT"))).toMatchObject({
        delaySeconds: 60,
      });
    });

    it("waits zero seconds when the date has already passed", () => {
      expect(decide(respond(429, "Sat, 03 Oct 2026 11:00:00 GMT"))).toMatchObject({
        delaySeconds: 0,
      });
    });

    it("never waits more than one hour, even if the destination asks for a day", () => {
      expect(decide(respond(429, "86400"))).toMatchObject({ delaySeconds: 3600 });
      expect(decide(respond(429, "Sun, 04 Oct 2026 12:00:00 GMT"))).toMatchObject({
        delaySeconds: 3600,
      });
    });

    it.each([
      "soon",
      "-5",
      "1.5",
      "",
      "Sat, 03 Oct 2026 12:01:00",
      "Foo, 99 Bar 2026 99:99:99 GMT",
    ])("ignores the invalid value %j and falls back to the backoff", (header) => {
      expect(decide(respond(429, header))).toMatchObject({ action: "retry", delaySeconds: 5 });
    });
  });

  describe("attempt limit", () => {
    it("retries on the last attempt before the limit", () => {
      expect(decide(respond(503), MAX_ATTEMPTS - 1)).toMatchObject({ action: "retry" });
    });

    it.each([
      ["a 5xx", respond(503), "destination answered 503, gave up after 8 attempts", "failure"],
      ["a 429", respond(429, "30"), "destination answered 429, gave up after 8 attempts", "alive"],
      [
        "no response",
        { kind: "no-response", error: "timed out after 10000 ms" } as const,
        "timed out after 10000 ms, gave up after 8 attempts",
        "failure",
      ],
    ])("gives up on attempt 8 after %s", (_label, reply, reason, circuitSignal) => {
      expect(decide(reply, MAX_ATTEMPTS)).toEqual({
        action: "dead",
        reason,
        deactivateDestination: false,
        circuitSignal,
      });
    });

    it("still succeeds on the last attempt", () => {
      expect(decide(respond(200), MAX_ATTEMPTS)).toEqual({
        action: "succeed",
        circuitSignal: "alive",
      });
    });
  });

  it("uses the real clock and Math.random when they are not injected", () => {
    const decision = decideDelivery({ reply: respond(503), attempt: 1 });
    expect(decision).toMatchObject({ action: "retry" });
    if (decision.action === "retry") {
      expect(decision.delaySeconds).toBeGreaterThanOrEqual(0);
      expect(decision.delaySeconds).toBeLessThan(10);
    }
  });
});
