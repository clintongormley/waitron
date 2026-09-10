// Real PostgreSQL, never PGlite: the defect is PostgreSQL's own enum-safety rule inside drizzle's
// single migrate transaction, and the watermark arithmetic under test is drizzle's against real
// Postgres (CLAUDE.md §4).
//
// It boots its OWN container rather than cloning the package's shared template, because every case
// needs a database at a DIFFERENT migration point — which is the one thing a template of the
// finished schema cannot provide.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { databaseUrl, startPostgresContainer, type StartedContainer } from "./testing/postgres.js";

const CORE_DRIZZLE = fileURLToPath(new URL("../drizzle", import.meta.url));
const JOURNAL_TABLE = "__drizzle_migrations_db";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const journal = JSON.parse(readFileSync(join(CORE_DRIZZLE, "meta", "_journal.json"), "utf8")) as {
  entries: JournalEntry[];
} & Record<string, unknown>;

/** Every temp folder this suite makes, so `afterAll` can remove them. */
const scratch: string[] = [];

/** A migrations folder carrying only the first `n` journal entries — the shape an older image ships. */
function folderWithFirst(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-upgrade-"));
  scratch.push(dir);
  mkdirSync(join(dir, "meta"));
  const entries = journal.entries.slice(0, n);
  for (const entry of entries) {
    copyFileSync(join(CORE_DRIZZLE, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return dir;
}

/** The full shipped set, built once: every case migrates to it and its contents never vary. */
const HEAD_FOLDER = folderWithFirst(journal.entries.length);

/**
 * The release points that cannot upgrade completely, DERIVED from the journal rather than listed.
 *
 * Drizzle's watermark is `max(created_at)` over the journal TABLE, fixed before the batch starts, and
 * it applies a migration only when that watermark is below the migration's `when`. So a database
 * stopped at release point `at` completes only if every entry from `at` onward carries a `when` above
 * the highest `when` among entries 0…at-1. `meta/_journal.json` has a non-monotonic region (entries
 * 2–6 sit below entry 1's), which makes some points incapable of completing; the derivation below
 * finds exactly those, so this list cannot drift by eye from the journal it describes and empties
 * itself if the journal is ever repaired.
 *
 * That non-monotonicity is unfixable by editing the journal, and the argument needs no experiment: a
 * database at release point 2 and one at release point 3 both carry entry 1's `when` as their
 * watermark, because entry 2's RECORDED value sits below it. Point 2 needs entry 2's `when` ABOVE
 * that watermark or `0002` is skipped, while point 3 needs it AT OR BELOW or `0002` re-applies —
 * contradictory for any single value. Two candidate repairs were also run and each failed in one of
 * those two directions, one of them with `42P01: relation "deployment" does not exist` rather than
 * the re-apply an earlier draft of this comment claimed for both
 * (`docs/superpowers/plans/2026-09-10-core-migration-upgrade.md`;
 * `scripts/journal-monotonic.test.ts` carries the same argument).
 *
 * The skip is LOUD but not REPAIRED. `applyMigrations` counts applied migrations against shipped
 * ones and throws `migrations.incomplete` (`packages/migrations/src/apply.ts`), so a database at one
 * of these points refuses to boot instead of running on a schema it does not have — but it still
 * cannot upgrade, and repairing that means a squashed baseline, a separate decision. This suite
 * drives drizzle through `runMigrations` rather than `applyMigrations`, so it sees the raw skip and
 * these points stay excluded. `scripts/journal-monotonic.test.ts` is what stops a NEW set acquiring
 * the same shape.
 */
const NON_MONOTONIC_POINTS = journal.entries
  .map((_, at) => at)
  .filter((at) => {
    const highestBefore = Math.max(
      Number.NEGATIVE_INFINITY,
      ...journal.entries.slice(0, at).map((entry) => entry.when),
    );
    return journal.entries.slice(at).some((entry) => entry.when <= highestBefore);
  });

describe("the core migration set upgrades an existing database", () => {
  let container: StartedContainer;

  beforeAll(async () => {
    container = await startPostgresContainer();
  }, 180_000);

  afterAll(async () => {
    // Guarded: `startPostgresContainer` may have thrown, leaving `container` unassigned.
    if (container !== undefined) await container.stop();
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  /** Migrate a new database to entry `at`, then to HEAD. Returns the journal row count, or throws. */
  async function upgradeFrom(at: number, databaseName: string): Promise<number> {
    const admin = await createPostgresDb(container.uri, { max: 1 });
    try {
      // A utility statement PostgreSQL will not bind, so the name goes through `sql.identifier`
      // rather than concatenation (CLAUDE.md §3).
      await admin.execute(sql`create database ${sql.identifier(databaseName)}`);
    } finally {
      await admin.close();
    }
    const db = await createPostgresDb(databaseUrl(container.uri, databaseName), { max: 1 });
    try {
      if (at > 0) {
        await runMigrations(db, {
          migrationsFolder: folderWithFirst(at),
          migrationsTable: JOURNAL_TABLE,
        });
      }
      await runMigrations(db, { migrationsFolder: HEAD_FOLDER, migrationsTable: JOURNAL_TABLE });
      // The row count is read directly rather than through `appliedSchemaVersion`: that helper lives
      // in `@waitron/migrations`, which depends on `@waitron/db`, so importing it here would be a
      // circular dependency.
      const counted = await db.execute(
        sql`select count(*)::int as n from ${sql.identifier(JOURNAL_TABLE)}`,
      );
      return (counted.rows[0] as { n: number }).n;
    } finally {
      await db.close();
    }
  }

  it("applies every shipped migration, from every release point the journal allows", async () => {
    // The assertion is the ROW COUNT, not "it did not throw": the failure this set is capable of is
    // a SILENT skip, which a no-throw assertion passes (measured — a candidate fix left 10 of 15
    // migrations unapplied and raised nothing).
    const total = journal.entries.length;
    const points = Array.from({ length: total }, (_, at) => at).filter(
      (at) => !NON_MONOTONIC_POINTS.includes(at),
    );
    for (const at of points) {
      expect([at, await upgradeFrom(at, `wt_upgrade_${at}`)]).toEqual([at, total]);
    }
  }, 300_000);

  it("still migrates a virgin database — the control, and the only shape CI exercises", async () => {
    expect(await upgradeFrom(0, "wt_upgrade_virgin")).toBe(journal.entries.length);
  }, 180_000);
});
