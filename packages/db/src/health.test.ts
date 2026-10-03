import { describe, expect, it, vi } from "vitest";
import { checkDatabase, checkQueue } from "./health.js";

describe("checkDatabase", () => {
  it("reports ok when the query succeeds", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };

    expect(await checkDatabase(db)).toEqual({ status: "ok" });
  });

  it("returns the error instead of throwing when the query fails", async () => {
    const failure = new Error("connection refused");
    const db = { $queryRaw: vi.fn().mockRejectedValue(failure) };

    expect(await checkDatabase(db)).toEqual({ status: "error", error: failure });
  });
});

describe("checkQueue", () => {
  it("reports ok with the number of deliveries waiting", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ depth: 7 }]) };

    expect(await checkQueue(db)).toEqual({ status: "ok", depth: 7 });
  });

  it("returns the error instead of throwing when the query fails", async () => {
    const failure = new Error('relation "delivery" does not exist');
    const db = { $queryRaw: vi.fn().mockRejectedValue(failure) };

    expect(await checkQueue(db)).toEqual({ status: "error", error: failure });
  });
});
