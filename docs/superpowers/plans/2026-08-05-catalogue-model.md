# Catalogue Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal priced-item catalogue a till reads to build a basket, plus the thin sale-path change that lets a sale be rung entirely from catalogue data.

**Architecture:** A new headless `@waitron/catalogue` package owns the pure pricing layer (VAT-class → rate, gross → base/cuota by the *difference method*) and the catalogue CRUD/query functions. Three new tenant-scoped tables (`catalogues`, `categories`, `products`) plus a `category` snapshot column on the line tables and a `catalogue_id` on `locations` live in `@waitron/db`. `@waitron/core`'s `recordSale` gains an optional caller-supplied `vatBreakdown` so the catalogue can drive a gross-inclusive desglose without changing the fiscal backend.

**Tech Stack:** TypeScript (ESM), Drizzle ORM, PostgreSQL 18 / PGlite, Vitest, pnpm workspaces. Money math via `@waitron/shared`'s exact BigInt decimals (round half away from zero, scale 2).

Design: [`docs/superpowers/specs/2026-08-05-catalogue-model-design.md`](../specs/2026-08-05-catalogue-model-design.md).

**Task order is dependency-correct** — Schema → Core → Pricing → English-guard → Operations → End-to-end → Gate. Execute in order; each task ends green and committed.

> **Correction, 2026-08-05 (finish-branch).** This plan (Task 1 Step 2, the File Structure line, and the self-review) claimed `locations.catalogue_id` had to be a **bare** column with no `.references()` because a real FK would create an "unworkable" `tenants.ts ↔ catalogue.ts` import cycle. **That claim was false** — verified against this repo's pinned drizzle-orm 0.45.2 / drizzle-kit 0.31.10 + tsc: the cross-module references are lazy `.references(() => …)` thunks, so the cycle is harmless (the ORM resolves both FKs, drizzle-kit emits the constraint, the pair typechecks). The FK was added in finish-branch (migration `0028`), matching the **spec's** own instruction (§2: a plain `catalogue_id → catalogues(id)` FK). Cross-tenant integrity remains RLS's job; a composite `(tenant_id, id)` FK is the deferred hardening (backlog).

## Global Constraints

- **Spanish domain terms are guarded; `@waitron/catalogue` is a *generic* (English, regime-neutral) package.** Every identifier, comment, and string in `packages/catalogue/src` is English — `vat`, never `iva`; `tax`, never `cuota`. The resolver is `resolveVatRate`. **The guard scans test files in `src/` too and flags `SPANISH_WORDS` (it once rejected `'Venta en establecimiento'` in a fixture — CLAUDE.md §2)**: keep scanned test strings clear of `SPANISH_WORDS` (read the list in `packages/db/src/english-only.ts`; e.g. `venta` is in it). Use neutral descriptions like `{ "en": "Sliced ham" }` in `packages/catalogue/src/**` tests; Spanish product names belong only in the `apps/server` demo (apps/* is out of the guard's scope).
- **Error codes name the DOMAIN CONCEPT, never the package, and are never renamed once shipped.** The one new code is `sale.total_mismatch` (not `catalogue.*`), declared by declaration-merging `@waitron/shared`'s `ErrorParams`. Grep siblings before naming. (`packages/shared/src/errors.ts`.)
- **A new `tenant_id`-bearing table needs FORCE RLS + a `<t>_tenant_isolation` policy + grants**, hand-written in a custom migration; `.enableRLS()` gives only `ENABLE`. (CLAUDE.md §3; `0001_tenancy_rls.sql`, `0017_nodes_rls.sql`.)
- **Never build SQL by string concatenation.** Drizzle parameterises `sql` templates. RLS/policy/grant DDL are utility statements with fixed identifiers, written literally in the custom migration.
- **No backfill / data-migration** — pre-production. Schema changes are additive; nothing migrates data.
- **The snapshot rule is absolute:** line tables carry snapshotted values, never a catalogue FK. The new `category` column is a snapshotted **text label**, never `category_id`.
- **Coverage thresholds:** 98/98/98/95 (statements/lines/functions/branches) for `@waitron/catalogue` and the touched packages.
- **Every commit `-s`.** Work happens only in the worktree `waitron-feat-catalogue-model` on branch `feat/catalogue-model`.
- **Money helpers** live in `@waitron/shared` (re-checked before use): `decimal`, `addDecimal`, `subtractDecimal`, `multiplyDecimal`, `divideDecimal(x, y, scale)`, `sumDecimals`, `compareDecimal`, `toScale(x, scale)`, `MONEY_SCALE = 2`, all round **half away from zero**. There is **no** gross→base helper — build `base = gross × 100 ÷ (100 + rate)`.

---

## File Structure

**Create:**
- `packages/db/src/schema/catalogue.ts` — `catalogues`, `categories`, `products` tables.
- `packages/db/src/schema/catalogue.test.ts` — schema/RLS-forced assertions.
- `packages/catalogue/package.json`, `tsconfig.json`, `vitest.config.ts` — package scaffold (mirror `packages/reporting/*`).
- `packages/catalogue/src/index.ts` — public barrel (re-exports only; coverage-excluded).
- `packages/catalogue/src/pricing.ts` + `pricing.test.ts` — pure pricing.
- `packages/catalogue/src/operations.ts` + `operations.test.ts` + `operations.rls.test.ts` — CRUD/query + RLS.
- `packages/catalogue/src/integration.test.ts` — `priceBasket` → `recordSale` seam.
- `packages/catalogue/src/testing/postgres.ts` — real-PG start helper (mirror `packages/payments-stripe/src/testing/postgres.ts`).
- `packages/catalogue/test/fixtures.ts` — `seedVenue`, `seedCatalogueFixture` (mirror `packages/reporting/test/fixtures.ts`).
- `apps/server/scripts/catalogue-demo.ts` — runnable end-to-end proof (coverage-excluded).

**Modify:**
- `packages/db/src/schema/sales.ts:199` — add `category` text to `saleLines`.
- `packages/db/src/schema/orders.ts:2-14,103` — import `text`; add `category` text to `workingOrderLines`.
- `packages/db/src/schema/tenants.ts:60-87` — add nullable `catalogueId` (bare uuid, no `.references` — avoids a tenants↔catalogue import cycle) to `locations`.
- `packages/db/src/index.ts` + `packages/db/src/schema/index.ts` — export the new tables.
- `packages/db/drizzle/*` — generated ALTER/CREATE migration (`db:generate`) + custom RLS migration (`db:generate:custom`).
- `packages/core/src/record-sale.ts` + `packages/core/src/errors.ts` — `category` on `RecordSaleLine`, `vatBreakdown?` on `RecordSaleInput`, the assertion, the insert, the resolve, the new error.
- `packages/db/src/english-only.ts:8-19`, `packages/fiscal-verifactu/src/vocabulary-scope.test.ts:30-33`, `scripts/english-only.test.ts:36-50` — add `"catalogue"` to the three pinned lists.
- `apps/server/package.json` — add `@waitron/catalogue` dep + a `demo:catalogue` script.

---

## Task 1: Schema — tables, columns, migrations

**Files:**
- Create: `packages/db/src/schema/catalogue.ts`, `packages/db/src/schema/catalogue.test.ts`
- Modify: `packages/db/src/schema/sales.ts:199`, `packages/db/src/schema/orders.ts:2-14,103`, `packages/db/src/schema/tenants.ts:60-87`, `packages/db/src/index.ts`, `packages/db/src/schema/index.ts`
- Migrations: `packages/db/drizzle/0026_*` (generated), `packages/db/drizzle/0027_*` (custom RLS)

**Interfaces:**
- Produces (drizzle tables, exported from `@waitron/db`): `catalogues`, `categories`, `products`; `saleLines.category`, `workingOrderLines.category`, `locations.catalogueId` columns.

- [ ] **Step 1: Define the tables.** `packages/db/src/schema/catalogue.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, index, jsonb, numeric, pgTable, text, timestamp, uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** A named, shareable menu. Many locations may point at one catalogue (N identical delis share it);
 * a heterogeneous venue set uses one catalogue each. `version` is the sync seam (bumped later). */
export const catalogues = pgTable(
  "catalogues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("catalogues_tenant_id_idx").on(t.tenantId)],
).enableRLS();

/** Tenant-wide analytics taxonomy ("Food", "Drinks"). Orthogonal to catalogue; snapshotted onto
 * the sale line as a label so a roll-up sums one canonical bucket across catalogues. */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("categories_tenant_id_idx").on(t.tenantId)],
).enableRLS();

