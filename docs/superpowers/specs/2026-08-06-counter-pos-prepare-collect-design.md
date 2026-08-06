# Counter POS — prepare & collect (sub-project 7, slice 7c) + the line-add price-snapshot foundation — design

**Date:** 2026-08-06. **Sub-project:** 7 (Counter POS UI), third slice — **7c (prepare & collect)**,
which also **owns the shared foundation** the parallel integrated-card-terminal slice builds on:
line-add price snapshot, order **placing**, price-lock, and the **pay-timing** config. **Status:**
designed, awaiting plans.

Slice 7a (`2026-08-05-counter-pos-walkup-sale-design.md`, merged #60) rang the first walk-up cash sale.
Slice 7b + the manual card tender (`2026-08-05-counter-pos-park-retrieve-and-card-design.md`, merged
#61 / #62) persisted the working order, shared it across registers, added sale idempotency, and took a
manual (*datáfono*) card tender. 7c is the third slice on that foundation. It does four things:

1. **Revises a shipped pricing decision** — the working order now locks each line's price **at add
   time** (a snapshot), replacing 7b's "a parked order re-prices at current catalogue prices at PAY"
   (§2). This is the shared foundation the card slice also stands on, so it is the **spec-of-record**
   for it; the integrated-card spec references this section rather than restating it.
2. Introduces **placing** — finalizing an order (customer shown the total) — and the two **issuance
   orderings** it enables, selected by a **per-location pay-timing config** (§3).
3. **Builds the working-order amendment log** (art. 29.2.j LGT) — append-only, tamper-evident, attached
   at placing (§4, owner decision to build it now).
4. Adds a **prep surface** — send-to-prep, preparing, ready, collected — as a node-scoped prep-queue
   view reusing 7b's cross-till held-list mechanism, **not** a separate KDS app (§5).

**No fiscal machinery is reimplemented.** Both issuance orderings are built from primitives that
already exist: `recordSale`'s `immediate`/`deferred` settlement (`record-sale.ts:120`), `settleSale`,
and `listOutstandingSales` (`2026-08-03-invoice-first-settlement-design.md`). The immutable
`sales`/`sale_lines`/`registros_facturacion` and the fiscal chain are untouched except for one additive
migration (§6).

---

## 1. Scope

### The #7 roadmap this sits in

| Slice | What | State |
| --- | --- | --- |
| **7a** | Walk-up cash sale | merged (#60) |
| **7b** | Park & retrieve open orders — persisted working orders, cross-till held list, sale idempotency | merged (#61) |
| **card** | Manual card tender (*datáfono*) | merged (#62) |
| **7c** | **Prepare & collect** — line-add price snapshot + placing + pay-timing config + prep states + the **amendment log** (this spec) | designed |
| **integrated card** | Integrated card terminal (Stripe Terminal / SumUp) — network capture, timed-out-card UX, hardware — **parallel branch** on this foundation | future |
| — | Offline store-and-forward · scale + printer hardware · refunds/voids/corrections UI · layout & receipt **editors** | future |

### In scope

- **Line-add price snapshot** (§2). Each `working_order_line` locks its unit price **when the line is
  added**; the running total is the sum of locked prices and is stable over time. The filed
  `sale_lines` are built **from** those locked prices. **Revises 7b's re-price-at-pay decision** — the
  consumers this touches are enumerated in §2.
- **Placing** (§3) — a `working_orders` transition `open → placed` that freezes composition, opens the
  amendment log, and (in the invoice-first ordering) issues the deferred invoice. A pure walk-up
  finalizes+pays+issues in one instant with no gap, so 7a/7b's walk-up path is behaviourally unchanged.
- **The per-location pay-timing config** (§3) — WHEN payment happens (order vs collect) × WHEN the
  invoice issues (placing vs pay). Home: one `locations` column. **No config-authoring UI** — the value
  is set at provisioning, like the layout editor, and stays out of scope (like it).
- **The amendment log** (§4) — a new append-only, tenant-scoped, tamper-evident table, attached at
  placing.
- **The prep surface** (§5) — send-to-prep / preparing / ready / collected, and a node-scoped
  prep-queue view (a till route/widget), reusing 7b's held-list mechanism.

### Out of scope (each has a named home)

- **Config-authoring UI / editor** for the pay-timing config → deferred with the layout & receipt
  editors (later slice). The config lives at provisioning / in the DB, read at boot.
- **Integrated card terminal** (network capture, timed-out-card UX, hardware) → its own **parallel**
  slice in the `packages/payments` lane, which stands on this foundation (§7). The idempotency coupling
  a network capture carries is that slice's concern, not this one's (7b §3).
- **A separate KDS application** (a kitchen-display device/app) → later slice. 7c ships a prep-queue
  **view** on the till, not a KDS.
- **Split tender, refunds/voids/corrections UI, offline store-and-forward, auto-expiry, hardware** →
  later slices, unchanged from 7b.
- **The precuenta legal question (Q14)** — whether a printed pre-bill *obliges* the amendment log — stays
  advisor-blocked (backlog "advisor gap", `docs/backlog.md:204`). 7c builds the log anyway (owner
  decision) and keeps it **additive** so a later asesor ruling that moves the trigger is cheap (§4).

---

## 2. The foundation: line-add price snapshot (revises a shipped decision)

### The revision, stated openly

7b (`2026-08-05-counter-pos-park-retrieve-and-card-design.md` §2, §4) decided: **"a parked order
re-prices at PAY, at current catalogue prices"** — the working order stored `product_id` + `quantity`,
retrieve rebuilt the browser basket, and pay re-priced the sent `{ productId, quantity }` against the
live catalogue, exactly as a walk-up does. The stored `unit_price`/`line_total` were an explicit
**display cache**, "NOT the filed price — pay re-prices from `(product_id, quantity)`"
(park-retrieve §2).

**7c reverses that.** Each `working_order_line` stores its **locked unit price, captured at add time**.
The order's running total is `Σ` of the snapshotted line prices and does not move as the catalogue
changes. **A catalogue price change affects only future line additions, never a line already on the
order.** Weighed items are priced at weigh (= add) time, the same rule. When the order is filed, the
`sale_lines` are built **from the locked line prices**, not from a fresh catalogue read — so the
immutable fiscal record is unchanged in kind (still a snapshot, still never joined back to the
catalogue), only its *source* moves from "the catalogue at pay" to "the line's own lock at add".

### Why

The filed record is "what the customer was shown", by construction: the price on the ticket is the
price that was on screen when the line was rung. Re-pricing at pay can hand the customer a total that
differs from the one they agreed to if the catalogue changed in between — the exact surprise a counter
must not produce, and the reason line-add snapshot is the industry norm. The 7b decision optimised for a
different property (one authoritative pricing path shared by park/update/pay); 7c keeps a single pricing
routine (`priceBasket`) but runs it **once per line, at add**, and persists the result.

### Clean because pre-production

There is no data migration and no backfill: nothing is deployed, developer databases are recreated, CI
builds fresh (`CLAUDE.md` §3, "No backwards-compatibility or data-migration code until Waitron is in
production"). The columns already exist (7b added `working_order_lines.unit_price`, `line_total`,
`product_id`, `vat_rate`); 7c changes only their **meaning** (display cache → authoritative lock) and
the **code** that reads them at filing.

### The exact consumers this revises

Every one of these was grepped and read. The behaviour change is observable **only when the catalogue
price of a line changes between add and pay** — no existing test exercises that (none does an
`update products set unit_price` mid-flow), so most existing assertions survive numerically while their
**comments and intent** now assert the opposite of the code. Two are load-bearing behaviour changes.

**Code (behaviour changes):**

1. **`apps/server/src/till-sale.ts:194-209` — `payWorkingOrder`'s pricing.** The walk-up branch
   (`locked === undefined`, lines 195-196) already files from the price `createOpenOrder` just locked —
   it is **already snapshot-consistent** and does not change. The **retrieved-order else-branch**
   (lines 197-208) re-reads `listAvailableProducts` and re-prices `req.lines` at the current catalogue;
   this is the concrete "re-price at pay" and it **must change** to file from the order's **stored**
   locked lines. This is the single load-bearing code edit.
2. **`apps/server/src/working-order.ts`** — `priceOrderLines` / `createOpenOrder` / `updateHeldOrder`
   already lock a price into `working_order_lines` at park/update time; that stays. What changes is that
   the stored value is now **authoritative for filing**, not a display cache. `updateHeldOrder`
   re-prices the whole replacement basket at edit time — under the snapshot rule an edit **re-locks at
   edit time** (industry-normal: a line changed now takes the current price), which is consistent, but
   the plan should confirm the "replace the whole basket" semantics still hold each surviving line's
   original lock (see the design tension below).

**Schema comments (now false — must be rewritten, not deleted, per `CLAUDE.md` §1 "editing a file is
not auditing it"):**

3. **`packages/db/src/schema/orders.ts:98-113`** — describes `working_order_lines` prices as
   "snapshotted here, never read live … a later catalogue edit is a freshness problem, never a
   correctness one" and `product_id` as "a pricing INPUT, not a reference the record depends on … lets a
   repricing re-resolve". Under 7c the snapshot **is** the filed price; `product_id` remains a pricing
   input for **new / weighed** lines but no longer implies a re-price of existing ones.
4. **`packages/db/src/schema/orders.ts:130-136`** — the `line_total` comment says the draft "money
   column carries the gross the operator reads … the walk-up/pay path files from `priced.lines`,
   unaffected by this draft column." After 7c the **filed** line for a retrieved order **does** derive
   from the draft's locked columns. (The gross-vs-net divergence itself stays — see the desglose note
   below.)
5. **`apps/server/src/working-order.ts:76-83`** — the same "DIVERGES from the FILED `sale_lines` … the
   walk-up/pay path files from `priced.lines`, unaffected by this draft column" claim.

**Tests (comments/intent contradicted; one is semantically broken):**

6. **`apps/server/src/working-order.rls.test.ts:332-361`** — titled *"parked: pays an existing open
   order at CURRENT prices and settles it"*, comment (`:337`) *"The pay re-prices what is SENT, not the
   stored draft"*, assertion (`:354`) *"the CURRENT basket, not the parked 1.50"*. This test **parks
   café×1 then pays café×1 + agua×1** — a pay whose basket differs from the stored composition. Under
   line-add snapshot that is exactly the pattern the revision removes (agua was never *added* to the
   order, so it has no locked price). This test is **semantically broken by the revision**, not merely
   re-worded, and must be rewritten to the new model (add-then-pay, or pay-the-stored-composition). It
   is the clearest place the plan must budget for.
7. **`apps/server/src/working-order.rls.test.ts:514`** and **`:708`** — comments *"A parked pay
   re-prices the SENT basket"* / *"re-price the retrieved basket authoritatively"*. The numeric
   assertions survive (no price change), the comments must be rewritten.
8. **`apps/server/src/till-sale.test.ts:166`** — *"re-prices a basket authoritatively and files a
   chained immediate cash sale"* — a **walk-up**, no gap, so behaviour is unchanged; comment wording
   only.
9. **`packages/db/src/schema/orders.test.ts:494`** — comment that `product_id` "is repriced (orders.ts);
   it is a pricing INPUT, not a snapshot." Needs the §2 nuance.
10. **`apps/server/src/working-order.test.ts:428-439`** — the update path "replaces the lines, re-prices
    the total" — still valid (an edit re-locks at edit time), wording aligns.

**Demo scripts (narration, not tests):** `apps/server/scripts/park-retrieve-demo.ts:224,243` and
`apps/server/scripts/till-demo.ts:251` narrate "re-price authoritatively" — update the narration.

**Add the missing test the revision is *for*:** a real-PG case that **parks a line, changes that
product's catalogue `unit_price`, then pays**, and asserts the sale files at the **locked** price, not
the new one — proven by deletion of the lock (`CLAUDE.md` §4). No such test exists today; it is the only
one that actually separates the two models (`CLAUDE.md` §1, "a measurement taken where both answers look
alike measures nothing").

### The desglose subtlety the plan must get right (a code contradiction to resolve)

`priceBasket` derives **everything** from the **gross** unit price: `base = gross ÷ (1 + rate)`, and the
VAT desglose is the **difference method**, `tax = gross − base` (`packages/catalogue/src/pricing.ts:81-113`;
`PriceableProduct.unitPrice` is gross, `:21`). But the stored draft line keeps `unit_price` = the **net**
unit (`pricing.ts:86,91`, "net, informational") and `line_total` = the **gross** line total
(`working-order.ts:76-83`; `orders.ts:130-136`). To file `sale_lines` **from the locked line without a
re-price** and still reproduce the cent-exact difference-method desglose (the property
`working-order.rls.test.ts:363-378` pins — base 4.55, tax 0.95, *not* a naïve `round(base×rate)` = 0.96),
the filing must run the same difference-method arithmetic over the locked **gross** figure. The stored
columns permit it (gross unit = `line_total ÷ quantity`), but a cleaner plan **persists the locked gross
unit price** on the line so the filing feeds `priceBasket` (or a `priceLockedLines` sibling) a synthetic
`PriceableProduct` built from the lock, rather than dividing back out. Flag for the plan: **decide where
the locked gross lives** — recover it from `line_total ÷ quantity`, or add a column — and keep the
gross/net draft-vs-filed divergence intact either way.

### The design tension the plan must resolve (client basket vs stored lines)

7b's invariant "the server prices authoritatively; the browser sends `{ productId, quantity }` and **no
price**" (till-sale.ts:50-62) coexists uneasily with line-add snapshot, because a flat client basket at
pay cannot tell the server *which* lines were added earlier (and carry a lock) from ones added just now.
The resolution, which honours both the snapshot rule and the no-price invariant: **the stored
`working_order_lines` are the authoritative composition.** Adds / edits / weighs go through the server
(park, update, and the new send-to-prep), each pricing the *new* line against the *current* catalogue and
locking it; **pay files the stored lines**, it does not re-price a client basket. The server still prices
(the browser still sends no price) — but at add, once, not at pay. A walk-up with no gap is unaffected:
add = pay in one instant, so the locked price *is* the current price. This is the architectural shift
from 7b, and the plan should state it as such.

---

## 3. Placing, the two issuance orderings, and the pay-timing config

### Placing

**"Placing" = finalizing the order** — the moment the customer is shown the total and the order becomes
an order of record. It does not re-lock price (each line is already locked at add). It does three things:

1. **Freezes composition.** Further edits become **logged amendments** (§4), not silent line rewrites.
2. **Opens the amendment log** (§4).
3. **Establishes the issuance basis.** In the invoice-first ordering, placing **issues** the deferred
   invoice; in the ticket-last ordering, placing prints the ticket/pre-bill and the fiscal invoice
   issues at pay. So placing always fixes the price-locked, composition-frozen basis the fiscal record
   draws from; whether the fiscal record is *written* at placing is the issuance-timing config below.
   (This is a faithful reading of the brief's "placing anchors fiscal issuance" — placing anchors the
   *basis*; the *write* may be deferred to pay. Flagged as an interpretation.)

A **pure walk-up finalizes + pays + issues in one instant** — no gap between placing and pay — so 7a/7b's
walk-up path stays behaviourally unchanged (`open → settled` in one transaction, `till-sale.ts:283-286`).
Verify this in the plan: the walk-up never enters `placed`, so no amendment log opens for it.

### The two orderings, both built from existing primitives

- **Ordering 1 — simplified invoice first, then pay (invoice-first, #55).** At placing, `recordSale`
  with `settlement: { kind: "deferred" }` chains and files the invoice with **no payment** (price locked
  by the immutable `sale_lines`); payment comes later; `settleSale` links the tenders + `sale_settlements`
  (`record-sale.ts:120,330-348`; `2026-08-03-invoice-first-settlement-design.md`). A declined or absent
  payment leaves an **issued-but-unpaid outstanding invoice** — legitimate in invoice-first, surfaced by
  `listOutstandingSales`.
- **Ordering 2 — ticket → pay → simplified invoice (today's flow).** Finalize (ticket, price locked) →
  pay → `recordSale` with `settlement: { kind: "immediate", tenders }` chains and files the invoice at
  pay (`till-sale.ts:233-256`). A decline files nothing.

### The config: two axes, one enum

| Axis | Values |
| --- | --- |
| **When payment happens** | at **order** · at **collect** |
| **When the invoice issues** | at **placing** · at **pay** |

The 2×2 collapses to **three** meaningful modes; the fourth cell is degenerate and dropped (YAGNI):

| pay ↓ / issue → | issue at **placing** | issue at **pay** |
| --- | --- | --- |
| **at order** | *degenerate* — placing = pay = one instant, so "issue at placing" is identical to "issue at pay". **Drop.** | **Mode P — prepay.** Pay + issue at order, then prep, then collect (Pret/Starbucks counter). Ordering 2, no gap. |
| **at collect** | **Mode I — invoice-first.** Issue unpaid at placing, prep, pay + `settleSale` at collect. Ordering 1. | **Mode T — ticket-then-pay.** Place (pre-bill, no fiscal doc), prep, pay + issue at collect. Ordering 2 with a gap. |

Because the top-left cell is not merely unused but a **contradiction** (issuing "at placing" when placing
and pay are the same instant is just "at pay"), a **single 3-value enum column structurally forbids it**,
where two orthogonal booleans would admit it. **Home:** one `locations` column — `locations` already
carries the per-venue fiscal/time config (`fiscal_territory`, `time_zone`, `day_cutover`, added #57,
`packages/db/src/schema/tenants.ts:71,77,78`), so a service-flow mode belongs beside them. Proposed
`order_flow` (English — `packages/db` is scanned by `english-only.ts`; `apps/*` is out of scope, `:29-42`)
with values along the lines of `prepay` / `invoice_first` / `ticket_then_pay`; the plan finalizes the
name and greps sibling enums for the naming convention (`CLAUDE.md` §1). Default should be the mode that
reproduces today's behaviour so existing fixtures are inert (the `#57` reshape pattern, `tenants.ts:50-59`).

### State machine × config

`E` = order edited (add/remove/weigh line). `place` = send-to-prep = placing. Fiscal writes named
against the primitives:

| Mode | order/add | place (send-to-prep) | prep → ready → collect | pay |
| --- | --- | --- | --- | --- |
| **P — prepay** | lines locked at add | freeze + open log; **pay + issue** here (`recordSale` immediate) → `open → settled` | prep advances on an already-settled order (§5 note) | (at order) |
| **I — invoice-first** | lines locked at add | freeze + open log; **issue** deferred (`recordSale` deferred) → `open → placed` | prep advances on a `placed` order | at collect: `settleSale` → `placed → settled` |
| **T — ticket-then-pay** | lines locked at add | freeze + open log; **no fiscal doc** → `open → placed` | prep advances on a `placed` order | at collect: `recordSale` immediate → `placed → settled` |

Idempotency composes with 7b's guard in every mode: the sale is filed with `working_order_id` set, and
`sales_working_order_id_key` (UNIQUE `(tenant_id, working_order_id)`, `sales.ts:193-196`) makes **at most
one sale per order** — so a double-tap **place** (Mode I) or a double-tap **pay** (Modes P/T) collides
`23505` and replays, exactly as 7b's `payWorkingOrder` already handles (`till-sale.ts:312-338`).
`settleSale`'s own `sale_settlements` UNIQUE `(tenant_id, sale_id)` (`sales.ts:303`) makes the settle
idempotent too.

---

## 4. The amendment log (build it now — owner decision)

### What and why

Art. 29.2.j LGT's duty to preserve records of an order's amendments is flagged **"probable but
unconfirmed"** by the architecture and by open advisor **Q14** — *no asesor is engaged, and no primary
text names the restaurant precuenta* (backlog "advisor gap", `docs/backlog.md:204,261-262`). 7b
deferred the log to 7c on purpose (park-retrieve §6). **Owner decision (this session): build it now**,
minimal, attached at **placing** — because 7b now produces persisted working orders, so the log finally
has a producer, and because building it additively is cheap insurance against a later ruling.

It **rides Q14's unconfirmed trigger**: the log opens at placing (the till's proxy for the precuenta).
If an asesor later rules the trigger sits elsewhere (e.g. at the printed pre-bill specifically, or not at
all), moving *when* the log opens is a one-line change and the table is unaffected. **Keep it additive.**

### Shape

A new table — **English name** (`packages/db` is `english-only`-scanned; the *legal* term
art. 29.2.j / precuenta lives only in comments), proposed `order_amendments` — **append-only and
immutable**, the `sale_lines`/`time_entries` pattern, **not** the mutable `working_orders` pattern:

- **Immutability** — `REVOKE ALL` from `app_user` then `GRANT SELECT, INSERT` only, plus the
  append-only `reject_mutation` trigger and a TRUNCATE-blocker, exactly as
  `packages/db/drizzle/0002_immutability.sql` applies to the fiscal tables. A logged amendment, once
  written, cannot be edited or deleted.
- **Tenant scoping (the full treatment `CLAUDE.md` §3 demands, enforced by the `inmutabilidad` guard)**
  — `tenant_id` column, **FORCE ROW LEVEL SECURITY**, a `order_amendments_tenant_isolation` FOR ALL
  policy on `current_tenant_id()`, and the grants above. Composite tenant-consistent FK
  `(tenant_id, working_order_id) → working_orders(tenant_id, id)`, the `0029` idiom. **Run
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after the migration** — a new
  `tenant_id`-bearing table is precisely what that guard exists to catch a missing FORCE on
  (`packages/fiscal-verifactu/src/inmutabilidad.test.ts`; `CLAUDE.md` §3).
- **Contents** — each entry captures **what changed** (the amendment kind + a minimal payload:
  line added / removed / quantity or price changed, with the affected line's identity), the **actor**
  (the operator uuid from the session), a **reason** (free text), and the **capturing till and node**.

### Tamper-evidence — the #52 lessons applied

`packages/workforce`'s correction chain is the reference (`clocking.ts:643-679`), and its #52
`/finish-branch` review fixed exactly the traps this log must avoid from the start
(`docs/backlog.md:292`):

- **Render LOCAL wall-clock, not UTC.** Store the event instant **and its wall offset** (the
  `time_entries` / `sales.issued_offset_minutes` pattern), so an amendment reprints in the venue's local
  time, not UTC.
- **Hash the reason, the actor, and the capturing till/node** into the tamper-evidence value — #52's
  fix was that the workforce chain had omitted a correction's reason/actor/capturing-till, so a party
  past the immutability floor could rewrite them undetected. The amendment's own content must be inside
  whatever hash gives it tamper-evidence (`clocking.ts:658-677`).
- **Tie-break precedence on the HASHED sequence, never an unhashed ingest order** — #52 moved correction
  precedence off `ingest_seq` onto the hashed `sequence_no` because a floor-bypasser could otherwise
  reorder entries undetected. If amendments need ordering, order on a hashed sequence.

**Minimal, not a second fiscal chain.** The brief's word is *minimal*, and Q14 is *unconfirmed*, so do
**not** over-build: a full per-order cryptographic hash chain (the `appendToChain` machinery) is more than
an unconfirmed duty warrants (YAGNI). The defensible minimum is the append-only immutable table above
with the actor/reason/capturing-node captured and a **hashed sequence per order** carrying that content,
so the #52 tie-break and content-tamper lessons hold without standing up a whole chain subsystem. The
plan decides whether a single `huella`-style hash-of-content-plus-prior suffices or a bare monotonic
`seq` is enough for the unconfirmed trigger; keep whichever is chosen additive.

---

## 5. The prep surface

A **prep-queue view**: orders by prep state, **node-scoped**, reusing 7b's cross-till held-list
mechanism (`listHeldOrders` filters `tenant_id` (RLS) + `node_id` + status,
`apps/server/src/working-order.ts:234-270`). It is a **till route/widget**, not a separate KDS app
(that is a later slice). Prep transitions: **send-to-prep** (= placing, the "third save trigger" 7b's §6
designed for) → **preparing** → **ready** → **collected**.

### Where prep state lives (an interpretation the plan must ratify)

Prep progress does **not** belong on `working_orders.status`, because of a real conflict with the fiscal
state machine:

- The `working_orders_enforce_transition` trigger rejects **any** UPDATE of a non-`open` row
  (`packages/db/drizzle/0004_working_orders.sql`, `IF OLD.status <> 'open' THEN RAISE`). In **Mode P
  (prepay)** the order is **already `settled`** when prep runs (pay is at order), so advancing a
  `prep_state` column on the settled row would be rejected by that terminal-state guard — and it *should*
  be: a settled order is fiscally frozen.
- Prep is operational, ephemeral, node-scoped, and mutable — a poor fit for the fiscal-adjacent
  `working_orders` row.

So 7c adds a **separate mutable `order_prep` table** keyed `(tenant_id, working_order_id)` carrying the
prep state + its timestamps + the node, FORCE RLS + tenant-isolation policy + `SELECT/INSERT/UPDATE`
grants (mutable, so no immutability triggers — the `working_order_counters` shape of `0029`). Prep
advances there, freely, regardless of the order's fiscal status. The prep-queue view is
`order_prep join working_orders … where node_id = $node and prep_state in (…)`, node-scoped like the held
list. **Rejected alternative:** a `prep_state` column on `working_orders` + a trigger carve-out to let it
change on `placed`/`settled` rows — rejected because it entangles operational prep with the
fiscal-terminal immutability rule and weakens a guard that must stay strict. (Flagged as an interpretation
of the brief's "reusing 7b's held-list mechanism" — the *node-scoping* is reused; the *storage* is a new
table.)

### The `working_orders` state machine — how it extends 7b, exactly

7b's `working_order_status` is `open | settled | abandoned` (`orders.ts:25`;
`0004_working_orders.sql`), with:
- `working_orders_enforce_transition` (BEFORE UPDATE): rejects any update of a non-`open` row.
- `working_order_lines_require_open_parent` (BEFORE INSERT/UPDATE/DELETE on lines): lines are writable
  only while the parent is `open`.
- the `settled_at` biconditional check `(status='settled') = (settled_at is not null)` (`orders.ts:91-94`).

7c extends it with **one new non-terminal state, `placed`** (the enum gains a value; the
`drizzle-kit generate --custom` migration adds it):

- **New transitions:** `open → placed` (placing / send-to-prep), `placed → settled` (pay at collect,
  Modes I/T), `placed → abandoned` (cancel a placed order — itself a logged amendment). `open → settled`
  (walk-up / Mode P) and `open → abandoned` stay. `settled` and `abandoned` remain terminal.
- **The `enforce_transition` trigger is REWRITTEN, not merely extended** (`CLAUDE.md` §1 — a behaviour
  change retires the old comment): it must permit `open → {placed, settled, abandoned}` and
  `placed → {settled, abandoned}`, and reject any transition **out of** `settled`/`abandoned`. Replace
  the `OLD.status <> 'open'` test with the explicit allowed-transition set, and update its comment.
- **`require_open_parent` STAYS UNCHANGED — and gives the composition freeze for free.** Because lines
  are writable only while the parent is `open`, the `open → placed` transition **automatically** freezes
  the composition (line INSERT/UPDATE/DELETE on a `placed` order is already rejected by the existing
  trigger). This is the honest reuse that makes "placing freezes composition" (§3) cost nothing new.
- **The `settled_at` biconditional needs no change:** `placed` carries `settled_at = NULL`, and
  `(placed = 'settled') = (NULL is not null)` is `false = false`, satisfied.

Verify the trigger rewrite by deletion (`CLAUDE.md` §4): remove each new allowed edge, confirm the
transition that should now pass fails, restore it; and confirm a transition out of `settled` still throws.

---

## 6. The one migration

`packages/db` gains a single additive `drizzle-kit generate --custom` migration (next number **`0030`**;
highest today is `0029_park_retrieve.sql`), hand-edited for the FORCE-RLS / policy / grant / composite-FK
idiom exactly as `0027_light_smiling_tiger.sql` and `0029_park_retrieve.sql` do (statements reordered so
each FK follows the UNIQUE it targets; FORCE + policy + grants appended by hand because `.enableRLS()`
emits only `ENABLE`). It:

- **Adds `placed` to the `working_order_status` enum** (`ALTER TYPE … ADD VALUE`), and **replaces the
  `working_orders_enforce_transition` function body** with the extended state machine (§5).
- **Adds the `order_flow` column to `locations`** (an enum or a checked text, with a
  behaviour-preserving default — §3). No RLS work: `locations` already carries FORCE RLS + policy +
  grants from `0001`.
- **Creates `order_amendments`** — append-only immutable (§4): `tenant_id`, composite FK to
  `working_orders`, the actor/reason/capturing-till/capturing-node columns, the local-wall-clock instant
  + offset, and the hashed sequence. `ENABLE` (from `.enableRLS()`) + hand-written **FORCE RLS**,
  `order_amendments_tenant_isolation` FOR ALL policy on `current_tenant_id()`, `REVOKE ALL` +
  `GRANT SELECT, INSERT` (no UPDATE/DELETE — append-only), and the `reject_mutation` + TRUNCATE-block
  triggers (`0002` idiom).
- **Creates `order_prep`** — mutable (§5): `(tenant_id, working_order_id)` PK, composite FK to
  `working_orders`, the prep-state enum + timestamps + `node_id`. `ENABLE` + hand-written FORCE RLS +
  tenant-isolation policy + `GRANT SELECT, INSERT, UPDATE` (no DELETE — the `0029`
  `working_order_counters` shape).

Plus the Drizzle schema changes (`schema/orders.ts` — the enum value, the `enforce_transition` comment,
the revised line-price comments from §2; `schema/tenants.ts` — the `locations.order_flow` column; new
`schema/order-amendments.ts` and `schema/order-prep.ts`).

**Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after the migration** — `order_amendments`
**and** `order_prep` are both new `tenant_id`-bearing tables, exactly what that guard checks a missing
FORCE on (`CLAUDE.md` §3; a package's own suite would pass while the fiscal suite goes red, as it did for
`nodes`).

---

## 7. Reporting impact (issuance vs settlement anchors)

`computeDailyClose` anchors its **VAT summary at issuance** and its **operational cash-up at settlement**
(`packages/reporting/src/daily-close.ts:9-10`), reading `time_zone` + `day_cutover` off the location. The
pay-timing config therefore moves *when each lands on a business day*:

- **Mode P (prepay)** and **Mode T (ticket-then-pay)**: issuance and settlement coincide (pay = issue),
  so VAT and cash fall on the same business day, as today.
- **Mode I (invoice-first)**: issuance is at placing, settlement at collect. If placing and collect
  **straddle the `day_cutover`**, the VAT lands on the placing day and the cash on the (later)
  settlement day — a *correct* divergence (VAT is owed at issuance under Veri\*Factu) but a new one the
  daily close will show. No code change is needed — the anchors already differ — but the plan should add
  a reporting test that a Mode-I sale straddling the cutover reports VAT and cash on the two respective
  days, so the behaviour is pinned rather than discovered.

No reporting **code** changes in 7c; this section records the consequence so it is a decision, not a
surprise.

---

## 8. Composition and the parallel plan

**This is the FOUNDATION branch, and it lands first.** The integrated-card slice is a **parallel branch
in the `packages/payments` lane** and builds on §2's price lock, §3's placing/config, and 7b's
idempotency guard. Following park-retrieve §7's pattern:

- **Branch 1 — 7c (this spec)** lands first: the `0030` migration (§6), the line-add-snapshot filing
  change (§2), placing + the pay-timing config (§3), the amendment log (§4), and the prep surface (§5).
  It owns the shared till seam edits — `apps/server/src/till-sale.ts` (`payWorkingOrder`'s filing path),
  `apps/server/src/till-api.ts` (a `place`/send-to-prep route, prep-advance routes), and the till widgets
  (`apps/till/src/widgets/tender-pay.ts` and a prep-queue widget).
- **Branch 2 — integrated card terminal** develops concurrently in the `packages/payments` lane. Its
  migration (if any) rides `packages/payments`' own journal, so there is **no
  `packages/db/drizzle/meta/_journal.json` collision** with `0030` (the same property that let 7b and the
  manual-card branch run parallel, park-retrieve §7). It **rebases onto 7c's shared till seam** before
  merge — the honest cost is a localised rebase of the tender/settlement block and one widget, not a
  structural one, because 7c has already restructured pay to file from locked lines and card slots a
  network-capture case into that structure.
- **Two implementation plans**, one per branch. 7c is the larger, foundational change and must merge
  first so the card branch rebases onto a settled seam, never the reverse.

---

## 9. Testing (PGlite vs real-PG per `CLAUDE.md` §4)

**Real Postgres** (PGlite makes every connection a superuser and serialises onto one backend — a false
pass for RLS and concurrency, `CLAUDE.md` §4):

- **The line-add snapshot itself** — the missing test from §2: park a line, **change the catalogue
  `unit_price`**, pay, assert the sale files at the **locked** price; prove by deletion of the lock. This
  is the one that separates the two pricing models and it needs a real price mutation across the gap.
- **The extended state machine** — `open → placed → settled`, `open → placed → abandoned`,
  `open → settled` (walk-up), and **rejection of every transition out of `settled`/`abandoned`** and of
  a line edit on a `placed` order (composition freeze via `require_open_parent`). Prove the trigger
  rewrite by deletion.
- **The amendment log** — append-only (an UPDATE/DELETE by `app_user` is refused), tenant isolation
  (a second tenant sees none of tenant A's amendments, proven with both tenants non-empty in the *same*
  state, `CLAUDE.md` §1), and the tamper-evidence: the hashed sequence commits the reason/actor/capturing
  node (mutate one, the verification fails), and precedence tie-breaks on the hash, not ingest order (the
  #52 regression, proven by deletion).
- **`order_prep` RLS + the prep advancing on a settled order** (Mode P) — a real-PG case that prep
  advances on an already-`settled` order **without** touching the frozen `working_orders` row, the exact
  conflict §5 avoids.
- **Idempotency across the new triggers** — a double-tap **place** (Mode I) files one deferred invoice
  (`sales_working_order_id_key`), and a double **pay** replays; two connections racing, one filing, per
  7b's guard.
- **The inmutabilidad guard** — `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after the
  migration (both new tables).

**Lighter targets** where the heavy justification does not apply (say so in a comment):

- The pay-timing **config × ordering** dispatch — that Mode I calls `recordSale` deferred at placing and
  `settleSale` at collect, Mode T files immediate at collect, Mode P files immediate at order — a pure
  branch over config, provable on PGlite.
- Reporting: the Mode-I cutover-straddle VAT/cash split (§7) is deterministic arithmetic over immutable
  rows — PGlite is enough (as `computeDailyClose`'s own suite is).

**Gate.** `packages/db` runs **unfiltered** `test:coverage` (schema + a migration + a rewritten trigger,
so the cross-cutting suites — `english-only`, the teardown guard — must load; `CLAUDE.md` §2). Thresholds
stay `98/98/98/95`. New suites carry **guarded teardowns** and let `usePgliteDb`/`useRealPostgres` own
the database (`CLAUDE.md` §4). Suites that shell out are not involved here.

---

## 10. Files (indicative, for the plans to firm up)

- **`packages/db`** — the `0030` migration (§6): the `working_order_status` `placed` value + rewritten
  `enforce_transition`; `locations.order_flow`; `order_amendments` (append-only + FORCE-RLS/policy/grants
  + reject_mutation/TRUNCATE-block); `order_prep` (mutable + FORCE-RLS/policy/grants). Plus the Drizzle
  schema: `schema/orders.ts` (enum value; the revised §2 line-price comments; the `enforce_transition`
  note), `schema/tenants.ts` (`locations.order_flow`), new `schema/order-amendments.ts` and
  `schema/order-prep.ts`. An order-amendment append helper (and its hashed-sequence logic) beside the
  existing allocator helpers.
- **`@waitron/core`** — no new fiscal machinery: Ordering 1 is `recordSale` deferred + `settleSale`,
  Ordering 2 is `recordSale` immediate, all extant. Any new domain error codes (e.g. an amendment or a
  place-state refusal) **name the domain concept**, import their registry (`import "./errors.js"`), and
  are grepped against siblings first — reuse `working_order.*` / `sale.*` where one fits rather than
  minting a new prefix (`CLAUDE.md` §3; codes never renamed once shipped).
- **`apps/server/src`** — `till-sale.ts` (`payWorkingOrder` files from locked lines, §2; the config
  dispatch across the three modes, §3); `working-order.ts` (line-lock semantics now authoritative; the
  amendment-log append at placing; the prep-advance operations); `till-api.ts` (a `place` / send-to-prep
  route, prep-advance routes, an amendment route); `till-config.ts` (read the location's `order_flow`);
  a demo-script extension covering place → prep → collect across the three modes.
- **`packages/reporting`** — no code change; a test pinning the Mode-I cutover split (§7).
- **`apps/till/src`** — a **Place / send-to-prep** control, a **prep-queue** widget (its `layout.ts`
  `WidgetType` + screen switch, the held-list widget's seam), the amendment capture (reason + actor) on a
  post-placing edit, and the pay control's per-mode behaviour (pay-at-order vs pay-at-collect); new i18n
  keys (`en` + `es` together).

---

## 11. Provenance

| Claim | Source (read 2026-08-06) |
| --- | --- |
| 7b decided a parked order **re-prices at PAY at current catalogue prices**; the stored line price was a display cache | `2026-08-05-counter-pos-park-retrieve-and-card-design.md` §2, §4 |
| The re-price-at-pay code is `payWorkingOrder`'s retrieved-order else-branch; the walk-up branch already files from the freshly-locked price | `apps/server/src/till-sale.ts:194-209` (walk-up `:195-196`, else `:197-208`) |
| `working_order_lines` stores net `unit_price` + gross `line_total` as a "display cache"; the filed line comes from `priced.lines` | `packages/db/src/schema/orders.ts:98-136`; `apps/server/src/working-order.ts:76-83` |
| `priceBasket` derives base/desglose from the **gross** unit price by the difference method (`tax = gross − base`) | `packages/catalogue/src/pricing.ts:21,54-113` |
| A test pins re-price-at-pay: parks café, pays café+agua, "re-prices what is SENT, not the stored draft" | `apps/server/src/working-order.rls.test.ts:332-361` (comment `:337`, assertion `:354`) |
| The difference-method desglose (base 4.55 / tax 0.95, not 0.96) is pinned on replay | `apps/server/src/working-order.rls.test.ts:363-378` |
| `recordSale` takes `settlement: { kind: "immediate"; tenders } | { kind: "deferred" }`; deferred files the invoice with no payment | `packages/core/src/record-sale.ts:120,336`; `2026-08-03-invoice-first-settlement-design.md` §0 |
| `settleSale` / `listOutstandingSales` close and surface deferred sales | `2026-08-03-invoice-first-settlement-design.md` §2-§3 |
| `sales_working_order_id_key` = one sale per order (idempotency); `sale_settlements` UNIQUE = one settle per sale | `packages/db/src/schema/sales.ts:193-196,303`; `packages/db/drizzle/0029_park_retrieve.sql` |
| `working_order_status` = open/settled/abandoned; `enforce_transition` rejects any update of a non-open row; `require_open_parent`; `settled_at` biconditional | `packages/db/src/schema/orders.ts:25,91-94`; `packages/db/drizzle/0004_working_orders.sql` |
| `locations` carries `fiscal_territory` / `time_zone` / `day_cutover` (#57) | `packages/db/src/schema/tenants.ts:71,77,78` |
| `computeDailyClose`: VAT issuance-anchored, cash-up settlement-anchored | `packages/reporting/src/daily-close.ts:9-10` |
| Amendment tamper-evidence pattern (reason + actor + capturing till, hashed) + the #52 fixes (local wall-clock; hash the reason/actor/till; tie-break on hashed sequence) | `packages/workforce/src/clocking.ts:643-679`; `docs/backlog.md:292` |
| Q14 / precuenta unconfirmed; the amendment log rides 7c deliberately | `docs/backlog.md:204,261-262,288`; park-retrieve §6 |
| FORCE-RLS / policy / grant idiom for a new tenant-scoped table; the `inmutabilidad` guard catches a missing FORCE | `packages/db/drizzle/0027_light_smiling_tiger.sql`, `0029_park_retrieve.sql`; `packages/fiscal-verifactu/src/inmutabilidad.test.ts`; `CLAUDE.md` §3 |
| `packages/db` is `english-only`-scanned; `apps/*` out of scope | `packages/db/src/english-only.ts:8,29-42` |
| Highest migration is `0029`; new work is `0030` | `packages/db/drizzle/`, listed |
| No backfill / data migration — pre-production | `CLAUDE.md` §3 |
