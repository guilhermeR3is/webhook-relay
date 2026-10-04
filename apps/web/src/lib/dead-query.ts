import { firstValue, type RawParams } from "./search-params";

export type DeadQuery = { cursor?: string };

// a URL é entrada de fora: cursor vazio vale como "primeira página"
export function parseDeadQuery(raw: RawParams): DeadQuery {
  const cursor = firstValue(raw.cursor);
  return cursor ? { cursor } : {};
}

export function deadHref(query: DeadQuery) {
  return query.cursor
    ? `/dead?${new URLSearchParams({ cursor: query.cursor }).toString()}`
    : "/dead";
}
