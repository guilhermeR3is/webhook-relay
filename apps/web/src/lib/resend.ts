import { z } from "zod";
import { ApiError, ApiUnavailableError, apiFetch } from "./api";

export type ResendResult =
  "resent" | "not_dead" | "destination_inactive" | "not_found" | "unavailable";

const resentBody = z.object({ resent: z.literal(true) });

// Map e não objeto: um código como "constructor" não pode achar uma propriedade herdada
const refusals = new Map<string, ResendResult>([
  ["delivery_not_dead", "not_dead"],
  ["destination_inactive", "destination_inactive"],
  ["delivery_not_found", "not_found"],
]);

export async function resendDelivery(deliveryId: string): Promise<ResendResult> {
  try {
    resentBody.parse(
      await apiFetch(`/panel/deliveries/${encodeURIComponent(deliveryId)}/resend`, {
        method: "POST",
      }),
    );
    return "resent";
  } catch (error) {
    if (error instanceof ApiUnavailableError) return "unavailable";
    const refusal = error instanceof ApiError ? refusals.get(error.code) : undefined;
    if (refusal) return refusal;
    throw error;
  }
}

const batchBody = z.object({
  resent: z.array(z.string()),
  skipped: z.array(
    z.object({
      id: z.string(),
      reason: z.enum(["not_found", "not_dead", "destination_inactive"]),
    }),
  ),
});

export type BatchOutcome = z.infer<typeof batchBody>;
export type SkipReason = BatchOutcome["skipped"][number]["reason"];

export type BatchResendResult = ({ kind: "done" } & BatchOutcome) | { kind: "unavailable" };

export async function resendDeliveries(deliveryIds: readonly string[]): Promise<BatchResendResult> {
  try {
    const outcome = batchBody.parse(
      await apiFetch("/panel/dead-deliveries/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryIds }),
      }),
    );
    return { kind: "done", ...outcome };
  } catch (error) {
    if (error instanceof ApiUnavailableError) return { kind: "unavailable" };
    throw error;
  }
}
