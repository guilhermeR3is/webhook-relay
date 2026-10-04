import { BreakableUrl } from "@/components/breakable-url";
import { StationStrip } from "@/components/station-strip";
import { circuitView, describeCircuit, describeEventTypes, trackMarks } from "@/lib/circuit";
import type { DestinationSummary } from "@/lib/destinations";
import { CircuitTrack } from "./circuit-track";

function DestinationRow({
  destination,
  threshold,
  now,
}: {
  destination: DestinationSummary;
  threshold: number;
  now: Date;
}) {
  const view = circuitView(destination, now);
  const { label, detail } = describeCircuit(view, threshold, now);
  const marks = trackMarks(view, threshold);
  const needsAttention =
    view.kind === "paused" || view.kind === "waiting" || view.kind === "testing";

  return (
    <tr
      data-attention={needsAttention}
      className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 data-[attention=true]:bg-muted/60 md:table-row md:px-0 md:py-0"
    >
      <td className="min-w-0 md:table-cell md:px-4 md:py-3 md:align-middle">
        <span title={destination.displayUrl} className="line-clamp-2 font-medium wrap-anywhere">
          <BreakableUrl url={destination.displayUrl} />
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground wrap-anywhere">
          Recebe {describeEventTypes(destination.eventTypes)}
        </span>
      </td>
      <td className="md:table-cell md:px-3 md:py-3 md:align-middle">
        {marks.length > 0 && <CircuitTrack marks={marks} />}
        <span className="mt-1.5 block text-sm">
          <span className="font-medium">{label}</span>
          {detail && <span className="text-muted-foreground"> · {detail}</span>}
        </span>
      </td>
      <td className="md:table-cell md:px-4 md:py-3 md:align-middle">
        <span aria-hidden="true" className="mb-1 block text-xs text-muted-foreground md:hidden">
          Entregas
        </span>
        <StationStrip counts={destination.deliveries} />
      </td>
    </tr>
  );
}

export function DestinationsTable({
  destinations,
  threshold,
  now,
}: {
  destinations: readonly DestinationSummary[];
  threshold: number;
  now: Date;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm md:table-fixed">
        <caption className="sr-only">
          Destinos e o estado do circuito de cada um, dos que pedem mais atenção aos mais saudáveis
        </caption>
        <thead className="sr-only md:not-sr-only md:table-header-group">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="w-[34%] px-4 py-2.5 font-medium">
              Destino
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Circuito
            </th>
            <th scope="col" className="w-52 px-4 py-2.5 font-medium">
              Entregas
            </th>
          </tr>
        </thead>
        <tbody>
          {destinations.map((destination) => (
            <DestinationRow
              key={destination.id}
              destination={destination}
              threshold={threshold}
              now={now}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
