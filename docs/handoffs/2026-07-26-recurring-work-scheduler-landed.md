# Handoff — the recurring-work scheduler landed

**Date:** 2026-07-26
**Type:** *Backward-looking* — what shipped, why it is shaped this way, and what is genuinely left.
**Main at handoff:** `c9faa2c`.

| PR | Squash | What |
| --- | --- | --- |
| #32 | `c9faa2c` | **`packages/scheduler`** — a duty-neutral, library-only runner over a derived-work ledger |

Spec: [`2026-07-25-recurring-work-scheduler-design.md`](../superpowers/specs/2026-07-25-recurring-work-scheduler-design.md).
Plan: [`2026-07-25-recurring-work-scheduler.md`](../superpowers/plans/2026-07-25-recurring-work-scheduler.md).
Both were kept current as review changed them — read the spec before the plan.

---

## 1. What this is, in one idea

**Work is derived, not enqueued.** The runner holds no queue: it asks the database what is missing,
and a gap in the `scheduled_runs` ledger *is* the work.

That was the one architectural fork, and it was chosen against a work queue for a specific reason.
A queue's failure mode is silent and permanent: lose a successor row and that duty stops for ever,
with no gap to notice it, and the mechanism that would detect the problem is the queue that just
broke. Derived work has no successor to lose. Downtime catch-up, re-sweep and bounded retry then all
fall out of one query rather than needing three mechanisms.

A rolling look-back window was also considered and rejected: it would have given catch-up and
re-detection for free with no ledger at all, but it destroys the period as a **unit of audit** —
"the 2026-07-24 sweep found X" stops being answerable once every run's results overlap every
other's. That alignment with fiscal's `{year, month}` periods and the daily close is worth more than
the machinery it would have saved.

## 2. What it closes, and what it does not

The motivating hole was §4 of the drift-gate handoff: `reconcile()`'s orphan drift gate holds a
customer's funds pending a human, `listReconcilable` selects by `settled_at` within the swept
period, and under a closed-past-window cadence **nothing re-sweeps that period**. Detected once,
then never again.

`DutyOutcome.resweepAfter` closes it. A duty says "I left something unresolved that a later sweep of
THIS period could resolve"; the runner enqueues a fresh generation as `pending` and never learns
why. Wired to payments reconcile that is a **self-healing loop**, not a louder alarm: while the
drift persists it re-detects, the gate holds, no money moves — and the day a human corrects the
amount, the orphan is claimed and the reversal completes with no further intervention. The
remediation UI shrinks to "fix the amount".

**This hole was found during the brainstorm, not by the plan.** "Re-sweep only" was the chosen
answer to the fund-hold question, and it does not work on its own: a successfully-swept period has
no gap, so nothing re-derives it. The ledger needed someone to *ask*, and there is no UI to ask.

**What it does not close:** nothing runs. There is no process, no config, no secrets — decision 2 of
the design. `runDue` has no production caller until an `apps/*` host lands, and the payments adapter
lives in a test file (`payments-fit.test.ts`) proving the seam fits. Until that host exists the
fund-hold remains unbounded in exactly the way §4 described.

## 3. The decisions worth knowing before you touch it

**No `DueAtDuty`.** The second duty kind for `drain`/`forward` is designed for and deliberately not
built, on this project's own rule from `backend.ts`: an interface with no caller and no meaningful
fake is dead surface. Adding it is a new derivation strategy plus a migration — not a rewrite.
**`drain`'s legal hourly-retry exposure is unchanged by this PR.** This makes landing it cheap, not
done.

**`generation` is what makes the unique key safe.** A table-wide unique on
`(tenant_id, duty, period_from)` is the trap this project already hit once. Re-sweep must run a
period *again* without overwriting what the first sweep recorded.

**`completeRun` is fenced on ownership** — `state='running'` plus the claim's own `started_at`,
returning a boolean. This was **not in the plan**; a reviewer found the race. A process hung past
`staleAfterMs` gets reclaimed by another runner, then wakes and writes its outcome onto the row the
replacement is still executing. A `false` return means another runner owns the row, and `runOne`
treats it exactly like a lost claim.

