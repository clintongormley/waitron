// A real SQLite venue directory, because what is under test is which of the two files drizzle
// writes a set's tables and journal into.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openVenueDatabase, tableExists } from "@waitron/db";
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

const MIGRATION = {
  entry: { idx: 0, version: "6", when: 1_000_000_000_000, tag: "0000_node", breakpoints: true },
  sql: "create table probe_node (id text primary key)",
};

/** A migrations folder carrying the given entries; every entry's file holds the one migration. */
function folderOf(entries: readonly JournalEntry[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-node-set-"));
  scratch.push(dir);
  mkdirSync(join(dir, "meta"));
  for (const entry of entries) writeFileSync(join(dir, `${entry.tag}.sql`), MIGRATION.sql);
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, 2),
  );
  return dir;
}

function freshVenue(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-venue-"));
  scratch.push(dir);
  return dir;
}

/**
 * Which tables each file holds. Opened and closed around the read: `applyMigrations` opens the same
 * two files itself.
 */
async function tablesIn(directory: string) {
  const store = await openVenueDatabase(directory);
  try {
    return {
      node: {
        table: await tableExists(store.node, "probe_node"),
        journal: await tableExists(store.node, TABLE),
      },
      venue: {
        table: await tableExists(store.venue, "probe_node"),
        journal: await tableExists(store.venue, TABLE),
      },
    };
  } finally {
    await store.close();
  }
}

describe("applyMigrations routes a set to the file it names", () => {
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it('applies a set marked database: "node" to node.db and records its journal there', async () => {
    const venue = freshVenue();
    await applyMigrations(venue, [
      { migrationsFolder: folderOf([MIGRATION.entry]), migrationsTable: TABLE, database: "node" },
    ]);
    expect(await tablesIn(venue)).toEqual({
      node: { table: true, journal: true },
      venue: { table: false, journal: false },
    });
  });

  // The control: the same set with no `database` lands in venue.db, so the case above is not
  // passing because of how the probe reads the files.
  it("applies a set that names no file to venue.db", async () => {
    const venue = freshVenue();
    await applyMigrations(venue, [
      { migrationsFolder: folderOf([MIGRATION.entry]), migrationsTable: TABLE },
    ]);
    expect(await tablesIn(venue)).toEqual({
      node: { table: false, journal: false },
      venue: { table: true, journal: true },
    });
  });

  // node.db is never given append-only triggers, so a node set naming such tables would leave them
  // unprotected while claiming otherwise. Refused before either file is written.
  it("refuses a node set that declares append-only tables, and migrates nothing", async () => {
    const venue = freshVenue();
    await expect(
      applyMigrations(venue, [
        {
          migrationsFolder: folderOf([MIGRATION.entry]),
          migrationsTable: TABLE,
          database: "node",
          appendOnlyTables: ["probe_node"],
        },
      ]),
    ).rejects.toMatchObject({
      code: "migrations.node_append_only",
      params: { set: TABLE, tables: ["probe_node"] },
    });
    expect(await tablesIn(venue)).toEqual({
      node: { table: false, journal: false },
      venue: { table: false, journal: false },
    });
  });

  it("accepts a node set that declares an empty append-only list", async () => {
    const venue = freshVenue();
    await applyMigrations(venue, [
      {
        migrationsFolder: folderOf([MIGRATION.entry]),
        migrationsTable: TABLE,
        database: "node",
        appendOnlyTables: [],
      },
    ]);
    expect((await tablesIn(venue)).node).toEqual({ table: true, journal: true });
  });

  it("refuses a short node set with migrations.incomplete", async () => {
    const venue = freshVenue();
    await applyMigrations(venue, [
      {
        migrationsFolder: folderOf([{ ...MIGRATION.entry, when: 9_000_000_000_000 }]),
        migrationsTable: TABLE,
        database: "node",
      },
    ]);
    // A second entry below the recorded watermark: drizzle applies nothing and raises nothing.
    await expect(
      applyMigrations(venue, [
        {
          migrationsFolder: folderOf([
            { ...MIGRATION.entry, when: 9_000_000_000_000 },
            { ...MIGRATION.entry, idx: 1, tag: "0001_node", when: 1 },
          ]),
          migrationsTable: TABLE,
          database: "node",
        },
      ]),
    ).rejects.toMatchObject({ code: "migrations.incomplete" });
  });
});
