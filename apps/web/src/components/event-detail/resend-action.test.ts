import { revalidatePath } from "next/cache";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resendDelivery } from "@/lib/resend";
import { resendDeliveryAction } from "./resend-action";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/resend", () => ({ resendDelivery: vi.fn() }));

const resendMock = vi.mocked(resendDelivery);
const revalidateMock = vi.mocked(revalidatePath);

afterEach(() => {
  resendMock.mockReset();
  revalidateMock.mockReset();
});

describe("resendDeliveryAction", () => {
  it("resends the delivery it was given and returns the result", async () => {
    resendMock.mockResolvedValue("resent");

    await expect(resendDeliveryAction("d1")).resolves.toBe("resent");
    expect(resendMock).toHaveBeenCalledWith("d1");
  });

  it.each(["resent", "not_dead", "destination_inactive", "not_found"] as const)(
    "reloads the event pages after %s, because what the page shows changed or is stale",
    async (result) => {
      resendMock.mockResolvedValue(result);

      await resendDeliveryAction("d1");

      expect(revalidateMock).toHaveBeenCalledWith("/events/[eventId]", "page");
    },
  );

  it("does not reload the page when the API is unavailable", async () => {
    resendMock.mockResolvedValue("unavailable");

    await resendDeliveryAction("d1");

    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("lets an unexpected error through without reloading", async () => {
    resendMock.mockRejectedValue(new Error("boom"));

    await expect(resendDeliveryAction("d1")).rejects.toThrow("boom");
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
