import type { OvertimeModel } from "./projection.js";

/**
 * The working-time parameters, with no collective-agreement figure hard-coded: packages/workforce-es
 * resolves its configuration row into this shape. `workSummary` reads `workingDaysPerWeek`,
 * `overtimeModel` and `dailyTargetMinutes`; `referencePeriodDays` and `compensationWindowDays` are
 * not yet read in this package; every other field is a `validateRoster` threshold.
 */
export interface WorkTimeRuleset {
  /** The daily-target denominator when `dailyTargetMinutes` is null. */
  workingDaysPerWeek: number;
  /** Which overtime reading is the headline figure; it never changes the two underlying figures. */
  overtimeModel: OvertimeModel;
  referencePeriodDays: number | null;
  compensationWindowDays: number | null;
  /** The daily-accrual target; null derives it as weekly contracted minutes ÷ `workingDaysPerWeek`. */
  dailyTargetMinutes: number | null;
  maxWeeklyMinutes: number;
  minInterShiftRestMinutes: number;
  maxOrdinaryDailyMinutes: number;
  breakThresholdMinutes: number;
  minBreakMinutes: number;
  weeklyRestMinutes: number;
  annualOvertimeCapHours: number;
  /** Minutes from local midnight, as is the end; the window wraps midnight when start >= end. */
  nightWindowStartMinute: number;
  nightWindowEndMinute: number;
  /** A percentage (25.00 = 25%); null when none is set. */
  nightPremiumPct: number | null;
  /** A per-day amount in tenant currency. */
  splitShiftPremium: number | null;
  breaksCountAsWorked: boolean;
}
