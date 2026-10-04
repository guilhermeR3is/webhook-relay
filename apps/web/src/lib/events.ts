import { z } from "zod";
import { apiFetch } from "./api";
import type { EventsQuery } from "./events-query";

export const EVENTS_PAGE_SIZE = 25;

const count = z.number().int().nonnegative();

const eventSummary = z.object({
  id: z.string(),
  eventType: z.string(),
  idempotencyKey: z.string(),
  receivedAt: z.coerce.date(),
  deliveries: z.object({
    dead: count,
    pending: count,
    in_progress: count,
    succeeded: count,
  }),
});

const eventsPage = z.object({
  events: z.array(eventSummary),
  nextCursor: z.string().nullable(),
});

export type EventSummary = z.infer<typeof eventSummary>;
export type EventsPage = z.infer<typeof eventsPage>;

export async function fetchEvents(query: EventsQuery): Promise<EventsPage> {
  const params = new URLSearchParams({ limit: String(EVENTS_PAGE_SIZE) });
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);

  return eventsPage.parse(await apiFetch(`/panel/events?${params.toString()}`));
}
