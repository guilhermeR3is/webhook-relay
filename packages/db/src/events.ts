import type { Db } from "./client.js";

export type NewEvent = {
  endpointId: string;
  idempotencyKey: string;
  eventType: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array<ArrayBuffer>;
};

export type SavedEvent = { id: string; created: boolean };

// skipDuplicates vira INSERT ... ON CONFLICT DO NOTHING; o id uuid v7 é gerado pelo Prisma, não pelo banco
export async function saveEvent(db: Db, event: NewEvent): Promise<SavedEvent> {
  const { count } = await db.event.createMany({ data: [event], skipDuplicates: true });
  const stored = await db.event.findUniqueOrThrow({
    where: {
      endpointId_idempotencyKey: {
        endpointId: event.endpointId,
        idempotencyKey: event.idempotencyKey,
      },
    },
    select: { id: true },
  });
  return { id: stored.id, created: count === 1 };
}
