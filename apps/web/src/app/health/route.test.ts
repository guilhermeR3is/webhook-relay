import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /health", () => {
  it("answers 200 without asking the API anything", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
