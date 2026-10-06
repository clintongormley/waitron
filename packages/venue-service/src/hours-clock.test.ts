import { describe, expect, it } from "vitest";
import { clockChangesBetween, localTimeOccurrences, venueLocalMoment } from "./hours-clock.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";

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

describe("local times on a clock-change day", () => {
  const zone = "Europe/Madrid";
  const forward = clockChangeAfter(zone, "2027-01-01T00:00:00Z", "forward");
  const backward = clockChangeAfter(zone, "2026-07-01T00:00:00Z", "backward");

  it("finds no instant for a minute the clock skips, and one either side of the gap", () => {
    const skipped = minutesAfter(forward.before, 1);
    expect(localTimeOccurrences(forward.date, skipped, zone)).toEqual([]);
    expect(localTimeOccurrences(forward.date, forward.after, zone)).toEqual([forward.instant]);
    expect(localTimeOccurrences(forward.date, forward.before, zone)).toEqual([
      new Date(forward.instant.getTime() - 60_000),
    ]);
  });

  it("finds both instants of a minute the clock repeats, earlier first", () => {
    const repeated = minutesAfter(backward.after, 1);
    const occurrences = localTimeOccurrences(backward.date, repeated, zone);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[1]!.getTime() - occurrences[0]!.getTime()).toBe(
      backward.deltaMinutes * 60_000,
    );
    for (const instant of occurrences)
      expect(venueLocalMoment(instant, madrid)).toMatchObject({
        civilDate: backward.date,
        timeOfDay: repeated,
      });
  });

  it("lists the instants the clock changes between two instants, and none on an ordinary day", () => {
    expect(
      clockChangesBetween(
        new Date(forward.instant.getTime() - 86_400_000),
        new Date(forward.instant.getTime() + 86_400_000),
        zone,
      ),
    ).toEqual([forward.instant]);
    expect(
      clockChangesBetween(
        new Date(backward.instant.getTime() - 3 * 86_400_000),
        new Date(backward.instant.getTime() + 86_400_000),
        zone,
      ),
    ).toEqual([backward.instant]);
    expect(
      clockChangesBetween(new Date("2026-10-05T00:00:00Z"), new Date("2026-10-12T00:00:00Z"), zone),
    ).toEqual([]);
  });
});
