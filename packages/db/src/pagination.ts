export function assertPageLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be an integer >= 1, got ${String(limit)}`);
  }
}