/** A priced item. `unit_price` is GROSS (VAT-inclusive), per item (`each`) or per kg (`weight`).
 * Deactivate via `active`, never delete (may sit behind historical sale-line snapshots). */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    catalogueId: uuid("catalogue_id").notNull().references(() => catalogues.id),
    categoryId: uuid("category_id").references(() => categories.id),
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
    pricingUnit: text("pricing_unit").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    vatClass: text("vat_class").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("products_catalogue_id_idx").on(t.catalogueId),
    check("products_pricing_unit_ck", sql`${t.pricingUnit} in ('each','weight')`),
    check("products_vat_class_ck", sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`),
  ],
).enableRLS();
```

- [ ] **Step 2: Add the snapshot + assignment columns.**
  - `packages/db/src/schema/sales.ts` — after `lineTotal` (line 199), inside `saleLines`: `category: text("category"),` (`text` already imported, `sales.ts:11`).
  - `packages/db/src/schema/orders.ts` — add `text` to the `drizzle-orm/pg-core` import (lines 2-14); after `lineTotal` (line 103) inside `workingOrderLines`: `category: text("category"),`.
  - `packages/db/src/schema/tenants.ts` — inside `locations` (after `dayCutover`, line 77): `catalogueId: uuid("catalogue_id"),` — a **bare** nullable column, **no** `.references()` (a `catalogue.ts` FK would import `tenants.ts` which would import `catalogue.ts` — a cycle). Tenant-scoped integrity is enforced by RLS + the application; document this on the column.

- [ ] **Step 3: Export the tables.**
  - `packages/db/src/index.ts`: add `export { catalogues, categories, products } from "./schema/catalogue.js";`
  - `packages/db/src/schema/index.ts` (the drizzle-kit entry, `drizzle.config.ts:14`): add `export * from "./catalogue.js";`. (The `sales`/`orders` column additions need no barrel change — the tables are already exported.)

- [ ] **Step 4: Write the failing schema test.** `packages/db/src/schema/catalogue.test.ts` — mirror the dual-target harness in `packages/db/src/schema/sales.test.ts` (`describeEachTarget` from `../testing/harness.js`, `rows` helper, `sql`). Assert: the three tables exist and are RLS-forced; a bad `pricing_unit`/`vat_class` is rejected; `sale_lines.category`, `working_order_lines.category`, `locations.catalogue_id` exist.

```ts
it("forces RLS on the three catalogue tables", async () => {
  const out = await rows<{ relname: string; relforcerowsecurity: boolean }>(
    db,
    sql`select relname, relforcerowsecurity from pg_class
        where relname in ('catalogues','categories','products') order by relname`,
  );
  expect(out.map((r) => r.relname)).toEqual(["catalogues", "categories", "products"]);
  expect(out.every((r) => r.relforcerowsecurity)).toBe(true);
});

it("rejects an invalid pricing_unit / vat_class", async () => {
  await expect(db.execute(sql`insert into products
    (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
    values (gen_random_uuid(), gen_random_uuid(), '{}', 'bogus', '1.00', 'general')`)).rejects.toThrow();
});

it("has a snapshot category column on both line tables and catalogue_id on locations", async () => {
  const cols = await rows<{ table_name: string; column_name: string }>(
    db,
    sql`select table_name, column_name from information_schema.columns
        where (table_name in ('sale_lines','working_order_lines') and column_name = 'category')
           or (table_name = 'locations' and column_name = 'catalogue_id')`,
  );
  expect(cols).toHaveLength(3);
});
```

- [ ] **Step 5: Run it — expect FAIL** (tables/columns absent; no migration yet). `pnpm --filter @waitron/db test catalogue`.

- [ ] **Step 6: Generate the migrations.**
  - `pnpm --filter @waitron/db db:generate` → `0026_*.sql`: `CREATE TABLE catalogues/categories/products` (incl. `ENABLE ROW LEVEL SECURITY`, the two CHECKs, the indexes) + `ALTER TABLE sale_lines/working_order_lines ADD COLUMN category text` + `ALTER TABLE locations ADD COLUMN catalogue_id uuid`, plus a `meta/_journal.json` entry. Inspect it against the schema.
  - `pnpm --filter @waitron/db db:generate:custom` → empty `0027_*.sql`; fill it with the RLS DDL, mirroring `0017_nodes_rls.sql`:

```sql
ALTER TABLE "catalogues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalogues_tenant_isolation" ON "catalogues"
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "catalogues" TO app_user;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "categories_tenant_isolation" ON "categories"
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "categories" TO app_user;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products"
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "products" TO app_user;
```

  (No `DELETE` — deactivate via `active`. `current_tenant_id()`/`app_user` exist from `0001`.)

- [ ] **Step 7: Run schema tests — expect PASS.** `pnpm --filter @waitron/db test catalogue`.

- [ ] **Step 8: Run the immutability guard.** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — it scans every `tenant_id` table for FORCE RLS; the three new tables must FORCE (the CLAUDE.md §3 cross-package guard). Fix any red before proceeding.

- [ ] **Step 9: Prove a guard by deletion.** Temporarily drop `FORCE` on `products` in `0027`, re-run the `inmutabilidad` guard, confirm red, restore.

- [ ] **Step 10: Commit.** `git add packages/db && git commit -s -m "feat(db): catalogue/categories/products tables + category snapshot + locations.catalogue_id"`

---

## Task 2: Core change — optional `vatBreakdown`, `category`, `sale.total_mismatch`

**Files:**
- Modify: `packages/core/src/record-sale.ts`, `packages/core/src/errors.ts`
- Test: `packages/core/src/record-sale.test.ts` (extend)

**Interfaces:**
- Consumes: `sumDecimals`, `compareDecimal`, `decimal` from `@waitron/shared`; `VatBreakdownLine` from `@waitron/fiscal`; `saleLines.category` column (Task 1).
- Produces: `RecordSaleLine.category?: string | null`; `RecordSaleInput.vatBreakdown?: VatBreakdownLine[]`; error `sale.total_mismatch: { declaredTotal: string; breakdownTotal: string }`.

- [ ] **Step 1: Declare the error.** `packages/core/src/errors.ts` — inside the `declare module "@waitron/shared" { interface ErrorParams { … } }` block:

```ts
    "sale.total_mismatch": { declaredTotal: string; breakdownTotal: string };
```

  (Domain-concept `sale.*`; grep the file first to confirm no collision — the existing `sale.*` set is `tender_unsettled/tender_shortfall/series_not_found/series_wrong_node/series_wrong_purpose/number_reused/not_found/already_voided/already_settled/voided/already_substituted`. Never renamed once shipped.)

- [ ] **Step 2: Write failing core tests.** Extend `packages/core/src/record-sale.test.ts` (mirror its existing fake-backend + `usePgliteDb`/`withTenant` setup and its seed helper). Add:

```ts
it("passes a supplied vatBreakdown to the backend verbatim", async () => {
  const breakdown = [{ rate: decimal("10.00"), base: decimal("7.25"), tax: decimal("0.72") }];
  await withTenant(db, tenantId, (tx) => recordSale(tx, backend, {
    ...baseInput, total: "7.97", vatBreakdown: breakdown,
    lines: [{ lineNo: 1, descriptions: { en: "x" }, quantity: "0.320",
      unitPrice: "22.64", vatRate: "10.00", lineTotal: "7.25", category: "Food" }],
  }));
  expect(backend.lastSale!.vatBreakdown).toEqual(breakdown);       // NOT buildVatBreakdown's derivation
});

it("derives the breakdown when none is supplied (legacy path unchanged)", async () => {
  await withTenant(db, tenantId, (tx) => recordSale(tx, backend, {
    ...baseInput, total: "11.00",
    lines: [{ lineNo: 1, descriptions: { en: "x" }, quantity: "1",
      unitPrice: "10.00", vatRate: "10.00", lineTotal: "10.00" }],
  }));
  expect(backend.lastSale!.vatBreakdown).toEqual([{ rate: decimal("10.00"), base: decimal("10.00"), tax: decimal("1.00") }]);
});

it("throws sale.total_mismatch when a supplied breakdown disagrees with total", async () => {
  const breakdown = [{ rate: decimal("10.00"), base: decimal("7.25"), tax: decimal("0.72") }]; // sums to 7.97
  await expect(withTenant(db, tenantId, (tx) => recordSale(tx, backend, {
    ...baseInput, total: "8.00", vatBreakdown: breakdown,
    lines: [{ lineNo: 1, descriptions: { en: "x" }, quantity: "1", unitPrice: "7.25", vatRate: "10.00", lineTotal: "7.25" }],
  }))).rejects.toMatchObject({ code: "sale.total_mismatch" });
});

it("snapshots the line category onto sale_lines", async () => {
  await withTenant(db, tenantId, (tx) => recordSale(tx, backend, {
    ...baseInput, total: "1.50",
    lines: [{ lineNo: 1, descriptions: { en: "Water" }, quantity: "1",
      unitPrice: "1.50", vatRate: "21.00", lineTotal: "1.50", category: "Drinks" }],
  }));
  const [row] = await rows<{ category: string | null }>(db, sql`select category from sale_lines limit 1`);
  expect(row!.category).toBe("Drinks");
});
```

- [ ] **Step 3: Run — expect FAIL.** `pnpm --filter @waitron/core test record-sale`

- [ ] **Step 4: Implement.** In `record-sale.ts`:
  - `RecordSaleLine`: add `category?: string | null;` with a doc comment ("Snapshotted analytics label, copied onto `sale_lines.category` at insert; never a catalogue reference.").
  - `RecordSaleInput`: add `vatBreakdown?: VatBreakdownLine[];` (doc: "The caller-supplied VAT desglose — e.g. `@waitron/catalogue`'s gross-inclusive difference-method breakdown. When absent, `buildVatBreakdown(lines)` derives it as before.").
  - At the **top of `recordSale`**, before `backend.checkIntegrity`, assert a supplied breakdown agrees with `total` (defence for an unrepairable record; never fires on the legacy path):

```ts
if (input.vatBreakdown !== undefined) {
  const breakdownTotal = sumDecimals(input.vatBreakdown.flatMap((g) => [g.base, g.tax]));
  if (compareDecimal(breakdownTotal, decimal(input.total)) !== 0) {
    throw new AppError("sale.total_mismatch", { declaredTotal: input.total, breakdownTotal });
  }
}
```

  - The `saleLines` insert (lines 286-297): add `category: line.category ?? null,`.
  - The `backend.recordSale` call (line 346): `vatBreakdown: input.vatBreakdown ?? buildVatBreakdown(input.lines),`.
  - Add `sumDecimals`, `compareDecimal` to the `@waitron/shared` import (`decimal`, `AppError` already imported).

- [ ] **Step 5: Run — expect PASS**, and the existing record-sale suite still green (legacy path untouched).

- [ ] **Step 6: Prove the assertion by deletion.** Remove the `throw`, confirm the mismatch test fails, restore.

- [ ] **Step 7: Coverage + commit.** `pnpm --filter @waitron/core test:coverage`. `git add packages/core && git commit -s -m "feat(core): recordSale accepts a caller-supplied vatBreakdown + line category; sale.total_mismatch"`

---

## Task 3: `@waitron/catalogue` scaffold + pure pricing

**Files:**
- Create: `packages/catalogue/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/pricing.ts`
- Test: `packages/catalogue/src/pricing.test.ts`

**Interfaces:**
- Consumes: `@waitron/shared` decimals; `RecordSaleLine` (type) from `@waitron/core` (now carrying `category`, Task 2); `VatBreakdownLine` (type) from `@waitron/fiscal`.
- Produces: `PricingUnit`, `VatClass`, `PriceableProduct`, `BasketItem`, `resolveVatRate(vatClass): Decimal`, `priceBasket(items): { lines: RecordSaleLine[]; total: Decimal; vatBreakdown: VatBreakdownLine[] }`.

- [ ] **Step 1: Scaffold the package.** Mirror `packages/reporting/{package.json,tsconfig.json,vitest.config.ts}` verbatim, changing only `"name": "@waitron/catalogue"`. Dependencies: `@waitron/core`, `@waitron/fiscal`, `@waitron/shared`, `@waitron/db` (all `workspace:*`), `drizzle-orm: ^0.45.2`. devDependencies as reporting's (`@electric-sql/pglite`, `@types/node`, `@vitest/coverage-v8`, `typescript`, `vitest`) plus `@testcontainers/postgresql` (version as `packages/payments-stripe` uses — for Task 5). `vitest.config.ts` coverage `exclude`: add `"src/index.ts"`, `"src/testing/**"`, `"test/**"`. Run `pnpm install` from the worktree root.

- [ ] **Step 2: Write the failing pricing tests.** `packages/catalogue/src/pricing.test.ts` (English test strings only — the english-only guard scans this file):

```ts
import { describe, expect, it } from "vitest";
import { addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import { priceBasket, resolveVatRate } from "./pricing.js";
import type { PriceableProduct } from "./pricing.js";

const each = (unitPrice: string, vatClass: PriceableProduct["vatClass"], category: string | null = null): PriceableProduct =>
  ({ descriptions: { en: "item" }, pricingUnit: "each", unitPrice, vatClass, category });
const weight = (unitPrice: string, vatClass: PriceableProduct["vatClass"]): PriceableProduct =>
  ({ descriptions: { en: "sliced ham" }, pricingUnit: "weight", unitPrice, vatClass, category: "Food" });

describe("resolveVatRate", () => {
  it("maps each class to its rate", () => {
    expect(resolveVatRate("general")).toBe(decimal("21.00"));
    expect(resolveVatRate("reduced")).toBe(decimal("10.00"));
    expect(resolveVatRate("super_reduced")).toBe(decimal("4.00"));
    expect(resolveVatRate("zero")).toBe(decimal("0.00"));
  });
});

describe("priceBasket — difference method", () => {
  it("reverses a weighed gross line to base + cuota that re-sum to the gross exactly", () => {
    const r = priceBasket([{ product: weight("24.90", "reduced"), quantity: "0.320" }]);
    expect(r.total).toBe(decimal("7.97"));
    expect(r.lines[0]!.lineTotal).toBe(decimal("7.25"));
    expect(r.lines[0]!.vatRate).toBe(decimal("10.00"));
    expect(r.lines[0]!.category).toBe("Food");
    expect(r.vatBreakdown).toHaveLength(1);
    expect(r.vatBreakdown[0]!.base).toBe(decimal("7.25"));
    expect(r.vatBreakdown[0]!.tax).toBe(decimal("0.72"));           // gross - base, NOT base*rate
  });

  it("charges a round each-price exactly", () => {
    const r = priceBasket([{ product: each("8.50", "general"), quantity: "1" }]);
    expect(r.total).toBe(decimal("8.50"));
    expect(addDecimal(r.vatBreakdown[0]!.base, r.vatBreakdown[0]!.tax)).toBe(decimal("8.50"));
  });

  it("groups two lines at the same rate into one breakdown entry", () => {
    const r = priceBasket([
      { product: each("8.50", "general"), quantity: "1" },
      { product: each("2.00", "general"), quantity: "3" },
    ]);
    expect(r.vatBreakdown).toHaveLength(1);
    expect(r.total).toBe(decimal("14.50"));
  });

  it("splits distinct rates into distinct breakdown entries", () => {
    const r = priceBasket([
      { product: each("8.50", "general"), quantity: "1" },
      { product: weight("24.90", "reduced"), quantity: "0.320" },
    ]);
    expect(r.vatBreakdown).toHaveLength(2);
  });

  it("treats a zero-rate line as all base, no tax", () => {
    const r = priceBasket([{ product: each("5.00", "zero"), quantity: "1" }]);
    expect(r.vatBreakdown[0]!.base).toBe(decimal("5.00"));
    expect(r.vatBreakdown[0]!.tax).toBe(decimal("0.00"));
  });

  it("keeps total == Σ(base + tax) exactly (reconciliation invariant)", () => {
    const r = priceBasket([
      { product: weight("24.90", "reduced"), quantity: "0.320" },
      { product: each("8.50", "general"), quantity: "2" },
      { product: each("1.30", "super_reduced"), quantity: "5" },
    ]);
    const reconstructed = sumDecimals(r.vatBreakdown.flatMap((g) => [g.base, g.tax]));
    expect(compareDecimal(reconstructed, r.total)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (module/functions undefined). `pnpm --filter @waitron/catalogue test pricing`.

- [ ] **Step 4: Implement `pricing.ts`.**

```ts
import {
  addDecimal, decimal, divideDecimal, multiplyDecimal, subtractDecimal, sumDecimals, toScale,
  MONEY_SCALE,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { RecordSaleLine } from "@waitron/core";
import type { VatBreakdownLine } from "@waitron/fiscal";

export type PricingUnit = "each" | "weight";
export type VatClass = "general" | "reduced" | "super_reduced" | "zero";

export interface PriceableProduct {
  descriptions: Record<string, string>;
  pricingUnit: PricingUnit;
  /** GROSS (VAT-inclusive): per item for `each`, per kg for `weight`. */
  unitPrice: string;
  vatClass: VatClass;
  /** Snapshotted analytics label, copied onto the sale line. */
  category: string | null;
}

export interface BasketItem {
  product: PriceableProduct;
  /** A count for `each`, a measured kg weight (e.g. "0.320") for `weight`. */
  quantity: string;
}

// The standing Spanish IVA set. RECEIPT (Step 6): pinned to a primary AEAT source; the resolver's
// shape is fixed regardless of the values.
const RATES: Record<VatClass, string> = {
  general: "21.00",
  reduced: "10.00",
  super_reduced: "4.00",
  zero: "0.00",
};

export function resolveVatRate(vatClass: VatClass): Decimal {
  return decimal(RATES[vatClass]);
}

// base = gross ÷ (1 + rate/100) = gross × 100 ÷ (100 + rate). One rounded division; no gross→base
// helper exists in @waitron/shared.
function baseFromGross(gross: Decimal, rate: Decimal): Decimal {
  const hundred = decimal("100");
  return divideDecimal(multiplyDecimal(gross, hundred), addDecimal(hundred, rate), MONEY_SCALE);
}

export function priceBasket(items: readonly BasketItem[]): {
  lines: RecordSaleLine[];
  total: Decimal;
  vatBreakdown: VatBreakdownLine[];
} {
  const lines: RecordSaleLine[] = [];
  const groups = new Map<Decimal, { base: Decimal; gross: Decimal }>();

  items.forEach((item, i) => {
    const rate = resolveVatRate(item.product.vatClass);
    const gross = toScale(multiplyDecimal(item.product.unitPrice, item.quantity), MONEY_SCALE);
    const base = baseFromGross(gross, rate);
    const netUnit = baseFromGross(toScale(decimal(item.product.unitPrice), MONEY_SCALE), rate);
    lines.push({
      lineNo: i + 1,
      descriptions: item.product.descriptions,
      quantity: item.quantity,
      unitPrice: netUnit,                 // net, informational (record-sale.ts stores it verbatim)
      vatRate: rate,
      lineTotal: base,
      category: item.product.category,
    });
    const g = groups.get(rate);
    groups.set(rate, g === undefined
      ? { base, gross }
      : { base: addDecimal(g.base, base), gross: addDecimal(g.gross, gross) });
  });

  const vatBreakdown: VatBreakdownLine[] = [...groups.entries()].map(([rate, g]) => ({
    rate,
    base: g.base,
    tax: subtractDecimal(g.gross, g.base),   // DIFFERENCE method: cuota = gross − base
  }));
  const total = sumDecimals([...groups.values()].map((g) => g.gross));
  return { lines, total, vatBreakdown };
}
```

  `src/index.ts`: `export * from "./pricing.js";`. If `toScale` is not exported from `@waitron/shared`, use `divideDecimal(x, decimal("1"), MONEY_SCALE)` (rounds to scale 2) and note it in a comment.

- [ ] **Step 5: Run pricing tests — expect PASS.** `pnpm --filter @waitron/catalogue test pricing`. If a `decimal` literal assertion mismatches, assert against the normalised value the codec returns.

- [ ] **Step 6: Obtain the IVA-rate receipt.** Confirm `general 21 / reduced 10 / super_reduced 4 / zero 0` against a primary AEAT source (agenciatributaria.es tipos impositivos IVA); record the URL + date in a comment above `RATES` (CLAUDE.md §1). Use the official value if any food rate differs on the current page, and note it.

- [ ] **Step 7: Commit.** `git add packages/catalogue pnpm-lock.yaml && git commit -s -m "feat(catalogue): package scaffold + difference-method pricing"`

---

## Task 4: Opt `@waitron/catalogue` into the english-only guard

**Files:**
- Modify: `packages/db/src/english-only.ts:8-19`, `packages/fiscal-verifactu/src/vocabulary-scope.test.ts:30-33`, `scripts/english-only.test.ts:36-50`

- [ ] **Step 1: See the pins pass before the change.** `pnpm --filter @waitron/fiscal-verifactu test vocabulary-scope` and `pnpm exec vitest run scripts/english-only.test.ts` — both green.

- [ ] **Step 2: Add `"catalogue"` to `GENERIC_PACKAGES`** (`packages/db/src/english-only.ts`), after `"identity"`:

```ts
export const GENERIC_PACKAGES = [
  "db", "core", "fiscal", "shared", "payments",
  "scheduler", "credentials", "workforce", "reporting", "identity", "catalogue",
] as const;
```

- [ ] **Step 3: Run the pins — expect FAIL** on both suites (the pinned list no longer matches). This is the stale-hardcoded-list class (CLAUDE.md §2) firing as designed.

- [ ] **Step 4: Update `vocabulary-scope.test.ts:30-33`** — append `"catalogue",?` to the regex, in position:

```ts
expect(englishOnlySource).toMatch(
  /GENERIC_PACKAGES\s*=\s*\[\s*"db",\s*"core",\s*"fiscal",\s*"shared",\s*"payments",\s*"scheduler",\s*"credentials",\s*"workforce",\s*"reporting",\s*"identity",\s*"catalogue",?\s*\]/,
);
```

- [ ] **Step 5: Update `scripts/english-only.test.ts:36-50`** — add `"catalogue"` to the array and change `"ten"` → `"eleven"` in the `it(...)` title:

```ts
it("scopes itself to the eleven generic packages", () => {
  expect([...GENERIC_PACKAGES]).toEqual([
    "db", "core", "fiscal", "shared", "payments",
    "scheduler", "credentials", "workforce", "reporting", "identity", "catalogue",
  ]);
```

- [ ] **Step 6: Run both suites — expect PASS**, and confirm the scan of `packages/catalogue/src` finds no `SPANISH_WORDS` offenders (the Task-3 tests use English strings).

- [ ] **Step 7: Commit.** `git add packages/db/src/english-only.ts packages/fiscal-verifactu/src/vocabulary-scope.test.ts scripts/english-only.test.ts && git commit -s -m "chore(catalogue): opt into the english-only vocabulary guard"`

---

## Task 5: Catalogue operations + RLS isolation

**Files:**
- Create: `packages/catalogue/src/operations.ts`, `operations.test.ts`, `operations.rls.test.ts`, `src/testing/postgres.ts`, `test/fixtures.ts`
- Modify: `packages/catalogue/src/index.ts`

**Interfaces:**
- Consumes: `@waitron/db` tables + `Transaction`, `withTenant`, `asAppUser`; `@waitron/db/testing` (`usePgliteDb`, `useRealPostgres`, `seedTenant`, `CORE_MIGRATIONS`, `seedNode`).
- Produces (all `(tx, …)`): `createCatalogue`, `listCatalogues`, `renameCatalogue`, `deactivateCatalogue`, `createCategory`, `listCategories`, `renameCategory`, `createProduct`, `listProducts(tx, catalogueId)`, `updateProduct`, `deactivateProduct`, `assignCatalogueToLocation(tx, locationId, catalogueId)`, `listAvailableProducts(tx, locationId): AvailableProduct[]`. `AvailableProduct` carries `id`, `descriptions`, `pricingUnit`, `unitPrice`, `vatClass`, `category` (resolved name | null) — structurally assignable to `PriceableProduct`.

- [ ] **Step 1: Copy the real-PG start helper.** `packages/catalogue/src/testing/postgres.ts` — mirror `packages/payments-stripe/src/testing/postgres.ts` (starts `postgres:18-alpine`, applies `CORE_MIGRATIONS`).

- [ ] **Step 2: Write the fixtures.** `packages/catalogue/test/fixtures.ts` — mirror `packages/reporting/test/fixtures.ts`'s `seedVenue` (returns `{ tenantId, locationId, tillId, nodeId, seriesId }`); add `seedCatalogueFixture(tx, ids)` inserting one catalogue, two categories, one `each` + one `weight` product. **English test strings only** (this is `src`-adjacent and the guard scans `packages/catalogue/src`; `test/` is excluded from coverage but keep it English to be safe).

- [ ] **Step 3: Write failing operation tests (PGlite).** `packages/catalogue/src/operations.test.ts`, using `usePgliteDb({ migrations: [CORE_MIGRATIONS] })` + `withTenant` + `asAppUser`:

```ts
it("lists a location's catalogue's active products only", async () => {
  await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Deli" });
    const food = await createCategory(tx, { name: "Food" });
    const p1 = await createProduct(tx, { catalogueId: cat.id, categoryId: food.id,
      descriptions: { en: "sliced ham" }, pricingUnit: "weight", unitPrice: "24.90", vatClass: "reduced" });
    const p2 = await createProduct(tx, { catalogueId: cat.id, categoryId: null,
      descriptions: { en: "water" }, pricingUnit: "each", unitPrice: "1.50", vatClass: "general" });
    await deactivateProduct(tx, p2.id);
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const available = await listAvailableProducts(tx, locationId);
    expect(available.map((p) => p.id)).toEqual([p1.id]);
    expect(available[0]!.category).toBe("Food");
  });
});

it("returns [] for a location with no catalogue assigned", async () => {
  await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    expect(await listAvailableProducts(tx, locationId)).toEqual([]);
  });
});
```

  Also cover: create/list catalogues & categories; `updateProduct` (price + description); `renameCatalogue`/`renameCategory`; `deactivateCatalogue` hides all its products.

- [ ] **Step 4: Run — expect FAIL.**

- [ ] **Step 5: Implement `operations.ts`.** Plain drizzle query builders (never string SQL), all `(tx, …)`. `listAvailableProducts` = `locations` → (join on `catalogue_id`) `catalogues` → `products` (filter `products.active AND catalogues.active`), left-join `categories` for the label; select `descriptions/pricingUnit/unitPrice/vatClass` and `category: categories.name` (or null). Export all from `src/index.ts`.

- [ ] **Step 6: Run — expect PASS.**

- [ ] **Step 7: Write the RLS isolation test (real Postgres).** `packages/catalogue/src/operations.rls.test.ts` — mirror `packages/payments-stripe/src/stripe.rls.test.ts`: `useRealPostgres` with `probeRole: { name, password, inRole: "app_user" }`, `timeoutMs: 180_000`, `start: startRealPostgres`. Seed two tenants as `suite.admin`; create catalogue+product under `withTenant(probe, tenantA)`; assert `listCatalogues` under tenant B sees none of A's; assert `app_user` cannot DELETE:

```ts
it("denies DELETE to app_user (grant is SELECT/INSERT/UPDATE only)", async () => {
  const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
  await expect(withTenant(probe, tenantA.tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.execute(sql`delete from products where tenant_id = ${tenantA.tenantId}`);
  })).rejects.toThrow(/permission denied/i);
});
```

- [ ] **Step 8: Run with real PG.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test operations.rls`. Prove isolation by deletion: weaken one policy `USING` to `true`, confirm the cross-tenant read test fails, restore.

