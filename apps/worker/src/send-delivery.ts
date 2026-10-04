import { decryptSecret, type Db } from "@relay/db";
import type { SendDelivery } from "./delivery-loop.js";
import { postWebhook } from "./post-webhook.js";
import { signWebhook } from "./sign-webhook.js";

type SenderOptions = { timeoutMs: number; allowPrivateAddresses: boolean; encryptionKey: Buffer };

export function createSendDelivery(
  db: Db,
  { timeoutMs, allowPrivateAddresses, encryptionKey }: SenderOptions,
): SendDelivery {
  return async (reserved) => {
    const { event, destination } = await db.delivery.findUniqueOrThrow({
      where: { id: reserved.id },
      select: {
        event: { select: { body: true, headers: true } },
        destination: { select: { url: true, secretEncrypted: true } },
      },
    });

    // assinada a cada envio, porque o timestamp faz parte do texto assinado
    const signatureHeaders = signWebhook({
      id: reserved.id,
      now: new Date(),
      body: event.body,
      secret: decryptSecret(destination.secretEncrypted, encryptionKey),
    });

    return postWebhook({
      url: destination.url,
      body: event.body,
      contentType: storedContentType(event.headers),
      headers: signatureHeaders,
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
