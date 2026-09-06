import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, pgErrorCode, pgErrorMessage } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
import { seedLocation } from "../test/fixtures.js";

let tenantId: string;
let locationId: string;

const suite = usePgliteDb({
  // Core first — the tenants/locations foreign keys. Ordering across packages is the runtime's job
  // and nothing enforces it, so it is explicit here; this proves convenio_config applies core-first.
  migrations: [CORE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
    locationId = await seedLocation(db, tenantId);
  },
});

describe("the workforce-es (convenio_config) migration set", () => {
  it("defaults every rule to the ET statutory floor / today's default for a bare row", async () => {
    // A DEFAULT row — only tenant_id and location_id supplied. Every rule takes its column default,
    // which is exactly what lets D2.0 reproduce current behaviour: 5-day week, daily-accrual headline,
    // the ET guardrail limits, false split-break, and NULL premiums (never an invented figure).
    await suite.db.execute(sql`
      insert into convenio_config (tenant_id, location_id) values (${tenantId}, ${locationId})`);
    const rows = await suite.db.execute<Record<string, unknown>>(sql`
      select working_days_per_week, overtime_model, reference_period_days, compensation_window_days,
        daily_target_minutes, max_weekly_minutes, min_inter_shift_rest_minutes,
        max_ordinary_daily_minutes, break_threshold_minutes, min_break_minutes, weekly_rest_minutes,
        annual_overtime_cap_hours, night_window_start_minute, night_window_end_minute,
        night_premium_pct, split_shift_premium, breaks_count_as_worked
      from convenio_config where tenant_id = ${tenantId} and location_id = ${locationId}`);
    expect(rows.rows[0]).toEqual({
      working_days_per_week: 5,
      overtime_model: "daily_accrual",
      reference_period_days: null,
      compensation_window_days: null,
      daily_target_minutes: null,
      max_weekly_minutes: 2400,
      min_inter_shift_rest_minutes: 720,
      max_ordinary_daily_minutes: 540,
      break_threshold_minutes: 360,
      min_break_minutes: 15,
      weekly_rest_minutes: 2160,
      annual_overtime_cap_hours: 80,
      night_window_start_minute: 1320,
      night_window_end_minute: 360,
      night_premium_pct: null,
      split_shift_premium: null,
      breaks_count_as_worked: false,
    });
  });

  it("rejects working_days_per_week outside 1..7 (the div-by-zero guard)", async () => {
    // The projection divides the contracted week by working_days_per_week, so zero would produce a
    // NaN daily target. The check makes the database refuse it. Deleting the check lets 0 through.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (tenant_id, location_id, working_days_per_week)
        values (${tenantId}, ${locationId}, 0)`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/convenio_config_working_days_ck/);
  });

  it("rejects an overtime_model outside the enum", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (tenant_id, location_id, overtime_model)
        values (${tenantId}, ${locationId}, 'annual_hours')`),
    );
    expect(pgErrorCode(error)).toBe("22P02"); // invalid_text_representation
  });

  it("allows only one convenio_config per (tenant, location)", async () => {
    const other = await seedLocation(suite.db, tenantId);
    await suite.db.execute(sql`
      insert into convenio_config (tenant_id, location_id) values (${tenantId}, ${other})`);
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (tenant_id, location_id) values (${tenantId}, ${other})`),
    );
    expect(pgErrorCode(error)).toBe("23505"); // unique_violation
    expect(pgErrorMessage(error)).toMatch(/convenio_config_tenant_location_uq/);
  });

  it("rejects a row whose location does not exist", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (tenant_id, location_id)
        values (${tenantId}, gen_random_uuid())`),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
  });
});
