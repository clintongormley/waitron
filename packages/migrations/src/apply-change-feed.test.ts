import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { installChangeFeed, openVenueDatabase } from "@waitron/db";
import { applyMigrations } from "./apply.js";
import type { VenueMigrationOptions } from "./manifest.js";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const MIGRATIONS = [
  {
    tag: "0000_widgets",
    sql:
      "CREATE TABLE `change_log` (`id` text PRIMARY KEY NOT NULL, `payload` text NOT NULL);\n" +
      "--> statement-breakpoint\n" +
      "CREATE TABLE `widgets` (`id` text PRIMARY KEY NOT NULL, `colour` text, `size` integer);",
  },
  { tag: "0001_drop_size", sql: "ALTER TABLE `widgets` DROP COLUMN `size`;" },
];

/** A drizzle migrations folder holding the first `count` of {@link MIGRATIONS}. */
function writeSet(folder: string, count: number): void {
  mkdirSync(join(folder, "meta"), { recursive: true });
  const entries = MIGRATIONS.slice(0, count).map((migration, idx) => {
    writeFileSync(join(folder, `${migration.tag}.sql`), migration.sql);
    return { idx, version: "6", when: 1_000 + idx, tag: migration.tag, breakpoints: true };
  });
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }),
  );
}

describe("applyMigrations on a venue whose change feed is already installed", () => {
  it("drops a column from a table the change feed watches", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-migrate-change-feed-"));
    scratch.push(root);
    const venueDir = join(root, "venue");
    const folder = join(root, "set");
    const options: VenueMigrationOptions[] = [
      { migrationsFolder: folder, migrationsTable: "__drizzle_migrations_fixture" },
    ];

    // What a box that booted once holds: the first migration, then boot's change feed over it.
    writeSet(folder, 1);
    await applyMigrations(venueDir, options);
    const first = await openVenueDatabase(venueDir);
    try {
      await installChangeFeed(first.venue, [{ table: "widgets", type: "widget" }]);
    } finally {
      await first.close();
    }

    writeSet(folder, 2);
    await applyMigrations(venueDir, options);

    const after = await openVenueDatabase(venueDir);
    try {
      const columns = after.venue
        .execute<{ name: string }>(sql`select name from pragma_table_info('widgets')`)
        .rows.map((row) => row.name);
      expect(columns).toEqual(["id", "colour"]);
    } finally {
      await after.close();
    }
  });
});
