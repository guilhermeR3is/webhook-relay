import { collectDefaultMetrics, Counter, Histogram, Registry } from "@prometheus-io/client";

// o alvo do PLANO é responder em menos de 50 ms, então os degraus se concentram abaixo disso
const INGEST_BUCKETS_SECONDS = [0.005, 0.01, 0.02, 0.035, 0.05, 0.075, 0.1, 0.25, 0.5, 1];

export function createApiMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  // sem o slug como label: ele vem do visitante e criaria uma série nova a cada slug inventado
  const eventsReceived = new Counter({
    name: "relay_events_received_total",
    help: "Requests to POST /in/:slug by outcome",
    labelNames: ["result"],
    registers: [registry],
  });
  const ingestDuration = new Histogram({
    name: "relay_ingest_duration_seconds",
    help: "Time to answer POST /in/:slug",
    labelNames: ["status_code"],
    buckets: INGEST_BUCKETS_SECONDS,
    registers: [registry],
  });

  return { registry, eventsReceived, ingestDuration };
}

export type ApiMetrics = ReturnType<typeof createApiMetrics>;
