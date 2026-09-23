import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  headSnapshot,
  migrationSets,
  migrationSqlFiles,
  tablesCreatedBy,
} from "./migration-tables.js";

describe("tablesCreatedBy", () => {
  it("collects created tables, quoted or bare, schema-qualified or not", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "public"."devices" (id uuid);',
        "CREATE TABLE IF NOT EXISTS tills (id uuid);",
      ]),
    ).toEqual(new Set(["devices", "tills"]));
  });

  it("removes a table a later migration drops", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "device_pairing_codes" (id uuid);',
        'DROP TABLE "device_pairing_codes";',
      ]),
    ).toEqual(new Set());
  });

  it("honours order: create, drop, create again leaves the table present", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "t" (id uuid);',
        'DROP TABLE "t";',
        'CREATE TABLE "t" (id uuid, extra text);',
      ]),
    ).toEqual(new Set(["t"]));
  });

  // Within ONE file too: the scanner collects every CREATE before every DROP, so only sorting by
  // position gets a drop followed by a re-create in the same file right.
  it("honours order within one file: drop, then create again leaves the table present", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "t" (id text);',
        'DROP TABLE "t";\nCREATE TABLE "t" (id text, extra text);',
      ]),
    ).toEqual(new Set(["t"]));
  });

  // SQLite matches table names without regard to case: on node:sqlite (Node v26.7.0),
  // `DROP TABLE devices` removed a table created as `"Devices"`, and `CREATE TABLE tills` after
  // `CREATE TABLE Tills` was refused "table tills already exists".
  it("reads table names without regard to case, reporting them in lower case", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "Devices" (id text);',
        "CREATE TABLE Tills (id text);",
        "DROP TABLE devices;",
      ]),
    ).toEqual(new Set(["tills"]));
  });

  it("accepts DROP TABLE IF EXISTS and a schema qualifier", () => {
    expect(
      tablesCreatedBy(['CREATE TABLE "t" (id uuid);', 'DROP TABLE IF EXISTS "public"."t";']),
    ).toEqual(new Set());
  });

  it("ignores CREATE TABLE and DROP TABLE inside comments and string literals", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "kept" (id uuid);',
        "-- CREATE TABLE commented_out (id uuid);",
        "/* DROP TABLE kept; */",
        "SELECT 'DROP TABLE kept';",
      ]),
    ).toEqual(new Set(["kept"]));
  });

  // The dialect the tree emits since the SQLite flip: backtick-quoted identifiers. The CREATE is
  // copied from `packages/db/drizzle/0000_baseline.sql`; the FOREIGN KEY line from
  // `packages/workforce/drizzle/0000_baseline.sql` — it names `persons`, which is NOT a table this
  // set creates, so a scanner matching REFERENCES would over-report here.
  it("collects a backtick-quoted created table, the spelling the SQLite baselines use", () => {
    expect(
      tablesCreatedBy([
        "CREATE TABLE `locations` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`catalogue_id` text\n);",
        "CREATE TABLE `absences` (\n\t`id` text PRIMARY KEY NOT NULL,\n\tFOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict\n);",
      ]),
    ).toEqual(new Set(["locations", "absences"]));
  });

  // The CREATE here is deliberately the OTHER spelling: with both statements backtick-quoted, an
  // empty result would satisfy this case whether or not the DROP was recognised. Creating under a
  // spelling the scanner already reads leaves the backtick DROP as the only thing being measured —
  // it prints `Set{ 'absences' }` when that tolerance is missing. The `IF EXISTS` spelling was
  // checked against sqlite3 3.51.0, not copied from a file.
  it("removes a table a later backtick-quoted DROP TABLE drops", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "absences" ("id" text PRIMARY KEY NOT NULL);',
        "DROP TABLE IF EXISTS `absences`;",
      ]),
    ).toEqual(new Set());
  });

  // drizzle-kit's rebuild of a table whose column SQLite cannot ALTER, in the shape
  // `packages/db/drizzle/0003_variant_inherited_nullable.sql` emits: build `__new_<name>`, copy,
  // drop the original, rename the new one into its place. The rebuilt table is still there; the
  // temporary name is not.
  it("follows a rebuild's rename, keeping the table and dropping the temporary name", () => {
    expect(
      tablesCreatedBy([
        "CREATE TABLE `products` (\n\t`id` text PRIMARY KEY NOT NULL\n);",
        "PRAGMA foreign_keys=OFF;--> statement-breakpoint\n" +
          "CREATE TABLE `__new_products` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n--> statement-breakpoint\n" +
          'INSERT INTO `__new_products`("id") SELECT "id" FROM `products`;--> statement-breakpoint\n' +
          "DROP TABLE `products`;--> statement-breakpoint\n" +
          "ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint\n" +
          "PRAGMA foreign_keys=ON;",
      ]),
    ).toEqual(new Set(["products"]));
  });

  // A RENAME COLUMN names two identifiers after RENAME as well, and neither is a table.
  it("does not read a column rename as a table rename", () => {
    expect(
      tablesCreatedBy(['CREATE TABLE "t" (a text);', 'ALTER TABLE "t" RENAME COLUMN "a" TO "b";']),
    ).toEqual(new Set(["t"]));
  });

  it("does not treat DROP TABLE of an uncreated table as an error", () => {
    expect(tablesCreatedBy(['DROP TABLE "never_created";'])).toEqual(new Set());
  });
});

