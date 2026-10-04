import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { EVENTS_PAGE_SIZE, fetchEvents } from "./events";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

const event = {
  id: "0199a3b4-7c1e-7a52-9d3f-2b8e4c6a1f07",
  eventType: "invoice.paid",
  idempotencyKey: "order-1001",
  receivedAt: "2026-10-03T15:00:05.123Z",
  deliveries: { dead: 1, pending: 0, in_progress: 0, succeeded: 2 },
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("fetchEvents", () => {
  it("asks for one page and turns the date text into a Date", async () => {
    apiFetchMock.mockResolvedValue({ events: [event], nextCursor: "next" });

    const page = await fetchEvents({});

    expect(apiFetchMock).toHaveBeenCalledWith(`/panel/events?limit=${String(EVENTS_PAGE_SIZE)}`);
    expect(page.nextCursor).toBe("next");
    expect(page.events[0]?.receivedAt).toEqual(new Date("2026-10-03T15:00:05.123Z"));
  });

  it("sends the filters it was given and nothing else", async () => {
    apiFetchMock.mockResolvedValue({ events: [], nextCursor: null });

    await fetchEvents({ status: "dead", search: "a&b", cursor: "c1" });

    const [path] = apiFetchMock.mock.calls[0] ?? [];
    const params = new URL(path ?? "", "http://x").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      limit: String(EVENTS_PAGE_SIZE),
      status: "dead",
      search: "a&b",
      cursor: "c1",
    });
  });

  it.each([
    ["a negative count", { ...event, deliveries: { ...event.deliveries, dead: -1 } }],
    ["a missing count", { ...event, deliveries: { dead: 1 } }],
    ["a date that is not a date", { ...event, receivedAt: "yesterday" }],
  ])("refuses an answer with %s", async (_name, broken) => {
    apiFetchMock.mockResolvedValue({ events: [broken], nextCursor: null });

    await expect(fetchEvents({})).rejects.toThrow();
  });

  it("refuses an answer that is not a page", async () => {
    apiFetchMock.mockResolvedValue({ items: [] });

    await expect(fetchEvents({})).rejects.toThrow();
  });
});
