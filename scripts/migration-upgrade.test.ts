import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { installChangeFeed } from "../packages/db/src/change-feed.js";
import { openVenueDatabase } from "../packages/db/src/client.js";
import { applyMigrations } from "../packages/migrations/src/apply.js";
import {
  migrationOptionsFor,
  resolveMigrationsFolder,
} from "../packages/migrations/src/manifest.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";

/**
 * One database upgraded the way a box is: every shipped migration applied in date order, with what
 * boot does after migrating (the change feed) done between each step. A fresh database migrated in
 * one go never meets a trigger a previous boot left behind.
 *
 * Weaker than its name in four ways. Every set's first migration, and everything up to
 * {@link FLOOR}, is applied together, because the baselines were regenerated out of date order
 * (core's is dated after the sets that build on it), and because core's `0003` rebuilds `products`
 * while a trigger whose BODY reads `products` exists (media's `products_media_image_fk_parent_delete`).
 * The change feed at each step is TODAY's list, less whatever that step's schema lacks, and the
 * append-only tables are TODAY's list filtered to the tables the PREVIOUS step left, so a table a
 * step creates has no append-only trigger while the NEXT step migrates, and gets one only after it; neither is the list the image of
 * that date carried. The tables hold no rows, so a migration that fails only on data — a new
 * `not null` column, a table rebuild whose drop cascades — passes here. And it asserts only that
 * each step does not throw, so a trigger a rebuild silently drops is not seen.
 */

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Applied together with the baselines rather than stepped onto. It rebuilds `products` while a
 * trigger whose BODY reads `products` exists (media's `products_media_image_fk_parent_delete`), and
 * SQLite refuses the rename that ends the rebuild.
 */
const FLOOR = { set: "core", tag: "0003_variant_inherited_nullable" };

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function readJournal(folder: string): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
}

describe("upgrading a venue one migration at a time", () => {
  it("applies every shipped migration on top of the change feed the step before installed", async () => {
    const sets = orderedMigrationSets(ALL_MODULES);
    const sources = ALL_MODULES.flatMap((module) => module.changes ?? []);

    const root = mkdtempSync(join(tmpdir(), "wt-migration-upgrade-"));
    scratch.push(root);
    const staged = join(root, "migrations");
    const venueDir = join(root, "venue");
    const journals = new Map<string, ReturnType<typeof readJournal>>();
    for (const set of sets) {
      const from = resolveMigrationsFolder(set, null);
      cpSync(from, join(staged, set.name), { recursive: true });
      journals.set(set.name, readJournal(from));
    }

    const floorEntry = journals.get(FLOOR.set)?.entries.find((entry) => entry.tag === FLOOR.tag);
    expect(floorEntry).toBeDefined();
    const floor = floorEntry?.when ?? 0;

    const cuts = [
      ...new Set(
        [...journals.values()].flatMap((journal) =>
          journal.entries.filter((entry) => entry.when > floor).map((entry) => entry.when),
        ),
      ),
    ].sort((a, b) => a - b);
    expect(cuts.length).toBeGreaterThan(1);

    let existing = new Set<string>();
    for (const cut of [floor, ...cuts]) {
      // Only tables the step before already had: a set's declared list is today's, and some of its
      // tables are created by later migrations.
      const options = migrationOptionsFor(sets, staged).map((set) => ({
        ...set,
        appendOnlyTables: (set.appendOnlyTables ?? []).filter((table) => existing.has(table)),
      }));
      for (const [name, journal] of journals) {
        const entries = journal.entries.filter((entry) => entry.idx === 0 || entry.when <= cut);
        writeFileSync(
          join(staged, name, "meta", "_journal.json"),
          JSON.stringify({ ...journal, entries }),
        );
      }
      await applyMigrations(venueDir, options);

      const store = await openVenueDatabase(venueDir);
      try {
        const present = sources.filter((source) => {
          const columns = new Set(
            store.venue
              .all<{ name: string }>(`select name from pragma_table_info('${source.table}')`)
              .map((column) => column.name),
          );
          return columns.size > 0 && (source.related ?? []).every((rel) => columns.has(rel.column));
        });
        await installChangeFeed(store.venue, present);
        existing = new Set(
          store.venue
            .all<{ name: string }>(`select name from sqlite_master where type = 'table'`)
            .map((table) => table.name),
        );
      } finally {
        await store.close();
      }
    }
  }, 120_000);
});
