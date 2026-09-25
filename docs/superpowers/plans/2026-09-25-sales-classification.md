# Sales classification and category reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each product a main reporting category in a strict tree, and any number of flat
labels. Record on every sale line, from now on, what was sold and how it was classified at that
moment. Then offer category reports in two clearly labelled modes: at the time of sale, and current.

**Architecture:**
- **Reporting categories stay where they are:** today's `categories` / `category_details` tree
  (a single `parent_id`), with `products.category_id` as the main reporting category.
- **Labels are new flat tags:** `labels` and `product_labels`. They replace the many-to-many
  `product_categories`.
- **At filing time**, the sale path loads the reporting tree and labels once per sale and writes
  plain identity columns plus one JSON classification snapshot onto each `sale_lines` row.
- **Reports** read either the snapshots (historical) or today's classification by `product_id`
  (current).

**Tech Stack:** TypeScript, Drizzle on SQLite, Hono, Lit, Vitest (`useVenueDb`; real Chromium for the
dashboard).

**Spec:** `docs/superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md`
(read it whole). Context: `docs/superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md`
§10. This plan is independent of the menus plan
(`docs/superpowers/plans/2026-09-25-menus-categories-home-layouts.md`), except for the provenance
columns (Task 2). **Order (owner, 2026-09-25): one lane.** This plan's Tasks 1 and 2 run FIRST, so
the history starts building. Then the menus plan's tasks run. This plan's Task 3 runs last.

