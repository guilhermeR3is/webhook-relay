import Link from "next/link";
import { BreakableUrl } from "@/components/breakable-url";
import { Checkbox } from "@/components/ui/checkbox";
import { formatSpan } from "@/lib/attempts";
import type { DeadDelivery } from "@/lib/dead-deliveries";
import { countOf } from "@/lib/plural";
import { describeAge, formatEventTime } from "@/lib/time";

function describeLastResponse(delivery: DeadDelivery) {
  const attempt = delivery.lastAttempt;
  if (!attempt) return "nunca enviou";
  const status = attempt.httpStatus === null ? "sem resposta" : String(attempt.httpStatus);
  return `${status} · ${formatSpan(attempt.durationMs)}`;
}

function DeadRow({
  delivery,
  checked,
  onToggle,
  now,
}: {
  delivery: DeadDelivery;
  checked: boolean;
  onToggle: (deliveryId: string) => void;
  now: Date;
}) {
  const time = formatEventTime(delivery.createdAt);

  return (
    <tr
      data-selected={checked}
      className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/60 data-[selected=true]:bg-muted md:table-row md:px-0 md:py-0"
    >
      <td className="relative z-10 col-start-1 row-start-1 md:table-cell md:py-3 md:pr-0 md:pl-4 md:align-middle">
        <Checkbox
          checked={checked}
          onCheckedChange={() => {
            onToggle(delivery.id);
          }}
          aria-label={`Selecionar ${delivery.eventType} para ${delivery.destination.displayUrl}`}
        />
      </td>
      <td className="col-start-2 row-start-1 min-w-0 md:table-cell md:px-3 md:py-3 md:align-middle">
        <Link
          href={`/events/${delivery.eventId}`}
          title={delivery.eventType}
          className="block truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          {delivery.eventType}
        </Link>
      </td>
      <td className="col-start-2 col-span-2 min-w-0 md:table-cell md:px-3 md:py-3 md:align-middle">
        <span
          title={delivery.destination.displayUrl}
          className="line-clamp-2 font-mono text-xs text-muted-foreground wrap-anywhere"
        >
          <BreakableUrl url={delivery.destination.displayUrl} />
        </span>
      </td>
      <td className="col-start-2 col-span-2 min-w-0 md:table-cell md:px-3 md:py-3 md:align-middle">
        <span
          title={delivery.lastError ?? undefined}
          className="line-clamp-2 text-xs wrap-anywhere"
        >
          {delivery.lastError ?? <span className="text-muted-foreground">sem erro registrado</span>}
        </span>
      </td>
      <td className="col-start-2 col-span-2 md:table-cell md:px-3 md:py-3 md:align-middle">
        <span className="block text-xs tabular-nums">{describeLastResponse(delivery)}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {countOf(delivery.attemptCount, "tentativa", "tentativas")}
        </span>
      </td>
      <td className="col-start-3 row-start-1 text-right md:table-cell md:px-4 md:py-3 md:text-left md:align-middle">
        <time
          dateTime={delivery.createdAt.toISOString()}
          title={time.full}
          className="block tabular-nums"
        >
          <span className="block">
            {time.dayMonth} {time.clock}
          </span>
          <span className="block text-xs text-muted-foreground">
            {describeAge(delivery.createdAt, now)}
          </span>
        </time>
      </td>
    </tr>
  );
}

export function DeadTable({
  deliveries,
  selected,
  onToggle,
  now,
}: {
  deliveries: readonly DeadDelivery[];
  selected: ReadonlySet<string>;
  onToggle: (deliveryId: string) => void;
  now: Date;
}) {
  return (
    <table className="w-full text-sm md:table-fixed">
      <caption className="sr-only">
        Entregas mortas, das mais novas às mais antigas. Marque as que quer reenviar.
      </caption>
      <thead className="sr-only md:not-sr-only md:table-header-group">
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th scope="col" className="w-12 py-2.5 pr-0 pl-4 font-medium">
            <span className="sr-only">Selecionar</span>
          </th>
          <th scope="col" className="w-[18%] px-3 py-2.5 font-medium">
            Evento
          </th>
          <th scope="col" className="w-[26%] px-3 py-2.5 font-medium">
            Destino
          </th>
          <th scope="col" className="px-3 py-2.5 font-medium">
            Último erro
          </th>
          <th scope="col" className="w-36 px-3 py-2.5 font-medium">
            Última resposta
          </th>
          <th scope="col" className="w-40 px-4 py-2.5 font-medium">
            Recebido
          </th>
        </tr>
      </thead>
      <tbody>
        {deliveries.map((delivery) => (
          <DeadRow
            key={delivery.id}
            delivery={delivery}
            checked={selected.has(delivery.id)}
            onToggle={onToggle}
            now={now}
          />
        ))}
      </tbody>
    </table>
  );
}
