# Ordering Modifiers / Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable option groups with priced options to the catalogue, so a product can be sold with modifiers ("Latte — large, oat milk"; "Burger, no onions, extra bacon"), each selected option filed as its own fiscal sub-line linked to its parent line.

**Architecture:** Options live in three new tenant-scoped catalogue tables. A selected option becomes its own `working_order_line` / `sale_line` (it already has the right columns — description, qty, unit price, VAT rate, total, no product ref), linked to its parent dish line by a new nullable `parent_line_id` self-FK. Pricing reuses the existing `priceRows` arithmetic core — a child line is just another priced row (grossUnit = the option's price delta, rate = its VAT-class override or the dish's rate). The fiscal record is built from `total` + `vatBreakdown` only (never from individual lines), so modifier amounts flow into the desglose/total correctly and `parent_line_id` is structurally excluded from the huella.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL (real-PG + PGlite test targets), Vitest, Lit web components (`apps/till`, `apps/dashboard`), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-30-ordering-modifiers-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- **This is the unrepairable fiscal core.** Supervised, behind a dedicated fiscal review; never landed unattended (CLAUDE.md §5, backlog H2).
- **No backfill / no data migration** — nothing is deployed; schema changes drop & recreate (CLAUDE.md §3).
- **Any `tenant_id`-bearing table needs FORCE RLS + a `<t>_tenant_isolation` policy + `app_user` grants**, hand-written in a `--custom` migration; `.enableRLS()` alone is insufficient (CLAUDE.md §3). The `inmutabilidad` guard (`packages/fiscal-verifactu`) scans every `tenant_id` table for FORCE and fails if it is missing.
- **Never build SQL by string concatenation**; Drizzle parameterises `sql` templates.
- **Money is GROSS (VAT-inclusive) `numeric(12,2)`**, single tenant currency; VAT rate is a percentage literal e.g. `"21.00"`. `MONEY_SCALE` from `@waitron/shared`.
- **Descriptions are a `Record<string,string>` locale→text map** keyed EXACTLY by the location's full-tag `invoice_locales`; re-key bare catalogue content via `toInvoiceLineDescriptions` on the sale path (never throws — §5).
- **Error codes name the domain concept** (`options.*` / `option.*` — grep the twelve `payment.` siblings for the singular/plural convention before choosing; codes are never renamed once shipped). Every file that throws imports its registry via `import "./errors.js"`.
- **Modifiers attach to `each` products only** in this slice; a child line's `quantity` follows its parent dish's quantity. Reject attaching a group to a `weight` product (validation).
- **The gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`; before claiming a package green run `pnpm --filter <pkg> test:coverage`. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`; run `pnpm reap` if interrupted.
- **Run the fiscal guards explicitly** after schema tasks: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.

## File Structure

- `packages/db/src/schema/catalogue.ts` — +3 tables (`option_groups`, `option_group_items`, `product_option_groups`), each `.enableRLS()`.
- `packages/db/src/schema/orders.ts` — `working_order_lines.parent_line_id` (nullable self-FK), `.option_group_item_id` (nullable).
- `packages/db/src/schema/sales.ts` — `sale_lines.parent_line_id` (nullable self-FK).
- `packages/db/drizzle/*` — generated column migration + `--custom` migration (FORCE RLS + policies + grants + tenant-consistent self-FKs).
- `packages/catalogue/src/operations.ts` — option-group/item types + reads; `AvailableProduct` grows `optionGroups`.
- `packages/catalogue/src/pricing.ts` — expand product+options → parent+child `PricingRow`s (new `priceBasketWithOptions`), `parentLineNo` threaded through `priceRows`.
- `packages/core/src/record-sale.ts` — `RecordSaleLine.parentLineNo`; pre-generate `sale_lines` ids and resolve `parentLineNo → parent id`.
- `apps/server/src/working-order.ts` — `priceOrderLines` accepts `options`, resolves+validates them, builds parent+child rows with pre-generated ids + `parent_line_id` + `option_group_item_id`.
- `apps/server/src/kitchen-print.ts` + live-queue reads — parent-only `ticket_items`; child sub-text on the parent.
- `apps/server/src/receipt-ticket.ts`, `apps/till/src/widgets/basket.ts` — group children under parent.
- `apps/till/src/widgets/product-grid.ts` + new `apps/till/src/widgets/modifier-picker.ts` — open picker on tap of a product with groups.
- `apps/till/src/state/working-order.ts`, `apps/till/src/api/client.ts` — basket holds options; `SaleLine` grows `options`.
- `apps/server/src/catalogue-api.ts` / `management-api.ts` — group/item CRUD + attach link + read-backs.
- `apps/dashboard/src/screens/catalogue-screen.ts` + new `option-group-manager.ts` widget + `apps/dashboard/src/widgets/product-form.ts` — authoring UI.
- `dev-setup.ts` — seed groups, attach to demo products, sprinkle modifiers into back-dated sales.

