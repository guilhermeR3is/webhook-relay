// o servidor roda em UTC; sem fuso explícito o horário na tela sairia errado para quem lê no Brasil
const TIME_ZONE = "America/Sao_Paulo";

const dayMonth = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
});
const clock = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const minutes = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fullDate = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});
const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "always", style: "short" });

export function formatMinutes(date: Date) {
  return minutes.format(date);
}

export function formatEventTime(date: Date) {
  return {
    dayMonth: dayMonth.format(date),
    clock: clock.format(date),
    full: fullDate.format(date).replace(", ", " "),
  };
}

// o pt-BR abreviado termina em ponto ("há 3 min."), que sobra dentro de uma célula
function relativeText(amount: number, unit: Intl.RelativeTimeFormatUnit) {
  return relative.format(amount, unit).replace(/\.$/, "");
}

function describeSeconds(totalSeconds: number, direction: "past" | "future") {
  if (totalSeconds < 45) return "agora";
  const sign = direction === "past" ? -1 : 1;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return relativeText(sign * minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relativeText(sign * hours, "hour");
  return relativeText(sign * Math.round(hours / 24), "day");
}

export function describeAge(date: Date, now: Date) {
  return describeSeconds(Math.round((now.getTime() - date.getTime()) / 1000), "past");
}

export function describeWait(date: Date, now: Date) {
  return describeSeconds(Math.round((date.getTime() - now.getTime()) / 1000), "future");
}
