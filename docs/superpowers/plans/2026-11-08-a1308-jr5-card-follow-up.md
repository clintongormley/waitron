# A1308 jr5 — one card follow-up job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands: YES.** Two steps write `sales`: recovery of paid-but-unrecorded sales files them
(`payWorkingOrderIntegratedOrchestration`, `apps/server/src/pending-card-recovery.ts:86-90`), and
settlement files invoices for bill payments it settles (`boot.ts:715-717`: "Settling files invoices
and fails payments this process is not driving"). This pull request changes when both run, and
refund recovery newly runs on a box promoted after start (rules §6, `sales`). Full review path
(money).

**Goal:** The card payment check loop (four nested steps) and card refund recovery on finished sales
become one job, `card.follow_up` (R3), with five steps, each running only on the roles it is meant
for, re-read on every pass; it wakes on a payment or refund change; and refund recovery starts on a
box promoted after start.

**Architecture:** A new `apps/server/src/card-follow-up.ts` runs the five steps in today's order
(`pendingCardPass`, `apps/server/src/boot.ts:604-641`, then refund recovery), each contained as its
wrapper contains it today (`boot.ts:563-705`), and none started once the job's signal is aborted
(`boot.ts:599-601`). The job's next due time is the earliest any step reports, between 5 seconds and
60 seconds (`runPendingCardLoop`'s floor and ceiling, `pending-card-recovery.ts:26-27`).

**Spec:** [jobs.md §2 R3; §3 rows "Card payment check loop", "Card outcome sweep", "Automatic recovery", "Release of stale marks", "Pending bill payment and refund settlement", "Card refund recovery"; §4 "Data loss"](../specs/2026-11-02-rationalisation/jobs.md);
README §10 ("Card follow-ups": resolution, hold and hold outcome become columns on `payments`). Slice rules apply.

## What it builds

| Step | Runs on | Today |
| --- | --- | --- |
| 1. Provider outcome sweep (`resolvePending` per connected provider, limited to the payments this box owns) | every trading box; a fenced box or mirror sweeps no provider | `withPendingSweep`, `boot.ts:563-602`; owners read per pass, `sweepOwners`, `:554-560` |
| 2. Recovery of paid-but-unrecorded sales | primary | `withAutomaticCardRecovery`, `:643-664` |
| 3. Release of stale "payment in progress" marks | every trading box | `withStalePaymentRelease`, `:666-706` |
| 4. Pending bill payment and refund settlement | primary | `withPendingBillPayments`, `:708-746` |
| 5. Refund recovery on finished sales | primary, and not a fenced box or mirror | `runTenderRefundRecoveryLoop`, `tender-refund-recovery.ts:121-161`, started only if primary at start, `boot.ts:3766-3768` |

Both refund steps read the one `refunds` table and the payment's folded columns once the refunds
slice and pa1 have landed; they keep whatever function names those slices left
(`settlePendingBillPayments`, `recoverTenderRefunds` and `startTenderRefundResolvers` /
`stopTenderRefundResolvers` today).

## What it leaves out

The card refund send that outlives its request stays a one-shot (jobs.md §3); the job picks up what
it leaves, as refund recovery does today.

## Files

- Create: `apps/server/src/card-follow-up.ts`, `apps/server/src/card-follow-up.test.ts`
- Modify: `apps/server/src/boot.ts` (`:554-746` the wrappers move out; `:3706-3790` the two loop
  starts), `pending-card-recovery.ts` (`runPendingCardLoop`, `:13-29`, deleted),
  `tender-refund-recovery.ts` (`runTenderRefundRecoveryLoop` deleted), `boot-pending-sweep.test.ts`,
  `pending-card-loop.test.ts`, `tender-refund-recovery.test.ts`, `background-duties.ts`,
  `background-duties.test.ts`, `handover-stepdown.test.ts`, `boot.promote.test.ts`

## Size

| Hand-written | Lines |
| --- | --- |
| Code: `card-follow-up.ts` 180 (the four wrappers' bodies move, about 140 lines leave `boot.ts`), `boot.ts` 40, deletions not counted, `background-duties.ts` 15 | **~235** |
| Tests: `card-follow-up.test.ts` 250 (of which `boot-pending-sweep.test.ts`'s cases move, re-pointed), loop cases re-pointed 80, stepdown and duties 30, promotion 20 | **~380** |
| Total | **~615** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/card-follow-up.test.ts src/pending-card-recovery.test.ts src/tender-refund-recovery.test.ts src/bill-payments-loop.test.ts src/card-charged-not-recorded.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts src/boot.promote.test.ts src/boot.restricted-quiet.test.ts` — passes, `Tests` count printed.
2. Typecheck, format clean; protection list EQUAL.

## Expected protection-list difference

**EQUAL.** Any line is a stop.

## Stop points (beyond rules §5)

1. A step's own test (`boot-pending-sweep.test.ts`, `tender-refund-recovery.test.ts`) needs a
   changed assertion.
2. `boot.restricted-quiet.test.ts`'s "runs no card-provider sweep" (`:279`) would change.

## Needs

jr1–jr3; the refunds slice; pa1 (`2026-11-08-a1308-pa1-card-follow-ups.md`).

## Global Constraints

- A card charged with no recorded sale, or a refund nobody followed up, is money wrong at the till
  (jobs.md R3): no step may be skipped for longer than the job's 60-second ceiling while it applies.
- Recovery never collects a payment (`pending-card-recovery.ts:75-85`).
- Once the job's signal is aborted no later step starts; settlement asks the provider about no
  further bill refund (`boot.ts:595-601`).
- The trading admission gates the job: it does not apply until admission is ready (today a refused
  admission throws at the top of every pass, `pending-card-recovery.ts:21-24`).

## Review Focus

1. **A role change between two steps of one pass** (a promotion lands mid-pass). Each primary-only
   step reads the role itself, so the pass is consistent per step, as today.
2. **A burst of card payments during service.** Each payment write wakes the job; the 5-second floor
   holds wakes to one pass in five seconds, so providers are not asked more often than today's floor.
   Task 1's "a burst of payment changes gives one pass per five seconds".
3. **The job waking on its own writes.** A pass that resolves nothing writes nothing (release writes
   only when it releases), so an idle pass does not wake itself. Task 1.
4. **A stepdown mid-pass with refund resolvers running.** The resolvers are stopped by the abort
   listener at the signal, as today; a resolver still out at the deadline is logged
   `tender_refund.shutdown_pending` (`boot.ts:3779-3780`). Task 1's "the stepdown signal stops the
   refund resolvers at once".
5. **A box promoted after start.** Refund recovery begins on its first pass as primary, with its
   resolvers started then. Task 3's promotion case.

---

### Task 1: The job

**Interfaces:**

```ts
// card-follow-up.ts
export interface CardFollowUpSteps {
  sweepProviders(): Promise<readonly PaymentProvider[]>;
  owners(): CollectionOwners;
  recover(): ReturnType<typeof recoverAutomaticCardPayments>;
  release(): Promise<number>;
  settle(signal: AbortSignal): Promise<BillPaymentsPass>;
  recoverRefunds(signal: AbortSignal): Promise<{ pending: number; nextDueAt: Date | null }>;
  startRefundResolvers(): void;
  stopRefundResolvers(): Promise<string[]>;  // ids still out at the deadline
}
export function cardFollowUpJob(steps: CardFollowUpSteps, deps: {
  getRole: () => SingletonRole;
  recoversRefunds: boolean;            // !fencedOrMirror, fixed at boot as today
  admissionReady: () => boolean;       // tradingAdmission.snapshot().state === "ready"
  log: Logger;
}): JobDefinition;
export const CARD_FOLLOW_UP_FLOOR_MS = 5_000;
export const CARD_FOLLOW_UP_CEILING_MS = 60_000;
```

Name `card.follow_up`; `applies: admissionReady`; `wakeOn: ["payments", "payment_refunds", "refunds"]`;
`minSleepMs` floor, `maxSleepMs` ceiling; `backoff { firstMs: 5_000, maxMs: 60_000 }`. The pass runs
steps 1–5 in order; a step whose role does not hold is skipped; each step's failure is logged with
today's event (`resolve_pending.failed`, `payment.automatic_recovery_failed`,
`payment_attempt.release_failed`, `bill_payment.settle_failed`, `tender_refund.recovery_failed`)
and the next step still runs. **If any step failed, the pass throws `AggregateError` after step 5**,
so the runner backs off and a lasting failure raises `job.failing` (jr3). Otherwise
`nextDueAt` is the earliest of: each provider's `resolvePending` `nextDueAt`, now + 60 s while
settlement reports `pending > 0` (`BILL_PENDING_RECHECK_MS`, `boot.ts:710`), and refund recovery's
`nextDueAt`; `null` if none. **Per-row errors are not step failures:** `recover`'s and `settle`'s
returned `errors` lists (one entry per payment that could not be handled) are logged per row as
today (`payment.automatic_recovery_failed`, `bill_payment.settle_failed`) and do not make the pass
throw, so one bad payment does not back off every follow-up; only a step that throws counts.

Step 5's resolvers start on the first pass where step 5 runs. **They stop at the stepdown signal
itself, not when the loop ends:** that first pass adds `ctx.signal.addEventListener("abort", stopRefundResolvers, { once: true })`,
as today's loop does (`tender-refund-recovery.ts:131-135`), so a stepped-down box asks the card
provider about no further refund beyond the resolvers' own 2-second grace
(`tender-refund-sends.ts:42-63`) instead of for up to the stepdown's 180-second wait. `onStop`
awaits that same stop (a second call shares the first's promise) and logs
`tender_refund.shutdown_pending` with the ids still out.

- [ ] **Step 1: Failing tests** (`card-follow-up.test.ts`, fake steps, runner with fake timers):
  `"runs the five steps in order on the primary"`; `"a secondary runs only the sweep and the release"`;
  `"a fenced box or mirror sweeps no provider and recovers no refund"`;
  `"reads the role for each step"`; `"a failing step is logged and the later steps still run, then the pass throws"`;
  `"no later step starts once the signal is aborted, and settlement is handed the signal"`;
  `"next due is the earliest any step reports, held between 5 and 60 seconds"`;
  `"a payment change wakes it; a burst of payment changes gives one pass per five seconds"`;
  `"an idle pass writes nothing"`; `"does not apply until the trading admission is ready"`;
  `"refund resolvers start on the first pass that recovers refunds"`;
  `"the stepdown signal stops the refund resolvers at once, even mid-pass"` — abort the job's
  signal while step 1 is awaiting: `stopRefundResolvers` is called before the pass returns, and
  `tender_refund.shutdown_pending` is logged once, by `onStop`;
  `"a per-row error is logged and the pass does not throw"`.
  Move `boot-pending-sweep.test.ts`'s cases (each wrapper's own behaviour) here, re-pointed to the
  step functions, assertions unchanged; `sweepOwners` stays exported for its direct test.
- [ ] **Step 2–4:** Run — FAIL; implement; run — PASS. Commit: "Merge the card checks and refund recovery into one follow-up job".

### Task 2: Wire into boot

- [ ] **Step 1:** Replace `boot.ts`'s `runPendingCardLoop` and `runTenderRefundRecoveryLoop` starts
  with one `jobRunner.add(cardFollowUpJob({ … }, { getRole: () => holders.singletonRole.current, recoversRefunds: !fencedOrMirror, admissionReady: () => tradingAdmission.snapshot().state === "ready", log }))`,
  building each step from today's arguments (`:3710-3790`). Remove `pendingCardController`,
  `tenderRefundController`, `pendingCardLoop`, `tenderRefundLoop` from `background-duties.ts`,
  `ABORTS` and `LOOPS` in `handover-stepdown.test.ts`, and their `undoOnFailure` entries.
- [ ] **Step 2:** Re-point `pending-card-loop.test.ts` ("does not enter provider or release duties
  until its pass is admitted", "contains a failed pass and checks again before stopping", "finishes
  the current pass on abort and starts no later work") to the job; assertions unchanged.

### Task 3: Measure 8 and the finish line

- [ ] **Step 1:** `boot.promote.test.ts`: `card.follow_up` is **not** in `PRIMARY_ONLY` (it applies
  on every trading box: the sweep and the release run on a secondary). A separate assertion in the
  promotion case: after the promote, a pass ran step 5 (spy on the refund recovery step through the
  test's seam, or read a refund recovery log line written after the promote).
- [ ] **Step 2:** Run the Finish line — PASS. `rg -n "runPendingCardLoop|runTenderRefundRecoveryLoop|pendingCardPass" apps packages docs` —
  history only; update `docs/developers/conventions-data.md`'s refund and bill-payment loop sentences
  (around `:4108-4117` at `a086eedfb7`) to name `card-follow-up.ts`. Commit: "Run card follow-ups as one job".
