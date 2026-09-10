// Root project, same reasoning as scripts/enum-add-value-safety.test.ts: it reads the whole tree.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "packages/migrations/migrations.manifest.json"), "utf8"),
) as { name: string; table: string; from: string }[];

/**
 * Sets whose journal is already out of order, with the reason each is still here.
 *
 * SHRINK THIS LIST, NEVER GROW IT. An entry is not a licence: it records a defect that cannot be
 * repaired, only contained.
 *
 * `core` — entries 2 to 6 carry `when` values below entry 1's, so drizzle's `max(created_at)`
 * watermark (drizzle-orm@0.45.2/pg-core/dialect.js:56-62) SKIPS them for a database whose highest
 * recorded value is entry 1's. Measured 2026-09-10: a database at entry 1 upgrading to HEAD applies
 * 10 of 15 migrations and raises nothing. It cannot be fixed by editing the journal — raising the
 * out-of-order entries makes points 3 to 7 RE-APPLY a migration they already ran and fail, and
 * lowering the earlier ones changes nothing because the database stored the old value, not the
 * file's. The residual skip is made loud at runtime instead, by the boot-failure diagnosability
 * work. Fixing it properly means a squashed baseline, which is a separate decision.
 */
const KNOWN_NON_MONOTONIC = ["core"];

describe("every migration set's journal is strictly increasing", () => {
  // Drizzle decides what to apply from `max(created_at)` alone, never from a journal index, so a
  // `when` value below one already recorded is a migration that will never run — with no error.
  for (const set of MANIFEST) {
    it(`holds for the ${set.name} set`, () => {
      const folder = resolve(join(ROOT, "packages/migrations"), set.from);
      const journalPath = join(folder, "meta", "_journal.json");
      if (!existsSync(journalPath)) return;
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { when: number; tag: string }[];
      };
      const outOfOrder: string[] = [];
      let highest = Number.NEGATIVE_INFINITY;
      for (const entry of journal.entries) {
        if (entry.when <= highest) outOfOrder.push(`${entry.tag} (when ${entry.when})`);
        highest = Math.max(highest, entry.when);
      }
      if (KNOWN_NON_MONOTONIC.includes(set.name)) {
        // The allowlist is asserted, not merely skipped: if this set is ever repaired, this fails and
        // tells whoever repaired it to delete the entry.
        expect(
          outOfOrder.length,
          `${set.name} is repaired — remove it from KNOWN_NON_MONOTONIC`,
        ).toBeGreaterThan(0);
        return;
      }
      expect(outOfOrder).toEqual([]);
    });
  }
});
