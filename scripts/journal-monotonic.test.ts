import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every migration set's journal must be strictly increasing in `when`. Drizzle decides what to apply
 * from `max(created_at)` alone, never from a journal index
 * (drizzle-orm@0.45.2/pg-core/dialect.js:56-62), so an entry whose `when` sits at or below one a
 * database has already recorded is a migration that will never run — silently, with no error.
 *
 * Root project, same reasoning as scripts/enum-add-value-safety.test.ts: it reads the whole tree, so
 * a package-resident copy would only run when its own package is in scope and most pushes never
 * reach packages/db.
 *
 * The out-of-order entries of an allowlisted set are pinned EXACTLY rather than counted, so a NEW
 * collision fails even in a set that already carries old ones. Receipt: with the earlier "at least
 * one" assertion, setting entry 14's `when` equal to entry 13's left this guard at 12 passed, while
 * a real PostgreSQL upgrade from point 14 then recorded 14 of 15 migrations and skipped 0014
 * (review, 2026-09-10).
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
 * SHRINK THIS LIST, NEVER GROW IT. An entry is not a licence: it records a defect that cannot be
 * repaired, only contained. Its `entries` are asserted equal, so both directions fail — a new
 * collision, and a repair that leaves the pin stale.
 */
const KNOWN_NON_MONOTONIC = new Map<string, { entries: string[]; reason: string }>([
  [
    "core",
    {
      entries: [
        "0002_device_profile_form_factor (when 1788769912531)",
        "0003_drop_device_kind (when 1788771238830)",
        "0004_device_binding_rule_sql (when 1788771251214)",
        "0005_device_profile_form_factor_locked_sql (when 1788772418605)",
        "0006_tills_name_unique_sql (when 1788775712562)",
      ],
      reason:
        "Entries 2 to 6 carry `when` values below entry 1's, so drizzle's `max(created_at)` " +
        "watermark SKIPS them for a database whose highest recorded value is entry 1's. Measured " +
        "2026-09-10: a database at entry 1 upgrading to HEAD applies 10 of 15 migrations and " +
        "raises nothing. It cannot be fixed by editing the journal — raising the out-of-order " +
        "entries makes points 3 to 7 RE-APPLY a migration they already ran and fail, and lowering " +
        "the earlier ones changes nothing because the database stored the old value, not the " +
        "file's. The residual skip is made loud at runtime instead, by the boot-failure " +
        "diagnosability work; fixing it properly means a squashed baseline, a separate decision.",
    },
  ],
]);

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

const CORE = MANIFEST.find((set) => set.name === "core")!;

describe("every migration set's journal is strictly increasing", () => {
  // Vacuous-pass anchor, in the siblings' style (classification-complete, errors-reachable): a set
  // whose folder moves reads as zero entries, and zero entries are never out of order — identical to
  // a healthy set. Pin that the scan really found the journals, and that the one allowlisted set is
  // the one the tree still carries.
  it("discovers every set's journal (guards against a vacuous pass)", () => {
    for (const set of MANIFEST) {
      expect(existsSync(journalPathOf(set.from)), `${set.name}: no journal at ${set.from}`).toBe(
        true,
      );
    }
    // Loose floors, well under today's numbers: a count is a receipt that goes stale (CLAUDE.md §7).
    expect(MANIFEST.length).toBeGreaterThanOrEqual(10);
    expect(journalEntries(CORE.from).length).toBeGreaterThanOrEqual(15);
    expect([...KNOWN_NON_MONOTONIC.keys()]).toEqual(["core"]);
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

  it("reports a NEW collision inside an allowlisted set (negative control)", () => {
    // The exact shape the earlier "at least one out-of-order entry" assertion swallowed: the last
    // entry's `when` set equal to its predecessor's. A real upgrade from that point recorded 14 of
    // 15 migrations and skipped the last one.
    const entries = journalEntries(CORE.from);
    const previous = entries.at(-2)!;
    const collided = entries.map((entry, index) =>
      index === entries.length - 1 ? { ...entry, when: previous.when } : entry,
    );
    expect(outOfOrder(collided)).toEqual([
      ...KNOWN_NON_MONOTONIC.get("core")!.entries,
      `${entries.at(-1)!.tag} (when ${previous.when})`,
    ]);
  });
});
