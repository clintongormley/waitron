import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  money,
  nowIso,
  rate,
  table,
  tsString,
} from "@waitron/db";

export const overtimeModel = enumType(["daily_accrual", "period_net"]);

export const convenioConfig = table(
  "convenio_config",
  {
    id: count("id").primaryKey(),

    /** Ordinary working days per week — the daily-target denominator. */
    workingDaysPerWeek: count("working_days_per_week").notNull().default(5),
    /** Which overtime reading binds as the headline. Default daily-accrual (art. 35); the asesor
     * flips it to period_net where a convenio allows distribución irregular. */
    overtimeModel: overtimeModel("overtime_model").notNull().default("daily_accrual"),
    /** art. 34.2 reference period, only meaningful under period_net; null otherwise. */
    referencePeriodDays: count("reference_period_days"),
    /** art. 34.2 compensation window, only under period_net; null otherwise. */
    compensationWindowDays: count("compensation_window_days"),
    /** Explicit per-day target override; null falls back to weekly ÷ working_days_per_week. */
    dailyTargetMinutes: count("daily_target_minutes"),

    /** art. 34.1 average weekly cap. */
    maxWeeklyMinutes: count("max_weekly_minutes").notNull().default(2400),
    /** art. 34.3 minimum rest between shifts. */
    minInterShiftRestMinutes: count("min_inter_shift_rest_minutes").notNull().default(720),
    /** art. 34.3 maximum ordinary daily working time. */
    maxOrdinaryDailyMinutes: count("max_ordinary_daily_minutes").notNull().default(540),
    /** art. 34.4 worked-time threshold above which a break is owed. */
    breakThresholdMinutes: count("break_threshold_minutes").notNull().default(360),
    /** art. 34.4 minimum break length. */
    minBreakMinutes: count("min_break_minutes").notNull().default(15),
    /** art. 37.1 minimum weekly rest. */
    weeklyRestMinutes: count("weekly_rest_minutes").notNull().default(2160),
    /** art. 35.2 annual overtime cap, in hours. */
    annualOvertimeCapHours: count("annual_overtime_cap_hours").notNull().default(80),
    /** art. 36 night-window start, minutes from local midnight (22:00). */
    nightWindowStartMinute: count("night_window_start_minute").notNull().default(1320),
    /** art. 36 night-window end, minutes from local midnight (06:00). */
    nightWindowEndMinute: count("night_window_end_minute").notNull().default(360),

    /** plus de nocturnidad, a PERCENTAGE and not a fraction — 25% is twenty-five, not 0.25 — which
     * `rate` stores as its count of whole basis points, so 25% is the number 2500. Null until the
     * convenio's figure is known. */
    nightPremiumPct: rate("night_premium_pct"),
    /** plus de turno partido, per-day amount in tenant currency; null until known. */
    splitShiftPremium: money("split_shift_premium"),
    /** Whether turno-partido breaks count as worked time (convenio/interpretive). Conservative
     * default. */
    breaksCountAsWorked: flag("breaks_count_as_worked").notNull().default(false),

    splitMinSegmentMinutes: count("split_min_segment_minutes"),
    splitMaxSegmentMinutes: count("split_max_segment_minutes"),
    splitMinGapMinutes: count("split_min_gap_minutes"),
    continuousPaidBreakMinutes: count("continuous_paid_break_minutes"),

    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    check("convenio_config_singleton_ck", sql`${t.id} = 1`),
    // The projection divides the contracted week by working_days_per_week, so it must be 1..7
    // (never zero) or a resolved ruleset would produce a NaN daily target.
    check("convenio_config_working_days_ck", sql`${t.workingDaysPerWeek} between 1 and 7`),
    // The column is plain text and refuses nothing on its own (see enumText in
    // packages/db/src/schema/columns.ts).
    check("convenio_config_overtime_model_ck", enumCheck(t.overtimeModel)),
  ],
);
