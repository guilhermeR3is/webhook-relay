import { X } from "lucide-react";
import { StatusMark } from "@/components/status-mark";
import { Button } from "@/components/ui/button";
import { skipReasonTexts, type BatchSummary } from "@/lib/batch-summary";
import { countOf } from "@/lib/plural";

function describeOutcome({ resentCount, skipped }: BatchSummary) {
  if (resentCount === 0) return "Nenhuma entrega foi reenviada";
  if (skipped.length === 0) return countOf(resentCount, "entrega reenviada", "entregas reenviadas");
  return `${countOf(resentCount, "reenviada", "reenviadas")}, ${countOf(skipped.length, "não reenviada", "não reenviadas")}`;
}

export function BatchSummaryPanel({
  summary,
  onDismiss,
}: {
  summary: BatchSummary;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-labelledby="batch-summary-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {summary.resentCount > 0 && <StatusMark status="pending" className="mt-[0.4rem]" />}
          <div className="min-w-0">
            <h2 id="batch-summary-heading" className="text-base font-semibold">
              {describeOutcome(summary)}
            </h2>
            {summary.resentCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {summary.resentCount === 1
                  ? "Voltou para a fila e começa uma nova sequência de tentativas."
                  : "Voltaram para a fila e cada uma começa uma nova sequência de tentativas."}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fechar resumo"
          onClick={onDismiss}
          className="relative shrink-0 after:absolute after:-inset-1.5"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {summary.skipped.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {summary.skipped.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3">
              <StatusMark status="dead" className="mt-[0.4rem]" />
              <div className="min-w-0 wrap-anywhere">
                <p>
                  <span className="font-medium">{entry.eventType}</span>
                  {entry.destination && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {" "}
                      {entry.destination}
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground">{skipReasonTexts[entry.reason]}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
