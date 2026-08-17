# Table service — TS-4: transfer items

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan to follow. **Track:** the
fourth slice of the **table-service track** (sub-project 10). **Runs SUPERVISED**, not in the campaign.
**Builds on TS-3** ([move/join/merge](2026-08-17-table-service-ts3-move-and-merge-design.md), the
`moveTabLines` primitive) and TS-1 (the `dining_tables.tab_id` back-pointer + the locked-price lines).

Move **selected** items from one open tab to another — the mis-rung drink, or one person's share of a
shared table. TS-3 built the *all-lines* move (`moveTabLines`); this generalises it to a **subset**, with
**partial-quantity** splitting.

## 0. Owner decisions this slice is built on (2026-08-17)

- **Partial quantity is in** — you can move part of a line (1 of 3 coffees), not just whole lines. The
  split conserves quantity and **never re-prices**.
- **Between two EXISTING tabs.** Spinning items off into a **new separate check** is split-bill (**TS-5**),
  not transfer.

## 1. Scope

**In:** `transferLines(fromTabId, toTabId, transfers)` — whole-line and partial-quantity transfer between
two open tabs, reusing/extending TS-3's `moveTabLines`; its HTTP route. **No new schema / migration.**

**Out:** spinning items into a **new** tab, and per-check bill separation → **TS-5**; **un-join** → TS-5.

## 2. Data model

**None new.** Transfer works on `working_order_lines` (the locked-price lines, `orders.ts:153`) across two
`working_orders` in `open` state. The partial path **splits** a line: it reduces the source line's
`quantity` (and recomputes its `line_total`) and inserts a new line on the destination.

## 3. Behaviour (`apps/server/src/working-order.ts`)

`transferLines(tx, cfg, fromTabId, toTabId, transfers) → void`, where
`transfers: { lineNo: number; quantity?: string }[]` (omit `quantity` ⇒ the whole line). Both tabs are
locked **`FOR UPDATE` in ascending id order** (the TS-3 deadlock-safe discipline).

