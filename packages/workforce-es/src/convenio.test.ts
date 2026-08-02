import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import type { WorkTimeRuleset } from "@waitron/workforce";
import { resolveWorkTimeRuleset } from "./convenio.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
import { seedConvenioConfig, seedLocation } from "../test/fixtures.js";

let tenantId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

// A fresh location per test, so the shared PGlite database keeps each test's convenio_config row
// isolated on its own (tenant, location) key — the tests stay order-independent.

/** The ruleset a DEFAULT convenio_config row resolves to — every field the ET statutory floor or
 * today's default. This is the value that must reproduce current behaviour (§3). */
const DEFAULT_RULESET: WorkTimeRuleset = {
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

describe("resolveWorkTimeRuleset", () => {
  it("resolves a default row to the ET/default ruleset", async () => {
    const locationId = await seedLocation(suite.db, tenantId);
    await seedConvenioConfig(suite.db, { tenantId, locationId });
    const ruleset = await resolveWorkTimeRuleset(suite.db, { tenantId, locationId });
    expect(ruleset).toEqual(DEFAULT_RULESET);
  });

  it("resolves a fully-customised row, mapping the period_net enum and the numeric premiums", async () => {
    // Every field set to a distinct non-default, so a mapping that dropped or crossed a column shows.
    // Proves the underscored DB enum maps to the hyphenated generic OvertimeModel and the numeric
    // premiums come back as numbers, not strings.
    const locationId = await seedLocation(suite.db, tenantId);
    await suite.db.execute(sql`
      insert into convenio_config (
        tenant_id, location_id, working_days_per_week, overtime_model, reference_period_days,
        compensation_window_days, daily_target_minutes, max_weekly_minutes,
        min_inter_shift_rest_minutes, max_ordinary_daily_minutes, break_threshold_minutes,
        min_break_minutes, weekly_rest_minutes, annual_overtime_cap_hours, night_window_start_minute,
        night_window_end_minute, night_premium_pct, split_shift_premium, breaks_count_as_worked
      ) values (
        ${tenantId}, ${locationId}, 6, 'period_net', 120, 60, 470, 2100, 780, 500, 300, 20, 2400, 90,
        1380, 300, 0.25, 12.50, true)`);
    const ruleset = await resolveWorkTimeRuleset(suite.db, { tenantId, locationId });
    expect(ruleset).toEqual({
      workingDaysPerWeek: 6,
      overtimeModel: "period-net",
      referencePeriodDays: 120,
      compensationWindowDays: 60,
      dailyTargetMinutes: 470,
      maxWeeklyMinutes: 2100,
      minInterShiftRestMinutes: 780,
      maxOrdinaryDailyMinutes: 500,
      breakThresholdMinutes: 300,
      minBreakMinutes: 20,
      weeklyRestMinutes: 2400,
      annualOvertimeCapHours: 90,
      nightWindowStartMinute: 1380,
      nightWindowEndMinute: 300,
      nightPremiumPct: 0.25,
      splitShiftPremium: 12.5,
      breaksCountAsWorked: true,
    });
  });

  it("throws convenio.not_found when no convenio_config row exists for the (tenant, location)", async () => {
    const locationId = await seedLocation(suite.db, tenantId);
    const error = await captureError(() =>
      resolveWorkTimeRuleset(suite.db, { tenantId, locationId }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("convenio.not_found");
    expect((error as AppError).params).toEqual({ tenantId, locationId });
  });
});
