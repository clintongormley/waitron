# Counter POS — integrated card terminal (Stripe first) — design

**Date:** 2026-08-06. **Sub-project:** 7 (Counter POS UI), the **integrated card terminal** slice —
driving a real Stripe reader (mode 2a) or Tap-to-Pay / on-device (mode 3) from the till pay flow.
**Status:** designed, awaiting plan.

This is the next **card** slice after the manual (unintegrated) card tender that landed as **#62**
(the *datáfono* case). #62 recorded a card the operator ran on a **separate** terminal; this slice
drives the card **from** the till: `provider.collect` talks to a reader over the network, polls it to
a terminal outcome, and settles the sale on capture. The backlog names it as the next card slice:
sub-project 7's remaining card work is "the **integrated card terminal** (Stripe Terminal / SumUp —
network capture, timed-out-card UX, hardware)".

**The card is the payment METHOD; it is orthogonal to WHEN the simplified invoice issues.** The
per-location **pay-timing** model (which of two issuance orderings a venue uses) and the placing /
price-lock model are the **7c "prepare & collect" foundation**, designed concurrently at
[`docs/superpowers/specs/2026-08-06-counter-pos-prepare-collect-design.md`](2026-08-06-counter-pos-prepare-collect-design.md)
(not yet present as this is written — referenced by path, and its foundation described in §2 below).
This slice makes a real card work at **both** orderings and does **not** re-specify the foundation.

**No fiscal machinery is reimplemented.** As in 7a/7b/#62, the till is a face on proven code: the
fiscal chain, the immutable `sales`/`registros_facturacion`, and the `payments` ledger are untouched.
The two Stripe `PaymentProvider` adapters already exist in `packages/payments-stripe`
(`StripeTerminalProvider`, `StripeOnDeviceProvider`); this slice is **wiring + one genuinely-new
guard** (capture idempotency), not new payment machinery — with one required change to the providers'
Stripe idempotency key (§4, flagged).

---

## 1. Scope

### The #7 roadmap this sits in

