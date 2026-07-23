# Payment layer (`PaymentProvider` + Stripe Terminal + offline store-and-forward) — Design

**Date:** 2026-07-22
**Status:** Draft — brainstorming complete, pending user review
**Covers:** Architecture sub-project 4 (the payment layer): a provider-neutral `PaymentProvider`
interface, a Stripe Terminal adapter, and offline store-and-forward — the money-movement layer that
sits *before* the sale/fiscal write path and turns "customer pays" into a settled tender.

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

### `packages/payments-stripe` — the adapter, exempt

- Added to `EXEMPT_PACKAGES` — free to name `PaymentIntent`, `Reader`, `ConnectionToken` and Stripe
  Terminal concepts. Depends on `@waitron/payments`, `@waitron/db`, `@waitron/shared` and the Stripe
  SDK.
- Holds `StripeTerminalProvider`. If it needs Stripe-shaped columns of its own it declares them in
  *its* schema/migrations, not the neutral package's (it probably needs none — see §7).

### Dependency direction

Module→core, always. Payment schema files `import` core tables (`workingOrders`, `sales`) to declare
foreign keys but never re-export them. Core never imports `@waitron/payments`.

---

## 3. The `PaymentProvider` interface

Provider-neutral, card-present / terminal-mediated. Field names are indicative; the exact shapes are
pinned in §7.

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

  // The drain / reconcile pair — mirrors FiscalBackend.
  forward(now: Date): Promise<ForwardResult>;                         // push accepted-offline payments
  reconcile(tenantId: TenantId, period: Period): Promise<PaymentReconcileResult>;
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
  — `captured`/`settled` when the network accepts the forwarded payment, `declined` when it refuses —
  and returns a `ForwardResult { nextDueAt, forwarded, declined, incidentsRaised }`, shaped exactly
  like `DrainResult`. One pass; the cadence is the caller re-invoking on `nextDueAt`, DB-driven, never
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
- **`payments`** — the lifecycle row, one per electronic tender:
  - `id`, `tenant_id`, `working_order_id` (FK→core, the pre-sale key), `sale_id` (**nullable** FK→core,
    set post-commit — the Option B linkage), `provider`, `payment_ref` (opaque processor reference /
    idempotency anchor), `authorized_amount`, `captured_amount`, `tip_amount`, `offline` (bool),
    `settled_at`, `state`, timestamps, and a `reconcile_remediated_at` marker (bounds orphan
    remediation, exactly as `envios.reconciled_resubmit_at` bounds the fiscal self-heal).
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

## 10. Decomposition into implementation plans

This spec is large, like the fiscal spec (which became 3a / 3b / reconcile-resolution). Proposed
sequence, for `writing-plans` to structure — each plan is its own spec→plan→implement→land cycle,
sharing this design:

- **4a — neutral seam + online happy path.** `packages/payments` scaffold (GENERIC_PACKAGES + guards),
  the interface, `PaymentResult` / state types, `FakeProvider`, the schema + migrations + RLS/grants,
  and the `sale_id` associate-back linkage. Proven end-to-end via `collect → recordSale` with the fake:
  `collect` / `void` / `refund` / `partialRefund` online.
- **4b — Stripe Terminal adapter.** `packages/payments-stripe` (EXEMPT), `StripeTerminalProvider` for
  the online methods against the Stripe Terminal SDK.
- **4c — offline store-and-forward.** `allowOffline` opt-in, `accepted_offline`, the amount cap,
  `payment_policy`, `forward()`, decline→incident.
- **4d — reconcile.** The four mismatch classes, orphan self-heal, idempotent incidents, in-flight
  tolerance.
- **4e — tab/tip lifecycle methods.** `preAuth` / `incrementalAuth` / `tipAdjust` — built + faked +
  tested now (full surface), with their tab/tip **UI** deferred to sub-projects 10 / 13.

---

## 11. Non-goals (this sub-project)

- **Not** a payment processor or acquirer; card data never passes through the app (architecture §12).
- **Not** the till/tab/tip **UI** — sub-project 7 (counter POS), 10 (tabs), 13 (tips).
- **Not** the role/permission gate on refunds/voids — sub-project 5 (identity); the seam is left for it.
- **Not** the `forward`/`reconcile` **scheduler** — an `apps/*` concern, like the fiscal scheduler.
- **Not** a second provider (Adyen/SumUp) — the split exists so they cost an adapter, not an interface
  change, but only Stripe Terminal is built here.
- **Not** EU consumer-card surcharging (banned) or mandatory service charges (architecture §12).
