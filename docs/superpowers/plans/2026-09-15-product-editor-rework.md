# Product editor rework — Implementation Plan

> **2026-09-14 — the tenant column is gone.** The tenant-id removal this document anticipates has
> landed: every `tenant_id` column, every tenant argument and the `withTenant` helper are gone
> (`withTransaction` replaces it), one database holds one taxpayer as the single row of `tenants`,
> and nothing filters by a tenant. Read every tenant-carrying signature, tenant predicate and
> "a by-id read scopes to the tenant" rule below as the shape at the time of writing. Spec:
> [drop-tenant-id](../specs/2026-09-14-drop-tenant-id-design.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the dashboard product editor into a short, collapsible form; make a product's Name plain staff-facing text with a separate optional translated customer-facing name; give variants their own kitchen name, customer names and image; turn variants into a drag-sortable table; and save station/course in the product transaction.

**Architecture:** A single feature branch. The DB column rename (`products.descriptions` → `name` + a new `customer_name`) has no backwards-compatibility path (pre-production: drop and recreate), so every consumer changes together and the branch lands as one. Work proceeds in phases: (A) data model and catalogue core, (B) the sale/till name surface, (C) server routes, (D) two new `wt-*` primitives plus a shared reorder table, (E) the dashboard editor widgets, (F) seeds/docs/integration walk. Two new UI primitives (`wt-disclosure`, `wt-price-input`) are self-contained and could land as a separate PR first — see the execution handoff.

**Tech Stack:** TypeScript, Lit web components (dashboard + till + `@waitron/ui`), Drizzle ORM over PostgreSQL, Vitest (PGlite + Testcontainers real-PG + real headless Chromium for browser packages), Hono (server routes).

**Migration numbers, 2026-09-16:** rebasing onto `main` collided with `0027`–`0029` there, so the
`packages/db` migrations this plan names below were regenerated as `packages/db/drizzle/0030_product_names_and_line_snapshots.sql`
(Tasks A1 and B1 together) and `0031_variant_descriptions_locales_sql.sql` (the custom trigger, which
carries the `_sql` suffix every hand-written migration here carries). The `packages/catalogue`
migration the plan names was NOT renumbered and is on disk exactly as written below. Read the
`packages/db` numbers as the shape of the work, not as paths on disk.

**Error code renamed, 2026-09-16:** the code this plan calls `product.variants_min_two` shipped as
`product.variant_count_invalid` with a `minimum` parameter, to match its siblings' singular stem and
to keep the number out of the code's name the way every other bounded code here does. The steps
below keep the old name because they record what was planned.

**Spec:** [docs/superpowers/specs/2026-09-15-product-editor-rework-design.md](../specs/2026-09-15-product-editor-rework-design.md). Read it alongside this plan. It supersedes the layout and naming model in `2026-09-12-product-editor-design.md`; that older spec's rules on menus, variant pricing precedence, tax choice, allergens and dietary suitability still stand.

## Global Constraints

- **Pre-production: no backwards-compatibility or data-migration code.** Schema changes drop and recreate; `wa-wt reset demo <name>` rebuilds the shared dev database. (CLAUDE.md §3)
- **Every read scopes to the tenant:** a by-id read still needs `eq(table.tenantId, cfg.tenantId)`; one-tenant-per-database is not the isolation boundary. (CLAUDE.md §3)
- **Multi-table writes share ONE transaction**, awaited in turn (never `Promise.all`). A route handler opens exactly one `withTenant`/`gated` per request. (CLAUDE.md §3)
- **Error codes name the domain concept**, never the throwing package; never renamed once shipped; grep siblings for the naming shape before adding one; every file that throws a code imports its registry (`import "./errors.js"`). (CLAUDE.md §3)
- **Every colour, spacing, radius, font reads a `--wt-*` token** — no hex, named colours, `rem`/`em`. A new `wt-*` primitive needs a token-painting test and an axe `*.a11y.test.ts` covering each state in both themes. Custom events are `wt-*`, carry `detail`, dispatch `bubbles: true, composed: true`, and stop the triggering event before re-emitting (use `dispatchWtChange`). (CLAUDE.md §3)
- **A Lit `<select>` whose options come from a `${…}` expression marks the chosen option with `.selected=`**, never a `.value` binding alone. (CLAUDE.md §3)
- **Markup handed to `wt-data-table` as a cell is styled with `part=`/`::part()`, never a CSS class.** (CLAUDE.md §3)
- **Prove a guard by deletion; state the experiment, not the conclusion.** Rejected writes assert the domain error code, not just `toBeInstanceOf(Error)`. A page asserted only as a string has nothing checking it renders — open it in both themes and at phone width before finishing. (CLAUDE.md §1, §4)
- **A comment carries the invariant and the non-obvious why, never the history.** (CLAUDE.md §1)
- **Commit with `git commit -s`.** Plain English in commit messages and PR text.
- **Sequencing:** the pending tenant-id removal (`2026-09-14-drop-tenant-id-design.md`) touches these same tables. This branch does not touch `tenant_id`; whichever lands second rebases.

## The three-name model (reference for every task)

A product and a variant each carry up to three names:

| Name | Column(s) | Shown on |
| --- | --- | --- |
| **Name** (staff) | product `name text not null`; variant `name text not null` | dashboard, till buttons/basket, sales reports |
| **Customer-facing name** | product `customer_name jsonb null`; variant `customer_name jsonb null` | receipt, invoice line, customer display, customer menus — blank falls back to Name |
| **Kitchen name** | product `kitchen_name text null` (exists); variant `kitchen_name text null` (new) | kitchen ticket/display — blank falls back to Name |

A variant's name is appended to the product's with `" · "`. Each of the three falls back independently. The fallback + join logic lives only in `packages/catalogue/src/product-presentation.ts`.

---

## File structure

**Data model (`@waitron/db`)**
- `packages/db/src/schema/catalogue.ts` — `products`: drop `descriptions`, add `name text not null`, `customer_name jsonb null`.
- `packages/db/src/schema/sales.ts` — `sale_lines`: add `name text not null`, `variant_descriptions jsonb null`, `variant_kitchen_name text null`; `variant_name` jsonb → text.
- `packages/db/src/schema/orders.ts` — `working_order_lines`: same additions/change as `sale_lines`.
- `packages/db/drizzle/0027_*.sql` (+ `0028_*_grants` if grants change) — generated; plus one custom migration for the `variant_descriptions` locales trigger.

**Catalogue core (`@waitron/catalogue`)**
- `packages/catalogue/src/schema/variants.ts` — `product_variants`: `name` jsonb → text, add `customer_name jsonb null`, `kitchen_name text null`, `image text null`.
- `packages/catalogue/drizzle/0014_*.sql` — generated.
- `packages/catalogue/src/product-editor-input.ts` — `ProductEditorInput`: `name: string`, add `customerName`; variant input widened.
- `packages/catalogue/src/product-editor.ts` — `ProductEditorValue`, `columns`, `readProductEditor`, `saveProductEditor`.
- `packages/catalogue/src/variants.ts` — `ProductVariant`, `ProductVariantInput`, `SelectedVariant`, `setProductVariants`, `selectMenuVariant`, `resolveMenuVariant`, `listProductVariants`.
- `packages/catalogue/src/operations.ts` — `createProduct`/`updateProduct`/`listProducts`/`readProduct` and the row-column maps.
- `packages/catalogue/src/product-presentation.ts` — the three-name resolvers and fallback.
- `packages/catalogue/src/content-languages.ts` — translation-gap query.
- `packages/catalogue/src/errors.ts` — new `product.variants_min_two` code.

**Sale path (`@waitron/core`, `apps/server`)**
- `packages/core/src/record-sale.ts`, `packages/core/src/sale-line-rows.ts` — `RecordSaleLine` + row build.
- `apps/server/src/working-order.ts` — line freeze.
- `apps/server/src/kitchen-print.ts` — kitchen ticket name.

**Till (`apps/till`)**
- `apps/till/src/api/client.ts` — `TillProduct` + variant + `menuOfferToTillProduct`.
- `apps/till/src/widgets/product-name.ts`, `dish-format.ts`, `basket.ts`, `product-grid.ts` — display-name resolution.

**Server routes (`apps/server`)**
- `apps/server/src/catalogue-api.ts` — editor create/update routes (add `customerName`, station/course in one tx); management POST/PATCH `descriptions` → `name`/`customerName`.

**UI primitives (`@waitron/ui`)**
- `packages/ui/src/components/wt-disclosure.ts` (+ `.test.ts`, `.a11y.test.ts`).
- `packages/ui/src/components/wt-price-input.ts` (+ `.test.ts`, `.a11y.test.ts`).
- `packages/ui` barrel export.

**Dashboard editor (`apps/dashboard`)**
- `apps/dashboard/src/widgets/reorder-table.ts` (new; extracted from `modifier-form.ts`) + refactor `modifier-form.ts` to use it and add its live region.
- `apps/dashboard/src/widgets/variant-table.ts` (new) + tests.
- `apps/dashboard/src/widgets/variant-form.ts` (new) + tests.
- `apps/dashboard/src/widgets/product-editor.ts` + `product-editor-model.ts` — rework.
- `apps/dashboard/src/api/client.ts` — `ProductEditorInput`/`ProductEditorValue` + variant types.
- `apps/dashboard/src/screens/catalogue-screen.ts` — host wiring (remove save-on-change station/course).
- `apps/dashboard/src/i18n/strings.ts` — new labels.

**Seeds / docs**
- `apps/server/scripts/demo-seed/menu.ts`, `seed-catalogue.ts`, `seed-sales.ts`; `packages/catalogue/test/fixtures.ts`; `apps/server/src/testing/venue-fixtures.ts`.
- `docs/developers/design-system.md`, `docs/developers/products.md`, `docs/backlog.md`.

---

# Phase A — Data model and catalogue core

### Task A1: Rename `products.descriptions` → `name` + add `customer_name`

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts` (the `products` table, `descriptions` at line ~90)
- Generate: `packages/db/drizzle/0027_product_name_customer_name.sql`
- Test: `packages/db/src/schema/catalogue.test.ts` (if present) or a catalogue-package migration/grant test that reads the column back

**Interfaces:**
- Produces: `products.name` (`text("name").notNull()`), `products.customerName` (`jsonb("customer_name").$type<Record<string, string>>()`, nullable). `products.descriptions` no longer exists.

- [ ] **Step 1: Change the schema.** In `packages/db/src/schema/catalogue.ts`, replace
  ```ts
  descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
  ```
  with
  ```ts
  // Staff-facing product name — plain text, shown on the dashboard, till buttons/basket and reports.
  name: text("name").notNull(),
  // Customer-facing translated name; null or a blank entry means "use `name`". Shown on receipts,
  // invoice lines, the customer display and customer menus.
  customerName: jsonb("customer_name").$type<Record<string, string>>(),
  ```
  Ensure `text` is imported from `drizzle-orm/pg-core` in this file (it already imports `jsonb`).

- [ ] **Step 2: Generate the migration.**

Run: `pnpm --filter @waitron/db db:generate`
Expected: a new `packages/db/drizzle/0027_*.sql` dropping `descriptions` and adding `name`/`customer_name`, an appended `meta/_journal.json` entry, and a `meta/0027_snapshot.json`. Rename the `.sql` to `0027_product_name_customer_name.sql` only if drizzle used a random tag; keep the journal `tag` in sync.

- [ ] **Step 3: Check the generated SQL.** Open the `.sql`. Because `name text NOT NULL` is added to a table drizzle assumes has rows, drizzle may emit it without a default and the migration would fail on a seeded dev DB. Pre-production rule: this is acceptable (dev DB is rebuilt), but confirm the statement order — `DROP COLUMN "descriptions"` and `ADD COLUMN "name" text NOT NULL`. If a grant on `products` enumerated `descriptions`, add a paired `0028_*_grants.sql` (grep `drizzle` migrations for a `GRANT ... ("descriptions")` column list; a table-level grant with no column list needs nothing).

- [ ] **Step 4: Run the DB package's migration/grant guard to confirm it applies.**

Run: `pnpm --filter @waitron/db test:coverage 2>&1 | tail -30` (or the focused migration test if the package has one)
Expected: migrations apply cleanly against the virgin test database; no `name`/`descriptions` reference errors. Other packages will still fail to typecheck until later tasks — that is expected; this step only proves the migration applies.

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/db/src/schema/catalogue.ts packages/db/drizzle
  git commit -s -m "Rename products.descriptions to a plain name plus an optional customer_name

  The staff-facing product name becomes plain text; the translated
  customer-facing name moves to a separate nullable column that falls back
  to name when blank."
  ```

### Task A2: Widen `product_variants` (staff name text, customer name, kitchen name, image)

**Files:**
- Modify: `packages/catalogue/src/schema/variants.ts` (the `productVariants` table)
- Generate: `packages/catalogue/drizzle/0014_variant_names_image.sql`
- Test: `packages/catalogue/src/variants.pg.test.ts` — extend to read the new columns back

**Interfaces:**
- Produces: `productVariants.name` (`text("name").notNull()`), `.customerName` (`jsonb("customer_name")`, nullable), `.kitchenName` (`text("kitchen_name")`, nullable), `.image` (`text("image")`, nullable).

- [ ] **Step 1: Change the schema.** In `packages/catalogue/src/schema/variants.ts`, in the `productVariants` column block replace
  ```ts
  name: jsonb("name").$type<Record<string, string>>().notNull(),
  ```
  with
  ```ts
  name: text("name").notNull(),
  customerName: jsonb("customer_name").$type<Record<string, string>>(),
  kitchenName: text("kitchen_name"),
  // Path reference to the variant photo (same shape as products.image; a real DB reference, so the
  // media library refuses to delete a picture a variant still uses). Null means no picture.
  image: text("image"),
  ```
  Add `text` to the `drizzle-orm/pg-core` import if not present.

- [ ] **Step 2: Generate.**

Run: `pnpm --filter @waitron/catalogue db:generate`
Expected: `packages/catalogue/drizzle/0014_*.sql` altering `product_variants`, journal + snapshot updated. Rename to `0014_variant_names_image.sql` and keep the journal tag in sync.

- [ ] **Step 3: Check the SQL** — `name` changes type jsonb→text (drizzle emits `DROP COLUMN`/`ADD COLUMN` or an `ALTER COLUMN ... TYPE`; either is fine pre-production), plus three `ADD COLUMN`s. If `product_variants` has a column-list grant, add a paired grants migration.

- [ ] **Step 4: Run the variants real-PG guard to confirm apply.**

Run: `pnpm --filter @waitron/catalogue test:coverage src/variants 2>&1 | tail -30`
Expected: migration applies; the existing variant tests fail only on the `name` type change (jsonb→string) — those are fixed in Task A4. This step proves the DDL applies.

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/catalogue/src/schema/variants.ts packages/catalogue/drizzle
  git commit -s -m "Give a variant its own staff name, customer name, kitchen name and image

  A variant's name becomes plain staff-facing text like the product's, and
  it gains an optional translated customer name, an optional kitchen name
  and an optional image reference."
  ```

### Task A3: Presentation resolvers own the three-name fallback and join

**Files:**
- Modify: `packages/catalogue/src/product-presentation.ts`
- Test: `packages/catalogue/src/product-presentation.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export interface ProductPresentation {
    name: string;                                   // product staff name
    customerName: Record<string, string> | null;   // product customer-facing
    kitchenName: string | null;                     // product kitchen name
    variantName: string | null;                     // variant staff name
    variantCustomerName: Record<string, string> | null;
    variantKitchenName: string | null;
  }
  // The staff name for basket/reports: "Coffee" or "Coffee · Large".
  export function staffPresentationName(p: ProductPresentation): string;
  // Customer text as a locale→string map, ready for toInvoiceLineDescriptions: falls back to name.
  export function customerPresentationText(p: ProductPresentation, defaultLanguage: string): { product: Record<string, string>; variant: Record<string, string> | null };
  // Kitchen ticket name for one locale: kitchenName||name, joined with the variant's.
  export function kitchenPresentationName(p: ProductPresentation, locale: string, fallback: string): string;
  ```

- [ ] **Step 1: Write the failing tests.** Replace the file's tests with ones asserting each surface with **different** text in every slot so a wrong fallback shows:
  ```ts
  import { describe, expect, test } from "vitest";
  import {
    staffPresentationName,
    customerPresentationText,
    kitchenPresentationName,
    type ProductPresentation,
  } from "./product-presentation.js";

  const full: ProductPresentation = {
    name: "Coffee",
    customerName: { en: "Fresh Coffee", es: "Café recién hecho" },
    kitchenName: "COF",
    variantName: "Large",
    variantCustomerName: { en: "Large cup", es: "Taza grande" },
    variantKitchenName: "LG",
  };

  describe("staffPresentationName", () => {
    test("joins product and variant staff names", () => {
      expect(staffPresentationName(full)).toBe("Coffee · Large");
    });
    test("product only when no variant", () => {
      expect(staffPresentationName({ ...full, variantName: null })).toBe("Coffee");
    });
  });

  describe("customerPresentationText", () => {
    test("uses the customer name maps as-is", () => {
      expect(customerPresentationText(full, "en")).toEqual({
        product: { en: "Fresh Coffee", es: "Café recién hecho" },
        variant: { en: "Large cup", es: "Taza grande" },
      });
    });
    test("falls back to staff name under the default language when customer name is blank", () => {
      expect(customerPresentationText({ ...full, customerName: null, variantCustomerName: null }, "en")).toEqual({
        product: { en: "Coffee" },
        variant: { en: "Large" },
      });
    });
  });

  describe("kitchenPresentationName", () => {
    test("uses kitchen names, joined", () => {
      expect(kitchenPresentationName(full, "en", "en")).toBe("COF · LG");
    });
    test("falls back to staff names when kitchen names are blank", () => {
      expect(kitchenPresentationName({ ...full, kitchenName: null, variantKitchenName: null }, "en", "en")).toBe("Coffee · Large");
    });
  });
  ```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm --filter @waitron/catalogue test src/product-presentation -- --run`
Expected: FAIL — the old `productPresentationName`/`ProductPresentation` shape doesn't match.

- [ ] **Step 3: Rewrite the module.**
  ```ts
  import { resolveSnapshotText } from "@waitron/shared";

  export interface ProductPresentation {
    name: string;
    customerName: Record<string, string> | null;
    kitchenName: string | null;
    variantName: string | null;
    variantCustomerName: Record<string, string> | null;
    variantKitchenName: string | null;
  }

  function join(product: string, variant: string | null): string {
    return variant ? `${product} · ${variant}` : product;
  }

  export function staffPresentationName(p: ProductPresentation): string {
    return join(p.name, p.variantName);
  }

  export function customerPresentationText(
    p: ProductPresentation,
    defaultLanguage: string,
  ): { product: Record<string, string>; variant: Record<string, string> | null } {
    const nonEmpty = (m: Record<string, string> | null) =>
      m && Object.values(m).some((t) => t.trim()) ? m : null;
    return {
      product: nonEmpty(p.customerName) ?? { [defaultLanguage]: p.name },
      variant:
        p.variantName === null
          ? null
          : (nonEmpty(p.variantCustomerName) ?? { [defaultLanguage]: p.variantName }),
    };
  }

  export function kitchenPresentationName(
    p: ProductPresentation,
    locale: string,
    fallback: string,
  ): string {
    const product = p.kitchenName?.trim() || p.name;
    if (p.variantName === null) return product;
    const variant = p.variantKitchenName?.trim() || p.variantName;
    return join(product, variant);
  }
  ```
  (Delete the old `productPresentationName`; its only non-test caller — `working-order.ts:318` — is updated in Task B2.)

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm --filter @waitron/catalogue test src/product-presentation -- --run`
Expected: PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/catalogue/src/product-presentation.ts packages/catalogue/src/product-presentation.test.ts
  git commit -s -m "Presentation resolvers own the three-name fallback and join

  One module decides how staff, customer-facing and kitchen names fall back
  and how a variant name joins the product's with a middot, so no consumer
  re-implements the rule."
  ```

### Task A4: `ProductVariant` / `ProductVariantInput` / `setProductVariants` widened

**Files:**
- Modify: `packages/catalogue/src/variants.ts` (types, `variantColumns`, `setProductVariants`, `listProductVariants*`)
- Test: `packages/catalogue/src/variants.pg.test.ts`

**Interfaces:**
- Consumes: the new `product_variants` columns (Task A2).
- Produces:
  ```ts
  export interface ProductVariant {
    id: string;
    name: string;
    customerName: Record<string, string> | null;
    kitchenName: string | null;
    image: string | null;
    unitPrice: string;
    available: boolean;
  }
  export type ProductVariantInput = Omit<ProductVariant, "id"> & { id?: string };
  ```

- [ ] **Step 1: Write the failing test.** In `variants.pg.test.ts`, extend the create/read round-trip to assert the new fields survive a `setProductVariants` → `listProductVariants`:
  ```ts
  test("a variant round-trips staff name, customer name, kitchen name and image", async () => {
    // ...create a product `productId` in `tx` for `tenantId` (existing helper)...
    await setProductVariants(tx, tenantId, productId, [
      { name: "Large", customerName: { en: "Large cup" }, kitchenName: "LG", image: "cup.png", unitPrice: "3.00", available: true },
    ], "en");
    const [variant] = await listProductVariants(tx, tenantId, productId);
    expect(variant).toMatchObject({
      name: "Large",
      customerName: { en: "Large cup" },
      kitchenName: "LG",
      image: "cup.png",
      unitPrice: "3.00",
      available: true,
    });
  });
  ```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm --filter @waitron/catalogue test:coverage src/variants 2>&1 | tail -30`
Expected: FAIL — types don't have the new fields; `setProductVariants` doesn't persist them.

- [ ] **Step 3: Implement.** In `variants.ts`:
  - Update `ProductVariant` (above). `ProductVariantInput` follows via `Omit`.
  - Extend `variantColumns` with `customerName: productVariants.customerName`, `kitchenName: productVariants.kitchenName`, `image: productVariants.image`.
  - In `setProductVariants`, the per-variant `values` object gains `customerName: input.customerName`, `kitchenName: input.kitchenName`, `image: input.image`. Keep `validateContentTranslations` — but call it on `input.customerName ?? {}` (the customer-facing map is what must satisfy enabled languages), not on the now-plain `name`. If `input.customerName` is null, skip the translation check (a blank customer name is legal).
  - `SelectedVariant`, `selectMenuVariant`, `resolveMenuVariant` are updated in Task A5 (below) — leave them compiling by temporarily reading `variant.name` as the staff string; A5 finishes them.

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm --filter @waitron/catalogue test:coverage src/variants 2>&1 | tail -30`
Expected: the new test PASSES. (Menu-variant selection tests may still fail pending A5.)

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/catalogue/src/variants.ts packages/catalogue/src/variants.pg.test.ts
  git commit -s -m "Persist a variant's staff name, customer name, kitchen name and image"
  ```

### Task A5: `SelectedVariant` carries all six name pieces

**Files:**
- Modify: `packages/catalogue/src/variants.ts` (`SelectedVariant`, `selectMenuVariant`, `resolveMenuVariant`)
- Test: `packages/catalogue/src/variants.pg.test.ts` (the menu-variant resolution tests)

**Interfaces:**
- Produces:
  ```ts
  export interface SelectedVariant {
    variantId: string | null;
    name: string;                                   // product staff name
    customerName: Record<string, string> | null;   // product customer-facing
    kitchenName: string | null;
    variantName: string | null;                     // variant staff name
    variantCustomerName: Record<string, string> | null;
    variantKitchenName: string | null;
    unitPrice: string;
  }
  ```

- [ ] **Step 1: Write the failing test.** Assert `resolveMenuVariant` returns the widened shape with a product that has `name`/`customerName` and a chosen variant with its own three names (different text in each), and that with `variantId === null` all variant fields are null. Base and join must be read from the `products` row's new columns.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/catalogue test:coverage src/variants 2>&1 | tail -30`).

