import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BodyPreview } from "@/components/event-detail/body-preview";
import { DeliveryPanel } from "@/components/event-detail/delivery-panel";
import { EventHeaders } from "@/components/event-detail/event-headers";
import { explainLoadError } from "@/components/explain-load-error";
import { LiveAnnouncer } from "@/components/live-announcer";
import { LiveRefresh } from "@/components/live-refresh";
import { Notice } from "@/components/notice";
import { ApiError } from "@/lib/api";
import { fetchEventDetail, type EventDetail } from "@/lib/event-detail";
import { describeProgress, needsLiveUpdate } from "@/lib/live-update";
import { describeAge, formatEventTime } from "@/lib/time";

export const metadata: Metadata = { title: "Evento" };

function BackToEvents() {
  return (
    <Link
      href="/events"
      className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-sm px-1 py-1 text-sm md:min-h-0 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Eventos
    </Link>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <BackToEvents />
      <h1 className="text-2xl font-semibold tracking-tight">Evento</h1>
      {children}
    </div>
  );
}

export default async function EventDetailPage({ params }: PageProps<"/events/[eventId]">) {
  const { eventId } = await params;

  let event: EventDetail;
  try {
    event = await fetchEventDetail(eventId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "event_not_found") notFound();
    const explanation = explainLoadError(error);
    if (!explanation) throw error;
    return <Frame>{explanation}</Frame>;
  }

  const now = new Date();
  const received = formatEventTime(event.receivedAt);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <BackToEvents />
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{event.eventType}</h1>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Recebido</dt>
          <dd>
            <time dateTime={event.receivedAt.toISOString()} className="tabular-nums">
              {received.full}
            </time>
            <span className="text-muted-foreground"> · {describeAge(event.receivedAt, now)}</span>
          </dd>
          <dt className="text-muted-foreground">Chave</dt>
          <dd className="font-mono text-xs wrap-anywhere">{event.idempotencyKey}</dd>
          <dt className="text-muted-foreground">Id</dt>
          <dd className="font-mono text-xs">{event.id}</dd>
        </dl>
      </header>

      <section aria-labelledby="deliveries-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="deliveries-heading" className="text-lg font-semibold tracking-tight">
            Entregas
          </h2>
          <LiveAnnouncer report={describeProgress(event.deliveries)} />
          {needsLiveUpdate(event.deliveries, now) && <LiveRefresh />}
        </div>
        {event.deliveries.length === 0 ? (
          <Notice title="Nada foi enviado">
            <p>
              Nenhum destino estava inscrito neste tipo de evento quando ele chegou, então ele foi
              guardado e não gerou entrega.
            </p>
          </Notice>
        ) : (
          event.deliveries.map((delivery) => (
            <DeliveryPanel
              key={delivery.id}
              delivery={delivery}
              receivedAt={event.receivedAt}
              now={now}
            />
          ))
        )}
      </section>

      <BodyPreview body={event.body} />
      <EventHeaders headers={event.headers} />
    </div>
  );
}
