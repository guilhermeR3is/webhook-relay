import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { createGuardedLookup, literalAddressRefusal } from "./address-guard.js";
import type { DestinationReply } from "./retry-policy.js";

const SNIPPET_BYTES = 2048;
const USER_AGENT = "webhook-relay";

export type PostResult = {
  reply: DestinationReply;
  startedAt: Date;
  durationMs: number;
  httpStatus?: number;
  responseSnippet?: string;
};

type PostOptions = {
  url: string;
  body: Uint8Array;
  contentType: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  allowPrivateAddresses: boolean;
};

type Answer = { status: number; retryAfter: string | null; snippet: Buffer };

const guardedLookup = createGuardedLookup();

export async function postWebhook(options: PostOptions): Promise<PostResult> {
  const startedAt = new Date();
  const startedClock = performance.now();
  const durationMs = () => Math.round(performance.now() - startedClock);
  const timeout = AbortSignal.timeout(options.timeoutMs);

  try {
    const answer = await sendRequest(options, timeout);
    return {
      reply: { kind: "response", status: answer.status, retryAfter: answer.retryAfter },
      startedAt,
      durationMs: durationMs(),
      httpStatus: answer.status,
      responseSnippet: toSnippet(answer.snippet),
    };
  } catch (error) {
    const reason = timeout.aborted
      ? `timed out after ${String(options.timeoutMs)} ms`
      : describeFailure(error);
    return {
      reply: { kind: "no-response", error: reason },
      startedAt,
      durationMs: durationMs(),
    };
  }
}

function sendRequest(
  { url, body, contentType, headers, allowPrivateAddresses }: PostOptions,
  timeout: AbortSignal,
) {
  return new Promise<Answer>((resolve, reject) => {
    const destination = parseDestination(url, allowPrivateAddresses);
    const transport = destination.protocol === "https:" ? https : http;
    const request = transport.request(
      destination,
      {
        method: "POST",
        headers: { "user-agent": USER_AGENT, ...headers, "content-type": contentType },
        // sem reaproveitar conexão: cada envio valida o IP de novo no connect
        agent: false,
        lookup: allowPrivateAddresses ? undefined : guardedLookup,
        signal: timeout,
      },
      (response) => {
        readSnippet(response).then((snippet) => {
          resolve({
            status: response.statusCode ?? 0,
            retryAfter: response.headers["retry-after"] ?? null,
            snippet,
          });
        }, reject);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function parseDestination(url: string, allowPrivateAddresses: boolean) {
  let destination: URL;
  try {
    destination = new URL(url);
  } catch {
    throw new Error("invalid destination url");
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    throw new Error(`unsupported protocol ${destination.protocol}`);
  }
  const refusal = allowPrivateAddresses ? undefined : literalAddressRefusal(destination.hostname);
  if (refusal !== undefined) {
    throw new Error(refusal);
  }
  return destination;
}

async function readSnippet(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response as AsyncIterable<Buffer>) {
      chunks.push(chunk.subarray(0, SNIPPET_BYTES - size));
      size += chunk.length;
      if (size >= SNIPPET_BYTES) {
        break;
      }
    }
  } catch {
    // o status já chegou; um corte no corpo da resposta não muda o que o destino respondeu
  }
  return Buffer.concat(chunks);
}

// o Postgres recusa o caractere NUL em colunas de texto
function toSnippet(bytes: Buffer) {
  const text = new TextDecoder().decode(bytes).replaceAll("\u0000", "");
  return text === "" ? undefined : text;
}

// com mais de um endereço o Node junta as falhas num AggregateError de mensagem vazia
function describeFailure(error: unknown) {
  if (error instanceof AggregateError) {
    const reasons = error.errors.map((cause) =>
      cause instanceof Error ? cause.message : String(cause),
    );
    return reasons.join("; ") || error.name;
  }
  return error instanceof Error ? error.message || error.name : String(error);
}
