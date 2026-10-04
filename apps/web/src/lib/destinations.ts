import { z } from "zod";
import { apiFetch } from "./api";

const count = z.number().int().nonnegative();

const destination = z.object({
  id: z.string(),
  displayUrl: z.string(),
  isActive: z.boolean(),
  eventTypes: z.array(z.string()),
  circuit: z.object({
    state: z.enum(["closed", "open", "half_open"]),
    consecutiveFailures: count,
    since: z.coerce.date().nullable(),
    pausedUntil: z.coerce.date().nullable(),
  }),
  deliveries: z.object({
    dead: count,
    pending: count,
    in_progress: count,
    succeeded: count,
  }),
});

const destinationsList = z.object({
  failureThreshold: z.number().int().positive(),
  destinations: z.array(destination),
});

export type DestinationSummary = z.infer<typeof destination>;
export type DestinationsList = z.infer<typeof destinationsList>;

export async function fetchDestinations(): Promise<DestinationsList> {
  return destinationsList.parse(await apiFetch("/panel/destinations"));
}