- [ ] **Step 3: Implement.** Update `SelectedVariant` (above). In `resolveMenuVariant` and `selectMenuVariant`:
  - Select `products.name` and `products.customerName` (rename the current `productName: products.descriptions` select to `name: products.name` and add `customerName: products.customerName`).
  - Return `name`, `customerName`, `kitchenName` from the product row; `variantName` = `variant.name`, `variantCustomerName` = `variant.customerName`, `variantKitchenName` = `variant.kitchenName` (null branch: all three null).
  - `selectMenuVariant`'s `offer` parameter type changes: `descriptions` → `name` + `customerName`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/catalogue/src/variants.ts packages/catalogue/src/variants.pg.test.ts
  git commit -s -m "Menu-variant selection returns product and variant staff, customer and kitchen names"
  ```

### Task A6: `createProduct` / `updateProduct` / list / read use `name` + `customerName`

**Files:**
- Modify: `packages/catalogue/src/operations.ts` (input types, `columns`/select maps, `createProduct`, `updateProduct`, `listProducts`, `readProduct`, the `ProductRow`→domain mappers)
- Test: `packages/catalogue/src/operations.test.ts`

**Interfaces:**
- Produces: `createProduct` input takes `name: string` + `customerName: Record<string,string> | null` (replacing `descriptions`); `updateProduct` patch the same, both optional as today. Read/list results expose `name` + `customerName`.

- [ ] **Step 1: Write the failing test.** In `operations.test.ts`, assert `createProduct({ name: "Coffee", customerName: { en: "Fresh Coffee" }, ... })` then `readProduct` returns `{ name: "Coffee", customerName: { en: "Fresh Coffee" } }`, and `updateProduct` can set `customerName: null`.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/catalogue test:coverage src/operations 2>&1 | tail -30`).

