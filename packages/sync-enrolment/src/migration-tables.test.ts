import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dropLineComments, tablesCreatedBy } from "./migration-tables.js";
import { migrationSets, migrationSqlFiles } from "./testing/migration-sets.js";

describe("tablesCreatedBy", () => {
  it("collects created tables, quoted or bare, schema-qualified or not", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "public"."devices" (id uuid);',
        "CREATE TABLE IF NOT EXISTS printers (id uuid);",
      ]),
    ).toEqual(new Set(["devices", "printers"]));
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

  // SQLite matches table names without regard to case.
  it("reads table names without regard to case, reporting them in lower case", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "Devices" (id text);',
        "CREATE TABLE Printers (id text);",
        "DROP TABLE devices;",
      ]),
    ).toEqual(new Set(["printers"]));
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

  // `persons` is referenced but NOT created, so a scanner matching REFERENCES would over-report.
  it("collects a backtick-quoted created table, the spelling the SQLite baselines use", () => {
    expect(
      tablesCreatedBy([
        "CREATE TABLE `locations` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`catalogue_id` text\n);",
        "CREATE TABLE `absences` (\n\t`id` text PRIMARY KEY NOT NULL,\n\tFOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict\n);",
      ]),
    ).toEqual(new Set(["locations", "absences"]));
  });

  // The CREATE is deliberately the OTHER spelling: with both backtick-quoted, an empty result would
  // pass whether or not the DROP was recognised.
  it("removes a table a later backtick-quoted DROP TABLE drops", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "absences" ("id" text PRIMARY KEY NOT NULL);',
        "DROP TABLE IF EXISTS `absences`;",
      ]),
    ).toEqual(new Set());
  });

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

  it("reads past a comment that is never closed, and closes a comment only after its opening", () => {
    expect(tablesCreatedBy(["CREATE TABLE a (id int); /* CREATE TABLE b (id int);"])).toEqual(
      new Set(["a", "b"]),
    );
    expect(tablesCreatedBy(["/*/ CREATE TABLE c (id int); */ CREATE TABLE d (id int);"])).toEqual(
      new Set(["d"]),
    );
  });

  it.each([
    ["a carriage return", "\r"],
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
  ])("ignores a CREATE TABLE in a comment on a line ending in %s", (_name, end) => {
    expect(
      tablesCreatedBy([
        `-- CREATE TABLE ghost (id int);${end}\nCREATE TABLE real (id int);${end}\n`,
      ]),
    ).toEqual(new Set(["real"]));
  });

  it("reads a crafted 200,000-dash line ending in a carriage return within one second", () => {
    const started = performance.now();
    expect(tablesCreatedBy([`${"-".repeat(200_000)}\r`])).toEqual(new Set());
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("reads a crafted 600,000-character unclosed comment within one second", () => {
    const started = performance.now();
    expect(tablesCreatedBy([`/*${"a/*".repeat(200_000)}`])).toEqual(new Set());
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("dropLineComments", () => {
  const oldPattern = (source: string): string =>
    source
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");

  it("drops what the old `/--.*$/` pattern dropped, on lines holding no \\r, U+2028 or U+2029", () => {
    const inputs = [
      "",
      "no comment",
      "-- whole line",
      "CREATE TABLE a (id int); -- trailing",
      "a -- one -- two",
      "a - b",
      "a ---",
      "--> statement-breakpoint\nCREATE TABLE b (id int);--> statement-breakpoint",
      "x\n-- y\nz -- w\n",
    ];
    for (const input of inputs) expect(dropLineComments(input), input).toBe(oldPattern(input));

    const alphabet = ["-", "-", "-", "a", " ", "\n", "'", "/", "*"];
    let seed = 1;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed;
    };
    for (let i = 0; i < 20_000; i += 1) {
      let input = "";
      for (let n = next() % 24; n > 0; n -= 1) input += alphabet[next() % alphabet.length];
      expect(dropLineComments(input), JSON.stringify(input)).toBe(oldPattern(input));
    }
  });

  // Line by line, and only on lines where the old pattern's `.` reaches the end of the line: a
  // migration correctly holding a Windows line ending and a `--` comment must not fail this.
  it("drops what the old pattern dropped from every migration file in the repository", () => {
    const repoRoot = join(import.meta.dirname, "..", "..", "..");
    const files = migrationSets(repoRoot).flatMap((set) => migrationSqlFiles(repoRoot, set));
    expect(files.length, "guards against a vacuous pass over an empty listing").toBeGreaterThan(10);
    let compared = 0;
    let commented = 0;
    for (const file of files) {
      for (const line of readFileSync(join(repoRoot, file), "utf8").split("\n")) {
        if (/[\r\u2028\u2029]/.test(line)) continue;
        expect(dropLineComments(line), `${file}: ${line}`).toBe(oldPattern(line));
        compared += 1;
        if (line.includes("--")) commented += 1;
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(commented).toBeGreaterThan(100);
  });
});
