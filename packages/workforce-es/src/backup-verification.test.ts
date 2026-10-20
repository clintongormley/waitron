import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { validateBackupVerificationContribution } from "@waitron/module";
import { WORKFORCE_ES_BACKUP_VERIFICATION as OWNER } from "./index.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
import { convenioConfig } from "./schema/convenio-config.js";
import { WORKFORCE_ES_CLASSIFICATION } from "./classification.js";
const migrations = [CORE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS];
const original = useVenueDb({ migrations });
const restored = useVenueDb({ migrations });
const absent = useVenueDb({ migrations: [CORE_MIGRATIONS] });
beforeEach(async () => {
  for (const suite of [original, restored]) {
    await suite.db.insert(locations).values({
      id: "venue",
      name: "Venue",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    });
    await suite.db.insert(convenioConfig).values({
      id: "agreement",
      locationId: "venue",
      workingDaysPerWeek: 4,
      overtimeModel: "period_net",
      referencePeriodDays: 90,
      compensationWindowDays: 30,
      nightPremiumPct: 1500,
      splitShiftPremium: 500,
      createdAt: "2026-10-20T08:00:00.000Z",
    });
  }
});
const passed = { status: "passed", checks: [{ code: "data", status: "passed" }] };
async function run(
  options: {
    absent?: boolean;
    sourceSchema?: number;
    wrap?: (q: BackupQuery) => BackupQuery;
    wrapAfter?: (q: BackupQuery) => BackupQuery;
  } = {},
) {
  const path = (db: Database) =>
    db.all<{ file: string }>(sql`pragma database_list`).find((r) => r.file.endsWith("venue.db"))!
      .file;
  expect(OWNER).toBeDefined();
  const before = await openBackupQuery(path(options.absent ? absent.db : original.db));
  try {
    const after = await openBackupQuery(path(restored.db));
    try {
      return await OWNER.verifyRestoredData({
        before: options.wrap?.(before.query) ?? before.query,
        after: options.wrapAfter?.(after.query) ?? after.query,
        entries: {
          async read() {
            throw new Error("No entries declared");
          },
        },
        source: {
          nodeId: "source",
          locationId: "venue",
          environment: "preproduction",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
        sourceSchema: options.sourceSchema ?? 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}
async function corrupt(db: Database, statement: string) {
  const triggers = db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_schema where type='trigger'`,
  );
  for (const row of triggers) db.run(sql.raw(`drop trigger "${row.name.replaceAll('"', '""')}"`));
  db.run(sql`pragma foreign_keys=off`);
  db.run(sql`pragma ignore_check_constraints=on`);
  try {
    db.run(sql.raw(statement));
  } finally {
    db.run(sql`pragma ignore_check_constraints=off`);
    db.run(sql`pragma foreign_keys=on`);
    for (const row of triggers) db.run(sql.raw(row.sql));
  }
}
function hideTable(table: string) {
  return (q: BackupQuery): BackupQuery => ({
    async *rows(statement, values) {
      if (statement.includes("sqlite_schema") && values?.[0] === table) return;
      yield* q.rows(statement, values);
    },
  });
}

describe("agreement backup evidence", () => {
  it("checks agreement config without recomputing work", async () => {
    expect(await run()).toEqual(passed);
  });
  it("declares all data and no secret entry or effects", () => {
    expect(OWNER).toBeDefined();
    const owner = validateBackupVerificationContribution(OWNER);
    expect(owner.data).toEqual({
      kind: "custom",
      tables: WORKFORCE_ES_CLASSIFICATION.map((c) => c.table),
      immutableTables: [],
      checks: ["data"],
    });
    expect([
      owner.secrets,
      owner.entries,
      owner.effects,
      owner.publicEvidenceDigest,
      owner.zeroSchema,
      owner.targetOnly,
    ]).toEqual([[], [], [], null, "absent_tables_and_entries", "empty_after_migration"]);
  });
  it.each([
    "working_days_per_week=5",
    "overtime_model='daily_accrual'",
    "reference_period_days=null",
    "compensation_window_days=null",
    "daily_target_minutes=420",
    "max_weekly_minutes=2300",
    "min_inter_shift_rest_minutes=800",
    "max_ordinary_daily_minutes=480",
    "break_threshold_minutes=300",
    "min_break_minutes=30",
    "weekly_rest_minutes=2200",
    "annual_overtime_cap_hours=70",
    "night_window_start_minute=1300",
    "night_window_end_minute=400",
    "night_premium_pct=1600",
    "split_shift_premium=600",
    "breaks_count_as_worked=1",
    "created_at='2026-10-21T00:00:00.000Z'",
  ])("preserves stored configuration exactly: %s", async (change) => {
    expect(await run()).toEqual(passed);
    await corrupt(restored.db, `update convenio_config set ${change}`);
    expect((await run()).status).toBe("invalid");
  });
  it.each([
    "working_days_per_week=0",
    "working_days_per_week=8",
    "working_days_per_week=4.5",
    "max_weekly_minutes='bad'",
    "night_premium_pct=x'01'",
    "breaks_count_as_worked=2",
    "created_at='bad'",
  ])("checks stored configuration shapes on both copies: %s", async (change) => {
    for (const db of [original.db, restored.db])
      await corrupt(db, `update convenio_config set ${change}`);
    expect((await run()).status).toBe("invalid");
  });
  it("keeps unknown overtime semantics unsupported", async () => {
    for (const db of [original.db, restored.db])
      await corrupt(db, "update convenio_config set overtime_model='future_model'");
    expect((await run()).status).toBe("unsupported");
  });
  it("keeps a future format found only after migration unsupported", async () => {
    expect(
      (
        await run({
          wrapAfter: (q) => ({
            async *rows(statement, values) {
              for await (const row of q.rows(statement, values))
                yield statement === "select * from convenio_config"
                  ? { ...row, overtime_model: "future_model" }
                  : row;
            },
          }),
        })
      ).status,
    ).toBe("unsupported");
  });
  it("refuses a non-text overtime model", async () => {
    for (const db of [original.db, restored.db])
      await corrupt(db, "update convenio_config set overtime_model=x'01'");
    expect((await run()).status).toBe("invalid");
  });
  it("refuses missing location references on both copies", async () => {
    for (const db of [original.db, restored.db])
      await corrupt(db, "update convenio_config set location_id='missing'");
    expect((await run()).status).toBe("invalid");
  });
  it.each(["before", "after"])("checks %s references independently", async (side) => {
    expect(await run()).toEqual(passed);
    expect(
      (
        await run(
          side === "before"
            ? { wrap: hideTable("locations") }
            : { wrapAfter: hideTable("locations") },
        )
      ).status,
    ).toBe("invalid");
  });
  it("covers inactive populated state and refuses false zero", async () => {
    expect((await run({ sourceSchema: 0 })).status).toBe("invalid");
  });
  it("accepts honest zero and refuses invented target state", async () => {
    restored.db.run(sql`delete from convenio_config`);
    expect(await run({ absent: true, sourceSchema: 0 })).toEqual(passed);
    await restored.db
      .insert(convenioConfig)
      .values({ id: "invented", locationId: "venue", createdAt: "2026-10-20T08:00:00.000Z" });
    expect((await run({ absent: true, sourceSchema: 0 })).status).toBe("invalid");
  });
  it("accepts no config and no parent reference", async () => {
    for (const db of [original.db, restored.db]) db.run(sql`delete from convenio_config`);
    expect(await run({ wrap: hideTable("locations") })).toEqual(passed);
  });
  it("keeps unexpected query errors unavailable", async () => {
    const failure = new Error("private query unavailable");
    await expect(
      run({
        wrap: (q) => ({
          async *rows(statement, values) {
            if (statement.includes("not exists")) throw failure;
            yield* q.rows(statement, values);
          },
        }),
      }),
    ).rejects.toThrow(failure);
  });
});
