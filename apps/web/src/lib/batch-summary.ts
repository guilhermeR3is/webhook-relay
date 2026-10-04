import type { DeadDelivery } from "./dead-deliveries";
import type { BatchOutcome, SkipReason } from "./resend";

export type BatchSummary = {
  resentCount: number;
  skipped: { id: string; reason: SkipReason; eventType: string; destination: string }[];
};

export const skipReasonTexts: Record<SkipReason, string> = {
  destination_inactive: "O destino está desativado (em geral respondeu 410)",
  not_dead: "Já não estava morta (outra pessoa reenviou ou ela foi entregue)",
  not_found: "Não existe mais",
};

// os nomes vêm das linhas que estavam na tela no clique: depois do reenvio elas podem ter saído da lista
export function summarizeBatch(outcome: BatchOutcome, sent: readonly DeadDelivery[]): BatchSummary {
  const byId = new Map(sent.map((delivery) => [delivery.id, delivery]));

  return {
    resentCount: outcome.resent.length,
    skipped: outcome.skipped.map(({ id, reason }) => {
      const delivery = byId.get(id);
      return {
        id,
        reason,
        eventType: delivery?.eventType ?? id,
        destination: delivery?.destination.displayUrl ?? "",
      };
    }),
  };
}
