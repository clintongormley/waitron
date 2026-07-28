# Handoff — the orphan drift gate landed; reconcile verified against live Stripe

**Date:** 2026-07-25
**Type:** *Backward-looking* — what shipped, why it is shaped this way, and what is genuinely left.
**Main at handoff:** `59ded62`.

Two PRs landed this session:

| PR | Squash | What |
| --- | --- | --- |
| #30 | `daad1b1` | `address[state]` for the ES Terminal Location — unblocked the nightly sandbox suite |
| #31 | `59ded62` | **The orphan drift gate** — a drifting orphan is reported, never auto-reversed |

Spec: [`2026-07-25-orphan-drift-gate-design.md`](../superpowers/specs/2026-07-25-orphan-drift-gate-design.md).
It was kept current as review changed it — read it before the plan.

---

## 1. `reconcile()` has now run against a real Stripe account

The previous handoff's one open verification is closed. The 2026-07-25 05:07 nightly had failed, but
**not** for the reason it looked like: Stripe began requiring `address[state]` for an ES Terminal
Location between the 07-24 and 07-25 runs, under API version `2026-06-24.dahlia`, with no change on
our side. It failed in `beforeAll`, so the whole suite was skipped — and it ran eleven hours *before*
Slice B landed, so `reconcile.sandbox.test.ts` had never executed at all.

After #30, a `workflow_dispatch` on the branch ran **4 files, 6 tests, 0 skipped**: reconcile (3
tests, its first ever real run), checkout, connection-token, and the repaired collect suite. All
green.

**Note the verification gap:** that dispatch ran on the branch, not on `main`. The merge was a clean
squash of the identical diff, so the cron should be green — but nobody has watched it on `main`.
Check the 04:00 UTC run.

## 2. The decision that matters most: the previous handoff's proposed fix was wrong

The Slice B handoff recorded the reversal amount mismatch and proposed *sending our amount explicitly
on a full refund*. **Do not implement that.** Both drift directions say otherwise:

| | Stripe charged MORE than we recorded | Stripe charged LESS |
| --- | --- | --- |
| **Before** (no amount sent) | Stripe returns its amount — customer whole, books understate | Stripe returns its amount — customer whole, books overstate |
| **Send our amount** | Strands the difference at Stripe, permanently and invisibly | **Stripe rejects it** — the refund exceeds the charge |

That last cell is disqualifying. The remediation marker is stamped in T2, BEFORE the network call, and
is permanent by design, so a rejected refund is not a retry — it is the customer's money kept for
good, on every occurrence, in exactly the case where our books are the thing that is wrong. The
obvious alternative (record what Stripe actually refunded) is unrepresentable in one direction:
`recordRefund` throws `payment.refund_exceeds_capture`.

So the defect was never the amount we send. It was that the sweep moved money unattended on an amount
it had, in the same pass, proven untrustworthy — and then marked it permanently remediated.

## 3. What shipped, and the load-bearing details

**A fourth claim gate.** A row that also classified `drift` is reported, never claimed. No marker is
stamped, which is the whole point: unlike a claimed-then-failed reversal it stays in the audited state
set, and its `drift` + `orphan` incidents stay open for the human who settles the difference.

**`remediating: boolean` → `OrphanRemediation`.** The flag already meant three different things and a
reader of `false` could not tell which; drift would have been a fourth. Now `claimed` |
`workingOrderNotAbandoned` | `stateNotCaptured` | `alreadyClaimed` | `amountDrifted`, reported as the
FIRST gate that stopped the row.

**Gate order is load-bearing: `alreadyClaimed` precedes `amountDrifted`.** The final review caught
this and it is worth preserving. An earlier sweep's marker is permanent, so settling a drift on an
already-claimed row can never unblock a reversal — a human must handle it by hand. Reporting
`amountDrifted` there points them at a fix that does nothing. It is reachable, and not exotically: any
orphan the pre-branch code claimed while drifting, whose reversal then failed, keeps its marker, stays
`captured`, and would report `amountDrifted` alongside its own open `remediation_failed` incident —
two contradictory signals. The ordering principle is the same one that puts `workingOrderNotAbandoned`
first: never name a gate whose resolution would not actually unblock anything.

**The guarantee is narrower than it first looks.** `classify` emits `drift` only when a settlement
MATCHED. An orphan whose reference matched nothing in the report has `settled: null`, emits no drift
entry, and is claimed and reversed with **no amount comparison having happened at all**. The design's
§4 originally overstated this ("provably refunds our amount") and contradicted its own §7; both are
corrected, and a test now pins that the unmatched row IS still claimed, so a future stricter gate
cannot silently widen the scope.

## 4. An open product question the review surfaced

Read §1's table again: *before* this change, the customer was left whole in **both** drift directions —
the amount-less refund returns what they actually paid. What was wrong was our books, plus the
permanent marker taking the row out of the audited set.

So this branch trades **"customer automatically made whole, books wrong and unauditable"** for
**"books flagged, customer's money held pending a human"**. That is defensible for a pre-production
system — book integrity on a money path is worth more than an automatic refund the audit can never
verify — but two facts make the hold currently unbounded in time:

- there is no `apps/` remediation UI, and no scheduler;
- `listReconcilable` selects by `settled_at` within the swept period, and the documented cadence is a
  closed past window, so **nothing re-sweeps that period automatically**. The row is detected once.
  The open incidents are what persist, not the re-detection.

The incidents are a real signal and the money is not lost. But this was inherited as a side effect of a
books-integrity argument rather than decided as a policy about customer funds. **It deserves an
explicit product decision**, and it is the strongest argument for prioritising the scheduler.