| Slice | What | State |
| --- | --- | --- |
| 7a | Walk-up cash sale | merged (#60) |
| 7b | Park & retrieve + sale idempotency | merged (#61) |
| card | **Manual** card tender (datáfono) | merged (#62) |
| 7c | **Prepare & collect** — placing/price-lock, per-location pay-timing (the two orderings), send-to-kitchen/KDS, the amendment log | designed concurrently (foundation this consumes) |
| **card-integrated** | **Integrated card terminal** (Stripe reader / Tap-to-Pay) — **this spec** | designed |
| — | Offline store-and-forward driver · scale + printer hardware · refunds/voids/corrections UI · on-device tip prompt · SumUp provider · layout & receipt editors | future |

### In scope

- **Drive a real Stripe reader / Tap-to-Pay from the till pay flow.** The server calls
  `provider.collect` (a network step, **outside** the fiscal transaction), which polls the reader to
  a terminal outcome, and settles the sale **on capture**. Works at **both** pay-timing orderings
  (§3).
- **The split-transaction pay flow** — the crux. Cash/manual-card commit in one transaction because
  there is no network call; an integrated capture must sit **between** fiscal transaction boundaries
  (§3).
- **Capture idempotency** — the genuinely-new hard part: a lost-response retry must **not**
  double-charge (§4). Extends 7b's `working_order_id` sale-idempotency guard from the double-**file**
  to the double-**capture**.
- **Per-node provider selection** — a config knob choosing which adapter the node drives (reader vs
  Tap-to-Pay), resolved at boot like the other `WAITRON_TILL_*` values (§5). No provider-authoring UI.
- **Offline** — reuse the existing per-tenant policy; it **only bites for Tap-to-Pay** (mode 3). A
  server-driven reader has no offline path (§6).
- **Tips** — a per-node flag; first slice = **till-entered** tip added to the charged amount and
  recorded on `tenders.tip_amount` (§7).
- **The timed-out-card UX** — retry / switch tender / wait, driven by the provider's *outcome-as-data*
  contract (§8). This is the backlog's "#33 SIF follow-up: till UX for the timed-out card case".

### Out of scope (each has a named home)

- **The pay-timing / placing / price-lock model** and which ordering a location uses → **7c
  foundation** ([`2026-08-06-counter-pos-prepare-collect-design.md`](2026-08-06-counter-pos-prepare-collect-design.md)).
  This slice **consumes** it; it does not define it.
- **Split tender** (part cash, part card in one sale) → deferred, as in 7b (`sales.ts` already
  supports several `tenders` rows per sale). One tender per sale here.
- **On-device tip prompt** (the card machine asking for a tip) → later provider extension. The
  providers' `collect` has **no tip-prompt path** today (verified: `StripeClient.createPaymentIntent`
  and `StripeDeviceClient.collectOnDevice` take `amount` only — `client.ts:9-13`,
  `device-client.ts:22-27`). First slice is till-entered only (§7).
- **Integrated refunds / voids UI** → the refunds/voids slice. The providers already implement
  `void`/`refund`/`partialRefund` (`provider.ts:198-206`, `device-provider.ts:321-329`); wiring a UI
  onto them is a separate slice.
- **The offline store-and-forward *driver loop*** (a scheduler calling `provider.forward`) → a later
  slice. `forward` exists (`device-provider.ts:227-304`) and nothing calls it yet (its own doc says
  so, `device-provider.ts:248-252`). This slice does not start the drain; it only ensures an
  accepted-offline capture chains its sale immediately (§6).
- **A second vendor (SumUp)** → deferred ([`2026-07-30-sumup-card-present-provider-design.md`](2026-07-30-sumup-card-present-provider-design.md)).
  Stripe first; the `PaymentProvider` seam is what keeps the till code vendor-neutral.
- **A `packages/db` migration** → **none needed** (§10). The `payments` table, its states, and the
  `card` `tender_method` value all exist. Keeping this branch off `packages/db` also keeps it off the
  7c foundation branch's `_journal.json` (§10 parallel plan).

---

## 2. What already exists — the foundation this consumes (do NOT re-spec)

### The two Stripe adapters (`packages/payments-stripe`)

Both implement the shared `PaymentProvider` (`packages/payments/src/provider.ts:113-137`): no method
takes a caller transaction, because every method makes a network call and holding a DB transaction
across a network call is forbidden. Each does its own short-transaction bookkeeping and returns a
`PaymentResult` as **data**.

- **`StripeTerminalProvider`** (mode 2a — server-driven fixed-counter reader, `provider.ts`).
  `collect` commits an `attempting` row **before** the network (`insertAttempting`, T1,
  `provider.ts:107-115`), drives the reader **outside any transaction** (`drive`,
  `provider.ts:117-118, 151-181`), polls to a terminal outcome, then persists it in T2
  (`captureAttempting`/`failAttempting`, `provider.ts:121-125`). A timeout or decline is **DATA**, not
  a throw: `drive` returns `{ captured: false }` and T2 writes a `failed` row (`provider.ts:165-180`).
  `stripe.collect_timeout` is **declared but never thrown** (`provider.ts:172-174`; the code stays in
  `errors.ts:9` "for a future incident", `provider.ts:51-52`). `forward` is a **deliberate no-op** — a
  server-driven reader has no device-local offline queue (`provider.ts:135-142`).
- **`StripeOnDeviceProvider`** (mode 3 — Tap-to-Pay / handheld, `device-provider.ts`). `collect`
  applies the neutral offline gate **up front** (`getPaymentPolicy` + `resolveOfflineDecision`,
  `device-provider.ts:145-150`), then the device owns the PaymentIntent and the offline queue
  locally, so the row is written **after** the money moves (`device-provider.ts:207-224`) — the reason
  it stamps `working_order_id`/`payment_ref` onto the PaymentIntent metadata (`device-provider.ts:162`).
  `collect` resolves to `captured`, `declined` (failed row), `accepted_offline` (chains immediately),
  or `network_unavailable` (nothing persisted). `forward` drives the device-local offline queue
  (`device-provider.ts:227-304`).

Both are **per-till / per-tenant** objects: the tenant is fixed at construction and a method-supplied
tenant is validated against it (`requireOwnTenant`, throwing `stripe.tenant_mismatch` **before** any
network call — `provider.ts:85-92`, `device-provider.ts:121-128`).

**The #34 lesson these adapters' own doc-comments record (`CLAUDE.md` §4):** PGlite connects as
superuser and **bypasses FORCE ROW LEVEL SECURITY**, so no hermetic suite can show a provider's DB
phases working (or failing) under the real non-superuser `app_user` role. Both adapters shipped a
version that *did not work at all* under a real role, invisibly green on PGlite, until `device.rls.test.ts`
/ `stripe.rls.test.ts` made the adapter itself the subject (`device-provider.ts:49-65`,
`provider.ts:28-36`). **This slice's provider-driving DB behaviour must be shown on real Postgres**
(§9).

### The payment seam (`packages/payments`)

`collect → recordSale → associatePaymentWithSale` is the proven end-to-end seam, atomic between the
sale and its association because `associatePaymentWithSale` runs **in the same transaction** as
`recordSale` (`packages/payments/src/wiring.test.ts:115-151`, and through the real adapter in
`packages/payments-stripe/src/wiring.test.ts:108-157`). `PaymentResult.settledAt` feeds
`RecordSaleTender.settledAt`: non-null on `captured`/`accepted_offline` (the sale chains), null on
`failed`/`network_unavailable` (the tender stays unsettled and `recordSale`/`settleSale` refuse with
`sale.tender_unsettled`) — `provider.ts:63-83` (payments), `record-sale.ts:65-66`.

`payments` (`packages/payments/src/schema/payments.ts`) already carries `working_order_id NOT NULL`
(`:56`) with a composite FK `(tenant_id, working_order_id) → working_orders` (`:101-105`), a nullable
`sale_id` set post-capture (`:59`), `external_ref` for the PaymentIntent id (`:73`), the state enum
including `attempting` (`:27-41`), the idempotency unique `(tenant_id, provider, payment_ref)`
(`:99`), and `payments_working_order_idx` (`:121`). **Everything the capture-idempotency check needs
already exists** — no schema change (§4, §10).

### The pay seam this slice extends (`apps/server`)

`payWorkingOrder` (`apps/server/src/till-sale.ts:138-339`) is today's idempotent pay path. It
files+settles a cash/manual-card tender in **ONE** `withTenant`/`asAppUser` transaction **because
there is no network call** (`till-sale.ts:113-119`): `recordSale` immediate settlement, and for a
card, `recordManualCardPayment` + `associatePaymentWithSale` inline (`till-sale.ts:264-278`), which
"makes NO network call … so it commits inline with the sale — no orphan window" (`manual.ts:36-42`).
The `TillTender` shape is `{ method: "cash" | "card"; amount; externalRef? }` (`till-sale.ts:44-48`);
7b's `working_order_id` + `sales_working_order_id_key` is the double-file guard, with the `23505`
concurrent-replay backstop (`till-sale.ts:120-135, 312-338`).

**The single most important fact for this slice:** that one-transaction structure is exactly what an
integrated capture **cannot** use — the network call must sit between fiscal transaction boundaries
(§3). This slice restructures that seam.

### The 7c pay-timing foundation (described here because the spec is concurrent)

The 7c foundation defines the placing / price-lock model and a **per-location pay-timing config**
selecting one of two issuance orderings. This slice makes a card work at both:

- **Ordering 2 — *issue at pay*** (today's flow, `recordSale` immediate): the total is locked, the
  card is collected, and **on capture** the invoice issues *and* settles.
- **Ordering 1 — *invoice-first*** (#55, `recordSale` deferred → `settleSale` later): the invoice was
  already issued **at placing** (price locked by the immutable `sale_lines`), and the card **settles**
  an already-outstanding invoice.

`recordSale` already supports both via `settlement: { kind: "immediate" | "deferred" }`
(`record-sale.ts:120`); `settleSale` (`settle-sale.ts:22`) is the deferred close-out;
`listOutstandingSales` (`list-outstanding-sales.ts:33`) is the "what is owed" reader. This slice
**references** these; it does not build them.

---

## 3. The atomicity break — the split-transaction flow (the crux)

An integrated capture is a network step that **must** sit between fiscal transaction boundaries.
Cash and manual card commit in one transaction because "did the tender go through?" is answered by
the same transaction that files the sale (park-retrieve §3, `manual.ts:36-42`). A reader capture is
answered **over the network**, so the flow splits into three phases with two commit points, and the
design must be exact about **what is durable at each step**.

The provider's `collect` **polls the reader to completion synchronously within its own call**
(`provider.ts:165-170`), so the till `POST` can **BLOCK** until captured / failed / timeout — no
websockets, no async callback (§8 designs the request/response contract and the long-request UX). The
default poll window is 60 × 1 s (`provider.ts:20-24`).

### Phase structure

| Phase | Transaction | What commits | Durable after |
| --- | --- | --- | --- |
| **P1 — prepare** | tx A (`withTenant`/`asAppUser`) | resolve/replay; for a walk-up, create the `open` working order | the working order exists `open` (nothing filed, no money moved) |
| **P2 — collect** | **none** (network) | the provider's own T1 `attempting` then T2 `captured`/`failed` rows | on capture: money moved, a `captured` `payments` row exists, **no sale yet** |
| **P3 — finalize** | tx B (`withTenant`/`asAppUser`) | the sale/settlement + the payment↔sale association + the order settle | the sale is filed/settled and linked; the order is `settled` |

The whole three-phase sequence runs inside **one** blocking `POST` handler, so the priced basket is
held in memory across all three — filed total **equals** charged total by construction (see
"Pricing" below).

### Ordering 2 — *issue at pay* (immediate)

1. **P1 (tx A).** Lock/resolve the working order `FOR UPDATE` (as `payWorkingOrder` does today,
   `till-sale.ts:151-155`). Already `settled` → **idempotent replay**, return the existing ticket,
   file nothing (`till-sale.ts:159-161`). `abandoned`/non-open → refuse `working_order.not_open`. A
   captured payment already exists for this order (§4 pre-check) → jump to P3 **recovery** (do not
   re-charge). Otherwise price the sent basket; if this is a **walk-up** (no row yet), create it
   `open` with its priced lines (`createOpenOrder`, `till-sale.ts:195-196`) and **commit tx A** — the
   `payments_working_order_fk` requires the `working_orders` row to exist before the provider's
   `insertAttempting` runs (`payments.ts:101-105`). *This is a real divergence from today's flow,
   where a walk-up's order is created **and settled** in one transaction (`till-sale.ts:195-196`); the
   integrated path commits it `open` first, so a declined card simply leaves a parked order the
   operator can retry or discard.*
2. **P2 (collect, no tx).** `provider.collect({ tenantId, tillId, workingOrderId, amount, allowOffline })`
   with `amount = priced.total + tip` (§7). The provider commits T1 then T2 and returns a
   `PaymentResult`.
3. **P3 (tx B), on `captured`.** Re-lock `FOR UPDATE`; already `settled` → replay. `recordSale`
   immediate (`workingOrderId`, `total = priced.total`, `lines`/`vatBreakdown` from the held
   `priced`, one tender `{ method: "card", amount: priced.total + tip, tipAmount: tip, settledAt:
   result.settledAt }`), then `associatePaymentWithSale({ provider, paymentRef: result.paymentRef,
   saleId })`, then settle the order `open → settled` — **all in tx B** (the exact shape of `till-sale.ts:233-286`,
   minus the inline `recordManualCardPayment`). The `23505` unique-violation backstop replays a
   concurrent winner (`till-sale.ts:312-338`).
4. **On `failed` / timeout / `network_unavailable`.** Nothing is filed; the order stays `open`; the
   `POST` returns the outcome as data → the timed-out-card UX (§8).

### Ordering 1 — *invoice-first* (deferred; the riskier one)

The invoice was already issued at placing (deferred `recordSale`), so a `sales` row for this working
order exists, unsettled, with the price locked by its immutable `sale_lines`.

1. **P1.** Resolve the outstanding sale for the order (by `sales.working_order_id`;
   `listOutstandingSales` is the read model, `list-outstanding-sales.ts:33`). `amountDue = total +
   correctionTotal` (net of any rectificativa, `list-outstanding-sales.ts:70-72`). Already settled →
   replay. Captured payment exists (§4) → P3 recovery.
2. **P2.** `provider.collect({ …, amount: amountDue + tip })`.
3. **P3, on `captured`.** `settleSale(saleId, tenders=[{ method: "card", amount: amountDue + tip,
   tipAmount: tip, settledAt }])` + `associatePaymentWithSale({ provider, paymentRef, saleId })`, in
   one tx (`settle-sale.ts:22`). The double-**settle** backstop is `settleSale`'s own
   `sale.already_settled` (the `sale_settlements` UNIQUE / the `WT002` post-settlement trigger,
   `settle-sale.ts:59-73, 132-158`) — the ordering-1 analogue of `sales_working_order_id_key`.
4. **On decline.** Nothing changes — but the invoice **stays OUTSTANDING** (an issued, chained,
   unpaid fiscal record; `listOutstandingSales` still lists it). The customer retries the card or
   switches tender; nothing is re-filed.

**Ordering 1 + a walk-up card is riskier than ordering 2**, and the spec says so plainly: in ordering
2 a decline leaves nothing filed; in ordering 1 a decline leaves an **issued invoice unpaid** in the
immutable chain. The 7c per-location pay-timing config is precisely what picks the safer ordering per
venue — a walk-up counter selects *issue at pay*; a table-service / pay-at-collect venue that wants
the ticket printed at placing accepts the outstanding-invoice risk knowingly.

### Pricing — filed total equals charged total by construction

The basket is priced **once**, in P1, and held in the request handler across P2/P3, so the sale is
filed at exactly the amount the card was charged. The recovery path (a fresh `POST` that finds an
already-captured payment, §4) no longer has that in-memory basket — but under the 7c foundation it
does **not** re-price: it files from the working order's **stored locked lines** (7c's line-add
snapshot, [`2026-08-06-counter-pos-prepare-collect-design.md`](2026-08-06-counter-pos-prepare-collect-design.md)
§2), which equal the amount the card was charged **by construction**, because P1 priced *those same
locked lines*. So the catalogue-drift mismatch an earlier draft of this section worried about
**cannot arise** — the locked price does not move between charge and recovery. The residual guard is
only for genuine corruption (a stored-locked total that somehow disagrees with the captured
`payments.amount`): there the flow must **not** silently file a divergent total — it leaves the
captured payment for reconcile to resolve as a captured-row-with-no-sale (reconcile's existing
*orphan* class, `packages/payments/src/reconcile.ts`), never inventing a fiscal figure (`CLAUDE.md`
§5). The plan pins this; the safe default is "file at the locked total, else leave for reconcile".

---

## 4. Capture idempotency — the genuinely-new hard part

**The risk.** `collect` mints a **fresh** `paymentRef` (`randomUUID`) per call (`provider.ts:103`,
`device-provider.ts:142`). If the till taps Pay, the card is charged, but the **response is lost**
(dropped link, tab reload), a re-tap is a fresh `collect` with a **new** `paymentRef` — so a naive
retry would **double-charge**. 7b's `sales_working_order_id_key` stops the double-**file**, but the
charge happens **before** the sale exists, so the double-file guard does not cover the
double-**capture**. This is the coupling park-retrieve §3 flagged as belonging "only to the integrated
terminal slice … so it builds on this guard rather than reinventing a weaker one" (park-retrieve
`§3`, lines 157-163).

Two layers close it — a DB pre-check and a Stripe idempotency key — with the working-order lock
serialising the common case.

### Layer 1 — the pre-check (server, before driving the reader)

Before P2, the flow checks whether this working order **already has a captured payment**:

```sql
SELECT id, sale_id, state
FROM payments
WHERE tenant_id = $1 AND provider = $2       -- the configured integrated provider ('stripe')
  AND working_order_id = $3
  AND state IN ('captured', 'accepted_offline')
LIMIT 1
```

(A new read-only helper in `packages/payments`, e.g. `findCapturedPaymentForWorkingOrder(tx, key)`;
uses the existing `payments_working_order_idx`, no schema change.) The three outcomes:

- **No captured row** → proceed to P2 (collect). This is the normal first attempt, and also a retry
  after a genuine **decline** (a `failed` row is not `captured`, so a legitimately-declined card is
  re-chargeable — the operator retries).
- **A captured row with `sale_id = NULL`** → the "collect committed, P3 never ran" window. **Do NOT
  re-charge.** Resume at P3 using that payment (its `paymentRef`, its `amount`).
- **A captured row already associated (`sale_id` set)** → the sale is filed; the order should be
  `settled` and the earlier replay branch already returned. Reaching here is corruption-shaped — treat
  as replay (read the settled ticket), never re-charge.

This extends 7b's guard from the double-file to the double-capture, keyed on the **same** stable
`working_order_id` the client mints once per basket and holds across retries (7b, `till-sale.ts:57-63`).

### Layer 2 — the Stripe idempotency key derived from the working-order id (**provider change, flagged**)

The pre-check + the `FOR UPDATE` lock cover the sequential retry and a parked-order concurrent pay,
but they are **not atomic across the network**: a response can be lost in the sub-window where the
card has been charged but the provider's T2 `captured` row has not yet committed. The backstop is the
**Stripe PaymentIntent-creation idempotency key**, which must be **derived from the working-order id**
(stable across retries) so a second `createPaymentIntent` returns the **same** PaymentIntent and
Stripe charges once.

> **The code contradicts this decision today, and it must change.** `StripeTerminalProvider` passes
> `idempotencyKey: paymentRef` (the *random* per-call ref) to `createPaymentIntent`
> (`provider.ts:103, 160-161`); `StripeOnDeviceProvider` does the same
> (`device-provider.ts:142, 155`). With a random key, two attempts create **two** PaymentIntents →
> two charges. The change: derive the PaymentIntent-creation idempotency key from
> `params.workingOrderId` (`CollectParams` already carries it, `provider.ts:52-53` payments),
> **decoupled** from the local `paymentRef`. The local `paymentRef` stays random (it is the
> `payments` row's idempotency anchor, one row per attempt); the Stripe key becomes stable. One
> PaymentIntent per working order is the Stripe-recommended pattern and is exactly right here: a
> reader retried after a timeout re-drives the **same** PI to completion, and the customer is charged
> once.

**Residue this leaves, and who cleans it.** In the lost-T2 sub-window, the crashed attempt leaves an
orphaned `attempting` row (T1 committed, T2 never), and the successful retry writes its own `captured`
row against the **same** PaymentIntent id in `external_ref`. That stray `attempting` row is
reconcile's to resolve — the same T1/T2 recoverable-row story the providers already document
(`provider.ts:176-177`), and the reason the pre-check keys on `state = 'captured'`, never
`attempting`.

**Why this is not over-built.** Three independent mechanisms, each covering what the others cannot:
the `FOR UPDATE` lock (concurrent pays on a parked order), the pre-check (sequential retry after a
committed capture), and the Stripe idempotency key (the network sub-window the lock cannot span). None
alone is sufficient; together they make a double-charge unreachable.

---

## 5. Provider selection — a per-node config knob

Today the till drives **no** `PaymentProvider`: `TillConfig` (`till-config.ts:19-27`),
`TillSaleDeps` (`till-sale.ts:31-35`), and `TillApiDeps` (`till-api.ts:40-46`) carry none, and `boot`
constructs only the `StripeReconciler` (the background audit), never a till-facing provider
(`boot.ts:126-135`). This slice adds the wiring.

**Resolve at boot, like the other `WAITRON_TILL_*` values** (`till-config.ts:62-82`). A new per-node
knob — provisionally `WAITRON_TILL_CARD_PROVIDER ∈ { none, stripe_terminal, stripe_on_device }`,
default `none` (cash + manual card only, exactly #62's behaviour):

- `none` — no integrated provider; the card button is the manual-card path (#62), unchanged.
- `stripe_terminal` — construct a `StripeTerminalProvider` (mode 2a). Needs the reader id, resolved
  via the provider's `resolveReader(tenantId, tillId)` hook (`provider.ts:43`) — from a per-till env
  value (e.g. `WAITRON_TILL_STRIPE_READER_ID`) or a small lookup.
- `stripe_on_device` — construct a `StripeOnDeviceProvider` (mode 3); the device mints its own
  connection token via `connectionToken()` (`device-provider.ts:101`).

The Stripe API key is resolved **per tenant** from the `payments.stripe` credential through the key
ring, exactly as the reconciler's `stripeAccountResolver` does (`apps/server/src/stripe-account.ts`),
with the same environment-prefix guard (`sk_live_` ⇒ production, `sk_test_` ⇒ preproduction). The
chosen provider is injected into `TillSaleDeps`/`TillApiDeps` at boot.

**Config errors reuse the existing till-config codes.** A missing/empty `WAITRON_TILL_CARD_*` value
uses `server.till_config_missing`, a malformed one `server.till_config_invalid` — the exact codes
`loadTillConfig` already raises for the fiscal ids (`till-config.ts:35-55`), grep-checked against
their siblings (§3 of `CLAUDE.md`: grep the siblings before asserting a convention). No new config
code is invented.

**No provider-authoring UI** and no `packages/db` migration for this: prefer the env-based per-node
knob (consistent with `WAITRON_TILL_*`). If a DB-backed provider config is ever wanted, it lives in
`packages/payments` (beside `payment_policy`), **never** `packages/db` — that keeps this branch off
the 7c foundation branch's migration journal (§10).

---

## 6. Offline — configurable, but it only bites for Tap-to-Pay

Reuse the existing per-tenant policy `getPaymentPolicy` / `resolveOfflineDecision`
(`packages/payments/src/policy.ts:16-48`, keyed on `tenant_id`, `payment-policy.ts:16`) — three
independent gates (staff consent, tenant `accept_offline`, amount ≤ cap), fail-safe to refuse.

Be precise about which mode has an offline path:

- **Mode 3 (Tap-to-Pay)** has the device-local offline queue. `collect` applies the gate up front and
  can return `accepted_offline` (the sale chains immediately — `settledAt` is set, so P3 proceeds and
  files the sale) or `network_unavailable` (nothing persisted; the till shows a switch-tender state
  §8). `forward` later clears the queue — but **this slice does not start the forward loop** (out of
  scope §1); it only ensures an accepted-offline capture chains its sale.
- **Mode 2a (server-driven reader)** has **NO** offline path. `forward` is a deliberate no-op
  (`provider.ts:135-142`), and a network failure surfaces simply as a **failed** capture → the
  timed-out UX. **Do not claim offline for the reader** — "network down" on a reader is just a failed
  capture, never a stored-offline acceptance.

The till only surfaces the offline-consent affordance (and passes `allowOffline`) when the configured
provider is `stripe_on_device`; for a reader it is meaningless.

---

## 7. Tips — configurable, first slice is till-entered

A per-node flag (provisionally `WAITRON_TILL_TIPS`, default off):

- **Off** — the card is charged the **exact total**, identical to #62: the tender is `{ amount: total,
  tipAmount: "0.00" }` (`till-sale.ts:253` currently hardcodes `"0.00"`).
- **On** — the operator keys a tip on the till; it is **added to the charged amount** and recorded on
  `tenders.tip_amount`. The tender becomes `{ amount: total + tip, tipAmount: tip }`, satisfying
  `settleSale`'s coverage identity `sum(amount) = total + Σtip` and the `tip_amount ≤ amount` rule
  (`record-sale.ts:56-67`, `settle-sale.ts:84-100`). The provider is told the **gross** charge
  (`amount = total + tip`); it does not know the split.

The **tip never reaches the fiscal record**: `recordSale`/`settleSale` hand the backend only the sale
`total` (ex-tip), so it never enters the huella — the Q13 structural absence confirmed on primary
source (#37; backlog Q13). An **on-device tip prompt** (the machine asking) is a later provider
extension — `collect` has no tip-prompt path today (§1, verified).

**The #37 accounting duty (note, not this slice's code):** a card-collected tip **is business income**
— *ingreso* for the Impuesto sobre Sociedades and *rendimiento* for IRPF (backlog, "Card-collected
tips are business income", lines 299-300). That is an **accounting / payroll** matter, **not fiscal**:
it does not touch the factura or the huella. Flagged so the payroll track (sub-project workforce)
picks it up; nothing here files it.

---

## 8. The timed-out-card UX and the `till-api` contract

The provider returns timeout / decline / offline-refused as **data, never a throw** (§2), so the
server surfaces a **clean outcome** rather than an error. This is the backlog's "Till UX for the
timed-out card case (retry / alternative tender / wait)" (backlog line 148).

### The request/response contract

A blocking `POST` (extend `POST /api/sales`, or a dedicated `POST /api/pay`, for a card whose
configured provider is integrated). The handler runs P1→P2→P3 and **blocks** through the reader poll.
Because a payment outcome is **neither a client fault (4xx) nor a server fault (5xx)**, the route does
**not** go through `run`'s AppError→4xx / else→500 mapping (`till-api.ts:87-99`) for the non-captured
outcomes; it answers **200** with a discriminated result:

```ts
{ outcome: "captured", ticket: TillSaleResult }          // filed/settled + linked
{ outcome: "declined" }                                   // failed capture — retry or switch tender
{ outcome: "timeout" }                                    // reader stalled past the poll window
{ outcome: "network_unavailable" }                        // mode 3, offline refused
```

Genuine faults still throw and map as today (an empty basket → `sale.empty_basket` 400, a server
fault → `server.internal` 500). This 200-with-outcome shape is a deliberate divergence from the cash
route's throw-or-ticket shape, and the plan states it in a comment.

### The till states

`tender-pay.ts` today has an idle→paying/card→idle mode machine and a `busy` flag that disables Pay /
Card / Confirm while a sale is in flight (`tender-pay.ts:36, 128-137, 317-353`). The card view already
exists (`#renderCard`, `:374-406`). This slice adds, for the integrated provider:

- a **collecting** state (spinner + "Tap / insert card"), entered while the `POST` is in flight;
- a **Cancel** affordance on the collecting state. **The provider has no `cancel` method** (the
  `PaymentProvider` interface is `collect`/`forward`/`void`/`refund`/`partialRefund` only,
  `provider.ts:113-137` payments), so a true server-side reader-cancel is **not available today**.
  Cancel is therefore a **client-side abort** (the operator stops waiting): the reader poll continues
  server-side to its terminal outcome, and any subsequent retry **replays** rather than re-charges —
  which is safe precisely because of the §4 capture-idempotency guard. A server-side reader-cancel
  endpoint is a **deferred provider extension** (needs a new `cancel` method), flagged here.
- a **timed-out / declined** state offering three actions: **retry the card** (re-`POST`, replays via
  §4 if the earlier attempt actually captured), **switch to an alternative tender** (cash or manual
  card — the #62 path, so the shop can still trade, §9), or **wait**.

---

## 9. Fiscal invariants this slice honours (`CLAUDE.md` §5)

- **Nothing may block a sale on anything but the sale itself.** A card outage must not stop the shop
  trading: the timed-out-card UX always offers **cash or manual card** as the fallback (§8), and those
  paths are #62/#60, network-free. The blocking `POST` is acceptable because the reader capture **is**
  this card sale's own tender — but a *reader being down* never blocks the venue, because an
  alternative tender is one tap away.
- **Fiscal submission stays an outbox, never inline.** `recordSale` chains and queues to AEAT via the
  `envios` outbox regardless of settlement; the `drain` loop submits (`boot.ts:248-309`). This slice
  adds a network step for the **card capture**, never for AEAT.
- **`sales`/`registros_facturacion` immutable.** P3 only **inserts** — a `sales` row (ordering 2) or a
  `sale_settlements` row (ordering 1), both append-only. The mutable, module-owned `payments` row is
  where the capture and the association live (`payments.ts:43-50`). `working_order_id` is written once
  and never enters a huella (7b).

---

## 10. Migration lane, error codes, and the parallel plan

### No `packages/db` migration

Verified: the `payments` table, its state enum (incl. `attempting`/`accepted_offline`), the composite
FKs, the `payments_working_order_idx`, and the `card` `tender_method` value **all already exist**
(`packages/payments/src/schema/payments.ts`; `card` shipped with #60/#62). The capture-idempotency
check is a **read** over existing columns. So there is **no `packages/db` migration** — which is also
what keeps this branch off the 7c foundation branch's `packages/db/drizzle/meta/_journal.json`
(park-retrieve §7's collision-avoidance pattern). If a per-node provider-config *row* is ever needed,
it is a `packages/payments` migration (its own journal), never `packages/db`.

### Error codes — REUSE, do not invent (§3 of `CLAUDE.md`)

Every code this slice needs already exists. Grepped against siblings; **no new codes proposed.**

| Reused code | Where declared | Used for |
| --- | --- | --- |
| `stripe.tenant_mismatch` | `packages/payments-stripe/src/errors.ts:18` | host wiring error, thrown before any network call |
| `stripe.collect_timeout` | `packages/payments-stripe/src/errors.ts:9` | **declared, not thrown** — a timeout is a `failed` `PaymentResult` (data), surfaced as the `timeout` outcome (§8); the code stays for a future incident |
| `payment.not_found` | `packages/payments/src/errors.ts:47` | `captureAttempting`/`failAttempting`/`associate` when a ref names no row |
| `payment.already_associated` | `packages/payments/src/errors.ts:66` | the write-once association backstop |
| `sale.unsupported_tender` | `apps/server/src/errors.ts:226` (the till-request `sale.*` codes live in the server app, distinct from the fiscal `sale.*` in `packages/core/src/errors.ts`) | refuse `voucher`/`transfer`/`other` (unchanged) |
| `sale.already_settled` | `packages/core/src/errors.ts:165` | ordering-1 double-**settle** backstop (`settleSale`) |
| `sale.tender_shortfall` | `packages/core/src/errors.ts:108` | coverage identity failure |
| `sale.tender_unsettled` | `packages/core/src/errors.ts:95` | a `failed`/`network_unavailable` tender is unsettled — sale refused |
| `working_order.not_open` / `working_order.not_found` | declared `apps/server/src/errors.ts:283, 261`; HTTP-mapped in `till-api.ts:72-73` | order-state refusals |
| `server.till_config_missing` / `server.till_config_invalid` | `apps/server/src/errors.ts:42-58` | the new `WAITRON_TILL_CARD_*` config vars (§5) |

The non-captured outcomes (`declined`/`timeout`/`network_unavailable`) are **result data**, not error
codes (§8) — they need no `AppError`. If the plan discovers a genuinely new domain concept, it must
name the **domain concept** (never the vendor/package), import its registry, and grep the siblings
first — but the recommendation is **reuse only**, and in particular **not** to invent a parallel
`stripe.*`/`payment.*` code beside a shipped one (codes are never renamed once shipped, `CLAUDE.md`
§3).

### The shared seam is a MERGE concern; the parallel plan

Both this branch and the **7c foundation** touch the same seam — `till-sale.ts`
(`payWorkingOrder`/tender+settlement), `till-api.ts` (routes), `tender-pay.ts` (the pay widget). 7c
restructures the pay flow for pay-timing (placing, the two orderings); this slice restructures it for
the split-transaction capture. That is a **merge** concern, resolved by ordering:

- **The 7c foundation lands first** (it owns any `packages/db` migration and the pay-timing model).
- **This branch rebases onto 7c** before merge (park-retrieve §7's pattern), taking the small rebase
  on the shared seam (the tender/settlement block and the widget). Because this branch adds **no
  `packages/db` migration**, there is no `_journal.json` collision.
- **One implementation plan** for this branch, executed after 7c is available to rebase onto.

---

## 11. Testing

**Real Postgres for anything about the provider's DB phases under the non-superuser role, and for
concurrency** — PGlite connects as superuser (bypassing FORCE RLS) and serialises every query onto
one backend, so both a privilege test and a concurrency test are **false passes** there (`CLAUDE.md`
§4; the #34 lesson the adapters' own doc-comments record, §2):

- **The split-transaction flow, both orderings** — P1→P2→P3 files/settles + links on capture; a
  `failed`/`timeout`/`network_unavailable` files nothing and leaves the order `open`. Drive the
  reader with the deterministic `FakeStripe`/`FakeStripeDevice` (the wiring-test pattern,
  `packages/payments-stripe/src/wiring.test.ts`); the sale/settlement DB work runs as `app_user`.
- **Capture idempotency (concurrency, real target only)** — two pays for one working order in
  separate connections yield **one** charge and **one** sale/settlement; the second is a replay, not
  a second capture. **Prove the guard by deletion** (`CLAUDE.md` §4): remove the §4 pre-check (or
  revert the Stripe key to random) and watch a double-capture appear; a negative control confirms the
  failure is for the claimed reason.
- **The lost-T2 recovery window** — a captured payment with `sale_id = NULL` on an `open` order is
  finalized by a retry without re-charging (Layer 1), and the stray `attempting` row is left for
  reconcile (§4).
- **RLS / tenant isolation** — the provider's `insertAttempting`/`captureAttempting`/`associate`
  writes are scoped to the till's tenant; another tenant's order/payment is invisible (proven by
  deletion). The adapters' own `stripe.rls.test.ts`/`device.rls.test.ts` already cover the provider
  in isolation; this slice covers the **till path** driving it.

**Lighter targets where the heavy justification does not apply (stated in a comment):**

- Outcome mapping (`captured`→ticket, `declined`/`timeout`/`network_unavailable`→the discriminated
  result) — pure request/response shaping.
- Provider selection from `WAITRON_TILL_CARD_PROVIDER` and the config-error codes (mirrors
  `till-config.test.ts`).
- Tips arithmetic (`amount = total + tip`, `tipAmount = tip`, tip absent from the fiscal `total`).
- The `tender-pay` state machine (idle→collecting→timed-out; the client-abort Cancel) — a UI unit
  test (`tender-pay.test.ts` pattern).

**The real reader / Tap-to-Pay** is exercised only by the nightly, self-skipping sandbox suites
against Stripe test mode (`collect.sandbox.test.ts` and siblings; skip with no `STRIPE_SECRET_KEY`,
`collect.sandbox.test.ts:16-23`). Those are the only evidence the *real* SDK binding drives a real
reader; extend them for the derived-idempotency-key behaviour.

**Gate.** This touches `packages/payments-stripe` (the idempotency-key change + tests),
`packages/payments` (the new read helper), and `apps/server` (the seam + config). Run each package's
`test:coverage` unfiltered so the cross-cutting guards load, and run
`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` is **not** required here (no new
`tenant_id`-bearing table — §10). Thresholds stay `98/98/98/95` (`packages/ui` `95/95/90/88`).

---

## 12. Files (indicative, for the plan to firm up)

- **`packages/payments-stripe`** — derive the PaymentIntent-creation idempotency key from
  `params.workingOrderId` in `StripeTerminalProvider` (`provider.ts:160-161`) and
  `StripeOnDeviceProvider` (`device-provider.ts:155`), decoupled from the random `paymentRef` (§4);
  extend the sandbox suites for it.
- **`packages/payments`** — a read-only `findCapturedPaymentForWorkingOrder(tx, { tenantId, provider,
  workingOrderId })` helper (§4), over existing columns/indexes; no schema.
- **`apps/server/src`** — restructure the pay path into P1/P2/P3 (`till-sale.ts`), driving the
  injected `PaymentProvider`; the blocking pay route + the 200-with-outcome contract (`till-api.ts`);
  per-node provider selection + tips flag in config/boot (`till-config.ts`, `config.ts`, `boot.ts`,
  injecting the provider into `TillSaleDeps`/`TillApiDeps`); a `demo:` extension driving `FakeStripe`
  through a capture. Any new domain error code names the concept, imports its registry, and is
  grep-checked first — but §10 recommends none.
- **`apps/till/src`** — the collecting/spinner state, the client-abort Cancel, and the
  timed-out/declined state offering retry / switch-tender / wait (`tender-pay.ts`); the offline-consent
  affordance shown only for `stripe_on_device` (§6); the tip entry shown only when tips are on (§7);
  new i18n keys (`en` + `es` together); the API client's result-shape union.

---

## 13. Deferred homes (YAGNI)

| Deferred | Home |
| --- | --- |
| Split tender (part cash, part card) | later slice; `tenders` already supports it |
| On-device tip prompt (the machine asks) | later provider extension (`collect` has no tip path) |
| Provider-authoring / management UI | out — config is env-based per node |
| Integrated refund / void UI | the refunds/voids slice (providers already implement the methods) |
| Server-side reader **cancel** | needs a new `PaymentProvider.cancel` method; Cancel is client-abort for now (§8) |
| The offline **forward** driver loop | later slice (`forward` exists, nothing calls it) |
| SumUp (second vendor) | [`2026-07-30-sumup-card-present-provider-design.md`](2026-07-30-sumup-card-present-provider-design.md) |

---

## 14. Provenance

| Claim | Source (read 2026-08-06) |
| --- | --- |
| Terminal `collect` commits `attempting` before the network, drives the reader outside any tx, resolves timeout/decline as data (never throws), `forward` is a no-op | `packages/payments-stripe/src/provider.ts:100-181, 135-142` |
| Terminal & on-device `collect` use `idempotencyKey: paymentRef` (random) for `createPaymentIntent` / `collectOnDevice` | `provider.ts:103, 160-161`; `device-provider.ts:142, 155` |
| `stripe.collect_timeout` declared but not thrown; `stripe.tenant_mismatch` thrown pre-network | `provider.ts:51-52, 85-92, 172-174`; `packages/payments-stripe/src/errors.ts:9, 18` |
| On-device `collect` has the offline gate + `accepted_offline`/`network_unavailable`; `forward` drives the queue; nothing calls it yet | `device-provider.ts:137-150, 173-224, 227-304, 248-252` |
| `PaymentProvider` has no `cancel`; no method takes a caller tx; `PaymentResult.settledAt` feeds the tender | `packages/payments/src/provider.ts:98-137, 63-83` |
| `payments` carries `working_order_id NOT NULL` + composite FK, nullable `sale_id`, `attempting` state, provider-ref UNIQUE, working-order index; `card` `tender_method` exists | `packages/payments/src/schema/payments.ts:27-41, 56-128`; #62 backlog row |
| Today's pay path files+settles a card in one tx because there is no network call; `recordManualCardPayment` is inline/atomic | `apps/server/src/till-sale.ts:113-119, 233-286`; `packages/payments/src/manual.ts:36-42` |
| The till drives no provider today; boot builds only the reconciler | `till-config.ts:19-27`; `till-sale.ts:31-35`; `till-api.ts:40-46`; `boot.ts:126-135, 166-176` |
| Stripe creds resolve per tenant from `payments.stripe` with an env-prefix guard | `apps/server/src/stripe-account.ts:1-40` |
| `recordSale` immediate/deferred; `settleSale` closes deferred; `listOutstandingSales` + `amountDue = total + correctionTotal` | `record-sale.ts:112-124`; `settle-sale.ts:22`; `list-outstanding-sales.ts:33, 70-72` |
| Card-collected tip is business income (IS ingreso + IRPF), not fiscal; the tip never enters the huella (Q13) | backlog lines 202, 299-300 (#37) |
| Idempotency coupling belongs to the integrated terminal, to build on 7b's guard | park-retrieve design §3, lines 157-163; §7, lines 284-307 |
| PGlite is superuser and bypasses FORCE RLS; provider DB behaviour must be shown on real Postgres | `CLAUDE.md` §4; `provider.ts:28-36`; `device-provider.ts:49-65` |
