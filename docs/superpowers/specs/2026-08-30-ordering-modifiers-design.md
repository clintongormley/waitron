# Ordering modifiers / variants — design

**Status:** approved (brainstorm, 2026-08-30). Backlog: Tier B #7. Supervised, fiscal-core.
**Sub-project:** SP18 (Menu/recipes) + touches SP2 (sales spine) and SP3 (fiscal layer).

## 1. Problem

Products are flat. There is no way to sell "Latte — large, oat milk" or "Burger, no onions,
extra bacon". The catalogue, the order pipeline, the fiscal record, the KDS and every UI represent a
line as `{ productId, quantity }` plus snapshotted scalars (one gross price, one locale→string
description, one VAT rate). There is no child structure a modifier could hang from at any layer.
This feature adds **reusable option groups** with **priced options**, and files each selected option
as its own fiscal sub-line.

## 2. Decisions (from the brainstorm)

| Decision | Choice | Why |
| --- | --- | --- |
| Modifier shape | **Full option groups** (reusable, min/max/required) | A real menu needs "choose 1 size", "up to 3 extras", not a flat add-on list. |
| Fiscal representation of a priced modifier | **Its own sale sub-line**, own amount + own VAT, linked to its parent line | Fiscally itemised; supports mixed VAT within a dish; reuses the existing immutable line machinery. |
| Free (zero-price) modifiers | **Also their own sub-line** (€0.00) | Uniform — one representation everywhere; KDS/receipt just render parent + children. |
| Option VAT | Nullable **override**; null = inherit the parent dish's rate at add time | Most modifiers share the dish's rate; the override exists only because the sub-line shape allows mixed VAT. |
| Per-option quantity ("extra shot ×2") | **Deferred** | `max_select` covers "up to N of a group"; a count on one option is a later nicety (backlog). |
| Options as entities | **Dedicated tables**, not `products` | Options never appear in the sell grid; stay lean (no image/station/course/recipe columns). |

**This touches the unrepairable fiscal core.** Modifier amounts and VAT reach the `desglose` and the
huella, so implementation is **supervised, behind a dedicated fiscal review, never landed
unattended** (CLAUDE.md §5, backlog H2).

## 3. Catalogue data model (authoring)

Three new tenant-scoped tables in `packages/db/src/schema/catalogue.ts`. Each carries `tenant_id` and
therefore needs **FORCE ROW LEVEL SECURITY + a `<t>_tenant_isolation` policy + `app_user` grants**,
hand-written in a custom migration the way `0001_tenancy_rls.sql` does (CLAUDE.md §3). The
`inmutabilidad` guard (`packages/fiscal-verifactu`) scans every `tenant_id`-bearing table for FORCE
and will fail if it is missing.

- **`option_groups`** — reusable named group.
  `id, tenant_id, name jsonb (locale→string), min_select int, max_select int, required bool, sort int, active bool`.
  Invariants: `min_select >= 0`, `max_select >= min_select`, `required` implies `min_select >= 1`
  (a CHECK, or app-layer validation — decide in the plan).
- **`option_group_items`** — the choices in a group.
  `id, tenant_id, group_id FK→option_groups, name jsonb (locale map), price_delta numeric(12,2) (gross, default 0), vat_class text NULL (null = inherit parent dish), sort int, active bool`.
  `vat_class` values match `products.vat_class` (`general|reduced|super_reduced|zero`).
- **`product_option_groups`** — m2m attaching groups to products.
  `product_id FK→products, group_id FK→option_groups, sort int`, PK `(product_id, group_id)`.
  Reusable: one group attaches to many products.

## 4. Order lines, pricing & the fiscal record

**A selected option becomes its own line**, in both the working order and the filed sale. No new
immutable child table — modifiers reuse the existing line rows.

- **New nullable `parent_line_id` self-FK** on `working_order_lines` **and** `sale_lines`.
  - A **dish (parent) line**: `parent_line_id = null`, `product_id` set — unchanged from today.
  - An **option (child) line**: `parent_line_id → the dish line`, `product_id = null`.
- **New nullable `option_group_item_id`** on `working_order_lines` **only** (authoring traceability).
  It is **not** copied to `sale_lines`, which keeps its "snapshotted values, never catalogue
  references" rule (`sales.ts` doc). `sale_lines` has no product ref today and gains none.
