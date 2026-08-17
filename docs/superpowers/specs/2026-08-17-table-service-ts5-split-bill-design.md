# Table service — TS-5: split-bill (item-split)

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan to follow. **Track:** the fifth
and final table-service *core* slice (sub-project 10). **Runs SUPERVISED**, not in the campaign.
**Builds on TS-4** ([transfer items](2026-08-17-table-service-ts4-transfer-items-design.md), the
whole/partial line-move) and TS-1/TS-3 (the `dining_tables.tab_id` back-pointer, locked-price lines).

**This is the one table-service slice that CREATES fiscal records.** It does so only through the normal,
unchanged `recordSale` on each check's pay — it never edits the immutable core — but because it
*multiplies* filings (one tab → N sales), it carries the strongest test bar and a dedicated
fiscal-correctness review in its plan (the discipline #91 used).

## 0. Owner decisions this slice is built on (2026-08-17)

- **Item-split into separate sales.** Allocate specific items/quantities to N checks; **each check files
  its OWN sale + `registro` + desglose.** Not a money-split.
- **Even-money "split N ways" is NOT this slice** — that is paying one bill with several tenders, which
  the multi-tender settlement (#39) already does (one sale, no new fiscal records).
- **Un-join lives here** (deferred from TS-3): detaching a table from a joined tab is `splitOffCheck` +
  a repoint.

## 1. Scope

**In:** `splitOffCheck` (spin selected items into a new, separately-filing check), `unjoinTable` (detach
a joined table, optionally with its items, into its own bill), and their HTTP routes — reusing TS-4's
whole/partial line-move. **No new schema / migration.**

**Out:** even-money / by-cover splitting → #39's multi-tender (one sale); any **split-view UX** (allocate
across checks by drag, pay each) → the till/floor-plan slice; a persisted **check↔origin link** → §3's
"optional refinement" (not built).

## 2. Data model

**None new.** A "check" is an ordinary `working_orders` row (open, then settled on pay) carrying the
allocated `working_order_lines`; it inherits the origin tab's `node_id` / `till_id` / series for filing
(via `createOpenOrder`, `working-order.ts:252`). A spun-off **check is NOT table-anchored** — no
`dining_tables.tab_id` points at it (it is a payment unit, not a seat). An **un-joined table's** new tab
IS table-anchored (that table's `tab_id` points at it — it keeps running a bill).

## 3. Behaviour (`apps/server/src/working-order.ts`)

The origin tab is locked `FOR UPDATE` while items are carved off (TS-3/TS-4 lock discipline).

- **`splitOffCheck(tx, cfg, fromTabId, transfers) → { checkId }`** — validate `fromTabId` is an `open`
  tab (`tab.not_open`); create a new `open` working_order (a *check*, **no** table back-pointer) via
  `createOpenOrder`; move the `transfers` (whole lines or partial quantities — TS-4's `moveTabLines` /
  split, locked prices inherited, quantity conserved) from the origin onto the check. Returns `checkId`.
  Called once per check; the origin tab holds the remainder. Errors inherited from TS-4
  (`tab.transfer_quantity_invalid`, `tab.line_not_found`).
- **Pay each check independently** — **no new pay verb**: `payWorkingOrder(checkId)` (`till-sale.ts:253`)
  settles it and files its own sale + `registro`. When the origin tab is emptied (all items carved off),
  it is abandoned and its table freed (its TS-2 status clears via the abandon trigger); or the operator
  pays the remaining origin tab as the last check.
- **`unjoinTable(tx, cfg, tabId, tableId, transfers?) → { tabId? }`** — detach `tableId` from the joined
  `tabId` (validate `tableId.tab_id = tabId`, else `table.not_joined`). With `transfers`: create a new
  `open` tab **anchored to `tableId`** (set `tableId.tab_id →` the new tab) and move those items onto it —
  the table keeps its own running bill. Without `transfers`: just detach (`tableId.tab_id → NULL`, freed;
  its TS-2 status clears). `tab.not_open` if the shared tab isn't open.

**Finding the checks (UX, deferred).** A spun-off check is an `open` working_order with no table, so it
is reachable via the existing held-orders list (`listHeldOrders`) until paid; the coherent "this tab's
checks, pay each" split-view is a till/floor-plan concern. **Optional future refinement** (NOT built
here, keeps "no new schema"): a `working_orders.split_from_tab_id` self-link for a clean per-tab check
read — recorded so the till slice can add it if the held-list route proves clumsy.

## 4. Fiscal safety (H2) — the load-bearing section

**The immutable core is never edited; TS-5 only causes MORE of the normal filings.** Each check/tab is a
working_order that files via the **unchanged** `payWorkingOrder → recordSale` (`packages/core/src/record-sale.ts`)
path. The guarantees, each proven in the plan (real Postgres) and re-checked by a dedicated
fiscal-correctness review:

- **Exactly one `registro` per check.** The `UNIQUE (tenant_id, working_order_id)` sale-idempotency key
  (#61, `sales.ts:159/202`) means a check working_order files **at most one** sale; a retry replays, it
  does not double-file. A three-way split ⇒ **exactly three** `registros_facturacion` rows.
- **Coherent per-check desglose.** `recordSale` computes each check's VAT breakdown from **its own**
  lines, so every issued invoice's desglose corresponds to real items (the reason a *money*-split cannot
  be separate sales — §0).
- **Items partitioned, never duplicated.** The move/split (TS-4) **deletes** each unit from the origin as
  it lands on a check, so every unit lives on exactly one working_order — **no double-file**, and the
  origin's own eventual sale (the remainder) shares no item with any check. Quantity is conserved
  (TS-4's invariant).
- **The pieces are independent legal invoices.** Each check rounds its own desglose; there is **no**
  single combined bill issued, so there is nothing to reconcile the N totals against beyond "each stands
  alone and correct" (a per-check cent of difference-method rounding is not an error — no aggregate
  invoice exists). The plan states this explicitly and the fiscal review confirms it.
- **No change to `computeHuella` / the hash chain / invoice numbering / the alta builders** — grep receipt
  in the plan. Invoice numbers advance normally, one per filed check, from the tab's series.

**The plan's test bar:** a real-PG "split a mixed-VAT tab into 3 checks, pay all → exactly 3
`registros`, each desglose correct for its items, quantities conserved across the 4 working orders
(3 checks + emptied origin), no item filed twice, invoice numbers contiguous" proof, plus a **dedicated
fiscal-correctness review** (re-derive the per-check desgloses, confirm single-file, confirm the
partition) before merge — the unrepairable-record discipline (CLAUDE.md §5).

## 5. Conventions

- **English identifiers**; no new schema tokens. **Domain-named error codes** (CLAUDE.md §3):
  `table.not_joined` (un-join a table that isn't part of the tab); reuse `tab.not_open`,
  `tab.transfer_quantity_invalid`, `tab.line_not_found`. Declared in `apps/server/src/errors.ts`
  (`import "./errors.js"`); never renamed once shipped.
- No backwards-compat / data-migration code (pre-production).

## 6. Testing

- **Real Postgres (the fiscal proofs)** — split a mixed-VAT tab into 3 checks + pay all ⇒ **exactly 3**
  `registros_facturacion`, each desglose = its items, invoice numbers contiguous from the series;
  **quantity conserved** across origin + checks; **no item double-filed** (each unit on one working
  order); a partial-quantity split of a shared line files a coherent fraction on each check; the
  sale-idempotency replay (pay a check twice ⇒ still one `registro`). All under the non-superuser
  `app_user` + RLS (a cross-tenant split is impossible — proven by deletion of the tenant predicate).
- **PGlite (verb logic)** — `splitOffCheck` creates a detached (table-less) check with the moved items;
  `unjoinTable` with items anchors a new tab to the table (its `tab_id` repointed) and without items
  frees it (status cleared); `table.not_joined`, `tab.not_open` guards.
- **Dedicated fiscal-correctness review** in the plan (a fresh-context pass re-deriving the per-check
  desgloses + confirming single-file/partition), per §4.
- Coverage 98/98/98/95 (`apps/server`).

## 7. Deferred (named, not built)

- The **split-view UX** (allocate items across checks, pay each) and the **check-finding** read → the
  till/floor-plan slice (+ the optional `split_from_tab_id` link, §3).
- **Even-money / by-cover** splitting → #39's multi-tender (out of scope by decision).
- **Merging checks back** before payment (undo a split) — a possible follow-up; today an over-split is
  fixed by transferring items back (TS-4) between the still-`open` checks.

## 8. Provenance

Designed against the live tree + TS-4's line-move on 2026-08-17. The sale-idempotency `UNIQUE (tenant_id,
working_order_id)` (#61, `packages/db/src/schema/sales.ts:159/202`), `createOpenOrder`
(`working-order.ts:252`), `payWorkingOrder → recordSale` (`till-sale.ts:253`, `packages/core/src/record-sale.ts`)
and TS-4's conservation invariant are the cited receipts. Every fiscal claim in §4 is to be **proven in
the plan on real Postgres** and re-checked by a dedicated review — not reasoned from (CLAUDE.md §1/§5).
