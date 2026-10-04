import {
  deliveryStatuses,
  describeDeliveries,
  totalDeliveries,
  type DeliveryCounts,
  type DeliveryStatus,
} from "@/lib/delivery-status";
import { StatusMark } from "./status-mark";

export const MAX_MARKS = 8;

const counter = new Intl.NumberFormat("pt-BR");

export function StationStrip({ counts }: { counts: DeliveryCounts }) {
  const total = totalDeliveries(counts);
  if (total === 0) {
    return <span className="text-sm text-muted-foreground">sem entregas</span>;
  }

  const marks: DeliveryStatus[] = [];
  for (const status of deliveryStatuses) {
    for (let index = 0; index < counts[status] && marks.length < MAX_MARKS; index++) {
      marks.push(status);
    }
  }
  const hidden = total - marks.length;
  const summary = describeDeliveries(counts);

  return (
    <span role="img" aria-label={summary} title={summary} className="inline-flex items-center">
      {marks.map((status, index) => (
        <span key={index} className="inline-flex items-center">
          {index > 0 && <span className="h-px w-1.5 bg-border" />}
          <StatusMark status={status} />
        </span>
      ))}
      {hidden > 0 && (
        <span className="ml-2 text-xs text-muted-foreground tabular-nums">
          +{counter.format(hidden)}
        </span>
      )}
    </span>
  );
}