- [ ] **Step 9: Coverage + commit.** `pnpm --filter @waitron/catalogue test:coverage` (≥ thresholds). `git add packages/catalogue && git commit -s -m "feat(catalogue): catalogue/category/product operations + RLS isolation"`

---

## Task 6: End-to-end proof — `priceBasket` → `recordSale`

**Files:**
- Create: `packages/catalogue/src/integration.test.ts`, `apps/server/scripts/catalogue-demo.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Write the integration test (PGlite + fake backend).** `packages/catalogue/src/integration.test.ts` — `@waitron/catalogue` depends on `@waitron/core`, so importing `recordSale` is one-directional (no cycle; core never imports catalogue). Seed a venue + catalogue, `listAvailableProducts`, `priceBasket`, feed `{ lines, total, vatBreakdown }` into `recordSale` with a fake backend (mirror the fake in `packages/core/src/record-sale.test.ts`), assert the fake received `total`/`vatBreakdown` and `sale_lines.category` is snapshotted:

```ts
it("rings a sale entirely from catalogue data", async () => {
  await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Deli" });
    const food = await createCategory(tx, { name: "Food" });
    await createProduct(tx, { catalogueId: cat.id, categoryId: food.id,
      descriptions: { en: "sliced ham" }, pricingUnit: "weight", unitPrice: "24.90", vatClass: "reduced" });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const [ham] = await listAvailableProducts(tx, locationId);
    const priced = priceBasket([{ product: ham!, quantity: "0.320" }]);
    const { saleId } = await recordSale(tx, fakeBackend, {
      tenantId, tillId, nodeId, seriesId, workingOrderId: randomUUID(),
      locale: "en", invoiceLocales: ["en"], clock, fiscalBackend: "fake",
      settlement: { kind: "deferred" },
      total: priced.total, lines: priced.lines, vatBreakdown: priced.vatBreakdown,
    });
    expect(fakeBackend.lastSale!.total).toBe(priced.total);
    expect(fakeBackend.lastSale!.vatBreakdown).toEqual(priced.vatBreakdown);
    const [line] = await rows<{ category: string | null }>(db, sql`select category from sale_lines where sale_id = ${saleId}`);
    expect(line!.category).toBe("Food");
  });
});
```

  If `AvailableProduct` is not structurally assignable to `PriceableProduct`, adjust the Task-5 select to include the missing field.

- [ ] **Step 2: Run — expect PASS.** `pnpm --filter @waitron/catalogue test integration`

- [ ] **Step 3: Write the runnable demo.** `apps/server/scripts/catalogue-demo.ts` — mirror `apps/server/scripts/daily-close-demo.ts` (tsx-run). Connect via `createPostgresDb(DATABASE_URL)`; `applyVenue` (from `@waitron/provisioning`) to get a real chained venue + registered SIF; seed a catalogue (one `each`, one `weight` — Spanish product names are fine here, apps/* is out of the english-only scope); `listAvailableProducts`; `priceBasket`; `recordSale(tx, new VerifactuBackend(...), { …, vatBreakdown })`; print sale id, `total`, desglose. Add to `apps/server/package.json`: `@waitron/catalogue` under dependencies and `"demo:catalogue": "tsx scripts/catalogue-demo.ts"` under scripts. (Coverage-excluded via `apps/server/vitest.config.ts:41` `scripts/**`.)

- [ ] **Step 4: Run the demo against a scratch DB** (fresh migrated `postgres:18-alpine`, `WAITRON_ENV=preproduction`); confirm it prints a chained sale whose `total` equals the summed gross. Record the output in the commit body.

- [ ] **Step 5: Commit.** `git add packages/catalogue apps/server pnpm-lock.yaml && git commit -s -m "feat(catalogue): end-to-end proof — a sale rung from catalogue data (test + demo)"`

---

## Task 7: Full gate + backlog

- [ ] **Step 1: Whole-workspace gate** from the worktree: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Then coverage on every touched package: `pnpm --filter @waitron/catalogue --filter @waitron/core --filter @waitron/db --filter @waitron/fiscal-verifactu test:coverage`. Re-run the tree-wide guards explicitly: `pnpm exec vitest run scripts/english-only.test.ts scripts/guarded-teardowns.test.ts` and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. Fix all red.
- [ ] **Step 2: `pnpm install`** and confirm `pnpm-lock.yaml` is committed (new package + apps/server dep).
- [ ] **Step 3: Update `docs/backlog.md`** — under *Now* / sub-project 7, note the catalogue slice is in flight on `feat/catalogue-model`; add a line to sub-project 18 that the priced-item seed landed here (allergens/variants/recipes still #18). Commit `-s`.

---

## Self-Review (completed against the spec)

- **Spec coverage:** D1 minimal → only the priced-item model + one sale hook; allergens/etc deferred. D2 catalogue-as-unit → Task 1 `catalogues` + `locations.catalogue_id`, Task 5 `listAvailableProducts`. D3 categories taxonomy → Task 1 `categories`. D4 category snapshot → Task 1 columns + Task 2 wiring + Task 6 assertion. D5 gross / D6 weighed / D7 vat-class / D8 difference-method → Task 3 `priceBasket`. D9 core hook + assertion → Task 2. D10 homes + english-only → Tasks 1/3 + Task 4 pins (no migration-manifest entry: catalogue owns no `drizzle/`). D11 grants SELECT/INSERT/UPDATE, no DELETE → Task 1 custom migration + Task 5 DELETE-denied test. D12 no UI/sync; `version` column present, unbumped. §8 IVA receipt → Task 3 Step 6.
- **Dependency order:** Schema (1) → Core adds `RecordSaleLine.category` + `vatBreakdown` (2) → Pricing consumes those types (3) → english-guard after the package exists (4) → Operations (5) → E2E after all (6). No forward compile-time dependency remains.
- **Placeholder scan:** every code step carries real code; the `locations.catalogue_id` import-cycle is resolved (bare column); `toScale` fallback is spelled out.
- **Type consistency:** `priceBasket` returns `{ lines: RecordSaleLine[]; total; vatBreakdown }`; `RecordSaleLine.category` lands in Task 2 (before Task 3 compiles against it). `sale.total_mismatch` params `{ declaredTotal, breakdownTotal }` identical at declaration and throw site. `AvailableProduct` structurally assignable to `PriceableProduct` (Task 6 Step 1 guards it).
- **No other repo-wide pinned list needs touching** (`scripts/changed-scope.mjs` `OWN_SHARD_PACKAGES`/`PACKAGES_WITHOUT_TESTS`, `ci.yml`, root `vitest.config.ts`, `pnpm-workspace.yaml` are all dynamic/glob — verified). The three that do are updated together in Task 4.
