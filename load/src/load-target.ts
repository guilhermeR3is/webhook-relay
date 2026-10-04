import { randomBytes } from "node:crypto";
import { encryptSecret, type Db } from "@relay/db";

export const LOAD_ENDPOINT_SLUG = "load";

type LoadTargetOptions = { encryptionKey: Buffer; destinationUrl: string };

export async function createLoadTarget(
  db: Db,
  { encryptionKey, destinationUrl }: LoadTargetOptions,
) {
  const endpoint = await db.endpoint.upsert({
    where: { slug: LOAD_ENDPOINT_SLUG },
    update: {},
    create: { slug: LOAD_ENDPOINT_SLUG, name: "Load test", signatureScheme: "none" },
  });

  // reativa e fecha o circuito para cada rodada começar do mesmo estado
  const resetState = {
    url: destinationUrl,
    isActive: true,
    circuitState: "closed",
    consecutiveFailures: 0,
    circuitOpenedAt: null,
  } as const;
  const existing = await db.destination.findFirst({ where: { endpointId: endpoint.id } });
  const destination =
    existing === null
      ? await db.destination.create({
          data: {
            ...resetState,
            endpointId: endpoint.id,
            secretEncrypted: encryptSecret(
              `whsec_${randomBytes(32).toString("base64")}`,
              encryptionKey,
            ),
            eventTypes: ["*"],
          },
        })
      : await db.destination.update({ where: { id: existing.id }, data: resetState });

  return { endpointId: endpoint.id, destinationId: destination.id };
}

export async function removeLoadTarget(db: Db) {
  const where = { endpoint: { slug: LOAD_ENDPOINT_SLUG } };
  const [events] = await db.$transaction([
    db.event.deleteMany({ where }),
    db.destination.deleteMany({ where }),
    db.endpoint.deleteMany({ where: { slug: LOAD_ENDPOINT_SLUG } }),
  ]);
  return { events: events.count };
}
