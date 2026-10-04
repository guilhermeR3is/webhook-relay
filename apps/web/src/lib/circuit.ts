import { formatSpan } from "./attempts";
import type { DestinationSummary } from "./destinations";
import { countOf } from "./plural";
import { formatEventTime } from "./time";

type CircuitSubject = Pick<DestinationSummary, "isActive" | "circuit">;

export type CircuitView =
  | { kind: "closed"; failures: number }
  | { kind: "paused"; until: Date }
  | { kind: "waiting" }
  | { kind: "testing" }
  | { kind: "inactive"; failures: number };

export type TrackMark = "failure" | "empty" | "testing";

// "open" continua no banco depois da pausa: só vira "half_open" quando alguém reivindica a sonda
export function circuitView(destination: CircuitSubject, now: Date): CircuitView {
  const { state, consecutiveFailures, pausedUntil } = destination.circuit;
  if (!destination.isActive) return { kind: "inactive", failures: consecutiveFailures };
  if (state === "closed") return { kind: "closed", failures: consecutiveFailures };
  if (state === "half_open") return { kind: "testing" };
  return pausedUntil && pausedUntil.getTime() > now.getTime()
    ? { kind: "paused", until: pausedUntil }
    : { kind: "waiting" };
}

export function describeCircuit(view: CircuitView, threshold: number, now: Date) {
  switch (view.kind) {
    case "closed":
      return {
        label: "Fechado",
        detail:
          view.failures === 0
            ? null
            : `${String(view.failures)} de ${String(threshold)} falhas seguidas`,
      };
    case "paused": {
      const secondsLeft = Math.ceil((view.until.getTime() - now.getTime()) / 1000);
      const left = formatSpan(secondsLeft * 1000);
      return {
        label: "Aberto",
        detail: `pausado até ${formatEventTime(view.until).clock} (em ${left})`,
      };
    }
    case "waiting":
      return { label: "Aberto", detail: "esperando a próxima entrega para testar" };
    case "testing":
      return { label: "Meio-aberto", detail: "testando agora" };
    case "inactive":
      return { label: "Desativado", detail: "em geral porque respondeu 410" };
  }
}

// um destino desativado não tem trilho: o circuito dele não decide mais nada
export function trackMarks(view: CircuitView, threshold: number): TrackMark[] {
  const track = (failures: number, lastMark?: TrackMark): TrackMark[] =>
    Array.from({ length: threshold }, (_, index) => {
      if (lastMark && index === threshold - 1) return lastMark;
      return index < failures ? "failure" : "empty";
    });

  switch (view.kind) {
    case "inactive":
      return [];
    case "closed":
      return track(view.failures);
    case "paused":
    case "waiting":
      return track(threshold);
    case "testing":
      return track(threshold - 1, "testing");
  }
}

function trouble(view: CircuitView) {
  switch (view.kind) {
    case "paused":
    case "waiting":
    case "testing":
      return 0;
    case "inactive":
      return 1;
    case "closed":
      return view.failures > 0 ? 2 : 3;
  }
}

// do pior para o melhor, como a faixa de estações; quem empata fica na ordem em que veio
export function sortByTrouble<T extends CircuitSubject>(destinations: readonly T[], now: Date) {
  return [...destinations].sort(
    (a, b) => trouble(circuitView(a, now)) - trouble(circuitView(b, now)),
  );
}

// só um destino ativo com circuito aberto ou meio-aberto muda sozinho (a pausa acaba, a sonda decide)
export function needsCircuitWatch(destinations: readonly CircuitSubject[], now: Date) {
  return destinations.some((destination) => trouble(circuitView(destination, now)) === 0);
}

const circuitGroups = [
  { key: "open", one: "aberto", many: "abertos" },
  { key: "testing", one: "meio-aberto", many: "meio-abertos" },
  { key: "closed", one: "fechado", many: "fechados" },
  { key: "inactive", one: "desativado", many: "desativados" },
] as const;

const groupOfView = {
  paused: "open",
  waiting: "open",
  testing: "testing",
  closed: "closed",
  inactive: "inactive",
} as const;

export function describeCircuits(destinations: readonly CircuitSubject[], now: Date) {
  const counts = { open: 0, testing: 0, closed: 0, inactive: 0 };
  for (const destination of destinations) {
    counts[groupOfView[circuitView(destination, now).kind]] += 1;
  }
  const parts = circuitGroups
    .filter((group) => counts[group.key] > 0)
    .map((group) => countOf(counts[group.key], group.one, group.many));
  return `circuitos: ${parts.length === 0 ? "nenhum destino" : parts.join(", ")}`;
}

export function describeEventTypes(eventTypes: readonly string[]) {
  if (eventTypes.length === 0) return "nenhum evento";
  if (eventTypes.includes("*")) return "todos os eventos";
  return eventTypes.join(", ");
}