## 5. Defects found, and by what

Same pattern as Slice B, and worth internalising. **None of these were found by tests.**

| Defect | Found by |
| --- | --- |
| The previous handoff's own proposed fix would turn a succeeding reversal into permanent money-loss whenever the processor's charge was the smaller figure | Reading `store.ts`'s `refund_exceeds_capture` cap during brainstorming, before any code was written |
| `errors.ts`'s `payment.reconcile_drift` doc still said drift "does not veto an orphan reversal… still reversed, at OUR amount" — now exactly backwards, in the doc a human resolving a drift reads | Task 2 review |
| The design's §4 guarantee contradicted its own §7 (unmatched orphans are reversed with no amount check) | Whole-branch review |
| "every later sweep re-detects it" — false under the closed-past-window cadence, and it was the sentence justifying withholding the refund | Whole-branch review |
| Gate order told a human `amountDrifted` about a row whose permanent marker means settling the drift changes nothing | Whole-branch review |

**Three of the five are comments asserting the opposite of the code.** That is now the dominant defect
class on this project across three consecutive slices, it is invisible to a green suite, and it is only
ever caught by a reviewer who opens the file. Budget for that reviewer.

One process note in the other direction: the whole-branch review also *verified* things rather than
taking them on trust — it checked that keying the drift set on `paymentRef` is sound because
`payments_provider_ref_key` makes it unique per (tenant, provider) and `listReconcilable` filters by
provider. Keying on `externalRef` would have been a real bug, since migration `0007` only makes that
unique for async/hosted rows.

## 6. What remains

### Deferred out of this change

- **`reverseViaStripe`'s full-refund amount.** UNCHANGED and still open for the interactive till
  paths: a refund or void issued from a till against an order whose stored amount differs from
  Stripe's still returns Stripe's figure and records ours, and nothing on that path audits amounts, so
  nothing detects it. This is shared money-path code across three adapters and wants its own decision
  about which figure is authoritative. The reconcile path no longer reaches it with an untrusted
  amount, which is what §2 above closes.
- **An orphan that also classified `unsettled`** is still claimed and reversed with no amount check —
  `unsettled` means the settlement has not appeared YET, a different question from an amount we can
  prove wrong. Deliberately out of scope; conflating them would re-litigate the tolerance window.
- The `claimed ? "claimed" : "alreadyClaimed"` ternary's false arm is **unobservable** — reached only
  by a race-losing sweep whose incident is always deduplicated away by the winner's. Executed but
  unassertable; coverage passes anyway (branches 98.95 vs a 95 floor), so no ignore-comment was added.
- Two concurrent sweeps with DIFFERENT report snapshots never contend on the row lock, so a gated
  sweep's `amountDrifted` incident can win the dedup slot over a claiming sweep's `claimed`. Very rare,
  and not new in kind — `remediating: false` had the same shape.
- Already-open `payment.reconcile_orphan` incidents persisted with `remediating: boolean` and are never
  rewritten. Nothing consumes them today; a note for whoever builds the display layer.
- **A constraint on every future report source:** because drift now GATES auto-reversal rather than
  merely raising an incident, an adapter whose amounts are systematically wrong (net-of-fees rather
  than gross is the obvious way) would silently disable orphan auto-reversal entirely. Today's Stripe
  adapter is explicitly gross and says why.

### Still open from Slice A/B

- The **scheduler / cadence** — now carrying an extra requirement: it must be able to re-sweep a
  historical period, or a settled drift is never revisited automatically (§4).
- **Reading on-device identifiers back** — needs `expand: ["data.source.payment_intent"]` on the ledger
  list. Until then an on-device `missingLocal` carries `hint: undefined` and raises no incident. The
  write half and the `refId` helper already landed.
- Sale-chaining a `lostSettlement`; self-healing a `missingLocal`; persisting `remediationFailures`.
- The two-query `listReconcilable` split takes two snapshots under READ COMMITTED.
- The four `*.rls.test.ts` files' unconditional `afterAll` masks a `beforeAll` failure and leaks the
  container. Pre-existing; fix all four together.
- Disputes and refunds are not audited — pass 1 filters `type: "charge"`.

### Next in the payment layer

1. The **`apps/*` webhook HTTP endpoint** + signing-secret / success-cancel-URL provisioning (Mode 3's
   deployment half), and `resolveAccount` / `resolveReader` provisioning generally.
2. The **tab/tip lifecycle** — `preAuth` / `incrementalAuth` / `tipAdjust`.
3. The **refund/void role-gate**, which rides with identity (sub-project 5).

The scheduler has a stronger claim than it did, for the §4 reason.

## 7. Environment notes for the next session

- **`pnpm --filter @waitron/payments test:coverage` runs in ~23 seconds**, not the >10 minutes the
  previous handoff recorded. That figure appears to have been the whole-workspace `pnpm -r` run. Worth
  knowing: subagent dispatch prompts have been carrying a heavy warning about it that is mostly
  unnecessary for a single package. Keep the "never `run_in_background`" rule regardless — that is what
  actually strands them.
- Real-Postgres suites still need `TESTCONTAINERS_RYUK_DISABLED=true` locally. Never commit it.
- **Copilot found nothing on either PR this session** — the first time in this series. Both had already
  been through per-task reviews plus a whole-branch review on the most capable model, which is the
  likely reason.
- `worktree.py` only creates NEW branches, so a branch that already carries commits cannot be moved
  into a worktree with it. Both PRs this session ran in the main checkout on a feature branch; `/land-branch`
  handles the missing worktree fine (skip its teardown step).
