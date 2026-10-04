export type HeaderState = "none" | "some" | "all";

export function toggleDelivery(selected: ReadonlySet<string>, deliveryId: string) {
  const next = new Set(selected);
  if (!next.delete(deliveryId)) next.add(deliveryId);
  return next;
}

// só conta o que está na tela: depois de recarregar, ids que sumiram da lista não entram no lote
export function selectedOf(selected: ReadonlySet<string>, visibleIds: readonly string[]) {
  return visibleIds.filter((id) => selected.has(id));
}

export function headerState(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): HeaderState {
  const count = selectedOf(selected, visibleIds).length;
  if (count === 0) return "none";
  return count === visibleIds.length ? "all" : "some";
}

export function toggleAllDeliveries(selected: ReadonlySet<string>, visibleIds: readonly string[]) {
  return headerState(selected, visibleIds) === "all" ? new Set<string>() : new Set(visibleIds);
}