/** A throwaway repository root holding exactly the files a case writes into it. */
function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "migration-tables-"));
  fixtureRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

const journal = (...idx: number[]): string =>
  JSON.stringify({ entries: idx.map((i) => ({ idx: i, tag: `${i}_x` })) });

describe("migrationSets", () => {
  it("finds a drizzle directory under packages and under apps, repo-relative and sorted", () => {
    const root = fixtureRoot({
      "packages/zeta/drizzle/meta/_journal.json": journal(),
      "packages/alpha/drizzle/0000_x.sql": "",
      "apps/server/drizzle/0000_x.sql": "",
      "packages/no-set/src/index.ts": "",
    });
    expect(migrationSets(root)).toEqual([
      join("apps", "server", "drizzle"),
      join("packages", "alpha", "drizzle"),
      join("packages", "zeta", "drizzle"),
    ]);
  });

  it("does not count a FILE named drizzle as a migration set", () => {
    const root = fixtureRoot({
      "packages/fake/drizzle": "not a directory",
      "apps/real/drizzle/meta/_journal.json": journal(),
    });
    expect(migrationSets(root)).toEqual([join("apps", "real", "drizzle")]);
  });
});

describe("headSnapshot", () => {
  const set = join("packages", "p", "drizzle");

  it("reports a set with no journal as missing", () => {
    const root = fixtureRoot({ "packages/p/drizzle/0000_x.sql": "" });
    expect(headSnapshot(root, set)).toEqual({ kind: "missing" });
  });

  it("reports a journal with no entries as empty", () => {
    const root = fixtureRoot({ "packages/p/drizzle/meta/_journal.json": journal() });
    expect(headSnapshot(root, set)).toEqual({ kind: "empty" });
  });

  it("reports a head whose snapshot is not on disk as missing", () => {
    const root = fixtureRoot({
      "packages/p/drizzle/meta/_journal.json": journal(0, 1),
      "packages/p/drizzle/meta/0000_snapshot.json": "{}",
    });
    expect(headSnapshot(root, set)).toEqual({ kind: "missing" });
  });

  // The entries are written out of order, so a reader taking the LAST entry would answer 0000.
  it("names the snapshot of the HIGHEST idx, not of the last entry, repo-relative", () => {
    const root = fixtureRoot({
      "packages/p/drizzle/meta/_journal.json": journal(0, 11, 2),
      "packages/p/drizzle/meta/0000_snapshot.json": "{}",
      "packages/p/drizzle/meta/0002_snapshot.json": "{}",
      "packages/p/drizzle/meta/0011_snapshot.json": "{}",
    });
    expect(headSnapshot(root, set)).toEqual({
      kind: "file",
      path: join(set, "meta", "0011_snapshot.json"),
    });
  });
});

describe("migrationSqlFiles", () => {
  it("walks nested directories, keeps only .sql files, and sorts repo-relative paths", () => {
    const root = fixtureRoot({
      "packages/p/drizzle/0001_b.sql": "",
      "packages/p/drizzle/0000_a.sql": "",
      "packages/p/drizzle/nested/0002_c.sql": "",
      "packages/p/drizzle/meta/_journal.json": journal(0),
      "packages/p/drizzle/notes.txt": "",
    });
    const set = join("packages", "p", "drizzle");
    expect(migrationSqlFiles(root, set)).toEqual([
      join(set, "0000_a.sql"),
      join(set, "0001_b.sql"),
      join(set, "nested", "0002_c.sql"),
    ]);
  });
});
