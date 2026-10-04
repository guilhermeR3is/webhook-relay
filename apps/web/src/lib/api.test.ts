import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError, apiFetch } from "./api";

const fetchMock = vi.fn<typeof fetch>();

function answer(status: number, body?: unknown) {
  return Promise.resolve(
    new Response(body === undefined ? "not json" : JSON.stringify(body), { status }),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test:3000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("apiFetch", () => {
  it("asks the configured API, never from a cache, with a time limit, and returns the JSON", async () => {
    fetchMock.mockReturnValue(answer(200, { events: [] }));

    const body = await apiFetch("/panel/events?limit=2");

    expect(body).toEqual({ events: [] });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url instanceof URL ? url.href : url).toBe("http://api.test:3000/panel/events?limit=2");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes the method and body of an action through", async () => {
    fetchMock.mockReturnValue(answer(200, { resent: true }));

    await apiFetch("/panel/deliveries/abc/resend", { method: "POST" });

    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("says the API is unavailable when the connection fails or times out", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));

    await expect(apiFetch("/panel/events")).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(apiFetch("/panel/events")).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it.each([502, 503, 504])("says the API is unavailable when it answers %i", async (status) => {
    fetchMock.mockReturnValue(answer(status, { error: "bad_gateway" }));

    await expect(apiFetch("/panel/events")).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("keeps the status and the error code of a refusal", async () => {
    fetchMock.mockReturnValue(answer(409, { error: "delivery_not_dead" }));

    await expect(apiFetch("/panel/deliveries/abc/resend")).rejects.toMatchObject({
      status: 409,
      code: "delivery_not_dead",
    });
  });

  it("uses a fixed code when a refusal has no readable body", async () => {
    fetchMock.mockReturnValue(answer(500));

    const failure: unknown = await apiFetch("/panel/events").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 500, code: "unknown" });
  });

  it("refuses a success answer that is not JSON", async () => {
    fetchMock.mockReturnValue(answer(200));

    await expect(apiFetch("/panel/events")).rejects.toMatchObject({
      status: 200,
      code: "invalid_response",
    });
  });
});
