import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants } from "@waitron/db";

/**
 * The overtime-model reading a convenio selects (art. 35 daily-accrual vs art. 34.2 distribución
 * irregular / period-net). Underscored to match SQL convention; the generic `OvertimeModel`
 * (`daily-accrual` / `period-net`) is hyphenated and the workforce-es resolver bridges the two.
 */
export const overtimeModel = pgEnum("overtime_model", ["daily_accrual", "period_net"]);

/**
 * `convenio_config` — the Spain-specific configuration surface that supplies the overtime rule and
 * the ET/convenio guardrails as data, one row per (tenant, location). It lives in
 * `packages/workforce-es` (exempt from the english-only guard) because `convenio` is a Spanish
 * labour token; the generic engine never imports it, and the workforce-es resolver maps a row into
 * the neutral `WorkTimeRuleset` (`packages/workforce`).
 *
 * DESIGN PRINCIPLE (plan §3): the overtime *projection* is convenio-selectable and already exists;
 * the overtime *rule* is an asesor-laboral decision, not code. So every rule is a COLUMN with a
 * documented default equal to the ET statutory floor or to today's hard-coded default — a default
 * row reproduces current behaviour, and the asesor later edits the ROW, not this schema. Nothing
 * here hard-codes a convenio's figure: the two provincial premiums default null ("not computed yet",
 * never an invented number), and the guardrail limits default to the ET statute, which a convenio
 * may only tighten.
 *
 * MUTABLE (the persons shape, @waitron/identity's `drizzle/0001_identity_rls.sql`): FORCE ROW LEVEL
 * SECURITY + tenant policy + `GRANT SELECT, INSERT, UPDATE`. This is configuration an admin edits,
 * not the immutable registro — it carries no append-only trigger and no chain.
 */
export const convenioConfig = pgTable(
  "convenio_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),

    // Overtime / projection inputs (plan §3.1) — the two D2.0 consumes plus the period-net terms.
    /** Ordinary working days per week — the daily-target denominator. Replaces the former
     * `DEFAULT_WORKING_DAYS_PER_WEEK = 5` module constant; 1..7 so the projection never divides by
     * zero. */
    workingDaysPerWeek: integer("working_days_per_week").notNull().default(5),
    /** Which overtime reading binds as the headline. Default daily-accrual (art. 35) reproduces
     * today's conservative default; the asesor flips it to period_net where a convenio allows
     * distribución irregular. */
    overtimeModel: overtimeModel("overtime_model").notNull().default("daily_accrual"),
    /** art. 34.2 reference period, only meaningful under period_net; null otherwise. */
    referencePeriodDays: integer("reference_period_days"),
    /** art. 34.2 compensation window, only under period_net; null otherwise. */
    compensationWindowDays: integer("compensation_window_days"),
    /** Explicit per-day target override; null falls back to weekly ÷ working_days_per_week. */
    dailyTargetMinutes: integer("daily_target_minutes"),

    // Guardrail limits (plan §3.2) — the ET statutory floor as defaults; a convenio may only tighten.
    /** art. 34.1 average weekly cap. */
    maxWeeklyMinutes: integer("max_weekly_minutes").notNull().default(2400),
    /** art. 34.3 minimum rest between shifts. */
    minInterShiftRestMinutes: integer("min_inter_shift_rest_minutes").notNull().default(720),
    /** art. 34.3 maximum ordinary daily working time. */
    maxOrdinaryDailyMinutes: integer("max_ordinary_daily_minutes").notNull().default(540),
    /** art. 34.4 worked-time threshold above which a break is owed. */
    breakThresholdMinutes: integer("break_threshold_minutes").notNull().default(360),
    /** art. 34.4 minimum break length. */
    minBreakMinutes: integer("min_break_minutes").notNull().default(15),
    /** art. 37.1 minimum weekly rest. */
    weeklyRestMinutes: integer("weekly_rest_minutes").notNull().default(2160),
    /** art. 35.2 annual overtime cap, in hours. */
    annualOvertimeCapHours: integer("annual_overtime_cap_hours").notNull().default(80),
    /** art. 36 night-window start, minutes from local midnight (22:00). */
    nightWindowStartMinute: integer("night_window_start_minute").notNull().default(1320),
    /** art. 36 night-window end, minutes from local midnight (06:00). */
    nightWindowEndMinute: integer("night_window_end_minute").notNull().default(360),

    // Provincial premiums (plan §3.2) — asesor-blocked, default null so no figure is ever invented.
    /** plus de nocturnidad as a fraction (e.g. 0.25); null until the convenio's figure is known. */
    nightPremiumPct: numeric("night_premium_pct", { precision: 5, scale: 2 }),
    /** plus de turno partido, per-day amount in tenant currency; null until known. */
    splitShiftPremium: numeric("split_shift_premium", { precision: 12, scale: 2 }),
    /** Whether turno-partido breaks count as worked time (convenio/interpretive). Conservative
     * default. */
    breaksCountAsWorked: boolean("breaks_count_as_worked").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process). restrict, so a config row is never silently orphaned by a tenant/location delete.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "convenio_config_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "convenio_config_location_fk",
    }).onDelete("restrict"),
    // One convenio_config per (tenant, location): the resolver looks a row up by this key.
    unique("convenio_config_tenant_location_uq").on(t.tenantId, t.locationId),
    index("convenio_config_tenant_id_idx").on(t.tenantId),
    // The load-bearing check: the projection divides the contracted week by working_days_per_week, so
    // it must be 1..7 (never zero) or a resolved ruleset would produce a NaN daily target.
    check("convenio_config_working_days_ck", sql`${t.workingDaysPerWeek} between 1 and 7`),
  ],
).enableRLS();
