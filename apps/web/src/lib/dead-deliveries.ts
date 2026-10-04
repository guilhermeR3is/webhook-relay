import { z } from "zod";
import { apiFetch } from "./api";
import type { DeadQuery } from "./dead-query";

export const DEAD_PAGE_SIZE = 25;

const duration = z.number().int().nonnegative();

const deadDelivery = z.object({
  id: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  destination: z.object({ id: z.string(), displayUrl: z.string() }),
  attemptCount: duration,
  lastError: z.string().nullable(),
  createdAt: z.coerce.date(),
  lastAttempt: z
    .object({
      startedAt: z.coerce.date(),
      durationMs: duration,
      httpStatus: z.number().int().nullable(),
    })
    .nullable(),
});

const deadDeliveriesPage = z.object({
  deliveries: z.array(deadDelivery),
  nextCursor: z.string().nullable(),
});

export type DeadDelivery = z.infer<typeof deadDelivery>;
export type DeadDeliveriesPage = z.infer<typeof deadDeliveriesPage>;

export async function fetchDeadDeliveries(query: DeadQuery): Promise<DeadDeliveriesPage> {
  const params = new URLSearchParams({ limit: String(DEAD_PAGE_SIZE) });
  if (query.cursor) params.set("cursor", query.cursor);

  return deadDeliveriesPage.parse(await apiFetch(`/panel/dead-deliveries?${params.toString()}`));
}
