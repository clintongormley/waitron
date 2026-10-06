import { describe, expect, it } from "vitest";
import { venueLocalMoment } from "./hours-clock.js";

const madrid = { timeZone: "Europe/Madrid", dayCutover: "06:00" };

describe("venueLocalMoment", () => {
  it("carries the calendar date beside the business day, which still belongs to the night before", () => {
    // Monday 5 October 2026 at 00:30 in Madrid.
    expect(venueLocalMoment(new Date("2026-10-04T22:30:00Z"), madrid)).toEqual({
      civilDate: "2026-10-05",
      weekday: 1,
      timeOfDay: "00:30",
      businessDay: "2026-10-04",
    });
  });

  it("numbers Sunday 0 and Monday 1", () => {
    expect(venueLocalMoment(new Date("2026-10-04T10:00:00Z"), madrid)).toMatchObject({
      civilDate: "2026-10-04",
      weekday: 0,
    });
    expect(venueLocalMoment(new Date("2026-10-05T10:00:00Z"), madrid)).toMatchObject({
      civilDate: "2026-10-05",
      weekday: 1,
    });
  });

  it("answers null for a zone or cutover it cannot read", () => {
    expect(venueLocalMoment(new Date(), { timeZone: "Mars/Base", dayCutover: "06:00" })).toBeNull();
    expect(
      venueLocalMoment(new Date(), { timeZone: "Europe/Madrid", dayCutover: "6am" }),
    ).toBeNull();
  });
});
