# Handoff — payment `reconcile()`: Slices A and B landed

**Date:** 2026-07-25
**Type:** *Backward-looking* — what shipped, why it is shaped this way, and what is genuinely left.
**Main at handoff:** `dd8525d`. **`reconcile()` is now complete for Stripe.**

Two PRs landed this session, both through the full cycle (brainstorm → writing-plans →
subagent-driven-development → `/finish-branch` → `/land-branch`):

| PR | Squash | What |
| --- | --- | --- |
| #28 | `978d5e5` | **Slice A** — the provider-neutral read-side backstop in `@waitron/payments` |
| #29 | `dd8525d` | **Slice B** — the Stripe adapter in `@waitron/payments-stripe` |

Specs: [`2026-07-25-payment-reconcile-design.md`](../superpowers/specs/2026-07-25-payment-reconcile-design.md)
and [`2026-07-25-payment-reconcile-slice-b-design.md`](../superpowers/specs/2026-07-25-payment-reconcile-slice-b-design.md).
Both were kept current as implementation changed them — read those before the plans.

---

## 1. What shipped

**Slice A** — `reconcilePayments(deps, tenantId, period, now)` owns the whole audit algorithm in the
neutral package, behind three injected vendor ports. Final: 351 tests, coverage 99.89 / 98.94 / 100 /
99.89.

**Slice B** — `StripeReconciler` implements the seam for `provider = "stripe"` and wires those ports
to a real account. Final: 85 tests, coverage 99.54 / 98.47 / 100 / 99.54.

---

## 2. Decisions that are load-bearing

These were resolved deliberately and the reasoning matters more than the code. Do not undo them
casually.

### `reconcile` is its own interface, not a `PaymentProvider` method

§3/§6 of the umbrella design sketched it as a `PaymentProvider` method. It is not, for three reasons:

1. `StripeHostedProvider` implements `AsyncPaymentProvider`, so a hosted-only tenant has **no**
   `PaymentProvider` instance — the mode that most needs the backstop would be the one without it.
2. All three Stripe adapters write `provider = "stripe"`. The audit is scoped per **settlement
   identity**, not per capture mechanism, so ONE implementer covers all of them.
3. Mode 3 set the precedent three weeks earlier: a distinct `AsyncPaymentProvider` rather than
   bolting `initiate` onto every synchronous adapter.

**A fourth Stripe capture mechanism needs no new reconciler.** That rule is in the class doc.

### Five mismatch classes, not §6's four

`lostSettlement` (a local `initiated` row the report says settled — the missed webhook, the true
`lostAck` twin) is split from `missingLocal` (no local row at all — the `initiate`-crash case). Two
states, two remedies. The classes are **independent predicates**, not a switch: a row can genuinely
be both `orphan` and `unsettled`.

### The orphan self-heal is bounded three ways

Auto-reversal only when **all** hold:

- the working order is `abandoned` — on a `settled` one a sale exists, so the orphan may be a lost
  associate-back, and refunding would return money for an invoice the customer owes;
- the payment state is `captured` — `settled` has **no reversal path** in the local state machine
  (`assertReversible` rejects it), so claiming one stamps a permanent marker on money that can never
  be returned;
- the marker is stamped **before** the network call — there is no per-reversal idempotency key, so
  the failure direction must be under-remediation, never a double refund.

### Incidents aggregate per (till × class), for all six codes

The dedup index is `(tenant_id, till_id, code, sale_id) NULLS NOT DISTINCT WHERE acknowledged_at IS
NULL`, and orphans always have a null `sale_id` — so N per-payment incidents collapse into whichever
won the race. This is the PR #25 lesson applied uniformly. `PaymentReconcileResult.remediationFailures`
exists because that one class's drop is *permanent* (marker + dedup), unlike the five re-detected
classes.

### Balance transactions, not payouts

Stripe writes a card charge's balance transaction **at capture**, with a future `available_on` — so a
settlement is visible in minutes. A payout-based report would have hidden `lostSettlement` and
`missingLocal` for 2–7 days: the two money-losing classes this feature exists to catch.

### Compare GROSS, never `net`

`bt.amount` is gross; `net` is after Stripe's fee. Our stored amount is what the customer paid, so
reconciling against `net` would report **every single payment** as `drift`.

### `resolveAccount`, not two resolvers

One call returns `{ report, refund }` for a tenant. Two independent resolvers would let a caller pair
tenant A's ledger with tenant B's refund client — refunding a customer out of the wrong merchant's
balance. Note the doc says this makes the mispairing a **single decision at one call site**, not
"impossible"; an implementation could still mismatch deliberately. That precision was a review
correction and should be preserved.

---

## 3. Defects found, and by what

Worth reading before trusting a green suite. **None of these were found by tests.**

| Defect | Found by |
| --- | --- |
| `settled`-state orphan auto-claimed for a reversal no primitive can perform — money kept permanently | Slice A whole-branch review |
| Failed reversals raised one incident *per payment*, silently collapsing under the dedup index | Slice A task review |
| `SettlementReportSource.fetch` had no tenant — would fill `missingLocal` with other tenants' money on a shared account | Slice A whole-branch review |
| **`reverseViaStripe` opened a bare `db.transaction()`, which sets no `app.tenant_id` — so under real RLS EVERY auto-reversal failed closed** | Slice B's RLS suite, on its first run |
| The claim "terminal *and on-device* both write `attempting` before their network call" is **false for on-device**, and had propagated to five sites documenting a real unattributed money-loss path as impossible | Slice B whole-branch review |

Two process lessons follow from that table:

