import { eq } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { AppError, basisPointsToDecimal, centsToDecimal } from "@waitron/shared";
import type { OvertimeModel, WorkTimeRuleset } from "@waitron/workforce";
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
 * Resolves the location's `convenio_config` row into the regime-neutral `WorkTimeRuleset`
 * the generic engine consumes. Throws `convenio.not_found` when no row is configured for the location.
 */
export async function resolveWorkTimeRuleset(
  tx: Transaction | Database,
  params: { locationId: string },
): Promise<WorkTimeRuleset> {
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
    })
    .from(convenioConfig)
    .where(eq(convenioConfig.locationId, params.locationId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError("convenio.not_found", {
      locationId: params.locationId,
    });
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
