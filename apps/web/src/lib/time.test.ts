import { describe, expect, it } from "vitest";
import { describeAge, describeWait, formatEventTime, formatMinutes } from "./time";

describe("formatEventTime", () => {
  it("shows the time in Brasília, not in UTC", () => {
    const time = formatEventTime(new Date("2026-10-03T15:00:05Z"));

    expect(time.clock).toBe("12:00:05");
    expect(time.dayMonth).toBe("03/10");
  });

  it("moves the day back when UTC is already past midnight", () => {
    const time = formatEventTime(new Date("2026-10-04T02:30:00Z"));

    expect(time.dayMonth).toBe("03/10");
    expect(time.clock).toBe("23:30:00");
  });

  it("gives the full date with the year and the zone name", () => {
    expect(formatEventTime(new Date("2026-10-03T15:00:05Z")).full).toBe("03/10/2026 12:00:05 BRT");
  });
});

describe("describeAge", () => {
  const now = new Date("2026-10-03T15:00:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it("says now for the first seconds, and for a time slightly in the future", () => {
    expect(describeAge(ago(10), now)).toBe("agora");
    expect(describeAge(ago(-30), now)).toBe("agora");
  });

  it("counts minutes, hours and days", () => {
    expect(describeAge(ago(180), now)).toBe("há 3 min");
    expect(describeAge(ago(2 * 3600), now)).toBe("há 2 h");
    expect(describeAge(ago(3 * 86400), now)).toBe("há 3 dias");
  });

  it("changes unit at the boundary instead of showing 60 minutes", () => {
    expect(describeAge(ago(59 * 60), now)).toBe("há 59 min");
    expect(describeAge(ago(60 * 60), now)).toBe("há 1 h");
  });
});

describe("describeWait", () => {
  const now = new Date("2026-10-03T15:00:00Z");
  const ahead = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  it("says now when the moment is close or already passed", () => {
    expect(describeWait(ahead(20), now)).toBe("agora");
    expect(describeWait(ahead(-300), now)).toBe("agora");
  });

  it("counts minutes, hours and days ahead", () => {
    expect(describeWait(ahead(180), now)).toBe("em 3 min");
    expect(describeWait(ahead(2 * 3600), now)).toBe("em 2 h");
    expect(describeWait(ahead(3 * 86400), now)).toBe("em 3 dias");
  });
});

describe("formatMinutes", () => {
  it("shows hours and minutes in Brasília time, without seconds", () => {
    expect(formatMinutes(new Date("2026-10-03T17:00:59Z"))).toBe("14:00");
  });

  it("uses two digits for the hour and goes from 23:59 to 00:00", () => {
    expect(formatMinutes(new Date("2026-10-03T12:05:00Z"))).toBe("09:05");
    expect(formatMinutes(new Date("2026-10-04T03:00:00Z"))).toBe("00:00");
  });
});
