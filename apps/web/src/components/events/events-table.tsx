import Link from "next/link";
import { StationStrip } from "@/components/station-strip";
import type { EventSummary } from "@/lib/events";
import { describeAge, formatEventTime } from "@/lib/time";

function EventRow({ event, now }: { event: EventSummary; now: Date }) {
  const time = formatEventTime(event.receivedAt);

  return (
    <tr className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/60 md:table-row md:px-0 md:py-0">
      <td className="col-start-2 row-start-1 text-right md:table-cell md:px-4 md:py-3 md:text-left md:align-middle">
        <time
          dateTime={event.receivedAt.toISOString()}
          title={time.full}
          className="block tabular-nums"
        >
          <span className="block">
            {time.dayMonth} {time.clock}
          </span>
          <span className="block text-xs text-muted-foreground">
            {describeAge(event.receivedAt, now)}
          </span>
        </time>
      </td>
      <td className="col-start-1 row-start-1 min-w-0 md:table-cell md:px-3 md:py-3 md:align-middle">
        <Link
          href={`/events/${event.id}`}
          title={event.eventType}
          className="block truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          {event.eventType}
        </Link>
      </td>
      <td className="col-span-2 min-w-0 md:table-cell md:px-3 md:py-3 md:align-middle">
        <span
          title={event.idempotencyKey}
          className="block truncate font-mono text-xs text-muted-foreground"
        >
          {event.idempotencyKey}
        </span>
      </td>
      <td className="col-span-2 md:table-cell md:px-4 md:py-3 md:align-middle">
        <StationStrip counts={event.deliveries} />
      </td>
    </tr>
  );
}

export function EventsTable({ events, now }: { events: EventSummary[]; now: Date }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm md:table-fixed">
        <caption className="sr-only">Eventos recebidos, do mais novo ao mais antigo</caption>
        <thead className="sr-only md:not-sr-only md:table-header-group">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="w-44 px-4 py-2.5 font-medium">
              Recebido
            </th>
            <th scope="col" className="w-[28%] px-3 py-2.5 font-medium">
              Tipo
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Chave
            </th>
            <th scope="col" className="w-52 px-4 py-2.5 font-medium">
              Entregas
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <EventRow key={event.id} event={event} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
