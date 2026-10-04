import type { Db } from "./client.js";

type ExpiredDemoDataOptions = { endpointSlug: string; olderThan: Date };

export async function deleteExpiredDemoData(
  db: Db,
  { endpointSlug, olderThan }: ExpiredDemoDataOptions,
) {
  // entrega não terminada ainda vai ser tentada: apagar o evento a perderia, ou tiraria a linha em que o worker grava o resultado
  const events = await db.event.deleteMany({
    where: {
      endpoint: { slug: endpointSlug },
      receivedAt: { lt: olderThan },
      deliveries: { none: { status: { in: ["pending", "in_progress"] } } },
    },
  });
  const quotaWindows = await db.demoQuota.deleteMany({ where: { windowStart: { lt: olderThan } } });

  return { events: events.count, quotaWindows: quotaWindows.count };
}
