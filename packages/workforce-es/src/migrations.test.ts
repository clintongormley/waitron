import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  isPgError,
  newId,
  nowIso,
  pgErrorMessage,
  refusalOn,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { convenioConfig } from "./schema/convenio-config.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
import { seedLocation } from "../test/fixtures.js";

/** The two columns whose value comes from the table's `$defaultFn` rather than from a SQL DEFAULT.
 * Drizzle runs those functions per insert, so a RAW insert has to supply them itself — without them
 * the statement is refused `NOT NULL constraint failed: convenio_config.id` (measured on
 * node:sqlite, Node v26.7.0). Every insert below is deliberately raw, because what it is proving is
 * the DEFAULT the MIGRATION declares for each rule column, not the value drizzle would send. */
function rowIdentity() {
  return sql`${newId()}, ${nowIso()}`;
}

let locationId: string;

const suite = useVenueDb({
  resetPerTest: false,
  // Core first — the tenants/locations foreign keys. Ordering across packages is the runtime's job
  // and nothing enforces it, so it is explicit here; this proves convenio_config applies core-first.
  migrations: [CORE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    locationId = await seedLocation(db);
  },
});

describe("the workforce-es (convenio_config) migration set", () => {
  it("defaults every rule to the ET statutory floor / today's default for a bare row", async () => {
    // A DEFAULT row — only location_id supplied. Every rule takes its column default,
    // which is exactly what lets D2.0 reproduce current behaviour: 5-day week, daily-accrual headline,
    // the ET guardrail limits, false split-break, and NULL premiums (never an invented figure).
    await suite.db.execute(sql`
      insert into convenio_config (id, created_at, location_id)
      values (${rowIdentity()}, ${locationId})`);
    const rows = await suite.db.execute<Record<string, unknown>>(sql`
      select working_days_per_week, overtime_model, reference_period_days, compensation_window_days,
        daily_target_minutes, max_weekly_minutes, min_inter_shift_rest_minutes,
        max_ordinary_daily_minutes, break_threshold_minutes, min_break_minutes, weekly_rest_minutes,
        annual_overtime_cap_hours, night_window_start_minute, night_window_end_minute,
        night_premium_pct, split_shift_premium
      from convenio_config where location_id = ${locationId}`);
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
      .from(convenioConfig)
      .where(eq(convenioConfig.locationId, locationId));
    expect(row!.breaksCountAsWorked).toBe(false);
  });

  it("rejects working_days_per_week outside 1..7 (the div-by-zero guard)", async () => {
    // The projection divides the contracted week by working_days_per_week, so zero would produce a
    // NaN daily target. The check makes the database refuse it. Deleting the check lets 0 through.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (id, created_at, location_id, working_days_per_week)
        values (${rowIdentity()}, ${locationId}, 0)`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/convenio_config_working_days_ck/);
  });

  it("rejects an overtime_model outside the enum", async () => {
    // The refusal the PostgreSQL enum TYPE performed on its own is now a named CHECK constraint on
    // a plain text column (`convenio-config.ts`'s `enumCheck`), so the class the engine reports is
    // a check violation rather than the old `22P02` invalid_text_representation. The constraint
    // name is asserted as well: a check-class assertion alone would also be satisfied by the
    // working-days check the case above drives.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (id, created_at, location_id, overtime_model)
        values (${rowIdentity()}, ${locationId}, 'annual_hours')`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/convenio_config_overtime_model_ck/);
  });

  it("allows only one convenio_config per location", async () => {
    const other = await seedLocation(suite.db);
    await suite.db.execute(sql`
      insert into convenio_config (id, created_at, location_id) values (${rowIdentity()}, ${other})`);
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (id, created_at, location_id)
        values (${rowIdentity()}, ${other})`),
    );
    // SQLite names the TABLE AND COLUMN a unique index was declared on, never the index's own
    // name, so the key is identified by its target here rather than by the string
    // `convenio_config_location_uq` (measured on node:sqlite, Node v26.7.0: the whole message is
    // `UNIQUE constraint failed: convenio_config.location_id`). `refusalOn` asks both halves —
    // the class and the key — on one layer of the wrapped error.
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "convenio_config",
        columns: ["location_id"],
      }),
    ).toBe(true);
  });

  it("rejects a row whose location does not exist", async () => {
    // A well-formed id that names no location. It is a literal rather than a generated one:
    // `gen_random_uuid()` is a PostgreSQL function, and the identity of the value does not matter
    // to what is being proven — only that no `locations` row carries it.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into convenio_config (id, created_at, location_id)
        values (${rowIdentity()}, '00000000-0000-4000-8000-000000000000')`),
    );
    // A foreign-key refusal names nothing on this engine — the whole message is
    // `FOREIGN KEY constraint failed` — so the class is all there is to assert.
    expect(isPgError(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});

// SQLite has no `information_schema` and no `pg_indexes`; the catalogue is reached through the
// PRAGMA functions instead. `pragma table_info` lists a table's columns and `pragma index_list` its
// indexes, with `pragma index_info` naming the columns one index keys on — which is what the old
// `indexdef` substring was being read for.
describe("convenio_config carries no tenant column", () => {
  it("has no tenant_id column", async () => {
    const rows = await suite.db.execute<{ name: string }>(
      sql`select name from pragma_table_info('convenio_config')`,
    );
    expect(rows.rows.map((r) => r.name).filter((name) => name === "tenant_id")).toEqual([]);
  });

  it("keys one row per location with convenio_config_location_uq, and no tenant index", async () => {
    const indexes = await suite.db.execute<{ name: string; unique: number }>(
      sql`select name, "unique" from pragma_index_list('convenio_config')`,
    );
    const byName = Object.fromEntries(indexes.rows.map((r) => [r.name, r]));
    expect(byName["convenio_config_location_uq"]?.unique).toBe(1);
    const keyed = await suite.db.execute<{ name: string }>(
      sql`select name from pragma_index_info('convenio_config_location_uq')`,
    );
    expect(keyed.rows.map((r) => r.name)).toEqual(["location_id"]);
    expect(Object.keys(byName).filter((name) => name.includes("tenant"))).toEqual([]);
  });
});
