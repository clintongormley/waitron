import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No migration may NAME an enum label that a migration in the same pending batch ADDED. Drizzle
 * applies every pending migration of a set in one transaction
 * (drizzle-orm@0.45.2/pg-core/dialect.js:60), and PostgreSQL refuses to use an enum label in the
 * transaction that added it unless the type was created there too. A virgin database creates the
 * type in that same batch, so this defect passes CI and breaks only real upgrades — which is why it
 * is caught statically here rather than left to a fresh-database test.
 * Receipt: packages/db/drizzle/0013 + 0014 broke every core upgrade point, measured 2026-09-10.
 *
 * A guard that reads the whole tree, so it lives in the ROOT Vitest project: a package-resident copy
 * would only run when its own package is in scope, and most pushes never reach packages/db.
 *
 * It reads TEXT and says so. A migration that builds a predicate dynamically, or names a label
 * through a variable, is not seen. What the ADD VALUE detector itself recognises is stated on the
 * regex below — any schema qualifier, quoted or not, and an optional `IF NOT EXISTS` — and each of
 * those spellings has a control test, because a label the detector misses makes every unsafe naming
 * of it in the same batch invisible too. Two kinds of occurrence are removed before the search:
 *
 *   SQL comments — a comment that QUOTES the label reads exactly like a predicate naming it, so the
 *   prose explaining a fix would be reported as the defect. No comment in the tree quotes a label
 *   today, so this was proven by injecting one into 0014: the set fails with the strip deleted and
 *   passes with it in place. The control below pins it without an injection.
 *
 *   The one safe spelling — a literal on the right of an explicit `::text` comparison, which is how
 *   a migration names a label added in the same batch. Deleting that carve-out fails the fixed
 *   0013/0014 pair, which is how it was proven. Any OTHER spelling of a safe usage is still
 *   reported; widening the carve-out needs its own receipt.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "packages/migrations/migrations.manifest.json"), "utf8"),
) as { name: string; table: string; from: string }[];

/**
 * `ALTER TYPE [<schema>.]<type> ADD VALUE [IF NOT EXISTS] '<label>'`, in any spelling of quoting and
 * whitespace. The schema qualifier is any name, not just `public`, and `IF NOT EXISTS` is optional:
 * a first version required `public` and put the quote immediately after `VALUE`, so
 * `ADD VALUE IF NOT EXISTS 'bluetooth'` — the ordinary idiom for a hand-written
 * `db:generate:custom` migration — matched NOTHING, and an unsafe naming of that label in the same
 * batch passed unseen. Both spellings are pinned as controls below.
 */
const ADD_VALUE =
  /ALTER\s+TYPE\s+(?:"?\w+"?\s*\.\s*)?"?\w+"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi;

/**
 * `expr::text = 'label'` compares strings, so PostgreSQL never resolves the literal to the enum type
 * and the same-transaction rule does not apply. The predicate is unchanged: an enum's text form is
 * its label.
 *
 * The trailing `(?!\s*::)` is what keeps this a carve-out rather than a hole. A literal CAST after
 * the comparison — `transport::text = 'bluetooth'::print_transport::text` — is resolved to the enum
 * type by PostgreSQL and aborts the upgrade with 55P04, and the earlier carve-out swallowed it: the
 * guard reported 12 passed while upgrading a real database from core release point 13 rolled both
 * pending migrations back (review, 2026-09-10; negative control below). Any cast at all disqualifies
 * the literal, including a harmless `::text` — this reads text and does not resolve types, so it
 * refuses rather than guesses.
 */
const TEXT_CAST_COMPARISON = /::\s*text\s*(?:=|<>|!=)\s*'[^']*'(?!\s*::)/gi;

/** `--` to end of line. Drizzle's own `--> statement-breakpoint` markers go the same way. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function withoutTextCastComparisons(sql: string): string {
  return sql.replace(TEXT_CAST_COMPARISON, "::text = ''");
}

interface Migration {
  tag: string;
  /** RAW file text; comment and carve-out stripping happens in `offencesIn`. */
  sql: string;
}

function journalPathOf(from: string): string {
  return join(resolve(join(ROOT, "packages/migrations"), from), "meta", "_journal.json");
}

/** A set's migrations in journal order, or `[]` when the folder has moved — see the anchor below. */
function migrationsOf(from: string): Migration[] {
  const folder = resolve(join(ROOT, "packages/migrations"), from);
  const journalPath = journalPathOf(from);
  if (!existsSync(journalPath)) return [];
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    sql: readFileSync(join(folder, `${entry.tag}.sql`), "utf8"),
  }));
}

/** Every offence in one set, in journal order. Takes migrations rather than a path so the controls
 * below can exercise the detector on a spelling the tree does not contain. */
