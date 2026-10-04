import { describe, expect, it } from "vitest";
import { loadChaosEnv, loadReceiverEnv, loadSeedEnv } from "./env.ts";

const validSeedEnv = {
  DATABASE_URL: "postgresql://relay:relay@localhost:5433/relay",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("loadReceiverEnv", () => {
  it("answers on port 4000 without delay by default", () => {
    expect(loadReceiverEnv({})).toEqual({ RECEIVER_PORT: 4000, RECEIVER_DELAY_MS: 0 });
  });

  it("reads the port and the delay as numbers and refuses a negative delay", () => {
    expect(loadReceiverEnv({ RECEIVER_PORT: "4100", RECEIVER_DELAY_MS: "250" })).toEqual({
      RECEIVER_PORT: 4100,
      RECEIVER_DELAY_MS: 250,
    });
    expect(() => loadReceiverEnv({ RECEIVER_DELAY_MS: "-1" })).toThrow(/RECEIVER_DELAY_MS/);
  });
});

describe("loadSeedEnv", () => {
  it("points the destination at the receiver of the compose by default", () => {
    expect(loadSeedEnv(validSeedEnv).LOAD_DESTINATION_URL).toBe("http://receiver:4000/hook");
  });

  it("rejects a missing database url and an encryption key that is not 32 bytes", () => {
    expect(() => loadSeedEnv({ ENCRYPTION_KEY: validSeedEnv.ENCRYPTION_KEY })).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      loadSeedEnv({ ...validSeedEnv, ENCRYPTION_KEY: Buffer.alloc(8).toString("base64") }),
    ).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("loadChaosEnv", () => {
  it("kills the worker 45 seconds into a two-minute load by default", () => {
    expect(loadChaosEnv(validSeedEnv)).toMatchObject({
      CHAOS_RATE: 200,
      CHAOS_DURATION_SECONDS: 120,
      CHAOS_KILL_AFTER_SECONDS: 45,
      CHAOS_DOWN_SECONDS: 10,
      CHAOS_RECEIVER_DELAY_MS: 100,
    });
  });

  it("refuses to kill the worker after the load has already ended", () => {
    expect(() =>
      loadChaosEnv({
        ...validSeedEnv,
        CHAOS_DURATION_SECONDS: "30",
        CHAOS_KILL_AFTER_SECONDS: "30",
      }),
    ).toThrow(/CHAOS_KILL_AFTER_SECONDS/);
  });
});
