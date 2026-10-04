const seconds = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const MIN_BAR_RATIO = 0.02;

export function formatSpan(milliseconds: number) {
  const ms = Math.max(0, milliseconds);
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  if (ms < 10_000) return `${seconds.format(ms / 1000)} s`;
  if (ms < 60_000) return `${String(Math.round(ms / 1000))} s`;

  const totalSeconds = Math.round(ms / 1000);
  if (ms < 3_600_000) {
    const minutes = Math.floor(totalSeconds / 60);
    const rest = totalSeconds % 60;
    return minutes < 10 && rest > 0
      ? `${String(minutes)} min ${String(rest)} s`
      : `${String(minutes)} min`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const rest = totalMinutes % 60;
  return rest > 0 ? `${String(hours)} h ${String(rest)} min` : `${String(hours)} h`;
}

// a barra mais longa da entrega ocupa a largura toda; as outras são proporcionais, com um mínimo para aparecer
export function barRatio(durationMs: number, longestMs: number) {
  if (longestMs <= 0) return MIN_BAR_RATIO;
  return Math.min(1, Math.max(MIN_BAR_RATIO, durationMs / longestMs));
}

export function isSuccessStatus(httpStatus: number | null) {
  return httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
}
