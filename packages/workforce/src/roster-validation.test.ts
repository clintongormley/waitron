import { describe, expect, it } from "vitest";
import { makeRuleset } from "../test/fixtures.js";
import { validateRoster, type PlannedShift, type RosterBreach } from "./roster-validation.js";

let seq = 0;

/** Offsets default to 0, so a test that does not care about local dates reads as bare instants. */
function shift(
  personId: string,
  startsAt: string,
  endsAt: string,
  opts: { shiftId?: string; startsOffsetMinutes?: number; endsOffsetMinutes?: number } = {},
): PlannedShift {
  seq += 1;
  return {
    shiftId: opts.shiftId ?? `s${seq}`,
    personId,
    startsAt,
    startsOffsetMinutes: opts.startsOffsetMinutes ?? 0,
    endsAt,
    endsOffsetMinutes: opts.endsOffsetMinutes ?? 0,
  };
}

function ofKind<K extends RosterBreach["kind"]>(
  breaches: RosterBreach[],
  kind: K,
): Extract<RosterBreach, { kind: K }>[] {
  return breaches.filter((b): b is Extract<RosterBreach, { kind: K }> => b.kind === kind);
}

describe("validateRoster — aggregate behaviour", () => {
  it("returns an empty array for a clean roster (one ordinary day, no guardrail touched)", () => {
    expect(
      validateRoster(
        [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T14:00:00Z")], // 5h: under every limit
        makeRuleset(),
      ),
    ).toEqual([]);
  });

  it("collects breaches of several kinds from one roster", () => {
    // 04:00–19:00 trips daily-max, break, overtime and night at once; a second shift 8h later trips
    // inter-shift rest.
    const kinds = new Set(
      validateRoster(
        [
          shift("p1", "2026-01-05T04:00:00Z", "2026-01-05T19:00:00Z"),
          shift("p1", "2026-01-06T03:00:00Z", "2026-01-06T08:00:00Z"),
        ],
        makeRuleset({ annualOvertimeCapHours: 2 }), // 120-min cap, so the day's 360 overtime breaches
      ).map((b) => b.kind),
    );
    for (const kind of [
      "exceeds_daily_max",
      "break_owed",
      "overtime_cap_exceeded",
      "night_work",
      "rest_too_short",
    ] as const) {
      expect(kinds).toContain(kind);
    }
  });
});

describe("validateRoster — inter-shift rest (art. 34.3)", () => {
  it("flags two consecutive shifts closer than the minimum rest, naming both shifts and the gap", () => {
    const breaches = validateRoster(
      [
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z", { shiftId: "a" }),
        // 11h after a's end.
        shift("p1", "2026-01-06T04:00:00Z", "2026-01-06T12:00:00Z", { shiftId: "b" }),
      ],
      makeRuleset({ minInterShiftRestMinutes: 720 }),
    );
    expect(ofKind(breaches, "rest_too_short")).toEqual([
      {
        kind: "rest_too_short",
        personId: "p1",
        previousShiftId: "a",
        shiftId: "b",
        restMinutes: 660,
        requiredMinutes: 720,
      },
    ]);
  });

  it("does not flag a gap of exactly the minimum, nor one a minute over (12h01 passes, 11h59 fails)", () => {
    const under = validateRoster(
      [
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"),
        shift("p1", "2026-01-06T04:59:00Z", "2026-01-06T12:00:00Z"), // 11h59 = 719 min
      ],
      makeRuleset({ minInterShiftRestMinutes: 720 }),
    );
    const exact = validateRoster(
      [
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"),
        shift("p1", "2026-01-06T05:00:00Z", "2026-01-06T12:00:00Z"), // 12h00 = 720 min
      ],
      makeRuleset({ minInterShiftRestMinutes: 720 }),
    );
    const over = validateRoster(
      [
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"),
        shift("p1", "2026-01-06T05:01:00Z", "2026-01-06T12:00:00Z"), // 12h01 = 721 min
      ],
      makeRuleset({ minInterShiftRestMinutes: 720 }),
    );
    expect(ofKind(under, "rest_too_short")).toHaveLength(1);
    expect(ofKind(exact, "rest_too_short")).toHaveLength(0);
    expect(ofKind(over, "rest_too_short")).toHaveLength(0);
  });

  it("measures rest per person — one person's shifts never pair against another's", () => {
    const breaches = validateRoster(
      [
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"),
        shift("p2", "2026-01-05T18:00:00Z", "2026-01-06T02:00:00Z"),
      ],
      makeRuleset({ minInterShiftRestMinutes: 720 }),
    );
    expect(ofKind(breaches, "rest_too_short")).toHaveLength(0);
  });

  it("does not flag a same-day split shift under a real inter-shift floor", () => {
    // A split shift is ONE working day with an intra-day break: art. 34.3's rest is between working
    // DAYS, so the 16:00→20:00 gap must not breach even under the full 12h floor.
    const breaches = validateRoster(
      [
        shift("p1", "2026-01-05T12:00:00Z", "2026-01-05T16:00:00Z"),
        shift("p1", "2026-01-05T20:00:00Z", "2026-01-06T00:00:00Z"),
      ],
      makeRuleset({ minInterShiftRestMinutes: 720 }),
    );
    expect(ofKind(breaches, "rest_too_short")).toHaveLength(0);
  });

  it("measures inter-workday rest from the LAST shift of one day to the FIRST of the next", () => {
    // Rest is measured from the day's LAST end, so the breach names the 20:00–24:00 shift.
    const breaches = validateRoster(
      [
        shift("p1", "2026-01-05T12:00:00Z", "2026-01-05T16:00:00Z", { shiftId: "d-early" }),
        shift("p1", "2026-01-05T20:00:00Z", "2026-01-06T00:00:00Z", { shiftId: "d-late" }),
        shift("p1", "2026-01-06T06:00:00Z", "2026-01-06T10:00:00Z", { shiftId: "next" }),
      ],
      makeRuleset({ minInterShiftRestMinutes: 720 }),
    );
    expect(ofKind(breaches, "rest_too_short")).toEqual([
      {
        kind: "rest_too_short",
        personId: "p1",
        previousShiftId: "d-late",
        shiftId: "next",
        restMinutes: 360,
        requiredMinutes: 720,
      },
    ]);
  });
});

describe("validateRoster — max ordinary daily minutes (art. 34.3)", () => {
  it("flags a day whose planned minutes exceed the ordinary daily maximum", () => {
    const breaches = validateRoster(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T19:00:00Z")], // 10h = 600 min
      makeRuleset({ maxOrdinaryDailyMinutes: 540 }),
    );
    expect(ofKind(breaches, "exceeds_daily_max")).toEqual([
      {
        kind: "exceeds_daily_max",
        personId: "p1",
        workDate: "2026-01-05",
        plannedMinutes: 600,
        maxMinutes: 540,
      },
    ]);
  });

  it("sums a split shift (two shifts on the same local day) before comparing", () => {
    const breaches = validateRoster(
      [
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T14:00:00Z"), // 5h
        shift("p1", "2026-01-05T17:00:00Z", "2026-01-05T22:00:00Z"), // 5h → 10h total
      ],
      makeRuleset({ maxOrdinaryDailyMinutes: 540 }),
    );
    expect(ofKind(breaches, "exceeds_daily_max")).toEqual([
      expect.objectContaining({ workDate: "2026-01-05", plannedMinutes: 600, maxMinutes: 540 }),
    ]);
  });

  it("does not flag a day of exactly the maximum, but flags one minute over (9h passes, 9h01 fails)", () => {
    const exact = validateRoster(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T18:00:00Z")], // 9h = 540
      makeRuleset({ maxOrdinaryDailyMinutes: 540 }),
    );
    const over = validateRoster(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T18:01:00Z")], // 9h01 = 541
      makeRuleset({ maxOrdinaryDailyMinutes: 540 }),
    );
    expect(ofKind(exact, "exceeds_daily_max")).toHaveLength(0);
    expect(ofKind(over, "exceeds_daily_max")).toHaveLength(1);
  });

  it("groups by LOCAL date via the wall offset, not the UTC instant", () => {
    // 23:30Z at +120 is local 01-06; grouped by UTC date, neither day would breach.
    const breaches = validateRoster(
      [
        shift("p1", "2026-01-05T23:30:00Z", "2026-01-06T04:30:00Z", {
          startsOffsetMinutes: 120,
          endsOffsetMinutes: 120,
        }), // 5h, local day 01-06
        shift("p1", "2026-01-06T10:00:00Z", "2026-01-06T15:00:00Z", {
          startsOffsetMinutes: 120,
          endsOffsetMinutes: 120,
        }), // 5h, local day 01-06 → 10h total
      ],
      makeRuleset({ maxOrdinaryDailyMinutes: 540 }),
    );
    expect(ofKind(breaches, "exceeds_daily_max")).toEqual([
      expect.objectContaining({ workDate: "2026-01-06", plannedMinutes: 600 }),
    ]);
  });
});

/** One 09:00 shift per given day; the 16h gaps never trip the inter-shift-rest guard. */
function daysOf(personId: string, dates: string[], minutes: number): PlannedShift[] {
  return dates.map((date) => {
    const startsAt = `${date}T09:00:00Z`;
    const endsAt = new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
    return shift(personId, startsAt, endsAt.replace(".000Z", "Z"));
  });
}

describe("validateRoster — max weekly minutes (art. 34.1)", () => {
  const MON = "2026-01-05"; // a Monday (2026-01-01 is a Thursday)

  it("flags a Monday-anchored week whose planned minutes exceed the weekly maximum", () => {
    // Six 7h days = 2520 > 2400, each under the 540 daily max.
    const week = [
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
    ];
    const breaches = validateRoster(
      daysOf("p1", week, 420),
      makeRuleset({ maxWeeklyMinutes: 2400 }),
    );
    expect(ofKind(breaches, "exceeds_weekly_max")).toEqual([
      {
        kind: "exceeds_weekly_max",
        personId: "p1",
        weekStart: MON,
        plannedMinutes: 2520,
        maxMinutes: 2400,
      },
    ]);
  });

  it("does not flag a week of exactly the maximum, but flags one minute over (2400 passes, 2401 fails)", () => {
    const weekdays = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
    const exact = validateRoster(
      daysOf("p1", weekdays, 480),
      makeRuleset({ maxWeeklyMinutes: 2400 }),
    );
    const over = validateRoster(
      [...daysOf("p1", weekdays.slice(1), 480), ...daysOf("p1", weekdays.slice(0, 1), 481)],
      makeRuleset({ maxWeeklyMinutes: 2400 }),
    );
    expect(ofKind(exact, "exceeds_weekly_max")).toHaveLength(0);
    expect(ofKind(over, "exceeds_weekly_max")).toHaveLength(1);
  });

  it("buckets a Sunday into the PREVIOUS Monday's week, not the following one", () => {
    // Mon–Fri is exactly 2400; the Sunday hour breaches only if it lands in the SAME week.
    const weekdays = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
    const breaches = validateRoster(
      [...daysOf("p1", weekdays, 480), ...daysOf("p1", ["2026-01-11"], 60)],
      makeRuleset({ maxWeeklyMinutes: 2400 }),
    );
    expect(ofKind(breaches, "exceeds_weekly_max")).toEqual([
      expect.objectContaining({ weekStart: MON, plannedMinutes: 2460 }),
    ]);
  });
});

describe("validateRoster — annual overtime cap (art. 35.2)", () => {
  // Overtime is the minutes beyond the ordinary daily maximum (art. 35.1), summed across the roster.
  const ruleset = makeRuleset({ annualOvertimeCapHours: 2, maxOrdinaryDailyMinutes: 540 });

  it("flags a person whose summed daily overtime exceeds the cap", () => {
    // 60 over the 540 max on each of three days = 180 > the 120-min cap.
    const breaches = validateRoster(
      daysOf("p1", ["2026-01-05", "2026-01-06", "2026-01-07"], 600),
      ruleset,
    );
    expect(ofKind(breaches, "overtime_cap_exceeded")).toEqual([
      { kind: "overtime_cap_exceeded", personId: "p1", overtimeMinutes: 180, capMinutes: 120 },
    ]);
  });

  it("does not flag overtime exactly at the cap, but flags a minute over (120 passes, 180 fails)", () => {
    const atCap = validateRoster(daysOf("p1", ["2026-01-05", "2026-01-06"], 600), ruleset); // 120
    const overCap = validateRoster(
      daysOf("p1", ["2026-01-05", "2026-01-06", "2026-01-07"], 600),
      ruleset,
    ); // 180
    expect(ofKind(atCap, "overtime_cap_exceeded")).toHaveLength(0);
    expect(ofKind(overCap, "overtime_cap_exceeded")).toHaveLength(1);
  });

  it("accrues zero overtime for days at or under the ordinary daily maximum", () => {
    // Exactly 540 a day accrues nothing: the threshold is the ordinary daily max, not hours worked.
    const dates = Array.from({ length: 10 }, (_, i) => `2026-02-${String(i + 1).padStart(2, "0")}`);
    const breaches = validateRoster(daysOf("p1", dates, 540), ruleset);
    expect(ofKind(breaches, "overtime_cap_exceeded")).toHaveLength(0);
  });

  it("accrues per person — one person over the cap does not implicate another", () => {
    const breaches = validateRoster(
      [
        ...daysOf("p1", ["2026-01-05", "2026-01-06", "2026-01-07"], 600), // 180 > 120
        ...daysOf("p2", ["2026-01-05"], 600), // 60 < 120
      ],
      ruleset,
    );
    const over = ofKind(breaches, "overtime_cap_exceeded");
    expect(over).toHaveLength(1);
    expect(over[0]!.personId).toBe("p1");
  });
});

describe("validateRoster — break threshold (art. 34.4)", () => {
  // Planned shifts do not model a within-shift break, so this surfaces the owed break rather than
  // detecting a missing one.
  it("flags a shift longer than the break threshold, naming the owed minimum break", () => {
    const breaches = validateRoster(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T16:00:00Z", { shiftId: "x" })], // 7h = 420
      makeRuleset({ breakThresholdMinutes: 360, minBreakMinutes: 15 }),
    );
    expect(ofKind(breaches, "break_owed")).toEqual([
      {
        kind: "break_owed",
        personId: "p1",
        shiftId: "x",
        plannedMinutes: 420,
        thresholdMinutes: 360,
        minBreakMinutes: 15,
      },
    ]);
  });

  it("does not flag a shift of exactly the threshold, but flags one minute over (6h passes, 6h01 fails)", () => {
    const exact = validateRoster(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T15:00:00Z")], // 6h = 360
      makeRuleset({ breakThresholdMinutes: 360 }),
    );
    const over = validateRoster(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T15:01:00Z")], // 6h01 = 361
      makeRuleset({ breakThresholdMinutes: 360 }),
    );
    expect(ofKind(exact, "break_owed")).toHaveLength(0);
    expect(ofKind(over, "break_owed")).toHaveLength(1);
  });
});

describe("validateRoster — night window (art. 36)", () => {
  // The default window 22:00–06:00 wraps midnight.
  it("does not flag a daytime shift wholly outside the night window", () => {
    const breaches = validateRoster(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z")],
      makeRuleset(),
    );
    expect(ofKind(breaches, "night_work")).toHaveLength(0);
  });

  it("flags a shift spanning the whole night window with its overlap minutes (22:00–06:00 → 480)", () => {
    const breaches = validateRoster(
      [shift("p1", "2026-01-05T22:00:00Z", "2026-01-06T06:00:00Z", { shiftId: "n" })],
      makeRuleset(),
    );
    expect(ofKind(breaches, "night_work")).toEqual([
      { kind: "night_work", personId: "p1", shiftId: "n", nightMinutes: 480 },
    ]);
  });

  it("counts only the part inside the window for a partially-nocturnal shift (20:00–24:00 → 120)", () => {
    const breaches = validateRoster(
      [shift("p1", "2026-01-05T20:00:00Z", "2026-01-06T00:00:00Z", { shiftId: "n" })],
      makeRuleset(),
    );
    expect(ofKind(breaches, "night_work")).toEqual([
      expect.objectContaining({ shiftId: "n", nightMinutes: 120 }),
    ]);
  });

  it("does not flag boundary-touching shifts (…–22:00 and 06:00–… are wholly outside)", () => {
    const endsAtStart = validateRoster(
      [shift("p1", "2026-01-05T14:00:00Z", "2026-01-05T22:00:00Z")], // ends exactly 22:00
      makeRuleset(),
    );
    const startsAtEnd = validateRoster(
      [shift("p1", "2026-01-05T06:00:00Z", "2026-01-05T14:00:00Z")], // starts exactly 06:00
      makeRuleset(),
    );
    expect(ofKind(endsAtStart, "night_work")).toHaveLength(0);
    expect(ofKind(startsAtEnd, "night_work")).toHaveLength(0);
  });

  it("handles a NON-wrapping night window (e.g. a ruleset defining night as 00:00–06:00)", () => {
    // start (0) < end (360): the non-wrapping branch. 02:00–08:00 overlaps it for 240 min.
    const breaches = validateRoster(
      [shift("p1", "2026-01-05T02:00:00Z", "2026-01-05T08:00:00Z", { shiftId: "n" })],
      makeRuleset({ nightWindowStartMinute: 0, nightWindowEndMinute: 360 }),
    );
    expect(ofKind(breaches, "night_work")).toEqual([
      expect.objectContaining({ shiftId: "n", nightMinutes: 240 }),
    ]);
  });

  it("resolves the night window against LOCAL wall time via the offset", () => {
    // Local 00:00–06:00 at +720; the raw UTC instant is midday and would score zero.
    const breaches = validateRoster(
      [
        shift("p1", "2026-01-05T12:00:00Z", "2026-01-05T18:00:00Z", {
          shiftId: "n",
          startsOffsetMinutes: 720,
          endsOffsetMinutes: 720,
        }),
      ],
      makeRuleset(),
    );
    expect(ofKind(breaches, "night_work")).toEqual([
      expect.objectContaining({ shiftId: "n", nightMinutes: 360 }),
    ]);
  });
});

/** Consecutive daily 09:00 shifts: at the 480-min default the gaps are 16h, never a weekly rest. */
function consecutiveDays(
  personId: string,
  startDate: string,
  count: number,
  minutes = 480,
): PlannedShift[] {
  return Array.from({ length: count }, (_, i) => {
    const startsAt = new Date(Date.parse(`${startDate}T09:00:00Z`) + i * 86_400_000).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
    return shift(personId, startsAt, endsAt);
  });
}

describe("validateRoster — weekly rest (art. 37.1)", () => {
  // Only a MIDDLE week (shifts on both sides) is judged; the first and last are excused by the
  // unbounded rest outside the roster.
  it("flags a middle week with no rest gap of the required length (three weeks worked every day)", () => {
    const breaches = validateRoster(
      consecutiveDays("p1", "2026-01-05", 21),
      makeRuleset({ weeklyRestMinutes: 2160 }),
    );
    expect(ofKind(breaches, "weekly_rest_insufficient")).toEqual([
      {
        kind: "weekly_rest_insufficient",
        personId: "p1",
        weekStart: "2026-01-12",
        longestRestMinutes: 960,
        requiredMinutes: 2160,
      },
    ]);
  });

  it("does not flag when each week carries a long rest (three weeks of Mon–Fri, weekends off)", () => {
    // The 64h Fri→Mon gap overlaps each week: the control against the every-day roster above.
    const weekdays = (mon: string): string[] =>
      Array.from({ length: 5 }, (_, i) =>
        new Date(Date.parse(`${mon}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      );
    const shifts = [
      ...daysOf("p1", weekdays("2026-01-05"), 480),
      ...daysOf("p1", weekdays("2026-01-12"), 480),
      ...daysOf("p1", weekdays("2026-01-19"), 480),
    ];
    const breaches = validateRoster(shifts, makeRuleset({ weeklyRestMinutes: 2160 }));
    expect(ofKind(breaches, "weekly_rest_insufficient")).toHaveLength(0);
  });

  it("treats a rest of exactly the minimum as sufficient, one minute under as a breach", () => {
    // Every other gap is <= 20h, so the Mon 17:00 → Wed START gap alone decides the middle week:
    // 05:00 gives 36h00, 04:59 gives 35h59.
    const scenario = (wedStart: string): PlannedShift[] => [
      shift("p1", "2026-01-11T09:00:00Z", "2026-01-11T17:00:00Z"), // W1 anchor (excused)
      shift("p1", "2026-01-12T09:00:00Z", "2026-01-12T17:00:00Z"), // Mon
      shift("p1", `2026-01-14T${wedStart}:00Z`, "2026-01-14T13:00:00Z"), // Wed (Tue off)
      shift("p1", "2026-01-15T09:00:00Z", "2026-01-15T17:00:00Z"),
      shift("p1", "2026-01-16T09:00:00Z", "2026-01-16T17:00:00Z"),
      shift("p1", "2026-01-17T09:00:00Z", "2026-01-17T17:00:00Z"),
      shift("p1", "2026-01-18T09:00:00Z", "2026-01-18T17:00:00Z"), // Sun
      shift("p1", "2026-01-19T09:00:00Z", "2026-01-19T17:00:00Z"), // W3 anchor (excused)
    ];
    const sufficient = validateRoster(scenario("05:00"), makeRuleset({ weeklyRestMinutes: 2160 }));
    const insufficient = validateRoster(
      scenario("04:59"),
      makeRuleset({ weeklyRestMinutes: 2160 }),
    );
    expect(ofKind(sufficient, "weekly_rest_insufficient")).toHaveLength(0);
    expect(ofKind(insufficient, "weekly_rest_insufficient")).toEqual([
      expect.objectContaining({ weekStart: "2026-01-12", longestRestMinutes: 2159 }),
    ]);
  });
});
