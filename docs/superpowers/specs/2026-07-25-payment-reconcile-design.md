# Payment `reconcile()` — the read-side backstop (design)

**Date:** 2026-07-25 · **Main at design time:** `a77a52d` (Mode 3 complete)

This is the cross-cutting `reconcile()` the payment-layer umbrella design
([`2026-07-22-payment-layer-design.md`](./2026-07-22-payment-layer-design.md)) sketches in §6 — the
former "4d". It supersedes §6's four-class sketch where the two disagree, and §3's placement of
`reconcile` on `PaymentProvider`; both divergences are argued below.

It is **load-bearing now that Mode 3 has landed.** Async/hosted payments are the only mode that can
silently lose money: a missed or late webhook, or a crash in `initiate`'s window between minting a
hosted session and writing the local row, has no safety net until this exists.

---

## 1. Where `reconcile` lives — a third interface, not `PaymentProvider`

§3 sketched `reconcile` as a `PaymentProvider` method, next to `forward`. **It goes on its own
interface instead**, for three reasons that only became visible once Mode 3 landed:

1. **A hosted-only deployment would never be swept.** `StripeHostedProvider` implements
   `AsyncPaymentProvider`, not `PaymentProvider`. A tenant running QR pay-at-table with no counter
   terminal has no `PaymentProvider` instance at all — so the mode that most needs the backstop
   would be the one mode without it.
2. **Reconcile is scoped per settlement identity, not per capture mechanism.** All three Stripe
   adapters (`StripeTerminalProvider`, `StripeOnDeviceProvider`, `StripeHostedProvider`) write
   `provider = "stripe"`. One sweep over `provider = 'stripe'` audits all of them. A method on each
   adapter means either three copies of one algorithm, or two redundant sweeps and an ambiguous
   "which instance do I call?".
3. **The precedent is three weeks old.** Mode 3 deliberately introduced `AsyncPaymentProvider`
   rather than bolting `initiate` onto `PaymentProvider`, because a required method breaks every
   adapter that cannot honour it. Same argument, same answer.

```ts
/** The audit seam: one implementer per SETTLEMENT IDENTITY (per `provider` id), never one per
 * capture mechanism. `StripeReconciler` covers terminal, on-device and hosted payments in a single
 * pass because all three write `provider = "stripe"`. Manual mode implements nothing — its audit is
 * external (the bank's own settlement report). */
export interface PaymentReconciler {
  readonly provider: string;
  reconcile(
    tenantId: TenantId,
    period: ReconcilePeriod,
    now: Date,
  ): Promise<PaymentReconcileResult>;
}
```

`now` is a third argument, where §6 sketched two. It mirrors `forward(now)` exactly: the sweep needs
a clock for the in-flight tolerance and for `detectedAt`, `packages/payments` carries no
`TrustedClock` (that lives in `@waitron/fiscal`, a dev dependency here), and an injected `now` is
what makes the tolerance boundary deterministically testable.

## 2. Where the logic lives — neutral sweep, vendor ports

Fiscal put its whole sweep in the adapter package (`fiscal-verifactu/src/reconcile.ts`). That was
right there — one regime, one implementation, no fake reimplementing it. **It is wrong here**,
because ~90% of this sweep is provider-neutral (the local queries, the five mismatch classes, the
tolerance, the marker, the incidents) and only two things are vendor work: *fetching the settlement
report* and *issuing a reversal*. Duplicating money-critical classification between a fake and a
Stripe implementation would mean the tests that prove the classes never run the code that ships.

So `reconcilePayments()` lives in `packages/payments` and owns the algorithm; the vendor supplies
three narrow ports.

