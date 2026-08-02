import type { OvertimeModel } from "./projection.js";

/**
 * The regime-neutral work-time ruleset: the working-time parameters the projection and (D2.3) the
 * roster-guardrail engine measure against, as plain numbers with NO Spanish vocabulary and NO
 * hard-coded convenio figures.
 *
 * `packages/workforce` is generic and never imports `convenio_config` or names a convenio (the
 * english-only guard forbids the tokens anyway). `packages/workforce-es` resolves a `convenio_config`
 * row into this shape and passes it in — exactly as it already hands the generic `exportTimeRecord`
 * the projection's output. Every field maps to one `convenio_config` column whose DB default is the
 * ET statutory floor or today's hard-coded default, so a default config row reproduces current
 * behaviour and an asesor-laboral later edits the ROW, not this code.
 *
 * `WorkforceBackend.workSummary` reads the OVERTIME-PROJECTION inputs — `workingDaysPerWeek`,
 * `overtimeModel` and `dailyTargetMinutes`. `referencePeriodDays`/`compensationWindowDays` are the
 * remaining overtime-projection inputs (art. 34.2 distribución irregular / the period-net reference
 * period), carried but not yet consumed anywhere. Every OTHER field is a roster GUARDRAIL threshold
 * read by the D2.3 validation engine (`validateRoster` in `roster-validation.ts`), never by the
 * projection.
 */
export interface WorkTimeRuleset {
  /** Ordinary working days in the week — the daily-target denominator when `dailyTargetMinutes` is
   * null (`convenio_config.working_days_per_week`, default 5, a Mon–Fri week). */
  workingDaysPerWeek: number;
  /** Which overtime reading is the headline figure (`convenio_config.overtime_model`, default
   * daily-accrual — art. 35). Flipping it never changes the two underlying figures, only the
   * headline. */
  overtimeModel: OvertimeModel;
  /** art. 34.2 distribución irregular reference period in days, or null while daily-accrual binds. */
  referencePeriodDays: number | null;
  /** art. 34.2 compensation window in days, or null. */
  compensationWindowDays: number | null;
  /** An explicit per-day target override, now HONOURED by `workSummary` (`dailyContractedTargetMinutes`
   * is used only as the fallback): when non-null it is the daily-accrual target directly; null falls
   * back to the weekly ÷ `workingDaysPerWeek` derivation. A DEFAULT convenio_config row leaves it
   * null, so the derivation still produces today's numbers. */
  dailyTargetMinutes: number | null;
  /** art. 34.1 average weekly cap (default 2400 = 40h). */
  maxWeeklyMinutes: number;
  /** art. 34.3 minimum rest between two shifts (default 720 = 12h). */
  minInterShiftRestMinutes: number;
  /** art. 34.3 maximum ordinary daily working time (default 540 = 9h). */
  maxOrdinaryDailyMinutes: number;
  /** art. 34.4 worked-time threshold above which a break is owed (default 360 = 6h). */
  breakThresholdMinutes: number;
  /** art. 34.4 minimum break length (default 15). */
  minBreakMinutes: number;
  /** art. 37.1 minimum weekly rest (default 2160 = 1.5 days). */
  weeklyRestMinutes: number;
  /** art. 35.2 annual overtime cap, in hours (default 80). */
  annualOvertimeCapHours: number;
  /** art. 36 night-window start, minutes from local midnight (default 1320 = 22:00). */
  nightWindowStartMinute: number;
  /** art. 36 night-window end, minutes from local midnight (default 360 = 06:00). */
  nightWindowEndMinute: number;
  /** plus de nocturnidad as a fraction, or null when the convenio has not set a provincial figure. */
  nightPremiumPct: number | null;
  /** plus de turno partido, a per-day amount in tenant currency, or null. */
  splitShiftPremium: number | null;
  /** Whether turno-partido breaks count as worked time (convenio/interpretive, default false). */
  breaksCountAsWorked: boolean;
}
