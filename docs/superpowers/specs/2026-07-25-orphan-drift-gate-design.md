# Reconcile: don't auto-reverse a drifting orphan (design)

**Date:** 2026-07-25 · **Main at design time:** `daad1b1` (reconcile Slices A and B landed, PRs #28
and #29)

Slice A's sweep auto-reverses an abandoned orphan behind three gates
([`2026-07-25-payment-reconcile-design.md`](./2026-07-25-payment-reconcile-design.md)). This adds a
fourth: a row whose amount the same sweep has just classified as `drift` is reported, not reversed.

Everything here lands in `packages/payments`. `packages/payments-stripe` is not touched.

---

## 1. The problem this actually fixes

The Slice B handoff (`2026-07-25-payment-reconcile-a-and-b-landed.md`, untracked scratch since handoffs were gitignored — `git show 86229c8:docs/handoffs/2026-07-25-payment-reconcile-a-and-b-landed.md`) recorded a
mismatch on the reversal path and proposed a fix. The mismatch is real; the proposed fix is not the
right one, and the reasoning matters more than the change.

The mechanism: `reverseViaStripe` omits `amount` from the refund call when it has none
(`packages/payments-stripe/src/reverse.ts`), so Stripe refunds the whole PaymentIntent, while
`recordRefund` writes `found.amount` — ours. When those two figures disagree, the books and the
processor disagree, and the row leaves the audited state set (`captured` → `refunded`), so no later
sweep re-examines it.

The handoff proposed sending our amount explicitly. Both drift directions say otherwise:

| | Stripe charged MORE than we recorded | Stripe charged LESS |
| --- | --- | --- |
| **Today** (no amount sent) | Stripe returns its amount — customer whole. Books understate. | Stripe returns its amount — customer whole, since that is all they paid. Books overstate. |
| **Send our amount** | Strands the difference at Stripe, permanently and invisibly. | **Stripe rejects the refund**: it exceeds the charge. |

That last cell is disqualifying. The remediation marker is stamped in T2, BEFORE the network call,
and is permanent by design — the failure direction must be under-remediation, never a double refund.
So a rejected refund is not a retry; it is the customer's money kept for good, on every occurrence.
Sending our amount would convert a currently-succeeding reversal into a permanent failure in exactly
the case where our books are the thing that is wrong.

The obvious alternative — record what Stripe actually refunded — is unrepresentable in one direction:
`recordRefund` throws `payment.refund_exceeds_capture` when a refund exceeds our captured amount
(`packages/payments/src/store.ts`), which is the invariant that keeps partial-refund accounting
honest and is not worth relaxing for this.

So the defect is not the amount we send. It is that the sweep moves money unattended on a payment
whose amount it has, in the same pass, proven it cannot trust — and then stamps that payment
permanently remediated.

## 2. The gate

A fourth pre-check in the claim loop of `reconcilePayments`, over a set built once from the same
classification:

```ts
const driftedRefs = new Set(
  classified.rows.filter((e) => e.klass === "drift").map((e) => e.row.paymentRef),
);
```

```ts
for (const entry of classified.rows) {
  if (entry.klass !== "orphan") continue;
  if (entry.row.workingOrderStatus !== "abandoned") continue;
  if (entry.row.state !== "captured") continue;
  if (entry.row.reconcileRemediatedAt !== null) continue;
  if (driftedRefs.has(entry.row.paymentRef)) continue;   // <- new, but AFTER the already-claimed
                                                          //    check: an earlier sweep's marker is
                                                          //    permanent, so settling a drift on an
                                                          //    already-claimed row can never unblock
                                                          //    it — see the note below.
  // ... markReconcileRemediated
}
```

Two things about the placement.

**It is a set, not a lookup on `entry`.** `classify` emits INDEPENDENT predicates, so a drifting
orphan is two separate `ClassifiedRow` entries over one row — the `orphan` entry carries no knowledge
of the `drift` one. The set is the join, keyed on `paymentRef` because the sweep already treats that
as unique per row (`claimedRefs` is the existing precedent).

**It goes after the working-order, state AND already-claimed gates, and before the claim.** A row can
trip several gates, and the loop short-circuits, so the order decides which reason a human is shown.
If the working order is not `abandoned` we would not reverse whatever the amount says — reporting
drift as the reason would mislead someone into thinking that settling the drift unblocks remediation.
The same logic places drift AFTER the already-claimed gate specifically: the marker an earlier (or
race-losing concurrent) sweep stamped is permanent, so a row that is both already claimed and
drifting can never be unblocked by settling the drift — it has either already been reversed or
already permanently failed. Reporting `amountDrifted` there would point a human at a fix that does
nothing; `alreadyClaimed` is the gate whose answer is actually true for that row. The existing
three-gate order is preserved exactly and drift is appended after it, immediately before the claim.

A gated row stamps NO marker, which is the point: unlike a claimed-then-failed reversal, it stays in
the audited state set, so ANY sweep whose period covers it again will re-detect it — not "every
later sweep" unconditionally: `listReconcilable` selects by `settled_at` within the swept period, and
the documented cadence (a daily sweep is yesterday) is a closed past window nothing automatically
re-opens. What actually persists regardless of cadence is the `payment.reconcile_drift` and
`payment.reconcile_orphan` incidents staying OPEN (their dedup index is partial on
`acknowledged_at IS NULL`), so the human signal survives even when no sweep ever revisits the row's
period again — see §7 for the requirement this places on the deferred scheduler.

`PaymentReconcileResult` keeps its existing shape and meaning. A gated row never enters `remediable`,
so it is counted in neither `remediated` nor `remediationFailures` — it is not a failed remediation,
it is one that was correctly never attempted. It remains present in both `result.orphan` and
`result.drift`, which is where a caller reads it.

## 3. The reason code

`remediating: boolean` in the `payment.reconcile_orphan` params becomes a structured code. The flag
already meant three different things — working order not `abandoned`, state not `captured`, claimed
by an earlier sweep — and drift would be a fourth; a human reading `false` cannot tell which.

```ts
export type OrphanRemediation =
  | "claimed"                   // this sweep stamped the marker and will attempt the reversal
  | "workingOrderNotAbandoned"  // a sale may exist — refunding could claw back money owed
  | "stateNotCaptured"          // `settled` has no reversal path; claiming would strand it
  | "amountDrifted"             // our books and the processor disagree — don't move money on it
  | "alreadyClaimed";           // an earlier or concurrent sweep owns it
```

```ts
"payment.reconcile_orphan": {
  payments: {
    paymentRef: string;
    amount: string;
    workingOrderId: string;
    workingOrderStatus: string;
    remediation: OrphanRemediation;
  }[];
  count: number;
};
```

`OrphanRemediation` is declared and exported from `packages/payments/src/errors.ts`, the declaration
site of the field it types, and re-exported from the package barrel so a display layer can
exhaustively switch on it. `reconcile.ts`, which produces the values, takes a one-way
`import type` — it does not import `./errors.js` today, so this introduces no cycle.

Structured data the display layer localises, never prose — the convention every incident in this
package already follows. No locale content file references these codes yet, so there is no
translation surface to update.

The value is the FIRST gate that stopped the row, per the loop order in §2. `alreadyClaimed` covers
both the pre-existing marker and losing the race to a concurrent sweep (`markReconcileRemediated`
returning false); both mean another sweep owns the reversal, and the distinction is not one a human
can act on differently.

`"claimed"` preserves what `remediating: true` meant exactly: the marker is stamped BEFORE the
reversal is attempted, so it reads "this sweep is reversing it", not "this sweep succeeded". A
claimed-but-refused reversal still reports `"claimed"` here and separately raises
`payment.reconcile_remediation_failed`.

## 4. What this closes, and what it does not

Reconcile only ever calls `reverse` for claimed orphans, and the non-drifting guarantee holds only
WHERE THE REPORT MATCHED THE ROW. `classify` emits `drift` only when a settlement actually matched
the row's `external_ref` (`settled !== undefined`); a claimed, matched, non-drifting row's stored
amount therefore equals the settlement gross, which is the charge amount, which is what an
amount-less refund returns — so for that row the implicit full refund provably refunds our amount.
An orphan whose reference matched NOTHING in the report (`settled: null`) is a different case: it
passes the drift gate vacuously — there is no `drift` entry to catch, because none was ever emitted
— and is claimed and reversed with no amount comparison ever having happened. §7 lists that as a
known gap this design does not close, not an oversight. So the property the handoff wanted is
reached only for the matched case, by declining to move money we do not trust rather than by
changing a primitive three shipped adapters depend on.

The residual window is that drift is computed from the report snapshot and the refund happens later
in the pass. A captured charge's amount does not change, so this is theoretical rather than a case to
design against; it is named here so a future reader does not mistake the guarantee for an atomic one.

`reverseViaStripe` is NOT touched, and the interactive till paths keep both the existing behaviour
and the open issue: a refund or void issued from a till against an order whose stored amount differs
from Stripe's still returns Stripe's figure and records ours. Nothing on that path audits amounts, so
nothing detects it. That is the half of the handoff item this design deliberately declines — it is
shared money-path code across three adapters and wants its own review, with its own decision about
which of the two figures is authoritative. It stays on the deferred list.

## 5. Testing

TDD throughout; the sweep's rules are exhaustively testable without a database because `classify` is
pure and the claim loop's inputs are all arguments.

New:

- an orphan that also classified `drift` stamps no marker and never reaches `reverse`
- its orphan incident reports `amountDrifted`, while the `drift` incident on the same till still
  carries both figures
- a non-drifting abandoned orphan is still claimed and still reversed — the regression guard that
  keeps this a gate and not a disabling
- each `OrphanRemediation` value is reached by its own gate, including the precedence case: a row
  that is both non-abandoned and drifting reports `workingOrderNotAbandoned`
- the concurrency suite's race-loser reports `alreadyClaimed`
- the other precedence case the final gate order requires: a row that is BOTH already claimed by an
  earlier sweep AND drifting reports `alreadyClaimed`, not `amountDrifted` — pinning that the
  already-claimed gate now runs before the drift gate, since a permanent marker can never be
  unblocked by settling a drift
- an abandoned, `captured` orphan whose reference matches NOTHING in the report (not merely a
  differing amount) is still claimed and reversed — the boundary that shows the drift gate performs
  no amount check at all when the report never matched the row

Updated: `reconcile.test.ts` is the ONLY file that asserts on `remediating` — three sites. The
wiring, concurrency and both RLS suites reference `payment.reconcile_orphan` but never read this
field, so they need no change beyond the new race-loser assertion above.

Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally; never commit it.

## 6. Documentation to rewrite

Both currently document the opposite behaviour and would become false the moment the gate lands:

- the claim-loop comment in `packages/payments/src/reconcile.ts` — its closing paragraph
  ("A row that ALSO classified `drift` is still claimed, and reversed at OUR amount") is the specific
  inaccuracy the handoff flagged, and it disappears with the behaviour it described
- the `payment.reconcile_orphan` doc comment in `packages/payments/src/errors.ts`, which explains
  `remediating` as a boolean and enumerates two of the four non-remediation reasons in prose

## 7. Out of scope

- **`reverseViaStripe`'s full-refund amount** — §4. Deferred with its reasoning, not forgotten.
- **An orphan that also classified `unsettled`** is still claimed and reversed. It is adjacent and
  arguably deserves the same treatment, but `unsettled` means the settlement has not appeared YET,
  which is a different question from an amount we can prove wrong; conflating them here would widen a
  targeted fix into a re-litigation of the tolerance window.
- **Persisting `remediationFailures`** and the **scheduler/cadence** — unchanged from Slice A §11.
- **The scheduler must be able to re-sweep a historical period.** A gated drift stamps no marker and
  stays in the audited state set, but `listReconcilable` only ever selects rows by `settled_at`
  within the period a given sweep is asked to cover, and the documented cadence (a daily sweep is
  yesterday) is a closed, past window that nothing automatically re-opens. So detection today is
  ONE-SHOT per row, by whichever sweep's period happened to cover it; if a human settles the drift
  after that, no automatic reversal follows unless something re-sweeps that same historical window.
  The open incident is the durable signal in the meantime, but a scheduler that can only ever sweep
  "yesterday" (never a past date again) leaves a settled drift permanently unactioned by the sweep
  itself. Whatever design lands for the deferred scheduler must account for this.
- **A future report source with systematically wrong amounts would silently disable orphan
  auto-reversal, not just raise drift incidents.** Because a drift now GATES the claim rather than
  merely being reported alongside it, a source whose amounts are wrong in a consistent way — the
  obvious case being one that reports net-of-fees rather than gross — would classify every settled
  orphan as `drift` and permanently stand down every reversal for that source, with no single
  incident calling out that the SOURCE, not the individual payments, is the thing that is wrong.
  Today's Stripe adapter is explicitly gross and documents why (see its settlement mapping), so this
  is not a current bug; it is a correctness constraint any future adapter's report source must meet.
