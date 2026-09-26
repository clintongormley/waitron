import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  businessDayClause,
  businessDayOf,
  businessDayRangeWindow,
  businessDayStart,
  businessDayWindow,
  currentBusinessDay,
  validateBusinessDay,
  validateCutover,
  validateTimeZone,
} from "./business-day.js";
import type { DailyCloseInput, PeriodVatInput } from "./types.js";

describe("validateTimeZone", () => {
  it("accepts a valid IANA zone", () => {
    expect(() => validateTimeZone("Europe/Madrid")).not.toThrow();
  });
  it("rejects a non-existent zone", () => {
    expect(() => validateTimeZone("Mars/Olympus")).toThrow(/time zone/i);
  });
  it("rejects UTC-offset shorthand (must be a named zone)", () => {
    expect(() => validateTimeZone("+02:00")).toThrow(/time zone/i);
  });
});

describe("validateCutover", () => {
  it("accepts a zero-padded HH:MM", () => {
    expect(() => validateCutover("05:00")).not.toThrow();
    expect(() => validateCutover("00:00")).not.toThrow();
    expect(() => validateCutover("23:59")).not.toThrow();
  });
  it.each(["5:00", "24:00", "23:60", "05:0", "0500", "05:00:00"])("rejects %s", (bad) => {
    expect(() => validateCutover(bad)).toThrow(/cutover/i);
  });
});

describe("validateBusinessDay", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(() => validateBusinessDay("2026-08-04")).not.toThrow();
  });
  it.each(["2026-8-4", "04-08-2026", "2026/08/04", "garbage"])("rejects %s", (bad) => {
    expect(() => validateBusinessDay(bad)).toThrow(/business day/i);
  });
  it.each(["2026-13-45", "2026-02-30", "2026-00-10", "2026-06-31"])(
    "rejects the well-formed but impossible date %s",
    (bad) => {
      expect(() => validateBusinessDay(bad)).toThrow(/not a real calendar date/i);
    },
  );
});

describe("businessDayRangeWindow", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

  const TZ = "Europe/Madrid";
  const CUTOVER = "05:00";

  it("a single-day range (from == to) matches the = businessDay form at a boundary instant", async () => {
    // 2026-08-04 05:00 Madrid = 2026-08-04T03:00Z is exactly the cutover; a millisecond earlier
    // belongs to the prior business day. Both clauses must agree, both directions, at that boundary.
    // Only the clock and the day(s) are read, hence the minimal cast objects.
    for (const [instant, day, expected] of [
      ["2026-08-04T03:00:00.000Z", "2026-08-04", true],
      ["2026-08-04T02:59:59.999Z", "2026-08-04", false],
    ] as const) {
      // Written the way a stored stamp is written: a timestamp column is TEXT in `toISOString()`'s
      // spelling.
      const column = sql`${instant}`;
      const dayInput = { businessDay: day, timeZone: TZ, dayCutover: CUTOVER } as DailyCloseInput;
      const rangeInput = {
        fromBusinessDay: day,
        toBusinessDay: day,
        timeZone: TZ,
        dayCutover: CUTOVER,
      } as PeriodVatInput;
      // A RAW select reaches no column mapping, so a predicate comes back as the engine's 1/0.
      const { rows } = await suite.db.execute<{ eq: 0 | 1; range: 0 | 1 }>(
        sql`select ${businessDayClause(column, dayInput)} as eq, ${businessDayRangeWindow(rangeInput)(column)} as range`,
      );
      expect(rows[0]!.range).toBe(rows[0]!.eq);
      expect(rows[0]!.range).toBe(expected ? 1 : 0);
    }
  });
});

