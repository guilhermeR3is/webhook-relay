import { setTimeout as sleepFor } from "node:timers/promises";
import type { FastifyPluginCallback } from "fastify";

export const FLAKY_FAIL_RATE = 0.4;
export const FLAKY_SLOW_RATE = 0.1;
export const FLAKY_SLOW_MS = 15_000;
export const FLAKY_SLOW_LIMIT = 5;
const RATE_LIMITED_SHARE = 0.3;
const RETRY_AFTER_SECONDS = 5;

type FlakyOptions = {
  random?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<unknown>;
  slowLimit?: number;
};

const sleepWithSignal = (milliseconds: number, signal: AbortSignal) =>
  sleepFor(milliseconds, undefined, { signal });

export const flakyRoutes: FastifyPluginCallback<FlakyOptions> = (
  app,
  { random = Math.random, sleep = sleepWithSignal, slowLimit = FLAKY_SLOW_LIMIT },
  done,
) => {
  // quem aponta para este destino pode mandar qualquer corpo, e um JSON inválido não pode virar 400
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, parserDone) => {
    parserDone(null, body);
  });

  let slowInFlight = 0;

  app.post("/demo/flaky", async (_request, reply) => {
    const roll = random();

    if (roll < FLAKY_FAIL_RATE) {
      if (random() < RATE_LIMITED_SHARE) {
        return reply
          .code(429)
          .header("retry-after", String(RETRY_AFTER_SECONDS))
          .send({ error: "demo_flaky_rate_limited" });
      }
      return reply.code(503).send({ error: "demo_flaky_unavailable" });
    }

    // a rota é pública: sem teto, qualquer um prenderia o serviço gratuito com respostas de 15 s
    if (roll < FLAKY_FAIL_RATE + FLAKY_SLOW_RATE && slowInFlight < slowLimit) {
      slowInFlight += 1;
      const clientLeft = new AbortController();
      reply.raw.once("close", () => {
        if (!reply.raw.writableEnded) clientLeft.abort();
      });
      try {
        await sleep(FLAKY_SLOW_MS, clientLeft.signal);
      } catch (error) {
        if (!clientLeft.signal.aborted) throw error;
      } finally {
        slowInFlight -= 1;
      }
    }

    return reply.send({ received: true });
  });

  done();
};
