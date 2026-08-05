# Counter POS — park & retrieve + manual card tender (sub-project 7, slice 2) — design

**Date:** 2026-08-05. **Sub-project:** 7 (Counter POS UI), second slice — two parallel pieces:
**7b (park & retrieve)** and a **manual card tender**. **Status:** designed, awaiting plans.

Slice 1 (7a, `2026-08-05-counter-pos-walkup-sale-design.md`, merged #60) built the first operable till:
a logged-in operator rings a cash sale and gets a legal Veri\*Factu ticket. It kept the working order as
**in-browser state on one till** and took **cash only**. This slice does two independent things on that
foundation, developed on **two branches in parallel** (§7):

- **7b** — persist the working order and share it **across tills**: park an order, retrieve it from any
  register on the same server, pay it (or discard it). This also lands the **sale-idempotency** guard
  the 7a review deferred (§3), because a persisted working order finally has a stable id to key on.
- **Manual card tender** — a second tender method beside cash, for the *datáfono* case (a card run on a
  **separate, unintegrated** bank terminal, then recorded on the till). An **integrated** card reader is
  a **separate later slice** (§7), deliberately not this one.

**No fiscal machinery is reimplemented.** As in 7a, the till is a face on proven code; the fiscal chain,
the immutable `sales`/`registros_facturacion`, and the payment ledger are untouched except for one
additive migration (§2).

---

## 1. Scope

### The #7 roadmap this sits in

| Slice | What | State |
| --- | --- | --- |
| **7a** | Walk-up cash sale | merged (#60) |
| **7b** | **Park & retrieve** open orders — persist working orders, cross-till held list (this spec) | designed |
| **card** | **Manual card tender** (datáfono) — this spec, parallel branch | designed |
| 7c | **Prepare & collect** — send-to-kitchen states, KDS, pay-on-order vs pay-on-collect, + the **working-order amendment log** | future |
| — | Integrated card terminal · offline store-and-forward · scale + printer hardware · refunds/voids/corrections UI · layout & receipt **editors** | future |

### In scope

- **Persist the working order** (`working_orders` + `working_order_lines`), the concept 7a kept
  in-browser. Every till sale — walk-up or parked — ends up referencing a working-order row (§2, §5).
- **Park & retrieve** across tills served by one server/node, with an **auto order number + optional
  label** (chosen UX). This **lifts the "one till per server" limit** 7a deferred (§4).
- **Draft editing** of a parked, still-`open` order (add / remove / change lines) — **no amendment log**
  (§6).
- **Sale idempotency** for the lost-response retry, protecting both walk-up and parked sales (§3).
- **Manual card tender** beside cash, atomic inside the sale transaction (§5).

### Out of scope (each has a named home)

- **Send-to-kitchen** action, prep states (prepare→ready→collect), the KDS surface, and the
  **art. 29.2.j amendment log** → **7c**. The persistence mechanism is *designed to accept*
  send-to-kitchen as a third save trigger (§6), but 7c builds it.
- **Integrated card terminal** (Stripe Terminal / SumUp) and the **timed-out-card UX**
  (retry / alternative tender / wait) → its own later slice. The hardware choice (SumUp Solo vs Stripe
  Terminal) is itself open; the idempotency *coupling* that path carries is discussed in §3.
- **Split tender** (part cash, part card in one sale) → deferred. One tender method per sale here. The
  `tenders` table already supports several rows per sale (`sales.ts:233`), so this is a UX/flow
  deferral, not a schema one.
- **Cross-server** shared held list (a register on server A seeing server B's parked orders) → the
  app-level **sync subsystem** (`2026-08-02-app-level-sync-design.md`), not the till.
- **Auto-expiry** of stale parked orders, **offline** store-and-forward, **hardware** → later slices.

---

## 2. The one migration

`packages/db` gains a single additive migration (a `drizzle-kit generate --custom` file, hand-written
for the FORCE RLS / policy / grant / composite-FK idiom — the exact shape
`0027_light_smiling_tiger.sql` uses). It touches four existing tables and adds one small table.

**Re-pricing decision (owner, this session): a parked order re-prices at PAY, at current catalogue
prices** — the same authoritative path a walk-up takes. So the draft working order stores the **basket**
(`product_id` + `quantity`), retrieve loads it back into the in-browser basket, and pay re-prices the
sent `{ productId, quantity }` exactly as 7a does. The **filed** `sale_lines` stay snapshot-based, so
the immutability rationale is intact — the change is only that a **mutable draft line** now references
the catalogue (§6 revises `orders.ts:87`'s note accordingly).

**On `sales`** (immutable, append-only — the app role has no `UPDATE`; a new column is written once at
insert and never edited, which the immutability regime already permits):

- `working_order_id uuid` — **nullable**. Set by the till path; **NULL** for every non-till fiscal path
  (rectificativas via `recordCorrection`, F3 canje via `recordSubstitution`, invoice-first settlement),
  so those callers are unaffected. This mirrors the table's existing nullable-with-composite-FK columns
  `corrects_sale_id` and `node_id` (`sales.ts:120`, `:99`).
- Composite FK `(tenant_id, working_order_id) → working_orders(tenant_id, id)`, **MATCH SIMPLE** so a
  NULL skips the check — the exact `sales_corrects_fk` / `sales_node_fk` pattern
  (`sales.ts:158-173`). `working_orders` already exposes the composite target
  `unique(tenant_id, id)` (`orders.ts:65`).
- `UNIQUE(tenant_id, working_order_id)` — **the idempotency guard: at most one sale per working order**
  (§3). Postgres treats NULLs as distinct, so the many NULL rows from non-till paths never collide.

**On `working_orders`** — start **writing** `node_id` (nullable today, "no writer yet",
`orders.ts:53-59`; this slice is the first writer, and the held list is scoped by it), plus two new
columns:

- `order_number integer NOT NULL` — the held-list display number, per `(tenant_id, node_id)`, allocated
  race-free from the counter table below (never `max()+1`, which races and reuses numbers after an
  abandon). Display-only, **no fiscal meaning**.
- `label text` — the optional customer label (nullable).

**On `working_order_lines`** — `product_id uuid NOT NULL` + composite FK
`(tenant_id, product_id) → products(tenant_id, id)` `ON DELETE RESTRICT` (products are deactivated via
`active`, never deleted — `0027`'s own note — so it never dangles). This is what retrieve returns so the
browser can rebuild the basket and pay re-prices it. The existing snapshot columns (`descriptions`,
`unit_price`, `vat_rate`, `line_total`, `category`) stay, filled at park/update time as a **display
cache** (the held-list total is `sum(line_total)` per order); they are NOT the filed price — pay
re-prices from `(product_id, quantity)`.

**On `products`** — add `UNIQUE(tenant_id, id)`, the composite target the new
`working_order_lines` FK needs (products has only a single-column PK today, `catalogue.ts:52-79`). This
also closes, for products, the single-column-FK deviation the catalogue follow-up flagged.

**New table `working_order_counters`** — `(tenant_id uuid, node_id uuid, next_number integer)`, PK
`(tenant_id, node_id)`. Allocated with `UPDATE … SET next_number = next_number + 1 … RETURNING`
(the `allocateInvoiceNumber` idiom, `allocate-number.ts:51-62`) so two concurrent parks on one node
serialize on the row and never collide. **It is a new `tenant_id`-bearing table, so it needs the full
treatment** (`CLAUDE.md` §3, enforced by the `inmutabilidad` guard): FORCE ROW LEVEL SECURITY, a
`tenant_isolation` FOR ALL policy (`USING`/`WITH CHECK` on `current_tenant_id()`), and a
`GRANT SELECT, INSERT, UPDATE` to `app_user` — exactly the `0027` idiom (no DELETE; a counter is never
removed).

**No RLS work on the working-order tables themselves.** `working_orders` / `working_order_lines`
already carry FORCE RLS, tenant-isolation policies, `app_user` grants (SELECT/INSERT/UPDATE/DELETE), and
the DB-enforced `open → settled|abandoned` state trigger — all in
`packages/db/drizzle/0004_working_orders.sql:44-98`; the `settled_at` biconditional check
(`orders.ts:76-81`) already ties `settled` to a timestamp. **Run
`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after the migration** — the new
`working_order_counters` table is exactly what that guard exists to catch a missing FORCE on
(`CLAUDE.md` §3).

---

## 3. Idempotency — the unrepairable-double-file fix

**The risk.** A filed sale writes a chained `registros_facturacion` record and consumes an invoice
number that is **never reused** (`CLAUDE.md` §5). If the operator taps Pay, the sale files and commits,
but the **response is lost** (dropped link, tab reload), a re-ring is a *fresh* request the 7a
client-side single-flight guard cannot dedupe — it files a **second** chained record. That is
unrepairable. The 7a whole-branch review deferred the server-side fix to "the park/retrieve slice (7b),
which is where working orders first get a persisted id" — this is that slice.

**The mechanism, now buildable.** The client mints the working-order id when a basket starts and holds
it stable across retries. `POST /api/sales` carries that `workingOrderId`. The pay flow, in one
transaction:

1. Lock/resolve the working order by `(tenant_id, id)` (`SELECT … FOR UPDATE`).
2. If it is already `settled`, **return its existing sale** — an idempotent replay; the operator sees
   the same ticket, and nothing is filed. (The sale is found by its `working_order_id` back-reference.)
3. If it is `open`, settle it (`open → settled`) and file the sale with `working_order_id` set.
4. The `UNIQUE(tenant_id, working_order_id)` on `sales` is the **concurrent** backstop: if two pays for
   one order race past the lock in separate connections, one files and the other hits the unique
   violation, which the handler turns into the same idempotent replay rather than an error.

This protects **both** shapes: a **walk-up** sale (never parked) creates the `working_orders` row `open`
and settles it in the same transaction, so its client-supplied id keys the same guard; a **parked** sale
settles a row that already exists.

**Manual card carries no *additional* idempotency coupling.** It makes no network call and commits
inside the sale transaction (§5, `manual.ts:36-42`), so "did the tender go through?" is answered by the
same transaction that files the sale — there is no external capture to reconcile. The lost-response
retry is the *sale's* problem, solved above, identically for cash and manual card. The extra coupling —
a capture that succeeded on the reader while the POS timed out — belongs only to the **integrated
terminal** slice, and is called out there so it builds on this guard rather than reinventing a weaker
one.

---

## 4. Slice A — 7b: park, retrieve, the cross-till held list

**The working order's lifecycle** (what later slices extend): `build → (park) → pay → filed`, or
`build → (park) → discard`. Send-to-kitchen slots between park and pay in 7c (§6).

- **In-browser until saved.** An unparked basket stays local to the one till, exactly as 7a — it is
  cleared by "New sale" or the next operator. It becomes a DB row at the first **park** or **pay**.
- **Saved = `open` and shared.** A parked order is `open`, carries its order number + optional label,
  its `till_id` (the register that created it — `orders.ts:49`, an origin snapshot, not a visibility
  scope) and its `node_id` (the server). The **held list** is `where tenant_id = $1 and node_id = $2
  and status = 'open'`, so **any register on that server** sees it. Retrieving repopulates the basket.
- **Draft editing** while `open`: add / remove / change lines (§6 — no amendment log).
- **Pay** settles it (§3). **Discard** abandons it (`open → abandoned`), a terminal state the DB trigger
  enforces (`0004_working_orders.sql`).

**Cross-till = multi-register on one server.** This **lifts the "one till per server" limit** 7a
deferred. Concretely: several `apps/till` clients connect to one `@waitron/server`, and they share the
held list because it is queried from the server by node, not held in any one browser. **Cross-*server***
sharing (two local servers, or the cloud mirror) is **not** here — that needs the sync subsystem.

**Server** — a working-order module + routes on `till-api.ts`:

| Route | Does |
| --- | --- |
| `POST /api/working-orders` | Park: allocate the order number, price the `{ productId, quantity }` basket, insert the `open` order + lines (client-supplied id, resolved `node_id`, the logged-in operator's `till_id`, optional label). |
| `GET /api/working-orders` | The held list for this server's node: number, optional label, item count, `sum(line_total)`, opened-at. |
| `GET /api/working-orders/:id` | Retrieve one order — returns `{ productId, quantity }` per line so the browser rebuilds the basket, plus the label. |
| `PUT /api/working-orders/:id` | Save draft edits while `open` (re-price + replace lines, update label). Rejected once terminal. |
| `DELETE /api/working-orders/:id` | Abandon (`open → abandoned`). |
| `POST /api/sales` | Now takes `workingOrderId`; re-prices the sent basket, files, and settles the parked-or-just-created order (§3). |

As in 7a, the server re-prices authoritatively from the catalogue — the browser sends
`{ productId, quantity }` lines and **no price** at every step (park, update, pay) — and attributes to
the **logged-in operator**, never a browser-sent id. **Re-price at pay** (owner decision, §2): a parked
order is paid at *current* catalogue prices, the same path a walk-up takes, so park/update/pay share one
pricing route.

**Retrieve of a since-deactivated product.** Because retrieve returns `productId`s the browser resolves
against its loaded catalogue, a line whose product was deactivated (`active = false`) between park and
retrieve no longer resolves. The browser flags and drops such a line with a non-fatal notice rather than
failing the retrieve; the operator re-adds an equivalent current product. (A rare edge at a counter;
noted so the plan handles it rather than throwing.)

**Till UI** (`apps/till`):

- A **Hold / Park** control on the counter screen (near Pay); parking prompts for the optional label.
- A **held-orders list** (a panel or screen) showing the server's parked orders; tap to retrieve →
  basket repopulates → continue editing or pay.
- **Discard** on a held or current order.
- The store keeps the client-minted working-order id stable so a retry re-sends the same one (§3).

---

## 5. Slice B — manual card tender

`tender_method` already includes `"card"` (`sales.ts:39-45`), and `recordManualCardPayment` already
exists, already takes a `workingOrderId`, makes **no network call**, and is documented to run **inside**
the sale transaction alongside `recordSale` + `associatePaymentWithSale` "giving manual mode an atomic
capture with no orphan window" (`packages/payments/src/manual.ts:36-58`). So this slice is wiring, not
new payment machinery.

**Server** — generalise `recordTillSale`'s tender. Today it is cash-only and refuses everything else
with `sale.unsupported_tender` (`apps/server/src/till-sale.ts:73-74`). Widen the input to
`{ method: "cash" | "card"; amount; externalRef? }`:

- **cash** — unchanged: amount may exceed the total, change is handed back, the tender settles at the
  total (`till-sale.ts:92-100`).
- **card** — amount **equals** the total (no change on a card). Inside the same transaction:
  `recordManualCardPayment` (a `captured` `payments` row under the sentinel `manual` provider) +
  `associatePaymentWithSale` (`store.ts:254`), and the `tenders` row is `method: "card"`. An **optional
  hand-keyed `externalRef`** (the acquirer/bank-terminal operation number, `manual.ts:26`) rides along
  as a reconciliation hook.
- **voucher / transfer / other** — still refused with `sale.unsupported_tender` (an existing code —
  never renamed, `CLAUDE.md` §3).

**Till UI** (`tender-pay.ts`): a **Card** button beside Cash. The card path confirms the total on card
and **skips** the cash-tendered / change numeric pad; an optional `externalRef` field. No new fiscal or
receipt behaviour — the ticket is the same legal ticket, tendered by card.

---

## 6. The amendment-log boundary (fiscal)

The **working-order amendment log** (art. 29.2.j LGT) is flagged **"probable but unconfirmed"** by the
architecture design and by open advisor question **Q14** (no asesor engaged; no primary text names the
restaurant *precuenta* — backlog "advisor gap"). The 7a design fixed its trigger: it bites "**only when
an order is amended *after* it is placed**" (7a design §4, lines 139-143).

**Decision (owner, this session): parking is *not* placing.** A parked order is a persisted **draft** —
nothing is issued, nothing is sent to a kitchen, no customer-facing document exists. Editing a still-
`open` parked order is draft editing, indistinguishable in kind from editing an in-browser basket, and
writes **no** amendment-log entry. The log stays in **7c**, where **send-to-kitchen** is the act that
*places* the order.

**Designed-for, not built.** The owner also asked that **send-to-kitchen** become a save trigger and
that a sent order be reachable from any till. This slice makes that cheap for 7c without building it: the
save path (park / pay) and the cross-till held list are the same mechanism send-to-kitchen will reuse as
a third trigger. Because a sent order *is* "placed", 7c is where the amendment log attaches — so nothing
in this slice lets an order be amended after placing.

This is the conservative reading (a draft is not an order of record), and it avoids building an
append-only log for an **unconfirmed** legal trigger. If an advisor later rules that parking *is*
placing, the log attaches at park — an additive change, since the working order's shape is kept clean
here for exactly that reason.

**Design-decision revision — `orders.ts:87`.** That comment says the working order has "deliberately no
product or menu-item column: a stale catalogue is then not a correctness problem, only a freshness one."
The re-price-at-pay decision (§2) adds `product_id` to `working_order_lines`. This does **not** weaken
the rationale, and the plan must update the comment to say so rather than delete it: the rationale
protects the **filed** record from catalogue drift, and the filed `sale_lines` remain **snapshotted at
pay** (built fresh by `priceBasket`, never joined back to the catalogue). The new `product_id` lives on
the **mutable draft** only, so that any till can rebuild the basket and re-price it authoritatively at
pay — the reference is a *pricing input*, never a stored *price*. A stale catalogue is still a freshness
problem, not a correctness one, for everything that is immutable.

---

## 7. Composition and the two-branch parallel plan

Both slices touch the **same seam**: `recordTillSale` (tender + settlement) and the till pay widget. 7b
restructures the pay flow (persist + settle a working order, idempotency); card adds one tender case.
Because manual card makes no network call and commits atomically, there is **no correctness coupling**
between them (that returns only with the integrated terminal, §3). So the seam is a **merge** concern,
not a design one.

**Plan:**

- **Branch 1 — 7b** lands first: the migration (§2), the working-order module + routes, the idempotent
  pay flow, and the held-list UI. This is the larger change to `recordTillSale` / `till-api.ts` /
  `tender-pay.ts`.
- **Branch 2 — manual card** is a small, isolated addition on top: the `card` case in the (now
  restructured) tender handling and the Card button. It **rebases onto 7b** before merge.
- Developed **concurrently in two worktrees**. The migration is 7b-only, so there is **no
  `packages/db/drizzle/meta/_journal.json` collision** — manual card adds no migration (the enum value
  and the payment machinery already exist). Verified: `tender_method` has `"card"` (`sales.ts:41`);
  `recordManualCardPayment` is in `packages/payments` (its own journal).
- **Two implementation plans**, one per branch.

The one honest cost: whichever branch is edited second pays a small rebase on the shared seam. It is
localised (the tender/settlement block of one function and one widget), not structural.

---

## 8. Testing

**Real Postgres** (PGlite serialises every query onto one backend — a concurrency test there is a false
pass, `CLAUDE.md` §4) for:

- **State transitions** — `open → settled`, `open → abandoned`, and rejection of any write to a terminal
  order (the DB trigger already enforces this; the suite proves the app path honours it).
- **RLS** — a register sees another register's parked order **within one tenant/node** (cross-till), and
  **cannot** see another tenant's (cross-tenant isolation, proven by deletion per `CLAUDE.md` §4).
- **Idempotency concurrency** — two pays for one working order in separate connections yield **one**
  sale and **one** chained record; the second is an idempotent replay, not a second filing (§3). Prove
  the guard by deletion: drop the `UNIQUE` / the `FOR UPDATE` and watch a double-file appear.

**Lighter targets** where the heavy justification does not apply (state it in a comment):

- Manual card: the capture + associate happen inside the sale transaction; card amount **equals** the
  total; `voucher`/`transfer`/`other` are refused.
- The order-number allocator: monotonic per `(tenant, node)`, no reuse after an abandon.

**End-to-end** (a demo script + a real-PG suite, as 7a has `demo:till`): park on register 1 → retrieve
on register 2 → edit → pay by **cash**, and again by **card** → a legal ticket + an intact fiscal chain
across sales; a replayed pay returns the **same** ticket without re-filing.

---

## 9. Files (indicative, for the plans to firm up)

- **`packages/db`** — one custom migration (§2): `sales.working_order_id` + FK + UNIQUE;
  `working_orders.order_number`/`label`; `working_order_lines.product_id` + composite FK;
  `products` `UNIQUE(tenant_id, id)`; the `working_order_counters` table + its FORCE-RLS/policy/grant.
  Plus the Drizzle schema (`schema/orders.ts` — `order_number`/`label`/`product_id`, and the revised
  `orders.ts:87` note; `schema/catalogue.ts` — the `products` composite unique; a new
  `schema/working-order-counters.ts`), a `working_order_id` column on `schema/sales.ts`, and the
  `order_number` allocator helper beside `allocate-number.ts`.
- **`@waitron/core`** — `recordSale` writes `input.workingOrderId` onto the `sales` row (making the
  existing seam persist); the field stays supplied by every caller, NULL-able on the column so
  non-till callers are unaffected. A `settleWorkingOrder(tx, …)`-style helper flips `open → settled`
  (or the working-order module owns it). Any new domain error codes name the **domain concept**,
  import their registry, and are grep-checked against siblings first (`CLAUDE.md` §3).
- **`apps/server/src`** — a working-order module (park / list / retrieve / update / abandon +
  idempotent pay-settle), its routes on `till-api.ts`, the generalised tender in `till-sale.ts`
  (card case), a `demo:` script extension covering park → retrieve → pay (cash + card) → replay.
- **`packages/payments`** — none for manual card beyond calling the existing
  `recordManualCardPayment` / `associatePaymentWithSale` from `recordTillSale`.
- **`apps/till/src`** — a Hold/Park control and label prompt, a held-orders-list widget + its layout
  seam (`layout.ts` `WidgetType` + `till-counter-screen` switch), Discard, retrieve-into-basket, the
  Card tender button (`tender-pay.ts` + the `Tender` union in `api/client.ts`); `WorkingOrderStore`
  gains a stable client-minted working-order id and a retrieve/replace path; new i18n keys
  (`en` + `es` together).
