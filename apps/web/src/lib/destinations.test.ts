import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { fetchDestinations } from "./destinations";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

const destination = {
  id: "x1",
  displayUrl: "https://hooks.example.com/webhook/…",
  isActive: true,
  eventTypes: ["*"],
  circuit: {
    state: "open",
    consecutiveFailures: 5,
    since: "2026-10-04T15:00:00.000Z",
    pausedUntil: "2026-10-04T15:05:00.000Z",
  },
  deliveries: { dead: 1, pending: 2, in_progress: 0, succeeded: 3 },
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("fetchDestinations", () => {
  it("asks for the destinations and turns the circuit dates into Dates", async () => {
    apiFetchMock.mockResolvedValue({ failureThreshold: 5, destinations: [destination] });

    const list = await fetchDestinations();

    expect(apiFetchMock).toHaveBeenCalledWith("/panel/destinations");
    expect(list.failureThreshold).toBe(5);
    expect(list.destinations[0]?.circuit.since).toEqual(new Date("2026-10-04T15:00:00.000Z"));
    expect(list.destinations[0]?.circuit.pausedUntil).toEqual(new Date("2026-10-04T15:05:00.000Z"));
  });

  it("keeps the dates that do not exist as null", async () => {
    apiFetchMock.mockResolvedValue({
      failureThreshold: 5,
      destinations: [
        {
          ...destination,
          circuit: { ...destination.circuit, state: "closed", since: null, pausedUntil: null },
        },
      ],
    });

    const list = await fetchDestinations();

    expect(list.destinations[0]?.circuit.since).toBeNull();
    expect(list.destinations[0]?.circuit.pausedUntil).toBeNull();
  });

  it("accepts a list with no destination", async () => {
    apiFetchMock.mockResolvedValue({ failureThreshold: 5, destinations: [] });

    await expect(fetchDestinations()).resolves.toEqual({ failureThreshold: 5, destinations: [] });
  });

  it.each([
    ["a missing threshold", { destinations: [destination] }],
    ["a threshold of zero", { failureThreshold: 0, destinations: [destination] }],
    [
      "a circuit state it does not know",
      {
        failureThreshold: 5,
        destinations: [{ ...destination, circuit: { ...destination.circuit, state: "broken" } }],
      },
    ],
    [
      "a negative failure count",
      {
        failureThreshold: 5,
        destinations: [
          { ...destination, circuit: { ...destination.circuit, consecutiveFailures: -1 } },
        ],
      },
    ],
    [
      "a missing delivery count",
      { failureThreshold: 5, destinations: [{ ...destination, deliveries: { dead: 1 } }] },
    ],
    [
      "a flag that is not a boolean",
      { failureThreshold: 5, destinations: [{ ...destination, isActive: "yes" }] },
    ],
  ])("refuses an answer with %s", async (_name, broken) => {
    apiFetchMock.mockResolvedValue(broken);

    await expect(fetchDestinations()).rejects.toThrow();
  });
});