```ts
/** The processor's settlement / payout report for a window — the vendor half of the audit. The
 * neutral seam never names payouts, balance transactions or any vendor concept.
 *
 * An implementer MUST return only the settlements belonging to `tenantId`'s settlement identity.
 * The tenant is an ARGUMENT rather than something the source binds at construction, because a
 * `ReconcileDeps` is built once and swept across many tenants (`reconcile(tenantId, …)` varies it
 * per call) while a processor account may well be shared between them — provisioning is not decided
 * yet. A source that could not see the tenant would return the whole account's settlements, and
 * every OTHER tenant's settlement would then fail this tenant's targeted existence check and land in
 * `missingLocal`: other people's money in the sweep's authoritative result, on every run. */
export interface SettlementReportSource {
  fetch(tenantId: TenantId, window: ReconcilePeriod): Promise<SettlementRecord[]>;
}

/** One settlement the processor says actually cleared.
 *
 * `references` is a LIST, not a single id, and that is load-bearing: our `external_ref` is a
 * PaymentIntent id for terminal/on-device payments but a Checkout Session id for hosted ones, while
 * settlement data keys by charge / PaymentIntent and never by session. A single-keyed record would
 * make every hosted payment read as `unsettled` forever and every hosted settlement read as
 * `missingLocal` — reconcile would be actively wrong for the exact mode it exists to protect. The
 * adapter therefore emits every processor id that could match a local `external_ref`, resolved from
 * the processor's own data, so matching works even when our webhook never arrived. */
export interface SettlementRecord {
  references: string[];
  amount: Decimal;
  settledAt: Date;
  /** Our own identifiers, when the processor carried them back (adapters stamp them into
   * processor-side metadata at create time). Present = a settlement with no local row can still be
   * attributed to a till and raise an incident; absent = report-only. */
  hint?: { workingOrderId: string; paymentRef: string };
}

/** Reverse one payment in full at the processor — the orphan self-heal. The adapter chooses void vs
 * refund. Throws when the payment cannot be addressed (e.g. a hosted payment, whose stored
 * `external_ref` is a session id — see §9). */
export type ReversalFn = (paymentRef: string) => Promise<void>;

/** Raise an incident, deduplicated per open `(tenant, till, code, sale)`. Typed structurally rather
 * than imported, so `@waitron/core` stays a DEV dependency of this package (the Cycle A boundary);
 * `recordIncidentOnce` is assignable to it verbatim. */
export type IncidentSink = (
  tx: Transaction,
  input: {
    tenantId: TenantId;
    tillId: TillId;
    saleId?: SaleId;
    error: AppError;
    severity: "warning" | "error";
    detectedAt: Date;
  },
) => Promise<boolean>;
```

```ts
export interface ReconcileDeps {
  db: Database;
  provider: string;
  report: SettlementReportSource;
  reverse: ReversalFn;
  incidents: IncidentSink;
  /** How long after OUR settlement the processor may legitimately take to report it. */
  settlementLagMs: number;
}
export const DEFAULT_SETTLEMENT_LAG_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function reconcilePayments(
  deps: ReconcileDeps,
  tenantId: TenantId,
  period: ReconcilePeriod,
  now: Date,
): Promise<PaymentReconcileResult>;
```

`StripeReconciler` (Slice B) is then a constructor and a delegation.

## 3. The period contract

```ts
/** Half-open [from, to). A daily sweep is yesterday; a monthly one is the 1st to the 1st. */
export interface ReconcilePeriod {
  from: Date;
  to: Date;
}
```

A date range rather than fiscal's `{year, month}`, because payments settle continuously and the
cadence is daily. It also keeps the filter comparable directly against the timestamp columns — no
`to_char()` wrapper (the deferred fiscal-side complaint, avoided here).

**Sargability is not free just because the wrapper is gone.** The two auditable state groups anchor
on two *different* columns (`captured`/`settled` on `settled_at`, `initiated` on `created_at`), and
only `settled_at` is indexed (`payments_reconcile_idx`). Expressed as one `OR`, the planner needs a
usable index on **both** arms to build a BitmapOr; with none on `created_at` it takes neither, and
the sweep degrades to scanning the tenant's whole payments history every night. So `listReconcilable`
issues **two queries** and merges them (§8) rather than adding a second index to a hot write path:
the `captured`/`settled` arm then uses `payments_reconcile_idx` fully, and the `initiated` arm uses
its leading `(tenant_id, provider)` columns over a set that is small and short-lived by nature.

**Two windows, not one.** Our capture time and the processor's settlement time are days apart, so:

- local rows are selected by **our** timestamp within `[from, to)`;
- the report is fetched over the **wider** `[from, to + settlementLagMs]`;
- `unsettled` only escalates for rows whose `settled_at < now - settlementLagMs`.

