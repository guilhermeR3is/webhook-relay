import { isDeliveryStatus, type DeliveryStatus } from "./delivery-status";
import { firstValue, type RawParams } from "./search-params";

export const MAX_SEARCH_LENGTH = 100;

export type EventsQuery = {
  status?: DeliveryStatus;
  search?: string;
  cursor?: string;
};

// a URL é entrada de fora: valor inválido vira "sem filtro" em vez de erro na tela
export function parseEventsQuery(raw: RawParams): EventsQuery {
  const status = firstValue(raw.status);
  const search = firstValue(raw.search)?.trim().slice(0, MAX_SEARCH_LENGTH);
  const cursor = firstValue(raw.cursor);

  return {
    ...(isDeliveryStatus(status) ? { status } : {}),
    ...(search ? { search } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function eventsHref(query: EventsQuery) {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);
  const text = params.toString();
  return text ? `/events?${text}` : "/events";
}
