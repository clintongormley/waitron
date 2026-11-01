import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { CORE_MIGRATIONS, newId, openVenueDatabase, type Database } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { applyMigrations } from "@waitron/migrations";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedPerson } from "../test/fixtures.js";
import { appendToChain, readChain } from "./chain.js";
import { computeEntryHash, verifyChain } from "./chain-hash.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { attendanceMail, attendanceQuestions } from "./schema/attendance.js";

const appendOnlyTables = ["time_entries", "pay_period_closures"];
const previousFolder = mkdtempSync(join(tmpdir(), "a1268-workforce-before-"));
mkdirSync(join(previousFolder, "meta"));
const journal = JSON.parse(
  readFileSync(join(WORKFORCE_MIGRATIONS.migrationsFolder, "meta/_journal.json"), "utf8"),
) as { entries: { tag: string }[] };
journal.entries = journal.entries.slice(0, 12);
writeFileSync(join(previousFolder, "meta/_journal.json"), JSON.stringify(journal));
for (const { tag } of journal.entries)
  copyFileSync(
    join(WORKFORCE_MIGRATIONS.migrationsFolder, `${tag}.sql`),
    join(previousFolder, `${tag}.sql`),
  );
afterAll(() => rmSync(previousFolder, { recursive: true, force: true }));

const before = [
  CORE_MIGRATIONS,
  IDENTITY_MIGRATIONS,
  { ...WORKFORCE_MIGRATIONS, migrationsFolder: previousFolder, appendOnlyTables },
];
const after = [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, { ...WORKFORCE_MIGRATIONS, appendOnlyTables }];

