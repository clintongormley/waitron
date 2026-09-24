import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The extras-and-options files listed below contain none of three PostgreSQL-only constructs: an
 * advisory lock, the JSON containment operators, and a `pgEnum` declaration. `pgEnum` is checked in
 * the catalogue files only; the order and sale path files are not scanned for it.
 *
 * READS TEXT, so it is weaker than "proves engine neutrality":
 *
 * 1. It cannot tell code from a comment or a string, so a construct NAMED in prose fails the guard
 *    as loudly as one that runs.
 * 2. It reads a HAND-WRITTEN list of files. A new file added to the feature is outside the scan
 *    until somebody names it here, and nothing notices. A file reached through a helper in an
 *    unlisted file is outside it too.
 * 3. PostgreSQL-only spellings beyond these three are not covered at all. `::regclass`, `distinct
 *    on`, an array operator and `for update skip locked` all pass here.
 */

const repoRoot = join(import.meta.dirname, "..");

/** The extras-and-options schema and CRUD files. */
const CATALOGUE_FILES = [
  "packages/catalogue/src/schema/options.ts",
  "packages/catalogue/src/schema/extras.ts",
  "packages/catalogue/src/options.ts",
  "packages/catalogue/src/extras.ts",
  "packages/catalogue/src/product-modifiers.ts",
] as const;

/**
 * The order and sale path files the feature changed. Checked for the advisory lock and the
 * containment operators only.
 */
const ORDER_PATH_FILES = [
  "apps/server/src/modifier-selection.ts",
  "apps/server/src/working-order.ts",
  "packages/db/src/schema/orders.ts",
  "packages/core/src/record-sale.ts",
  "packages/core/src/sale-line-rows.ts",
  "packages/db/src/schema/sales.ts",
] as const;

/**
 * An advisory lock in any of its four spellings. `scripts/postgres-sql-residue.test.ts` forbids
 * `select … for update`, but `packages/catalogue/src` is not one of its roots, so no guard refuses
 * that clause in this package.
 */
const ADVISORY_LOCK = /pg_(?:try_)?advisory_[a-z_]*lock\b/;

/**
 * JSON containment, both directions. `@>` is the one the spec names; `<@` is the same operator read
 * backwards and would be the obvious way to write around a check for `@>` alone.
 */
const JSON_CONTAINMENT = /@>|<@/;

/** A drizzle enum declaration. SQLite has no enum type, so the switch converts these to a CHECK. */
const PG_ENUM = /\bpgEnum\s*\(/;

function read(file: string): string {
  return readFileSync(join(repoRoot, file), "utf8");
}

function offenders(files: readonly string[], pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(read(file)));
}

describe("the extras and options machinery stays engine-neutral", () => {
  it("scans every file it names — a path that is gone fails by name, not as a throw", () => {
    // A listed path that is gone makes every check over it throw; this names the path first.
    const missing = [...CATALOGUE_FILES, ...ORDER_PATH_FILES].filter(
      (file) => !existsSync(join(repoRoot, file)),
    );
    expect(missing).toEqual([]);
  });

  it("takes no advisory lock of its own", () => {
    expect(offenders([...CATALOGUE_FILES, ...ORDER_PATH_FILES], ADVISORY_LOCK)).toEqual([]);
  });

  it("asks no JSON containment question", () => {
    expect(offenders([...CATALOGUE_FILES, ...ORDER_PATH_FILES], JSON_CONTAINMENT)).toEqual([]);
  });

  it("declares no enum type in the catalogue's own schema", () => {
    expect(offenders(CATALOGUE_FILES, PG_ENUM)).toEqual([]);
  });
});

describe("negative controls", () => {
  it("would catch each banned construct — the patterns are not vacuous", () => {
    // The three checks above pass equally well when their predicate is broken.
    expect(ADVISORY_LOCK.test("await tx.execute(sql`select pg_advisory_xact_lock(${key})`);")).toBe(
      true,
    );
    expect(JSON_CONTAINMENT.test("sql`${products.tags} @> ${JSON.stringify([tag])}`")).toBe(true);
    expect(
      PG_ENUM.test('export const listKind = pgEnum("list_kind", ["extras", "options"]);'),
    ).toBe(true);
  });

  it("catches the spellings a rewrite would reach for first", () => {
    // Each of these passes a narrower pattern — a check for the literal `pg_advisory_xact_lock`, or
    // for `@>` alone, or for the word `pgEnum` unanchored to its call.
    expect(ADVISORY_LOCK.test("select pg_try_advisory_xact_lock(1)")).toBe(true);
    expect(ADVISORY_LOCK.test("select pg_advisory_lock(1)")).toBe(true);
    expect(JSON_CONTAINMENT.test("sql`${a.tags} <@ ${b}`")).toBe(true);
    expect(PG_ENUM.test("pgEnum (\n  'x',\n)")).toBe(true);
  });

  it("leaves ordinary code alone — the patterns are not too wide", () => {
    // `=>` and `>=` are everywhere in this tree, and a pattern that swallowed them would make the
    // containment check unsatisfiable. `pgEnumValues` is not a declaration.
    expect(JSON_CONTAINMENT.test("const f = (x: number) => x >= 1;")).toBe(false);
    expect(JSON_CONTAINMENT.test("if (a <= b && c >= d) return;")).toBe(false);
    expect(ADVISORY_LOCK.test("await tx.execute(sql`select 1 for update`);")).toBe(false);
    expect(PG_ENUM.test("import type { PgEnum } from 'drizzle-orm/pg-core';")).toBe(false);
  });
});