- **Child line columns are the ones that already exist:** `descriptions` (the option's name,
  locale-keyed, re-keyed by `toInvoiceLineDescriptions` exactly as dishes are), `quantity` (inherits
  the parent's), `unit_price_gross` = the option's `price_delta` (€0.00 for free), `vat_rate` = the
  option's override or the parent dish's rate resolved at add time, `line_total`, `category`
  (snapshot the parent's).

**Pricing threads through the existing core untouched.** `priceRows` (`packages/catalogue/src/pricing.ts`)
works on amounts, not `product_id`, so a child line is just another priced row at both the add-time
lock (`priceOrderLines` → `working_order_lines.unit_price_gross`) and the file-from-lock path
(`priceLockedLines`). The only new work is **resolving a child line's gross/VAT at add time** from
the option (delta + inherited/overridden VAT) rather than from a product. Both paths see the
identical child rows, so **a parked order files exactly what it previewed** — the invariant the
current code depends on.

**Fiscal-safety points (unrepairable core):**

- **`parent_line_id` and `option_group_item_id` are our presentation/authoring metadata — they must
  never enter `computeHuella`** (CLAUDE.md §5: "never put our own metadata into a hash"). The huella
  hashes the desglose totals and amounts, which already include the child lines' real amounts and
  VAT; the *link* columns stay out. **Test:** two records differing only in `parent_line_id` hash
  identically (mirrors the existing `entorno` invariance test).
- **Child amounts genuinely belong in the desglose.** They are real supplies at a real rate, so the
  per-rate VAT breakdown and total include them — the point of choosing sub-lines. **Test:** desglose
  includes child amounts at their (possibly distinct) rate.
- Immutability guards apply unchanged: `sale_lines` keeps REVOKE ALL + append-only trigger; nullable
  columns are a pre-production schema change (drop & recreate, **no backfill** — CLAUDE.md §3/§5).

## 5. KDS tickets & receipt rendering

**A modifier never routes independently — it rides with its dish.**

- **`enqueueKitchenTickets` creates a `ticket_item` only for parent lines** (skip rows with a
  non-null `parent_line_id`). A child line gets **no** `ticket_item` and **no** independent station
  resolution — so "no onions" can never resolve to a different station than its burger, nor fail
  `station.no_default` for lacking a `station_id`.
- **The kitchen ticket renders children as indented sub-text under their parent.** `ticketName`
  (`apps/server/src/kitchen-print.ts`) grows to append a parent's child lines beneath its `qty × name`
  (`+ Oat milk`, `+ No onions`). Station is the parent's, snapshotted once.
- **Live KDS queues** (`listStationQueue` / `listExpoQueue`) already join `ticket_items →
  working_order_lines`; they additionally pull each parent's child lines for the sub-text. One extra
  grouped read, no new routing.
- **Receipt** (`formatReceipt`, `apps/server/src/receipt-ticket.ts`) and the **on-screen basket**
  (`apps/till/src/widgets/basket.ts`) group children under their parent: dish at its price, each
  option indented at its delta (€0.00 shown for free ones). Because children are real `sale_lines`,
  the receipt's line totals and VAT reconcile with the filed desglose with no special computation.
- **Debt note:** `formatReceipt` hand-ports its formatters from `apps/till` (existing copy-drift debt).
  Keep the parent→child grouping small and identical on both sides; hoisting to `packages/shared`
  stays the separately-tracked follow-up.

## 6. Till & handheld ordering UX

- **A product with no attached groups rings instantly, as today** — no regression for simple taps.
- **A product with groups opens a modifier picker modal** (`wt-` primitive dialog). It renders groups
  in order, enforces **min/max/required** client-side (required groups must be satisfied before
  "Add"; a `max_select`-reached group disables remaining options; single-select = radios, multi =
  checkboxes), shows a **running price** (dish + selected deltas), and on confirm emits one parent
  line + its chosen child lines.
- **The client line contract widens once, at the tap boundary:** `{ productId, quantity }` becomes
  `{ productId, quantity, options?: [{ optionGroupItemId }] }`. This flows through both entry points —
  `POST /api/sales` (counter) and `addTabRound` (table/handheld rounds).
- **Server-side authority:** the server resolves each option's delta/VAT/description **authoritatively**
  (never trusts a client-sent price) and **re-validates the selection** (rules satisfied; options
  belong to the product's attached groups; all active), failing loud on a bad basket. Client rules
  are UX, not the gate.
- **The picker lives in the shared flow** (`till-product-grid` + `till-table-order-screen`, shared by
  till and the #173 handheld phone shell), so the waiter's **handheld gets it for free** — the
  "burger, no onions, tableside" story. The handheld stays order-only; nothing here touches
  settlement.
- **Basket editing:** removing a parent line removes its children; children are not independently
  deletable. Re-opening the picker to edit a dish's options is a later nicety — first slice: change =
  remove and re-add.

## 7. Dashboard authoring & demo seed

- **Option-group manager** widget in the catalogue screen (`apps/dashboard`, sibling to
  `category-manager.ts`): CRUD groups and items — per-locale name, price delta, optional VAT-class
  override, min/max/required, sort/active.
- **Product form** (`product-form.ts`) gains an **attach-groups** section: pick and order which
  existing groups apply. New `management-api` routes for groups/items and the `product_option_groups`
  link; the product POST/PATCH bodies grow an optional groups field; read-back routes for both
  screens.
- **Demo seed** (`dev-setup.ts`): attach believable groups to the seeded menu — coffees get **Size**
  (S/L +€0.50) and **Milk** (whole/oat +€0.40); burgers get **Extras** (bacon +€1.50, extra cheese
  +€1.00) and **Cooking** (rare/medium/well-done, free). English by default, Spanish under
  `WAITRON_SEED_LOCALE=es-ES`. The ~28 days of back-dated sales get a sprinkle of modifier sub-lines
  so reports/receipt screens show them.

## 8. Testing & review scope

- **TDD throughout** (failing test first): pricing core over parent+child lines; the add-time lock ==
  file-from-lock invariant *with* modifiers (parked order files what it previewed); picker
  min/max/required enforcement; server-side selection re-validation and fail-loud on a bad basket.
- **Fiscal guards, run explicitly:**
  - `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after adding the FORCE-RLS catalogue
    tables and the `sale_lines` column.
  - **Huella-invariance** test: `parent_line_id` does not enter the hash.
  - **Desglose-includes-child-amounts** pinned, incl. a mixed-VAT case.
- **Dedicated fiscal review pass** before landing; **lands only supervised.**
- Migrations: custom SQL (`drizzle-kit generate --custom`) for FORCE RLS + policy + grants on the
  three new tables; nullable columns via generate.

## 9. Scope discipline (YAGNI — first slice)

Out of the first slice, each recorded deferred:

- **Per-option quantity** ("extra shot ×2") — backlog Tier B #7.
- **Re-open picker to edit** a placed dish's options.
- **Per-modifier station routing** / fan-out (a modifier rides its dish's station).
- **Nested option groups.**
- Hoisting the shared receipt/basket formatters to `packages/shared` (existing debt, unchanged here).

## 10. Files touched (map)

- **Schema:** `packages/db/src/schema/catalogue.ts` (3 new tables), `packages/db/src/schema/orders.ts`
  (`working_order_lines.parent_line_id`, `.option_group_item_id`), `packages/db/src/schema/sales.ts`
  (`sale_lines.parent_line_id`); custom migrations under `packages/db/drizzle`.
- **Catalogue:** `packages/catalogue/src/operations.ts` (option types + reads),
  `packages/catalogue/src/pricing.ts` (resolve child line price/VAT at add time — core arithmetic
  unchanged), `packages/catalogue/src/invoice-descriptions.ts` (child descriptions re-keyed as-is).
- **Order pipeline:** `apps/server/src/working-order.ts` (`priceOrderLines`/`readLockedLines`/
  `priceStoredOrder` carry parent+child), `packages/core/src/record-sale.ts` (child `sale_lines`).
- **KDS:** `apps/server/src/kitchen-print.ts` (parent-only ticket_items + child sub-text), live queue
  reads.
- **Receipt/basket:** `apps/server/src/receipt-ticket.ts`, `apps/till/src/widgets/basket.ts`,
  `apps/till/src/widgets/product-grid.ts` (open picker on tap), new picker widget,
  `apps/till/src/screens/till-table-order-screen.ts` / `till-counter-screen.ts`,
  `apps/till/src/state/working-order.ts` (basket holds options), `apps/till/src/api/client.ts`
  (`SaleLine` grows `options`).
- **APIs:** `apps/server/src/catalogue-api.ts` + `management-api.ts` (group/item CRUD, attach link,
  read-backs), `apps/server/src/*` sale/round handlers accept `options`.
- **Dashboard:** `apps/dashboard/src/screens/catalogue-screen.ts`, new option-group manager widget,
  `apps/dashboard/src/widgets/product-form.ts`.
- **Seed:** `dev-setup.ts` (+ the back-dated sales generator).

## 11. Open questions for the plan

- `min/max/required` invariants as DB CHECKs vs app-layer validation (lean app-layer + a couple of
  CHECKs).
- Whether `option_group_items.vat_class` reuses the `products.vat_class` enum/type or a plain text
  column with the same guard.
- Exact slicing for the implementation plan (schema+pricing first as the fiscal-review-gated core,
  then UI, then seed) — decided in writing-plans.
