import { MAX_DELAY_SECONDS, nextDelay } from "./backoff.js";

export const MAX_ATTEMPTS = 8;

export type CircuitSignal = "failure" | "alive";

export type DestinationReply =
  | { kind: "response"; status: number; retryAfter: string | null }
  | { kind: "no-response"; error: string };

export type DeliveryDecision =
  | { action: "succeed"; circuitSignal: CircuitSignal }
  | { action: "retry"; reason: string; delaySeconds: number; circuitSignal: CircuitSignal }
  | {
      action: "dead";
      reason: string;
      deactivateDestination: boolean;
      circuitSignal: CircuitSignal;
    };

type DecideOptions = {
  reply: DestinationReply;
  attempt: number;
  random?: () => number;
  now?: Date;
};

const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

export function decideDelivery({
  reply,
  attempt,
  random,
  now = new Date(),
}: DecideOptions): DeliveryDecision {
  if (reply.kind === "no-response") {
    return retryOrGiveUp(reply.error, nextDelay(attempt, random), "failure", attempt);
  }

  const { status } = reply;
  const reason = `destination answered ${String(status)}`;

  if (status >= 200 && status < 300) {
    return { action: "succeed", circuitSignal: "alive" };
  }
  if (status === 410) {
    return {
      action: "dead",
      reason: `${reason}, destination deactivated`,
      deactivateDestination: true,
      circuitSignal: "alive",
    };
  }
  if (status === 429) {
    const delaySeconds = parseRetryAfter(reply.retryAfter, now) ?? nextDelay(attempt, random);
    return retryOrGiveUp(reason, delaySeconds, "alive", attempt);
  }
  if (status === 408 || status >= 500) {
    return retryOrGiveUp(reason, nextDelay(attempt, random), "failure", attempt);
  }
  if (status >= 300 && status < 400) {
    return {
      action: "dead",
      reason: `${reason}, redirects are not followed`,
      deactivateDestination: false,
      circuitSignal: "alive",
    };
  }
  if (status >= 400 && status < 500) {
    // repetir o mesmo corpo para o mesmo destino daria a mesma resposta
    return { action: "dead", reason, deactivateDestination: false, circuitSignal: "alive" };
  }
  return retryOrGiveUp(reason, nextDelay(attempt, random), "failure", attempt);
}

function retryOrGiveUp(
  reason: string,
  delaySeconds: number,
  circuitSignal: CircuitSignal,
  attempt: number,
): DeliveryDecision {
  if (attempt >= MAX_ATTEMPTS) {
    return {
      action: "dead",
      reason: `${reason}, gave up after ${String(MAX_ATTEMPTS)} attempts`,
      deactivateDestination: false,
      circuitSignal,
    };
  }
  return { action: "retry", reason, delaySeconds, circuitSignal };
}

// Date.parse sozinho aceitaria "-5" como data e leria uma data sem GMT no fuso local
function parseRetryAfter(header: string | null, now: Date) {
  if (header === null) {
    return undefined;
  }
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    return Math.min(Number(value), MAX_DELAY_SECONDS);
  }
  if (!HTTP_DATE.test(value)) {
    return undefined;
  }
  const waitMs = Date.parse(value) - now.getTime();
  if (Number.isNaN(waitMs)) {
    return undefined;
  }
  return Math.min(Math.max(waitMs / 1000, 0), MAX_DELAY_SECONDS);
}
