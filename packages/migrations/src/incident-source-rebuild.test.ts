import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { openVenueDatabase, type Database } from "@waitron/db";
import { isAppError, sqliteFailureOf } from "@waitron/shared";
import { applyMigrations } from "./apply.js";
import { manifestSets, migrationOptionsFor, type VenueMigrationOptions } from "./manifest.js";

const OPEN_DASHBOARD = "dddddddd-0000-4000-8000-000000000001";
const OPEN_FILING = "dddddddd-0000-4000-8000-000000000002";
const HANDLED_DASHBOARD = "dddddddd-0000-4000-8000-000000000003";
const SECOND_OPEN_DASHBOARD = "dddddddd-0000-4000-8000-000000000004";
const DETECTED = "2026-10-28T10:00:00.000Z";
const HANDLED = "2026-10-28T11:00:00.000Z";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** Core's set, its journal cut before the `incidents` rebuild for the backup source. */
function coreBeforeRebuild(core: VenueMigrationOptions): VenueMigrationOptions {
  const staged = scratchDir("wt-incident-source-core-");
  cpSync(core.migrationsFolder, staged, { recursive: true });
  const path = join(staged, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(path, "utf8")) as { entries: { tag: string }[] };
  const rebuild = journal.entries.findIndex(({ tag }) => tag.endsWith("_incident_backup_source"));
  expect(rebuild).toBeGreaterThan(0);
  expect(journal.entries[rebuild + 1]?.tag).toMatch(/_incident_backup_source_restore_index$/);
  journal.entries = journal.entries.slice(0, rebuild);
  writeFileSync(path, JSON.stringify(journal));
  // Today's append-only list names tables later migrations create; keep only the cut's own.
  const created = new Set(
    journal.entries.flatMap(({ tag }) =>
      [...readFileSync(join(staged, `${tag}.sql`), "utf8").matchAll(/CREATE TABLE `(\w+)`/g)].map(
        (match) => match[1]!,
      ),
    ),
  );
  return {
    ...core,
    migrationsFolder: staged,
    appendOnlyTables: (core.appendOnlyTables ?? []).filter((table) => created.has(table)),
  };
}

async function inVenue<T>(directory: string, body: (db: Database) => Promise<T> | T): Promise<T> {
  const store = await openVenueDatabase(directory);
  try {
    return await body(store.venue);
  } finally {
    await store.close();
  }
}

function insertIncident(db: Database, id: string, source: string, acknowledgedAt: string | null) {
  db.run(sql`insert into incidents (id, source, code, severity, detected_at, acknowledged_at)
    values (${id}, ${source}, 'demo.probe', 'warning', ${DETECTED}, ${acknowledgedAt})`);
}

async function venueBeforeRebuild() {
  const sets = migrationOptionsFor(manifestSets(), null);
  const core = sets.find((set) => set.migrationsTable === "__drizzle_migrations_db")!;
  const directory = scratchDir("wt-incident-source-venue-");
  await applyMigrations(directory, [coreBeforeRebuild(core)]);
  return { directory, sets };
}

it("carries open and handled incidents across the rebuild and the index's return in one start", async () => {
  const { directory, sets } = await venueBeforeRebuild();
  await inVenue(directory, (db) => {
    insertIncident(db, OPEN_DASHBOARD, "dashboard", null);
    insertIncident(db, OPEN_FILING, "fiscal_filing", null);
    insertIncident(db, HANDLED_DASHBOARD, "dashboard", HANDLED);
  });

  await applyMigrations(directory, sets);

  await inVenue(directory, (db) => {
    expect(db.all(sql`select id, source, acknowledged_at from incidents order by id`)).toEqual([
      { id: OPEN_DASHBOARD, source: "dashboard", acknowledged_at: null },
      { id: OPEN_FILING, source: "fiscal_filing", acknowledged_at: null },
      { id: HANDLED_DASHBOARD, source: "dashboard", acknowledged_at: HANDLED },
    ]);
    expect(
      db.all(
        sql`select name from sqlite_master where type = 'index' and name = 'incidents_open_dedup'`,
      ),
    ).toEqual([{ name: "incidents_open_dedup" }]);
  });
});

it("is refused at the index's return when two open incidents share a source and code with no device or sale", async () => {
  const { directory, sets } = await venueBeforeRebuild();
  await inVenue(directory, (db) => {
    // The index the cut already carries refuses the pair, so it goes first.
    db.run(sql`drop index incidents_open_dedup`);
    insertIncident(db, OPEN_DASHBOARD, "dashboard", null);
    insertIncident(db, SECOND_OPEN_DASHBOARD, "dashboard", null);
  });

  let error: unknown;
  try {
    await applyMigrations(directory, sets);
  } catch (caught) {
    error = caught;
  }

  expect(error, "the migrate was not refused").toBeDefined();
  expect(isAppError(error) && error.code).toBe("migrations.apply_failed");
  expect(sqliteFailureOf(error)?.message).toMatch(
    "UNIQUE constraint failed: index 'incidents_open_dedup'",
  );
});