The wider fetch cannot manufacture false `missingLocal`s, because an unmatched report entry gets a
**targeted existence check across all time and all states** before it is classified (§5).

Fiscal's structural tolerance (a `pendiente` record absent from AEAT is in-flight) cannot be reused:
a captured payment is in a terminal local state yet still legitimately days away from settling. The
tolerance here has to be a real duration, and it is a vendor property, so it is a reconciler option.

## 4. The sweep — T1 → network → T2 → remediation

```text
T1  withTenant, short read tx
      listReconcilable(tx, provider, period)   -- rows + their working order + till
    ↓
NET report.fetch({ from, to: to + settlementLagMs })     -- outside every transaction
    ↓
    classify (pure, no I/O)                   -- five classes over rows × report index
    ↓
T2  withTenant, short write tx
      targeted existence checks for unmatched report entries
      aggregate incidents (one per till × class)
      stamp reconcile_remediated_at on remediable orphans
    ↓
NET for each remediable orphan: reverse(paymentRef)      -- outside every transaction
      on failure → one idempotent remediation-failed incident (its own short tx)
```

Two deliberate divergences from the fiscal sweep:

- **The network call is never skipped**, even when T1 read zero rows. Fiscal returns `checked: 0`
  without contacting AEAT because a record it has no trace of cannot exist. Here, zero local rows
  plus a report full of settlements *is* the silent-data-loss case (a tenant whose every webhook was
  missed). Skipping would blind the sweep to exactly what it is for.
- **The marker is stamped BEFORE the reversal network call**, not after. There is no persisted
  per-reversal idempotency key yet (the known deferred gap), so a crash between "refund succeeded at
  the processor" and "we recorded it" would let the next sweep refund again. Stamping first makes
  the failure mode *under*-remediation with an open incident a human can see, never a double refund.

## 5. The five mismatch classes

§6 names four and folds the missed webhook into `missingLocal`. Those are two different states with
two different remedies, so this design splits them:

| class | condition | remedy |
| --- | --- | --- |
| `unsettled` | local `captured`/`settled`, no report entry, and `settled_at < now - lag` | incident (warning) |
| `lostSettlement` | local `initiated`, report says it settled — the missed/late webhook, the true `lostAck` twin | incident (error) |
| `orphan` | local `captured`/`settled`, `sale_id` null, working order `settled` or `abandoned` | incident (error); auto-reversed only when the order is `abandoned` **and** the payment is still `captured` |
| `missingLocal` | report entry matching no local row at all, at any time — the `initiate`-crash case | incident when attributable via `hint`, else report-only |
| `drift` | matched, but the processor settled a different amount | incident (error); the amount is never auto-corrected |

Rules that are not obvious from the table:

- **A row may fall into more than one class.** An orphan whose settlement has not appeared yet is
  both `orphan` and `unsettled`. Fiscal's three classes are mutually exclusive; ours are independent
  predicates, and the result lists reflect that honestly rather than picking a winner.
- **An `initiated` row with no report entry is not a mismatch** — an unpaid or abandoned hosted
  payment is ordinary, and the `expired` webhook handles it.
- **A `lostSettlement` is not auto-healed.** Advancing `initiated → captured` would need `recordSale`
  to chain the sale, and that orchestration is app-level and deferred; advancing without it would
  just manufacture an orphan the next sweep auto-refunds. The incident carries the working order and
  `payment_ref` so a human or the later orchestrator can complete it.
- **A hinted `missingLocal` resolves its till through the hinted working order**, the same lookup
  every other class uses; an unhinted one has no working order and so no till, which is exactly why
  it stays report-only.
