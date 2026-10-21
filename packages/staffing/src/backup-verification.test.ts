import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, kitchenStations, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { validateBackupVerificationContribution } from "@waitron/module";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  seasons,
  specialDays,
  specialDayDates,
} from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS, shifts } from "@waitron/workforce";
import { STAFFING_BACKUP_VERIFICATION as OWNER } from "./index.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import { STAFFING_CLASSIFICATION } from "./classification.js";
import {
  staffRoles,
  personStaffRoles,
  staffingDays,
  staffingBlocks,
  shiftAssignments,
} from "./schema/staffing.js";
const prerequisites = [
  CORE_MIGRATIONS,
  CATALOGUE_MIGRATIONS,
  VENUE_SERVICE_MIGRATIONS,
  IDENTITY_MIGRATIONS,
  WORKFORCE_MIGRATIONS,
];
const original = useVenueDb({ migrations: [...prerequisites, STAFFING_MIGRATIONS] });
const restored = useVenueDb({ migrations: [...prerequisites, STAFFING_MIGRATIONS] });
const absent = useVenueDb({ migrations: prerequisites });
beforeEach(async () => {
  for (const suite of [original, restored]) {
    const db = suite.db;
    await db.insert(locations).values({
      id: "venue",
      name: "Venue",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    });
    await db.insert(persons).values({
      id: "person",
      displayName: "Suspended person",
      status: "suspended",
      createdAt: "2026-10-20T08:00:00.000Z",
    });
    await db.insert(departments).values({
      id: "department",
      locationId: "venue",
      name: "Inactive department",
      tradingName: "Recorded business",
      active: false,
      createdAt: "2026-10-20T08:00:00.000Z",
    });
    await db
      .insert(seasons)
      .values({ id: "season", locationId: "venue", name: "Summer", startsOn: "06-01" });
    await db.insert(staffRoles).values({ id: "role", locationId: "venue", name: "Cook" });
    await db.insert(personStaffRoles).values({ personId: "person", staffRoleId: "role" });
    await db
      .insert(staffingDays)
      .values({ id: "day", departmentId: "department", seasonId: "season", weekday: 1 });
    await db.insert(staffingBlocks).values({
      id: "block",
      dayId: "day",
      staffRoleId: "role",
      headcount: 2,
      startsAt: "12:00:00",
      endsAt: "16:00:00",
    });
    await db.insert(shifts).values({
      id: "shift",
      personId: "person",
      locationId: "venue",
      startsAt: "2026-10-20T12:00:00.000Z",
      endsAt: "2026-10-20T16:00:00.000Z",
      startsOffsetMinutes: 0,
      endsOffsetMinutes: 0,
      createdAt: "2026-10-20T08:00:00.000Z",
    });
    await db
      .insert(shiftAssignments)
      .values({ shiftId: "shift", departmentId: "department", staffRoleId: "role" });
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

describe("staffing backup evidence", () => {
  it("covers inactive populated state without recomputing work", async () => {
    expect(await run()).toEqual(passed);
  });
  it("declares all staffing data and no secret entry or effects", () => {
    expect(OWNER).toBeDefined();
    const owner = validateBackupVerificationContribution(OWNER);
    expect(owner.data).toEqual({
      kind: "custom",
      tables: STAFFING_CLASSIFICATION.map((c) => c.table),
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
    "update staff_roles set name='Changed role'",
    "delete from person_staff_roles",
    "update staffing_days set weekday=2",
    "update staffing_blocks set headcount=3",
    "delete from shift_assignments",
  ])("preserves every staffing table: %s", async (statement) => {
    expect(await run()).toEqual(passed);
    await corrupt(restored.db, statement);
    expect((await run()).status).toBe("invalid");
  });
  it.each([
    "update person_staff_roles set person_id='missing'",
    "update person_staff_roles set staff_role_id='missing'",
    "update staffing_days set department_id='missing'",
    "update staffing_days set season_id='missing'",
    "update staffing_blocks set day_id='missing'",
    "update staffing_blocks set staff_role_id='missing'",
    "update shift_assignments set shift_id='missing'",
    "update shift_assignments set staff_role_id='missing'",
    "update shift_assignments set department_id='missing'",
  ])("checks assignment role area and person references: %s", async (statement) => {
    for (const db of [original.db, restored.db]) await corrupt(db, statement);
    expect((await run()).status).toBe("invalid");
  });
  it.each([
    "update staff_roles set name=''",
    "update staff_roles set colour='unknown'",
    "update staffing_days set department_id=null",
    "update staffing_days set weekday=7",
    "update staffing_days set weekday=null",
    "update staffing_blocks set headcount=0",
    "update staffing_blocks set headcount=51",
    "update staffing_blocks set headcount=1.5",
    "update staffing_blocks set starts_at='25:00:00'",
    "update staffing_blocks set ends_at='12:01:00'",
    "update staffing_blocks set starts_at='16:00:00'",
    "update shift_assignments set department_id=null",
  ])("checks stored staffing shapes on both copies: %s", async (statement) => {
    for (const db of [original.db, restored.db]) await corrupt(db, statement);
    expect((await run()).status).toBe("invalid");
  });
  it.each(["before", "after"])("checks %s references independently", async (side) => {
    expect(await run()).toEqual(passed);
    expect(
      (
        await run(
          side === "before" ? { wrap: hideTable("persons") } : { wrapAfter: hideTable("persons") },
        )
      ).status,
    ).toBe("invalid");
  });
  it("accepts empty and unassigned state with missing optional parents", async () => {
    for (const db of [original.db, restored.db]) {
      db.run(sql`delete from shift_assignments`);
      db.run(sql`delete from person_staff_roles`);
    }
    expect(await run({ wrap: hideTable("persons") })).toEqual(passed);
  });
  it("preserves station and special-day staffing and overnight blocks", async () => {
    for (const suite of [original, restored]) {
      const db = suite.db;
      await db
        .insert(kitchenStations)
        .values({ id: "station", locationId: "venue", name: "Grill" });
      await db.insert(specialDays).values({ id: "special", locationId: "venue", name: "Holiday" });
      await db
        .insert(specialDayDates)
        .values({ id: "date", specialDayId: "special", locationId: "venue", date: "2026-10-20" });
      await corrupt(
        db,
        "update staffing_days set department_id=null,station_id='station',season_id=null,weekday=null,special_day_date_id='date'",
      );
      await corrupt(db, "update shift_assignments set department_id=null,station_id='station'");
      await corrupt(db, "update staffing_blocks set starts_at='22:00:00',ends_at='02:00:00'");
    }
    expect(await run()).toEqual(passed);
  });
  it("zero schema cannot hide staffing state", async () => {
    expect((await run({ sourceSchema: 0 })).status).toBe("invalid");
  });
  it("accepts honest zero and refuses invented target data", async () => {
    for (const table of [
      "shift_assignments",
      "staffing_blocks",
      "staffing_days",
      "person_staff_roles",
      "staff_roles",
    ])
      await corrupt(restored.db, `delete from "${table}"`);
    expect(await run({ absent: true, sourceSchema: 0 })).toEqual(passed);
    await restored.db
      .insert(staffRoles)
      .values({ id: "invented", locationId: "venue", name: "Invented role" });
    expect((await run({ absent: true, sourceSchema: 0 })).status).toBe("invalid");
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
