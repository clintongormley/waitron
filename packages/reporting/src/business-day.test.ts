import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  businessDayClause,
  businessDayRangeClause,
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
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

  const TZ = "Europe/Madrid";
  const CUTOVER = "05:00";

  it("a single-day range (from == to) matches the = businessDay form at a boundary instant", async () => {
    // 2026-08-04 05:00 Madrid = 2026-08-04T03:00Z is exactly the cutover; one second earlier belongs
    // to the prior business day. Evaluating both predicates for those two instants pins that the range
    // clause EXTENDS `businessDayClause` — same answer, both directions, at the boundary that separates
    // the two days. (Only timeZone/dayCutover/day(s) matter to the date maths — tenant/node are unread,
    // hence the minimal cast objects.)
    for (const [instant, day, expected] of [
      ["2026-08-04T03:00:00Z", "2026-08-04", true],
      ["2026-08-04T02:59:59Z", "2026-08-04", false],
    ] as const) {
      const column = sql`${instant}::timestamptz`;
      const dayInput = { businessDay: day, timeZone: TZ, dayCutover: CUTOVER } as DailyCloseInput;
      const rangeInput = {
        fromBusinessDay: day,
        toBusinessDay: day,
        timeZone: TZ,
        dayCutover: CUTOVER,
      } as PeriodVatInput;
      const { rows } = await suite.db.execute<{ eq: boolean; range: boolean }>(
        sql`select ${businessDayClause(column, dayInput)} as eq, ${businessDayRangeClause(column, rangeInput)} as range`,
      );
      expect(rows[0]!.range).toBe(rows[0]!.eq);
      expect(rows[0]!.range).toBe(expected);
    }
  });
});