- [ ] **Step 3: Implement.** Replace every `descriptions: products.descriptions` in the select maps (lines ~325, 827, 1017, 1631, 1767 per the current file) with `name: products.name, customerName: products.customerName`. In `createProduct`'s insert values and `updateProduct`'s set object, replace `descriptions: input.descriptions` with `name: input.name` and `customerName: input.customerName`. Update the input interfaces and the domain-row mappers (`buildProduct`/similar around line 388) to carry `name`/`customerName`. `validateContentTranslations` in callers now runs against `customerName ?? {}`, not `name` (see A7/C for the routes).

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/catalogue/src/operations.ts packages/catalogue/src/operations.test.ts
  git commit -s -m "Product operations read and write name and customer_name"
  ```

### Task A7: Editor input parser + save/read path; add the min-two-variants rule

**Files:**
- Modify: `packages/catalogue/src/product-editor-input.ts`, `packages/catalogue/src/product-editor.ts`, `packages/catalogue/src/errors.ts`
- Test: `packages/catalogue/src/product-editor-input.test.ts`, and a catalogue-level save test (`packages/catalogue/src/integration.test.ts` or a new `product-editor.pg.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  export interface ProductEditorInput {
    name: string;                                   // was Record<string,string>
    customerName: Record<string, string> | null;   // new
    description: Record<string, string> | null;
    kitchenName: string | null;
    image: string | null;
    unitId: string;
    unitPrice: string;
    available: boolean;
    vatClass: VatClass;
    variants: ProductVariantInput[];                // widened in A4
    categoryIds: string[];
    primaryCategoryId: string | null;
    modifierIds: string[];
    allergens: ProductAllergens | null;
    dietaryDeclarations: DietaryLabel[];
  }
  ```
  New error code `product.variants_min_two`.

- [ ] **Step 1: Write the failing tests.** In `product-editor-input.test.ts`: `name` parses as a required non-empty string (reject missing/empty/non-string as `product.invalid` field `name`); `customerName` parses as optional translations (null allowed); each variant parses `name` (string, required), `customerName` (translations|null), `kitchenName` (nullableText), `image` (nullableText), `unitPrice`, `available`. Add a save test asserting a product with exactly one variant is refused `product.variants_min_two`, and zero or ≥2 succeed.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/catalogue test:coverage src/product-editor 2>&1 | tail -30`).

