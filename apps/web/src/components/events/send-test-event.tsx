"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { describeTestEventFailure, sendTestEvent } from "@/lib/test-event";

export function SendTestEvent({ apiUrl }: { apiUrl: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setProblem(null);
    const result = await sendTestEvent(apiUrl);
    if (result.kind === "sent") {
      router.push(`/events/${result.eventId}`);
      return;
    }
    setProblem(describeTestEventFailure(result));
    setSending(false);
  }

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <Button
        size="lg"
        disabled={sending}
        onClick={() => {
          void send();
        }}
      >
        {sending ? "Enviando…" : "Enviar evento de teste"}
      </Button>
      <p className="text-xs text-muted-foreground md:text-right">
        Limite: 5 por hora por visitante e 200 por dia no total.
      </p>
      {problem && (
        <p
          role="alert"
          className="flex max-w-sm items-start gap-2 rounded-sm bg-muted px-3 py-2 text-sm"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          {problem}
        </p>
      )}
    </div>
  );
}