- **Write the real-Postgres RLS suite early, not last.** PGlite connects as superuser and bypasses
  `FORCE ROW LEVEL SECURITY`, so 80 hermetic tests were green while the slice's headline deliverable
  could never have fired in production.
- **Check a rationale against the code before it propagates.** The on-device claim originated in a
  brainstorm answer, survived nine per-task reviews, and was only caught by a reviewer who opened
  `device-provider.ts`.

---

## 4. What remains

### Deferred out of Slice A (spec §11)

- The **scheduler / cadence** — an `apps/*` concern. `reconcile(tenantId, period, now)` is called by
  someone else.
- **Sale-chaining a `lostSettlement`** — app-level orchestration, so reconcile only reports it.
- **Self-healing a `missingLocal`** by inserting the missing row. The `hint` makes it possible.
- **Persisting `remediationFailures`** — nothing in `packages/payments` stores it; the result is
  in-memory only.
- The two-query `listReconcilable` split takes **two snapshots** under READ COMMITTED, so a row
  transitioning `initiated`→`captured` between them is missed by a near-real-time cadence. Harmless
  for the designed closed-past-window cadence; `REPEATABLE READ` or one `UNION ALL` would restore
  atomicity.
- The merge sorts Postgres timestamp **text**, which can invert across a DST fall-back hour
  (presentational only).
- **The `state === "captured"` claim gate and its spec §5 subsection must be removed TOGETHER** if
  `settled` ever gains a reversal path.
- The four `*.rls.test.ts` files' unconditional `afterAll` teardown masks a `beforeAll` failure with a
  TypeError and leaks the container. Pre-existing; fix all four together.

### Deferred out of Slice B (spec §7)

- **Reading on-device identifiers back.** Needs `expand: ["data.source.payment_intent"]` on the ledger
  list (PaymentIntent metadata does not propagate to the charge). Until then an on-device
  `missingLocal` carries `hint: undefined` and raises **no incident** — a known unattributed path.
  The write half already landed: the on-device create now stamps `working_order_id` / `payment_ref`.
  A `refId` helper was added specifically so adding that `expand` will not silently null every
  PaymentIntent.
- **Sending the refund amount explicitly on a full refund.** Today `reverse` sends no amount, so
  Stripe refunds the full PaymentIntent while `recordRefund` writes *our* amount. On a drifting orphan
  the books and the processor disagree, and the row leaves the audited state set so no later sweep
  re-examines it. A `drift` incident carries both figures, so it is visible — but the reconciliation
  record is wrong. **This is shared money-path code used by two other adapters and wants its own
  review.** The neutral layer's claim-loop comment (`packages/payments/src/reconcile.ts`) still says a
  drifting orphan is "reversed at OUR amount", which is not what the adapter does — correct it in the
  same change.
- `reverseViaStripe`'s `tenantId` is **optional**, so the untenanted trap survives for any future
  caller — notably the deferred webhook-driven reversal, which should supply it via the existing
  `resolve_payment_tenant` SECURITY DEFINER seam. Documented, not type-enforced; a
  `TenantScopedDatabase` brand would be the real closure.
- No test sweeps **two tenants**. Mitigated by an explicit tenant predicate on the reversal lookup,
  which is deterministic where a test is not.
- Disputes and refunds are **not audited** — pass 1 filters `type: "charge"`. Their own concern, with
  their own mismatch semantics.
- `STRIPE_SANDBOX_SECRET_KEY` is a GitHub Actions secret only, so `reconcile.sandbox.test.ts` has
  never run against a live account. **The nightly workflow is its first real run — check it.**

### Next in the payment layer

In the design's own priority order:

1. The **`apps/*` webhook HTTP endpoint** + signing-secret / success-cancel-URL provisioning (Mode 3's
   deployment half), and `resolveAccount` / `resolveReader` provisioning generally.
2. The **tab/tip lifecycle** — `preAuth` / `incrementalAuth` / `tipAdjust` (the old "4e").
3. The **refund/void role-gate**, which rides with identity (sub-project 5).

---

## 5. Environment notes for the next session

- **Real-Postgres suites hang locally** unless prefixed `TESTCONTAINERS_RYUK_DISABLED=true` — Docker
  registry egress stalls, so Testcontainers' Ryuk reaper blocks and every `beforeAll` times out at
  180s. `payments.rls.test.ts` then passes in 1.9s. **Never commit it**; CI is unaffected. Symptom if
  forgotten: 6+ pre-existing suites fail with `TypeError: Cannot read properties of undefined
  (reading 'close')` in `afterAll`, which looks like a branch regression but reproduces on `main`.
- The same Docker Hub connectivity problem hit **CI** twice (`registry-1.docker.io: context deadline
  exceeded`), failing `packages/db`'s real-Postgres suites. Both times `gh run rerun <id> --failed`
  cleared it. Not a code issue.
- **Subagents strand themselves** on the >10min `@waitron/payments` suite: they background it and end
  their turn. Dispatch prompts must say: run targeted files
  (`pnpm --filter <pkg> exec vitest run src/x.test.ts`), pass an explicit long Bash timeout, never
  `run_in_background`.
- Sonnet-tier subagent dispatch returned three consecutive API 500s mid-session; opus went through.
  Nothing was lost (clean tree each time).
- **Copilot iterated twice on each PR and every finding was substantive** — an N+1 inside a write
  transaction, missing tenant predicates, a `payment_intent` that can be a string *or* an expanded
  object, and a stub hiding its own contract. Resolve-with-reply for trivia; a push re-triggers the
  loop. Every unresolved thread blocks merge.