- **`checked`** is the number of LOCAL rows examined (T1's row count), not the number of report
  entries — so a sweep that finds a settlement for a tenant with no local rows reports
  `checked: 0` alongside a non-empty `missingLocal`.
- **`accepted_offline` rows are out of scope** — that queue is `forward()`'s, not reconcile's.
- `voided`/`refunded`/`partially_refunded`/`failed` rows are not audited, but the targeted existence
  check still sees them, so their settlements never read as `missingLocal`.

### Orphan remediation is bounded by working-order status

§6 says auto-refund every orphan. That is safe on an **abandoned** working order — no sale exists,
so money was taken with no invoice and a refund is unambiguously right. It is **not** safe on a
**settled** one: a sale exists, so the orphan may simply be a lost associate-back (the payment paid
that very invoice and the association write failed), and auto-refunding hands back money the
customer legitimately owes while the immutable fiscal record still says paid.

So: **abandoned → reverse + incident + marker; settled → incident only.** Both are reported in the
result either way. Choosing wrong is irreversible in one direction only, and reconcile refuses to
guess in that direction.

### …and by the payment's own state: `captured` only

The working-order status is a *policy* bound. There is a second, *mechanical* one: **a `settled`
payment is not reversible at all.** The reversal pre-check accepts `captured` for a void and
`captured`/`partially_refunded` for a refund; `settled` is in neither set, and the local state
machine has no path out of `settled` whatsoever.

`listReconcilable` admits `settled` (it must — a forwarded offline tender is money we hold and has to
be audited), and the orphan predicate is local-only, so a `settled` orphan on an abandoned order is a
real, reachable shape: a mode-2b tender accepted offline, its `recordSale` lost, `forward()` advances
it `accepted_offline → settled`, staff abandon the order. Claiming it would stamp the marker, fail
the reversal, raise one `remediation_failed` incident — and, because the marker is permanent by
design, guarantee no later sweep ever retries it. The customer's money would be kept for good.

So the claim is gated on `state === "captured"` as well, and a `settled` orphan is reported and
incident-raised only, exactly like a `settled`-working-order orphan. The gate comes out when — and
only when — `settled` gains a reversal path.

### A drifting orphan is still reversed — and the two amounts can disagree

`drift` is never auto-*corrected*, but the claim loop does not consult it: a row that classified both
`orphan` and `drift` is still reversed, in full. Skipping it would leave the *whole* amount unreturned
in a case where returning it is otherwise unambiguously right, which is strictly worse for the
customer; and the sweep raises the `drift` incident alongside the `orphan` one, carrying both figures,
so the residual difference is visible to whoever settles it.

**What "in full" means at the processor is not what it means in our books, and this section used to
say otherwise.** `ReversalFn` takes no amount, so the adapter sends none — and a processor given no
amount refunds **its own** notion of the full payment. In `packages/payments-stripe` that is
`stripe.refunds.create` with no `amount`, i.e. the whole PaymentIntent at the **processor's** figure,
while `recordRefund` writes the amount **we** stored. On a non-drifting payment the two are the same
number and nothing is visible. On a drifting one they are not:

> Local `payments.amount` 12.00, processor's balance transaction 10.00. The sweep claims the orphan,
> **10.00** goes back, and we record a **12.00** refund and mark the payment `refunded`. Our books say
> the customer is whole; 2.00 of their money is still ours. The row has also left the audited state
> set, so no later sweep re-examines it.

Reversing at *our* figure deliberately — passing the amount we recorded — is not the fix either, for
the reason this section always gave: that would mean handing back a number our own books chose over
one the processor's ledger disagrees with, which is the very thing `drift` exists to escalate. The fix
is to send the amount **explicitly** so the processor and our record cannot silently diverge, and to
let the drift incident carry the disagreement as it already does. That is deferred and wants its own
review: `reverseViaStripe` is shared money-path code with three callers, so changing what it sends to
the processor is not a rider on an adapter slice. Recorded in the Slice B spec's §7. The code comments
that still say "reversed at OUR amount" (`reconcile.ts`'s claim loop, `errors.ts`'s
`payment.reconcile_drift` doc) are accurate about the *local* record and wrong about the processor;
they get corrected with the fix.

The `reconcile_remediated_at` marker bounds the *attempt*, not the outcome: it is stamped whether
the reversal then succeeds or fails, so a permanently-unrefundable orphan cannot start a
refund-retry storm on every sweep. (The state machine also bounds it — a reversed payment leaves the
audited state set — but a *failed* reversal leaves the row `captured`, which is exactly the case the
marker exists for.)

## 6. Incidents are aggregated per (till × class)

The `incidents_open_dedup` index is `(tenant_id, till_id, code, sale_id) NULLS NOT DISTINCT WHERE
acknowledged_at IS NULL`. Orphans, `lostSettlement`s and `missingLocal`s all have **no sale_id**, so
N of them on one till collapse into one open incident — the exact landmine PR #25's whole-branch
review caught in `chain.verification_failed`.

The fix is the one that worked there: **aggregate deliberately**. One incident per `(till, class)`
whose `params` carry the list, rather than N same-key rows racing for one slot. Applied uniformly to
all five classes, so there is one rule, and no class can collapse silently.
`payment.reconcile_remediation_failed` aggregates the same way and for the same reason: every payment
it reports is an orphan whose reversal this sweep attempted, and an orphan is by definition a payment
with a null `sale_id` — so N per-payment incidents raised across one till's failed reversals would
collapse under the same `(tenant, till, code, sale_id)` dedup index, silently dropping every failure
but the first.

```ts
"payment.reconcile_unsettled":     { payments: [{ paymentRef, amount, settledAt }], count };
"payment.reconcile_lost_settlement": { payments: [{ paymentRef, amount, workingOrderId }], count };
"payment.reconcile_orphan":        { payments: [{ paymentRef, amount, workingOrderId,
                                                  workingOrderStatus, remediating }], count };
"payment.reconcile_missing_local": { settlements: [{ references, amount, settledAt, paymentRef }], count };
"payment.reconcile_drift":         { payments: [{ paymentRef, captured, settled }], count };
"payment.reconcile_remediation_failed": { payments: [{ paymentRef, amount, reason }], count };
```

Structured `code` + `params`, never prose — the localisation rule. Severity is `warning` for
`unsettled` (money that has not cleared *yet*) and `error` for the other four, mirroring how fiscal
splits `drift_errores` from `no_trace`.

`incidentsRaised` counts **real inserts** using `recordIncidentOnce`'s did-it-insert return — the
deferred item from #25, finally consumed.

**Known limitation, documented not hidden:** because dedup is `ON CONFLICT DO NOTHING`, a second
sweep that finds a *new* mismatch of a class whose incident is still open will not extend that
incident's `params`. The authoritative, complete list is always `PaymentReconcileResult`, which the
(deferred) scheduler logs; the incident is the till-facing *signal*. Upserting params would mean
changing a shared `@waitron/core` primitive — precisely the cross-cutting change #25 taught us to
isolate — so it is deferred rather than smuggled in here.

That "the result is authoritative" claim has to be *true for all six codes*, and for the sixth it
took a result field to make it so. The five mismatch classes are re-derived from the database by
every sweep, so a dropped incident costs only the signal — the next run re-detects the condition and
re-reports it. `payment.reconcile_remediation_failed` is not like that: the payment it names carries
a permanent `reconcile_remediated_at` marker, so no later sweep will ever claim, attempt or re-report
it. A failure whose incident collided with an earlier still-open one would exist nowhere at all. So
the result carries **`remediationFailures: { paymentRef, reason }[]`** alongside the `remediated`
count, populated for every claimed orphan whose reversal this sweep attempted and lost.

**Residual limitation, stated honestly:** this makes the *sweep's own return value* complete, not the
system. Nothing in `packages/payments` persists `remediationFailures` — the field is only as durable
as whatever the (deferred, `apps/*`) scheduler does with the result it is handed. Until that
scheduler exists and logs it, a failure whose incident deduped away survives only in the calling
process. That is a real gap, and it is the scheduler's to close, not this package's.

## 7. The result

```ts
export interface PaymentMismatch {
  /** Null for a `missingLocal` — there is no local row to name. */
  paymentRef: string | null;
  references: string[];
  localState: PaymentState | null;
  /** Exact decimal strings, as read — no float, no normalisation. */
  localAmount: string | null;
  settledAmount: string | null;
  workingOrderId: string | null;
}

export interface PaymentReconcileResult {
  period: ReconcilePeriod;
  checked: number;
  unsettled: PaymentMismatch[];
  lostSettlement: PaymentMismatch[];
  orphan: PaymentMismatch[];
  missingLocal: PaymentMismatch[];
  drift: PaymentMismatch[];
  incidentsRaised: number;
  /** Orphans actually reversed this sweep. */
  remediated: number;
  /** Orphans this sweep CLAIMED and then could not reverse, with each one's structured reason.
   * Present because a claimed orphan is marked permanently and never re-examined, so unlike the
   * five mismatch classes this finding has no second chance — see §6. */
  remediationFailures: { paymentRef: string; reason: string }[];
}
```

A tenant with nothing to check answers all-empty / zeros — the same contract fiscal's
`ReconcileResult` gives.

## 8. Schema & store

**Migration `0009_payment_reconcile_marker`** (drizzle-generated; a nullable column plus a plain
index is expressible in the schema builder, unlike #25's hand-written partial unique index):

- `payments.reconcile_remediated_at timestamptz` — nullable, mirroring
  `envios.reconciled_resubmit_at`.
- `index payments_reconcile_idx on (tenant_id, provider, settled_at)` — the sweep's own filter. A
  plain non-unique index, so it cannot collide with any writer (the #25 lesson).

No new table, so no new `getTableConfig` block is needed; the existing `payments` block gains an
assertion for the new index.

New store functions:

- `listReconcilable(tx, provider, period)` — the T1 read: this provider's auditable rows
  (`captured`/`settled` by `settled_at`, `initiated` by `created_at`) joined to their working order
  for `status` and `till_id`, plus `reconcile_remediated_at`. **Two queries, one per state group,
  concatenated and merged on `(created_at, payment_ref)`** — see §3 for why an `OR` over the two
  anchor columns cannot use the index, and note the merge makes the ordering *more* deterministic
  than the single `ORDER BY created_at` it replaces (same-instant rows previously came back in
  whatever order the plan produced them). `created_at` is on `ReconcilableRow` for that merge.
- `anyPaymentWithReference(tx, provider, references)` — the targeted existence check, any state, any
  time.
- `markReconcileRemediated(tx, key, at)` — stamps the marker, matching only a row whose marker is
  still null, returning whether it stamped (the concurrency guard: two sweeps racing produce one
  reversal).

## 9. Testing

Same rigour as every payment cycle:

- `reconcile.test.ts` (PGlite) — every class; the tolerance boundary on both sides; equal vs
  differing amounts; orphan on an `open` order (not an orphan); abandoned → reversed; settled order →
  incident only; `settled` *state* on an abandoned order → incident only, not claimed, marker still
  null; the marker bounding a second sweep; `missingLocal` with and without a hint; zero local rows
  but a non-empty report; everything empty; the tenant reaching `report.fetch`; a failure recorded on
  the result when its incident dedups away.
- Every incident's declared `params` shape is asserted by at least one test — including
  `remediating`, both `true` (abandoned, claimed) and `false` (settled order) — so no declared field
  can be hardcoded or dropped without a test going red.
- `reconcile.rls.test.ts` (real Postgres, non-superuser probe role) — both `withTenant` scopes: the
  period read, the incident insert, and the marker UPDATE, proving the grants.
- `reconcile.concurrency.test.ts` (real Postgres) — two concurrent sweeps for one tenant: one
  incident, one remediation. Acquired-signal before racing, `release()` in `finally` (the CI-hang
  lesson).
- `reconcile.wiring.test.ts` — the capstone: collect → no `recordSale` → abandon the order → sweep →
  the reversal fired, the marker is set, and the incident is visible through `openIncidents`.
- `FakeSettlementReport` + `FakeReconciler` in `src/testing/`, **not** barrel-exported — the fake
  implements `PaymentReconciler` so the interface ships with a real implementer (no reserved
  surface), exactly as `FakeAsyncProvider` did for Mode 3. `FakeSettlementReport` records every
  `window` **and every `tenantId`** it was asked for, so both halves of the fetch contract are
  assertable.
- `no-provider-vocabulary.test.ts` stays green: "settlement report" is neutral; payout, balance
  transaction, session and PaymentIntent are not, and never appear in this package.
- One task owns `pnpm --filter @waitron/payments test:coverage` — the gate is CI-only, so it must be
  run locally before pushing.

## 10. The slice line

**Slice A (this plan) — `packages/payments` only.** The `PaymentReconciler` interface, the five
classes, the three ports, `reconcilePayments()`, the store queries, migration 0009, the
`payment.reconcile_*` codes, the fakes and the whole test suite above. Nothing vendor-specific; no
Stripe SDK call.

**Slice B — `packages/payments-stripe`. Landed.** `StripeReconciler`; a `stripeSettlementReport`
`SettlementReportSource` built on **balance transactions, not payouts** — a card charge's balance
transaction is visible within minutes of capture, while a payout cycles 2–7 days later, and
`lostSettlement`/`missingLocal` are exactly the money-losing classes a payout-based report would hide
for up to a week — expanding each to its charge and PaymentIntent and resolving Checkout Session ids
so hosted rows match; `working_order_id`/`payment_ref` metadata stamped for the `hint` by **both modes
that write their local row after the money moves** — hosted Checkout and on-device — since only such a
mode can leave a settlement with no local row at all, which is the case the hint exists to attribute.
Terminal (2a) cannot: it commits an `attempting` row *before* its network call. (An earlier version of
this line said on-device could not either; it can, and the on-device hint is stamped but not yet
readable — reading it needs an `expand: ["data.source.payment_intent"]`, since PaymentIntent metadata
does not propagate to the charge, so an on-device `missingLocal` is currently unattributed. Slice B
§7.) `reverse` wired to the shared `reverseViaStripe` through an additive `resolveProcessorRef`
resolver hook (§11 below), with the tenant threaded down so it works under real RLS. A nightly
`reconcile.sandbox.test.ts` covers the real balance-transaction/Checkout-session SDK boundary. Full
design:
[`2026-07-25-payment-reconcile-slice-b-design.md`](./2026-07-25-payment-reconcile-slice-b-design.md).

Build the report source against **`fetch(tenantId, window)`** (§2): it must return only that tenant's
settlements. With Connect that is the connected-account scope; with a shared platform account it is a
metadata/`tenant_id` filter on the expanded charges. Whichever provisioning model wins, the filter is
the adapter's job — the neutral sweep hands it the tenant precisely so it can do it, and a source
that ignores the argument fills every sweep's `missingLocal` with other tenants' money.

## 11. Out of scope

- **The scheduler / cadence** — an `apps/*` concern, exactly as the fiscal reconcile and `forward`
  schedulers are. The period is passed in.
- **Sale-chaining a `lostSettlement`** — app-level orchestration, deferred with the rest of it.
- **Self-healing a `missingLocal`** by inserting the missing payment row. The `hint` makes it
  possible later; this plan reports and raises.
- ~~**Hosted reversals.** A hosted payment's `external_ref` is a session id, so `reverseViaStripe`
  cannot address it.~~ **Closed by Slice B.** `reverseViaStripe` now takes an optional
  `resolveProcessorRef` hook; `StripeReconciler` supplies one that maps a Checkout Session id to its
  PaymentIntent via `paymentIntentForSession` before refunding, and passes every other reference
  through unchanged. A hosted orphan on an abandoned order is auto-reversed like any other orphan; only
  a session that resolves to no PaymentIntent at all (never paid — nothing to hand back) still raises
  `payment.reconcile_remediation_failed`, which is the correct outcome for that case, not a gap.
- **Multi-currency**, the **refund/void role-gate** (rides with identity, sub-project 5), and
  **stuck `accepted_offline` rows** (`forward()`'s domain).
- **Per-reversal idempotency at the processor** — still deferred, and this branch *raises its
  stakes*. `packages/payments-stripe`'s reversal path documents that same-reversal retry-safety is
  deferred, mitigated by "reconcile backstops Stripe-vs-local drift". Reconcile is now itself an
  unattended, scheduled caller of that path, so the mitigation is partly circular: the backstop and
  the second concurrent actor are the same component. What holds today is *local*, not remote —
  `markReconcileRemediated` is a single-row conditional UPDATE, so two concurrent sweeps produce
  exactly one claim (proven in `reconcile.concurrency.test.ts`), and the marker is stamped before the
  network call so a crash under-remediates rather than double-refunds. What is NOT covered is a
  reconcile reversal racing a *human* refund of the same payment, or a retry inside the vendor SDK:
  those need the persisted per-reversal idempotency key, which stays deferred and now has a second
  caller arguing for it.
- **Persisting `remediationFailures`** — the sweep returns them (§6); durably recording them is the
  deferred scheduler's job.
