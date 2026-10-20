import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { validateBackupVerificationContribution } from "@waitron/module";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { VENUE_SERVICE_BACKUP_VERIFICATION as OWNER } from "./index.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_CLASSIFICATION } from "./classification.js";
const migrations = [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS];
const original = useVenueDb({ migrations });
const restored = useVenueDb({ migrations });
const absent = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
beforeEach(() => {
  for (const db of [original.db, restored.db]) {
    db.run(
      sql`insert into locations (id,name,invoice_locales,operation_description) values ('venue','Venue','["en"]','Hospitality')`,
    );
    db.run(
      sql`insert into nodes (id,location_id,name,created_at) values ('source','venue','Source','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into invoice_series (id,node_id,code,next_number) values ('series','source','TEST',2)`,
    );
    db.run(
      sql`insert into sales (id,source,series_id,node_id,invoice_number,issued_at,issued_offset_minutes,total,vat_breakdown,locale,invoice_locales,fiscal_backend,fiscal_state) values ('sale','operator_script','series','source',1,'2026-10-20T08:00:00.000Z',0,100,'[]','en','["en"]','none','not_applicable')`,
    );
    db.run(
      sql`insert into departments (id,location_id,name,trading_name,created_at) values ('department','venue','Current department','Current business','2026-10-20T08:00:00.000Z'),('other','venue','Other department','Other business','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into sale_receipt_headers (sale_id,department_id,trading_name,print_trading_name) values ('sale','department','Issued business',1)`,
    );
    db.run(
      sql`insert into floor_zones (id,location_id,name,created_at) values ('zone','venue','Room','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into working_orders (id,source,location_id,order_number,opened_at) values ('order','operator_script','venue',1,'2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into order_service_contexts (working_order_id,location_id,zone_id,department_id,service_mode) values ('order','venue','zone','department','table_tab')`,
    );
    db.run(
      sql`insert into catalogues (id,name,created_at,updated_at) values ('menu','Current menu','2026-10-20T08:00:00.000Z','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into menu_periods (id,department_id,name,menu_id) values ('period','department','Lunch','menu')`,
    );
    db.run(
      sql`insert into period_extensions (id,department_id,business_day,period_id,starts_at,ends_at) values ('extension','department','2026-10-20','period','10:00','14:00')`,
    );
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

describe("service backup evidence", () => {
  it("retains issued headers and live and staged service rows", async () => {
    expect(await run()).toEqual(passed);
  });
  it("declares every service table and no extra obligations", () => {
    const owner = validateBackupVerificationContribution(OWNER);
    expect(owner.data).toEqual({
      kind: "custom",
      tables: VENUE_SERVICE_CLASSIFICATION.map((c) => c.table),
      immutableTables: ["sale_receipt_headers"],
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
    "update sale_receipt_headers set trading_name='Current business'",
    "update sale_receipt_headers set print_trading_name=0",
    "update sale_receipt_headers set department_id='other'",
    "delete from sale_receipt_headers",
    "update departments set trading_name='Changed business'",
    "update order_service_contexts set service_mode='prepay'",
    "delete from order_service_contexts",
    "update menu_periods set name='Changed period'",
    "delete from period_extensions",
  ])("never replaces historical context with current config: %s", async (statement) => {
    expect(await run()).toEqual(passed);
    await corrupt(restored.db, statement);
    expect((await run()).status).toBe("invalid");
  });
  it.each([
    "update sale_receipt_headers set sale_id='missing'",
    "update order_service_contexts set working_order_id='missing'",
    "update order_service_contexts set zone_id='missing'",
    "update order_service_contexts set department_id='missing'",
    "update menu_periods set menu_id='missing'",
    "update period_extensions set department_id='other'",
    "update period_extensions set period_id='missing'",
  ])("checks live and staged service references on both copies: %s", async (statement) => {
    expect(await run()).toEqual(passed);
    for (const db of [original.db, restored.db]) await corrupt(db, statement);
    expect((await run()).status).toBe("invalid");
  });
  it("checks source references separately from the migrated copy", async () => {
    expect(await run()).toEqual(passed);
    expect((await run({ wrap: hideTable("sales") })).status).toBe("invalid");
  });
  it("allows a nullable historic department and empty nullable references", async () => {
    for (const db of [original.db, restored.db])
      await corrupt(db, "update sale_receipt_headers set department_id=null");
    expect(await run()).toEqual(passed);
  });
  it("checks migrated references independently", async () => {
    expect(await run()).toEqual(passed);
    expect((await run({ wrapAfter: hideTable("sales") })).status).toBe("invalid");
  });
  it("zero schema cannot hide issued evidence", async () => {
    expect((await run({ sourceSchema: 0 })).status).toBe("invalid");
  });
  it("accepts empty target-only service but refuses invented state", async () => {
    for (const table of [
      "period_extensions",
      "menu_periods",
      "order_service_contexts",
      "sale_receipt_headers",
      "departments",
    ])
      await corrupt(restored.db, `delete from "${table}"`);
    expect(await run({ absent: true, sourceSchema: 0 })).toEqual(passed);
    restored.db.run(sql`insert into service_settings (id) values (1)`);
    expect((await run({ absent: true })).status).toBe("invalid");
  });
  it("accepts an absent parent when no row references it", async () => {
    expect(await run()).toEqual(passed);
    expect(await run({ wrap: hideTable("kitchen_stations") })).toEqual(passed);
  });
  it("keeps query failures distinct from corruption", async () => {
    const failure = new Error("private unavailable read");
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
