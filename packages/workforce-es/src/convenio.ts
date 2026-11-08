import { eq } from "drizzle-orm";
import { venueLocationId, type Database, type Transaction } from "@waitron/db";
import { AppError, basisPointsToDecimal, centsToDecimal } from "@waitron/shared";
import type { OvertimeModel, WorkTimeRuleset, PaidBreakPolicy } from "@waitron/workforce";
import { convenioConfig } from "./schema/convenio-config.js";
// Side-effect: registers this package's convenio.* code so `new AppError(...)` below type-checks
// against the shared registry (packages/shared reachability rule).
import "./errors.js";

/** The underscored stored value → the hyphenated generic `OvertimeModel`. The column's check
 * constraint admits exactly these two, so the lookup is total. */
const DB_TO_OVERTIME_MODEL: Record<"daily_accrual" | "period_net", OvertimeModel> = {
  daily_accrual: "daily-accrual",
  period_net: "period-net",
};

/**
 * A rate column comes back as a count of basis points; the ruleset carries the same rate as a
 * PERCENTAGE — 25% is 25, not 0.25 — as a number-or-null. Rendering the literal first and reading
 * that keeps the divide-by-a-hundred in one place, `basisPointsToDecimal`, rather than spelling it
 * here.
 */
function rateNum(basisPoints: number | null): number | null {
  return basisPoints === null ? null : Number(basisPointsToDecimal(basisPoints));
}

/**
 * A money column comes back as a count of cents. Rendering the literal first and reading that keeps
 * the money scale in `centsToDecimal` rather than spelling `/ 100` here.
 */
function moneyNum(cents: number | null): number | null {
  return cents === null ? null : Number(centsToDecimal(cents));
}

/**
 * Resolves the venue's `convenio_config` row into the regime-neutral `WorkTimeRuleset`
 * the generic engine consumes. Throws `convenio.not_found` when the venue has none.
 */
export async function resolveWorkTimeRuleset(tx: Transaction | Database): Promise<WorkTimeRuleset> {
  const rows = await tx
    .select({
      workingDaysPerWeek: convenioConfig.workingDaysPerWeek,
      overtimeModel: convenioConfig.overtimeModel,
      referencePeriodDays: convenioConfig.referencePeriodDays,
      compensationWindowDays: convenioConfig.compensationWindowDays,
      dailyTargetMinutes: convenioConfig.dailyTargetMinutes,
      maxWeeklyMinutes: convenioConfig.maxWeeklyMinutes,
      minInterShiftRestMinutes: convenioConfig.minInterShiftRestMinutes,
      maxOrdinaryDailyMinutes: convenioConfig.maxOrdinaryDailyMinutes,
      breakThresholdMinutes: convenioConfig.breakThresholdMinutes,
      minBreakMinutes: convenioConfig.minBreakMinutes,
      weeklyRestMinutes: convenioConfig.weeklyRestMinutes,
      annualOvertimeCapHours: convenioConfig.annualOvertimeCapHours,
      nightWindowStartMinute: convenioConfig.nightWindowStartMinute,
      nightWindowEndMinute: convenioConfig.nightWindowEndMinute,
      nightPremiumPct: convenioConfig.nightPremiumPct,
      splitShiftPremium: convenioConfig.splitShiftPremium,
      breaksCountAsWorked: convenioConfig.breaksCountAsWorked,
      splitMinSegmentMinutes: convenioConfig.splitMinSegmentMinutes,
      splitMaxSegmentMinutes: convenioConfig.splitMaxSegmentMinutes,
      splitMinGapMinutes: convenioConfig.splitMinGapMinutes,
    })
    .from(convenioConfig)
    .where(eq(convenioConfig.locationId, await venueLocationId(tx)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError("convenio.not_found", {});
  }
  // The `.select({...})` above aliases every column to its exact `WorkTimeRuleset` field name and
  // narrows to precisely the ruleset's columns (no id/createdAt), so `...row` supplies all
  // but the three fields that need a transform.
  return {
    ...row,
    overtimeModel: DB_TO_OVERTIME_MODEL[row.overtimeModel],
    nightPremiumPct: rateNum(row.nightPremiumPct),
    splitShiftPremium: moneyNum(row.splitShiftPremium),
  };
}

export const POLICY_COLUMNS = [
  "split_min_segment_minutes",
  "split_max_segment_minutes",
  "split_min_gap_minutes",
  "continuous_paid_break_minutes",
] as const;
export function policyRowFault(row: Readonly<Record<string, unknown>>): string | null {
  for (const key of POLICY_COLUMNS) {
    const value = row[key];
    if (value != null && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0))
      return key;
  }
  const min = row.split_min_segment_minutes as number | null | undefined;
  const max = row.split_max_segment_minutes as number | null | undefined;
  const gap = row.split_min_gap_minutes;
  if ((min != null || max != null) && (min == null || max == null || gap == null || min > max))
    return "split_min_segment_minutes";
  if (row.continuous_paid_break_minutes != null) {
    if (gap == null) return "split_min_gap_minutes";
    const threshold = row.break_threshold_minutes;
    if (
      threshold !== undefined &&
      (typeof threshold !== "number" || !Number.isSafeInteger(threshold) || threshold <= 0)
    )
      return "break_threshold_minutes";
  }
  return null;
}
export async function resolvePaidBreakPolicy(
  tx: Transaction | Database,
): Promise<PaidBreakPolicy | null> {
  const [row] = await tx
    .select()
    .from(convenioConfig)
    .where(eq(convenioConfig.locationId, await venueLocationId(tx)))
    .limit(1);
  if (row === undefined || row.continuousPaidBreakMinutes === null) return null;
  if (
    policyRowFault({
      split_min_segment_minutes: row.splitMinSegmentMinutes,
      split_max_segment_minutes: row.splitMaxSegmentMinutes,
      split_min_gap_minutes: row.splitMinGapMinutes,
      continuous_paid_break_minutes: row.continuousPaidBreakMinutes,
      break_threshold_minutes: row.breakThresholdMinutes,
    }) !== null
  )
    return null;
  return {
    thresholdMinutes: row.breakThresholdMinutes,
    allowanceMinutes: row.continuousPaidBreakMinutes,
    splitGapMinutes: row.splitMinGapMinutes!,
  };
}
