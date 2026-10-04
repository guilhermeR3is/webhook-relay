import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeTestEventFailure, sendTestEvent } from "./test-event";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function urlOf(input: Parameters<typeof fetch>[0] | undefined) {
  if (input instanceof URL) return input.href;
  if (typeof input === "string") return input;
  return input?.url;
}

function answer(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

describe("sendTestEvent, what it sends", () => {
  it("posts to the test event route of the API, with no body and no headers of its own", async () => {
    answer(201, { eventId: "e1" });

    await sendTestEvent("https://api.example.com");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe("https://api.example.com/panel/test-event");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
  });

  it("does not send cookies or reuse a cached answer, and gives up after a while", async () => {
    answer(201, { eventId: "e1" });

    await sendTestEvent("http://localhost:3000");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.credentials).toBe("omit");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the path when the API address has a trailing slash", async () => {
    answer(201, { eventId: "e1" });

    await sendTestEvent("http://localhost:3000/");

    expect(urlOf(fetchMock.mock.calls[0]?.[0])).toBe("http://localhost:3000/panel/test-event");
  });
});

describe("sendTestEvent, what it answers", () => {
  it("gives the id of the event that was created", async () => {
    answer(201, { eventId: "0199a3b4", quota: { ip: { used: 1 } } });

    await expect(sendTestEvent("http://x")).resolves.toEqual({ kind: "sent", eventId: "0199a3b4" });
  });

  it("gives the scope, the limit and when to come back when the quota is over", async () => {
    answer(429, {
      error: "quota_exceeded",
      scope: "ip",
      limit: 5,
      retryAt: "2026-10-03T17:00:00.000Z",
    });

    await expect(sendTestEvent("http://x")).resolves.toEqual({
      kind: "quota",
      scope: "ip",
      limit: 5,
      retryAt: new Date("2026-10-03T17:00:00.000Z"),
    });
  });

  it("tells the global quota from the visitor quota", async () => {
    answer(429, {
      error: "quota_exceeded",
      scope: "global",
      limit: 200,
      retryAt: "2026-10-04T00:00:00.000Z",
    });

    await expect(sendTestEvent("http://x")).resolves.toMatchObject({
      kind: "quota",
      scope: "global",
    });
  });

  it.each([502, 503, 504])(
    "says the API is unavailable on %i, the status of a service that is waking up",
    async (status) => {
      answer(status, "bad gateway");

      await expect(sendTestEvent("http://x")).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it("says the API is unavailable when the request fails or runs out of time", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(sendTestEvent("http://x")).resolves.toEqual({ kind: "unavailable" });
  });

  it.each([
    ["404", 404, { error: "demo_endpoint_not_found" }],
    ["500", 500, { error: "boom" }],
    ["400", 400, "not json"],
  ])("reports the code of a %s that is not a quota refusal", async (_name, status, body) => {
    answer(status, body);

    await expect(sendTestEvent("http://x")).resolves.toEqual({ kind: "failed", status });
  });

  it("does not take a 201 without an id, or a 429 in another shape, as a success or a quota", async () => {
    answer(201, { created: true });
    await expect(sendTestEvent("http://x")).resolves.toEqual({ kind: "failed", status: 201 });

    answer(429, { error: "slow_down" });
    await expect(sendTestEvent("http://x")).resolves.toEqual({ kind: "failed", status: 429 });

    answer(429, {
      error: "quota_exceeded",
      scope: "elsewhere",
      limit: 5,
      retryAt: "2026-10-03T17:00:00Z",
    });
    await expect(sendTestEvent("http://x")).resolves.toEqual({ kind: "failed", status: 429 });
  });
});

describe("describeTestEventFailure", () => {
  it("says how many the visitor sent in the hour and when to try again, in Brasília time", () => {
    const text = describeTestEventFailure({
      kind: "quota",
      scope: "ip",
      limit: 5,
      retryAt: new Date("2026-10-03T17:00:00Z"),
    });

    expect(text).toBe("Você já enviou 5 eventos de teste nesta hora. Tente de novo às 14:00.");
  });

  it("uses the singular when the limit is one", () => {
    const text = describeTestEventFailure({
      kind: "quota",
      scope: "ip",
      limit: 1,
      retryAt: new Date("2026-10-03T17:00:00Z"),
    });

    expect(text).toContain("Você já enviou 1 evento de teste nesta hora");
  });

  it("says the limit of the day was reached and to come back tomorrow", () => {
    const text = describeTestEventFailure({
      kind: "quota",
      scope: "global",
      limit: 200,
      retryAt: new Date("2026-10-04T00:00:00Z"),
    });

    expect(text).toBe("O limite de 200 eventos de teste por dia foi atingido. Volta amanhã.");
  });

  it("says the API did not answer", () => {
    expect(describeTestEventFailure({ kind: "unavailable" })).toBe(
      "A API não respondeu. Tente de novo.",
    );
  });

  it("gives the code of any other failure", () => {
    expect(describeTestEventFailure({ kind: "failed", status: 500 })).toBe(
      "Não foi possível enviar o evento de teste (código 500).",
    );
  });
});