function offencesIn(migrations: Migration[]): string[] {
  const searchable = migrations.map((migration) => ({
    tag: migration.tag,
    sql: withoutTextCastComparisons(withoutComments(migration.sql)),
  }));
  const offences: string[] = [];
  searchable.forEach((migration, index) => {
    for (const match of migration.sql.matchAll(ADD_VALUE)) {
      const quoted = `'${match[1]!}'`;
      const after = migration.sql.slice(match.index! + match[0].length);
      // The adding file below its own ADD VALUE, and every later file: all one transaction.
      const named = [
        ...(after.includes(quoted) ? [migration.tag] : []),
        ...searchable
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
  return offences;
}

const ADDS_BLUETOOTH = `ALTER TYPE "public"."print_transport" ADD VALUE 'bluetooth' BEFORE 'cloud_poll';`;

function pair(sql: string, adds: string = ADDS_BLUETOOTH): Migration[] {
  return [
    { tag: "0013_adds", sql: adds },
    { tag: "0014_names", sql },
  ];
}

const NAMES_BLUETOOTH = `ALTER TABLE "printers" ADD CONSTRAINT c CHECK (transport = 'bluetooth');`;

const OFFENCE = [
  "0013_adds adds enum label 'bluetooth', named again in 0014_names \u2014 " +
    "compare the column as ::text instead",
];

describe("no migration names an enum label added in the same pending batch", () => {
  // Vacuous-pass anchor, in the siblings' style (classification-complete, errors-reachable): a set
  // whose folder moves reads as zero migrations, and zero migrations hold zero offences — identical
  // to a safe set. Pin that the scan found the journals, that the ADD VALUE detector still matches
  // the tree's real spelling, and that the carve-out is not dead text.
  it("discovers the sets and their real ADD VALUE statements (guards against a vacuous pass)", () => {
    for (const set of MANIFEST) {
      expect(existsSync(journalPathOf(set.from)), `${set.name}: no journal at ${set.from}`).toBe(
        true,
      );
    }
    // Loose floors, every one of them strictly under today's number: a count is a receipt that goes
    // stale (CLAUDE.md §7), and a floor sitting exactly on the tree fails the day the tree shrinks
    // by one for a good reason. The last one was 2 — exactly the tree's count — until a re-read.
    expect(MANIFEST.length).toBeGreaterThanOrEqual(10);
    const all = MANIFEST.flatMap((set) => migrationsOf(set.from));
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(
      all.filter((m) => [...m.sql.matchAll(ADD_VALUE)].length > 0).length,
    ).toBeGreaterThanOrEqual(1);
    // The carve-out fires on the tree's own text — otherwise the safe spelling below proves nothing.
    expect(all.some((m) => withoutTextCastComparisons(m.sql) !== m.sql)).toBe(true);
  });

  for (const set of MANIFEST) {
    it(`is safe in the ${set.name} set`, () => {
      expect(offencesIn(migrationsOf(set.from))).toEqual([]);
    });
  }

  it("does not report the safe spelling — a plain ::text comparison", () => {
    expect(
      offencesIn(
        pair(`ALTER TABLE "printers" ADD CONSTRAINT c CHECK (transport::text = 'bluetooth');`),
      ),
    ).toEqual([]);
  });

  it("does not report a label quoted inside a COMMENT", () => {
    expect(offencesIn(pair(`-- 0013 adds 'bluetooth'; nothing here names it.\nSELECT 1;`))).toEqual(
      [],
    );
  });

  it("reports a literal cast BACK to the enum type (negative control)", () => {
    // The exact spelling the earlier carve-out swallowed. Upgrading a real PostgreSQL database from
    // core release point 13 with it in place fails 55P04 and rolls both pending migrations back,
    // while the guard reported 12 passed (review, 2026-09-10).
    expect(
      offencesIn(
        pair(
          `ALTER TABLE "printers" ADD CONSTRAINT c CHECK (transport::text = 'bluetooth'::print_transport::text);`,
        ),
      ),
    ).toEqual([
      "0013_adds adds enum label 'bluetooth', named again in 0014_names — " +
        "compare the column as ::text instead",
    ]);
  });

  it("reports an ADD VALUE spelled with IF NOT EXISTS", () => {
    // The idiom a hand-written `db:generate:custom` migration reaches for. The first version of the
    // detector required the quote immediately after VALUE, so this ADD VALUE matched NOTHING: the
    // label went unseen and every unsafe naming of it in the same batch passed.
    expect(
      offencesIn(
        pair(
          NAMES_BLUETOOTH,
          `ALTER TYPE "public"."print_transport" ADD VALUE IF NOT EXISTS 'bluetooth' BEFORE 'cloud_poll';`,
        ),
      ),
    ).toEqual(OFFENCE);
  });

  it("reports an ADD VALUE qualified by a schema other than public", () => {
    // Same hole: the first version hardcoded `public` as the only qualifier it would step over.
    expect(
      offencesIn(
        pair(NAMES_BLUETOOTH, `ALTER TYPE "waitron"."print_transport" ADD VALUE 'bluetooth';`),
      ),
    ).toEqual(OFFENCE);
    expect(
      offencesIn(
        pair(NAMES_BLUETOOTH, `ALTER TYPE waitron.print_transport ADD VALUE 'bluetooth';`),
      ),
    ).toEqual(OFFENCE);
  });

  it("reports a bare enum literal — the defect this guard exists for", () => {
    expect(
      offencesIn(pair(`ALTER TABLE "printers" ADD CONSTRAINT c CHECK (transport = 'bluetooth');`)),
    ).toEqual([
      "0013_adds adds enum label 'bluetooth', named again in 0014_names — " +
        "compare the column as ::text instead",
    ]);
  });
});
