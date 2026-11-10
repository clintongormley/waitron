import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  checkFailed,
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  nowIso,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { convenioConfig } from "./schema/convenio-config.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";

function rowIdentity() {
  return sql`${1}, ${nowIso()}`;
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
  },
});

describe("the workforce-es (convenio_config) migration set", () => {
  it("defaults every rule to the ET statutory floor / today's default for a bare row", async () => {
    await suite.db.execute(sql`
      insert into convenio_config (id, created_at)
      values (${rowIdentity()})`);
    const rows = await suite.db.execute<Record<string, unknown>>(sql`
      select working_days_per_week, overtime_model, reference_period_days, compensation_window_days,
        daily_target_minutes, max_weekly_minutes, min_inter_shift_rest_minutes,
        max_ordinary_daily_minutes, break_threshold_minutes, min_break_minutes, weekly_rest_minutes,
        annual_overtime_cap_hours, night_window_start_minute, night_window_end_minute,
        night_premium_pct, split_shift_premium
      from convenio_config where id = 1`);
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
    });
    // The seventeenth default is read through its own column rather than in the raw projection
    // above. SQLite has no boolean type: `breaks_count_as_worked` is stored as 0 or 1 and a raw
    // read hands back the number, so what says that the stored default MEANS false is the `flag`
    // column's read mapping (`packages/db/src/schema/columns.ts`).
    const [row] = await suite.db
      .select({ breaksCountAsWorked: convenioConfig.breaksCountAsWorked })
      .from(convenioConfig);
    expect(row!.breaksCountAsWorked).toBe(false);
  });

  it("rejects working_days_per_week outside 1..7 (the div-by-zero guard)", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (id, created_at, working_days_per_week)
        values (${rowIdentity()}, 0)`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/convenio_config_working_days_ck/);
  });

  it("rejects an overtime_model outside the enum", async () => {
    // The constraint name is asserted as well: a check-class assertion alone would also be
    // satisfied by the working-days check the case above drives.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (id, created_at, overtime_model)
        values (${rowIdentity()}, 'annual_hours')`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/convenio_config_overtime_model_ck/);
  });
});

describe("convenio_config carries no tenant column", () => {
  it("has no tenant_id column", async () => {
    const rows = await suite.db.execute<{ name: string }>(
      sql`select name from pragma_table_info('convenio_config')`,
    );
    expect(rows.rows.map((r) => r.name).filter((name) => name === "tenant_id")).toEqual([]);
  });

  it("carries no tenant index", async () => {
    const indexes = await suite.db.execute<{ name: string }>(
      sql`select name from pragma_index_list('convenio_config')`,
    );
    expect(indexes.rows.map((row) => row.name).filter((name) => name.includes("tenant"))).toEqual(
      [],
    );
  });
});

describe("one venue's agreement", () => {
  const single = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS] });
  it("keeps one convenio row", async () => {
    await seedTenant(single.db);
    const refused = await captureError(() => single.db.insert(convenioConfig).values({ id: 2 }));
    expect(checkFailed(refused, "convenio_config_singleton_ck")).toBe(true);
    await single.db.insert(convenioConfig).values({ id: 1 });
    const duplicate = await captureError(() => single.db.insert(convenioConfig).values({ id: 1 }));
    expect(isRefusal(duplicate, UNIQUE_VIOLATION)).toBe(true);
    expect(await single.db.select({ id: convenioConfig.id }).from(convenioConfig)).toEqual([
      { id: 1 },
    ]);
  });
});
