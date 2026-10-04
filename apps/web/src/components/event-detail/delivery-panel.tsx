import { StatusMark } from "@/components/status-mark";
import type { DeliveryDetail } from "@/lib/event-detail";
import { describeWait, formatEventTime } from "@/lib/time";
import { AttemptTimeline } from "./attempt-timeline";
import { ResendButton } from "./resend-button";

const titles = {
  dead: "Morta",
  pending: "Pendente",
  in_progress: "Em andamento",
  succeeded: "Entregue",
} as const;

function headline(delivery: DeliveryDetail, receivedAt: Date, now: Date) {
  const title = titles[delivery.status];
  if (delivery.status === "succeeded" && delivery.succeededAt) {
    const when = formatEventTime(delivery.succeededAt);
    const otherDay = when.dayMonth !== formatEventTime(receivedAt).dayMonth;
    return `${title} ${otherDay ? `em ${when.dayMonth} ` : ""}às ${when.clock}`;
  }
  if (delivery.status === "pending") {
    const neverTried = delivery.sequences.every((sequence) => sequence.attempts.length === 0);
    return `${title} · ${neverTried ? "primeira" : "próxima"} tentativa ${describeWait(delivery.nextAttemptAt, now)}`;
  }
  return title;
}

// conta o que a linha do tempo mostra; o contador do banco recomeça em zero a cada reenvio
function describeAttempts(delivery: DeliveryDetail) {
  const total = delivery.sequences.reduce((sum, sequence) => sum + sequence.attempts.length, 0);
  const text = `${String(total)} ${total === 1 ? "tentativa" : "tentativas"}`;
  return delivery.sequences.length > 1
    ? `${text} em ${String(delivery.sequences.length)} sequências`
    : text;
}

export function DeliveryPanel({
  delivery,
  receivedAt,
  now,
}: {
  delivery: DeliveryDetail;
  receivedAt: Date;
  now: Date;
}) {
  const headingId = `delivery-${delivery.id}`;
  const hasTimeline = delivery.sequences.length > 0;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-card p-5 md:p-6"
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-4">
        <StatusMark status={delivery.status} className="mt-[0.4rem]" />
        <div className="min-w-0 flex-1 basis-60">
          <h3
            id={headingId}
            className="text-base font-semibold wrap-anywhere"
            title={delivery.destination.displayUrl}
          >
            {delivery.destination.displayUrl}
          </h3>
          <p className="text-sm text-muted-foreground">
            {headline(delivery, receivedAt, now)}
            {" · "}
            {describeAttempts(delivery)}
          </p>
        </div>
        {delivery.status === "dead" && (
          <ResendButton deliveryId={delivery.id} destination={delivery.destination.displayUrl} />
        )}
      </header>
      {delivery.lastError && (
        <p className="mt-4 max-h-24 overflow-auto rounded-sm bg-muted px-3 py-2 text-sm wrap-anywhere">
          <span className="font-medium">Último erro: </span>
          {delivery.lastError}
        </p>
      )}
      <div className="mt-3">
        {hasTimeline ? (
          <AttemptTimeline sequences={delivery.sequences} receivedAt={receivedAt} />
        ) : (
          <p className="py-3 text-sm text-muted-foreground">Nenhuma tentativa foi feita ainda.</p>
        )}
      </div>
    </section>
  );
}
