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
});
