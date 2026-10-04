import { describe, expect, it } from "vitest";
import {
  circuitView,
  describeCircuit,
  describeCircuits,
  describeEventTypes,
  needsCircuitWatch,
  sortByTrouble,
  trackMarks,
} from "./circuit";
import type { DestinationSummary } from "./destinations";

const now = new Date("2026-10-04T15:00:00Z");

function destination(
  id: string,
  state: DestinationSummary["circuit"]["state"] = "closed",
  failures = 0,
  overrides: Partial<Pick<DestinationSummary, "isActive">> & {
    pausedUntil?: Date | null;
  } = {},
) {
  return {
    id,
    isActive: overrides.isActive ?? true,
    circuit: {
      state,
      consecutiveFailures: failures,
      since: null,
      pausedUntil: overrides.pausedUntil ?? null,
    },
  };
}

const inSeconds = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe("circuitView", () => {
  it("is closed with the failures so far", () => {
    expect(circuitView(destination("a", "closed", 3), now)).toEqual({
      kind: "closed",
      failures: 3,
    });
  });

  it("is paused until the end of the pause while it is in the future", () => {
    const until = inSeconds(180);

    expect(circuitView(destination("a", "open", 5, { pausedUntil: until }), now)).toEqual({
      kind: "paused",
      until,
    });
  });

  it("is waiting for the next delivery once the pause is over, even by one millisecond", () => {
    expect(
      circuitView(destination("a", "open", 5, { pausedUntil: new Date(now.getTime() - 1) }), now),
    ).toEqual({ kind: "waiting" });
    expect(circuitView(destination("a", "open", 5, { pausedUntil: now }), now)).toEqual({
      kind: "waiting",
    });
  });

  it("is waiting when an open circuit has no end of pause", () => {
    expect(circuitView(destination("a", "open", 5), now)).toEqual({ kind: "waiting" });
  });

  it("is testing while half open", () => {
    expect(circuitView(destination("a", "half_open", 5), now)).toEqual({ kind: "testing" });
  });

  it("is inactive for a deactivated destination, whatever its circuit says", () => {
    expect(circuitView(destination("a", "open", 5, { isActive: false }), now)).toEqual({
      kind: "inactive",
      failures: 5,
    });
  });
});

describe("describeCircuit", () => {
  it("says a clean closed circuit is just closed", () => {
    expect(describeCircuit({ kind: "closed", failures: 0 }, 5, now)).toEqual({
      label: "Fechado",
      detail: null,
    });
  });

  it("counts the failures against the limit when the circuit is closed", () => {
    expect(describeCircuit({ kind: "closed", failures: 2 }, 5, now)).toEqual({
      label: "Fechado",
      detail: "2 de 5 falhas seguidas",
    });
    expect(describeCircuit({ kind: "closed", failures: 4 }, 8, now).detail).toBe(
      "4 de 8 falhas seguidas",
    );
  });

  it("gives the end of the pause in Brasília time and how long is left", () => {
    expect(describeCircuit({ kind: "paused", until: inSeconds(200) }, 5, now)).toEqual({
      label: "Aberto",
      detail: "pausado até 12:03:20 (em 3 min 20 s)",
    });
    expect(describeCircuit({ kind: "paused", until: inSeconds(20) }, 5, now).detail).toBe(
      "pausado até 12:00:20 (em 20 s)",
    );
  });

  it("counts the time left in whole seconds, rounding up, never in milliseconds or decimals", () => {
    const detailAt = (milliseconds: number) =>
      describeCircuit({ kind: "paused", until: new Date(now.getTime() + milliseconds) }, 5, now)
        .detail;

    expect(detailAt(857)).toBe("pausado até 12:00:00 (em 1 s)");
    expect(detailAt(9_900)).toBe("pausado até 12:00:09 (em 10 s)");
    expect(detailAt(1_000)).toBe("pausado até 12:00:01 (em 1 s)");
    expect(detailAt(1_001)).toBe("pausado até 12:00:01 (em 2 s)");
  });

  it("says the pause is over and a delivery will test the destination", () => {
    expect(describeCircuit({ kind: "waiting" }, 5, now)).toEqual({
      label: "Aberto",
      detail: "esperando a próxima entrega para testar",
    });
  });

  it("says the destination is being tested", () => {
    expect(describeCircuit({ kind: "testing" }, 5, now)).toEqual({
      label: "Meio-aberto",
      detail: "testando agora",
    });
  });

  it("says a destination is deactivated, usually after a 410", () => {
    expect(describeCircuit({ kind: "inactive", failures: 0 }, 5, now)).toEqual({
      label: "Desativado",
      detail: "em geral porque respondeu 410",
    });
  });
});