---

## Phase 1 — Fiscal-core data model & pricing (review-gated)

### Task 1: Catalogue schema — option groups, items, and the product↔group link

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts`
- Create (generated): `packages/db/drizzle/00NN_*.sql` (columns/tables) and `packages/db/drizzle/00NN_*_options_rls.sql` (`--custom`)
- Test: `packages/db/src/catalogue.rls.test.ts` (extend), `packages/fiscal-verifactu/src/*inmutabilidad*` (run, do not edit)

**Interfaces:**
- Produces: Drizzle tables `optionGroups`, `optionGroupItems`, `productOptionGroups` exported from `@waitron/db`; item columns `{ id, tenantId, groupId, name jsonb, priceDelta numeric(12,2), vatClass text|null, sort int, active bool }`.

- [ ] **Step 1: Write the failing test** — extend the catalogue RLS suite to assert an `app_user` connection can `select`/`insert` its own tenant's `option_group_items` and is denied cross-tenant rows, and that `option_group_items` has `relforcerowsecurity = true`.

```ts
// packages/db/src/catalogue.rls.test.ts (new cases, mirror the existing products cases)
it("app_user sees only its tenant's option_group_items", async () => {
  await asAppUser(db, tenantA, async (tx) => {
    const rows = await tx.select().from(optionGroupItems);
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
  });
});
it("option_group_items forces RLS", async () => {
  const [{ relforcerowsecurity }] = await raw(db,
    `select relforcerowsecurity from pg_class where relname = 'option_group_items'`);
  expect(relforcerowsecurity).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test catalogue.rls` → FAIL (`optionGroupItems` not exported / relation missing).

- [ ] **Step 3: Add the three tables** to `packages/db/src/schema/catalogue.ts`, following the `products`/`categories` pattern (composite tenant-consistent FKs, `.enableRLS()`):

```ts
export const optionGroups = pgTable("option_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: jsonb("name").$type<Record<string, string>>().notNull(),
  minSelect: integer("min_select").notNull().default(0),
  maxSelect: integer("max_select").notNull().default(1),
  required: boolean("required").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [
  index("option_groups_tenant_id_idx").on(t.tenantId),
  unique("option_groups_tenant_id_key").on(t.tenantId, t.id),
  check("option_groups_select_ck", sql`${t.maxSelect} >= ${t.minSelect} and ${t.minSelect} >= 0`),
  check("option_groups_required_ck", sql`${t.required} = false or ${t.minSelect} >= 1`),
]).enableRLS();

export const optionGroupItems = pgTable("option_group_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  groupId: uuid("group_id").notNull(),
  name: jsonb("name").$type<Record<string, string>>().notNull(),
  priceDelta: numeric("price_delta", { precision: 12, scale: 2 }).notNull().default("0"),
  vatClass: text("vat_class"), // null = inherit the parent dish's rate at add time
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [
  index("option_group_items_group_idx").on(t.groupId),
  unique("option_group_items_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.groupId], foreignColumns: [optionGroups.tenantId, optionGroups.id], name: "option_group_items_group_fk" }).onDelete("cascade"),
]).enableRLS();

export const productOptionGroups = pgTable("product_option_groups", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  productId: uuid("product_id").notNull(),
  groupId: uuid("group_id").notNull(),
  sort: integer("sort").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.productId, t.groupId] }),
  foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id], name: "product_option_groups_product_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.groupId], foreignColumns: [optionGroups.tenantId, optionGroups.id], name: "product_option_groups_group_fk" }).onDelete("cascade"),
]).enableRLS();
```

- [ ] **Step 4: Generate migrations.** Run `pnpm --filter @waitron/db db:generate` (columns + ENABLE RLS), then hand-write the `--custom` migration adding, for each of the three tables, `ALTER TABLE … FORCE ROW LEVEL SECURITY`, `CREATE POLICY <t>_tenant_isolation … USING/WITH CHECK (tenant_id = current_tenant_id())`, and `GRANT SELECT, INSERT, UPDATE, DELETE ON <t> TO app_user` — copy the shape verbatim from `0001_tenancy_rls.sql` / `0027`'s catalogue grants. (If a migration-number collision with `main` appears, reset `drizzle/` to `main` and re-run generate — see the Drizzle rebase memo in CLAUDE.md.)

- [ ] **Step 5: Run tests** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage catalogue.rls` → PASS; then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → PASS (new tables show FORCE). Prove the FORCE guard by deletion: drop the `FORCE` line, watch inmutabilidad go red, restore.

- [ ] **Step 6: Commit** — `git add -A && git commit -s -m "feat(db): option groups, items, and product-group link tables (FORCE RLS)"`.

### Task 2: Line self-FK columns — parent_line_id and option_group_item_id

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (working_order_lines), `packages/db/src/schema/sales.ts` (sale_lines)
- Create (generated): column migration + `--custom` for the tenant-consistent self-FK
- Test: `packages/db/src/*` schema round-trip test (extend the nearest orders/sales schema test)

**Interfaces:**
- Produces: `workingOrderLines.parentLineId` (uuid|null), `workingOrderLines.optionGroupItemId` (uuid|null), `saleLines.parentLineId` (uuid|null).

- [ ] **Step 1: Write the failing test** — insert a parent line and a child line whose `parentLineId` points at the parent's `id`; assert the row reads back and a child pointing at a foreign-tenant line is rejected by the composite FK.

```ts
it("a sale_line may reference its parent line within the tenant", async () => {
  // insert a sale + parent line, capture parentId; insert child with parentLineId = parentId
  // expect select to return the child with parent_line_id = parentId
});
```

- [ ] **Step 2: Run to verify it fails** — column/relation missing.

- [ ] **Step 3: Add the columns.** In `sales.ts` `saleLines`, add `parentLineId: uuid("parent_line_id")` (nullable) with a doc comment: *presentation/reporting metadata only — the fiscal record is built from `total`+`vatBreakdown`, never from `sale_lines`, so this never reaches the huella (design §4).* Add a tenant-consistent self-FK in the `--custom` migration: `foreign key (tenant_id, parent_line_id) references sale_lines(tenant_id, id)` guarded so a null passes (SQL FK is null-permissive). Add `unique("sale_lines_tenant_id_key").on(tenantId, id)` as the FK target. Repeat for `workingOrderLines.parentLineId`; also add `optionGroupItemId: uuid("option_group_item_id")` (nullable, working-order only — authoring traceability, NOT copied to sale_lines) with a tenant-consistent FK to `option_group_items`.

- [ ] **Step 4: Generate + custom migration**, as Task 1 Step 4.

- [ ] **Step 5: Run tests** — `pnpm --filter @waitron/db test:coverage` schema round-trip → PASS; `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` still green (no new FORCE needed — existing tables).

- [ ] **Step 6: Commit** — `git commit -s -m "feat(db): parent_line_id on working_order_lines + sale_lines, option_group_item_id"`.

### Task 3: Catalogue reads — load a product's option groups & items

**Files:**
- Modify: `packages/catalogue/src/operations.ts`
- Test: `packages/catalogue/src/operations.test.ts` (or the nearest reads test)

**Interfaces:**
- Produces:
  ```ts
  export interface ResolvedOptionItem { id: string; name: Record<string,string>; priceDelta: string; vatClass: VatClass | null; }
  export interface ResolvedOptionGroup { id: string; name: Record<string,string>; minSelect: number; maxSelect: number; required: boolean; items: ResolvedOptionItem[]; }
  // AvailableProduct grows:  optionGroups: ResolvedOptionGroup[]
  ```
- Consumes: Task 1 tables.

- [ ] **Step 1: Write the failing test** — seed a product with one attached group of two active items (one free, one +0.50); assert `listAvailableProducts` returns it with `optionGroups[0].items` in `sort` order and inactive items excluded.

- [ ] **Step 2: Run to verify it fails** — `optionGroups` undefined on the read shape.

- [ ] **Step 3: Implement the read.** Extend `listAvailableProducts` (`operations.ts:425`) to left-join `product_option_groups → option_groups → option_group_items` (active groups & items only), grouped by product, ordered by group `sort` then item `sort`. Add `optionGroups` to `AvailableProduct`. Keep the query one round trip (a grouped read, as the existing catalogue reads do).

- [ ] **Step 4: Run tests** — `pnpm --filter @waitron/catalogue test:coverage operations` → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(catalogue): read a product's attached option groups + items"`.

### Task 4: Pricing — expand product+options into parent+child priced lines

**Files:**
- Modify: `packages/catalogue/src/pricing.ts`
- Test: `packages/catalogue/src/pricing.test.ts`

**Interfaces:**
- Consumes: `PriceableProduct`, `priceRows` (internal), `RATES`/`resolveVatRate`.
- Produces:
  ```ts
  export interface SelectedOption { name: Record<string,string>; priceDelta: string; vatClass: VatClass | null; }
  export interface BasketItemWithOptions { product: PriceableProduct; quantity: string; options: SelectedOption[]; }
  export function priceBasketWithOptions(items: readonly BasketItemWithOptions[]): PricedLines;
  // RecordSaleLine gains parentLineNo (Task 5); priceRows copies PricingRow.parentLineNo onto it.
  ```

- [ ] **Step 1: Write the failing tests** covering the four behaviours the spec pins:
  - a dish with a free option and a +0.50 option yields **three** lines; the two child lines have `parentLineNo` = the dish's `lineNo`, the free one `lineTotal` base of 0.
  - **qty propagation:** 2× a dish with one +1.00 option → child `quantity` = "2", child gross line total 2.00.
  - **mixed VAT:** an option with `vatClass = "general"` on a `reduced` dish produces a `vatBreakdown` with both rates, each including the right amounts.
  - **inheritance:** an option with `vatClass = null` takes the dish's rate.

```ts
it("prices a dish with options as parent + child lines", () => {
  const priced = priceBasketWithOptions([{
    product: { descriptions: { es: "Café" }, pricingUnit: "each", unitPrice: "2.50", vatClass: "reduced", category: "Drinks" },
    quantity: "1",
    options: [
      { name: { es: "Grande" }, priceDelta: "0.50", vatClass: null },
      { name: { es: "Leche avena" }, priceDelta: "0.40", vatClass: null },
    ],
  }]);
  expect(priced.lines).toHaveLength(3);
  expect(priced.lines[1]!.parentLineNo).toBe(1);
  expect(priced.total.toString()).toBe("3.40");
});
```

- [ ] **Step 2: Run to verify it fails** — `priceBasketWithOptions` not defined.

- [ ] **Step 3: Implement.** Add `parentLineNo?: number | null` to `PricingRow` and to `RecordSaleLine` (Task 5 defines the latter; here just carry it), and copy it in `priceRows`'s `lines.push({...})`. Implement `priceBasketWithOptions` by expanding each item to `[parentRow, ...childRows]` **in order** (so `priceRows` numbers parent before children), computing each child's `parentLineNo` from the parent's position, then calling `priceRows`:

```ts
export function priceBasketWithOptions(items: readonly BasketItemWithOptions[]): PricedLines {
  const rows: PricingRow[] = [];
  for (const item of items) {
    const parentLineNo = rows.length + 1;
    rows.push({
      grossUnit: decimal(item.product.unitPrice), quantity: item.quantity,
      rate: resolveVatRate(item.product.vatClass),
      descriptions: item.product.descriptions, category: item.product.category,
      parentLineNo: null,
    });
    for (const opt of item.options) {
      rows.push({
        grossUnit: decimal(opt.priceDelta), quantity: item.quantity, // qty follows the dish
        rate: opt.vatClass === null ? resolveVatRate(item.product.vatClass) : resolveVatRate(opt.vatClass),
        descriptions: opt.name, category: item.product.category, // snapshot parent's category
        parentLineNo,
      });
    }
  }
  return priceRows(rows);
}
```
Keep `priceBasket` (no-options path) unchanged; `priceBasketWithOptions` with empty `options` must equal `priceBasket` line-for-line (add that equivalence test).

- [ ] **Step 4: Run tests** — `pnpm --filter @waitron/catalogue test:coverage pricing` → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(catalogue): price a basket with modifiers as parent+child lines"`.

### Task 5: recordSale — file child sale_lines with parent_line_id

**Files:**
- Modify: `packages/core/src/record-sale.ts`
- Test: `packages/core/src/record-sale.test.ts` + a huella-invariance case in `packages/fiscal-verifactu`

**Interfaces:**
- Consumes: `RecordSaleLine` (grows `parentLineNo?: number | null`), `saleLines` schema (Task 2).
- Produces: `sale_lines` rows carrying `parent_line_id`; unchanged `{ saleId, fiscal }` return.

- [ ] **Step 1: Write the failing tests:**
  - `recordSale` with a parent line (lineNo 1) and a child line (lineNo 2, `parentLineNo: 1`) writes two `sale_lines`; the child's `parent_line_id` equals the parent's generated `id`.
  - **Huella invariance:** two sales identical except one child line's `parentLineNo` (present vs null) produce byte-identical fiscal `huella` — because `sale_lines` never reach the backend. (Mirror the existing `entorno`-invariance test's structure in `fiscal-verifactu`.)
  - **Desglose includes child amounts:** a `reduced` dish + a `general` option → the filed `sales.vat_breakdown` carries both rates. (This is already true via Task 4's `vatBreakdown`; pin it here at the record level.)

- [ ] **Step 2: Run to verify it fails** — `parentLineNo` not on `RecordSaleLine`; `parent_line_id` not written.

- [ ] **Step 3: Implement.** Add `parentLineNo?: number | null` to `RecordSaleLine` (doc: *the `lineNo` of this line's parent dish; null for a top-level line — resolved to the parent's generated id at insert, presentation metadata only, never hashed*). In the `saleLines` insert (`record-sale.ts:337`), pre-generate one id per line and resolve the self-link:

```ts
const ids = input.lines.map(() => crypto.randomUUID());
const byLineNo = new Map(input.lines.map((l, i) => [l.lineNo, ids[i]!]));
await tx.insert(saleLines).values(
  input.lines.map((line, i) => ({
    id: ids[i]!, tenantId: input.tenantId, saleId, lineNo: line.lineNo,
    parentLineId: line.parentLineNo == null ? null : (byLineNo.get(line.parentLineNo) ?? null),
    descriptions: line.descriptions, quantity: line.quantity, unitPrice: line.unitPrice,
    vatRate: line.vatRate, lineTotal: line.lineTotal, category: line.category ?? null,
  })),
);
```
Nothing else in `recordSale` changes — `backend.recordSale` still receives only `total` + `vatBreakdown`.

- [ ] **Step 4: Run tests** — `pnpm --filter @waitron/core test:coverage record-sale` and `pnpm --filter @waitron/fiscal-verifactu test:coverage` → PASS. Prove the invariance test by deletion: temporarily feed `sale_lines` into the huella (a scratch mutation) and watch it go red, then revert.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(core): file modifier sale_lines linked by parent_line_id"`.

### Task 6: working-order — accept options, validate, build parent+child lines

**Files:**
- Modify: `apps/server/src/working-order.ts` (`priceOrderLines`), plus its `WorkingOrderLineInsert` shape and the sale/round callers' input types
- Create: `apps/server/src/errors.ts` addition or a new `options.*` code in the owning package's registry (grep siblings first)
- Test: `apps/server/src/*working-order*` / the counter+tab sale suites

**Interfaces:**
- Consumes: `priceBasketWithOptions` (Task 4), `AvailableProduct.optionGroups` (Task 3), `RecordSaleLine.parentLineNo` (Task 5).
- Produces: `priceOrderLines` accepts `lines: { productId; quantity; courseId?; options?: { optionGroupItemId: string }[] }[]` and emits parent + child `working_order_lines` rows with pre-generated ids, `parent_line_id`, `option_group_item_id`; `priced` includes child lines.

- [ ] **Step 1: Write the failing tests:**
  - a counter sale of a dish with two selected options files **three** `sale_lines` and shows a total including both deltas; the two child `working_order_lines` carry `parent_line_id` = the parent's id and the right `option_group_item_id`.
  - **park → retrieve → file invariant WITH modifiers:** park the order, retrieve, pay; the filed total + desglose equal the previewed ones (the `readLockedLines → priceStoredOrder` path re-prices children from their locked `unit_price_gross`/`vat_rate` exactly).
  - **server-side validation, fail loud:** an `optionGroupItemId` not belonging to a group attached to the product → `option.not_found` (or the chosen code); a selection violating `required`/`min`/`max` → `options.selection_invalid`; an option on a `weight` product → rejected.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `priceOrderLines`.** For each input line: resolve the product (as today); resolve each `optionGroupItemId` against that product's `optionGroups` (Task 3 read, already in hand from `listAvailableProducts` — no extra query), throwing `option.not_found` for an id not in an attached active group, and `options.selection_invalid` when the per-group `required`/`minSelect`/`maxSelect` are violated; refuse options on a non-`each` product. Build `BasketItemWithOptions` and call `priceBasketWithOptions`. Re-key each line's `descriptions` via `toInvoiceLineDescriptions` (unchanged loop — now also covers child lines). Build the `working_order_lines` rows with pre-generated ids and the `parent_line_id`/`option_group_item_id` resolution mirroring Task 5:

```ts
const ids = priced.lines.map(() => crypto.randomUUID());
const byLineNo = new Map(priced.lines.map((l, i) => [l.lineNo, ids[i]!]));
const lineRows = priced.lines.map((line, i) => ({
  id: ids[i]!, tenantId: cfg.tenantId, workingOrderId, lineNo: line.lineNo,
  parentLineId: line.parentLineNo == null ? null : byLineNo.get(line.parentLineNo)!,
  optionGroupItemId: /* the source option id for a child line, null for a parent */,
  productId: /* the parent's productId for a parent line; null for a child */,
  descriptions: line.descriptions, quantity: line.quantity, unitPrice: line.unitPrice,
  unitPriceGross: priced.grossUnitPrices[i]!, vatRate: line.vatRate,
  lineTotal: priced.grossLineTotals[i]!, category: line.category ?? null,
  courseId: /* parent only; children inherit nothing (no ticket_item, Task 7) */,
}));
```
`working_order_lines.product_id` is currently `NOT NULL` — this task must make it **nullable** for child lines (a child has no product), in Task 2's migration or a follow-on column change; update Task 2's schema step accordingly and keep the parent path `NOT NULL` in practice. Thread the widened `options` field from the sale (`POST /api/sales`) and tab-round (`addTabRound`) handlers into `priceOrderLines`, and pass each `priced` line's `parentLineNo` into `recordSale` (already carried on `RecordSaleLine`).

> **Correction to Task 2:** `working_order_lines.product_id` must become nullable (child lines have no product). Add that to Task 2 Step 3 and its migration; the composite `(tenant_id, product_id) → products` FK is already null-permissive.

- [ ] **Step 4: Run tests** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` for the sale/tab suites → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): ring + file modifiers as parent/child order lines with server-side validation"`.

