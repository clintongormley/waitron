import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every migration set's journal must be strictly increasing in `when`. Drizzle decides what to apply
 * from `max(created_at)` alone, never from a journal index, so an entry whose `when` sits at or below
 * one a database has already recorded is a migration that will never run — silently, with no error.
 *
 * Read on 2026-09-21 in the installed `drizzle-orm@0.45.2`. Paths below start at that package's
 * root, because its `node_modules/.pnpm` directory name carries a peer-dependency hash; it is not
 * written out as a glob here, since a `*` followed by a slash would close this comment.
 * `sqlite-core/dialect.js` holds the dialect this tree's journals declare. `SQLiteSyncDialect.migrate`
 * takes the watermark with `SELECT id, hash, created_at FROM <table> ORDER BY created_at DESC LIMIT 1`
 * (lines 653-655) and applies a migration only when
 * `!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis` (line 660).
 * `SQLiteAsyncDialect.migrate` carries the same two statements at lines 690-692 and 696.
 * The SQLite dialect is the one that RUNS: `packages/db/src/migrate.ts` imports
 * `drizzle-orm/better-sqlite3/migrator`, and the PostgreSQL migrators it used to dispatch to went
 * with the storage switch. A `pg-core/dialect.js` citation stood here until 2026-09-22 and is gone
 * with them.
 *
 * WHAT THIS GUARD CHECKS TODAY, AND WHAT IT DOES NOT. Nearly every set is a single regenerated
 * SQLite baseline — `packages/db`, `packages/identity` and `packages/media` carry two entries each,
 * `packages/fiscal-none` none at all, and every other set exactly one (counted 2026-09-23 over the
 * journals on disk). A
 * one-entry journal can never be out of order, so those sets' cases below hold BY CONSTRUCTION: they
 * are not evidence that any `when` value in the tree is right, and a reader must not take them as
 * such. What is really exercised today is `outOfOrder` itself, pinned by the synthetic negative
 * control, the three sets that do carry a second entry, and the anti-vacuity anchor: every set's
 * journal is on disk, and they yield more entries BETWEEN them than sets. The tree-scanning half
 * becomes a real check for a given set the moment it gains a SECOND migration —
 * and it is in place for that push rather than written after it.
 *
 * Root project, same reasoning as scripts/enum-add-value-safety.test.ts: it reads the whole tree, so
 * a package-resident copy would only run when its own package is in scope and most pushes never
 * reach packages/db.
 *
 * An allowlisted set's out-of-order entries are pinned EXACTLY rather than counted, so a NEW
 * collision fails even in a set that already carries old ones (review, 2026-09-10). The allowlist is
 * empty today — see `KNOWN_NON_MONOTONIC`.
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
 * here. A Map with a per-entry reason rather than a bare array, as `module-seams.test.ts`'s
 * `DEFERRED_RUNTIME_PASS` does (CLAUDE.md §3).
 *
 * EMPTY ON PURPOSE, and empty is the STRONG state rather than an unfinished one: no set in the tree
 * is exempt from the check below. It is not an oversight either — a set whose journal really is out
 * of order MUST be listed here, because the assertion pins a listed set's entries exactly and a
 * missing entry fails.
 *
 * It held one entry until the SQLite regeneration: `core`, whose entries 2 to 6 carried `when` values
 * below entry 1's, which left core release points 1 to 6 unable to reach HEAD at all (measured
 * 2026-09-10; the receipt, including the two candidate repairs that failed, is the prose deleted by
 * the commit that emptied this map). Those entries are gone because the regeneration replaced core's whole history
 * with one baseline — not because the old journal was repaired in place.
 *
 * SHRINK THIS LIST, NEVER GROW IT. An entry is not a licence: it records a defect that cannot be
 * repaired, only contained. Its `entries` are asserted equal, so both directions fail — a new
 * collision, and a repair that leaves the pin stale.
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
  // Vacuous-pass anchor, in the siblings' style (classification-complete, errors-reachable): a set
  // whose folder moves reads as zero entries, and zero entries are never out of order — identical to
  // a healthy set. Pin that the scan really found the journals and really read entries out of them.
  it("discovers every set's journal (guards against a vacuous pass)", () => {
    for (const set of MANIFEST) {
      expect(existsSync(journalPathOf(set.from)), `${set.name}: no journal at ${set.from}`).toBe(
        true,
      );
    }
    // Loose floors, every one of them strictly under today's number: a count is a receipt that goes
    // stale (CLAUDE.md §7), and a floor sitting exactly on the tree fails the day the tree shrinks
    // by one for a good reason.
    //
    // The entry floor is a TOTAL over every set rather than core's own count, because after the
    // SQLite regeneration a per-set floor has nowhere honest to sit: every set carries exactly one
    // entry, so 1 is the tree itself and 0 asserts nothing. Measured 2026-09-21: 12 entries across
    // 13 sets, `packages/fiscal-none` declaring none.
    expect(MANIFEST.length).toBeGreaterThanOrEqual(10);
    const entryTotal = MANIFEST.reduce((total, set) => total + journalEntries(set.from).length, 0);
    expect(entryTotal).toBeGreaterThanOrEqual(8);
    // Growing the allowlist fails here as well as in its own case, which is what "never grow it"
    // costs a would-be grower: two deliberate edits rather than one.
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
    // Built by hand rather than taken from the tree. It used to collide the last real entry of the
    // core journal with its predecessor, which stopped being possible when every set became a single
    // baseline — and a control that cannot run is a check nobody has. The shapes below are the two
    // that matter: a `when` EQUAL to an earlier one, which is what the earlier "at least one
    // out-of-order entry" assertion swallowed, and a `when` BELOW an earlier one, which is the shape
    // core's journal carried.
    const healthy: JournalEntry[] = [
      { when: 1_788_785_861_913, tag: "0000_baseline" },
      { when: 1_788_785_861_914, tag: "0001_second" },
      { when: 1_788_785_861_915, tag: "0002_third" },
    ];
    // The control in the other direction: without this, a broken `outOfOrder` that reported every
    // entry would pass the two assertions below for the wrong reason (CLAUDE.md §1).
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