describe("businessDayStart", () => {
  it.each([
    // 05:30 local (CET, UTC+1), before a 06:00 cutover: the day began yesterday at 06:00 local.
    ["2026-03-01T04:30:00.000Z", "2026-02-28T05:00:00.000Z"],
    // 12:00 local (CEST, UTC+2): the day began this morning at 06:00 local.
    ["2026-08-04T10:00:00.000Z", "2026-08-04T04:00:00.000Z"],
    // The cutover itself begins a day.
    ["2026-08-04T04:00:00.000Z", "2026-08-04T04:00:00.000Z"],
  ])("puts %s in the business day that began at %s", (instant, expected) => {
    expect(
      businessDayStart(new Date(instant), { timeZone: "Europe/Madrid", dayCutover: "06:00" }),
    ).toBe(expected);
  });

  // Madrid's clocks jump 02:00 → 03:00 at 2026-03-29T01:00Z and fall 03:00 → 02:00 at
  // 2026-10-25T01:00Z. A 02:30 cutover does not exist on the first day and happens twice on the
  // second; a 06:00 cutover is clear of both changes and is the control.
  describe("on the two clock-change days", () => {
    const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

    it.each([
      // 03:10 summer time, after the jump: the day that starts at the missing 02:30 has not begun.
      ["02:30", "2026-03-29T01:10:00.000Z", "2026-03-28T01:30:00.000Z"],
      // 03:40 summer time: the day that began at 01:30Z, half an hour after the jump.
      ["02:30", "2026-03-29T01:40:00.000Z", "2026-03-29T01:30:00.000Z"],
      // 02:45 summer time, before the fall back: 02:30 is still to come a second time.
      ["02:30", "2026-10-25T00:45:00.000Z", "2026-10-24T00:30:00.000Z"],
      // 02:40 winter time, after the second 02:30.
      ["02:30", "2026-10-25T01:40:00.000Z", "2026-10-25T01:30:00.000Z"],
      ["06:00", "2026-03-29T01:10:00.000Z", "2026-03-28T05:00:00.000Z"],
      ["06:00", "2026-03-29T05:00:00.000Z", "2026-03-29T04:00:00.000Z"],
      ["06:00", "2026-10-25T00:45:00.000Z", "2026-10-24T04:00:00.000Z"],
      ["06:00", "2026-10-25T05:00:00.000Z", "2026-10-25T05:00:00.000Z"],
    ])(
      "with a %s cutover, %s is in the day the daily close starts at %s",
      async (dayCutover, instant, expected) => {
        const clock = { timeZone: "Europe/Madrid", dayCutover };
        const start = businessDayStart(new Date(instant), clock);
        expect(start).toBe(expected);
        expect(start <= instant).toBe(true);
        // The daily close's window for the day that start opens holds the instant and the start,
        // and not the millisecond before the start.
        const window = businessDayWindow({
          businessDay: expected.slice(0, 10),
          ...clock,
        } as DailyCloseInput);
        const before = new Date(new Date(start).getTime() - 1).toISOString();
        const { rows } = await suite.db.execute<{ instant: 0 | 1; start: 0 | 1; before: 0 | 1 }>(
          sql`select ${window(sql`${instant}`)} as instant, ${window(sql`${start}`)} as start, ${window(sql`${before}`)} as before`,
        );
        expect(rows[0]).toEqual({ instant: 1, start: 1, before: 0 });
      },
    );
  });

  it("validates the clock before computing (caller precondition, plain Error)", () => {
    expect(() =>
      businessDayStart(new Date(), { timeZone: "Mars/Olympus", dayCutover: "06:00" }),
    ).toThrow(/time zone/i);
    expect(() =>
      businessDayStart(new Date(), { timeZone: "Europe/Madrid", dayCutover: "6:00" }),
    ).toThrow(/cutover/i);
  });
});

describe("currentBusinessDay / businessDayOf", () => {
  it("shifts a pre-cutover instant to the PREVIOUS business day (deterministic literal clock)", () => {
    // 2026-03-01 04:30 UTC = 05:30 Madrid (CET, UTC+1 in winter). With a 06:00 cutover, 05:30 local
    // still belongs to the PREVIOUS business day; without the cutover shift it would be 2026-03-01.
    const day = businessDayOf(new Date("2026-03-01T04:30:00.000Z"), {
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    });
    expect(day).toBe("2026-02-28");
  });

  // A venue WEST of UTC, both sides of its DST change: every other case here uses Europe/Madrid, so
  // none reaches a negative offset. The expected days were read off PostgreSQL's `at time zone` on
  // 2026-09-22, not worked out by hand.
  it.each([
    ["2026-08-04T07:59:59.999Z", "2026-08-03"], // 03:59 local, EDT (UTC-4): before the cutover
    ["2026-08-04T08:00:00.000Z", "2026-08-04"], // 04:00 local: the cutover itself
    ["2026-01-15T08:59:59.999Z", "2026-01-14"], // 03:59 local, EST (UTC-5): before the cutover
    ["2026-01-15T09:00:00.000Z", "2026-01-15"], // 04:00 local
  ])("reads a venue west of UTC: %s is business day %s", (instant, expected) => {
    expect(
      businessDayOf(new Date(instant), {
        timeZone: "America/New_York",
        dayCutover: "04:00",
      }),
    ).toBe(expected);
  });

  it("returns a valid YYYY-MM-DD business day against the real clock", () => {
    const day = currentBusinessDay({ timeZone: "Europe/Madrid", dayCutover: "06:00" });
    expect(() => validateBusinessDay(day)).not.toThrow();
  });

  it("validates the time zone before computing (caller precondition, plain Error)", () => {
    expect(() => currentBusinessDay({ timeZone: "Mars/Olympus", dayCutover: "06:00" })).toThrow(
      /time zone/i,
    );
  });

  it("validates the cutover before computing (caller precondition, plain Error)", () => {
    expect(() => currentBusinessDay({ timeZone: "Europe/Madrid", dayCutover: "6:00" })).toThrow(
      /cutover/i,
    );
  });
});
