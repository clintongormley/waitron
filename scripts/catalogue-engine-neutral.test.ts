import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: the extras-and-options machinery writes no PostgreSQL-only construct OF ITS OWN for the
 * SQLite storage switch to rewrite. Three such constructs are the ones that switch removes, so none
 * of them may appear in the files listed below: an advisory lock, the JSON containment operators,
 * and a `pgEnum` declaration. What the feature reaches through a helper in a file this list does
 * not name is outside the contract as well as outside the scan — see 4 below, which is live today.
 *
 * READS TEXT, so it is weaker than "proves engine neutrality" in every way that matters to a
 * reader:
 *
 * 1. It cannot tell code from a comment or a string, so a construct NAMED in prose fails the guard
 *    as loudly as one that runs. That direction is safe — it over-reports — but it means a failure
 *    here is not by itself evidence that anything reaches a database.
 * 2. It reads a HAND-WRITTEN list of files. A new file added to the extras/options feature is
 *    outside the scan until somebody names it here, and nothing notices. A RENAME is noticed —
 *    `read` throws `ENOENT`, so every check over the missing path fails — and `scans every file it
 *    names` below is there to report that path BY NAME ahead of those throws, not to be the only
 *    thing that catches it. Nothing fires when an unlisted file appears.
 * 3. PostgreSQL-only spellings beyond these three are not covered at all. `::regclass`, `distinct
 *    on`, an array operator and `for update skip locked` are all engine-specific and all pass here.
 *    The three checked are the three the SQLite plan's §7 names.
 * 4. A construct the feature REACHES THROUGH A HELPER in an unlisted file is invisible here, and
 *    that is the live case rather than a theoretical one: `createOptionList`/`updateOptionList`
 *    (options.ts) and `createExtraList`/`updateExtraList` (extras.ts) each call their file's
 *    `validateNames`, which calls `findContentTranslationGap` in
 *    `packages/catalogue/src/content-languages.ts`, whose first statement is
 *    `select pg_advisory_xact_lock(hashtextextended('content-languages', 0))`. So every list save
 *    carrying a customer-facing name DOES take an advisory lock; what `takes no advisory lock of
 *    its own` below asserts is that the files listed below do not contain one. That lock came in
 *    with #339 on 2026-09-12, before this track started. The extras and options savers reach it
 *    through `findContentTranslationGap` directly, as traced above; the OTHER savers — categories,
 *    units, variants, product names and image names among them — reach the same lock through the
 *    same file's `validateContentTranslations`, which calls `findContentTranslationGap` itself.
 *    That is why `content-languages.ts` is not in the list: the SQLite switch owns that lock, not
 *    this feature.
 *
 * Why `pgEnum` is checked in the catalogue files and NOT in the order/sale path files: the two
 * order/sale schema files already declare enums that predate this feature by two months —
 * `packages/db/src/schema/orders.ts:14` (`working_order_status`) and
 * `packages/db/src/schema/sales.ts:27,29` (`fiscal_state`, `tender_method`), all three introduced by
 * `10b16fd5` on 2026-07-21, where the extras-and-options branch began at `1e9af260` on 2026-09-18
 * (`git log -1 -S 'pgEnum("working_order_status"' -- packages/db/src/schema/orders.ts`). The rule
 * the spec states is "no NEW pgEnum", and a guard that failed on those three would be satisfiable
 * only by an allowlist — which is the thing that goes stale. So the order/sale files are checked for
 * the two constructs they genuinely do not contain, and this paragraph is the receipt for the gap.
 */

const repoRoot = join(import.meta.dirname, "..");

/**
 * The extras-and-options schema and CRUD files. Every construct below is banned in these: they were
 * written from nothing by this feature, so there is no history to grandfather.
 */
const CATALOGUE_FILES = [
  "packages/catalogue/src/schema/options.ts",
  "packages/catalogue/src/schema/extras.ts",
  "packages/catalogue/src/options.ts",
  "packages/catalogue/src/extras.ts",
  "packages/catalogue/src/product-modifiers.ts",
] as const;

/**
 * The order and sale path files the feature changed. Checked for the advisory lock and the
 * containment operators only — see the header for why `pgEnum` is not checked here.
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
 * An advisory lock in any of its four spellings — `pg_advisory_lock`, `pg_advisory_xact_lock` and
 * the two `pg_try_…` variants. SQLite has no equivalent at all, so code that serialises on one has
 * to be rewritten rather than translated; the extras save serialises on a `select … for update` of
 * the rows it is about instead.
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
    // `read` calls `readFileSync`, so a listed path that is gone does not pass quietly: every check
    // over it throws instead. What this assertion buys is the ONE failure that names the path,
    // ahead of those throws — a stale list reads as a stale list rather than as a broken checkout.
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
    // The three checks above pass equally well when their predicate is broken. These pin each
    // pattern against the exact text the construct is written as in this repository.
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
