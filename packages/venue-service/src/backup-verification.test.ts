import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_CLASSIFICATION, CORE_MIGRATIONS, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { validateBackupVerificationContribution } from "@waitron/module";
import { VENUE_SERVICE_BACKUP_VERIFICATION as OWNER } from "./index.js";
import { VENUE_SERVICE_TABLES } from "./classification.js";

/** This module's share of core's classification, which holds its tables. */
const VENUE_SERVICE_CLASSIFICATION = CORE_CLASSIFICATION.filter(({ table }) =>
  (VENUE_SERVICE_TABLES as readonly string[]).includes(table),
);
const migrations = [CORE_MIGRATIONS];
const original = useVenueDb({ migrations });
const restored = useVenueDb({ migrations });
const absent = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  // A source from before these tables existed: core's set now creates them, so they are dropped.
  setup: async (db) => {
    for (const table of [...VENUE_SERVICE_TABLES].reverse())
      db.run(sql.raw(`drop table "${table}"`));
  },
});
beforeEach(() => {
  for (const db of [original.db, restored.db]) {
    db.run(
      sql`insert into settings (module, version, revision, doc, updated_at) values ('venue', 1, 1, '{"privacyNoticeUrl":null,"privacyEmail":null,"name":"Venue","addressLine1":null,"addressLine2":null,"postalCode":null,"city":null,"province":null,"invoiceLocales":["en"],"contentLanguages":null,"defaultContentLanguage":null,"holidayArea":null,"fiscalTerritory":"ES-common"}', '2026-10-20T08:00:00.000Z'), ('business_day', 1, 1, '{"timeZone":"Europe/Madrid"}', '2026-10-20T08:00:00.000Z') on conflict (module) do nothing`,
    );
    db.run(
      "insert into day_cutover_changes (effective_business_day, day_cutover) values ('2000-01-01', '06:00:00') on conflict (effective_business_day) do nothing",
    );
    db.run(
      sql`insert into nodes (id,name,created_at) values ('source','Source','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into departments (id, name, trading_name, created_at) values ('department', 'Current department', 'Current business', '2026-10-20T08:00:00.000Z'),('other','Other department','Other business','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into floor_zones (id,name,department_id,created_at) values ('zone','Room','department','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into menus (id,name,created_at,updated_at) values ('menu','Current menu','2026-10-20T08:00:00.000Z','2026-10-20T08:00:00.000Z')`,
    );
    db.run(
      sql`insert into menu_periods (id,department_id,name,menu_id) values ('period','department','Lunch','menu')`,
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
  it("retains live and staged service rows", async () => {
    expect(await run()).toEqual(passed);
  });
  it("declares every service table and no extra obligations", () => {
    const owner = validateBackupVerificationContribution(OWNER);
    expect(owner.data).toEqual({
      kind: "custom",
      tables: VENUE_SERVICE_CLASSIFICATION.map((c) => c.table),
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
    "update departments set trading_name='Changed business'",
    "update menu_periods set name='Changed period'",
  ])("never replaces historical context with current config: %s", async (statement) => {
    expect(await run()).toEqual(passed);
    await corrupt(restored.db, statement);
    expect((await run()).status).toBe("invalid");
  });
  it.each(["update menu_periods set menu_id='missing'"])(
    "checks live and staged service references on both copies: %s",
    async (statement) => {
      expect(await run()).toEqual(passed);
      for (const db of [original.db, restored.db]) await corrupt(db, statement);
      expect((await run()).status).toBe("invalid");
    },
  );
  it("checks source references separately from the migrated copy", async () => {
    expect(await run()).toEqual(passed);
    expect((await run({ wrap: hideTable("menus") })).status).toBe("invalid");
  });
  it("checks migrated references independently", async () => {
    expect(await run()).toEqual(passed);
    expect((await run({ wrapAfter: hideTable("menus") })).status).toBe("invalid");
  });
  it("zero schema cannot hide service data", async () => {
    expect((await run({ sourceSchema: 0 })).status).toBe("invalid");
  });
  it("accepts empty target-only service but refuses invented state", async () => {
    for (const table of ["menu_periods", "departments"])
      await corrupt(restored.db, `delete from "${table}"`);
    expect(await run({ absent: true, sourceSchema: 0 })).toEqual(passed);
    restored.db.run(sql`insert into special_days (id,name) values ('invented','Invented day')`);
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
