// A real SQLite venue directory, because the behaviour under test is drizzle's watermark
// arithmetic against a real journal table — a mocked handle would assert only that the mock was
// called. No container: the engine is a file.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrations } from "./apply.js";

/** Matches `appliedSchemaVersion`'s journal-table pattern, and belongs to no shipped set. */
const TABLE = "__drizzle_migrations_probe";
const scratch: string[] = [];

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

/**
 * Two migrations of our own rather than the core set's files.
 *
 * The core set ships ONE migration today, and this suite needs a second entry to put below a
 * watermark — an assertion resting on core shipping two would break the day core is regenerated as
 * a single baseline again. What is under test is drizzle's own `max(created_at)` arithmetic and
 * this package's count check, neither of which reads what the SQL says.
 */
const MIGRATIONS: { entry: JournalEntry; sql: string }[] = [
  {
    entry: { idx: 0, version: "6", when: 1_000_000_000_000, tag: "0000_first", breakpoints: true },
    sql: "CREATE TABLE `probe_first` (`id` integer PRIMARY KEY NOT NULL);",
  },
  {
    entry: { idx: 1, version: "6", when: 2_000_000_000_000, tag: "0001_second", breakpoints: true },
    sql: "CREATE TABLE `probe_second` (`id` integer PRIMARY KEY NOT NULL);",
  },
];

/** A migrations folder carrying the given entries, each with its own `.sql` file. */
function folderOf(entries: readonly JournalEntry[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-complete-"));
  scratch.push(dir);
  mkdirSync(join(dir, "meta"));
  for (const entry of entries) {
    const migration = MIGRATIONS.find((candidate) => candidate.entry.tag === entry.tag)!;
    writeFileSync(join(dir, `${entry.tag}.sql`), migration.sql);
  }
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, 2),
  );
  return dir;
}

/** A fresh, empty venue directory. */
function freshVenue(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-venue-"));
  scratch.push(dir);
  return dir;
}

/**
 * Journal rows in `directory`'s venue file — one per migration drizzle actually applied.
 *
 * Opened and closed around each read rather than held for the suite: `applyMigrations` opens the
 * same two files itself, and a reader left open is a second connection competing for them.
 */
async function journalRows(directory: string): Promise<number> {
  const store = await openVenueDatabase(directory);
  try {
    return store.venue.all<{ n: number }>(
      sql.raw(`select cast(count(*) as int) as n from "${TABLE}"`),
    )[0]!.n;
  } finally {
    await store.close();
  }
}

describe("applyMigrations refuses to report success on an incomplete set", () => {
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it("throws migrations.incomplete when drizzle's watermark skipped a migration", async () => {
    const venue = freshVenue();
    const [first, second] = MIGRATIONS.map((migration) => migration.entry);
    // A database migrated by a folder whose ONE entry carries a HIGH `when` …
    await applyMigrations(venue, [
      {
        migrationsFolder: folderOf([{ ...first!, when: 9_000_000_000_000 }]),
        migrationsTable: TABLE,
      },
    ]);
    // … then handed a folder whose second entry sits BELOW that watermark. Drizzle applies nothing
    // and raises nothing; this is exactly the shape that skipped five core migrations in silence.
    await expect(
      applyMigrations(venue, [
        {
          migrationsFolder: folderOf([
            { ...first!, when: 9_000_000_000_000 },
            { ...second!, when: 1 },
          ]),
          migrationsTable: TABLE,
        },
      ]),
    ).rejects.toMatchObject({ code: "migrations.incomplete" });
  });

  it("resolves for a set that applied completely — the control", async () => {
    const venue = freshVenue();
    const folder = folderOf(MIGRATIONS.map((migration) => migration.entry));
    await expect(
      applyMigrations(venue, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    ).resolves.toBeUndefined();
    expect(await journalRows(venue)).toBe(2);
    // And again, idempotently: a re-run applies nothing and must still be complete, or every second
    // boot of a healthy box would throw. The row count is asserted on BOTH sides so this is a
    // measurement rather than a pair of answers that look alike: an idempotent re-run that resolved
    // because it silently re-applied both migrations would read 4 here.
    await expect(
      applyMigrations(venue, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    ).resolves.toBeUndefined();
    expect(await journalRows(venue)).toBe(2);
  });

  it("resolves for a database holding MORE journal rows than the folder ships", async () => {
    // The other direction, pinned because the comparison is `applied < expected` rather than
    // `!==` on purpose: a journal row this image ships no migration for is a database migrated by a
    // NEWER image, which is a different fault with its own code and its own remedy
    // (`provisioning.database_ahead`). Naming it "incomplete" here — with `applied 3, expected 2` —
    // would put a misleading count in front of the one reader who cannot debug it, and would take
    // the case away from the check that CAN name it.
    const venue = freshVenue();
    const folder = folderOf(MIGRATIONS.map((migration) => migration.entry));
    await applyMigrations(venue, [{ migrationsFolder: folder, migrationsTable: TABLE }]);
    const store = await openVenueDatabase(venue);
    try {
      // The artefact a newer image leaves behind: a journal row, ahead of every shipped `when`.
      store.venue.run(
        sql.raw(
          `insert into "${TABLE}" ("hash", "created_at") values ('${"f".repeat(64)}', 9999999999999)`,
        ),
      );
    } finally {
      await store.close();
    }
    await expect(
      applyMigrations(venue, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    ).resolves.toBeUndefined();
    expect(await journalRows(venue)).toBe(3);
  });
});
