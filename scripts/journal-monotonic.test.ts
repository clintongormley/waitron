import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every migration set's journal must be strictly increasing in `when`. Drizzle decides what to
 * apply from `max(created_at)` alone, never from a journal index, so an entry whose `when` sits at
 * or below one a database has already recorded is a migration that will never run — silently, with
 * no error.
 *
 * In `drizzle-orm@0.45.2`, `sqlite-core/dialect.js` is the dialect that runs
 * (`packages/db/src/migrate.ts` imports `drizzle-orm/better-sqlite3/migrator`).
 * `SQLiteSyncDialect.migrate` takes the watermark with
 * `SELECT id, hash, created_at FROM <table> ORDER BY created_at DESC LIMIT 1` (lines 653-655)
 * and applies a migration only when
 * `!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis` (line 660).
 * `SQLiteAsyncDialect.migrate` carries the same two statements at lines 690-692 and 696.
 *
 * WEAKER THAN ITS NAME: most sets are a single baseline entry, and a one-entry journal can never be
 * out of order, so those sets' cases hold BY CONSTRUCTION and are not evidence that any `when`
 * value is right. What is really exercised is `outOfOrder` itself, through the synthetic negative
 * control, the sets that carry more than one entry, and the anchor that every set's journal is on
 * disk.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "packages/migrations/migrations.manifest.json"), "utf8"),
) as { name: string; table: string; from: string }[];

interface JournalEntry {
  when: number;
  tag: string;
}

/**
 * Sets whose journal is already out of order: the EXACT entries, and the reason the set is still
 * here. Empty on purpose: no set is exempt.
 *
 * SHRINK THIS LIST, NEVER GROW IT. Its `entries` are asserted equal, so both directions fail — a
 * new collision, and a repair that leaves the pin stale.
 */
const KNOWN_NON_MONOTONIC = new Map<string, { entries: string[]; reason: string }>();

function journalPathOf(from: string): string {
  return join(resolve(join(ROOT, "packages/migrations"), from), "meta", "_journal.json");
}

/** A set's journal entries, or `[]` when the folder has moved — which the anchor below catches. */
function journalEntries(from: string): JournalEntry[] {
  const journalPath = journalPathOf(from);
  if (!existsSync(journalPath)) return [];
  return (JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] }).entries;
}

/** Every entry whose `when` can never apply, in journal order. */
function outOfOrder(entries: JournalEntry[]): string[] {
  const offences: string[] = [];
  let highest = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry.when <= highest) offences.push(`${entry.tag} (when ${entry.when})`);
    highest = Math.max(highest, entry.when);
  }
  return offences;
}

describe("every migration set's journal is strictly increasing", () => {
  // A set whose folder moves reads as zero entries, and zero entries are never out of order.
  it("discovers every set's journal (guards against a vacuous pass)", () => {
    for (const set of MANIFEST) {
      expect(existsSync(journalPathOf(set.from)), `${set.name}: no journal at ${set.from}`).toBe(
        true,
      );
    }
    // Loose floors, under today's numbers. The entry floor is a total over every set because most
    // sets carry a single entry.
    expect(MANIFEST.length).toBeGreaterThanOrEqual(10);
    const entryTotal = MANIFEST.reduce((total, set) => total + journalEntries(set.from).length, 0);
    expect(entryTotal).toBeGreaterThanOrEqual(8);
    // Growing the allowlist fails here as well as in its own case, deliberately.
    expect([...KNOWN_NON_MONOTONIC.keys()]).toEqual([]);
  });

  for (const set of MANIFEST) {
    it(`holds for the ${set.name} set`, () => {
      const known = KNOWN_NON_MONOTONIC.get(set.name);
      expect(
        outOfOrder(journalEntries(set.from)),
        known === undefined
          ? `${set.name}: a when value at or below one already recorded can never apply`
          : `${set.name}: its out-of-order entries are pinned exactly — a longer list is a NEW ` +
              `defect, a shorter one means the set was repaired, so delete its KNOWN_NON_MONOTONIC entry`,
      ).toEqual(known?.entries ?? []);
    });
  }

  it("reports a collision in a synthetic journal (negative control)", () => {
    // The two shapes that matter: a `when` EQUAL to an earlier one, and one BELOW an earlier one.
    const healthy: JournalEntry[] = [
      { when: 1_788_785_861_913, tag: "0000_baseline" },
      { when: 1_788_785_861_914, tag: "0001_second" },
      { when: 1_788_785_861_915, tag: "0002_third" },
    ];
    // The control in the other direction: a broken `outOfOrder` that reported every entry would
    // pass the two assertions below.
    expect(outOfOrder(healthy)).toEqual([]);

    const equalToPredecessor = healthy.map((entry, index) =>
      index === 2 ? { ...entry, when: healthy[1]!.when } : entry,
    );
    expect(outOfOrder(equalToPredecessor)).toEqual(["0002_third (when 1788785861914)"]);

    const belowPredecessor = healthy.map((entry, index) =>
      index === 1 ? { ...entry, when: 1 } : entry,
    );
    expect(outOfOrder(belowPredecessor)).toEqual(["0001_second (when 1)"]);
  });
});
