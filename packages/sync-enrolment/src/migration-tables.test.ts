import { describe, expect, it } from "vitest";
import { tablesCreatedBy } from "./migration-tables.js";

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
