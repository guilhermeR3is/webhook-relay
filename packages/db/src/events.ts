import type { Db } from "./client.js";

export type NewEvent = {
  endpointId: string;
  idempotencyKey: string;
  eventType: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array<ArrayBuffer>;
};

export type SavedEvent = { id: string; created: boolean };

type EventStore = Pick<Db, "event" | "destination" | "delivery">;

// skipDuplicates vira INSERT ... ON CONFLICT DO NOTHING; o id uuid v7 é gerado pelo Prisma, não pelo banco
export async function saveEvent(db: EventStore, event: NewEvent): Promise<SavedEvent> {
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

// o evento e as entregas precisam entrar juntos: um evento aceito sem entregas nunca seria enviado
export function ingestEvent(db: Db, event: NewEvent): Promise<SavedEvent> {
  return db.$transaction(async (tx) => {
    const savedEvent = await saveEvent(tx, event);
    if (savedEvent.created) {
      await createDeliveries(tx, savedEvent.id, event);
    }
    return savedEvent;
  });
}

async function createDeliveries(
  db: EventStore,
  eventId: string,
  { endpointId, eventType }: NewEvent,
) {
  const destinations = await db.destination.findMany({
    where: { endpointId, isActive: true, eventTypes: { hasSome: [eventType, "*"] } },
    select: { id: true },
  });
  await db.delivery.createMany({
    data: destinations.map(({ id }) => ({ eventId, destinationId: id })),
  });
}
