import { z } from "zod";
import { apiFetch } from "./api";
import { deliveryStatuses } from "./delivery-status";

const attempt = z.object({
  id: z.string(),
  startedAt: z.coerce.date(),
  durationMs: z.number().int().nonnegative(),
  httpStatus: z.number().int().nullable(),
  responseSnippet: z.string().nullable(),
  error: z.string().nullable(),
});

const sequence = z.object({
  number: z.number().int().positive(),
  resentAt: z.coerce.date().nullable(),
  attempts: z.array(attempt),
});

const delivery = z.object({
  id: z.string(),
  status: z.enum(deliveryStatuses),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.coerce.date(),
  lastError: z.string().nullable(),
  succeededAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  destination: z.object({ id: z.string(), displayUrl: z.string() }),
  sequences: z.array(sequence),
});

const eventDetail = z.object({
  id: z.string(),
  eventType: z.string(),
  idempotencyKey: z.string(),
  receivedAt: z.coerce.date(),
  headers: z.record(z.string(), z.string()),
  body: z.object({
    size: z.number().int().nonnegative(),
    text: z.string().nullable(),
    truncated: z.boolean(),
  }),
  deliveries: z.array(delivery),
});

export type AttemptDetail = z.infer<typeof attempt>;
export type AttemptSequence = z.infer<typeof sequence>;
export type DeliveryDetail = z.infer<typeof delivery>;
export type EventDetail = z.infer<typeof eventDetail>;

export async function fetchEventDetail(eventId: string): Promise<EventDetail> {
  return eventDetail.parse(await apiFetch(`/panel/events/${encodeURIComponent(eventId)}`));
}
