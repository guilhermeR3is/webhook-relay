import { checkQueue, type Queryable } from "@relay/db";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";

// o envio tem timeout de 10 s, então o último degrau cobre o pior caso
const SEND_BUCKETS_SECONDS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function createDeliveryMetrics(registry: Registry) {
  const deliveries = new Counter({
    name: "relay_deliveries_total",
    help: "Deliveries processed by the worker, by outcome",
    labelNames: ["result"],
    registers: [registry],
  });
  const sendDuration = new Histogram({
    name: "relay_send_duration_seconds",
    help: "Time the destination took to answer a send",
    labelNames: ["status_class"],
    buckets: SEND_BUCKETS_SECONDS,
    registers: [registry],
  });

  return { deliveries, sendDuration };
}

export type DeliveryMetrics = ReturnType<typeof createDeliveryMetrics>;

export function createWorkerMetrics(db: Queryable) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  new Gauge({
    name: "relay_queue_depth",
    help: "Deliveries due to be sent right now",
    registers: [registry],
    async collect() {
      const queue = await checkQueue(db);
      // 0 diria "fila vazia" e o valor antigo enganaria; NaN vira lacuna no gráfico
      this.set(queue.status === "ok" ? queue.depth : Number.NaN);
    },
  });

  return { registry, ...createDeliveryMetrics(registry) };
}

export function statusClass(httpStatus: number | undefined) {
  return httpStatus === undefined ? "none" : `${String(Math.floor(httpStatus / 100))}xx`;
}
