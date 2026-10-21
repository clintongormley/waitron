import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { validateBackupVerificationContribution } from "@waitron/module";
import { ADJUSTMENTS_BACKUP_VERIFICATION as OWNER } from "./index.js";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { ADJUSTMENTS_CLASSIFICATION } from "./classification.js";
const migrations = [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS];
const original = useVenueDb({ migrations });
const restored = useVenueDb({ migrations });
const absent = useVenueDb({ migrations: [CORE_MIGRATIONS] });
beforeEach(() => {
  for (const db of [original.db, restored.db]) {
    db.run(
      sql`insert into locations (id,name,invoice_locales,operation_description) values ('venue','Venue','["en"]','Hospitality')`,
    );
    db.run(
      sql`insert into working_orders (id,source,location_id,order_number,opened_at) values ('order','operator_script','venue',1,'2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into adjustment_reasons (id,name,names,kind,actions,apply_roles,approver_roles,position,created_at) values ('reason','Current reason','{"en":"Current reason"}','comp','["comp"]','["manager"]','["admin"]',0,'2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into adjustment_settings (id,updated_at) values (1,'2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into adjustments (id,working_order_id,line_id,splits,comped_extras,line_name,line_quantity,line_list_unit_price,credited_to,reason_id,reason_name,policy_snapshot,action,quantity,percent_bp,before_amount,after_amount,reduction,nominal_value,requested_by,approved_by,note,stage,by_guest,created_at) values ('adjustment','order','deleted-line','[{"from":"old","to":"split"}]','["deleted-extra"]','Recorded dish',2000,500,'former-person','removed-reason','Issued reason','{"actions":["cancel"],"applyRoles":[],"approverRoles":[],"maxPercentBp":null,"maxAmount":null,"noteRequired":true}','cancel',1000,null,1000,500,500,500,'requester','approver','Recorded note','fired',1,'2026-10-20T08:00:00.000Z')`,
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

describe("adjustment backup evidence", () => {
  it("retains issued adjustments after reason line and staff removal", async () => {
    expect(await run()).toEqual(passed);
  });
  it("declares every adjustment table without extra obligations", () => {
    const owner = validateBackupVerificationContribution(OWNER);
    expect(owner.data).toEqual({
      kind: "custom",
      tables: ADJUSTMENTS_CLASSIFICATION.map((c) => c.table),
      immutableTables: ["adjustments"],
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
    "reason_name='Current reason'",
    "policy_snapshot='{}'",
    "line_name='Current dish'",
    "splits='[]'",
    "comped_extras='[]'",
    "line_id='replacement'",
    "line_quantity=3000",
    "line_list_unit_price=600",
    "credited_to=null",
    "reason_id='reason'",
    "action='comp'",
    "quantity=2000",
    "percent_bp=1000",
    "before_amount=2000",
    "after_amount=600",
    "reduction=400",
    "nominal_value=600",
    "requested_by='other'",
    "approved_by=null",
    "note='Changed note'",
    "stage='served'",
    "by_guest=0",
    "created_at='2026-10-21T00:00:00.000Z'",
  ])("never replaces historical context with current config: %s", async (change) => {
    expect(await run()).toEqual(passed);
    await corrupt(restored.db, `update adjustments set ${change}`);
    expect((await run()).status).toBe("invalid");
  });
  it.each([
    "delete from adjustments",
    "update adjustment_reasons set name='Changed reason'",
    "update adjustment_settings set max_bill_comp=500",
  ])("compares all retained rows: %s", async (statement) => {
    await corrupt(restored.db, statement);
    expect((await run()).status).toBe("invalid");
  });
  it("checks the retained order reference on both copies", async () => {
    expect(await run()).toEqual(passed);
    for (const db of [original.db, restored.db])
      await corrupt(db, "update adjustments set working_order_id='missing'");
    expect((await run()).status).toBe("invalid");
  });
  it("checks source references separately from migrated references", async () => {
    expect(await run()).toEqual(passed);
    expect((await run({ wrap: hideTable("working_orders") })).status).toBe("invalid");
  });
  it("checks migrated references independently", async () => {
    expect(await run()).toEqual(passed);
    expect((await run({ wrapAfter: hideTable("working_orders") })).status).toBe("invalid");
  });
  it("zero schema cannot hide issued evidence", async () => {
    expect((await run({ sourceSchema: 0 })).status).toBe("invalid");
  });
  it("accepts honest empty target-only data and refuses invented state", async () => {
    for (const table of ["adjustments", "adjustment_reasons", "adjustment_settings"])
      await corrupt(restored.db, `delete from "${table}"`);
    expect(await run({ absent: true, sourceSchema: 0 })).toEqual(passed);
    restored.db.run(
      sql`insert into adjustment_settings (id,updated_at) values (1,'2026-10-20T08:00:00.000Z')`,
    );
    expect((await run({ absent: true })).status).toBe("invalid");
  });
  it("accepts an absent parent when no row references it", async () => {
    for (const db of [original.db, restored.db]) await corrupt(db, "delete from adjustments");
    expect(await run()).toEqual(passed);
    expect(await run({ wrap: hideTable("working_orders") })).toEqual(passed);
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