---

## Phase 2 — KDS & receipt rendering

### Task 7: Kitchen tickets — parent-only ticket_items, child sub-text

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` (`enqueueKitchenTickets`, `ticketName`), the live-queue reads (`listStationQueue`/`listExpoQueue`)
- Test: `apps/server/src/*kitchen*` / KDS queue suites

**Interfaces:**
- Consumes: `working_order_lines.parent_line_id` (Task 2).

- [ ] **Step 1: Write the failing tests:**
  - firing a dish with two options creates **one** `ticket_item` (for the parent), not three; a child line gets none.
  - the rendered kitchen ticket for that parent shows the dish name then its two options as indented sub-text (`+ Grande`, `+ Leche avena`).
  - a child line is **never** independently station-resolved (no `station.no_default` from an option).

- [ ] **Step 2: Run to verify it fails** — three ticket_items today.

- [ ] **Step 3: Implement.** In `enqueueKitchenTickets`, filter fired lines to `parentLineId == null` before creating `ticket_items`. In `ticketName` (and the group-ticket builder), after the parent's `qty × name`, append each child line's name (looked up by `parentLineId`) as an indented `+ <name>` row. In the live queue reads, join each returned parent's child lines and attach them as sub-items for the KDS UI. Station stays the parent's snapshot.

- [ ] **Step 4: Run tests** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` KDS suites → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(kds): render modifiers as child sub-text under the parent ticket item"`.

### Task 8: Receipt + on-screen basket — group children under parent

**Files:**
- Modify: `apps/server/src/receipt-ticket.ts` (`formatReceipt`), `apps/till/src/widgets/basket.ts`
- Test: `apps/server/src/*receipt*`, `apps/till/src/widgets/basket.test.ts`

**Interfaces:**
- Consumes: `sale_lines.parent_line_id` / working-order line children.

- [ ] **Step 1: Write the failing tests:**
  - `formatReceipt` renders the dish line at its price then each option indented at its delta (€0.00 shown for a free option), and the ticket totals/VAT reconcile with the filed desglose.
  - the till `basket` groups child lines under their parent and removes children when the parent is removed.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the parent→child grouping in both renderers. Keep the grouping helper small and identical on both sides (the `formatReceipt`-hand-ports-from-`apps/till` copy-drift debt stays tracked, not widened). Children are not independently deletable in the basket.

- [ ] **Step 4: Run tests** — `pnpm --filter @waitron/server test:coverage receipt` and `pnpm --filter @waitron/till test:coverage basket` → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): group modifier lines under their dish on receipt + basket"`.

---

## Phase 3 — Till & handheld ordering UX

### Task 9: Client line contract + basket state carry options

**Files:**
- Modify: `apps/till/src/api/client.ts` (`SaleLine`), `apps/till/src/state/working-order.ts` (`OrderLine`, `addProduct`)
- Test: `apps/till/src/state/working-order.test.ts`

**Interfaces:**
- Produces: `SaleLine` grows `options?: { optionGroupItemId: string }[]`; `OrderLine` carries the selected options + a client-side running price.

- [ ] **Step 1: Write the failing test** — `addProduct(product, "1", selectedOptions)` stores the options on the basket line and the client running total includes their deltas.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — widen `OrderLine` and `addProduct`; widen the outbound `SaleLine`/round payload to include `options`. Client price is display-only; the server re-prices authoritatively.

- [ ] **Step 4: Run tests** — `pnpm --filter @waitron/till test:coverage working-order` → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): basket line carries selected options"`.

### Task 10: Modifier picker widget

**Files:**
- Create: `apps/till/src/widgets/modifier-picker.ts`
- Modify: `apps/till/src/widgets/product-grid.ts` (open picker on tap of a product with groups)
- Test: `apps/till/src/widgets/modifier-picker.test.ts`

**Interfaces:**
- Consumes: `AvailableProduct.optionGroups` (Task 3), `addProduct` (Task 9).

- [ ] **Step 1: Write the failing tests** (happy-dom component tests, following the existing `product-grid`/`basket` widget test style):
  - a product with **no** groups rings instantly on tap (no picker) — regression guard.
  - a product with groups opens the picker; a `required` single-select group blocks "Add" until chosen; a `maxSelect`-reached group disables its remaining options; the running price sums dish + deltas.
  - on confirm, the picker emits the parent product + selected `optionGroupItemId`s to `addProduct`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the `wt-`-primitive dialog: render groups in `sort` order; single-select as radios, multi as checkboxes; enforce min/max/required client-side; show a running total; emit on confirm. In `product-grid`, branch the tile tap: `optionGroups.length === 0` → `store.addProduct(product, "1")` as today; else open the picker. It lives in the shared table-order/counter flow, so the #173 handheld inherits it.

- [ ] **Step 4: Run tests** — `pnpm --filter @waitron/till test:coverage modifier-picker product-grid` → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): modifier picker on tap of a product with option groups"`.

---

## Phase 4 — Dashboard authoring

### Task 11: management-api — option-group/item CRUD + attach link + read-backs

**Files:**
- Modify: `apps/server/src/catalogue-api.ts` (or `management-api.ts`, matching where category/course config routes live)
- Test: `apps/server/src/*catalogue-api*` / management-api suites

**Interfaces:**
- Produces: `GET/POST/PATCH /management-api/option-groups`, `…/option-groups/:id/items`, and the `product_option_groups` attach/detach on the product PATCH; read-backs for both screens.

- [ ] **Step 1: Write the failing tests** — create a group + items; attach it to a product; `GET` returns them; a cross-tenant id is denied; `report`/`till.configure`-equivalent permission gate enforced (grep the sibling routes for the exact permission — likely `menu.manage`/`catalogue`-scoped).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the routes following the existing category/course route shape (enumerated request bodies, `authorize()` with the catalogue-management permission, RLS under `withTenant`). The product POST/PATCH body grows an optional ordered `optionGroupIds`.

- [ ] **Step 4: Run tests** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` catalogue-api → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): option-group CRUD + attach routes"`.

### Task 12: Dashboard — option-group manager + product-form attach

**Files:**
- Create: `apps/dashboard/src/widgets/option-group-manager.ts`
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts`, `apps/dashboard/src/widgets/product-form.ts`, `apps/dashboard/src/api/client.ts`
- Test: `apps/dashboard/src/widgets/option-group-manager.test.ts`, `product-form.test.ts`

**Interfaces:**
- Consumes: Task 11 routes.

- [ ] **Step 1: Write the failing tests** — the manager CRUDs groups/items (per-locale name, price delta, optional VAT-class override, min/max/required, sort/active); the product form attaches/orders existing groups and shows them on reload.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the manager widget (sibling to `category-manager.ts`) and the product-form attach section, wired to the Task 11 API client methods, following the dashboard's widget/design-system conventions.

- [ ] **Step 4: Run tests** — `pnpm --filter @waitron/dashboard test:coverage option-group-manager product-form` → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(dashboard): option-group manager + product attach UI"`.

---

## Phase 5 — Demo seed

### Task 13: Seed modifiers into the demo restaurant

**Files:**
- Modify: `dev-setup.ts` (the demo seed + the back-dated sales generator)
- Test: `dev-setup`'s own test if present; otherwise a smoke assertion that seeded products expose groups

**Interfaces:**
- Consumes: all of Phase 1–4.

- [ ] **Step 1: Write the failing test / assertion** — after `dev:setup`, at least one coffee product returns a `Size` and a `Milk` group, and at least one burger returns `Extras` + `Cooking`; and some back-dated `sale_lines` carry a non-null `parent_line_id`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — author the groups/items (English by default, Spanish under `WAITRON_SEED_LOCALE=es-ES`, matching the existing seed), attach them to the coffees/burgers, and have the back-dated sales generator occasionally select options so the reports/receipt screens show modifier sub-lines.

- [ ] **Step 4: Run** `pnpm dev:setup` locally and verify the till shows a picker on a coffee/burger and a plain ring on a simple item; run the seed test → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(seed): demo option groups on coffees + burgers, modifiers in back-dated sales"`.

---

## Self-Review notes (author)

- **Spec coverage:** §3 → Task 1; §4 → Tasks 2, 4, 5, 6; §5 → Task 7; receipt/basket (§5) → Task 8; §6 → Tasks 9–10; §7 authoring → Tasks 11–12; §7 seed → Task 13; §8 fiscal guards → run in Tasks 1, 5, 6; §9 YAGNI honoured (no per-option qty, no re-open-edit, no per-modifier routing, no nested groups).
- **Type consistency:** `parentLineNo` (int, by lineNo) is the caller-facing link on `RecordSaleLine`/`PricingRow`; it resolves to `parentLineId` (uuid) only at the two insert sites (Tasks 5, 6). `optionGroupItemId` is working-order-only, never on `sale_lines`.
- **Cross-task correction:** Task 6 makes `working_order_lines.product_id` nullable — folded back into Task 2's migration (noted inline). Verify the composite product FK stays null-permissive.
- **Fiscal safety:** the fiscal record is built from `total`+`vatBreakdown` only; `sale_lines`/`parent_line_id` never reach `backend.recordSale`, so the huella-invariance test (Task 5) is a guard against a future regression, not a live risk.

## Open decisions deferred to execution

- Exact `options.*` vs `option.*` error-code spelling — grep the `payment.` siblings first (Global Constraints).
- Whether the catalogue-management permission is `menu.manage` or a catalogue-scoped code — grep the sibling category/course routes (Task 11).
- `option_group_items.vat_class` as a checked `text` vs a shared enum — pick the lighter that matches `products.vat_class`.