- **Whole line** (`quantity` omitted, or equal to the line's full quantity) → delegate to
  `moveTabLines(tx, fromTabId, toTabId, [lineNo])` (move the row, keep its locked `unit_price_gross`,
  append at the destination's next `line_no`).
- **Partial** (`0 < quantity < line.quantity`) → **split**:
  1. source line: `quantity := quantity − transferred`, `line_total := round(quantity × unit_price_gross)`
     (the shared money-scaled multiply — `@waitron/shared`'s `percentOf`/`multiplyDecimal` family, the
     same half-away-from-zero used everywhere; **no catalogue re-look-up**).
  2. destination: a new line at the next `line_no` with the **same** `product_id`, `descriptions`,
     `vat_rate`, `category`, `unit_price` (net) and **`unit_price_gross`** — every per-unit value is the
     source line's locked value, inherited, **never re-fetched from the catalogue** —
     `quantity := transferred`, `line_total := round(quantity × unit_price_gross)`.
- **Invariants (the load-bearing ones):**
  - **Quantity conserved** — `remaining + transferred = original` for every split line; nothing is
    created or destroyed.
  - **Never re-priced** — the destination inherits the source line's locked `unit_price_gross`; a
    catalogue price change between the original ring and the transfer must not affect either line.
  - `line_total` is a **derived** re-computation per line, not a re-price. The two tabs each stay
    internally consistent (`Σ line_total = tab total`); because both are **pre-fiscal**, the sub-cent
    rounding difference between the split totals and the pre-split total is harmless — neither tab was
    filed pre-split, and each files its own correct desglose on its own pay (§4).
  - **Weighed lines** (decimal `quantity`, e.g. `0.320` kg) split identically — `transferred` is a
    decimal ≤ the line quantity. Unusual but the decimal model handles it; no special case.
- **Guards** — both tabs `open` (`tab.not_open`); `fromTabId ≠ toTabId` (`tab.transfer_self`); each
  `lineNo` present on `fromTab` (`tab.line_not_found`); each `quantity` (when given)
  `0 < quantity ≤ line.quantity` (`tab.transfer_quantity_invalid`). Transferring a line's **full**
  quantity is treated as a whole-line move (no zero-quantity remnant left behind). **Emptying a tab**
  (transferring all its lines) leaves it `open` — the party is still seated; closing is a separate pay/
  abandon, not a transfer side effect.

### 3a. HTTP (`apps/server/src/till-api.ts`)
`POST /api/tabs/:id/transfer` (`:id` = `fromTabId`), body `{ toTabId, transfers }`. UUID params via
`isUuid()` (→ 4xx); operator-session gated (`requireSession`).

## 4. Fiscal safety (H2)

**All pre-fiscal — the immutable core is untouched.** Transfer moves/splits `working_order_lines` between
two `open` (mutable, unfiled) tabs; nothing is filed until each tab is paid, and each then files **one**
normal sale via the unchanged `payWorkingOrder → recordSale` path, with its desglose computed from its
own lines *at pay time*. There is no re-pricing (the locked gross is inherited) and no double-file (each
line lives on exactly one tab after the transfer). The plan cites a grep proving no `record-sale.ts` /
alta-builder / `registros` change, and pins a **quantity-conservation** test and a **price-lock** test
(a catalogue price change between ring and transfer leaves both lines' `unit_price_gross` untouched).

## 5. Conventions

- **English identifiers**; no new schema tokens. **Domain-named error codes** (CLAUDE.md §3):
  `tab.transfer_self`, `tab.transfer_quantity_invalid`; reuse `tab.not_open`, `tab.line_not_found`.
  Declared in `apps/server/src/errors.ts` (`import "./errors.js"`); never renamed once shipped.
- No backwards-compat / data-migration code (pre-production).

## 6. Testing

- **PGlite (verb logic)** — whole-line transfer (row moves, locked price kept, source line gone);
  **partial split** (source `quantity` drops, a destination line appears at the **same**
  `unit_price_gross`, **quantity conserved**, both `line_total`s = `round(qty × gross)`); the
  **price-lock** proof (change the catalogue `unit_price` between the ring and the transfer → neither the
  kept nor the moved line re-prices); a **weighed** line partial (decimal quantity); full-quantity partial
  == whole-line move (no zero remnant); emptying a tab leaves it `open`; the guards (`tab.transfer_self`,
  `tab.transfer_quantity_invalid` on `0` / `> line qty`, `tab.line_not_found`, `tab.not_open`).
- **Real Postgres** — a **concurrent transfer** race proving the ascending-id `FOR UPDATE` lock order is
  deadlock-safe and serialises; the operation under the non-superuser `app_user` + RLS (a cross-tenant
  transfer is impossible — the other tenant's tab is RLS-hidden, proven by deletion of the tenant
  predicate).
- Coverage 98/98/98/95 (`apps/server`).

## 7. Deferred (named, not built)

- **Split-bill** (spin lines/quantities into a *new* check that files its own sale), and **un-join** →
  TS-5.
- The **floor-plan gesture** for transfer (drag an item from one table to another) — the floor-plan slice
  wires this verb; TS-4 ships the verb + route.

## 8. Provenance

Designed against the live tree + the TS-3 `moveTabLines` primitive on 2026-08-17. The locked-price line
(`orders.ts:153`), the `(working_order_id, line_no)` unique (`orders.ts:186`), and the shared
money-scaled multiply (`@waitron/shared`'s `percentOf`/`multiplyDecimal`, #77) are the cited receipts.
The "quantity conserved + never re-priced + no double-file" claims are to be proven in the plan by
PGlite conservation/price-lock tests and a real-PG per-tab single-`registros` test (CLAUDE.md §1), not
reasoned from.
