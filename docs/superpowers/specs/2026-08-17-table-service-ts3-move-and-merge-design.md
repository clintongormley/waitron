# Table service — TS-3: move, join & merge

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan to follow. **Track:** the
third slice of the **table-service track** (sub-project 10). **Runs SUPERVISED**, not in the campaign.
**Builds on TS-1** ([tables + tabs](2026-08-17-table-service-ts1-tables-and-tabs-design.md), the
`dining_tables.tab_id` **back-pointer**) **and TS-2** — it reads/writes `dining_tables.status_id` (TS-2's
column) and its behaviour is entangled with TS-2's abandon/settle reset trigger, so it executes **after
TS-2 has landed** (build order TS-1 → TS-2 → TS-3).

The back-pointer — each table points at the open tab covering it, and several tables may point at the
same tab — makes re-seating and combining parties fall out with **no new schema**: these verbs only
re-point `tab_id`, move lines between `open` tabs, and abandon an emptied tab.

## 0. Owner decisions this slice is built on (2026-08-17)

- **Both merge outcomes are real:** consolidate two small parties onto one table (free the other), AND
  join two full tables onto one bill (neither frees). One `mergeTabs` verb with a source-table-fate flag.
- **Include `joinTable`** — a party that spreads onto the empty next table stays on one bill (extend a
  tab's coverage to a free table; no line-move).
- **Un-join / splitting a shared tab back apart is deferred to TS-5** (split-bill is the same need).

## 1. Scope

**In:** `moveTab` (relocate a tab to a free table), `joinTable` (extend a tab's coverage to a free
table), `mergeTabs` (combine two tabs onto one bill; source table freed or kept-joined), a shared
`moveTabLines` line-move primitive, their HTTP routes, and the TS-2 status interaction. **No new
schema / migration** (all on the TS-1 back-pointer + existing `working_order_lines`).

**Out:** **un-join** and per-line splitting → TS-5; **partial** item transfer between tabs → TS-4 (TS-3
builds the all-lines move primitive TS-4 generalises); any move/merge **audit trail** (these are
pre-fiscal operational actions; the `order_amendments` hash-chain is for placed/fiscal orders — noted,
not built).

## 2. Data model

**None new.** The link and the lines already exist:
- `dining_tables.tab_id` (TS-1 back-pointer) — re-pointed by all three verbs.
- `working_order_lines` — the merge/`moveTabLines` primitive appends rows onto the destination tab
  (preserving each line's locked `unit_price_gross`, `orders.ts:153`) and deletes them from the source,
  re-numbering `line_no` on the destination (its `(working_order_id, line_no)` unique, `orders.ts:186`).
- `working_orders.status` — `mergeTabs` moves the emptied source tab `open → abandoned` (the existing
  transition trigger permits it, `orders.ts:36-48`).

## 3. Behaviour (`apps/server/src/working-order.ts`, beside the TS-1 tab verbs)

All three take the involved `dining_tables` rows (and, for merge, both `working_orders` rows) **`FOR
UPDATE` in ascending id order** — a fixed lock order so two concurrent table-service ops can't deadlock
(the P3 lock-order discipline the backlog records for the integrated-card path).

- **`moveTab(tx, cfg, tabId, toTableId) → void`** — relocate a party. Validates `tabId` is an `open` tab
  (`tab.not_open`) and `toTableId` is `active` (`table.not_found` / `table.inactive`) and **free** — its
  `tab_id` is null or points at a settled/abandoned order (else `table.occupied`, "use merge"). Then:
  source table `tab_id → NULL`; target `tab_id → tabId`. The **source table's TS-2 `status_id` clears**
  (the tab left — a move is a turnover for the source). No line-move, no fiscal effect.
- **`joinTable(tx, cfg, tabId, tableId) → void`** — extend coverage. Validates `tabId` is an `open` tab
  and `tableId` is `active` and **free** (`table.occupied` otherwise). Sets `tableId.tab_id = tabId` — now
  both the tab's tables point at it (a join). **No line-move** (the free table had no tab). On pay, the
  one tab files one sale; on settle the TS-2 trigger clears status on **all** its tables (keyed on
  `tab_id`, §TS-2).
- **`mergeTabs(tx, cfg, intoTabId, fromTabId, { freeSourceTable }) → void`** — combine two tabs onto one
  bill. Validates both are distinct (`tab.merge_self` if equal) `open` tabs (`tab.not_open`). Then:
  1. `moveTabLines(tx, fromTabId, intoTabId)` — move **all** of `fromTab`'s lines onto `intoTab`.
  2. **Re-point the source table BEFORE abandoning `fromTab`** (this ordering is load-bearing — see
     below): `freeSourceTable = true` → source table `tab_id → NULL` **and** `status_id → NULL` (freed;
     the 2+2 *consolidate* case); `freeSourceTable = false` → source table `tab_id → intoTabId`, status
     **kept** (both tables now covered by one bill — the 4+4 *join* case).
  3. abandon `fromTab` (`open → abandoned`, now empty).

  **Why step 2 precedes step 3:** TS-2's `working_orders_clear_table_status` trigger fires on
  `open → abandoned` too (not only on pay), clearing `status_id` on every table where `tab_id = fromTab`.
  Re-pointing the source table first means that by step 3 **no** table points at `fromTab`, so the trigger
  is a no-op — abandon-then-repoint would instead wrongly clear the status of a **still-joined**
  (`freeSourceTable:false`) source table. TS-3's plan proves this ordering load-bearing by deletion.

  The merged `intoTab` (holding every line) files **one** sale on pay; `fromTab`, abandoned and empty,
  files nothing — no double-file (H2, §5).
- **`moveTabLines(tx, fromTabId, toTabId, lineNos?) → void`** (shared helper) — move the named lines
  (default **all**) from one open tab to another: read them (locked price kept), insert onto `toTab` at
  the next `line_no`s, delete from `fromTab`. TS-3 calls it with all lines; **TS-4 (transfer) calls it
  with a subset** — building it general now avoids a TS-4 refactor. Both tabs must be `open`
  (`tab.not_open`).

### 3a. HTTP (`apps/server/src/till-api.ts`)
Tab-centric, `:id` = the tab (working_order) id: `POST /api/tabs/:id/move` (`{ toTableId }`),
`POST /api/tabs/:id/join` (`{ tableId }`), `POST /api/tabs/:id/merge` (`{ fromTabId, freeSourceTable }`).
UUID params via `isUuid()` (→ 4xx); operator-session gated (`requireSession`), like the other tab
operations.

## 4. TS-2 status interaction

A freed table's manual status clears: `moveTab` and `mergeTabs{freeSourceTable:true}` null the source
table's `status_id` in the same statement that nulls its `tab_id` (the tab left → turnover). A table that
stays joined keeps its status. This is the same "clear on turnover" TS-2 established, applied explicitly
at the move/merge boundary. **Note** TS-2's reset trigger fires on `open → settled` **and**
`open → abandoned`, so `mergeTabs`'s own `abandon fromTab` would itself trip it — which is exactly why
step 2 (re-point) must precede step 3 (abandon), §3: by the time `fromTab` is abandoned no table points
at it, so the trigger is inert and the explicit clears above are the single source of the status change.

## 5. Fiscal safety (H2)

**All pre-fiscal — the immutable core is untouched.** `moveTab`/`joinTable` only re-point `tab_id` (a
non-fiscal column). `mergeTabs` moves lines between two `open` (mutable, unfiled) working orders and
abandons the emptied one; nothing is filed until the merged tab is paid, and it files **one** normal sale
via the unchanged `payWorkingOrder → recordSale` path. The abandoned `fromTab` files nothing — no
double-file (CLAUDE.md §5's unrepairable double-file cannot arise: `fromTab` never reaches `settled`).
The plan cites a grep proving no `record-sale.ts` / alta-builder / `registros` change, and pins that a
merged-then-paid tab produces exactly **one** `registros_facturacion` row.

## 6. Conventions

- **English identifiers**; no new schema tokens. **Domain-named error codes** (CLAUDE.md §3):
  `table.occupied` (a move/join target already has an open tab), `tab.merge_self` (merge a tab into
  itself); reuse `tab.not_open`, `table.not_found`, `table.inactive`. Declared in `apps/server/src/errors.ts`
  (`import "./errors.js"`); never renamed once shipped.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **PGlite (verb logic)** — `moveTab`: relocates to a free table, source freed + its status cleared,
  `table.occupied` on an occupied target. `joinTable`: both tables point at one tab; a subsequent pay
  files one sale covering both. `mergeTabs` **consolidate** (`freeSourceTable:true`): lines combined onto
  `intoTab` with **locked prices preserved** (open both tabs at different catalogue prices → after merge
  every line keeps its own locked `unit_price_gross`), `fromTab` abandoned + empty, source freed.
  `mergeTabs` **join** (`false`): both tables point at `intoTab`, one sale on pay. `tab.merge_self`,
  `tab.not_open` guards. `moveTabLines` subset-vs-all.
- **Real Postgres** — a **concurrent merge/move** race proving the ascending-id `FOR UPDATE` lock order
  prevents a deadlock and serialises (two ops touching the same two tables → no `40P01`, one waits);
  the operations run under the non-superuser `app_user` + RLS (a cross-tenant merge is impossible — the
  other tenant's tab is RLS-hidden, proven by deletion of the tenant predicate).
- **Fiscal** — a merged-then-paid tab yields exactly one `registros_facturacion` row (real-PG), and the
  H2 grep receipt.
- Coverage 98/98/98/95 (`apps/server`).

## 8. Deferred (named, not built)

- **Un-join** a table from a shared tab, and per-line **split-bill** → TS-5.
- **Partial** item transfer between tabs → TS-4 (reuses `moveTabLines` with a subset).
- A **move/merge audit trail** (pre-fiscal; the `order_amendments` chain is for placed/fiscal orders).
- The **floor-plan gestures** for move/join/merge (drag a table onto another) — the floor-plan slice
  wires these verbs to touch/drag; TS-3 ships the verbs + routes.

## 9. Provenance

Designed against the live tree + the TS-1 back-pointer model on 2026-08-17. The line-locked price
(`orders.ts:153`), the `(working_order_id, line_no)` unique (`orders.ts:186`), the transition trigger
permitting `open → abandoned` (`orders.ts:36-48`) and the ascending-id lock-order discipline (the
integrated-card P3 deadlock note in `docs/backlog.md`) are the cited receipts. The "one sale, no
double-file" claim is to be proven in the plan by a real-PG merged-then-paid test (CLAUDE.md §1), not
reasoned from.