- [ ] **Step 3: Implement.**
  - `product-editor-input.ts`: `name` → parse with a new `requiredText(body.name, "name")` helper (`typeof === "string"`, `.trim()` non-empty). Add `customerName` via the existing `translations` helper wrapped for null. Each variant: `name` via `requiredText`, `customerName` via nullable `translations`, `kitchenName`/`image` via `nullableText`. After building `variants`, if `variants.length === 1` throw `new AppError("product.variants_min_two", {})`.
  - `errors.ts`: register `product.variants_min_two` beside the other `product.*` codes (grep the file for `product.variant_invalid` to match the shape/section).
  - `product-editor.ts`: in the `columns` map change `name: products.descriptions` → `name: products.name` and add `customerName: products.customerName`. In `saveProductEditor`, call `validateContentTranslations(tx, tenantId, value.customerName ?? {}, fallbackLanguage)` (the customer name is what must satisfy enabled languages; a blank one is legal so pass `{}` which the validator treats as "no translations"). Pass `name`/`customerName` to `createProduct`/`updateProduct`. `ProductEditorValue` gains `customerName`.
  - Confirm `validateContentTranslations({})` does not throw a `content.translation_required` (it currently requires the default language be non-empty). If it does, add a guard so an all-empty map skips the "required" check — the required staff `name` is validated separately in the parser. State this decision in a one-line comment.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/catalogue/src/product-editor-input.ts packages/catalogue/src/product-editor.ts packages/catalogue/src/errors.ts packages/catalogue/src/*product-editor*.test.ts
  git commit -s -m "Editor parser and save path use name plus customer name, and refuse a lone variant

  A product may have no variants or at least two; exactly one is refused
  with product.variants_min_two so an API caller cannot bypass the editor's
  Regular-variant rule."
  ```

### Task A8: Translation-gap query no longer treats a blank customer name as a gap

**Files:**
- Modify: `packages/catalogue/src/content-languages.ts` (`listContentTranslationGaps`)
- Test: `packages/catalogue/src/content-languages.pg.test.ts`

**Interfaces:** unchanged signature; behaviour change only.

- [ ] **Step 1: Write the failing test.** A product with `customer_name` null is NOT a gap in any language; a product with `customer_name = {en: "x"}` and enabled `[en, es]` IS a gap for `es`; a variant with `customer_name` null is not a gap.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement.** The union query currently reads `descriptions as translations from products` and `name as translations from product_variants`. Change to `customer_name as translations from products` and `customer_name as translations from product_variants`. The existing `.filter((row) => resolveContentText(row.translations, code, code) === "")` would flag a null map as a gap — add `and customer_name is not null` (and `and customer_name <> '{}'::jsonb`) to both product and variant selects so a wholly-absent customer name is never a gap. Keep category/unit/section/option rows as they are (those names stay required).

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/catalogue/src/content-languages.ts packages/catalogue/src/content-languages.pg.test.ts
  git commit -s -m "A blank customer name is not a translation gap; a partial one is"
  ```

---

# Phase B — Sale path and till

### Task B1: `sale_lines` and `working_order_lines` snapshot columns

**Files:**
- Modify: `packages/db/src/schema/sales.ts`, `packages/db/src/schema/orders.ts`
- Generate: `packages/db/drizzle/0029_snapshot_names.sql` (number follows A1's 0027/0028)
- Custom migration: `packages/db/drizzle/0030_variant_descriptions_locales.sql` (trigger)
- Test: a real-PG test that inserts a row with the new columns and that the locales trigger fires on `variant_descriptions`

**Interfaces:**
- Produces on both tables: `name text not null`, `variant_name` (text, nullable — was jsonb), `variant_descriptions jsonb null`, `variant_kitchen_name text null`. `descriptions` and `kitchen_name` unchanged.

- [ ] **Step 1: Change both schemas.** On `saleLines` (sales.ts ~213) and `workingOrderLines` (orders.ts ~157):
  - Add `name: text("name").notNull(),`
  - Change `variantName: jsonb("variant_name")...` to `variantName: text("variant_name"),`
  - Add `variantDescriptions: jsonb("variant_descriptions").$type<Record<string, string>>(),`
  - Add `variantKitchenName: text("variant_kitchen_name"),`
  Update the doc comments: `name` is the frozen staff name; `variant_descriptions` holds the variant's customer text under exactly the invoice locales, mirroring `descriptions`.

- [ ] **Step 2: Generate** `pnpm --filter @waitron/db db:generate`; rename to `0029_snapshot_names.sql`, keep journal in sync.

- [ ] **Step 3: Write the custom locales-trigger migration.** The baseline `working_order_lines_check_locales()` trigger checks only `descriptions`. Add a companion so `variant_descriptions`, when not null, carries exactly the invoice locales too. Run `pnpm --filter @waitron/db db:generate:custom` to scaffold an empty `0030_*.sql`, then write:
  ```sql
  CREATE OR REPLACE FUNCTION working_order_lines_check_variant_locales() RETURNS trigger AS $$
  DECLARE
    expected text[];
    got text[];
  BEGIN
    IF NEW.variant_descriptions IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT array_agg(l ORDER BY l) INTO expected
      FROM locations loc
      JOIN tills t ON t.location_id = loc.id
      JOIN working_orders wo ON wo.till_id = t.id,
      unnest(loc.invoice_locales) AS l
      WHERE wo.id = NEW.working_order_id;
    SELECT array_agg(k ORDER BY k) INTO got FROM jsonb_object_keys(NEW.variant_descriptions) AS k;
    IF got IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'variant_descriptions must carry exactly the venue locales % (got %)', expected, got;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  --> statement-breakpoint
  CREATE TRIGGER working_order_lines_check_variant_locales
    BEFORE INSERT OR UPDATE ON working_order_lines
    FOR EACH ROW EXECUTE FUNCTION working_order_lines_check_variant_locales();
  ```
  Copy the exact join path from `0001_db_baseline_sql.sql`'s existing function (it may reach `locations` differently — match it verbatim rather than the sketch above). Schema-qualify nothing that the baseline leaves unqualified; match its search-path posture.

- [ ] **Step 4: Run a real-PG guard.** Add/extend a test that inserts a working-order line with a well-formed `variant_descriptions` (passes) and a mis-keyed one (raises). Prove the trigger by deletion in a scratch run.

Run: `pnpm --filter @waitron/db test:coverage 2>&1 | tail -30`
Expected: migrations apply; the new trigger test passes.

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/db/src/schema/sales.ts packages/db/src/schema/orders.ts packages/db/drizzle
  git commit -s -m "Freeze staff name and the variant's customer, staff and kitchen names on sale lines

  Sale and working-order lines now snapshot the product staff name and the
  variant's own three names; variant customer text is held under exactly the
  invoice locales, checked by a trigger like the product descriptions."
  ```

### Task B2: Working-order line freeze writes the new snapshot fields

**Files:**
- Modify: `apps/server/src/working-order.ts` (presentation copy ~293–324, invoice re-key ~557–563, freeze map ~571–631)
- Test: `apps/server/src/working-order.test.ts`

**Interfaces:**
- Consumes: widened `SelectedVariant` (A5), `customerPresentationText`/`staffPresentationName` (A3), `toInvoiceLineDescriptions` (unchanged).

- [ ] **Step 1: Write the failing test.** Build a working order from a product+variant whose staff, customer and kitchen names all differ, and assert the frozen `working_order_lines` row has: `name` = product staff name, `variant_name` = variant staff name, `descriptions` = invoice-keyed product customer text, `variant_descriptions` = invoice-keyed variant customer text, `kitchen_name`/`variant_kitchen_name` from the product/variant kitchen names.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/server test:coverage src/working-order 2>&1 | tail -30`).

- [ ] **Step 3: Implement.**
  - Where `selectMenuVariant`/presentation is consumed (~293–324), build a `ProductPresentation` from the widened `SelectedVariant` and derive: the staff name (`staffPresentationName`), the two customer maps (`customerPresentationText(pres, defaultLanguage)`), the product/variant kitchen names.
  - Carry `name`, `variantName` (staff string), `variantDescriptions`, `variantKitchenName`, `kitchenName` onto `lineMeta` alongside the existing `variantId`.
  - At the invoice re-key (~557), re-key BOTH `line.descriptions` (product customer map) and the new `line.variantDescriptions` (when non-null) through `toInvoiceLineDescriptions`.
  - In the freeze map (~571–631), set `name: meta.name` (parent; child rows carry the child's own snapshot name — a child modifier has no product, so `name` for a child is its modifier snapshot label; confirm the child branch and keep child `name` sourced as the child descriptions' resolved text so the not-null column is satisfied), `variantName: meta.kind === "parent" ? meta.variantName : null`, `variantDescriptions: meta.kind === "parent" ? meta.variantDescriptions : null`, `variantKitchenName: meta.kind === "parent" ? meta.variantKitchenName : null`. `descriptions`/`kitchenName` as today.
  - NOTE the not-null `name`: a child modifier line must still supply a non-null `name`. Set it from the child's resolved `descriptions` text (the modifier label). State this in a one-line comment.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/working-order.ts apps/server/src/working-order.test.ts
  git commit -s -m "Freeze the product staff name and the variant's three names onto the order line"
  ```

### Task B3: `record-sale` and `sale-line-rows` carry the new fields to `sale_lines`

**Files:**
- Modify: `packages/core/src/record-sale.ts` (`RecordSaleLine`), `packages/core/src/sale-line-rows.ts`
- Test: `packages/core/src/record-sale.test.ts` / `sale-line-rows.test.ts`

**Interfaces:**
- Produces: `RecordSaleLine` gains `name: string`, `variantDescriptions?: Record<string,string> | null`, `variantKitchenName?: string | null`; `variantName?: string | null` (was `Record`).

- [ ] **Step 1: Write the failing test.** Assert `saleLineRows` maps `name`, `variantName` (string), `variantDescriptions`, `variantKitchenName` onto the row (defaulting the optional ones to null), alongside the existing `descriptions`/`kitchenName`.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/core test:coverage src/sale-line-rows 2>&1 | tail -30`).

- [ ] **Step 3: Implement.** Add `name` (required) to `RecordSaleLine`; change `variantName` to `string | null`; add `variantDescriptions`/`variantKitchenName`. In `saleLineRows`, add `name: line.name`, `variantName: line.variantName ?? null`, `variantDescriptions: line.variantDescriptions ?? null`, `variantKitchenName: line.variantKitchenName ?? null`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/core/src/record-sale.ts packages/core/src/sale-line-rows.ts packages/core/src/*.test.ts
  git commit -s -m "Sale lines carry the frozen staff name and the variant's customer, staff and kitchen names"
  ```

### Task B4: Filing path passes the new snapshot fields from the frozen order

**Files:**
- Modify: the code that turns a retrieved/filed `working_order_lines` row into a `RecordSaleLine` (grep for where `saleLineRows`/`recordSale` is fed from working orders — likely `apps/server/src/till-sale.ts` or within `working-order.ts` file path)
- Test: the corresponding server test (e.g. `apps/server/src/till-sale.test.ts`)

**Interfaces:**
- Consumes: `working_order_lines.name/variantName/variantDescriptions/variantKitchenName` (B1/B2), `RecordSaleLine` (B3).

- [ ] **Step 1: Find the seam.**

Run: `grep -rn "variantName\|kitchenName\|descriptions" apps/server/src/till-sale.ts | head`
Read the mapping from a working-order line to `RecordSaleLine`.

- [ ] **Step 2: Write the failing test.** File a sale from a retrieved order with a variant and assert the `sale_lines` row carries `name`, `variant_name`, `variant_descriptions`, `variant_kitchen_name` unchanged from the frozen order line.

- [ ] **Step 3: Run — FAIL.**

- [ ] **Step 4: Implement.** In the mapper, copy the four fields from the working-order line onto the `RecordSaleLine`.

- [ ] **Step 5: Run — PASS.** Then commit.
  ```bash
  git add apps/server/src/till-sale.ts apps/server/src/till-sale.test.ts
  git commit -s -m "Filing copies the frozen staff and variant names from the order line to the sale line"
  ```

### Task B5: Kitchen ticket name uses product/variant kitchen names

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` (`kitchenTicketName` ~84–92, `buildTicketItems` selection ~182–197 and name build ~244)
- Test: `apps/server/src/kitchen-print.test.ts`

**Interfaces:**
- Consumes: `working_order_lines.variantKitchenName` and the changed `variant_name` (string).

- [ ] **Step 1: Write the failing test.** A ticket for a line with product kitchen name "COF", variant staff "Large", variant kitchen "LG" reads "COF · LG"; with variant kitchen null it reads "COF · Large"; with product kitchen null it reads "<staff name> · ...".

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/server test:coverage src/kitchen-print 2>&1 | tail -30`).

- [ ] **Step 3: Implement.** `kitchenTicketName` now takes the frozen `name` (staff), `kitchenName`, `variantName` (string|null), `variantKitchenName` (string|null) and mirrors `kitchenPresentationName`: product part = `kitchenName || name`; variant part (if `variantName`) = `variantKitchenName || variantName`; join with " · ". Add `name`, `variantKitchenName` to the `buildTicketItems` column selection and pass them at the name build (~244). Child sub-line names use the frozen child `name`.

- [ ] **Step 4: Run — PASS.** Commit.
  ```bash
  git add apps/server/src/kitchen-print.ts apps/server/src/kitchen-print.test.ts
  git commit -s -m "Kitchen ticket uses the product and variant kitchen names with staff-name fallback"
  ```

### Task B6: Till client + widgets read the staff `name`

**Files:**
- Modify: `apps/till/src/api/client.ts` (`TillProduct`, the inline variant, `TillMenuOffer`, `menuOfferToTillProduct`), `apps/till/src/widgets/product-name.ts`, `dish-format.ts`, `basket.ts`, `product-grid.ts`
- Test: the till widget tests (`product-name.test.ts`, `basket.test.ts`, etc.)

**Interfaces:**
- Produces on `TillProduct`: `name: string` (staff), `customerName?: Record<string,string> | null`; the inline variant gains `name: string` (staff), `customerName`, `kitchenName`, `image`. `descriptions` is removed from `TillProduct`/`TillMenuOffer` in favour of `name`/`customerName`.

- [ ] **Step 1: Confirm what the server sends the till.** The till's product list comes from a server route; grep the route that builds `TillProduct`/`TillMenuOffer` payloads and change it to send `name`/`customerName` instead of `descriptions`. (Search `descriptions` in the till-facing catalogue/menu server route.)

- [ ] **Step 2: Write the failing test.** `productName(product)` returns `product.name` (staff), not a resolved translation. A basket line for a new item shows the staff name; a retrieved line shows the frozen staff `name`.

- [ ] **Step 3: Run — FAIL** (`pnpm --filter @waitron/till test:coverage 2>&1 | tail -30`).

- [ ] **Step 4: Implement.**
  - `client.ts`: `TillProduct.descriptions` → `name: string` + `customerName?`; inline variant `name: string` + `customerName?`/`kitchenName?`/`image?`; `TillMenuOffer` likewise; `menuOfferToTillProduct` copies `name`/`customerName`/`variants`.
  - `product-name.ts`: `productName` returns `product.name`. `unitName` unchanged.
  - `dish-format.ts`: keep `descriptionFor`/`snapshotDescriptionFor` for retrieved snapshot text where the till still shows a snapshot map; new lines now show the plain staff `name`. Adjust `basket.ts` `#lineName`/`#lineText` so a NEW line reads `line.product.name` and a RETRIEVED line reads the frozen staff `name` string (the till's retrieved-line shape carries `name` now, not a map). Options continue to resolve via their own `name` maps.
  - `product-grid.ts`: `productName(product)` still — no change beyond the helper.

- [ ] **Step 5: Run — PASS.** Commit.
  ```bash
  git add apps/till/src apps/server/src
  git commit -s -m "Till shows the staff-facing product and variant names"
  ```

---

# Phase C — Server routes

### Task C1: Editor create/update routes take `customerName` and save station/course in one transaction

**Files:**
- Modify: `apps/server/src/catalogue-api.ts` (POST `/management-api/catalogues/:id/product-editor` ~841, PUT `/management-api/products/:id/editor` ~868)
- Test: `apps/server/src/catalogue-api.test.ts`

**Interfaces:**
- Consumes: `saveProductEditor` (A7), `setProductStation`/`setProductCourse` from `apps/server/src/kitchen.ts` (`(tx, cfg, productId, id|null)`).
- Produces: the editor body accepts `stationId?: string | null`, `courseId?: string | null`; the response `ProductEditorValue` reflects them.

- [ ] **Step 1: Write the failing tests.** (a) PUT editor with `stationId`/`courseId` set persists them and the returned value shows them; (b) a save whose station id does not exist rolls back the WHOLE product (name unchanged) — assert the domain error and that no product fields changed; (c) POST create editor accepts station/course for a brand-new product.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/server test:coverage src/catalogue-api 2>&1 | tail -40`).

- [ ] **Step 3: Implement.** In both editor route handlers, inside the single `gated(sessionId, (tx) => …)` callback: call `saveProductEditor(tx, …)`, then if the body carried `stationId`/`courseId` call `setProductStation(tx, cfg, saved.id, stationId)` / `setProductCourse(tx, cfg, saved.id, courseId)` on the SAME `tx`, awaited in turn (never `Promise.all`), then return `readProductEditor(tx, …)` so the response reflects them. Obtain `cfg` the way `management-api.ts:2440`'s existing `setProductCourse` route does. Parse `stationId`/`courseId` from the body as `string | null | undefined` (screen non-string non-null as `management.request_invalid`). Import `setProductStation`/`setProductCourse` into `catalogue-api.ts`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/catalogue-api.ts apps/server/src/catalogue-api.test.ts
  git commit -s -m "Save station and course inside the product editor transaction

  The editor route now writes the product, its variants, memberships,
  modifiers and its kitchen routing in one transaction, so a rejected
  routing id rolls the whole product back."
  ```

### Task C2: Management POST/PATCH `/products` use `name`/`customerName`

**Files:**
- Modify: `apps/server/src/catalogue-api.ts` (POST ~888, PATCH ~988 body screens and `input` build)
- Test: `apps/server/src/catalogue-api.test.ts` (the POST/PATCH product tests)

**Interfaces:** the management staff routes screen `name: string` (required on POST) + `customerName?: object | null` instead of `descriptions`.

- [ ] **Step 1: Write the failing test.** POST `/management-api/products` with `{ name: "Coffee", customerName: { en: "Fresh" }, ... }` creates it; a missing `name` is `management.request_invalid` field `name`; PATCH sets `customerName: null`.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement.** Replace the `descriptions` screen (`if (!isPlainObject(body.descriptions)) …`) with a `name` screen (`if (typeof body.name !== "string" || !body.name.trim()) throw management.request_invalid field "name"`) and an optional `customerName` screen (`object | null`). Thread `name`/`customerName` into the `createProduct`/`updateProduct` input. `validateContentTranslations` now runs on `customerName ?? {}`.

- [ ] **Step 4: Run — PASS.** Commit.
  ```bash
  git add apps/server/src/catalogue-api.ts apps/server/src/catalogue-api.test.ts
  git commit -s -m "Management product routes accept name and customer_name"
  ```

---

# Phase D — UI primitives and the shared reorder table

### Task D1: `wt-disclosure` primitive

**Files:**
- Create: `packages/ui/src/components/wt-disclosure.ts`, `packages/ui/src/components/wt-disclosure.test.ts`, `packages/ui/src/components/wt-disclosure.a11y.test.ts`
- Modify: the `@waitron/ui` barrel that exports components (grep `export` in `packages/ui/src/index.ts` for how `wt-card` is surfaced), and add an entry to `docs/developers/design-system.md`

**Interfaces:**
- Produces: `<wt-disclosure heading summary ?open ?has-error>` with a slotted body. Header is a `<button aria-expanded>`; clicking toggles `open`; `has-error` forces it open and prevents collapse while set. Emits `wt-toggle` `{ open }` via `dispatchWtChange`-style dispatch (custom event `wt-toggle`, bubbles/composed).

- [ ] **Step 1: Write the failing tests.** `wt-disclosure.test.ts` (token-painting + behaviour):
  ```ts
  import { describe, expect, test, afterEach } from "vitest";
  import { cleanup, host, mount } from "../test-helpers.js";
  import "./wt-disclosure.js";
  afterEach(cleanup);

  test("collapsed by default; body hidden", async () => {
    const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
    expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  });
  test("clicking the header opens it and emits wt-toggle", async () => {
    const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
    let opened: boolean | undefined;
    el.addEventListener("wt-toggle", (e) => { opened = (e as CustomEvent).detail.open; });
    el.shadowRoot!.querySelector("button")!.click();
    await el.updateComplete;
    expect(opened).toBe(true);
    expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  });
  test("has-error forces open and blocks collapse", async () => {
    const el = await mount('<wt-disclosure heading="Kitchen" has-error><p>body</p></wt-disclosure>');
    const btn = el.shadowRoot!.querySelector("button")!;
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    btn.click();
    await el.updateComplete;
    expect(btn.getAttribute("aria-expanded")).toBe("true"); // still open
  });
  test("summary paints from the muted-text token", async () => {
    const el = await mount('<wt-disclosure heading="Kitchen" summary="Bar"><p>b</p></wt-disclosure>');
    host.style.setProperty("--wt-color-text-muted", "rgb(9, 9, 9)");
    const s = el.shadowRoot!.querySelector(".summary")!;
    expect(getComputedStyle(s).color).toBe("rgb(9, 9, 9)");
  });
  ```
  `wt-disclosure.a11y.test.ts` mirrors `wt-switch.a11y.test.ts`: `describe.each(["light","dark"])`, states collapsed / open / has-error, `expectNoA11yViolations(host)`.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/ui test src/components/wt-disclosure -- --run`).

- [ ] **Step 3: Implement** `wt-disclosure.ts`, copying the `wt-card`/`wt-switch` shape: `@customElement`, `static override styles = [baseStyles, css\`…\`]` with only `--wt-*` tokens, reflected `open`/`hasError` (`@property({ type: Boolean, reflect: true, attribute: "has-error" })`), a header `<button type="button" aria-expanded>` showing `heading` and an optional `.summary`, a chevron `wt-icon`, and a body wrapper toggled with the `hidden` property (not `display`). Toggle handler: if `hasError`, ignore; else flip `open` and dispatch `new CustomEvent("wt-toggle", { detail: { open: this.open }, bubbles: true, composed: true })` after `event.stopPropagation()`. When `hasError` becomes true, set `open = true` in `willUpdate`. `declare global` map block.

- [ ] **Step 4: Run — PASS**, and run the auto-scan: `pnpm --filter @waitron/ui test src/no-hardcoded-chrome -- --run` (Expected: PASS — proves no literal chrome).

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/ui/src/components/wt-disclosure.* packages/ui/src/index.ts docs/developers/design-system.md
  git commit -s -m "Add wt-disclosure: a collapsible section with a summary that opens on error"
  ```

### Task D2: `wt-price-input` primitive

**Files:**
- Create: `packages/ui/src/components/wt-price-input.ts` (+ `.test.ts`, `.a11y.test.ts`)
- Modify: `packages/ui/src/index.ts`, `docs/developers/design-system.md`

**Interfaces:**
- Produces: `<wt-price-input name label .value unit ?required .error>` — a money field plus a trailing `<button>` showing `unit`. Emits `wt-change` `{ value }` (via `dispatchWtChange`) on input, and `wt-unit-click` (bubbles/composed) when the unit button is pressed.

- [ ] **Step 1: Write the failing tests.** token-painting (the unit button border/text paints from tokens), `wt-change` on input carries the typed value, `wt-unit-click` fires on the button, `error` renders beside the field with `aria-invalid`. a11y test in both themes for default / error / with-unit states.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**, copying `wt-input` for the field part (grep `packages/ui/src/components/wt-input.ts` for its structure and `wt-change` dispatch) and adding a trailing unit `<button type="button" @click>` that dispatches `wt-unit-click`. Tokens only.

- [ ] **Step 4: Run — PASS**, plus `no-hardcoded-chrome` scan.

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/ui/src/components/wt-price-input.* packages/ui/src/index.ts docs/developers/design-system.md
  git commit -s -m "Add wt-price-input: a money field with a trailing clickable unit button"
  ```

### Task D3: Extract the shared reorder table and give it a live region

**Files:**
- Create: `apps/dashboard/src/widgets/reorder-table.ts` (+ `reorder-table.test.ts`)
- Modify: `apps/dashboard/src/widgets/modifier-form.ts` to use it
- Test: extend `apps/dashboard/src/widgets/modifier-form.test.ts` to assert the live region announces after an arrow-key move

**Interfaces:**
- Produces: a reusable controller or base element owning `#drag`, `#reorderKey`, `#startDrag`, `#onPointerMove/End`, `#endDrag`, `#choiceAt`, `#rowBounds`, `#refocus`, the `.handle` CSS, and a `role="status"` polite live region. It calls back into the host to reorder (via the pure `reorder.ts`) and to label the moved row. Exact surface: a Lit reactive controller `ReorderController` with `attach(host)`, `handle(id, label)` (returns the handle template), `announce(text)`, and `moved(id): void` hooks — OR, if a controller proves awkward with Lit templates, a mixin. Decide during Step 3 and record the choice in a comment; the tests below pin behaviour, not the mechanism.

- [ ] **Step 1: Write the failing test** (`modifier-form.test.ts`): after focusing a handle and pressing ArrowDown, the form's `role="status"` region text names the moved choice and its new position ("Milk moved to position 2 of 3"); the order also changed. This is the gap the backlog records for #352.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/dashboard test:coverage src/widgets/modifier-form 2>&1 | tail -30`).

- [ ] **Step 3: Implement.** Move the drag/keyboard/`#choiceAt`/refocus code and `.handle` CSS from `modifier-form.ts` into `reorder-table.ts`, add a polite `<div role="status" aria-live="polite">` whose text is set on every move to `t("action.reordered", { item, index, total })` (add the string in Task E5). Rewire `modifier-form.ts` to use it. Keep `reorder.ts` as the array math.

- [ ] **Step 4: Run — PASS.** Commit.
  ```bash
  git add apps/dashboard/src/widgets/reorder-table.* apps/dashboard/src/widgets/modifier-form.ts apps/dashboard/src/widgets/modifier-form.test.ts
  git commit -s -m "Extract the drag-and-keyboard reorder table and announce moves to a screen reader

  The modifier choices table and the new variants table share one reorder
  implementation, and a keyboard move now names the moved row and its new
  position in a polite live region."
  ```

---

# Phase E — Dashboard editor widgets

### Task E1: Dashboard client types (`ProductEditorInput`/`Value` + variant)

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (lines ~302–332)
- Test: none new (types); covered by the screen tests downstream. A `tsc` compile is the check.

**Interfaces:**
- Produces:
  ```ts
  export interface ProductEditorVariant {
    id?: string;
    name: string;
    customerName: Record<string, string> | null;
    kitchenName: string | null;
    image: string | null;
    unitPrice: string;
    available: boolean;
  }
  export interface ProductEditorInput {
    name: string;
    customerName: Record<string, string> | null;
    description: Record<string, string> | null;
    kitchenName: string | null;
    image: string | null;
    unitId: string;
    unitPrice: string;
    available: boolean;
    vatClass: VatClass;
    variants: ProductEditorVariant[];
    categoryIds: string[];
    primaryCategoryId: string | null;
    modifierIds: string[];
    allergens: Record<string, { presence: "contains" | "may_contain" }> | null;
    dietaryDeclarations: ("vegan" | "vegetarian" | "halal" | "kosher" | "no_meat" | "no_fish")[];
    stationId: string | null;
    courseId: string | null;
  }
  export interface ProductEditorValue extends ProductEditorInput { id: string; }
  ```
  (`stationId`/`courseId` move UP into the input, since they now save with the product; `ProductEditorValue` no longer needs to add them.)

- [ ] **Step 1: Change the types** as above. Confirm `createProductEditor`/`updateProductEditor` send the whole `ProductEditorInput` (they already do).

- [ ] **Step 2: Compile.**

Run: `pnpm --filter @waitron/dashboard exec tsc --noEmit 2>&1 | tail -30`
Expected: errors now only in the editor widgets that consume the old shapes (fixed in E2–E4).

- [ ] **Step 3: Commit.**
  ```bash
  git add apps/dashboard/src/api/client.ts
  git commit -s -m "Dashboard client: product editor Name is plain text with a customer name and per-variant detail"
  ```

### Task E2: `dashboard-variant-form` (the small Add/Edit variant window)

**Files:**
- Create: `apps/dashboard/src/widgets/variant-form.ts` (+ `variant-form.test.ts`, `variant-form.a11y.test.ts`)

**Interfaces:**
- Consumes: `ProductEditorVariant`, `locales`.
- Produces: `<dashboard-variant-form open busy .locales .value .unitLabel>` emitting `wt-submit` `{ value: ProductEditorVariant }` and `wt-cancel`. One flat list: Name (required), Price (required; unit label shown, not editable), Available, Kitchen name, Customer-facing name per locale, Image (via `dashboard-image-upload`).

- [ ] **Step 1: Write the failing tests.** Opening with a value populates the fields; submitting with a blank name shows the required error and does not emit; a valid submit emits `wt-submit` with the edited value; Cancel emits `wt-cancel`; the unit label renders read-only. a11y test both themes for empty / filled / error.

- [ ] **Step 2: Run — FAIL** (`pnpm --filter @waitron/dashboard test:coverage src/widgets/variant-form 2>&1 | tail -30`).

- [ ] **Step 3: Implement** as a `wt-modal` (small) with a flat `.fields` column, following `product-editor.ts`'s existing `textField` helper and image-upload wiring. Validate on submit (name non-empty, price matches `/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/`); keep the draft on a failed submit; suspend nothing (it is itself the child window).

- [ ] **Step 4: Run — PASS.** Commit.
  ```bash
  git add apps/dashboard/src/widgets/variant-form.*
  git commit -s -m "Add the variant editor window: staff name, price, availability, kitchen name, customer names, image"
  ```

### Task E3: `dashboard-variant-table` (the sortable variants table)

**Files:**
- Create: `apps/dashboard/src/widgets/variant-table.ts` (+ `variant-table.test.ts`, `variant-table.a11y.test.ts`)

**Interfaces:**
- Consumes: `ProductEditorVariant[]`, the `ReorderController`/mixin from D3, `unitLabel`.
- Produces: `<dashboard-variant-table .variants .unitLabel .busy>` with columns Name · Price @ unit · Available · ⋯. Emits `wt-reorder` `{ from, to }` (or `{ order: string[] }`), `wt-edit` `{ index }`, `wt-remove` `{ index }`, `wt-toggle-available` `{ index, available }`. The unit label sits in the price column header. Drag + arrow-key reorder with the live region (from D3). The ⋯ menu uses `wt-row-actions`.

- [ ] **Step 1: Write the failing tests.** Renders one row per variant with the staff name and price; the Available switch in a row emits `wt-toggle-available`; the ⋯ Edit/Remove emit `wt-edit`/`wt-remove`; a keyboard ArrowDown on a handle emits `wt-reorder` and announces via the live region. a11y both themes.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**, reusing the D3 reorder table for the handle/drag/keyboard/live-region and `wt-row-actions` for ⋯. Cells that go into a `wt-data-table` would need `part=`; but this is a plain `<table>` the widget owns, so normal classes are fine — do NOT route it through `wt-data-table` (the styling-by-class trap only applies to `wt-data-table` cells).

- [ ] **Step 4: Run — PASS.** Commit.
  ```bash
  git add apps/dashboard/src/widgets/variant-table.*
  git commit -s -m "Add the variants table: drag or arrow-key reorder, per-row availability and a row menu"
  ```

### Task E4: Rework `dashboard-product-editor`

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`, `apps/dashboard/src/widgets/product-editor-model.ts`
- Test: `apps/dashboard/src/widgets/product-editor.test.ts`, `product-editor.a11y.test.ts`

**Interfaces:**
- Consumes: `wt-disclosure` (D1), `wt-price-input` (D2), `dashboard-variant-table` (E3), `dashboard-variant-form` (E2), `dashboard-category-membership-picker` (existing) in a `wt-modal`, `ProductEditorDraft` (widened).
- Produces: the reworked editor emitting the existing `wt-submit`/`wt-cancel`/`wt-create-related`, but NOT `wt-set-product-station`/`wt-set-product-course` (station/course now travel in the submitted value).

- [ ] **Step 1: Update the draft model.** In `product-editor-model.ts`: `ProductEditorDraft.name` → `string`; add `customerName: LocalizedText | null`; `EditorVariant` → `{ id?; name: string; customerName: LocalizedText | null; kitchenName: string | null; image: string | null; unitPrice: string; available: boolean }`; `stationId`/`courseId` become non-optional `string | null` (they submit with the product). Update `emptyDraft()`.

- [ ] **Step 2: Write the failing tests.** Field order (Name, Categories, Available, then the collapsed Kitchen/Descriptors/Nutritional info, then Price with VAT first, then Modifiers); a collapsed section opens when a field in it has an error and focus lands there; the first Add variant converts the plain price into a "Regular" variant and opens the variant window; removing to one variant folds the price back and drops the row; Categories opens the membership picker modal and its Save updates the draft; station/course are present for a NEW product and are included in the submitted value. Rework the existing tests rather than deleting their behavioural assertions.

- [ ] **Step 3: Run — FAIL** (`pnpm --filter @waitron/dashboard test:coverage src/widgets/product-editor 2>&1 | tail -40`).

- [ ] **Step 4: Implement.**
  - Replace the top translated-name loop with a single `Name` text field; move customer-facing name (per locale) + description (per locale) + image into a `wt-disclosure` "Descriptors"; move allergens+dietary into a `wt-disclosure` "Nutritional info"; move kitchen name + station + course into a `wt-disclosure` "Kitchen" (station/course selects for every product now — drop the `this.value?.id ?` gate, and drop the `wt-set-product-*` event dispatch; on change just update the draft).
  - Categories: render chosen categories as `wt-lozenge`s (reporting one visually distinct) plus a "+" that opens `dashboard-category-membership-picker` inside a `wt-modal`; on the picker's `wt-submit` update `categoryIds`/`primaryCategoryId`.
  - Price section: VAT `<select>` first (keep `.selected=` on options), then, when `draft.variants` is empty, a `wt-price-input` bound to `unitPrice` with the unit button opening the unit dropdown (reuse the existing unit `<select>` + Add unit); when non-empty, `dashboard-variant-table` with the unit in its price-column header. **Add variant** button below.
  - The "Regular" fold: first add converts `{ unitPrice }` into a variant `{ name: t("editor.variant_regular"), customerName: null, kitchenName: null, image: null, unitPrice, available: draft.available }` and opens `dashboard-variant-form` for the NEW one; removing to length 1 folds `variants[0].unitPrice` back into `draft.unitPrice` and clears `variants`.
  - Modifiers: a `wt-combobox` over unattached modifiers with a "Create new…" entry (opens the modifier form nested via the existing `wt-create-related` path), plus the attached list as rows with a ⋯ menu (Edit opens the modifier form nested; Remove detaches). Reuse the D3 reorder table for ordering.
  - Section-opens-on-error: give each `wt-disclosure` `?has-error=${this.sectionHasError(name)}` computed from `this.errors`/`this.fieldErrors`.
  - Validation: name required (string); prices valid; VAT + unit chosen; each variant name+price valid; reporting category ∈ chosen. Build the submitted value with `name`, `customerName`, per-variant fields, `stationId`, `courseId`.

- [ ] **Step 5: Run — PASS.** Then a11y: `pnpm --filter @waitron/dashboard test:coverage src/widgets/product-editor.a11y 2>&1 | tail -20`.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/dashboard/src/widgets/product-editor.ts apps/dashboard/src/widgets/product-editor-model.ts apps/dashboard/src/widgets/product-editor*.test.ts
  git commit -s -m "Rework the product editor: short collapsible form, staff name, variants table, routing in Save"
  ```

### Task E5: Host screen wiring and strings

**Files:**
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts` (remove the `wt-set-product-station`/`-course` handlers ~345–370; the submitted value now carries them), `apps/dashboard/src/i18n/strings.ts` (add labels)
- Test: `apps/dashboard/src/screens/catalogue-screen.test.ts`

**Interfaces:** consumes the reworked editor.

- [ ] **Step 1: Write/adjust the failing test.** Saving the editor sends one `updateProductEditor`/`createProductEditor` call including `stationId`/`courseId`; there is no separate `setProductStation`/`setProductCourse` call.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement.** Delete the two `@wt-set-product-*` handlers on `<dashboard-product-editor>`; the `#save` path already sends the whole value. Remove now-unused `setProductStation`/`setProductCourse` from the client only if nothing else calls them (grep first — the Venue operations screen may still use them; if so, keep them). Add strings: `editor.variant_regular`, `action.reordered` (with `{item}`/`{index}`/`{total}` placeholders), section headings/summaries (`editor.section_kitchen`, `editor.section_descriptors`, `editor.section_nutrition`, and their summary builders), `editor.customer_name`, `editor.add_variant`, in both `en` and `es`.

- [ ] **Step 4: Run — PASS.** Commit.
  ```bash
  git add apps/dashboard/src/screens/catalogue-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/catalogue-screen.test.ts
  git commit -s -m "Wire the reworked product editor into the catalogue screen and add its labels"
  ```

---

# Phase F — Seeds, docs, integration walk

### Task F1: Seeds and fixtures move to `name` + `customerName`

**Files:**
- Modify: `apps/server/scripts/demo-seed/menu.ts` (`SeedProduct` type + ~45 literals), `apps/server/scripts/demo-seed/seed-catalogue.ts`, `apps/server/scripts/demo-seed/seed-sales.ts`, `packages/catalogue/test/fixtures.ts`, `apps/server/src/testing/venue-fixtures.ts`
- Test: run the demo seed against a scratch DB; run the fixture-consuming suites

- [ ] **Step 1: Update the seed data type.** `SeedProduct.descriptions` → `name: string` + `customerName?: Record<SeedLocale, string>`. For each literal, set `name` to a staff name (the current default-language string is a good staff name) and, where a translation adds customer value, `customerName`. `seed-catalogue.ts` passes `name`/`customerName` to `createProduct`. `seed-sales.ts`'s `toInvoiceLineDescriptions` calls now take the customer text (fall back to `name`).
- [ ] **Step 2: Update fixtures** (`fixtures.ts`, `venue-fixtures.ts`): `descriptions: { en: "sliced ham" }` → `name: "sliced ham"` (+ `customerName` where a test asserts translated receipt text). Add variant `name`/`customerName`/`kitchenName`/`image` where a fixture builds variants.
- [ ] **Step 3: Run the seed and the fixture suites.**

Run: `pnpm --filter @waitron/server exec tsx scripts/demo-seed/seed-catalogue.ts` against a scratch DB (or the suite that exercises the seed), and `pnpm --filter @waitron/catalogue test:coverage 2>&1 | tail -20`.
Expected: seed completes; fixture suites green.

- [ ] **Step 4: Commit.**
  ```bash
  git add apps/server/scripts/demo-seed packages/catalogue/test/fixtures.ts apps/server/src/testing/venue-fixtures.ts
  git commit -s -m "Seeds and fixtures use the staff name and customer name model"
  ```

### Task F2: Docs — design-system, products guide, backlog

**Files:**
- Modify: `docs/developers/design-system.md` (Forms/primitives: `wt-disclosure`, `wt-price-input`, the variants table), `docs/developers/products.md` (the three-name model, station/course in Save, the min-two-variants rule), `docs/backlog.md` (mark the rework, close the #352 live-region gap noted in the backlog)

- [ ] **Step 1: Update `products.md`** to describe Name vs customer-facing name vs kitchen name and which screen shows which; the variants table and the Regular fold; station/course saving with the product; the min-two rule.
- [ ] **Step 2: Update `design-system.md`** with the two new primitives (their contract) and the collapsible-section-with-summary pattern.
- [ ] **Step 3: Update `docs/backlog.md`** — record the rework as landed once merged, and strike the "keyboard reorder says nothing to a screen reader" open item under #352 (closed by D3). Read the whole base-to-tip range for stale claims about `descriptions`/product names in READMEs and runbooks (CLAUDE.md §1 — a behaviour change retires receipts about the old behaviour); fix any found.
- [ ] **Step 4: Commit.**
  ```bash
  git add docs/developers/design-system.md docs/developers/products.md docs/backlog.md
  git commit -s -m "Docs: the three-name product model, the two new primitives and the closed reorder gap"
  ```

### Task F3: Integration walk on a dev stack

**Files:** none (verification).

- [ ] **Step 1: Rebuild the dev DB and start the stack.**

Run: `wa-wt reset demo <worktree-name>` then `wa-wt demo <worktree-name>`
Expected: migrations apply cleanly on a virgin dev DB.

- [ ] **Step 2: Walk the real journey** (the step the #345 checkpoint left unwalked, and the trap that a green suite hid a 500 on first open): open `/manage/products`, create a product from scratch — set Name, add a customer-facing name in a second language, open each collapsed section, add a unit / a category / a modifier from inside the dirty draft, add two variants (watch the Regular fold), set station/course, Save. Then take it through the till: add it to an order (variant required), fire it (check the kitchen ticket shows the kitchen names), pay, and read the receipt (customer-facing name in the receipt language). Open the editor and both new primitives in BOTH themes and at phone width.

- [ ] **Step 3: Record the walk** in the branch's handoff ledger and note anything found. Fix any defect as its own task before finishing.

- [ ] **Step 4:** No commit (verification only), unless a fix was needed.

---

## Self-review notes (for the executor)

- **Spec coverage:** the three names (A3/B/E), variant kitchen/customer/image (A2/A4/E2), collapsible form + summaries + open-on-error (D1/E4), VAT-in-Price + unit button (D2/E4), variants table + Regular fold + reorder + live region (D3/E3/E4), station/course in Save (C1/E4/E5), categories modal reuse (E4), modifier attach/create/edit/remove/reorder (E4), min-two-variants (A7/C1), translation-gap rule (A8), snapshot freeze + filing + kitchen ticket + till (B1–B6), seeds/docs/walk (F1–F3). Menus: the spec keeps `menu_item_variants` as-is; `selectMenuVariant`/`resolveMenuVariant` widen (A5) but the menu editor's own screens are unchanged by this branch — confirm no menu screen read `descriptions` for a product name (grep during E; if one does, add a task).
- **Risk triggers present** (so the FULL finish-branch ceremony applies): a fiscal-adjacent snapshot/immutability surface (`sale_lines`), migrations, a cross-package contract (`SelectedVariant`, `ProductEditorInput`), and a by-id write path (station/course). The fresh-context plan-vs-spec read and the Codex run-it seat run regardless.
- **Type consistency:** `ProductEditorInput`/`ProductEditorValue` exist in BOTH `@waitron/catalogue` (`product-editor-input.ts`) and `apps/dashboard/src/api/client.ts` — keep them in step (both get `name: string` + `customerName`). `ProductVariant`/`ProductVariantInput` (catalogue) vs `ProductEditorVariant` (dashboard) are separate types with the same fields.
- **Not backwards-compatible by design:** every `descriptions` reference for a PRODUCT NAME is being removed. Grep `descriptions` at the end and confirm each remaining use is the SALE-LINE snapshot `descriptions` (kept) or an unrelated field — not a lingering product-name read.
