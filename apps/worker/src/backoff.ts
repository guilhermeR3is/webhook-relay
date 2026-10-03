const BASE_SECONDS = 10;
export const MAX_DELAY_SECONDS = 3600;

export function nextDelay(attempt: number, random: () => number = Math.random) {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be an integer >= 1, got ${String(attempt)}`);
  }
  const ceilingSeconds = Math.min(MAX_DELAY_SECONDS, BASE_SECONDS * 2 ** (attempt - 1));
  return random() * ceilingSeconds;
}
