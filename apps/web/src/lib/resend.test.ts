import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError, apiFetch } from "./api";
import { resendDeliveries, resendDelivery } from "./resend";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  apiFetchMock.mockReset();
});

describe("resendDelivery", () => {
  it("posts to the resend route of that delivery, with the id escaped", async () => {
    apiFetchMock.mockResolvedValue({ resent: true });

    await resendDelivery("a/b c");

    expect(apiFetchMock).toHaveBeenCalledWith("/panel/deliveries/a%2Fb%20c/resend", {
      method: "POST",
    });
  });

  it("says it was resent when the API accepts", async () => {
    apiFetchMock.mockResolvedValue({ resent: true });

    await expect(resendDelivery("d1")).resolves.toBe("resent");
  });

  it.each([
    ["delivery_not_dead", "not_dead"],
    ["destination_inactive", "destination_inactive"],
    ["delivery_not_found", "not_found"],
  ])("turns the %s refusal into %s", async (code, expected) => {
    apiFetchMock.mockRejectedValue(new ApiError(409, code));

    await expect(resendDelivery("d1")).resolves.toBe(expected);
  });

  it("says the API is unavailable when it does not answer", async () => {
    apiFetchMock.mockRejectedValue(new ApiUnavailableError("down"));

    await expect(resendDelivery("d1")).resolves.toBe("unavailable");
  });

  it("lets an error it does not know reach the error screen", async () => {
    apiFetchMock.mockRejectedValue(new ApiError(500, "unknown"));

    await expect(resendDelivery("d1")).rejects.toMatchObject({ status: 500 });
  });

  it("does not take a code that only exists on every object for a refusal", async () => {
    apiFetchMock.mockRejectedValue(new ApiError(409, "constructor"));

    await expect(resendDelivery("d1")).rejects.toMatchObject({ code: "constructor" });
  });

  it("refuses an answer that is not the one the API promises", async () => {
    apiFetchMock.mockResolvedValue({ resent: false });

    await expect(resendDelivery("d1")).rejects.toThrow();
  });
});

describe("resendDeliveries", () => {
  it("posts the ids as JSON to the batch route", async () => {
    apiFetchMock.mockResolvedValue({ resent: ["d1", "d2"], skipped: [] });

    await resendDeliveries(["d1", "d2"]);

    expect(apiFetchMock).toHaveBeenCalledWith("/panel/dead-deliveries/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deliveryIds: ["d1", "d2"] }),
    });
  });

  it("gives back what was resent and what was skipped, with the reason", async () => {
    apiFetchMock.mockResolvedValue({
      resent: ["d1"],
      skipped: [
        { id: "d2", reason: "destination_inactive" },
        { id: "d3", reason: "not_dead" },
        { id: "d4", reason: "not_found" },
      ],
    });

    await expect(resendDeliveries(["d1", "d2", "d3", "d4"])).resolves.toEqual({
      kind: "done",
      resent: ["d1"],
      skipped: [
        { id: "d2", reason: "destination_inactive" },
        { id: "d3", reason: "not_dead" },
        { id: "d4", reason: "not_found" },
      ],
    });
  });

  it("says the API is unavailable when it does not answer", async () => {
    apiFetchMock.mockRejectedValue(new ApiUnavailableError("down"));

    await expect(resendDeliveries(["d1"])).resolves.toEqual({ kind: "unavailable" });
  });

  it("lets a refusal of the whole request reach the error screen", async () => {
    apiFetchMock.mockRejectedValue(new ApiError(400, "invalid_body"));

    await expect(resendDeliveries(["d1"])).rejects.toMatchObject({ code: "invalid_body" });
  });

  it("refuses a reason it does not know and an answer that is not the promised one", async () => {
    apiFetchMock.mockResolvedValue({ resent: [], skipped: [{ id: "d1", reason: "because" }] });
    await expect(resendDeliveries(["d1"])).rejects.toThrow();

    apiFetchMock.mockResolvedValue({ resent: true });
    await expect(resendDeliveries(["d1"])).rejects.toThrow();
  });
});
