import { createServer, type ServerResponse } from "node:http";

export type ReceiverStats = { received: number; distinct: number; duplicates: number };

type ReceiverOptions = { delayMs: number };

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createReceiver({ delayMs }: ReceiverOptions) {
  const seenIds = new Set<string>();
  let received = 0;

  function stats(): ReceiverStats {
    return { received, distinct: seenIds.size, duplicates: received - seenIds.size };
  }

  return createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://receiver");

    if (request.method === "GET" && pathname === "/stats") {
      sendJson(response, 200, stats());
    } else if (request.method === "POST" && pathname === "/reset") {
      seenIds.clear();
      received = 0;
      sendJson(response, 200, stats());
    } else if (request.method === "POST" && pathname === "/hook") {
      const webhookId = request.headers["webhook-id"];
      request.resume();
      request.on("end", () => {
        if (typeof webhookId !== "string" || webhookId === "") {
          sendJson(response, 400, { error: "missing_webhook_id" });
          return;
        }
        // conta ao receber, antes de responder: uma resposta perdida no caos também é uma recepção
        seenIds.add(webhookId);
        received += 1;
        setTimeout(() => {
          sendJson(response, 200, { ok: true });
        }, delayMs);
      });
    } else {
      sendJson(response, 404, { error: "not_found" });
    }
  });
}
