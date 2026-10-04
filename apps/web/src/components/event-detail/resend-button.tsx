"use client";

import { CircleAlert, RotateCw } from "lucide-react";
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
import { resendDeliveryAction } from "./resend-action";

// nos outros resultados a página é recarregada e já mostra o que aconteceu
const failureMessages = {
  destination_inactive:
    "O destino está desativado, em geral porque respondeu 410. Reenviar só faria a entrega morrer de novo, então o reenvio foi recusado.",
  unavailable:
    "A API não respondeu. Pode tentar de novo; se o reenvio já tinha entrado, a página mostra o estado atual.",
};

type Failure = keyof typeof failureMessages;

export function ResendButton({
  deliveryId,
  destination,
}: {
  deliveryId: string;
  destination: string;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sending, startSending] = useTransition();

  function resend() {
    startSending(async () => {
      const result = await resendDeliveryAction(deliveryId);
      if (result === "destination_inactive" || result === "unavailable") {
        setFailure(result);
      } else {
        setOpen(false);
      }
    });
  }

  const actionLabel =
    failure === "unavailable" ? "Tentar de novo" : sending ? "Reenviando…" : "Reenviar";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (sending) return;
        setFailure(null);
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="lg" aria-label={`Reenviar para ${destination}`}>
          <RotateCw data-icon="inline-start" aria-hidden="true" />
          Reenviar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reenviar esta entrega?</AlertDialogTitle>
          <p className="font-mono text-xs text-muted-foreground wrap-anywhere">{destination}</p>
          <AlertDialogDescription>
            O destino vai receber o mesmo corpo e o mesmo{" "}
            <code className="font-mono text-xs whitespace-nowrap">webhook-id</code> da primeira vez,
            com assinatura e horário novos. Se ele guarda esse id, pode tratar o reenvio como
            repetido e ignorá-lo. A entrega volta para a fila e as tentativas começam uma nova
            sequência.
          </AlertDialogDescription>
          {failure && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-muted px-3 py-2 text-sm"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              {failureMessages[failure]}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg" disabled={sending}>
            {failure ? "Fechar" : "Cancelar"}
          </AlertDialogCancel>
          {failure !== "destination_inactive" && (
            <AlertDialogAction
              size="lg"
              disabled={sending}
              onClick={(event) => {
                event.preventDefault();
                resend();
              }}
            >
              {actionLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
