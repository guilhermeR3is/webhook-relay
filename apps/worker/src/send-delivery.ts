import type { Db } from "@relay/db";
import type { SendDelivery } from "./delivery-loop.js";
import { postWebhook } from "./post-webhook.js";

type SenderOptions = { timeoutMs: number; allowPrivateAddresses: boolean };

export function createSendDelivery(
  db: Db,
  { timeoutMs, allowPrivateAddresses }: SenderOptions,
): SendDelivery {
  return async (reserved) => {
    const { event, destination } = await db.delivery.findUniqueOrThrow({
      where: { id: reserved.id },
      select: {
        event: { select: { body: true, headers: true } },
        destination: { select: { url: true } },
      },
    });

    return postWebhook({
      url: destination.url,
      body: event.body,
      contentType: storedContentType(event.headers),
      timeoutMs,
      allowPrivateAddresses,
    });
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
