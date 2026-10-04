import { describeDeliveries, type DeliveryCounts } from "./delivery-status";
import type { DeliveryDetail } from "./event-detail";
import { countOf } from "./plural";

// o backoff passa de 1 min a partir da 4ª falha; esperar mais que isso não mostra nada
const SOON_MS = 60_000;

export function needsLiveUpdate(deliveries: readonly DeliveryDetail[], now: Date) {
  return deliveries.some(
    (delivery) =>
      delivery.status === "in_progress" ||
      (delivery.status === "pending" &&
        delivery.nextAttemptAt.getTime() - now.getTime() <= SOON_MS),
  );
}

export function describeProgress(deliveries: readonly DeliveryDetail[]) {
  const counts: DeliveryCounts = { dead: 0, pending: 0, in_progress: 0, succeeded: 0 };
  let attempts = 0;
  for (const delivery of deliveries) {
    counts[delivery.status] += 1;
    for (const sequence of delivery.sequences) attempts += sequence.attempts.length;
  }
  return `${describeDeliveries(counts)}; ${countOf(attempts, "tentativa", "tentativas")}`;
}
