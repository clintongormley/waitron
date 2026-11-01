// A real venue directory, because what is under test is which of the two files the journal is read
// from.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database, type VenueDatabase } from "@waitron/db";
import { applyMigrations, type MigrationSetSource } from "@waitron/migrations";
import { assertNotAhead } from "./schema-ahead.js";

const TABLE = "__drizzle_migrations_probe";
const scratch: string[] = [];
let store: VenueDatabase | undefined;

/** A node set shipping one migration, in a folder of its own. */
function nodeSet(): MigrationSetSource {
  const from = mkdtempSync(join(tmpdir(), "wt-node-set-"));
  scratch.push(from);
  mkdirSync(join(from, "meta"));
  writeFileSync(join(from, "0000_node.sql"), "create table probe_node (id text primary key)");
  writeFileSync(
    join(from, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        { idx: 0, version: "6", when: 1_000_000_000_000, tag: "0000_node", breakpoints: true },
      ],
    }),
  );
  return { name: "probe", table: TABLE, from, database: "node" };
}

/** A venue directory with the node set applied to node.db, open. */
async function migrated(set: MigrationSetSource): Promise<VenueDatabase> {
  const directory = mkdtempSync(join(tmpdir(), "wt-venue-"));
  scratch.push(directory);
  await applyMigrations(directory, [
    { migrationsFolder: set.from, migrationsTable: set.table, database: "node" },
  ]);
  store = await openVenueDatabase(directory);
  return store;
}

/** What a newer image's extra migration leaves behind: a journal row this image ships no file for. */
async function recordUnknownMigration(db: Pick<Database, "execute">): Promise<void> {
  await db.execute(
    sql.raw(
      `create table if not exists "${TABLE}" (id integer primary key, hash text not null, created_at numeric)`,
    ),
  );
  await db.execute(
    sql.raw(
      `insert into "${TABLE}" (hash, created_at) values ('from-a-newer-image', 9999999999999)`,
    ),
  );
}

describe("a node set's journal is read from node.db", () => {
  afterEach(async () => {
    await store?.close();
    store = undefined;
  });
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a node file migrated by a newer image with provisioning.database_ahead", async () => {
    const set = nodeSet();
    const files = await migrated(set);
    await recordUnknownMigration(files.node);
    await expect(assertNotAhead(files, [set], null)).rejects.toMatchObject({
      code: "provisioning.database_ahead",
      params: { set: "probe", unknownMigrations: ["from-a-newer-image"] },
    });
  });

  // The control: the same row in venue.db is not the node set's journal.
  it("does not count an extra row in venue.db against the node set", async () => {
    const set = nodeSet();
    const files = await migrated(set);
    await recordUnknownMigration(files.venue);
    await expect(assertNotAhead(files, [set], null)).resolves.toBeUndefined();
  });
});
