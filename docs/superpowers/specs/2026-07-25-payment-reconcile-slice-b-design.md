# Payment `reconcile()` — Slice B: the Stripe adapter (design)

**Date:** 2026-07-25 · **Main at design time:** `978d5e5` (reconcile Slice A landed, PR #28)

Slice A built the provider-neutral sweep
([`2026-07-25-payment-reconcile-design.md`](./2026-07-25-payment-reconcile-design.md)) and left the
vendor half as three injected ports. This slice implements them for Stripe, so the audit runs
against a real processor for the first time.

Everything here lands in `packages/payments-stripe`. `packages/payments` is not touched — Slice A's
contract is consumed unchanged through its barrel, exactly as Mode 3 Slice B consumed Slice A.

---

## 1. `StripeReconciler` — one implementer per settlement identity

```ts
/** One tenant's Stripe account, as the sweep uses it: the read surface it audits against, and the
 * refund surface it hands money back through. */
export interface StripeReconcileAccount {
  report: StripeReportClient;
  refund: StripeRefunder;
}

export interface StripeReconcilerOptions {
  db: Database;
  /** The tenant's own Stripe account surfaces. A FUNCTION, not fixed clients: `reconcile(tenantId,
   * …)` varies the tenant per call while a reconciler is constructed once, and the accounts are
   * standalone (one per merchant — no Connect), so the resolved account IS the tenant scoping.
   * Mirrors `StripeTerminalProviderOptions.resolveReader`; provisioning stays deferred, as it has
   * since 2a. */
  resolveAccount: (tenantId: TenantId) => Promise<StripeReconcileAccount>;
  settlementLagMs?: number;
}

export class StripeReconciler implements PaymentReconciler {
  readonly provider = "stripe";
  reconcile(tenantId, period, now): Promise<PaymentReconcileResult>;
}
```

This shipped as `resolveAccount`, not the `resolveClient: (tenantId) => Promise<StripeReportClient>`
this section originally sketched. The report surface alone cannot refund anything, and the reversal
path (§5) needs a `StripeRefunder` for the SAME tenant the report was read for — so a second,
independent resolver was considered and rejected. Two resolvers would not make a mispairing
IMPOSSIBLE (an implementation could still hand back tenant A's report paired with tenant B's
refunder from two separately-called functions), but it would make avoiding that mispairing a second
invariant every future caller has to uphold by hand, at however many places the resolver gets
invoked from. Resolving both from one call makes the pairing a single decision, made once, at one
call site — a caller would have to go out of its way to mismatch two credentials it fetched together
in one place. `report` and `refund` stay two separately-named fields rather than one widened
interface for the reason §2 already gives for `StripeReportClient` itself: each seam names only the
calls its own consumer makes, so a future report-only implementer is never handed a money-moving
method to implement.

`provider = "stripe"` is the whole point of the seam: **one reconciler audits all three Stripe
adapters** — server-driven terminal (2a), on-device (2b) and hosted Checkout (Mode 3) — because all
three write that same `provider` id. `reconcile` is a constructor plus a delegation to
`reconcilePayments`, with the three ports wired below.

This is also how the port's tenant-scoping contract is honoured. Slice A's
`SettlementReportSource.fetch(tenantId, window)` requires an implementer to return only that
tenant's settlements; `resolveAccount(tenantId)` discharges it structurally, because a standalone
account contains exactly one tenant's money.

## 2. `StripeReportClient` — a fourth narrow seam

The package already has three narrow client seams (`StripeClient`, `StripeDeviceClient`,
`StripeHostedClient`), each with a `Fake*` double, a coverage-excluded real binding, and a nightly
sandbox suite. This adds the fourth, naming only the calls the audit makes:

```ts
export interface StripeReportClient {
  /** Settled charges in the window — the settlement ledger. */
  listSettlements(window: { from: Date; to: Date }): Promise<StripeSettlement[]>;
  /** Checkout Sessions created in the window, for the session↔PaymentIntent bridge and the hint. */
  listCheckoutSessions(window: { from: Date; to: Date }): Promise<StripeSessionRef[]>;
  /** The PaymentIntent behind one Checkout Session — the reversal path's resolver (§5). */
  paymentIntentForSession(sessionId: string): Promise<string | null>;
}

export interface StripeSettlement {
  paymentIntentId: string | null;
  chargeId: string;
  /** GROSS, in minor units — see §3's fee note. */
  amountMinor: number;
  settledAt: Date;
}

export interface StripeSessionRef {
  sessionId: string;
  paymentIntentId: string | null;
  hint?: { workingOrderId: string; paymentRef: string };
}
```

The real binding (`stripe-report-client.ts`) is coverage-excluded like its three siblings: a thin
call-mapping boundary whose logic is the SDK's, exercised by the nightly sandbox.

## 3. The report source — two paged passes

**Pass 1 — the settlement ledger.** `balanceTransactions.list({ created: {gte,lte}, type: "charge",
expand: ["data.source"] })`, paged to exhaustion. For a card charge Stripe writes the balance
transaction **at capture**, with `status: "pending"` and a future `available_on` — so a settlement is
visible within minutes, not after the 2–7 day payout cycle. That matters: `lostSettlement` (a missed
webhook) and `missingLocal` (an `initiate` crash) are the money-losing classes, and a payout-based
report would hide both for up to a week. The expansion yields the charge, and the charge yields
`payment_intent`.

> **Compare GROSS, never net.** `balance_transaction.amount` is the gross charge; `net` is after
> Stripe's fee. Our `payments.amount` is what the customer paid, so comparing against `net` would
> report **every single payment as `drift`**, by the fee. The mapping takes `amount`, and a test
> pins it with a settlement whose `net` differs from its `amount`.

**Pass 2 — the session bridge.** `checkout.sessions.list({ created: {gte,lte} })`, over a window
widened **backwards** by `Math.max(settlementLagMs, 24h)`: a session created before the period can
have its charge settle inside it, and an unmapped hosted payment reads as `unsettled` forever. Builds
`Map<paymentIntentId, { sessionId, hint }>`.

> **The floor is not decoration.** This widening measures *session-creation-to-charge* latency, which
> is bounded by Stripe's own 24-hour Checkout expiry — after which a session cannot be paid at all.
> `settlementLagMs` measures something else entirely: how long the **processor** may take to report a
> settlement, a tolerance the operator is meant to be able to tune *down*. Shipped as one option, the
> two were the same number, so lowering the tolerance to an hour would also narrow this lookback to an
> hour: every hosted payment whose session was created earlier loses its `cs_` reference, its local
> row reads as `unsettled` **forever**, and its settlement reads as `missingLocal` — two money-class
> findings manufactured by a knob that has nothing to do with either. `SESSION_LOOKBACK_FLOOR_MS`
> (24h) floors it, with a test pinning the short-tolerance case.

**Assembling each `SettlementRecord`:**

- `references` = `[paymentIntentId, chargeId]`, plus `sessionId` when the map has one. This is the
  list Slice A matches against `payments.external_ref` — a PaymentIntent id for terminal/on-device
  rows, a Checkout Session id for hosted ones. Every id that could be our stored reference goes in,
  resolved from Stripe's own data, so matching works even when our webhook never arrived.
- `amount` = `fromMinorUnits(amountMinor)` — the existing exact-integer inverse of `toMinorUnits`.
- `settledAt` = the balance transaction's created time.
- `hint` = the session's metadata, when present (§4).

Two paged calls per sweep, whatever the volume. Neither is per-record: the N+1 shape Copilot flagged
twice on Slice A is avoided here by construction, and a comment says so.

## 4. The hint — stamped by every mode that can produce a `missingLocal`

`SettlementRecord.hint` is what lets a `missingLocal` be attributed to a till and raise an incident
instead of being report-only. Today it is populated from `checkout.sessions.create({ metadata: {
working_order_id, payment_ref } })`, read straight off Pass 2's session list.

**Which modes need the stamp, precisely.** `missingLocal` means a settlement with *no local row at
all*, so only a mode that moves money **before** it writes can produce one:

| mode | ordering | can produce a `missingLocal`? |
| --- | --- | --- |
| terminal (2a) | commits an `attempting` row, *then* calls the network | **no** — a crash always leaves a row; that is exactly what `attempting` exists for |
| on-device (2b) | reads the offline policy, collects on the reader, *then* writes | **yes** |
| hosted (Mode 3) | creates the session, *then* writes the `initiated` row | **yes** |

This section originally said the stamp was hosted-only, "because terminal and on-device both commit an
`attempting` row before their network call". That is true of terminal and **false of on-device** —
`StripeOnDeviceProvider`'s own class doc says so in as many words ("no `attempting`-first … the
residual gap is reconcile's `missingLocal`") — and the mistake hid a real money-losing gap rather than
merely misdescribing one. An on-device tap succeeds; the process dies before the insert commits;
Stripe holds a captured charge we have no row for. The sweep finds the settlement, matches nothing,
and files it under `missingLocal` **with `hint: undefined`** — which `raiseMissingLocal` skips
outright. No till, no incident, nobody told: exactly the class the incident exists to prevent, for a
mode this document claimed could not reach it.

**So both network-then-write modes stamp the same keys.** `StripeDeviceClient.collectOnDevice` gained
the same `metadata: { working_order_id, payment_ref }` parameter `StripeHostedClient
.createCheckoutSession` has, in the same Stripe-side snake_case, stamped onto the PaymentIntent the
device creates. Terminal does not, and cannot need to.

**What is still deferred is the READ side for on-device, and only that** (§7). A session's metadata
comes free with Pass 2's session list; PaymentIntent metadata does **not** propagate to the charge, so
reading an on-device stamp back needs an `expand: ["data.source.payment_intent"]` level on Pass 1's
main list call. Until that lands, an on-device `missingLocal` is reported but **unattributed**.
Stamping the write half now means that expand is the only piece left, rather than a second change to a
money-moving seam later.

This means both client seams, both fakes and both real bindings carry the parameter. The real
on-device binding still throws (the collect runs in the device SDK — SP7/SP9); its doc records that
the bridge must forward the metadata onto the PaymentIntent it creates, or the stamp is not there to
read when the expand arrives.

## 5. The reversal — an additive resolver hook

Slice A §11 recorded that a hosted orphan's auto-reversal always fails: `reverseViaStripe` addresses
the processor with the payment's `external_ref`, which for a hosted row is a Checkout Session id, and
`stripe.refunds.create` wants a PaymentIntent. The sweep therefore stamped the marker, failed, and
raised a permanent `payment.reconcile_remediation_failed` — for the very mode reconcile most exists
to protect.

Slice B resolves session→PaymentIntent anyway, so it closes that gap:

```ts
export async function reverseViaStripe(
  db, client, provider, ref, kind, amount?,
  /** The optional tail, gathered into one object rather than two more positional parameters (they
   * are unrelated to each other, so no ordering between them reads naturally). */
  {
    /** The tenant whose payment is being reversed. Supply it whenever `db` is not already a
     * tenant-scoped handle; omit it to get the bare `db.transaction()` this has always used —
     * see the defect note below for why that default is correct for the two interactive
     * providers and wrong for `StripeReconciler`. */
    tenantId,
    /** Maps a stored `external_ref` to the id the processor's refund API needs. Defaults to
     * identity, so the terminal and on-device callers are unaffected. */
    resolveProcessorRef = async (externalRef) => externalRef,
  }: { tenantId?: TenantId; resolveProcessorRef?: (externalRef: string) => Promise<string> } = {},
): Promise<PaymentResult>;
```

`StripeReconciler` passes a resolver that calls `paymentIntentForSession` for a `cs_`-prefixed
reference and returns everything else unchanged. **Additive and default-identity**, so the two
existing callers keep their exact behaviour — deliberate, because this is shared money-path code and
the last cross-cutting change to a shared primitive in this package (PR #25's index) is the bug this
repo most regrets.

A session that resolves to no PaymentIntent (never paid) throws `payment.not_found`, which the sweep
already handles: one aggregated `reconcile_remediation_failed`, marker stamped, not retried.

### The defect the RLS suite caught: a bare `db.transaction()` sets no tenant GUC

This section originally sketched only the resolver hook and assumed the existing `db.transaction()`
calls inside `reverseViaStripe` needed no change. They did. This is the single most important thing
this slice learned, so it is recorded here, not only in the commit that fixed it.

`reverseViaStripe`'s two database phases (the `findPaymentByRef`/`assertReversible` pre-check, and
whichever of `recordRefund`/`recordVoid`/`recordFailedRefund` follows) both opened a bare
`db.transaction(...)`. That sets **no** `app.tenant_id` GUC at all — only `withTenant` does that,
via `set_config(..., true)` from inside the transaction it itself opens. For the two interactive
providers (`StripeTerminalProvider`, `StripeOnDeviceProvider`) that was always fine: their own `db`
handle is documented to already be tenant-scoped, and a bare `db.transaction()` inside an
already-tenanted call chain is harmless.

`StripeReconciler` breaks that assumption. Its own `db` is a **plain, unscoped** handle by
construction — the neutral `reconcilePayments` opens its own `withTenant` transactions around its
own T1/T2 phases and hands the `reverse` callback nothing but a payment ref, so nothing upstream of
`reverseViaStripe` had ever set the GUC. Under a real non-superuser role, that meant
`findPaymentByRef` ran with `current_tenant_id()` NULL, the `payments` tenant-isolation policy
matched **zero rows**, and the reversal failed closed with `payment.not_found` — for the exact
payment the sweep had just found moments earlier. Silently and permanently: the remediation marker
is stamped before the reversal is attempted (§4's ordering), so every hosted-orphan (and, in fact,
every) auto-reversal driven through `StripeReconciler` would fail closed on its first and only try,
in production, under any real deployment with RLS enforced. No PGlite test could show this — PGlite
connects as superuser and bypasses `FORCE ROW LEVEL SECURITY` outright, so the untenanted transaction
read the row regardless and every hermetic test passed throughout. Only `reconcile.rls.test.ts`,
built for this slice specifically to drive the sweep as a genuine `app_user` member, caught it.

The fix: `reverseViaStripe` now takes the optional tail shown above carrying `tenantId`. Supplied,
both database phases route through `withTenant(db, tenantId, ...)` instead of the bare
`db.transaction(...)`; omitted, behaviour is byte-for-byte what it always was. `StripeReconciler` is
the one caller that supplies it, threading the tenant down from its own `reconcile(tenantId, …)`
argument — the scope a reversal runs under is the scope the sweep was asked for, never anything
ambient. The two interactive providers pass nothing, deliberately: their handle is already scoped,
and adding `tenantId` there would just wrap an already-tenanted connection in `withTenant` a second
time for no benefit. Additive, default-preserving, and — like the resolver hook two paragraphs up —
chosen over touching the two existing call sites precisely because this is shared money-path code.

### The tenant predicate on the reversal lookup

`findPaymentByRef` is deliberately untenanted — the `PaymentProvider` reversal methods carry only a
`paymentRef` — which left it the one query on the reconcile path that goes on to **move money** while
relying on RLS alone. Its two siblings on that path, `listReconcilable` and `existingReferences`, each
carry an explicit `tenant_id` predicate on top of RLS as documented defence-in-depth, for connections
that are not RLS-enforcing: a superuser, a `BYPASSRLS` role, or a future pooled handle whose GUC was
never set.

With `tenantId` now in hand, `reverseViaStripe` applies the same predicate: a found row whose
`tenantId` differs is `payment.not_found` — the same answer as a row that does not exist — thrown
before the processor is called or any local state is touched. Omitting `tenantId` (the two interactive
providers) keeps the historical behaviour byte-for-byte. It is one comparison, and it is also the
cheapest deterministic answer to this branch's "no two-tenant test" gap: PGlite connects as superuser
and bypasses `FORCE ROW LEVEL SECURITY`, so the lookup genuinely returns the other tenant's row and
what rejects it is the predicate and nothing else — which is precisely the condition the predicate
defends.

## 6. Testing

Mirrors the three sibling adapters. This section describes what actually shipped — an earlier draft
named a test file that does not exist and two assertions that were never written:

- **`FakeStripeReport`** in `src/testing/` (not barrel-exported): configurable settlements, sessions
  and session→PI mappings, recording the windows it was asked for so the lag-widening is assertable.
  Its own `fake-stripe-report.test.ts` pins those controls.
- **`report-source.test.ts`** — reference assembly (PI + charge; session id added when one maps; a
  null PI omitted rather than emitted as a null id), `fromMinorUnits` exactness on amounts a float
  would mangle, hint mapping, the backwards-widened session window, its **24h floor** under a short
  settlement tolerance, and an empty report inventing nothing. The **gross-not-net** choice and
  **paging to exhaustion** live in `stripe-report-client.ts`, which is coverage-excluded and has no
  hermetic test: both are asserted there by construction (`bt.amount`, `autoPagingEach`) and by
  comment, not by an assertion. `StripeSettlement` carries no `net` field at all, so no fake could
  distinguish them.
- **`reconciler.test.ts`** — `StripeReconciler` drives the REAL `reconcilePayments` against PGlite
  with a fake client: the provider id; a terminal row matched by PaymentIntent; a hosted row matched
  by session id (landing as `lostSettlement`, proving the bridge); an unmatched settlement becoming
  `missingLocal`; `settlementLagMs` reaching BOTH windows from one option; `resolveAccount` called per
  sweep; a hosted orphan auto-reversed via session→PI resolution; a terminal orphan passed through
  unresolved; and an unpaid session's reversal failing once and never retrying. The **hinted**
  `missingLocal` → incident path is not re-proven here — it is the neutral sweep's own logic and
  `packages/payments`' suite covers it; this adapter's job is to deliver the hint, which
  `report-source.test.ts` asserts.
- **`provider.test.ts` additions** (not a `reverse.test.ts` — no such file exists; the reversal
  helper's tests live with the terminal provider that first shipped it) — the resolver hook: the
  identity default passes a stored ref through untouched, a supplied resolver maps `cs_` → `pi_`
  before the refund, and resolution happens only AFTER the local reversibility pre-check; plus the
  tenant predicate above, which refuses another tenant's payment without reaching Stripe and still
  reverses the owner's.
- **`reconcile.rls.test.ts`** — the sweep through `StripeReconciler` under a non-superuser role on
  real Postgres, mirroring the sibling RLS suites. This is the suite that caught the tenant-GUC
  defect above — no PGlite test could have, since PGlite's superuser connection bypasses `FORCE ROW
  LEVEL SECURITY` and so cannot distinguish a tenanted transaction from an unscoped one.
- **`reconcile.sandbox.test.ts`** — nightly, env-gated on `STRIPE_SECRET_KEY`, excluded from PR runs
  by the `*.sandbox.test.ts` glob. Three cases: a real test-mode Checkout Session created with
  metadata is read back with that metadata as the `hint`; `paymentIntentForSession` returns `null` for
  an abandoned checkout; and `listSettlements` issues a **well-formed** balance-transaction query.
  That last one is a smoke assertion (it resolves to an array) and is deliberately so: a genuinely
  settled charge needs a completed card payment, which no headless test can drive, so the mapping's
  *output* stays proven only against `FakeStripeReport`. What it does prove is the failure this
  binding actually has — a wrong or dropped `expand: ["data.source"]` makes every record fail the
  `charge.id` guard and `listSettlements` silently returns `[]`, reading exactly like a quiet day
  while every local payment turns `unsettled` and every real settlement `missingLocal`. Stripe rejects
  a malformed `expand`/`type`/`created` shape with `StripeInvalidRequestError`, so the request being
  accepted is the one headless check available against that class of bug.

Coverage gate 98/98/98/95, with `stripe-report-client.ts` excluded like its three siblings.

## 7. Out of scope

- **Reading the on-device attribution hint back — a KNOWN UNATTRIBUTED PATH, not an impossible one.**
  On-device (2b) collects before it writes, so it can produce a `missingLocal` (§4), and its create now
  stamps `working_order_id`/`payment_ref` onto the PaymentIntent. The audit still cannot see them:
  PaymentIntent metadata does not propagate to the charge, so Pass 1 would need an
  `expand: ["data.source.payment_intent"]` level on its main list call — a change to the money-reading
  path that deserves its own review of cost and paging behaviour, not a rider on this slice. **Until it
  lands, an on-device settlement whose local row was never written is reported in `missingLocal` with
  `hint: undefined`, and `raiseMissingLocal` skips it: no till, no incident.** It is visible only in
  the sweep's returned result. This is the one class of money-losing gap this slice leaves open
  knowingly, and it is written down here rather than left implied by a comment.
- **An unattended full refund can record an amount that is not the amount that moved.**
  `StripeReconciler.reverse` calls `reverseViaStripe` with no `amount`, so `client.refund` sends none
  and Stripe refunds the **full PaymentIntent** — the processor's figure — while `recordRefund` writes
  **our** stored amount. On a drifting orphan the two differ. Abandoned working order, local
  `payments.amount` 12.00, processor's balance transaction 10.00: the sweep claims it, 10.00 goes back,
  we record a 12.00 refund and mark the payment `refunded`. Our books say the customer is whole while
  2.00 of their money is still ours — and the row has now left the audited state set, so no later sweep
  re-examines it. It is *visible*: the same sweep raises a `drift` incident carrying both figures. But
  the reconciliation record itself is wrong. The better fix is to send the amount explicitly even on a
  full refund, so processor and books agree by construction; it is deferred rather than done here
  because `reverseViaStripe` is shared money-path code with two other adapters and changing what it
  sends to the processor wants its own review. The neutral spec's §5 (`A drifting orphan is still
  reversed…`) has been corrected to describe this accurately; the corresponding code comments in
  `packages/payments` (`reconcile.ts`'s claim loop, `errors.ts`'s `reconcile_drift` doc) still say
  "reversed at OUR amount" and should be corrected alongside the fix.
- **The scheduler** — still an `apps/*` concern; `reconcile(tenantId, period, now)` is called by
  someone else.
- **Provisioning** `resolveAccount` (per-tenant keys), exactly as `resolveReader` and the hosted
  config have been deferred since 2a.
- **Disputes and refunds as settlement rows.** Pass 1 filters `type: "charge"`, so a dispute or a
  refund balance transaction is not audited. Reconciling those is its own concern and needs its own
  mismatch semantics.
- **Multi-currency** — `CURRENCY = "eur"` remains hardcoded across this package under the
  single-currency-per-tenant rule.
- **Slice A's carried items** (the two-snapshot read, persisting `remediationFailures`, the
  `settled`-state reversal gap) are unchanged by this slice.
