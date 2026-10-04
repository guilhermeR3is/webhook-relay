"use client";

import { CircleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Notice } from "@/components/notice";
import { summarizeBatch, type BatchSummary } from "@/lib/batch-summary";
import type { DeadDelivery } from "@/lib/dead-deliveries";
import { countOf } from "@/lib/plural";
import { headerState, selectedOf, toggleAllDeliveries, toggleDelivery } from "@/lib/selection";
import { BatchSummaryPanel } from "./batch-summary-panel";
import { DeadTable } from "./dead-table";
import { resendBatchAction } from "./resend-batch-action";

export function DeadQueue({
  deliveries,
  now,
  firstPage,
}: {
  deliveries: readonly DeadDelivery[];
  now: Date;
  firstPage: boolean;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [sending, startSending] = useTransition();

  const visibleIds = deliveries.map((delivery) => delivery.id);
  const chosen = selectedOf(selected, visibleIds);
  const header = headerState(selected, visibleIds);
  const amount = chosen.length;

  function resend() {
    const sent = deliveries.filter((delivery) => chosen.includes(delivery.id));
    startSending(async () => {
      const result = await resendBatchAction(chosen);
      if (result.kind === "unavailable") {
        setUnavailable(true);
        return;
      }
      setSummary(summarizeBatch(result, sent));
      setSelected(new Set());
      setOpen(false);
    });
  }

  const actionLabel = unavailable
    ? "Tentar de novo"
    : sending
      ? "Reenviando…"
      : `Reenviar ${String(amount)}`;

  return (
    <div className="flex flex-col gap-6">
      <div role="status">
        {summary && (
          <BatchSummaryPanel
            summary={summary}
            onDismiss={() => {
              setSummary(null);
            }}
          />
        )}
      </div>
      {deliveries.length === 0 ? (
        firstPage ? (
          <Notice title="Nenhuma entrega morta">
            <p>
              Quando uma entrega esgotar as tentativas ou for recusada pelo destino, ela aparece
              aqui para você decidir se reenvia.
            </p>
          </Notice>
        ) : (
          <Notice title="Não há mais entregas mortas nesta página">
            <p>
              Elas foram reenviadas ou o link é antigo. Volte ao início para ver a fila de novo.
            </p>
          </Notice>
        )
      ) : (
        <div className="overflow-clip rounded-lg border border-border bg-card">
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border bg-card px-4 py-3">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <Checkbox
                checked={header === "all" ? true : header === "some" ? "indeterminate" : false}
                onCheckedChange={() => {
                  setSelected(toggleAllDeliveries(selected, visibleIds));
                }}
              />
              Selecionar todas desta página
              <span className="text-muted-foreground tabular-nums">({deliveries.length})</span>
            </label>
            <div className="flex items-center gap-3">
              <p role="status" className="text-sm text-muted-foreground tabular-nums">
                {amount === 0
                  ? "Nenhuma selecionada"
                  : countOf(amount, "selecionada", "selecionadas")}
              </p>
              <AlertDialog
                open={open}
                onOpenChange={(next) => {
                  if (sending) return;
                  setUnavailable(false);
                  setOpen(next);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button size="lg" disabled={amount === 0}>
                    {amount === 0 ? "Reenviar" : `Reenviar ${String(amount)}`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Reenviar {countOf(amount, "entrega", "entregas")}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {amount === 1 ? "O destino vai receber" : "Cada destino vai receber"} o mesmo
                      corpo e o mesmo{" "}
                      <code className="font-mono text-xs whitespace-nowrap">webhook-id</code> da
                      primeira vez, com assinatura e horário novos. Um destino que guarda esse id
                      pode tratar o reenvio como repetido e ignorá-lo.{" "}
                      {amount === 1
                        ? "A entrega volta para a fila e começa uma nova sequência de tentativas."
                        : "As entregas voltam para a fila e cada uma começa uma nova sequência de tentativas."}
                    </AlertDialogDescription>
                    {unavailable && (
                      <p
                        role="alert"
                        className="flex items-start gap-2 rounded-sm bg-muted px-3 py-2 text-sm"
                      >
                        <CircleAlert
                          className="mt-0.5 size-4 shrink-0 text-destructive"
                          aria-hidden="true"
                        />
                        A API não respondeu. Pode tentar de novo; o que já tinha entrado aparece no
                        resumo como &quot;já não estava morta&quot;.
                      </p>
                    )}
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel size="lg" disabled={sending}>
                      {unavailable ? "Fechar" : "Cancelar"}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      size="lg"
                      disabled={sending || amount === 0}
                      onClick={(event) => {
                        event.preventDefault();
                        resend();
                      }}
                    >
                      {actionLabel}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <DeadTable
            deliveries={deliveries}
            selected={selected}
            now={now}
            onToggle={(deliveryId) => {
              setSelected(toggleDelivery(selected, deliveryId));
            }}
          />
        </div>
      )}
    </div>
  );
}
