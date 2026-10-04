import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { fetchEventDetail } from "./event-detail";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

const payload = {
  id: "0199a3b4-7c1e-7a52-9d3f-2b8e4c6a1f07",
  eventType: "invoice.paid",
  idempotencyKey: "order-1001",
  receivedAt: "2026-10-03T15:00:05.000Z",
  headers: { "content-type": "application/json" },
  body: { size: 13, text: '{"amount":10}', truncated: false },
  deliveries: [
    {
      id: "d1",
      status: "dead",
      attemptCount: 8,
      nextAttemptAt: "2026-10-03T15:20:00.000Z",
      lastError: "gave up after 8 attempts",
      succeededAt: null,
      createdAt: "2026-10-03T15:00:05.000Z",
      destination: { id: "x1", displayUrl: "https://hooks.example.com/webhook/…" },
      sequences: [
        {
          number: 1,
          resentAt: null,
          attempts: [
            {
              id: "a1",
              startedAt: "2026-10-03T15:00:06.000Z",
              durationMs: 120,
              httpStatus: 503,
              responseSnippet: "unavailable",
              error: null,
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("fetchEventDetail", () => {
  it("asks for the event by id, escaping it, and turns the date texts into Dates", async () => {
    apiFetchMock.mockResolvedValue(payload);

    const event = await fetchEventDetail("a/b c");

    expect(apiFetchMock).toHaveBeenCalledWith("/panel/events/a%2Fb%20c");
    expect(event.receivedAt).toEqual(new Date("2026-10-03T15:00:05.000Z"));
    expect(event.deliveries[0]?.sequences[0]?.attempts[0]?.startedAt).toEqual(
      new Date("2026-10-03T15:00:06.000Z"),
    );
  });

  it("keeps a missing success time as null instead of turning it into 1970", async () => {
    apiFetchMock.mockResolvedValue(payload);

    const event = await fetchEventDetail("x");

    expect(event.deliveries[0]?.succeededAt).toBeNull();
  });

  it.each([
    [
      "a status the panel does not know",
      { deliveries: [{ ...payload.deliveries[0], status: "archived" }] },
    ],
    ["a body without its size", { body: { text: "x", truncated: false } }],
    ["a header that is not text", { headers: { "content-type": 5 } }],
    [
      "a sequence number of zero",
      {
        deliveries: [
          { ...payload.deliveries[0], sequences: [{ number: 0, resentAt: null, attempts: [] }] },
        ],
      },
    ],
  ])("refuses an answer with %s", async (_name, broken) => {
    apiFetchMock.mockResolvedValue({ ...payload, ...broken });

    await expect(fetchEventDetail("x")).rejects.toThrow();
  });
});