**A floor, not a horizon, for a duty that has never run.** Its first period is the most recent
complete one — you cannot have missed periods before you existed — so day one runs one sweep, not
thirty. The horizon governs catch-up for a duty that *has* run and fallen behind.

**No settle-grace before sweeping a just-closed day**, and that is justified rather than lazy: a
fresh day cannot produce a false finding, because `unsettled` escalates only past the settlement
lag, `drift` needs a *matched* settlement, `orphan` is local-only, and `missingLocal` gets a
targeted all-time existence check.

**Both bounds are visible.** `deferred` and `beyondHorizon` are reported on the result. A duty
broken for longer than the horizon loses those periods permanently and the result *says so*, rather
than reading as full coverage.

## 4. Two things the reviews changed that a reader would not guess

**`nextDueAt` was wrong twice, in opposite directions.** It was `null` whenever every
`(tenant, duty)` pair threw — which its own doc comment said was impossible — so a host sleeping on
it would stop polling for ever after one transient blip. And it was computed from the *pre-tick*
snapshot only, so the backoff a failing run had just written was invisible to it, under-reporting by
up to ~20 hours and making the documented 15m/30m retry cadence unreachable by any host that slept
on the field. It now folds each completed run's own resulting due time and reports `now` when work
is available immediately.

**Postgres does not render `timestamptz` as ISO-8601.** Discovered mid-plan; the store now
normalises via `to_json(col) #>> '{}'`, which makes `LedgerRow`'s declared type literally true
instead of a claim readers must trust. Note the rendering is the **offset form**
(`2026-07-25T04:15:00+00:00`) — *not* `.000Z` — so test assertions still parse-then-compare.

## 5. Defects found, and by what

Same tradition as the last two slices. **None of the following were found by a green suite.**

| Defect | Found by |
| --- | --- |
| "Re-sweep only" does not re-sweep: a swept period has no gap, so nothing re-derives it | Brainstorm, before any code |
| `completeRun` unfenced — a hung process clobbers the run that replaced it | Task 4 review |
| `nextDueAt` null on total failure, and blind to the backoff the same tick wrote | Final whole-branch review |
| `enqueueSuccessor` duplicated the terminal-state list as raw SQL, 11 lines from the constant that exists to prevent exactly that | Final whole-branch review |
| Package neutrality was enforced by discipline — a devDependency stops nothing with no build step and `main: ./src/index.ts` | Final whole-branch review |
| `claimRow` left a stale `next_attempt_at` on a `running` row, falsifying the column's own documented invariant | **Copilot** |
| Six comments asserting the opposite of the code | Task 4 + final review |

**Two patterns worth carrying forward.**

*First:* **five consecutive task reviews found a predicate with no test that could fail** — a guard
deletable with the whole suite staying green. Tasks 6 and 7 broke the streak, and the reason is
concrete: their implementers **mutation-tested every guard before committing** (break it, observe
RED, restore, observe GREEN). Put that instruction in the dispatch, not in the hope.

*Second:* **`pnpm -r test` was never run across Tasks 1-6.** A real `packages/fiscal-verifactu`
regression — a pinned `GENERIC_PACKAGES` source-text regex, broken the moment Task 1 registered
`"scheduler"` with the english-only guard — sat red for six tasks until Task 7's first
whole-workspace run found it. Per-package gates are not enough when a task touches a shared file.

*And a note on Copilot:* it found a real defect on this PR — **the first time in this series**. It
was the one class no human reviewer had caught either: an invariant stated in a schema comment that
the code quietly violated, harmless today only because `derive` dispatches on `running` before it
ever reads the column.

## 6. What remains

### Known gaps in what just landed