**Revision history.** First written 2026-09-25 from reads of `main` (facts named with their files
below; reads, not measurements). **Revision 2, the same day, after the second outside review:**
Task 2 names every filing path and takes its snapshot in the issuance pass (spec §3's table), and
Task 3's contract gains the direct-products subtotal and the completeness indicator (spec §5).

## Global Constraints

Everything in the menus plan's **Global Constraints** section applies here too: the worktree per
task, `commit -s`, TDD, `useVenueDb`, migrations generated and read, error codes, the gate, the
screens rules, and the backlog. In addition:

- **This plan is fiscal-adjacent** (CLAUDE.md §5). Task 2 writes new columns on the append-only
  `sale_lines` (`appendOnly("sale_lines", "ledger", …)`, `packages/db/src/classification.ts:18`). The
  golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad`
  pass UNEDITED; if they cannot, STOP.
- **`sale_lines` gains NO foreign keys.** The table's own rule is "Snapshotted values, never
  catalogue references" (`packages/db/src/schema/sales.ts:151`). Whether drizzle-kit emits a plain
  `ADD COLUMN` for a column carrying a key, or rebuilds the table, has not been measured, and a
  rebuild of an append-only fiscal table is exactly what must not happen.
  Declare the new id columns as plain `id(...)`, and say at each column why there is no key (CLAUDE.md
  §3's "say at the column what it cost"). READ the generated SQL: it must be `ALTER TABLE … ADD
  COLUMN` lines only, never a rebuild. If drizzle emits a rebuild, STOP.
- **Owner-facing choices to confirm before the task that builds each:**
  - extras classified by their OWN product, not the dish (spec §3; Task 2);
  - the snapshot taken when the record is issued, not when the line was added — and for a card
    payment that is the pricing pass BEFORE the provider is contacted (spec §3; Task 2);
  - the deletion defaults (spec §2.1; Task 1).

## Review Focus

1. **A category moved mid-period.** In the historical report the month splits across both parents;
   in the current report it does not. Each line rolls up its OWN recorded chain, and nothing groups
   by leaf id first (spec §5; Task 3).
2. **A void on a later day after a move.** The void subtracts under the chain recorded at the
   original sale (spec §4; Task 3).
3. **Gross reconciles.** The category report's gross total for a day equals the sum of that day's
   issued sales totals on the till paths, Uncategorised included. Net equals the VAT summary's bases
   (spec §5; Task 3).
4. **Extras.** An extras child line records its own product and classification and keeps its
   `parent_line_id`. "Rolled into the dish" moves its amount under the dish's chain (spec §3; Tasks
   2–3).
5. **The fiscal record is unchanged.** The golden fingerprint, the VAT breakdown, `sales.total` and
   every pre-existing `sale_lines` column are byte-identical for the same sale before and after
   Task 2 (Task 2).

---

## Task 1: Labels, and the reporting tree made strict — slug `labels`

Spec §2.

**Files:**
- Create: `packages/catalogue/src/schema/labels.ts` (`labels`, `productLabels`) with a generated
  migration, and `packages/catalogue/src/labels.ts` + test.
- Modify:
  - `packages/catalogue/src/categories.ts`: drop the "primary must be a member" rule and the
    `product_categories` writes; add `deleteCategory`'s reassignment. `replaceProductCategories`
    becomes `setMainReportingCategory`, keeping its route path or retiring it — grep callers first.
  - `schema/categories.ts` (drop `productCategories`, in its own generation after labels are
    created), `errors.ts`, `classification.ts`, `configuration-transfer.ts`, `content-languages.ts`
    if labels carry translated names (they do not in the first release: staff-facing name only).
- Modify: `apps/server/src/catalogue-api.ts`; `apps/dashboard/src/screens/categories-screen.ts`:
  - its products modal lists the products whose MAIN category is this one, or is below it (toggle);
  - "Add products" SETS their main category, after confirming how many it moves.
  - Also `widgets/category-membership-picker.ts` (it becomes a single main-category picker plus a
    labels picker), `widgets/product-editor.ts`, `widgets/product-list.ts`, `api/client.ts`,
    `api/live-queries.ts`, and the strings.
- Labels need a place to be managed. Add a "Labels" tab to the existing Categories screen (list,
  create, rename, delete with a count of products affected), with routes under
  `/management-api/labels` (list, create, rename, delete) and `PUT /management-api/products/:id/labels`
  for the product editor's picker.
- Modify: `apps/server/scripts/demo-seed/` (labels for "Happy hour drinks" and "Alcoholic"),
  `docs/developers/product-categories.md` (rewritten: the reporting tree, main category, labels) and
  `docs/backlog.md`.

**Interfaces:**
```ts
export interface Label { id: string; name: string }
export async function listLabels(tx): Promise<Label[]>;
export async function createLabel(tx, name: string): Promise<Label>;        // label.invalid on empty; label.duplicate on an existing name
export async function renameLabel(tx, id: string, name: string): Promise<Label>;
export async function deleteLabel(tx, id: string): Promise<void>;           // removes it from every product
export async function setProductLabels(tx, productId: string, labelIds: string[]): Promise<void>; // label.not_found
export async function deleteCategory(tx, id: string, reassign: { productsTo: string | null; childrenTo: string | null }): Promise<void>;
```

- [ ] **Step 1: Write the failing tests:**
  - **Labels:** create, rename, delete and assign. A variant's labels read as its parent's, and
    `setProductLabels` on a variant is refused with the variant code used elsewhere (grep the
    registry). A duplicate label name is refused.
  - **The reporting tree:**
    - making a category its own ancestor is refused by the EXISTING `category.parent_cycle` (the
      existing cases stay);
    - a product's main category can be any category, with no membership needed;
    - deleting a category with products and children moves them where the call says: by default
      products to its parent (or none, i.e. Uncategorised) and children to its parent (or the top
      level). Nothing is stranded, and its preparation routes are dropped as today.
  - **Screen:** the products modal's "below it too" toggle; "Add products" confirming "Move 3
    products to Cocktails?"; the delete dialog's two reassignment pickers, prefilled with the
    defaults.
  - Run them: they FAIL.
- [ ] **Step 2: Implement.**
  - Labels migration first.
  - Then drop `product_categories` in a SEPARATE generation (the menus plan's Global Constraints:
    never drop and create in one).
  - Measure the upgrade on a `main`-migrated, seeded scratch venue and record it.
- [ ] **Step 3: Run the focused tests, LOOK at the screens in both themes and at 390px. Commit.**

## Task 2: Every sale line records what it was and how it was classified — slug `sale-line-classification`

Spec §3 and §4. **Fiscal-adjacent.**

**Files:**
- Modify:
  - `packages/db/src/schema/sales.ts` (`sale_lines` gains `product_id`, `parent_product_id`,
    `menu_id`, `menu_version_id`, `line_gross`, `classification` — all nullable plain columns);
  - one generated core migration;
  - `packages/core/src/sale-line.ts` and `sale-line-rows.ts` (the row shape), `record-sale.ts` (it
    passes the new fields through; the header and hash are untouched);
  - `packages/catalogue/src/pricing.ts` (`priceRows` already computes per-line gross; carry it onto
    the row).
- Create: `packages/catalogue/src/sale-classification.ts` + test.
  - `loadClassification(tx)` loads the reporting tree and labels once.
  - `classifyLine(c, productId)` returns `{ reporting, labels }` for a product; a variant falls back
    to its parent's main category and takes its parent's labels.
  - `validateSnapshot(s)` checks existing ids, non-empty names, no repeat in the chain, and that the
    leaf is the main category.
- Modify: `apps/server/src/working-order.ts` and `till-sale.ts`: **the issuance pass** — the one
  pricing pass whose figures are filed — attaches `product_id` from `working_order_lines.product_id`,
  the parent product, `line_gross` and the snapshot, loading the classification ONCE per sale,
  never per line. Changing `readLockedLines` alone does not reach every path (spec §3's table):
  - `POST /api/sales` walk-up prices through `priceOrderLines` in the same request, and a held
    order, tab or split check through `priceStoredOrder` (`till-sale.ts:352-364`);
  - `POST /api/pay` prices in P1 (`till-sale.ts:700-709`) and files P1's result in P3 (`:748-757`):
    the snapshot is taken in P1 and carried in `PricedLines` to `recordSale`; nothing is re-read
    after the provider answers;
  - card recovery re-prices at `finalizeRecovery` (`:900`): that pass takes the snapshot;
  - invoice-first files at placing (`placeOrder`, `working-order.ts:2530`): the snapshot is taken
    then, and `collectOrder` reads the issued sale and classifies nothing;
  - ticket-then-pay files at collect (`collectOrder`, `till-sale.ts:1282`).
  Put the attachment in ONE function the five paths call (the menus plan's Task 7a puts VAT
  resolution in the same pass; whichever lands second reuses the seam).
- **Menu provenance:** `menu_id` comes from the line's `working_line_contexts.menu_id` today.
  `menu_version_id` stays null until the menus plan's Task 7 (sell from the published version) fills
  it. Whichever of the two tasks lands SECOND wires `menu_version_id`; the first leaves a
  `docs/backlog.md` line saying so.
- Test: `sale-classification.test.ts`, `till-sale.test.ts`, `working-order.pay-and-dispatch.test.ts`,
  the golden and `inmutabilidad` suites (unedited), and `scripts/append-only-triggers.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 5:** the same sale, filed before and after, has an identical fingerprint,
    `vat_breakdown`, `total` and pre-existing columns. Compare the rows column by column, not just
    the hash.
  - **A dish sale:** `product_id` = the product, `parent_product_id` null, `line_gross` = the
    line's gross, and `classification.reporting` = [Drinks, Alcoholic drinks, Cocktails] with those
    names. Labels are sorted by id with no repeats.
  - **A variant sale:** `product_id` = the variant, `parent_product_id` = its parent, and the chain
    from the parent's main category when the variant sets none.
  - **An extras child line:** `classification` holds its OWN product's chain and labels (spec §3),
    and `parent_line_id` is kept. The existing free-text `category` column is UNCHANGED: it still
    carries the dish's category as today (`pricing.ts:303`), so Review Focus 5's byte-identity
    holds, and the spec's "unchanged" stands.
  - **Uncategorised:** `reporting: []`.
  - **The snapshot is frozen:** renaming or moving the category after filing leaves the stored
    snapshot unchanged. The append-only trigger refuses an update (assert the refusal).
  - **Issuance on every path** (spec §7 example 10): Cocktails moves while each of a tab, an
    invoice-first order and a card payment is open. The tab paid after the move, the invoice-first
    order placed after it, and the card sale whose P1 ran after it record Spirits; an invoice-first
    order placed BEFORE the move and collected after it records Alcoholic drinks; a card payment
    whose P1 ran before the move and whose P3 ran after it records Alcoholic drinks (a stub
    provider that moves the category between P1 and P3); a recovery run after the move records
    Spirits. A reprint of any of them changes nothing.
  - **One read per sale:** a basket of five lines across three categories loads the classification
    once. Count prepared queries, as `packages/venue-service/src/operations.test.ts`'s "resolves a
    menu item once" case does.
  - **`validateSnapshot`:** it refuses each malformed shape.
  - Run them: they FAIL.
- [ ] **Step 2: Implement.** READ the migration: `ALTER TABLE … ADD COLUMN` only (Global
  Constraints). Run `scripts/append-only-triggers.test.ts`, `scripts/schema-constraints.test.ts`,
  `scripts/migrations-match-schema.test.ts` and the golden gate.
- [ ] **Step 3: Run `apps/server`'s `test:coverage` locally** (many suites file sales). **Commit.**

## Task 3: Category reports, in two modes — slug `category-report`

Spec §5 and §6.

**Files:**
- Create: `packages/reporting/src/category-sales.ts` + test.
- Modify: `apps/server/src/report-api.ts` (a route beside the existing reports), the dashboard
  reports screen (find it from `report-api.ts`'s client), the strings, and a print path: a "Print
  category sales" action beside the daily close's print, reusing the existing `document` print jobs.
  **The daily close's snapshot and hash are untouched.**

**Interfaces:**
```ts
export type CategoryReportMode = "at_time_of_sale" | "current";
export interface CategoryTotal {
  id: string | "uncategorised" | "not_recorded"; name: string; depth: number;
  gross: string; net: string;               // this category INCLUDING its children
  direct: { gross: string; net: string };   // products whose main category is this one (spec §5: the "Directly in Drinks" row)
  children: CategoryTotal[];
}
export interface LabelTotal { id: string; name: string; gross: string; net: string } // overlapping by nature
export interface CategoryReport {
  tree: CategoryTotal[]; labels: LabelTotal[]; gross: string; net: string;
  grossComplete: boolean;                   // false when any line in the period has no line_gross
  linesWithoutGross: number;                // how many, for the "Gross total incomplete" note
}
export async function categorySales(tx, cfg, period: { from: Date; to: Date }, mode: CategoryReportMode, opts?: { extrasIntoDish?: boolean }): Promise<CategoryReport>;
```

- [ ] **Step 1: Write the failing tests:** Review Focus 1–4 in full.
  - **Inclusion:** it uses the same inclusion clauses as the existing reports
    (`packages/reporting/src/business-day.ts`): issued in the period, substitutes excluded, voids
    subtracted on the day of the void under the voided line's own snapshot, corrections netted.
  - **Current mode:** it puts pre-feature lines under "Not recorded".
  - **Pre-feature gross:** those lines have no `line_gross`; their net is shown, `grossComplete` is
    false with `linesWithoutGross` = their count, and the screen and the printed page say "Gross
    total incomplete: N lines recorded before classification began" (spec §5). A period without
    such lines reports `grossComplete: true` and shows no note (the control).
  - **A parent with direct products** (spec §7 example 9): Water's main category is Drinks, Cola's
    is Softs under Drinks. Drinks' `gross` = Water + Cola, `direct` = Water alone, and the screen
    renders a "Directly in Drinks" row before Softs. A category with no direct sales renders no such
    row.
  - **Labels:** the label list is marked as overlapping.
  - **Screen:** the mode is always shown in the heading ("Categories at time of sale" / "Current
    categories"). LOOK in both themes and at 390px.
  - **Print:** the printed page carries the same heading.
  - Run them: they FAIL.
- [ ] **Step 2: Implement.**
  - Load the period's lines once.
  - Historical mode walks each line's recorded chain, adding the amount at every step.
  - Current mode joins `product_id` to today's tree in memory.
  - Measure the query on a month of seeded sales before considering an index (spec §3).
- [ ] **Step 3: Run to verify they pass. Commit.**

## Finish (every task)

`/finish-branch` (full wave; Codex in the run-it seat), then `/land-branch`. Update
`docs/backlog.md` in each PR.

## Self-Review notes

- **Spec coverage:** §2.1 → Task 1; §2.2 → Task 1; §3 → Task 2; §4 → Tasks 2 (identity, extras) and
  3 (inclusion); §5 → Task 3; §6 → Task 3; §7's examples → spread across the tasks' tests (1, 5 →
  Task 3; 2 → Tasks 1 and 3; 3, 4, 6 → Tasks 2 and 3; 7, 8 → Task 3).
- **Deliberately not here:** corrections wiring (no route calls `recordCorrection` today; spec §4
  states the rule for when one does); nested or per-variant labels; any cache or cloud export;
  routing rules.
