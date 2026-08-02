import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { OvertimeModel, WorkTimeRuleset } from "@waitron/workforce";
import { convenioConfig } from "./schema/convenio-config.js";
// Side-effect: registers this package's convenio.* code so `new AppError(...)` below type-checks
// against the shared registry (packages/shared reachability rule).
import "./errors.js";

/** The underscored DB enum → the hyphenated generic `OvertimeModel`. The pgEnum constrains the
 * column to exactly these two, so the lookup is total. */
const DB_TO_OVERTIME_MODEL: Record<"daily_accrual" | "period_net", OvertimeModel> = {
  daily_accrual: "daily-accrual",
  period_net: "period-net",
};

/** `numeric` comes back as a string (or null); the ruleset carries it as a number-or-null. */
function num(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Resolves the (tenant, location)'s `convenio_config` row into the regime-neutral `WorkTimeRuleset`
 * the generic engine consumes — the Spain→generic boundary the plan §3.3 draws: the engine never
 * imports `convenio_config` or names a convenio, this resolver does the mapping and passes neutral
 * numbers in. Throws `convenio.not_found` when no row is configured for the pair.
 */
export async function resolveWorkTimeRuleset(
  tx: Transaction | Database,
  params: { tenantId: string; locationId: string },
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
    .where(
      and(
        eq(convenioConfig.tenantId, params.tenantId),
        eq(convenioConfig.locationId, params.locationId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError("convenio.not_found", {
      tenantId: params.tenantId,
      locationId: params.locationId,
    });
  }
  // The `.select({...})` above aliases every column to its exact `WorkTimeRuleset` field name and
  // narrows to precisely the ruleset's columns (no id/tenantId/createdAt), so `...row` supplies all
  // but the three fields that need a transform: the DB enum → the hyphenated `OvertimeModel`, and the
  // two `numeric`-as-string premiums → number-or-null.
  return {
    ...row,
    overtimeModel: DB_TO_OVERTIME_MODEL[row.overtimeModel],
    nightPremiumPct: num(row.nightPremiumPct),
    splitShiftPremium: num(row.splitShiftPremium),
  };
}
