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

  it("does not treat DROP TABLE of an uncreated table as an error", () => {
    expect(tablesCreatedBy(['DROP TABLE "never_created";'])).toEqual(new Set());
  });
});
