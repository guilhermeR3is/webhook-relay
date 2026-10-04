import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { postWebhook } from "./post-webhook.js";

type Received = { method: string | undefined; headers: IncomingHttpHeaders; body: Buffer };
type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: ReturnType<typeof createServer>[] = [];

async function startServer(handler: Handler = (_request, response) => response.end("ok")) {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    response.on("error", () => undefined);
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      handler(request, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { port, url: `http://127.0.0.1:${String(port)}/hook`, received };
}

async function findClosedPort() {
  const { port } = await startServer();
  const [server] = servers.splice(-1);
  await new Promise((resolve) => server?.close(resolve));
  return port;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});

const body = Buffer.from('{"action":"opened"}');
const allowed = {
  body,
  contentType: "application/json",
  timeoutMs: 2000,
  allowPrivateAddresses: true,
};
const strict = { ...allowed, allowPrivateAddresses: false };

describe("postWebhook", () => {
  it("sends the exact bytes with the given content type and a length, not chunked", async () => {
    const binaryBody = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
    const { url, received } = await startServer();

    const result = await postWebhook({ ...allowed, url, body: binaryBody });

    expect(received).toHaveLength(1);
    expect(received[0]?.method).toBe("POST");
    expect(received[0]?.body.equals(binaryBody)).toBe(true);
    expect(received[0]?.headers["content-type"]).toBe("application/json");
    expect(received[0]?.headers["content-length"]).toBe("7");
    expect(received[0]?.headers["transfer-encoding"]).toBeUndefined();
    expect(result).toMatchObject({
      reply: { kind: "response", status: 200, retryAfter: null },
      httpStatus: 200,
      responseSnippet: "ok",
    });
  });

  it("sends the extra headers it was given and identifies itself", async () => {
    const { url, received } = await startServer();

    await postWebhook({ ...allowed, url, headers: { "webhook-id": "abc", "x-extra": "1" } });

    expect(received[0]?.headers).toMatchObject({
      "webhook-id": "abc",
      "x-extra": "1",
      "user-agent": "webhook-relay",
    });
  });

  it("lets the extra headers replace the user agent but never the content type", async () => {
    const { url, received } = await startServer();

    await postWebhook({
      ...allowed,
      url,
      headers: { "user-agent": "custom", "content-type": "text/plain" },
    });

    expect(received[0]?.headers["user-agent"]).toBe("custom");
    expect(received[0]?.headers["content-type"]).toBe("application/json");
  });

  it("sends no extra headers when none are given", async () => {
    const { url, received } = await startServer();

    await postWebhook({ ...allowed, url });

    expect(
      Object.keys(received[0]?.headers ?? {}).filter((name) => name.startsWith("webhook-")),
    ).toEqual([]);
  });

  it("measures when the send started and how long it took", async () => {
    const before = Date.now();
    const { url } = await startServer((_request, response) => {
      setTimeout(() => response.end("late"), 60);
    });

    const result = await postWebhook({ ...allowed, url });

    expect(result.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(Number.isInteger(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(55);
  });

  it("reports the status and a snippet of an error answer", async () => {
    const { url } = await startServer((_request, response) => {
      response.writeHead(503).end("upstream is down");
    });

    const result = await postWebhook({ ...allowed, url });

    expect(result).toMatchObject({
      reply: { kind: "response", status: 503 },
      httpStatus: 503,
      responseSnippet: "upstream is down",
    });
  });

  it("passes Retry-After through exactly as the destination sent it", async () => {
    const { url } = await startServer((_request, response) => {
      response.writeHead(429, { "retry-after": "30" }).end();
    });

    const result = await postWebhook({ ...allowed, url });

    expect(result.reply).toEqual({ kind: "response", status: 429, retryAfter: "30" });
  });

  it("keeps only the first 2 KB of a large answer and does not wait for the rest", async () => {
    const { url } = await startServer((_request, response) => {
      response.end("x".repeat(5_000_000));
    });

    const result = await postWebhook({ ...allowed, url });

    expect(result.responseSnippet).toBe("x".repeat(2048));
    expect(result.durationMs).toBeLessThan(1500);
  });

  it("replaces invalid UTF-8 instead of failing", async () => {
    const { url } = await startServer((_request, response) => {
      response.end(Buffer.from([0xff, 0xfe, 0x61]));
    });

    const result = await postWebhook({ ...allowed, url });

    expect(result.responseSnippet).toBe("��a");
  });

  it("removes the NUL character, which the database refuses in text", async () => {
    const { url } = await startServer((_request, response) => {
      response.end(Buffer.from("a\u0000b"));
    });

    const result = await postWebhook({ ...allowed, url });

    expect(result.responseSnippet).toBe("ab");
  });

  it("has no snippet when the answer has no body", async () => {
    const { url } = await startServer((_request, response) => {
      response.writeHead(204).end();
    });

    const result = await postWebhook({ ...allowed, url });

    expect(result.reply).toMatchObject({ kind: "response", status: 204 });
    expect(result.responseSnippet).toBeUndefined();
  });

  it("does not follow a redirect", async () => {
    const target = await startServer();
    const { url } = await startServer((_request, response) => {
      response.writeHead(302, { location: target.url }).end();
    });

    const result = await postWebhook({ ...allowed, url });

    expect(result.reply).toMatchObject({ kind: "response", status: 302 });
    expect(target.received).toEqual([]);
  });

  it("gives up with a timeout message when the destination never answers", async () => {
    const { url } = await startServer(() => undefined);

    const result = await postWebhook({ ...allowed, url, timeoutMs: 150 });

    expect(result.reply).toEqual({ kind: "no-response", error: "timed out after 150 ms" });
    expect(result.httpStatus).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(140);
  });

  it("reports why the connection was refused", async () => {
    const port = await findClosedPort();

    const result = await postWebhook({ ...allowed, url: `http://127.0.0.1:${String(port)}/hook` });

    expect(result.reply).toMatchObject({
      kind: "no-response",
      error: expect.stringContaining("ECONNREFUSED") as unknown,
    });
  });

  it("reports the real reasons when localhost has several addresses, not an empty message", async () => {
    const port = await findClosedPort();

    const result = await postWebhook({ ...allowed, url: `http://localhost:${String(port)}/hook` });

    expect(result.reply.kind).toBe("no-response");
    if (result.reply.kind === "no-response") {
      expect(result.reply.error).toMatch(/ECONNREFUSED|EADDRNOTAVAIL/);
    }
  });

  it("uses TLS for an https address", async () => {
    const { port } = await startServer();

    const result = await postWebhook({ ...allowed, url: `https://127.0.0.1:${String(port)}/hook` });

    expect(result.reply).toMatchObject({
      kind: "no-response",
      error: expect.stringMatching(/wrong version number|EPROTO|ssl|tls/i) as unknown,
    });
  });

  it.each([
    ["not a url", "invalid destination url"],
    ["", "invalid destination url"],
    ["ftp://example.com/hook", "unsupported protocol ftp:"],
    ["file:///etc/passwd", "unsupported protocol file:"],
  ])("refuses %j before touching the network", async (url, error) => {
    const result = await postWebhook({ ...allowed, url });

    expect(result.reply).toEqual({ kind: "no-response", error });
  });
});

describe("postWebhook with private destinations refused", () => {
  it.each([
    ["a loopback address", (port: number) => `http://127.0.0.1:${String(port)}/hook`],
    ["the IPv6 loopback", (port: number) => `http://[::1]:${String(port)}/hook`],
    [
      "a loopback hidden as a decimal number",
      (port: number) => `http://2130706433:${String(port)}/hook`,
    ],
    ["a loopback hidden as a short address", (port: number) => `http://127.1:${String(port)}/hook`],
    [
      "an IPv4-mapped IPv6 loopback",
      (port: number) => `http://[::ffff:7f00:1]:${String(port)}/hook`,
    ],
  ])("never connects to %s", async (_label, urlFor) => {
    const { port, received } = await startServer();

    const result = await postWebhook({ ...strict, url: urlFor(port) });

    expect(result.reply).toMatchObject({
      kind: "no-response",
      error: expect.stringMatching(/^refused: .* is not a public address$/) as unknown,
    });
    expect(received).toEqual([]);
  });

  it("refuses a name that resolves to loopback at connection time", async () => {
    const { port, received } = await startServer();

    const result = await postWebhook({ ...strict, url: `http://localhost:${String(port)}/hook` });

    expect(result.reply).toMatchObject({
      kind: "no-response",
      error: expect.stringMatching(/^refused: localhost resolves to (127\.0\.0\.1|::1)/) as unknown,
    });
    expect(received).toEqual([]);
  });

  it("refuses the cloud metadata address without waiting for a connection", async () => {
    const result = await postWebhook({
      ...strict,
      url: "http://169.254.169.254/latest/meta-data/",
      timeoutMs: 5000,
    });

    expect(result.reply).toEqual({
      kind: "no-response",
      error: "refused: 169.254.169.254 is not a public address",
    });
    expect(result.durationMs).toBeLessThan(500);
  });

  it("reaches the same server once private destinations are allowed", async () => {
    const { url, received } = await startServer();

    const result = await postWebhook({ ...allowed, url });

    expect(result.reply).toMatchObject({ kind: "response", status: 200 });
    expect(received).toHaveLength(1);
  });
});
