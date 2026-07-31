# Payment layer (capture modes: manual · sync-integrated · async) — Design

**Date:** 2026-07-22 · **revised 2026-07-23** (added the capture-mode taxonomy; the former "4a"
landed as PR #20; Mode 1 landed as #21, Mode 2a as #22; Mode 2b sliced into Cycle A / Cycle B) ·
**revised 2026-07-24** (Mode 2b Cycle A landed as PR #23; added the Mode 2b — Cycle B design section)
**Status:** Living design — 4a seam + Mode 1 (manual) + Mode 2a (Stripe Terminal) + Mode 2b Cycle A
(provider-neutral offline store-and-forward) shipped (#20/#21/#22/#23);
**Mode 2b — Cycle B (the real on-device Stripe binding + `forward` joining the interface) is the next plan**
**Covers:** Architecture sub-project 4 (the payment layer) — the money-movement layer that sits
*before* the sale/fiscal write path and turns "customer pays" into a settled tender. Organized around
a **taxonomy of capture modes** (next section): manual/unintegrated, synchronous-integrated, and
asynchronous-integrated. A provider-neutral `PaymentProvider` (§3) is the contract for the
*integrated* modes; a Stripe Terminal adapter and offline store-and-forward are two later mechanisms
of one of them, not the whole layer.

**2026-07-23 revision note.** This document was originally written assuming the whole layer was the
integrated `PaymentProvider`. Field reality — merchants running an unintegrated bank datáfono with no
electronic link to the POS, and restaurants running all-in-one handhelds the waiter carries to the
table — showed that is one mode among several. The revision adds the capture-mode taxonomy (a
settlement axis + a mechanism axis), re-contextualizes §§3–9 as the *integrated-mode* detail (still
current; 4a shipped that seam), re-derives the plan sequence (§10), and adds the Mode 1 (manual)
design. Nothing shipped in 4a is invalidated — the taxonomy re-contextualizes the seam, it does not
replace it.

**Scope decision (2026-07-22).** This spec covers the **full** roadmap `PaymentProvider` surface —
`collect`/`authorize`/`capture`/`void`/`refund`/`partialRefund`/`preAuth`/`incrementalAuth`/`tipAdjust`,
plus offline store-and-forward and reconciliation. "Full surface" means full *capability*: every method
is designed, faked and tested in this sub-project. It does **not** mean dead stubs — this is different
from the thing `FiscalBackend` refused ([`packages/fiscal/src/backend.ts`](../../../packages/fiscal/src/backend.ts)),
which was *reserving a method name before its design existed*. `drain`/`reconcile` were built fully
(fake + tests) before any scheduler called them; the tab/tip lifecycle methods here are the same —
real behaviour + fake + tests now, with the till/tab **UI** that consumes them deferred to sub-project
10 (tabs) / 13 (tips).

**Relationship to the other design docs** (not restated here):

- [`2026-07-18-pos-architecture-design.md`](2026-07-18-pos-architecture-design.md) — §2 row 4 is this
  sub-project; §8 sketches `packages/payments`; §1/§12 own the framing ("we are not a payment
  processor; card data never touches our software; the terminal is semi-integrated/P2PE"). §10
  (tipping) constrains `tipAdjust` and the invoice-total-vs-amount-charged separation.
- [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](2026-07-19-sales-spine-and-fiscal-layer-design.md)
  — §4 (tender ordering: *the fiscal record is created when all tenders settle, not per payment*; a
  declined card leaves the order open with nothing chained) and §6 (the `FiscalBackend` boundary this
  design mirrors).
- **The pattern mirrored throughout:** `FiscalBackend` /
  [`packages/fiscal`](../../../packages/fiscal) + `fiscal-verifactu`. A provider-neutral interface in
  a generic English-only package, a concrete vendor adapter behind it, module tables that reference
  core but never the reverse, a `drain`+`reconcile` pair, idempotent incidents, and T1/T2 discipline.
  Wherever this doc is terse, that layer is the worked example.

**Deviation from the architecture doc, recorded so the two don't silently disagree:** §8 wrote
`packages/payments` as a single line ("PaymentProvider interface + stripe-terminal adapter"). This
design splits it into **two** packages (`packages/payments` neutral + `packages/payments-stripe`
adapter), consistent with how the fiscal layer actually shipped (`fiscal` + `fiscal-verifactu`) rather
than how §8 originally sketched it, and for the same reason: the second and third providers (Adyen,
SumUp) must not force an interface change.

---

## 0. The capture-mode taxonomy (2026-07-23 revision)

The original decomposition (§10) implicitly assumed one kind of merchant — the one where **we** drive
the money — so a single `PaymentProvider` was the whole world. That is wrong for the field: many
merchants (especially small Spanish ones) run an **unintegrated bank datáfono** with no electronic
connection to the POS at all, and restaurants increasingly run **all-in-one handhelds** the waiter
carries to the table. Forcing those through `PaymentProvider.collect()` would be a lie. So the layer
is organized around a **taxonomy of capture modes**, not a single interface.

The universal join is unchanged: whatever the mode, it must ultimately produce the one thing the
sales spine needs — a **settled tender** (`method`, `amount`, `settledAt`, optional `externalRef`)
that flows into `recordSale`, after which the fiscal record forms (sales-spine §4). The modes differ
only in *how* that settled tender comes to exist.

### The settlement axis — three modes (what core sees)

1. **Manual / unintegrated.** Staff key the total into a *separate* bank terminal; the POS is told
   nothing electronically and records a **staff-asserted** card tender. Mechanically a sibling of
   cash — no provider, no network, no programmatic reversal — and reconciliation against the bank's
   settlement report is external/manual. This is **not a `PaymentProvider`** (see the Mode 1 design
   section): it is the trivial, provider-less end of the payment layer, and it works for the largest
   set of merchants with zero PSP onboarding.
2. **Synchronous integrated.** We drive a reader and the settled outcome comes **back
   synchronously**; we own void/refund/reconcile programmatically. Exactly what §3's `PaymentProvider`
   models — Stripe Terminal, Adyen Terminal API, Redsys integrated mode, and SumUp are adapters behind
   it.
3. **Asynchronous integrated.** The customer pays **out-of-band** (QR pay-at-table, payment link,
   online order); we *initiate* (mint a link/QR/intent) and the settled tender is written **later by a
   webhook**, not returned. A **different method shape** — `initiate() → { ref, url/qr }` + a webhook
   that produces and associates the tender — not a variant of §3's `collect(): Promise<PaymentResult>`.

### The mechanism axis — how/where collection is orchestrated

A second axis *inside* the integrated modes, behind the **same** seam:

- **2a — server-driven remote reader.** Our *server* tells a networked smart reader to process
  (`readers.processPaymentIntent`); reader and till are separate devices; the server orchestrates. The
  fixed-counter setup (WisePOS E / Reader S700).
- **2b — on-device SDK reader.** Our app runs *on* a handheld and drives the reader **built into that
  same device** via an on-device SDK, then reports the outcome back; till and reader are one unit; the
  *device* orchestrates. The waiter-at-the-table all-in-one (Square Terminal / Clover Flex / SumUp
  Solo / Toast Go / Stripe handheld + Tap-to-Pay). **Offline store-and-forward lives here** — it is a
  property of the on-device SDK, not of the integrated mode in the abstract.

Both 2a and 2b satisfy the **same** neutral `PaymentProvider` contract (a settled tender returned
synchronously; programmatic reversal/reconcile). The seam is defined by the *settlement shape core
sees*, never by the mechanism — so a mechanism is an **adapter + deployment** detail hidden behind the
interface, which is exactly what keeps the §3 seam reusable rather than Stripe-specific.

### How the rest of this document maps onto the taxonomy

§§3–9 are the design of the **integrated modes** (the `PaymentProvider` seam, its store, RLS, refunds,
reconcile, testing) — all still current; 4a shipped the neutral seam and the online happy path of that
surface. The **Mode 1 (manual)** design is new (its own section, after §10), and §10 is re-derived to
sequence the whole taxonomy.

---

## 1. Where the payment layer sits

Payment is **upstream of `recordSale`**. It turns a customer paying into one or more **settled
tenders**, and only when *all* tenders settle does
[`recordSale`](../../../packages/core/src/record-sale.ts) run, allocate the invoice number, write the
sale, and chain the fiscal record. Card data never reaches our code: the terminal (semi-integrated /
P2PE) does the card interaction; our provider talks to the reader/SDK, not to PANs.

The existing [`tenders`](../../../packages/db/src/schema/sales.ts) table in core is a thin,
**immutable** settlement record (`method`, `amount`, `settled_at`), written once inside the sale
transaction. It stays that way. The payment layer owns its **own** mutable lifecycle tables, exactly
as `fiscal-verifactu` owns `envios`/`acks` separate from the immutable `sales`. Core continues to know
nothing about payment providers, payment intents, refunds or forwarding.

**Cash is not a provider concern.** Cash needs no authorize/capture/refund network operation; it is
recorded directly as a `method: 'cash'` tender with `settled_at = now`, never touching the provider.
The provider exists for **electronic** tenders. A consequence: "cash-only when the network is down" is
automatic for a provider with no offline capability — cash simply never reaches the provider.

---

## 2. Package layout, guards & schema ownership

Mirroring the fiscal split exactly.

### `packages/payments` — generic, English-only

- Added to `GENERIC_PACKAGES` in
  [`packages/db/src/english-only.ts`](../../../packages/db/src/english-only.ts) → the Spanish-word
  guard applies. Payment vocabulary is naturally English (there is no Spanish *authority* forcing an
  exemption the way AEAT forces `fiscal-verifactu`), so this costs nothing.
- Carries its own **`no-provider-vocabulary.test.ts`**, structurally cloned from
  [`no-regime-vocabulary.test.ts`](../../../packages/fiscal/src/no-regime-vocabulary.test.ts): it bans
  provider/SDK vocabulary (`stripe`, `adyen`, `sumup`, `paymentintent`, `reader`, `terminal`,
  `connectiontoken`, …) from the neutral seam, so a second provider brings its own vocabulary and
  changes nothing here. Uses the same comment-stripping + camelCase-tokenising `mentionsTerm` helper,
  and the same "the source glob discovers the real files" anti-vacuous-test guard.
- Owns the provider-neutral tables (§7) in its own `src/schema/`, its own `drizzle/` migration
  directory with **English** migration names (`0000_payments.sql`, …), and its own `schema/index.ts`
  barrel that explicitly exports only its tables and **never** re-exports a core table — enforced by a
  `schema-ownership.test.ts` clone, exactly as
  [`fiscal-verifactu/src/schema/index.ts`](../../../packages/fiscal-verifactu/src/schema/index.ts)
  does.

### `packages/payments-stripe` — the adapter

- **In neither `GENERIC_PACKAGES` nor `EXEMPT_PACKAGES`.** The English-only guard scans only
  `GENERIC_PACKAGES`, and the neutral `no-provider-vocabulary` guard scans only `@waitron/payments`
  (a relative glob) — so this adapter names `PaymentIntent`/`Reader`/`ConnectionToken`/`Stripe` freely
  without being added to any list. It has no *Spanish* to exempt (its vocabulary is English), and the
  vendor-vocabulary ban applies only to the neutral seam. (Adding it to `EXEMPT_PACKAGES` would break
  the pinned-list assertions in `english-only.test.ts` + `vocabulary-scope.test.ts` for no benefit.)
  Depends on `@waitron/payments`, `@waitron/db`, `@waitron/shared` and the Stripe SDK.
- Holds `StripeTerminalProvider`. If it needs Stripe-shaped columns of its own it declares them in
  *its* schema/migrations, not the neutral package's (it probably needs none — see §7).

### Dependency direction

Module→core, always. Payment schema files `import` core tables (`workingOrders`, `sales`) to declare
foreign keys but never re-export them. Core never imports `@waitron/payments`.

---

## 3. The `PaymentProvider` interface

Provider-neutral, card-present / terminal-mediated. Field names are indicative; the exact shapes are
pinned in §7.

**This interface is the *integrated-mode* contract** (settlement modes 2 and 3 in §0's taxonomy).
Manual/unintegrated capture (Mode 1) deliberately sits **outside** it — it implements no adapter and
makes no network call (see the Mode 1 design section). And the 2a/2b **mechanism** split lives
*behind* this interface: a server-driven reader and an on-device SDK are two adapters (and two
deployment locations) implementing the same methods, never two interfaces.

```ts
interface PaymentProvider {
  readonly provider: string;                    // opaque id, like FiscalRecordRef.backend
  readonly capabilities: ProviderCapabilities;  // { offline, preAuth, incrementalAuth, tipAdjust, partialRefund }

  // Single-message purchase — the deli's common case (authorize + capture in one tap).
  collect(params: CollectParams): Promise<PaymentResult>;

  // Two-phase, for tabs / deferred capture (Restaurant; built + faked + tested now, UI later).
  authorize(params: AuthorizeParams): Promise<PaymentResult>;         // fixed-amount hold
  preAuth(params: AuthorizeParams): Promise<PaymentResult>;           // open-tab hold, amount uncertain
  incrementalAuth(ref: string, extra: Decimal): Promise<PaymentResult>;  // raise a preAuth
  tipAdjust(ref: string, tip: Decimal): Promise<PaymentResult>;       // add tip before capture
  capture(ref: string, amount: Decimal): Promise<PaymentResult>;      // capture ≤ authorized

  // Reversals.
  void(ref: string): Promise<PaymentResult>;                          // cancel an uncaptured authorization
  refund(ref: string): Promise<PaymentResult>;                        // full refund of a capture
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult>;

  // The drain half of the pair; reconcile is its own interface (see the reconcile design).
  forward(now: Date): Promise<ForwardResult>;                         // push accepted-offline payments
}
```

### Four decisions embedded in the interface

1. **No `tx` parameter — the deliberate opposite of `FiscalBackend.recordSale(tx, …)`.** Every method
   here makes a **network call to the terminal**, and T1/T2 discipline forbids holding a database
   transaction across a network call. So the provider does its own short-transaction bookkeeping
   internally (write "attempting" → network → write outcome) and never joins the caller's sale
   transaction. The result flows into `recordSale` as **data**: `provider.collect()` → `PaymentResult`
   → the caller passes settled tenders into `recordSale(tx, backend, …)`. Payment and sale are two
   sequenced units of work, never one — correct, because the money moves before the invoice number is
   allocated.

2. **`accepted_offline` still sets `settled_at`.** This is the crux of the accept-offline model
   (§5): an offline-accepted card returns `settled_at = acceptanceTime` and `offline: true`, so
   `recordSale`'s all-tenders-settled invariant is satisfied and the fiscal chain forms **immediately**.
   The money has not cleared the network yet — that is what `forward()` and the `accepted_offline`
   lifecycle state track — but the sale is real and the receipt is valid. Square's model.

3. **Split tender is not a method.** It is N `collect`/`capture` calls against one working order, each
   yielding one tender row, summed by core's existing `assertAllTendersSettled`. No provider surface
   is needed.

4. **Cash is not a provider concern** (§1). The interface is electronic-tender only.

A `FakeProvider` implements the whole interface deterministically (configurable to simulate online
capture, offline acceptance, declines, partial captures and forward outcomes) as the test double. It
is **not** re-exported from the barrel, so a production import cannot reach it by autocomplete —
exactly like the fiscal fake.

---

## 4. How a payment attaches to a sale

The ordering is the whole puzzle: **the payment moves money before the sale row exists** (before the
invoice number is even allocated). Sequence for one card tender:

1. Staff taps "charge €X". App calls `provider.collect({ tenantId, tillId, workingOrderId, amount, allowOffline, policy })`.
2. Provider writes a **`payments` row** — `state: attempting`, keyed by `working_order_id` (the mutable
   pre-sale entity that already exists — see
   [`working_orders`](../../../packages/db/src/schema/orders.ts)), mints its own `payment_ref` — in a
   short transaction.
3. Provider calls the terminal (network). Online → `captured`; outage + explicit offline opt-in →
   `accepted_offline`, `settled_at = now` (§5).
4. Provider writes the outcome in a second short transaction; returns a `PaymentResult`.
5. App accumulates tenders (split tender = repeat 1–4). When they sum to due, it calls
   `recordSale(tx, backend, { tenders: [{ method, amount, settledAt }], … })`; the fiscal chain forms
   in that one transaction.
6. `recordSale` returns `saleId`. App tells the payment module **"associate `payment_ref` → `saleId`"**;
   the module UPDATEs the `payments` row's `sale_id`.

### The linkage: payment row owns a nullable `sale_id` (module→core FK)

Decided: **Option B.** The `payments` row carries a nullable `sale_id` foreign key onto `sales`,
exactly mirroring `registros_facturacion.sale_id`. The FK points module→core, so **core stays entirely
ignorant of payments** — zero change to the immutable `tenders`/`sales` tables or to
`RecordSaleTender`. Before step 6 the row is keyed by `working_order_id`; after, it also carries
`sale_id`. Refund and reconcile work off `payment_ref` + `sale_id`, never a core column.

(Rejected alternative — Option A: a `processor_reference` string on core's `tenders`. It has precedent
(`sales.fiscal_backend`/`fiscal_state` are thin module-flavoured crumbs core carries without
interpreting) and would help a future Z-report reconcile tenders↔acquirer without a join — but it puts
a payment-flavoured column into the regime-neutral core, and reporting can reach the same data via
`sale_id`. Not worth the boundary erosion.)

### The orphan window is real and named, not hidden

Between step 4 (money captured) and step 6 (`sale_id` set), a `recordSale` failure or an abandoned
working order leaves a **captured payment with no sale** — money taken, no invoice. This is not swept
under the rug and is **not** made atomic (T1/T2 forbids capture+sale in one transaction). It is
precisely a condition `reconcile` detects — a settled/abandoned working order carrying a captured
payment with null `sale_id` — and the remedy is an automatic refund/void of the orphan plus one
idempotent incident, the same shape as the fiscal `noTrace` self-heal.

### Orchestration lives in the till UI (sub-project 7)

Because step 3 is a network call, steps 1–6 cannot be one transaction, so there is **no** single core
"checkout" function — the composition is inherently app-level. This spec defines the *contract* (the
`PaymentResult` → `recordSale` handoff and the associate-back step); the UI that drives it comes later.

---

## 5. Offline store-and-forward

> **This section is the *semantics*; the concrete, provider-neutral build of it is Mode 2b — Cycle A
> (its own design section below).** §5 says *what* offline acceptance means; Cycle A pins the exact
> enum states, the `payment_policy` table, the `forward()` signature, the gate helper, and the fake —
> and proves them with no device SDK. The real on-device Stripe binding (Cycle B) plugs into it.

### Offline is a deliberate, gated, per-transaction opt-in — never an automatic fallback

When the network is down, the encouraged path is to take **cash**. Offline card acceptance is an
explicit action staff choose per transaction, so a customer is asked to pay cash before the merchant
takes on any offline-decline risk.

- **`CollectParams` carries `allowOffline?: boolean` (default `false`)**, and `PaymentResult` has a
  distinct `network_unavailable` state (separate from `declined`).
- **Online** → normal capture.
- **Offline + `allowOffline` not set** → returns `network_unavailable`, `settled_at: null`. The tender
  stays unsettled, the sale does **not** chain, nothing is accepted. The till UI then prompts staff:
  *retry / take cash / accept offline*.
- **Offline + staff explicitly chose "accept offline"** → the app re-issues `collect({ allowOffline: true })`.
  Only then, and only if the tenant policy is `accept_offline` **and** the amount ≤
  `offline_amount_cap`, does it write `accepted_offline` / `settled_at = now`.
- **Offline + opt-in but blocked** (policy `cash_only`, or over the cap) → still `network_unavailable`;
  the UI must fall to cash.

The tenant `offline_mode` policy governs whether the opt-in is *ever available*; the `allowOffline`
flag is the staff's explicit *this-transaction* consent; the amount cap guards even the opted-in case.
**Nothing goes offline silently.**

### Policy is per-tenant configuration

Modelled as explicit configuration, never inferred from connectivity — mirroring how Veri\*Factu-mode
is explicit per-tenant config (memory: `verifactu-mode-separate-modules`). A per-tenant
`payment_policy` (§7): `offline_mode` (`accept_offline` default | `cash_only`) and
`offline_amount_cap`. `accept_offline` is the starting default per the 2026-07-22 decision; the
per-transaction opt-in above is what actually gates each acceptance.

### We delegate the acceptance, we own the bookkeeping

We cannot authorize a card offline ourselves — only the terminal/network can. Offline card acceptance
is inherently a **terminal capability** (Stripe Terminal offline mode stores-and-forwards on the
device). So the neutral outbox's job is durable **lifecycle tracking**, not card authorization:

- `collect()` under an accepted outage writes the `payments` row `accepted_offline`, `settled_at = now`,
  returns `offline: true`; the sale chains immediately.
- **`forward(now)` is the drain analogue.** It advances `accepted_offline` rows to their terminal state
  — `settled` when the network accepts the forwarded payment (the offline counterpart of the online
  `captured`; Cycle A pins the two as distinct enum values), `declined` when it refuses — and returns a
  `ForwardResult { nextDueAt, forwarded, declined, incidentsRaised }`, shaped exactly like `DrainResult`. One pass; the cadence is the caller re-invoking on `nextDueAt`, DB-driven, never
  an in-memory timer. A provider with nothing pending answers `{ nextDueAt: null, …zeros }`.
- Like the fiscal submitter, `forward` is **an interface, not a location**: for Stripe the offline
  queue is device-local, so `forward` runs where the reader is; the contract does not assume that.
  Where it actually runs is a deployment question (sub-project 9), not settled here.

### A later offline decline does NOT un-chain the sale

The sale happened, the goods left the counter, and the fiscal record is immutable — a failed
*collection* does not retroactively make the sale not-a-sale, and the VAT is still owed. So a forward
decline is:

- payment lifecycle → `declined`,
- **one idempotent incident** raised for staff (an uncollected receivable / bad debt) via
  `recordIncidentOnce`, and
- **no automatic fiscal change.** Whether to void the sale and issue a rectificativa (e.g. staff
  recognise the customer and reverse it) is a deliberate business decision made through the *existing*
  void path — never an automatic consequence of a forward decline.

This keeps "never block selling" intact at the front and puts the messy reality (some offline charges
fail) into an explicit, idempotent incident at the back, reusing the self-heal discipline the fiscal
`noTrace` path already established.

---

## 6. Reconciliation

> **Superseded in two places by [the reconcile design](./2026-07-25-payment-reconcile-design.md) (2026-07-25):** the sweep is a separate `PaymentReconciler` interface rather than a `PaymentProvider` method, and the missed-inbound-settlement case is its own fifth class (`lostSettlement`) rather than part of `missingLocal`.

`reconcile(tenantId, period)` is the read-side backstop, structurally the twin of
`FiscalBackend.reconcile`: it audits our `payments` rows against **what the processor's settlement /
payout report actually says cleared** (Stripe's payout / balance data for the adapter; the neutral
interface never names it). Same T1/T2 split — read + network first, corrections in a separate write
transaction — and the same idempotent-incident discipline via `recordIncidentOnce` under the
single-sweep-per-tenant invariant.

**The mismatch classes** (the payment analogues of `lostAck` / `noTrace` / `drift`):

- **`unsettled`** — we hold a `captured` / `forwarded` payment the processor's report shows no
  settlement for *yet*. A recently-captured payment not yet in the report is ordinary in-flight state,
  **not** a mismatch — the same in-flight tolerance window the fiscal §4.3 path uses. Only past the
  window does it escalate to one idempotent incident.
- **`orphan`** — a captured payment with null `sale_id` on a **settled or abandoned** working order
  (§4's window: money taken, no invoice). Self-heals: auto-refund/void the orphan + one idempotent
  incident. The payment `noTrace`-equivalent, bounded by the `reconcile_remediated_at` marker so it is
  not re-refunded every sweep.
- **`missingLocal`** — the processor reports a settlement we have **no local `payments` row** for. The
  `lostAck` analogue: money they know about and we do not. Rare, but silent data loss if uncaught.
- **`drift`** — the processor settled a **different amount** than we captured (a partial settlement, an
  adjustment). One idempotent incident; not auto-corrected — a human decides.

`PaymentReconcileResult { period, checked, unsettled[], orphan[], missingLocal[], drift[], incidentsRaised }`,
shaped like `ReconcileResult`. A tenant with nothing to check answers all-empty / zeros.

**Cadence is the caller's** — the period is passed in and it is re-invoked on a schedule. Payments
settle continuously, so this can run daily rather than monthly, but the contract is period-shaped and
location-agnostic like the fiscal one. The scheduler itself is an `apps/*` concern, out of scope —
same as the fiscal reconcile scheduler.

**The symmetry across the two layers is now complete:** fiscal = `drain` (push records) + `reconcile`
(audit vs AEAT); payments = `forward` (push offline-accepted) + `reconcile` (audit vs the processor).
Same shapes, same discipline, learned once.

---

## 7. Data model, RLS & grants

All owned by `packages/payments` (neutral, English), in its own `src/schema/` + `drizzle/`. Amounts are
`numeric(12,2)` throughout — no float ever touches the money path (the exact-decimal discipline from
PR #14, guarded like
[`fiscal-verifactu/src/monetary-columns.test.ts`](../../../packages/fiscal-verifactu/src/monetary-columns.test.ts)).

### Tables

- **`payment_policy`** — per-tenant: `offline_mode` (`accept_offline` default | `cash_only`),
  `offline_amount_cap`. One row per tenant. The §5 policy.
- **`payments`** — the lifecycle row, one per electronic tender (integrated *or* manual):
  - `id`, `tenant_id`, `working_order_id` (FK→core, the pre-sale key), `sale_id` (**nullable** FK→core,
    set post-commit — the Option B linkage), `provider` (the adapter id, or the sentinel `manual` for
    an unintegrated tender — see the Mode 1 design), `payment_ref` (opaque processor reference /
    idempotency anchor), `external_ref` (**nullable** — a human acquirer/datáfono reference for manual
    reconciliation; added by Mode 1, reusable by the integrated modes for the acquirer ref),
    `authorized_amount`, `captured_amount`, `tip_amount`, `offline` (bool), `settled_at`, `state`,
    timestamps, and a `reconcile_remediated_at` marker (bounds orphan remediation, exactly as
    `envios.reconciled_resubmit_at` bounds the fiscal self-heal).
- **`payment_refunds`** — one row per refund: `payment_id` FK→`payments`, `amount`, `payment_ref`,
  `state`, timestamps. Refunds are distinct money movements, so distinct rows — never a mutation of the
  original capture.

**No separate outbox table.** The store-and-forward queue *is* the `accepted_offline` state —
`forward()` selects `WHERE state = 'accepted_offline'`, exactly as the fiscal drainer selects
`WHERE estado = 'pendiente'`. State is the queue.

### `payment_state` enum (persisted)

`authorized | captured | accepted_offline | settled | voided | refunded | partially_refunded |
declined | failed`. `network_unavailable` is a `PaymentResult` **return** value only — nothing durable
is written when offline is not permitted (no money moved), so it is not a row state. (`attempting` in
§4 step 2 is the initial transient row state written before the network call; it resolves to one of
the above in the second short transaction, or to `failed` on error.)

### RLS + grants

- Every table `.enableRLS()`, tenant-scoped on `app.tenant_id` like the whole schema.
- A **hand-written** GRANT migration (drizzle-kit does not model privileges): `app_user` gets
  `SELECT, INSERT, UPDATE` on `payments` / `payment_refunds` / `payment_policy` — state transitions
  mutate, so UPDATE is needed; **no DELETE** (nothing self-heals by row removal here — the fiscal
  `acks` DELETE was specific to the ack↔estado invariant). If a later remediation needs DELETE it is
  caught the same way the `acks` grant was: only under a **real non-superuser role**, which is why the
  RLS-behavioural tests run on real Postgres, never PGlite.

### Idempotency

Unique `(tenant_id, provider, payment_ref)` on `payments` — a retried `collect`/`forward` cannot
double-insert, and `forward()` advancing an already-forwarded row is a no-op. This is the payment
equivalent of the fiscal error-3000 idempotency.

---

## 8. Refunds & voids, and the fiscal relationship

- **`void`** cancels an authorization not yet captured — no money left the customer, so there is
  nothing fiscal to reverse.
- **`refund` / `partialRefund`** return captured funds. A refund is a payment-side movement; it does
  **not** itself edit or un-chain the sale. If the refund corresponds to reversing a sale, the fiscal
  reversal is the **existing** rectificative path (`recordVoid` /
  [`record-void.ts`](../../../packages/core/src/record-void.ts)) — a separate, deliberate action, not
  an automatic side effect of a refund.
- **Authorization to refund/void is role-gated** — the architecture doc §5 makes refunds/voids a
  permissioned action. Identity/roles are **sub-project 5**, so this spec does not implement the
  permission check; the methods take the actor context the later identity layer will populate, and the
  gate lands with sub-project 5. This is flagged, not silently skipped.

---

## 9. Testing strategy

Reproduce the fiscal package's rigour:

- **`FakeProvider`** — deterministic, configurable (online capture, offline acceptance, declines,
  partial captures, forward outcomes). Drives the core/orchestration tests; **not** barrel-exported.
- **`no-provider-vocabulary.test.ts`** — the payment twin of `no-regime-vocabulary`, keeping
  `stripe`/`paymentintent`/`reader`/… out of the neutral seam, with the same non-vacuous source-glob
  guard.
- **Real-Postgres RLS tests** under a non-superuser `PROBE_ROLE` — the missing-grant lesson from the
  `acks` DELETE grant; PGlite's superuser would hide a missing privilege.
- **Concurrency tests on real Postgres** — concurrent `collect`s against one working order, concurrent
  `forward`s, idempotency under contention — honouring the CI-hang lesson: await an acquired-signal
  before racing, and put `release()`/settle in `finally`, so a lost race can never leave a transaction
  open for the 120s hang.
- **T1/T2 tests** — the provider's own short-transaction bookkeeping around each network call;
  `forward`/`reconcile` split read-tx→network→write-tx.
- **Mutation testing** (stryker, a `mutation-payments` config alongside `mutation-verifactu`/
  `mutation-shared`), **exact-decimal / monetary-columns** guard, and a **`schema-ownership`** test
  (the barrel never re-exports a core table).

---

## 10. Decomposition into implementation plans (re-derived 2026-07-23)

The original 4a–4e sequence assumed the whole layer was the integrated `PaymentProvider`. The
capture-mode taxonomy (§0) re-derives it, ordered **broadest-reach-and-simplest first**. Each plan is
its own spec→plan→implement→land cycle, sharing this design.

**Already built:** the neutral `PaymentProvider` seam + store + schema + `FakePaymentProvider` +
online `collect`/`void`/`refund`/`partialRefund` proven with the fake (the former "4a", PR #20); and
**Mode 1 — manual / unintegrated tender** (PR #21): a staff-asserted card tender reusing the store
with a sentinel `manual` provider, plus the nullable `external_ref` column and manual refunds. The 4a
seam survives the re-derivation unchanged — the taxonomy re-contextualizes it as the integrated-mode
seam. **Mode 2a — Stripe Terminal adapter** (PR #22) and **Mode 2b — Cycle A (the provider-neutral
offline store-and-forward layer)** (PR #23) have since landed as well; **Mode 2b — Cycle B** is the next
plan (its full design is the new section below).

Then, in priority order:

1. **Mode 1 — Manual / unintegrated tender** — **landed (PR #21)**; full design in the Mode 1 section
   below. A staff-asserted card tender, a sibling of cash; no adapter, no network; broadest reach,
   zero PSP onboarding.
2. **Mode 2a — Server-driven integrated adapter** — **landed (PR #22)**; full design in the Mode 2a
   section below. The real Stripe Terminal provider (server drives a fixed-counter smart reader) against the
   existing seam — the former "4b". First real PSP; proves the integrated path end-to-end.
   **Standalone accounts** (each merchant's own Stripe account — no Connect), a **config-agnostic**
   adapter (injected Stripe client + injected till→reader resolver; provisioning deferred),
   **poll-to-completion** `collect` with the transient **`attempting`** state, and the
   **failed-reversal** store items (`recordRefund` `state='succeeded'` filter; `PaymentResult.amount`
   for a partial refund; a real-PG reversal-concurrency test). **Webhooks + the untenanted
   tenant-resolution (+ `(provider, external_ref)` index) are deferred** to reconcile (4d) / a later
   async-events plan — 2a is synchronous. Capture-mode config also defers (to orchestration, SP7).
3. **Mode 2b — On-device SDK integrated + offline** — **sliced into two cycles** (2026-07-23), because
   the offline machinery is provider-neutral and Postgres-backed while the device binding is
   Stripe-specific and untestable in a Node suite, mirroring how **4a (neutral seam + fake) preceded 2a
   (real Stripe adapter)**:
   - **Cycle A — the provider-neutral offline store-and-forward layer** — **landed (PR #23)**; full
     design in the Mode 2b — Cycle A section below. In `@waitron/payments` only: the `accepted_offline`/`settled`/`declined`
     enum states, `CollectParams.allowOffline` + `PaymentResult`'s return-only `network_unavailable` and
     `offline` flag, the `payment_policy` table (`offline_mode` + `offline_amount_cap`), the
     offline-acceptance gate, `forward(now)` implemented on the `FakePaymentProvider` (the drain
     analogue — it joins the `PaymentProvider` *interface* in Cycle B, per the Mode 2b §2 note), and
     the forward-decline → idempotent incident (**no** un-chain) path — all proven with the extended
     `FakePaymentProvider` + real-PG RLS/concurrency tests. No device SDK, no webhooks.
   - **Cycle B — the real on-device Stripe binding** *(the next plan; full design in the Mode 2b —
     Cycle B section below)*. The waiter's handheld all-in-one:
     connection tokens, device-side `collect`, the device-local offline queue behind `forward()`, and a
     nightly sandbox — the Stripe-specific `@waitron/payments-stripe` half. Webhooks + the untenanted
     `(provider, external_ref)` resolution stay deferred to Mode 3 / reconcile, as in 2a.
4. **Mode 3 — Asynchronous / hosted** — full design in the Mode 3 section below. QR pay-at-table,
   payment links, online orders — the `initiate() + webhook` shape (§0), a distinct
   `AsyncPaymentProvider` interface, so it follows the synchronous adapters. **Sliced
   neutral-then-adapter** (2026-07-24), mirroring 4a→2a a third time:
   - **Slice A — the provider-neutral async layer** — **landed (PR #26)**; the `AsyncPaymentProvider`
     interface, the `initiated` state, the webhook→settle→associate path, the untenanted
     `(provider, external_ref)` resolver, and idempotency, all proven with a fake.
   - **Slice B — the real Stripe Checkout adapter** — *implemented; lands with this PR*;
     `StripeHostedProvider` (`initiate` + `verifyAndParse`) behind the neutral layer, proven with
     `FakeStripeHosted` + a real-PG RLS test. Brings in the **webhooks and untenanted
     tenant-resolution** deferred through 2a/2b.
5. **Cross-cutting, layered in as modes need them:** `reconcile()` per settlement identity (the former
   "4d") — **complete for Stripe: Slice A (the neutral sweep, PR #28) and Slice B (the Stripe adapter,
   `StripeReconciler`) have both landed**, covering all three Stripe capture mechanisms (terminal,
   on-device, hosted) under one sweep and closing the hosted-reversal gap Slice A deferred (manual
   mode has no `reconcile` — its audit is external); the tab/tip lifecycle
   (`preAuth`/`incrementalAuth`/`tipAdjust`, the former "4e"); and the refund/void **role-gate**,
   which rides with identity (sub-project 5).

---

## Mode 1 — Manual / unintegrated tender (design)

**Landed (PR #21).** The unintegrated bank datáfono: staff read the total off the POS, key it into a
*separate* terminal, the customer pays there, and the POS is told nothing electronically.

### Not a provider — but it reuses the store

"Not a `PaymentProvider`" means it implements **no adapter and makes no network call**. It *does*
reuse the existing payment-layer **store**: a manual card tender writes an ordinary `payments`
lifecycle row with a **sentinel `provider = "manual"`**, `state = captured`. That gives the hand-keyed
acquirer reference a home and makes every card tender — manual or integrated — uniform for
association, reporting and refunds. Reuse the *table and store functions* (`insertCapturedPayment`,
`associatePaymentWithSale`, `recordRefund`); do **not** implement the `PaymentProvider` interface. The
interface is the network-driving contract; the store is the ledger, and the ledger is shared.

### Capture is atomic — the orphan window collapses

The integrated path cannot make capture and sale atomic (a network call sits between them — §4's named
orphan window). **Manual mode has no network step**, so the manual `payments` row, the sale, and the
association all commit in **one transaction**: staff record "card €X (manual)" → `recordSale` writes
the sale → the `payments` row (`provider: "manual"`, `captured`, `settled_at = now`, optional
`external_ref`) is written and associated, atomically. Manual mode is strictly *simpler* than the
integrated path, not a cut-down copy of it — §4's orphan class simply does not arise for it, and
`reconcile`'s `orphan` remediation never has manual rows to consider.

### Manual refunds

A refund on the bank terminal is a real event (a return; staff refund on the datáfono). It is recorded
via the existing `recordRefund` against the `manual` provider — for the books, and to *deliberately*
trigger the existing fiscal rectificativa path (`recordVoid` / `record-void.ts`), never as an
automatic consequence. No network; a ledger entry mirroring what happened on the bank's terminal.

### Schema

One additive migration: a **nullable `external_ref`** column on `payments` — the datáfono operation
number, a free-text human reconciliation hook, optional and unvalidated. It also gives the integrated
modes somewhere to keep the acquirer reference later. `manual` is a plain string value of the existing
`provider` column — no enum change, neutral English, and it passes the `no-provider-vocabulary` guard
(which bans *SDK/vendor* vocabulary from the neutral seam; a generic word like "manual" is not that).

### Reconciliation is external

No `reconcile()` for manual — there is no processor API to audit against. The bank's own settlement
report versus our `manual` card-tender total is the accountant's job; a later convenience could import
that report, but it is never a blocker and never automatic.

### Out of scope for this plan

The `PaymentProvider` adapter (Modes 2a/2b), any network, the till **UI** (sub-project 7), and the
**capture-mode config** (which tender modes a till offers) — its consumer is the till orchestration
(sub-project 7), so it defers there; the Mode 2a section re-scoped it out of the adapter.

---

## Mode 2a — Stripe Terminal adapter (design)

**Landed (PR #22).** The real integrated provider: a fixed-counter **smart reader** (Reader S700 /
WisePOS E) the *server* drives, proving the integrated path end-to-end behind the neutral seam — what
4a's `FakePaymentProvider` stood in for. Scope is deliberately **synchronous and online** (collect +
reversals); webhooks and reconcile are later plans.

### Package & the injected client seam

`packages/payments-stripe` — in **neither** classification list (§2): the English-only guard scans
only `GENERIC_PACKAGES` and `no-provider-vocabulary` only the neutral package, so the adapter names
`Stripe`/`PaymentIntent`/`Reader` freely without touching either list (adding it to `EXEMPT_PACKAGES`
would break their pinned-list tests for no benefit — it has no Spanish to exempt). Depends on
`@waitron/payments`, `@waitron/db`, `@waitron/shared`, and the `stripe` SDK. It holds
`StripeTerminalProvider implements PaymentProvider`.

Mirroring `VerifactuBackend`↔`VerifactuClient`, the adapter talks to a **narrow `StripeClient`
interface** — only the calls it uses (`createPaymentIntent`, `processPaymentIntent(reader, pi)`,
`retrieveReader`, `cancelReaderAction`, `refund`) — never the `stripe` SDK directly. A **real impl**
wraps the SDK; a deterministic **`FakeStripe`** models PaymentIntent + reader-action state (capture /
decline / timeout) for the hermetic suite. The provider is constructed with `{ client, resolveReader,
db }` and is **config-agnostic**: an injected client credentialed for the merchant's own
**standalone** Stripe account (no Connect, no connected-account context on calls) and an injected
`resolveReader(tenantId, tillId) → readerId`. Per-tenant provisioning (the merchant's API key, reader
ids, webhook secrets) is **not** owned here — a later provisioning/deployment concern, exactly as SIF
registration is separate from `VerifactuBackend`.

### `collect()` — server-driven, poll-to-completion, T1/T2

Every step is a network call, so the caller's sale transaction is never held across it (T1/T2). One
`collect`:

1. `readerId = await resolveReader(tenantId, tillId)`.
2. **T1 (own short tx, committed):** insert an **`attempting`** row keyed by `working_order_id`,
   `payment_ref` = a freshly minted idempotency **uuid** (the §4 "provider mints its own ref").
   Committing before the network call leaves a recoverable row on a crash, and the uuid is the Stripe
   **idempotency key**, so a retry never double-charges.
3. **Network (no tx):** `createPaymentIntent(idempotencyKey = uuid, amount, card_present, capture
   automatic)` → `processPaymentIntent(readerId, pi.id)` → **poll** `retrieveReader` until the reader
   action resolves. A timeout issues `cancelReaderAction` and resolves to `failed`.
4. **T2 (own short tx):** advance the row to `captured` (`settled_at = now`) or `failed`, storing the
   **Stripe PaymentIntent id in `external_ref`** — the exact reuse Mode 1's column was designed for.
   `PaymentResult` flows back as data; the caller passes the settled tender into `recordSale` and then
   `associatePaymentWithSale` (§4), as the 4a wiring test proved with the fake.

`PaymentResult.paymentRef` is our uuid (idempotency-safe, and what reversals take); the PI id lives in
`external_ref`. A crash between T1 and T2 leaves an `attempting` row — that stuck-state recovery is a
`reconcile` (4d) concern, not built here.

### The transient `attempting` state (neutral)

`attempting` is a generic network-provider lifecycle state (every integrated adapter has an in-flight
window), not a Stripe concept — so it joins the **neutral** `payment_state` enum in
`packages/payments` via an `ALTER TYPE` migration, with small store helpers (`insertAttempting`,
`resolveOutcome`). The design §7 already anticipated it. Manual mode never uses it (no network).

### Reversals

`void` / `refund` / `partialRefund` take a `payment_ref` (our uuid), look the row up **tenanted** (the
caller — staff via the till — always holds the tenant), read its `external_ref` (PI id), and call
`stripe.refunds.create({ payment_intent })`. Local state advances via the existing
`recordVoid`/`recordRefund`. 2a is the **first real failed-reversal path** (a Stripe refund can be
declined), so it lands the two deferred store items: `recordRefund`'s prior-refund sum filtered to
`state = 'succeeded'`, and the `PaymentResult.amount`-for-a-partial-refund contract (return the
refunded amount, not the captured total). A dedicated **real-Postgres reversal-concurrency test**
exercises the `FOR UPDATE` locks (acquired-signal pattern, per `chain.concurrency.test.ts`, to avoid
the 120s CI hang).

### Testing

- **`FakeStripe` hermetic suite** (normal gate): drives `collect` capture / decline / timeout and the
  reversal paths deterministically, no network — plus real-Postgres RLS + concurrency tests as 4a did.
- **Env-gated sandbox suite** (nightly only): the real `stripe` SDK against Stripe **test-mode** with
  a **simulated reader** (`stripe.testHelpers.terminal.readers.presentPaymentMethod`), proving the
  real SDK wiring and PI lifecycle. Skipped in per-PR CI (needs `STRIPE_TEST_KEY` + network), run by a
  **nightly GitHub Action** — a deliberate, explicit skip-unless-`STRIPE_SANDBOX=1`, distinct from the
  "never skip" RLS rule (which exists because PGlite silently passes; here the fake suite already
  proves the logic and the sandbox adds real-API fidelity on a cadence).
- The neutral-vocabulary guard does **not** apply to this EXEMPT package. The one neutral addition to
  `@waitron/payments` is `attempting`; `no-provider-vocabulary` must still find no
  `stripe`/`reader`/`terminal` vocabulary in the neutral package.

### Deferred out of 2a (deliberate re-scope)

- **Webhooks + async events** (async refund confirmation, disputes, reader-disconnect) and, with them,
  the **untenanted tenant-resolution** (an RLS-exempt resolver keyed by `(provider, external_ref)` =
  the PI id, plus that index). 2a's `collect` is poll-to-completion and its reversals run in a tenanted
  context, so nothing in the online path needs an untenanted webhook lookup. These land with
  `reconcile` (4d) / a dedicated async-events plan. (This re-scopes the memory note that had folded
  webhook tenant-resolution into "4b".)
- **Capture-mode config** — its consumer is the till orchestration (SP7), which does not exist yet;
  consistent with the config-agnostic decision, it defers there rather than landing as data with no
  reader.
- The **role-gate** on reversals (identity, SP5) and the till **UI** (SP7), as ever.

---

## Mode 2b — Cycle A: the provider-neutral offline store-and-forward layer (design)

**Landed (PR #23).** Mode 2b (§0's on-device mechanism) is **sliced** (§10.3): this cycle builds only the
**provider-neutral offline store-and-forward layer** in `@waitron/payments` — the machinery §5
describes as *semantics*, pinned to exact types and proven end-to-end with the extended
`FakePaymentProvider`, **no device SDK and no webhooks**. Cycle B (the real on-device Stripe binding)
plugs into it. The split mirrors 4a→2a exactly: build and prove the neutral contract with a fake, then
land the vendor adapter behind it.

### Why this is a legitimate slice, not reserved surface

`forward()` and the offline states are **built fully — real store behaviour, a working fake, real-PG
tests — before any device consumer exists**, exactly as `drain`/`reconcile` were built and faked
before a scheduler called them (the §"Scope decision" rule). This is the opposite of the empty
`FiscalBackend` stub that reserved a name before its design: §5 *is* the design, and Cycle A implements
it. The offline machinery is genuinely provider-neutral (an uncollected offline receivable is the same
movement whatever the PSP), so it belongs in the neutral package regardless of which adapter forwards.

### The load-bearing deployment assumption (from the architecture doc, not re-opened)

The store stays **Postgres-backed as built**. Per architecture §5 (L447–450) and the §6 SIF-fallback,
**"offline" means *internet*-offline with an on-site local server holding Postgres** — a cloud-direct
deployment with no local server "loses offline operation entirely." So Cycle A introduces **no new
local/IndexedDB persistence path**: an offline-accepted card is a normal `payments` row written to the
on-site Postgres while the internet is down, syncing upward later. Stripe's on-device SDK owns the
separate *card-forward* queue on the device (Cycle B); our rows own the *lifecycle*; `forward()`
reconciles the two. This is a deployment fact recorded here so the two docs do not silently disagree,
not a decision re-litigated in this plan.

### Interface & type changes (`packages/payments/src/provider.ts`)

- `PaymentState` (the **persisted** enum) gains `accepted_offline`, `settled`, `declined`. The offline
  lifecycle is `accepted_offline` → (`forward`) → `settled` (network cleared it) | `declined` (network
  refused). `captured` stays the *online single-message* terminal; `settled` is the *forwarded-offline*
  terminal — §7's enum deliberately distinguishes them.
- **`network_unavailable` is a return-only widening, never persisted.** When offline is refused nothing
  durable is written (no money moved), so it must not enter the DB enum. Modelled as
  `type PaymentResultState = PaymentState | "network_unavailable"`, used only on `PaymentResult.state`.
- `CollectParams` gains `allowOffline?: boolean` (default `false`) — the per-transaction staff consent.
- `PaymentResult` gains `offline?: boolean` (true iff `accepted_offline`); `settledAt` is the acceptance
  time on `accepted_offline` (§3 decision 2), so the sale chains immediately.
- `ForwardResult { nextDueAt: Date | null; forwarded: number; declined: number; incidentsRaised: number }`
  is defined (mirroring `DrainResult` field-for-field) and implemented by `FakePaymentProvider.forward()`
  + the neutral store helpers. **`forward` does NOT join the `PaymentProvider` *interface* this cycle**:
  adding a required method would break `StripeTerminalProvider` (which does not implement it), forcing an
  out-of-scope change to `payments-stripe`. The method joins the interface in **Cycle B**, when the real
  adapter(s) implement it — exactly as `drain`/`reconcile` stayed *absent* from `FiscalBackend` until a
  backend implemented them (the "no reserved surface" rule). A class may carry methods beyond its
  interface, so the fake's `forward()` compiles and is fully tested now.

### Schema (`packages/payments`, migration `0004`)

- **`payment_policy`** — `tenant_id` (PK, one row per tenant), `offline_mode text`
  (`accept_offline` | `cash_only`), `offline_amount_cap numeric(12,2)`, timestamps. `.enableRLS()`;
  hand-written GRANT `SELECT, INSERT, UPDATE` (no DELETE), like the rest of the schema. The cap is money,
  so the existing `monetary-columns.test.ts` guard covers it.
- **`payment_state` ALTER TYPE** adds the three offline states (an additive `ALTER TYPE … ADD VALUE`,
  as migration `0003` did for `attempting`).
- **Decision ① — no `till_id` column on `payments`.** `forward`'s decline-incident needs a `till_id`
  (`recordIncidentOnce` keys on `(tenant, till, code, sale)`); both `working_orders` and `sales` carry
  `till_id`, so **`forward` derives it via join**. Denormalising `till_id` onto `payments` is a later
  reconcile-grouping convenience, not needed now — kept out to keep this cycle additive-minimal.

### The offline-acceptance gate (inside `collect`)

`collect` reads the tenant's `payment_policy` row **itself** — the DB is the single source of truth,
matching how Veri\*Factu-mode is explicit per-tenant configuration (memory
`verifactu-mode-separate-modules`), rather than the caller passing a policy object in (§4 step 1's
sketch is superseded on this point). A pure neutral helper decides the outcome:

```text
resolveOfflineDecision(policy, allowOffline, amount) → "accept" | "refuse"
  online                                                     → normal capture (captured)
  offline & !allowOffline                                    → refuse → network_unavailable, nothing written
  offline & allowOffline & accept_offline & amount ≤ cap     → accept → accepted_offline, settled_at = now
  offline & allowOffline & (cash_only | amount > cap)        → refuse → network_unavailable
```

- **Decision ② — a missing `payment_policy` row fails safe → refuse** (treated as `cash_only`). A tenant
  that never configured a cap never takes offline-decline risk; onboarding/SP7 inserts the row to
  *enable* offline. This is the money-safe reading of §7's "`accept_offline` is the default": the default
  is the column default for a *configured* tenant, **not** the behaviour when no row exists.
- "Nothing goes offline silently" holds: acceptance requires policy `accept_offline` **and** explicit
  `allowOffline` **and** `amount ≤ cap` — three independent gates.

### `forward()` — the drain analogue (§5/§6)

- **State is the queue** (no outbox table): select `WHERE state = 'accepted_offline'`; per row ask the
  provider's offline queue whether it cleared or was refused; advance via neutral store helpers
  `settleForwarded` (→ `settled`) / `declineForwarded` (→ `declined`). One pass; `nextDueAt` is
  DB-driven; a provider with nothing pending answers `{ nextDueAt: null, …zeros }`.
- **A forward decline raises one idempotent incident** (an uncollected receivable / bad debt) via
  `recordIncidentOnce`, and makes **no** fiscal change — the sale already chained and is immutable;
  voiding it is the deliberate existing `recordVoid` path, never an automatic consequence (§5). The
  till_id comes from the join above; the sale_id from the (by-now-associated) payment row.
- **Decision ③ — the incident is raised in the `forward` *implementation*, not a neutral store helper.**
  Exactly as fiscal's `drain` raises incidents inside `fiscal-verifactu`, not inside neutral
  `packages/fiscal`. So the neutral **runtime** package stays free of a `@waitron/core` dependency
  (`@waitron/core` remains a devDependency, used by the fake + tests); the fake's `forward` raises the
  incident so the full decline→incident contract is proven this cycle, and Cycle B's real adapter raises
  the same one.
- **Idempotency**: advancing an already-forwarded row is a no-op (the `state = 'accepted_offline'`
  filter). **Concurrency**: the queue select takes `FOR UPDATE SKIP LOCKED` so concurrent `forward`
  passes never double-advance a row — a real-PG concurrency test using the acquired-signal pattern (per
  `reversal.concurrency.test.ts`) to avoid the 120s CI hang.

### Testing

- **`FakePaymentProvider`** gains an `offlineNextCollect()` affordance (mirroring `failNextCollect()`)
  that simulates an outage, then applies the real neutral gate → `accepted_offline` or
  `network_unavailable`; and a deterministic `forward()` that advances `accepted_offline` rows to
  `settled`/`declined` and raises the decline incident via `recordIncidentOnce`. Still **not**
  barrel-exported.
- **Real-Postgres RLS** (the `payment_policy` row and offline `payments` rows under the non-superuser
  probe role) and **concurrency** (`forward` SKIP-LOCKED) tests, as 2a did.
- The `no-provider-vocabulary` guard must still find nothing vendor-specific — every new term
  (`accepted_offline`, `settled`, `declined`, `forward`, `offline_mode`, `offline_amount_cap`,
  `network_unavailable`) is neutral English. `monetary-columns` covers the cap; `schema-ownership` still
  holds (the barrel never re-exports a core table).

### Out of scope for this cycle (Cycle B / deferred, unchanged)

The real on-device Stripe binding (connection tokens, device-side `collect`, the device-local offline
queue behind `forward()`, the nightly sandbox); webhooks + the untenanted `(provider, external_ref)`
resolution (Mode 3 / reconcile); the `forward`/`reconcile` **scheduler** (`apps/*`); capture-mode config
(SP7); the reversal role-gate (SP5); the till **UI** (SP7).

**Cycle B carry-over (found in the Cycle A whole-branch review).** `recordIncidentOnce` keys on
`(tenant, till, code, sale_id)` with `sale_id IS NOT DISTINCT FROM null`, and it is *not* race-free
(`incidents.ts` documents that a concurrent same-key caller must add a partial unique index
`(tenant_id, till_id, code, sale_id) WHERE acknowledged_at IS NULL` and switch to `ON CONFLICT DO
NOTHING`). Cycle A's single-threaded fake `forward` never hits either edge, but a *real* concurrent
`forward` in Cycle B will: (1) two distinct **orphan** declines (`sale_id = null`) on one till collapse
to a single incident, and (2) two same-`sale_id` declines (split-tender) racing across concurrent
forwards can double-insert. Add the partial unique index + `ON CONFLICT DO NOTHING` when Cycle B lands
a concurrent forward, exactly as the fiscal drainer's SKIP-LOCKED path already required. **Resolved in
Cycle B** (below), lifted to a table-wide `incidents` invariant (a partial unique index + `on conflict
do nothing` on both incident writers) rather than a payments-local hack.

---

## Mode 2b — Cycle B: the real on-device Stripe binding (design)

The next plan, and the second half of Mode 2b (§0's on-device mechanism). Cycle A built and proved the
**provider-neutral** offline store-and-forward layer with the extended `FakePaymentProvider`; Cycle B
lands the **real on-device Stripe binding** behind it and **promotes `forward` to a first-class provider
method**. One spec→plan→SDD→land cycle spanning a small **provider-neutral half** (`@waitron/payments`
+ `@waitron/core`/`@waitron/db`) and the **Stripe-specific half** (`@waitron/payments-stripe`). It
mirrors 4a→2a a second time: the neutral contract was proven with a fake (Cycle A), and the vendor
adapter now lands behind it (Cycle B).

### The neutral half

**`forward` joins the `PaymentProvider` interface.** Cycle A defined `ForwardResult` and implemented
`forward` on the fake only, deliberately keeping it *off* the interface so a required method would not
break `StripeTerminalProvider` (the Cycle A "Interface & type changes" note). Cycle B lands a real
adapter that implements it, so `forward(now: Date): Promise<ForwardResult>` now joins the interface —
exactly as `drain`/`reconcile` joined `FiscalBackend` only once a backend implemented them. Every
implementer must now supply it:

- `FakePaymentProvider.forward` already exists → it now *satisfies* the interface rather than exceeding
  it, and the `provider.ts` doc comment that says "do not add `forward` before Cycle B" is updated.
- **`StripeTerminalProvider` (2a, server-driven) gains an all-zeros `forward`** →
  `{ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }`. A fixed-counter smart reader has
  no device-local offline queue, so nothing is ever pending: a one-line method with a unit test asserting
  the zero result. (Offline store-and-forward is a property of the *on-device SDK* mechanism, not of the
  integrated mode in the abstract — §0.)

**The table-wide incident invariant (the Cycle A carry-over, now resolved).** Cycle A flagged that
`recordIncidentOnce` (`insert … where not exists`, `packages/core/src/incidents.ts`) is **not race-free**:
a real concurrent `forward` collapses two orphan declines (`sale_id = null`) on one till into one
incident, or double-inserts two same-`sale_id` split-tender declines. Cycle B is that first real
concurrent caller, so it lands the fix — and lands it as a **table-wide invariant on `incidents`**, not a
payments-local hack:

- **A partial unique index** (hand-written migration in `packages/db/drizzle/`):
  `create unique index incidents_open_dedup on incidents (tenant_id, till_id, code, sale_id) nulls not
  distinct where acknowledged_at is null;`. `nulls not distinct` makes two orphan (`sale_id = null`)
  declines on one till collapse to a single open incident — matching `recordIncidentOnce`'s existing
  `sale_id is not distinct from` WHERE semantics. **Requires Postgres 15+**; the plan verifies the server
  version as its first task and falls back to a `coalesce(sale_id, '<sentinel-uuid>')` expression index
  if older.
- **Both incident writers become `on conflict do nothing`.** `recordIncidentOnce` drops its
  `where not exists` subquery for `insert … on conflict do nothing returning id` (`rows.length > 0` still
  reports a real insert — the contract is unchanged, now atomic under contention). `recordIncident` (the
  unconditional writer used by `record-sale`/`record-void`/fiscal `drain`/fiscal `reconcile`) *also* gains
  `on conflict do nothing`: **safe-or-better for every caller** — the terminal-transition callers have
  naturally-unique `(sale, code)` keys so the index never fires, and reconcile's still-open
  `fiscal.reconcile_drift_errores` re-detection becomes a **no-op instead of an accumulating duplicate**,
  which is the invariant we want everywhere. The `incidents.ts` doc comments that describe the old
  non-race-free behaviour are rewritten to describe the new guarantee.
- **Decision ⓪ — the fix is a shared-primitive change, not payments-local.** A `pg_advisory_xact_lock`
  scoped to the payments `forward` was the alternative; the table-wide index was chosen because "at most
  one open incident per `(tenant, till, code, sale)`" is the correct invariant in *every* module, it
  subsumes the latent fiscal-reconcile duplicate-accumulation, and it matches this codebase's
  "shared primitive, done once" discipline (how the fiscal drainer got SKIP-LOCKED).
- **The proof:** a real-Postgres concurrency test — two concurrent `forward` passes declining *different*
  rows that map to the **same** incident key (both the orphan `sale_id = null` case and the same-`sale_id`
  split-tender case) → exactly **one** open incident survives. Acquired-signal pattern (per
  `reversal.concurrency.test.ts`) to avoid the 120 s CI hang.

### The Stripe adapter half (`packages/payments-stripe`)

A **second provider class, `StripeOnDeviceProvider`**, alongside 2a's `StripeTerminalProvider`, in the
**same package** (both are Stripe Terminal; they share connection-token/refund plumbing, the coverage
config and the sandbox harness — a new package would buy nothing). It depends on its **own narrow client
interface, `StripeDeviceClient`** (separate from 2a's `StripeClient` — each seam names only the calls it
uses, mirroring `VerifactuClient`↔`VerifactuBackend`):

```ts
interface StripeDeviceClient {
  createConnectionToken(): Promise<{ secret: string }>;   // stripe.terminal.connectionTokens.create
  collectOnDevice(p: {
    amount: Decimal; currency: string; idempotencyKey: string; offlineAllowed: boolean;
  }): Promise<{
    outcome: "captured" | "accepted_offline" | "declined" | "network_unavailable";
    externalRef?: string;
  }>;
  syncOfflineQueue(refs: string[]): Promise<{ settled: string[]; declined: string[] }>;
}
```

- The **real impl** wraps the Stripe on-device SDK bindings and is **coverage-excluded** (like
  `stripe-client.ts`); a deterministic **`FakeStripeDevice`** drives the hermetic suite (affordances to
  force each `collectOnDevice` outcome and to script `syncOfflineQueue`). Not barrel-exported.
- **Connection tokens live entirely here** — the device app calls a thin exported `connectionToken()` (or
  a provider method) to initialise its on-device SDK. This stays out of `@waitron/payments`, whose
  `no-provider-vocabulary` guard bans `connectiontoken`/`stripe`/`reader`/`terminal`.

**`collect` — the gate is applied up front; a single write; `network_unavailable` persists nothing.**
Unlike 2a's server-driven poll-to-completion:

1. Read the tenant `payment_policy` and compute
   `offlineAllowed = resolveOfflineDecision(policy, allowOffline, amount) === "accept"` — the **same
   neutral gate** the fake uses. This *configures* the device collect (Stripe's offline behaviour is set
   per-confirmation), so acceptance is gated *before* anything is stored — "nothing goes offline silently"
   (§5) holds.
2. Mint `paymentRef = randomUUID()` — the Stripe idempotency key and our own reference.
3. `collectOnDevice({ …, offlineAllowed })` → outcome.
4. **One** short transaction persists the resolved outcome via the *existing* Cycle A / 4a store helpers:
   `captured` → `insertCapturedPayment` (`external_ref` = the online/offline PI id); `accepted_offline` →
   `insertAcceptedOffline` (`settled_at = now`, so the sale chains immediately); `declined` →
   `insertFailedPayment`; **`network_unavailable` → write nothing, return the state** (no money moved).

- **Decision ① — no `attempting`-first pre-write for 2b** (the deliberate opposite of 2a's T1). 2a commits
  an `attempting` row *before* its network call because a ≤60 s server-side poll can crash mid-flight and
  lose the handle to a live Stripe-hosted PaymentIntent. The on-device SDK owns its PaymentIntent and
  offline queue *locally*, so a crash on our side never loses the device's record — the device forwards it
  regardless. The only residual gap ("device stored offline but our process died before writing the
  `accepted_offline` row") is precisely reconcile's `missingLocal` class (§6), and dropping the pre-write
  is what lets `network_unavailable` honour Cycle A's "nothing durable when offline is refused."
  Idempotency is preserved by the Stripe idempotency key (our uuid) carried into `collectOnDevice`.

**`forward(now)` — a real T1/T2 split reusing Cycle A's idempotent store.** The fake did claim + advance +
incident in one transaction ("a real adapter splits them T1/T2" — the Cycle A `forward` note). The device
adapter does:

- **T1 (read tx):** list this provider's `accepted_offline` refs (a non-locking read variant of
  `claimAcceptedOffline`).
- **Network (no tx):** `syncOfflineQueue(refs)` — ask the device-local offline queue which refs it has now
  cleared vs. had refused.
- **T2 (write tx):** `settleForwarded` / `declineForwarded` — both already **state-guarded → idempotent**
  (they match only a row still `accepted_offline`), so two concurrent forwards cannot double-advance a row
  without holding a lock across the network; each decline raises the idempotent
  `payment.offline_forward_declined` incident (an uncollected receivable; `till_id` derived by join on
  `working_orders`, `sale_id` from the associated payment row) via the now-race-safe `recordIncidentOnce`,
  and makes **no fiscal change** — the sale already chained and is immutable (voiding it is the deliberate
  existing `recordVoid` path, never automatic). `nextDueAt` is DB-driven; an empty queue returns
  `{ nextDueAt: null, …zeros }`.

- **Decision ② — no new `forwarding` in-flight enum state.** A proper T1/T2 split usually needs an
  intermediate state (fiscal's `enviando`, the transient `attempting`). It is unnecessary here: the
  state-guarded, idempotent `settleForwarded`/`declineForwarded` advances plus the table-wide incident
  dedup give full concurrency safety without one. The only thing forgone versus a `FOR UPDATE SKIP LOCKED`
  claim is that two concurrent passes may both sync the same refs with the device (idempotent and harmless
  — the offline queue is small and capped, and forwards are infrequent). Keeps this cycle
  additive-minimal on the enum.

**Reversals reuse 2a's path unchanged.** `void`/`refund`/`partialRefund` look the row up **tenanted**, read
`external_ref` (the PI id), issue the Stripe refund, and advance local state via
`recordVoid`/`recordRefund`/`recordFailedRefund` — shared with `StripeTerminalProvider`, not
re-implemented. `StripeOnDeviceProvider.capabilities = { partialRefund: true }`.

### Testing

- **Hermetic suite (per-PR gate, no network):** `FakeStripeDevice` + `StripeOnDeviceProvider` — the four
  `collect` outcomes → correct state + persisted row; the gate-up-front wiring (policy `cash_only` /
  over-cap / no-consent all yield `network_unavailable` with nothing persisted); `forward` settle /
  decline (+ incident) / empty-queue zeros; `StripeTerminalProvider`'s all-zeros `forward`; and a **wiring
  capstone** — an offline-accepted device tender chains a real sale via `recordSale` +
  `associatePaymentWithSale`, and a later forward-decline raises the incident **without un-chaining** the
  immutable sale (the 2b twin of Cycle A's `offline.wiring.test.ts`).
- **Real-Postgres (never skip — PGlite's superuser hides a missing grant):** RLS on the device `payments`
  rows + `payment_policy` under the non-superuser probe role; and the incident-race concurrency proof
  above.
- **Coverage:** extend `packages/payments-stripe/vitest.config.ts` coverage-excludes to the real
  `StripeDeviceClient` impl file (alongside `stripe-client.ts`, `testing/**`, `*.sandbox.test.ts`);
  thresholds stay 98/98/98/95. Because the coverage gate is **CI-only** (the pre-push hook runs `test`, CI
  runs `test:coverage`), run `pnpm --filter @waitron/payments-stripe test:coverage` **and**
  `--filter @waitron/payments test:coverage` locally before pushing (the #23 lesson). Neutral guards still
  hold: `no-provider-vocabulary` finds nothing vendor-specific in `@waitron/payments` (`forward` and the
  offline states are plain English), `schema-ownership` and `monetary-columns` unchanged.
- **Sandbox (nightly only, server-side calls only):** a new `*.sandbox.test.ts` exercising
  **connection-token creation** against real Stripe test-mode, plus a reversal smoke-test reusing 2a's
  path — wired into `.github/workflows/stripe-sandbox.yml`. The device-side
  `collectOnDevice`/`syncOfflineQueue` have **no headless analogue** (the on-device SDK's offline
  store-and-forward is a client-SDK feature), so they are proven by `FakeStripeDevice` only; real-device
  validation is manual and out of CI. The **`STRIPE_SANDBOX_SECRET_KEY` repo secret was added 2026-07-24**,
  so this suite now runs nightly (per-PR CI still excludes it via the `*.sandbox.test.ts` glob; the test
  self-skips only if the key is ever absent).

### Out of scope for this cycle (unchanged)

Webhooks + the untenanted `(provider, external_ref)` resolution (Mode 3 / reconcile) — Cycle B's `collect`
is synchronous and its reversals run tenanted, so nothing here needs an untenanted webhook lookup;
`reconcile()` itself (the old "4d"; the designed backstop for the `attempting`/`missingLocal`/orphan
cases, including Decision ①'s crash gap); the `forward`/`reconcile` **scheduler** (`apps/*`); capture-mode
config (SP7); the reversal **role-gate** (SP5); the till/handheld **UI** (SP7); reversal retry-safety (a
persisted per-reversal id, as in 2a); a second PSP (Adyen/SumUp).

---

## Mode 3 — Asynchronous / hosted payments (design)

The next plan, and the third settlement mode (§0). The customer pays **out-of-band** — a hosted
payment page reached by a **QR at the table, a payment link, or an online order** — and the settled
tender is written **later by an inbound webhook, not returned synchronously**. This is a **different
method shape**, not another `PaymentProvider` adapter: `initiate(params) → { ref, url }` mints a hosted
payment and hands the customer a URL; a webhook later produces and associates the settled tender.

**The load-bearing shift.** In every mode so far a synchronous till action produces the settled tender
and *then* chains the sale. Here the working order stays **open** until a webhook — at an unknown later
time — settles the tender and triggers `recordSale`. The webhook, not a till tap, is what advances the
order. That ordering is the crux, and it is what brings in the **webhooks + untenanted
tenant-resolution** deferred through 2a/2b (Mode 2a "Deferred", Mode 2b Cycle B "Out of scope").

**Sliced neutral-then-adapter** (§10 item 4), a third repeat of 4a→2a: **Slice A** builds and proves the
provider-neutral async layer with a fake; **Slice B** lands the real Stripe Checkout adapter behind it.
One shared design, two spec→plan→implement→land cycles.

### The new `AsyncPaymentProvider` interface — a distinct shape, not a `PaymentProvider` variant

Mode 3 is a different method shape, so it is its **own** interface in `@waitron/payments`, never new
methods on `PaymentProvider` — a required `initiate` would break every synchronous adapter, exactly the
reason `forward` stayed *off* the interface until an implementer existed (Mode 2b Cycle A). An adapter
may implement `PaymentProvider`, `AsyncPaymentProvider`, or both (Stripe implements both — Terminal for
§2, Checkout for §3).

```ts
interface AsyncPaymentProvider {
  readonly provider: string;                                    // opaque id; "stripe" (shared)

  // Mint a hosted payment for an OPEN working order. Network call to the PSP (T1/T2, NO caller tx —
  // like collect), then writes an `initiated` payments row (external_ref = the hosted-payment id).
  initiate(params: InitiateParams): Promise<InitiateResult>;

  // Verify + parse a raw inbound event into a neutral settlement. Vendor-specific (signature check
  // with an injected endpoint secret); the fake trusts the payload. null = an event we do not act on;
  // throws on a bad signature.
  verifyAndParse(payload: string, signature: string): InboundSettlement | null;
}

interface InitiateParams { tenantId: TenantId; workingOrderId: WorkingOrderId; amount: Decimal; paymentRef: string; }
interface InitiateResult { ref: string; externalRef: string; url: string; }  // url → QR *or* link (app's choice)

interface InboundSettlement {
  provider: string;
  externalRef: string;              // the hosted-payment id — the resolve + settle key
  outcome: "settled" | "expired";   // paid vs abandoned / timed-out
  amount: Decimal;                  // what actually settled (the drift anchor reconcile uses later)
  settledAt: Date;
}
```

`paymentRef` is the caller's `(tenant_id, provider, payment_ref)` idempotency anchor (a uuid, as in 2a);
`external_ref` holds the hosted-payment id — the **only** identifier the inbound webhook carries, and
therefore the resolve/settle key. This is the exact reuse the `external_ref` column was designed for
(§7; Mode 1 added it, the integrated modes reuse it for the processor reference).

### Lifecycle & the new `initiated` state

`initiate` writes `state = initiated`, `external_ref = <hosted id>`, `settled_at = null`, `sale_id =
null`; the working order stays **open**. One additive enum value (`ALTER TYPE`), the smallest change the
mode needs — the webhook then advances the row through two neutral, tenant-scoped store functions that
take a `tx` (they do a store write inside the orchestrator's transaction, they make no network call):

- `settleInitiated(tx, { provider, externalRef, settledAt }) → SettledRow | null` — advances a row
  **still `initiated`** → `captured`, sets `settled_at`. Keys on `(provider, external_ref)` (all the
  webhook carries), scoped to the resolved tenant by RLS, guarded by `state = 'initiated'`. Returns the
  row (`workingOrderId`, `amount`, `paymentRef`) when it advanced, **`null` when it matched nothing**
  (already captured — a redelivery). That row-or-null is the idempotency signal the orchestrator
  branches on.
- `expireInitiated(tx, { provider, externalRef })` — `initiated → failed` (reuse the existing `failed`;
  no new `expired` state — YAGNI). The working order stays open; staff take another tender.

`initiated → captured` matches sync capture semantics (the money has cleared at the PSP when the
`completed` webhook fires), so a hosted capture is thereafter an **ordinary `captured` row** — refunds,
association and reporting need nothing async-specific.

### Idempotency (webhooks are at-least-once)

Two guards, both cloning landed patterns:

- **State-guarded advance.** `settleInitiated`'s `WHERE state = 'initiated'` makes a second delivery a
  no-op returning `null`, exactly as `settleForwarded` / `advanceAcceptedOffline` are idempotent. With
  the atomic orchestration transaction and the row lock, two **concurrent** deliveries serialize: the
  first does settle → `recordSale` → associate; the second matches zero rows, returns `null`, and the
  orchestrator **skips `recordSale`** — so **no second invoice number is ever allocated**. This is the
  crux of async idempotency, and the reason `settleInitiated` must report whether it advanced (the
  `recordIncident`-returns-a-bool lesson from #25, applied to the sale-chaining decision).
- **`(provider, external_ref)` partial unique index.** Anchors resolution and blocks a double
  `initiated` insert. It **must be partial** — `WHERE external_ref IS NOT NULL AND provider <> 'manual'`
  (exact predicate pinned after grepping **every** `external_ref` writer) — because a table-wide unique
  would collide on manual / hand-keyed acquirer references, which are neither unique nor non-null. This
  is the #25 table-wide-index lesson applied before the fact. Hand-written `--custom` migration (drizzle
  0.45 cannot express a partial `nullsNotDistinct`), so drizzle-kit never diffs it (same as the RLS /
  GRANT / incidents-dedup migrations).

### Untenanted tenant resolution — mirrors `envios_tenants_with_work`

A webhook arrives with **no tenant context** (an inbound call, RLS-exempt), yet `withTenant` setting
`app.tenant_id` is the only scoping mechanism and `payments`' isolation policy fails closed — a lookup
with no GUC set returns nothing. The neutral store already has the untenanted `findPaymentByRef(provider,
ref)` built for this, but it needs a **controlled RLS bypass** to see across tenants. Fiscal already
solved exactly this for its cross-tenant drainer enumeration (`envios_tenants_with_work`, fiscal
migration `0004`); Mode 3 clones that mechanism verbatim rather than inventing one:

- a dedicated **`NOLOGIN NOSUPERUSER`** role `payments_webhook_resolver` (guarded against a pre-existing
  `LOGIN` role, like `envios_drainer` — a login-capable role here would read every tenant's payments);
- a **permissive** `FOR SELECT TO payments_webhook_resolver USING (true)` policy on `payments`
  (additive — Postgres ORs permissive policies, so tenant isolation is untouched for every other role);
- a **`SECURITY DEFINER`** function `resolve_payment_tenant(provider text, external_ref text) RETURNS
  uuid`, `SET search_path = pg_catalog, public`, owned by the role via the temp-grant / reassign /
  revoke dance, returning **only `tenant_id`** — never a wider `payments` column (the fiscal principle:
  the bypass surface is one uuid);
- `REVOKE EXECUTE … FROM PUBLIC; GRANT EXECUTE … TO app_user`, so the one intended caller is named.

Deliberately **not** "grant a role BYPASSRLS": that requires the grantor to already hold BYPASSRLS, which
the hardened migration role does not (fiscal `0004` / db `0005_sales` verified this live). A hand-written
`--custom` migration, adding no table or column. After resolution the orchestrator opens
`withTenant(tenantId)` and **everything else runs under ordinary RLS**.

### The sale-chaining orchestration (app-level, deferred; proven by a Slice A capstone)

`recordSale` lives in `@waitron/core`, and `@waitron/payments` stays **core-free** (core is a
devDependency, for tests only — the invariant every mode has kept). So the composition — verify →
resolve → settle → chain → associate — lives **above** both layers, in a future `apps/*` webhook
endpoint, the only place that imports both. It mirrors §3 decision 1 exactly: the payment layer produces
a settled tender as **data**, and the caller chains `recordSale`.

```text
event = provider.verifyAndParse(rawBody, sigHeader)                   // payments-stripe (B) / fake (A)
if (!event) return 204                                                // not an event we act on
tenantId = resolvePaymentTenant(event.provider, event.externalRef)    // untenanted (SECURITY DEFINER)
if (!tenantId) return 202                                             // unknown ref (initiate-crash gap / data loss);
                                                                     //   no tenant ⇒ no scope to write an incident in;
                                                                     //   reconcile audits it per-tenant as missingLocal
await withTenant(tenantId, async (tx) => {                            // re-enter tenant scope
  if (event.outcome === "expired") { await expireInitiated(tx, …); return }
  const row = await settleInitiated(tx, …)                            // initiated → captured
  if (row === null) return                                            // redelivery — already chained; DO NOTHING
  const sale = await recordSale(tx, backend, saleInput)              // @waitron/core — saleInput's tenders include
                                                                     //   the just-settled hosted tender (from `row`)
  await associatePaymentWithSale(tx, { …key, saleId: sale.id })       // Option B associate-back
})                                                                     // ONE atomic tx
```

Settle + `recordSale` + associate share **one** transaction, so a `recordSale` failure rolls back the
settle too and the at-least-once redelivery retries the whole thing cleanly (the row is still
`initiated`). Slice A proves this exact composition with a **capstone wiring test** playing the
orchestrator — the established `wiring.test.ts` / `offline.wiring.test.ts` / `manual.wiring.test.ts`
pattern (each already imports `recordSale` from the devDependency `@waitron/core`) — with **no `apps/`
layer required.**

### Slice A — the provider-neutral async layer (the next plan)

In `@waitron/payments` only, proven with a fake and real Postgres:

- the `AsyncPaymentProvider` interface + the `InitiateParams` / `InitiateResult` / `InboundSettlement`
  types (neutral — no `stripe` / `checkout` / `webhook`-vendor vocabulary; the `no-provider-vocabulary`
  guard still passes);
- the `initiated` enum value (`ALTER TYPE`); the `(provider, external_ref)` partial unique index; the
  `resolve_payment_tenant` SECURITY DEFINER seam — the last two as hand-written `--custom` migrations;
- the store functions `settleInitiated`, `expireInitiated`, and the untenanted `resolvePaymentTenant`
  wrapper over the SQL seam;
- a `FakeAsyncProvider` (deterministic `initiate`; `verifyAndParse` trusts a JS-object payload →
  `InboundSettlement`) — **not** re-exported from the barrel, like every other fake.

### Slice B — the Stripe Checkout adapter (`@waitron/payments-stripe`)

A third provider class beside `StripeTerminalProvider` (2a) and `StripeOnDeviceProvider` (2b), all
sharing provider id `"stripe"`:

- **`StripeHostedProvider`** implementing `AsyncPaymentProvider`.
  - `initiate()` → `stripe.checkout.sessions.create({ mode: "payment", amount, currency: "eur", … })` →
    writes the `initiated` row with `external_ref = session.id`, returns `{ ref: paymentRef, externalRef:
    session.id, url: session.url }`. The `url` is **presentation-agnostic**: an app renders it as a QR at
    the table or sends it as a link — the payments layer never distinguishes QR-at-table from
    payment-link from online-order.
  - `verifyAndParse()` → `stripe.webhooks.constructEvent(payload, signature, endpointSecret)` (the
    injected secret), then maps `checkout.session.completed` → `outcome: "settled"`,
    `checkout.session.expired` → `outcome: "expired"`, everything else → `null`.
- **Injected client seam.** The narrow `StripeClient` seam + `FakeStripe` (2a/2b) extend to
  `checkout.sessions.create` and `webhooks.constructEvent`; the real SDK binding stays
  **coverage-excluded** (`stripe-client.ts`), as today. `currency: "eur"` hardcoded at the boundary
  (single-currency-per-tenant; revisit at multi-currency), consistent with the other Stripe providers.
- **The endpoint (webhook signing) secret** is **provisioning / deployment**, *not* owned here — exactly
  as reader-provisioning and per-tenant Stripe keys were deferred throughout 2a/2b. It is an injected
  value the provider holds (config-agnostic adapter).

### Testing

- **Slice A** — store tests for `settleInitiated` (advance + idempotent `null`-return) and
  `expireInitiated`; a **real-PG RLS test** for `resolve_payment_tenant` proving it resolves cross-tenant
  under a genuine non-superuser role *and* that the permissive policy leaks nothing wider (a plain
  `select … from payments` with no GUC still returns nothing; only the SECURITY DEFINER function
  crosses) — the PGlite-can't-cover case; a **two-delivery concurrency test** (real-PG, acquired-signal)
  asserting exactly one sale, one invoice number, the payment `captured` + associated; the **capstone
  wiring test**; and behavioural tests that the partial `(provider, external_ref)` index rejects a
  duplicate async ref while leaving manual / null-ref rows unconstrained (the index is a hand-written
  migration, deliberately not in the drizzle schema, so it is proven behaviourally rather than via a
  `getTableConfig` assertion). One task owns the `test:coverage` run (the #25 lesson).
- **Slice B** — `FakeStripe`-driven unit tests for `initiate` / `verifyAndParse` (including `expired` and
  unknown-event → `null`), a wiring capstone, a real-PG RLS test, and a **nightly `*.sandbox.test.ts`**
  exercising the real `checkout.sessions.create` server-side against `STRIPE_SANDBOX_SECRET_KEY`
  (self-skipping in per-PR CI via the glob). A live inbound webhook cannot be received in the nightly
  runner, so `verifyAndParse` is proven against `FakeStripe` + recorded-event fixtures, not a live
  delivery — the sandbox covers session *creation*.

### Out of scope for Mode 3 (deferred)

- **The `apps/*` webhook HTTP endpoint + signature-secret provisioning** — a deployment concern, like
  the `forward` / `reconcile` scheduler and per-tenant Stripe provisioning. The orchestration *logic* is
  proven in Slice A's capstone; the HTTP wrapper lands with `apps/`.
- **`reconcile()` for the async provider** (the former "4d") — the designed backstop for a
  never-arriving / late webhook (the `unsettled` / `missingLocal` classes, §6) and for the resolver
  returning no tenant. Its own cross-cutting plan; Mode 3 leaves the anchors it needs (the `initiated`
  state, the `(provider, external_ref)` index, and `InboundSettlement.amount` for the drift check).
- **QR-at-table vs payment-link vs online-order presentation** — an app/UI concern over the returned
  `url`; the payments layer is presentation-agnostic.
- **A new async-refund surface** — a hosted capture is an ordinary `captured` row, so the existing
  `refund` / `partialRefund` + shared `reverseViaStripe` path already covers it. Async refund-confirmation
  / dispute webhooks, if ever needed, ride the same `verifyAndParse` seam later.
- **Capture-mode config** (SP7), the reversal **role-gate** (SP5), the till/handheld **UI** (SP7), and a
  second PSP — unchanged deferrals.

---

## 11. Non-goals (this sub-project)

- **Not** a payment processor or acquirer; card data never passes through the app (architecture §12).
- **Not** the till/tab/tip **UI** — sub-project 7 (counter POS), 10 (tabs), 13 (tips).
- **Not** the role/permission gate on refunds/voids — sub-project 5 (identity); the seam is left for it.
- **Not** the `forward`/`reconcile` **scheduler** — an `apps/*` concern, like the fiscal scheduler.
- **Not** a second provider (Adyen/SumUp) — the split exists so they cost an adapter, not an interface
  change, but only Stripe Terminal is built here.
- **Not** EU consumer-card surcharging (banned) or mandatory service charges (architecture §12).

---

## 12. Payment economics — the number we are measured against (added 2026-07-31)

**This section changes no decision in this document.** It records a benchmark discovered while pricing
the deli's hardware, because it is the kind of finding that gets forgotten and then rediscovered
expensively. The adapter roadmap in §10 is unaffected, and SumUp remains the deli's choice on the
analysis in
[2026-07-30-deli-hardware-design.md](2026-07-30-deli-hardware-design.md) §4.

### What an incumbent quotes

A Spanish hospitality POS incumbent (Ágora, by IGT Microelectronics S.L. — three editions, ~37,000
installations) resells payments to its own customers on an **Interchange++** tariff, code `IC03`:

| Gateway | Tariff |
| --- | --- |
| Presencial (card-present) | Interchange ++ **0.23% + €0.015** |
| Digital (card-not-present) | Interchange ++ **0.23% + €0.04** |

IC++ is structurally different from what we sell today. A flat-rate PSP blends three costs into one
number and keeps the spread; IC++ passes two of them through **at cost** and charges a thin margin on
top:

1. **Interchange**, to the issuer — capped by [Regulation (EU) 2015/751](https://eur-lex.europa.eu/eli/reg/2015/751/oj/eng)
   at **0.2% consumer debit / 0.3% consumer credit** for intra-EEA consumer cards. Commercial and
   non-EEA cards are **not** capped.
2. **Scheme fees**, to Visa/Mastercard — unregulated, small.
3. **Acquirer margin** — the `0.23% + €0.015` above.

### What that works out at, and how we compare

From the vendor's own effective-rate table at a **€15** ticket, card-present:

| | Ágora `IC03` | SumUp Pagos Plus | Stripe Terminal |
| --- | --- | --- | --- |
| Spain domestic | ~0.51–0.63% | 0.99% (+ €19/mo) | 1.4% + €0.10 |
| EU | ~0.63–0.79% | 0.99% | 1.4% + €0.10 |
| Non-EEA | ~1.3–2.8% | 1.69% flat | 2.9% + €0.10 |

> **Read off a small embedded table in a supplied PDF, not from a machine-readable source.** Treat the
> effective percentages as indicative and re-derive them from the tariff before quoting them to anyone.
> The tariff line itself (`0.23% + €0.015`) is stated plainly and is the reliable figure.

**Domestically we are roughly 2× the incumbent.** Two structural notes: the fixed component punishes
small tickets (the same table shows ~0.83–0.94% domestic at a **€5** ticket), and IC++ *loses* to a
flat rate on non-EEA cards, because uncapped interchange is passed straight through — which is why a
tourist-heavy venue narrows the gap.

For total cost of ownership, the same incumbent's quotes for a two-position deli were **€1,539
one-off** (install, training, one all-in-one POS) and **€93/month** (€34 software + €20 support + €39
for three rented terminals at €13 each).

### Why this matters to us, and what it does not mean

Every Spanish restaurant we sell to will have been quoted the IC++ number by an incumbent. Offering
only flat-rate PSPs is a standing commercial disadvantage, on the line item a hospitality operator
watches most closely.

**Closing it does not require becoming a processor**, so it does not conflict with §11's first
non-goal or architecture §12. The incumbent does not acquire either: it partners with an acquirer,
resells rented terminals at €13/month, and takes a margin. That is a commercial relationship, not a
licence — and the `PaymentProvider` seam already makes the adapter side cheap.

Recorded as a **target, not a plan**. No acquirer relationship is proposed here, and nothing in §10
moves.

### Provenance

Private documents supplied 2026-07-31; no public URL exists, which is precisely why they are
transcribed rather than linked.

| Claim | Source |
| --- | --- |
| `IC03` tariff lines, the IC++ explanation, and the effective-rate tables | *Condiciones Ágora Payments — PVPR*, vigencia desde 1/04/2026, 12 pp. Pricing scoped *"en clientes Ágora"* |
| €1,539 one-off | Presupuesto **E261071**, EJECT COMPUTER SOLUCIONS INFORMATIQUES S.L., 15/05/2026 |
| €93/month, and €13/month per rented terminal | Presupuesto **E261072**, same reseller and date |
| Interchange caps | <https://eur-lex.europa.eu/eli/reg/2015/751/oj/eng> |
| SumUp and Stripe rates | Restated from [2026-07-30-deli-hardware-design.md](2026-07-30-deli-hardware-design.md) §9, where they carry their own URLs |