describe("trackMarks", () => {
  it("has one mark per station of the limit", () => {
    expect(trackMarks({ kind: "closed", failures: 0 }, 5)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(trackMarks({ kind: "closed", failures: 0 }, 3)).toHaveLength(3);
  });

  it("fills one station per failure in a row, from the start", () => {
    expect(trackMarks({ kind: "closed", failures: 2 }, 5)).toEqual([
      "failure",
      "failure",
      "empty",
      "empty",
      "empty",
    ]);
  });

  it("never draws more failures than stations", () => {
    expect(trackMarks({ kind: "closed", failures: 9 }, 5)).toEqual(Array(5).fill("failure"));
  });

  it("fills every station while the circuit is open, paused or waiting", () => {
    expect(trackMarks({ kind: "paused", until: now }, 5)).toEqual(Array(5).fill("failure"));
    expect(trackMarks({ kind: "waiting" }, 5)).toEqual(Array(5).fill("failure"));
  });

  it("leaves the last station half filled while testing", () => {
    expect(trackMarks({ kind: "testing" }, 5)).toEqual([
      "failure",
      "failure",
      "failure",
      "failure",
      "testing",
    ]);
  });

  it("draws no track for a deactivated destination, whatever failures it had", () => {
    expect(trackMarks({ kind: "inactive", failures: 1 }, 5)).toEqual([]);
  });
});

describe("sortByTrouble", () => {
  it("puts the worst first: open or testing, then deactivated, then with failures, then healthy", () => {
    const sorted = sortByTrouble(
      [
        destination("healthy"),
        destination("failures", "closed", 2),
        destination("inactive", "closed", 0, { isActive: false }),
        destination("testing", "half_open", 5),
        destination("open", "open", 5, { pausedUntil: inSeconds(60) }),
      ],
      now,
    );

    expect(sorted.map((item) => item.id)).toEqual([
      "testing",
      "open",
      "inactive",
      "failures",
      "healthy",
    ]);
  });

  it("keeps the order it came in among equals", () => {
    const sorted = sortByTrouble([destination("c"), destination("a"), destination("b")], now);

    expect(sorted.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("does not change the list it was given", () => {
    const list = [destination("healthy"), destination("testing", "half_open", 5)];

    sortByTrouble(list, now);

    expect(list.map((item) => item.id)).toEqual(["healthy", "testing"]);
  });

  it("counts an open circuit whose pause is over as trouble, like a paused one", () => {
    const sorted = sortByTrouble(
      [destination("failures", "closed", 4), destination("waiting", "open", 5)],
      now,
    );

    expect(sorted.map((item) => item.id)).toEqual(["waiting", "failures"]);
  });
});

describe("needsCircuitWatch", () => {
  it("is false when every circuit is closed", () => {
    expect(needsCircuitWatch([destination("a"), destination("b", "closed", 4)], now)).toBe(false);
  });

  it("is true while one circuit is open, waiting or half open", () => {
    expect(
      needsCircuitWatch(
        [destination("a"), destination("b", "open", 5, { pausedUntil: inSeconds(10) })],
        now,
      ),
    ).toBe(true);
    expect(needsCircuitWatch([destination("a", "open", 5)], now)).toBe(true);
    expect(needsCircuitWatch([destination("a", "half_open", 5)], now)).toBe(true);
  });

  it("ignores a deactivated destination, even with an open circuit", () => {
    expect(needsCircuitWatch([destination("a", "open", 5, { isActive: false })], now)).toBe(false);
  });

  it("is false with no destination", () => {
    expect(needsCircuitWatch([], now)).toBe(false);
  });
});

describe("describeCircuits", () => {
  it("counts the circuits by state, worst first, and joins paused and waiting as open", () => {
    expect(
      describeCircuits(
        [
          destination("a"),
          destination("b", "closed", 3),
          destination("c", "open", 5, { pausedUntil: inSeconds(10) }),
          destination("d", "open", 5),
          destination("e", "half_open", 5),
          destination("f", "open", 5, { isActive: false }),
        ],
        now,
      ),
    ).toBe("circuitos: 2 abertos, 1 meio-aberto, 2 fechados, 1 desativado");
  });

  it("says the singular and leaves out the states nobody is in", () => {
    expect(describeCircuits([destination("a", "open", 5)], now)).toBe("circuitos: 1 aberto");
  });

  it("says there is no destination when the list is empty", () => {
    expect(describeCircuits([], now)).toBe("circuitos: nenhum destino");
  });

  it("is the same when an open circuit goes from paused to waiting, which looks the same to the eye", () => {
    const paused = describeCircuits(
      [destination("a", "open", 5, { pausedUntil: inSeconds(1) })],
      now,
    );
    const waiting = describeCircuits(
      [destination("a", "open", 5, { pausedUntil: inSeconds(-1) })],
      now,
    );

    expect(waiting).toBe(paused);
  });
});

describe("describeEventTypes", () => {
  it("says all events for the wildcard, even next to other types", () => {
    expect(describeEventTypes(["*"])).toBe("todos os eventos");
    expect(describeEventTypes(["push", "*"])).toBe("todos os eventos");
  });

  it("lists the types it was subscribed to", () => {
    expect(describeEventTypes(["invoice.paid", "push"])).toBe("invoice.paid, push");
  });

  it("says none when it is subscribed to nothing", () => {
    expect(describeEventTypes([])).toBe("nenhum evento");
  });
});
