import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  businessDayClause,
  businessDayOf,
  businessDayRangeClause,
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

describe("businessDayRangeClause", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

  const TZ = "Europe/Madrid";
  const CUTOVER = "05:00";

  it("a single-day range (from == to) matches the = businessDay form at a boundary instant", async () => {
    // 2026-08-04 05:00 Madrid = 2026-08-04T03:00Z is exactly the cutover; one second earlier belongs
    // to the prior business day. Evaluating both predicates for those two instants pins that the range
    // clause EXTENDS `businessDayClause` — same answer, both directions, at the boundary that separates
    // the two days. (Only timeZone/dayCutover/day(s) matter to the date maths — tenant/node are unread,
    // hence the minimal cast objects.)
    for (const [instant, day, expected] of [
      ["2026-08-04T03:00:00.000Z", "2026-08-04", true],
      ["2026-08-04T02:59:59.999Z", "2026-08-04", false],
    ] as const) {
      // A bound string, not a cast literal: a timestamp column is TEXT on this engine and both
      // clauses compare against a canonical ISO bound, so the instant under test is written the
      // way a stored stamp is written. The two values keep the instants the case was built on;
      // the milliseconds are new, and are what the engine's own writers produce
      // (`Date.prototype.toISOString`).
      const column = sql`${instant}`;
      const dayInput = { businessDay: day, timeZone: TZ, dayCutover: CUTOVER } as DailyCloseInput;
      const rangeInput = {
        fromBusinessDay: day,
        toBusinessDay: day,
        timeZone: TZ,
        dayCutover: CUTOVER,
      } as PeriodVatInput;
      // A RAW select reaches no column mapping, so a predicate comes back as the engine's own 1/0
      // rather than as a boolean — the same class the residue guard's header names. The case still
      // asserts the two predicates agree and that they agree with `expected`; only the spelling of
      // the value being compared changed.
      const { rows } = await suite.db.execute<{ eq: 0 | 1; range: 0 | 1 }>(
        sql`select ${businessDayClause(column, dayInput)} as eq, ${businessDayRangeClause(column, rangeInput)} as range`,
      );
      expect(rows[0]!.range).toBe(rows[0]!.eq);
      expect(rows[0]!.range).toBe(expected ? 1 : 0);
    }
  });
});

describe("currentBusinessDay / businessDayOf", () => {
  it("shifts a pre-cutover instant to the PREVIOUS business day (deterministic literal clock)", () => {
    // 2026-03-01 04:30 UTC = 05:30 Madrid (CET, UTC+1 in winter, before the last-Sunday-of-March DST
    // change). With a 06:00 cutover, 05:30 local still belongs to the PREVIOUS business day. Without
    // the cutover shift the date would be 2026-03-01, so this literal case pins the shift maths and
    // never touches the wall clock — the day is fixed by the literal, not by the clock.
    //
    // The literal is a `Date` rather than a `timestamptz` SQL fragment, and there is no transaction:
    // `businessDayOf` computes in JavaScript now, because this engine has neither `at time zone` nor
    // a zone database. The instant and the expected answer are unchanged.
    const day = businessDayOf(new Date("2026-03-01T04:30:00.000Z"), {
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    });
    expect(day).toBe("2026-02-28");
  });

  // A venue WEST of UTC, both sides of its DST change, because every other case in this package
  // uses Europe/Madrid and a negative offset is the arm none of them reaches. The four expected
  // days are PostgreSQL's own, read off PGlite 0.5.8 (PostgreSQL 18.3) on 2026-09-22 from
  // `((<instant> at time zone 'America/New_York') - '04:00'::interval)::date` — the expression this
  // function replaced — not worked out by hand here.
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