async function withVenue(body: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a1268-venue-"));
  try {
    await applyMigrations(directory, before);
    await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function onVenue<T>(directory: string, body: (db: Database) => Promise<T>): Promise<T> {
  const store = await openVenueDatabase(directory);
  try {
    return await body(store.venue);
  } finally {
    await store.close();
  }
}

async function seedPlace(db: Database) {
  await seedTenant(db);
  const personId = await seedPerson(db);
  const place = await seedLocation(db);
  const nodeId = await seedNode(db, brandLocationId(place));
  return { personId, place, nodeId };
}

/** Every row and every schema object, to show a refused migration changed nothing. */
function snapshot(db: Database) {
  const tables = db
    .execute<{ name: string }>(
      sql`select name from sqlite_schema where type = 'table' and name not glob 'sqlite_*' order by name`,
    )
    .rows.map((row) => row.name);
  const rows: Record<string, unknown> = {};
  for (const name of tables)
    rows[name] = db.execute(sql`select * from ${sql.identifier(name)} order by rowid`).rows;
  const schema = db.execute(sql`
    select name, sql from sqlite_schema
    where type in ('table', 'index', 'trigger') and name not glob 'waitron_change_*'
    order by name`).rows;
  return { rows, schema };
}

function columns(db: Database, table: string) {
  return db
    .execute<{ name: string; notnull: number }>(
      sql`select name, "notnull" from pragma_table_info(${table})`,
    )
    .rows.map((row) => ({ name: row.name, notnull: row.notnull }));
}

const refused = {
  code: "migrations.apply_failed",
  cause: {
    message: expect.stringContaining("DROP TABLE"),
    cause: { message: "FOREIGN KEY constraint failed" },
  },
};

it("migrates a venue with no working-time rows and keeps its append-only triggers", async () => {
  await withVenue(async (directory) => {
    const { personId, nodeId } = await onVenue(directory, seedPlace);

    await applyMigrations(directory, after);

    await onVenue(directory, async (db) => {
      for (const table of ["time_entries", "pay_period_closures", "workforce_chains"])
        expect(columns(db, table).map((c) => c.name)).not.toContain("location_id");
      expect(columns(db, "attendance_response_commands")).toContainEqual({
        name: "location_id",
        notnull: 0,
      });
      expect(
        db.execute(sql`select name from sqlite_schema where name like '__new_%'`).rows,
      ).toEqual([]);
      const triggers = db
        .execute<{ tbl_name: string }>(
          sql`select tbl_name from sqlite_schema where type = 'trigger'
              and tbl_name in ('time_entries', 'pay_period_closures') order by tbl_name`,
        )
        .rows.map((row) => row.tbl_name);
      expect(triggers).toEqual([
        "pay_period_closures",
        "pay_period_closures",
        "time_entries",
        "time_entries",
      ]);
      const appended = await db.transaction((tx) =>
        appendToChain(
          tx,
          { nodeId },
          {
            personId,
            entryKind: "in",
            eventAt: "2026-01-06T09:00:00Z",
            eventOffsetMinutes: 0,
            recordedByPersonId: personId,
            origin: jobOrigin("dashboard"),
          },
        ),
      );
      expect(appended.sequenceNo).toBe(1);
      expect(verifyChain(await readChain(db, { nodeId }))).toEqual({ ok: true });
    });
  });
});

it("refuses a venue that recorded a clock entry and changes nothing", async () => {
  await withVenue(async (directory) => {
    const snapshotBefore = await onVenue(directory, async (db) => {
      const { personId, place, nodeId } = await seedPlace(db);
      const ids = [newId(), newId()];
      let prevEntryHash: string | null = null;
      for (const [index, entryKind] of (["in", "out"] as const).entries()) {
        const recordedAt = `2026-01-05T17:00:0${index}.000Z`;
        const eventAt = index === 0 ? "2026-01-05T09:00:00.000Z" : "2026-01-05T17:00:00.000Z";
        const entryHash = computeEntryHash({
          sequenceNo: index + 1,
          personId,
          nodeId,
          entryKind,
          eventAt,
          recordedAt,
          eventOffsetMinutes: 0,
          recordedByPersonId: personId,
          capturedBySource: "dashboard",
          capturedByDeviceId: null,
          correctsEntryId: null,
          correctionReason: null,
          correctionStatus: null,
          correctionActorId: null,
          prevEntryHash,
        });
        // Raw inserts: today's writer cannot run on this older schema.
        await db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, captured_by_source, recorded_at, entry_hash, prev_entry_hash,
          sequence_no, is_first_entry
        ) values (
          ${ids[index]}, ${personId}, ${place}, ${nodeId}, ${entryKind}, ${eventAt}, 0,
          ${personId}, 'dashboard', ${recordedAt}, ${entryHash}, ${prevEntryHash},
          ${index + 1}, ${index === 0 ? 1 : 0}
        )`);
        prevEntryHash = entryHash;
      }
      await db.execute(sql`
      insert into workforce_chains (
        node_id, location_id, sequence_no, last_entry_id, last_entry_hash, last_recorded_at, updated_at
      ) values (
        ${nodeId}, ${place}, 2, ${ids[1]}, ${prevEntryHash},
        '2026-01-05T17:00:01.000Z', '2026-01-05T17:00:01.000Z'
      )`);
      return snapshot(db);
    });

    await expect(applyMigrations(directory, after)).rejects.toMatchObject(refused);

    await onVenue(directory, async (db) => {
      expect(snapshot(db)).toEqual(snapshotBefore);
      expect(columns(db, "time_entries").map((c) => c.name)).toContain("location_id");
    });
  });
});

it("refuses a venue holding an attendance question with a reminder email", async () => {
  await withVenue(async (directory) => {
    const snapshotBefore = await onVenue(directory, async (db) => {
      const { personId, place } = await seedPlace(db);
      const [question] = await db
        .insert(attendanceQuestions)
        .values({
          personId,
          locationId: place,
          businessDay: "2026-01-06",
          startAt: "2026-01-06T04:00:00.000Z",
          endAt: "2026-01-07T04:00:00.000Z",
          shiftKey: "rota:retained",
          kind: "missing-times",
          missingKinds: ["in", "out"],
          evidenceKeys: ["rota:retained"],
          createdAt: "2026-01-07T04:00:00.000Z",
        })
        .returning({ id: attendanceQuestions.id });
      await db.insert(attendanceMail).values({
        questionId: question!.id,
        status: "sent",
        outcome: "sent",
        recipient: "ana@example.test",
        nextAttemptAt: "2026-01-07T05:00:00.000Z",
      });
      return snapshot(db);
    });

    await expect(applyMigrations(directory, after)).rejects.toMatchObject(refused);

    await onVenue(directory, async (db) => expect(snapshot(db)).toEqual(snapshotBefore));
  });
});
