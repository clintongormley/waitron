import { describe, expect, it } from "vitest";
import { calendarCutAnchor, cutToOwnDay } from "./calendar-cut.js";

const day = (dayCutover: string, endMinute = 1440) => ({ dayCutover, endMinute });
const range = (startsAt: string, endsAt: string) => ({ periodId: "dinner", startsAt, endsAt });

describe("cutToOwnDay", () => {
  it("cuts a range placed by the start in force at the day's own changeover", () => {
    expect(cutToOwnDay(range("22:00", "04:30"), day("03:00"), "05:00")).toEqual(
      range("22:00", "03:00"),
    );
  });
  it("cuts a range placed by the start in force at the day's own start", () => {
    expect(cutToOwnDay(range("06:00", "08:00"), day("07:00"), "05:00")).toEqual(
      range("07:00", "08:00"),
    );
  });
  it("cuts a whole day from the start in force to the day's own whole day", () => {
    expect(cutToOwnDay(range("05:00", "05:00"), day("03:00"), "05:00")).toEqual(
      range("05:00", "03:00"),
    );
  });
  it("returns a range fitting the day's own start as the same object", () => {
    const fitting = range("09:00", "17:00");
    expect(cutToOwnDay(fitting, day("05:00"), "03:00")).toBe(fitting);
  });
  it("returns a whole day from the day's own start as the same object", () => {
    const whole = range("03:00", "03:00");
    expect(cutToOwnDay(whole, day("03:00"), "05:00")).toBe(whole);
  });
  it("returns a range fitting neither start unchanged", () => {
    const neither = range("02:00", "06:00");
    expect(cutToOwnDay(neither, day("03:00"), "05:00")).toBe(neither);
  });
  it("gives nothing when no part of the range falls in the day", () => {
    expect(cutToOwnDay(range("02:30", "03:30"), day("03:00", 1380), "05:00")).toBeNull();
  });
  it("cuts at a shorter day's end", () => {
    expect(cutToOwnDay(range("22:00", "04:30"), day("03:00", 1380), "05:00")).toEqual(
      range("22:00", "02:00"),
    );
  });
});

describe("calendarCutAnchor", () => {
  const clock = {
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    cutoverChanges: [
      { effectiveBusinessDay: "2026-10-21", dayCutover: "03:00" },
      { effectiveBusinessDay: "2026-10-28", dayCutover: "05:00" },
    ],
  };
  it("is the start in force at the moment read", () => {
    expect(calendarCutAnchor(clock, new Date("2026-10-24T12:00:00Z"))).toBe("03:00");
    expect(calendarCutAnchor(clock, new Date("2026-11-02T12:00:00Z"))).toBe("05:00");
  });
  it("is the venue's first start when the current day cannot be read", () => {
    expect(
      calendarCutAnchor({ ...clock, timeZone: "Mars/Olympus" }, new Date("2026-10-24T12:00:00Z")),
    ).toBe("05:00");
  });
});
