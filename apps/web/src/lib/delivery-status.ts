// do pior para o melhor: a primeira marca de uma faixa já mostra o pior estado do evento
export const deliveryStatuses = ["dead", "pending", "in_progress", "succeeded"] as const;

export type DeliveryStatus = (typeof deliveryStatuses)[number];

export type DeliveryCounts = Record<DeliveryStatus, number>;

export const statusLabels: Record<DeliveryStatus, { one: string; many: string }> = {
  dead: { one: "morta", many: "mortas" },
  pending: { one: "pendente", many: "pendentes" },
  in_progress: { one: "em andamento", many: "em andamento" },
  succeeded: { one: "entregue", many: "entregues" },
};

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return deliveryStatuses.some((status) => status === value);
}

export function totalDeliveries(counts: DeliveryCounts) {
  return deliveryStatuses.reduce((total, status) => total + counts[status], 0);
}

export function describeDeliveries(counts: DeliveryCounts) {
  const parts = deliveryStatuses
    .filter((status) => counts[status] > 0)
    .map(
      (status) =>
        `${String(counts[status])} ${statusLabels[status][counts[status] === 1 ? "one" : "many"]}`,
    );
  return parts.length === 0 ? "sem entregas" : parts.join(", ");
}
