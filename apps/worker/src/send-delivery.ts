import type { Db } from "@relay/db";
import type { SendDelivery } from "./delivery-loop.js";

type SenderOptions = { timeoutMs: number };

export function createSendDelivery(db: Db, { timeoutMs }: SenderOptions): SendDelivery {
  return async (reserved) => {
    const { event, destination } = await db.delivery.findUniqueOrThrow({
      where: { id: reserved.id },
      select: {
        event: { select: { body: true, headers: true } },
        destination: { select: { url: true } },
      },
    });

    try {
      const response = await fetch(destination.url, {
        method: "POST",
        headers: { "content-type": storedContentType(event.headers) },
        body: event.body,
        // seguir o redirecionamento deixaria o destino apontar o envio para outro host
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel();

      return response.ok
        ? { ok: true }
        : { ok: false, error: `destination answered ${String(response.status)}` };
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return { ok: false, error: `timed out after ${String(timeoutMs)} ms` };
      }
      return { ok: false, error: describeNetworkError(error) };
    }
  };
}

function storedContentType(headers: unknown) {
  if (typeof headers === "object" && headers !== null && "content-type" in headers) {
    const contentType = headers["content-type"];
    if (typeof contentType === "string") {
      return contentType;
    }
  }
  return "application/octet-stream";
}

// o erro do fetch é só "fetch failed"; o motivo real (ECONNREFUSED, DNS) está na causa
function describeNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}
