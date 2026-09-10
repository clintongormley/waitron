// A guard that reads the whole tree, so it lives in the ROOT Vitest project: a package-resident copy
// would only run when its own package is in scope, and most pushes never reach packages/db.
//
// It reads TEXT and says so. A migration that builds a predicate dynamically, or names a label
// through a variable, is not seen. Two kinds of occurrence are removed before the search:
//
//   SQL comments — a comment that QUOTES the label reads exactly like a predicate naming it, so
//   the prose explaining a fix would be reported as the defect. No comment in the tree quotes a
//   label today, so this was proven by injecting one into 0014: the set fails with the strip
//   deleted and passes with it in place.
//
//   The one safe spelling — a literal on the right of an explicit `::text` comparison, which is how
//   a migration names a label added in the same batch. Deleting that carve-out fails the fixed
//   0013/0014 pair, which is how it was proven. Any OTHER spelling of a safe usage is still
//   reported; widening the carve-out needs its own receipt.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "packages/migrations/migrations.manifest.json"), "utf8"),
) as { name: string; table: string; from: string }[];

const ADD_VALUE = /ALTER\s+TYPE\s+(?:"?public"?\.)?"?\w+"?\s+ADD\s+VALUE\s+'([^']+)'/gi;

/** `--` to end of line. Drizzle's own `--> statement-breakpoint` markers go the same way. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * `expr::text = 'label'` compares strings, so PostgreSQL never resolves the literal to the enum
 * type and the same-transaction rule does not apply. The predicate is unchanged: an enum's text
 * form is its label.
 */
function withoutTextCastComparisons(sql: string): string {
  return sql.replace(/::\s*text\s*(?:=|<>|!=)\s*'[^']*'/gi, "::text = ''");
}

function migrationsOf(from: string): { tag: string; sql: string }[] {
  const folder = resolve(join(ROOT, "packages/migrations"), from);
  const journalPath = join(folder, "meta", "_journal.json");
  if (!existsSync(journalPath)) return [];
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    sql: withoutTextCastComparisons(
      withoutComments(readFileSync(join(folder, `${entry.tag}.sql`), "utf8")),
    ),
  }));
}

describe("no migration names an enum label added in the same pending batch", () => {
  // Drizzle applies every PENDING migration of a set in one transaction
  // (drizzle-orm@0.45.2/pg-core/dialect.js:60), and PostgreSQL refuses to use an enum label in the
  // transaction that added it unless the type was created there too. A virgin database creates the
  // type in that same batch, so this defect passes CI and breaks only real upgrades — which is why
  // it is caught statically here rather than left to a fresh-database test.
  // Receipt: packages/db/drizzle/0013 + 0014 broke every core upgrade point, measured 2026-09-10.
  for (const set of MANIFEST) {
    it(`is safe in the ${set.name} set`, () => {
      const migrations = migrationsOf(set.from);
      const offences: string[] = [];
      migrations.forEach((migration, index) => {
        for (const match of migration.sql.matchAll(ADD_VALUE)) {
          const quoted = `'${match[1]!}'`;
          const after = migration.sql.slice(match.index! + match[0].length);
          // The adding file below its own ADD VALUE, and every later file: all one transaction.
          const named = [
            ...(after.includes(quoted) ? [migration.tag] : []),
            ...migrations
              .slice(index + 1)
              .filter((later) => later.sql.includes(quoted))
              .map((later) => later.tag),
          ];
          if (named.length > 0) {
            offences.push(
              `${migration.tag} adds enum label ${quoted}, named again in ${named.join(", ")} — ` +
                `compare the column as ::text instead`,
            );
          }
        }
      });
      expect(offences).toEqual([]);
    });
  }
});
