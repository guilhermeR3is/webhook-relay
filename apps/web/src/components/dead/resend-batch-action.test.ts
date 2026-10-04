import { revalidatePath } from "next/cache";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resendDeliveries, type BatchResendResult } from "@/lib/resend";
import { resendBatchAction } from "./resend-batch-action";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/resend", () => ({ resendDeliveries: vi.fn() }));

const resendMock = vi.mocked(resendDeliveries);
const revalidateMock = vi.mocked(revalidatePath);

afterEach(() => {
  resendMock.mockReset();
  revalidateMock.mockReset();
});

describe("resendBatchAction", () => {
  it("resends the ids it was given and returns the result", async () => {
    const done: BatchResendResult = { kind: "done", resent: ["d1"], skipped: [] };
    resendMock.mockResolvedValue(done);

    await expect(resendBatchAction(["d1", "d2"])).resolves.toEqual(done);
    expect(resendMock).toHaveBeenCalledWith(["d1", "d2"]);
  });

  it("reloads the list after a batch, even when some were skipped", async () => {
    resendMock.mockResolvedValue({
      kind: "done",
      resent: [],
      skipped: [{ id: "d1", reason: "not_dead" }],
    });

    await resendBatchAction(["d1"]);

    expect(revalidateMock).toHaveBeenCalledWith("/dead");
  });

  it("does not reload the page when the API is unavailable", async () => {
    resendMock.mockResolvedValue({ kind: "unavailable" });

    await resendBatchAction(["d1"]);

    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("lets an unexpected error through without reloading", async () => {
    resendMock.mockRejectedValue(new Error("boom"));

    await expect(resendBatchAction(["d1"])).rejects.toThrow("boom");
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
