import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import { rotaWeek } from "../testing/rota-fixture.js";
import { STAFFING_STRINGS } from "./strings.js";
import { candidateWarnings, breachText } from "./rota-warnings.js";
const rules: WorkTimeRuleset = {
  workingDaysPerWeek: 5,
  overtimeModel: "daily-accrual",
  referencePeriodDays: null,
  compensationWindowDays: null,
  dailyTargetMinutes: null,
  maxWeeklyMinutes: 2400,
  minInterShiftRestMinutes: 720,
  maxOrdinaryDailyMinutes: 540,
  breakThresholdMinutes: 360,
  minBreakMinutes: 15,
  weeklyRestMinutes: 2160,
  annualOvertimeCapHours: 80,
  nightWindowStartMinute: 1320,
  nightWindowEndMinute: 360,
  nightPremiumPct: null,
  splitShiftPremium: null,
  breaksCountAsWorked: false,
};
afterEach(() => setLocale("en"));
function preview(day: string, startsAt: string, endsAt: string) {
  const week = rotaWeek();
  week.shifts = [];
  week.days[0]!.businessDay = day;
  const slot = {
    ...week.days[4]!.areas[0]!.match.slots[0]!.slot,
    businessDay: day,
    startsAt,
    endsAt,
  };
  return { week, slot };
}
it("omits a nonexistent candidate time but previews a real time on the same clock-change day", () => {
  const missing = preview("2026-03-28", "02:00", "04:00");
  expect(candidateWarnings(missing.week, missing.slot, "ana", rules)).toEqual([]);
  const real = preview("2026-03-28", "03:00", "04:00");
  expect(candidateWarnings(real.week, real.slot, "ana", rules)).toEqual([
    { kind: "night_work", personId: "ana", shiftId: "candidate", nightMinutes: 60 },
  ]);
  const missingEnd = preview("2026-03-28", "01:00", "02:00");
  expect(candidateWarnings(missingEnd.week, missingEnd.slot, "ana", rules)).toEqual([]);
});
it("uses the earlier repeated start and the following date for an end at the changeover", () => {
  const { week, slot } = preview("2026-10-24", "02:30", "04:00");
  week.shifts = [
    {
      ...rotaWeek().shifts[0]!,
      shiftId: "late",
      startsAt: "2026-10-24T14:00:00Z",
      endsAt: "2026-10-24T21:30:00Z",
      startsOffsetMinutes: 120,
      endsOffsetMinutes: 120,
    },
  ];
  expect(candidateWarnings(week, slot, "ana", rules)).toContainEqual({
    kind: "rest_too_short",
    personId: "ana",
    previousShiftId: "late",
    shiftId: "candidate",
    restMinutes: 180,
    requiredMinutes: 720,
  });
  const overnight = preview("2026-12-01", "09:00", "06:00");
  expect(candidateWarnings(overnight.week, overnight.slot, "ana", rules)).toContainEqual({
    kind: "exceeds_daily_max",
    personId: "ana",
    workDate: "2026-12-01",
    plannedMinutes: 1260,
    maxMinutes: 540,
  });
});
it("does not repeat unchanged warnings on other shifts or people", () => {
  const { week, slot } = preview("2026-12-04", "09:00", "12:00");
  week.shifts = [
    { ...rotaWeek().shifts[0]!, startsAt: "2026-12-01T08:00:00Z", endsAt: "2026-12-01T16:00:00Z" },
  ];
  expect(candidateWarnings(week, slot, "ana", rules)).toEqual([]);
  expect(candidateWarnings(week, slot, "ana", null)).toEqual([]);
});
it("localizes warning facts and preserves their numeric values in Spanish", () => {
  setLocale("es");
  expect(
    breachText({
      kind: "rest_too_short",
      personId: "ana",
      shiftId: "s",
      previousShiftId: "p",
      restMinutes: 540,
      requiredMinutes: 720,
    }),
  ).toBe(
    STAFFING_STRINGS.es["staffing.breach.rest_too_short"]
      .replace("{restMinutes}", "9")
      .replace("{requiredMinutes}", "12"),
  );
});