- **A re-sweep chain parks permanently after ~45 minutes of duty failure.** `resweepAfter` is read
  only from a *successful* outcome, so three consecutive failures (15m + 30m backoff) park the chain
  row, and nothing re-derives it: the period has rows, so gap derivation skips it, and `parked` is
  terminal. Design §7 is now qualified with this rather than claiming the payoff unconditionally.
  A monitor can key on it — a parked chain row is `generation > 0` on `RunRecord`. **Deciding what
  park should mean for a fund-holding chain belongs to the remediation-UI cycle.**
- **`nextDueAt` is `now` whenever anything is `skipped`**, so a host sleeping on it spins with no
  delay while the database is down. Strictly better than the `null` it replaced, but neither the doc
  nor §11 tells a host it needs its own cadence floor. Write that down when the host is built.
- **The eslint neutrality zone's `from` list omits `packages/payments-stripe`.** Unreachable today
  (not in the manifest), reachable the day someone adds it for a second fit test.
- **`store.concurrency.test.ts`'s barrier has no `try/finally`.** If its `pg_locks` wait throws,
  connection A's transaction stays open and `afterAll` blocks until the 180s `hookTimeout` — a 10s
  failure becomes a 3-minute one.
- **Uncovered branches, deliberately:** `runOne`'s lost-claim path, `store.ts`'s non-unique-violation
  re-throw, and `derive`'s `nextDueAt` never accounting for when a `running` row becomes
  stale-reclaimable (so a tick whose only outstanding work is in-flight under-reports).
- `store.test.ts` is an order-dependent chain over one shared duty. It bit once during the Copilot
  fix — a new test picked a period a sibling already claimed, and `claimGap` returned null. If you
  add a test there, pick an unused period; better, seed a tenant per test.

### Still open from the payment layer

- The **`apps/*` host** — now carrying three jobs, not one: the webhook HTTP endpoint (Mode 3's
  deployment half), signing-secret / success-cancel-URL provisioning, **and** wiring `runDue`. The
  standalone deli deployment wants one process, which is why the scheduler shipped without one.
- **`reverseViaStripe`'s full-refund amount** on the interactive till paths — unchanged, and #31's
  spec still **disqualifies** the "send our amount" fix. Read it before touching that path.
- **Reading on-device identifiers back** — needs `expand: ["data.source.payment_intent"]`.
- Sale-chaining a `lostSettlement`; self-healing a `missingLocal`; per-reversal idempotency at the
  processor.
- The four `*.rls.test.ts` files in `packages/payments` still share an unconditional `afterAll` that
  masks a `beforeAll` failure and leaks the container. `packages/scheduler`'s two real-Postgres
  suites deliberately do **not** inherit it — copy their shape when you fix those four.
- Disputes and refunds are not audited — reconcile's pass 1 filters `type: "charge"`.

### Next

1. The **`apps/*` host**. It is now the single thing standing between this repo and anything
   actually running — the scheduler, the webhook endpoint, and `drain`'s legal obligation all wait
   on it.
2. The **tab/tip lifecycle** — `preAuth` / `incrementalAuth` / `tipAdjust`.
3. The **refund/void role-gate**, which rides with identity (sub-project 5).

`drain` deserves a mention of its own: it is the one duty with a legal deadline behind it, it is as
unscheduled today as it was yesterday, and this branch makes adding it a derivation strategy plus a
migration rather than a rewrite.

## 7. Environment notes

- `pnpm --filter @waitron/scheduler test` runs in ~6s; the real-Postgres suites need
  `TESTCONTAINERS_RYUK_DISABLED=true` locally. **Never commit it.**
- The pre-push hook runs the full workspace gates in ~80s. Do not bypass it.
- **Branch protection blocks the merge twice over:** it requires a review no second human can give
  in a solo repo (so `gh pr merge --admin`), and it requires every conversation resolved — a
  Copilot inline comment counts, so resolve the thread via the GraphQL `resolveReviewThread`
  mutation before merging.
- This branch ran in the **main checkout**, not a worktree: `worktree.py` only creates NEW branches,
  so a branch that already carries commits cannot be moved into one. `/land-branch` handles the
  missing worktree fine — skip its teardown step.
