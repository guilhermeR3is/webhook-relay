export type ChaosInput = {
  accepted: number;
  eventsInDatabase: number;
  deliveries: { succeeded: number; pending: number; in_progress: number; dead: number };
  redeliveredAfterKill: number;
  receiver: { received: number; distinct: number; duplicates: number };
};

export type ChaosVerdict =
  "zero events lost" | "events lost" | "not settled" | "numbers inconsistent";

export function summarizeChaos(input: ChaosInput) {
  const { accepted, eventsInDatabase, deliveries, receiver } = input;
  const lostEvents = accepted - eventsInDatabase;
  const undeliveredEvents = eventsInDatabase - receiver.distinct;

  let verdict: ChaosVerdict = "zero events lost";
  if (deliveries.pending + deliveries.in_progress > 0) {
    verdict = "not settled";
  } else if (lostEvents < 0 || undeliveredEvents < 0) {
    verdict = "numbers inconsistent";
  } else if (lostEvents > 0 || undeliveredEvents > 0 || deliveries.dead > 0) {
    verdict = "events lost";
  }

  return {
    ...input,
    lostEvents,
    undeliveredEvents,
    duplicateDeliveries: receiver.duplicates,
    verdict,
  };
}
