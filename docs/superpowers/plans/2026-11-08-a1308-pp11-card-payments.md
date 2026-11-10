# A1308 pp11 — card payments counted from `payments`, the in-flight poller goes, and `staff_activity` is narrowed: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** a whole-order card payment counts as attendance evidence from its `payments` row, through
`requested_by` (pa3), instead of through an in-flight snapshot the poller
`apps/server/src/attendance-integrated.ts` watches every 30 seconds; the poller goes. With it gone,
every `staff_activity` row qualifies, so `outcome` and its index go and the source and kind CHECKs
narrow. `payments` gains an index on `created_at` so the day read is indexed. Measurements 1 and 5
run here, on slice 0's bench, because this is the pull request that completes the day read.

**Words used here.** *Hand-keyed* card payments are ones a person types in after taking the card on
a standalone terminal (`recordManualCardPayment`, `apps/server/src/till-sale.ts:2219-2227`); they
already write a whole-order activity row (`:2248`).

**Architecture:** one new branch in the facts read; the poller module, its calls and every `outcome`
branch deleted; one index in the payments set; a bench case and a plan guard.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, slice 0's `bench` command.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §6 (the bench), §10 "Card
follow-ups"; [people appendix](../specs/2026-11-02-rationalisation/tables-people.md) "The short
version" (third bullet), §1 `staff_activity`, §5, §7 (payments area), §8 items 1 and 5;
[fiscal appendix](../specs/2026-11-02-rationalisation/tables-fiscal.md) ("New column
`requested_by` … It replaces the attendance poller's in-flight snapshot").

**First line of the pull request:** "Every venue is reset: workforce, payments; backups and exports
from before this cannot be restored or imported." (rules §2)

**Who lands:** the lane (rules §6). It deletes the integrated-attendance calls from
`apps/server/src/till-sale.ts` and `payments-api.ts` without changing what a sale, payment or fiscal
record writes, and adds a plain index to `payments` (no refusal changes; pa2 owns the owner-landed
`payments` delete refusal). The fiscal checks in the finish line run unedited.

**Cites** read at `a086eedfb7`; pa3 and pp10 have changed several files named.

---

## What it builds

- The facts read gains one branch: source `card-payment`, from `payments`, person `requested_by`,
  time `created_at`, condition `requested_by is not null and bill_payment_id is null and settled_at
  is not null and provider <> 'manual'` (`MANUAL_PROVIDER`, `packages/payments/src/manual.ts:13`:
  hand-keyed payments are counted through their whole-order activity row already). `card-payment`
  is added to `AttendanceSource` (`packages/workforce/src/attendance-types.ts`); fact labels feed
  `evidence_keys`, which are only compared (appendix §1).
- `payments_created_at_idx` on `payments(created_at)` (`packages/payments/src/schema/payments.ts`;
  today the set has none, `packages/payments/drizzle/0000_baseline.sql:148-160`).
- Deleted: `apps/server/src/attendance-integrated.ts` and its calls (`till-sale.ts:81-83` and their
  uses, `payments-api.ts:111-112`, `:1140-1166`); the pending loop in `reconcileAttendanceDay`
  (`attendance-discovery.ts:57-89`); discovery's whole-payment watch branch (`:522-525`); every
  `outcome` read and write (`attendance-capture.ts:53-131`'s outcome handling, the `operation`
  source's `outcome` field, `:162-167`, the facts read's `outcome = 'qualifying'`).
- `staff_activity` narrowed, as appendix §1: `outcome`, its CHECK and `staff_activity_pending_idx`
  go; `staff_activity_source_ck` allows `order`, `whole-payment` and `draft` (pp10's decision);
  `staff_activity_kind_ck` allows `order`, `payment`. `recordAttendanceFact` takes no outcome;
  a repeated key is ignored.
- Bench case `attendance.day` and the plan guard `apps/server/src/attendance-facts.plan.test.ts`.
- The backlog: delete "**Read attendance facts by the requested day.**" (`docs/backlog.md:1647-1649`).

## What it leaves out

| Left out | Owner |
| --- | --- |
| Deleting discovery and `attendance_source_state` | pp12 |
| `payments.requested_by` itself | pa3 |
| The `payments` delete refusal | pa2 (owner lands) |

## Files

- Modify: `packages/payments/src/schema/payments.ts`; `packages/workforce/src/schema/attendance.ts`,
  `attendance-types.ts`; `apps/server/src/attendance-capture.ts`, `attendance-facts.ts`,
  `attendance-discovery.ts`, `till-sale.ts`, `payments-api.ts`, `boot.ts` (stops passing the
  integrated recorder); `apps/server/scripts/bench/measure.ts`.
- Delete: `apps/server/src/attendance-integrated.ts`, `attendance-integrated-payments.test.ts`,
  `attendance-integrated-discovery.test.ts` (their behaviour cases move, Task 3),
  `attendance-integrated.read-plans.test.ts` (it pins a read this deletes).
- Create: `apps/server/src/attendance-facts.plan.test.ts`.
- Tests: `apps/server/src/attendance-whole-payments.test.ts`, `attendance-zero-payments.test.ts`,
  `attendance-capture.test.ts`, `attendance-facts.test.ts`, `till-sale.test.ts`, `payments-api.test.ts`.
- Generated (uncounted): the workforce and payments starting migrations, snapshots, epoch.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Card-payment branch, type | 25 |
| Schema narrowing, payments index | 20 |
| Outcome removal (replacements only; deletions uncounted) | 30 |
| Bench case | 40 |
| Plan guard test | 60 |
| Card-payment fact tests (moved from the integrated tests), hand-keyed exclusion, day boundary | 200 |
| Re-pointed tests (outcome gone) | 80 |
| **Total** | **≈ 455** |

Uncounted: `attendance-integrated.ts` (152 lines) and its tests, deleted call sites, generated files.

## Finish line

```bash
pnpm --filter @waitron/server exec vitest run src/attendance-facts.test.ts src/attendance-facts.plan.test.ts \
  src/attendance-capture.test.ts src/attendance-whole-payments.test.ts src/attendance-zero-payments.test.ts \
  src/attendance-discovery.test.ts src/attendance-loop.test.ts src/attendance-marks.test.ts \
  src/till-sale.test.ts src/payments-api.test.ts
pnpm --filter @waitron/payments exec vitest run
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm exec vitest run scripts/classification-complete.test.ts scripts/starting-migrations.test.ts \
  scripts/migration-upgrade.test.ts scripts/schema-constraints.test.ts
git grep -nE 'IntegratedAttendance|attendance-integrated' -- apps packages scripts; test $? -eq 1
```

## Expected protection-list difference

Under all six `database=venue` headers. `staff_activity` has change-feed triggers whose `when`
lists its columns.

| Table | Lines | Design reason (appendix §5) |
| --- | --- | --- |
| `staff_activity` | `missing table staff_activity.columns[outcome]`; `changed table staff_activity.columnOrder`; `missing table staff_activity.checks[staff_activity_outcome_ck]`; `changed table staff_activity.checks[staff_activity_source_ck].expression`; `changed table staff_activity.checks[staff_activity_kind_ck].expression`; `missing index staff_activity_pending_idx`; change-feed only: `changed trigger waitron_change_staff_activity_update.when` | "index pending dropped with `outcome`; CHECK source narrowed; CHECK kind narrowed; CHECK outcome dropped" (source keeps `draft`: pp10's decision) |
| `payments` | `extra index payments_created_at_idx` | review decision 2026-11-08: the attendance day read needs it |

Any other line is a stop.

## Stop points (beyond rules §5)

1. **Measurement 1's failing result** (Task 4): the `attendance.day` median is over 50 ms on the
   year, or the plan guard shows a branch scanning a table other than `time_entries`. The design's
   fallback: keep `staff_activity` as the one evidence table for every kind, copies included, and
   index only it. Stop; the watcher confirms.
2. **Measurement 5's failing result** (Task 5): more than 2,500 `staff_activity` rows a day on the
   bench year. The design's fallback: collapse order edits to one row per person per order per minute
   (key `${orderId}:${personId}:<minute, ISO, seconds zeroed>`, first instant kept). Stop; the watcher
   confirms.
3. A card-payment test's expected time changes because the fact now carries `created_at` instead of
   the attempt's start (`attendance-integrated.ts:39`; appendix §6 item 1). Name it; the watcher
   confirms (rules §5.3).

## Needs

- pp10; pa3 (`payments.requested_by`); slice 0's second pull request (`bench build`, `bench measure`,
  `bench compare`, `2026-11-04-a1308-slice-0-bench.md` Tasks 5 and 6).

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- Long bench runs are tracked background work, bounded by activity; stop only processes you started.
- Every commit `git commit -s`.

## Review Focus

1. **A refused, abandoned or hand-keyed card payment counts nothing new**; a settled whole-order
   card payment counts once, for the person who started it.
2. **The query plan.** Each branch but `time_entries` uses its time index.

---

### Task 1: Measurement 1, base

- [ ] **Step 1: Add the bench case** `attendance.day`: inside `withTransaction`, time
  `readAttendanceFacts(tx, day)` for the bench year's day 180 (set-up outside the timer), 200
  samples. Add its row to slice 0's case table in the testing guide's bench section.
- [ ] **Step 2: Build and measure the base** in a throwaway worktree of the base commit (CLAUDE.md
  §4), with the case copied in: `pnpm bench build --out <dir>` (about 2.2 hours, slice 0 Task 5) as
  tracked background work, then `pnpm bench measure --venue <dir> --out <base.json>`.
- [ ] **Step 3: Commit** the case: `git commit -s -m "Add the attendance day-read bench case (pp11)"`.

### Task 2: The index and the plan guard

- [ ] **Step 1: Write** `attendance-facts.plan.test.ts`: `EXPLAIN QUERY PLAN` over the facts query
  for one day names `till_sessions_opened_at_idx`, os6's and os12/os13's time indexes on
  `order_amendments`, `bill_payments`, `refunds` and `order_events`, `staff_activity_day_idx` and
  `payments_created_at_idx`; `time_entries` may scan (≈22,000 rows a year, appendix §1). It fails
  until the index and the branch exist.
- [ ] **Step 2: Add** `payments_created_at_idx`; rebuild `--set payments`.

### Task 3: Card payments from `payments`; the poller goes

- [ ] **Step 1: Write the failing tests** in `attendance-whole-payments.test.ts` (the integrated
  tests' behaviour cases, moved): `"a settled whole-order card payment counts for the person who
  started it"`, `"a refused or abandoned attempt counts nothing"`, `"a settled payment counts once"`,
  `"a hand-keyed card payment is not counted twice"` (its whole-order activity row counts; no
  `card-payment` fact), and **day boundary** (review) `"a card payment started before the changeover
  and written after it counts on its created_at day"`.
- [ ] **Step 2: Run, see them fail. Step 3: Implement** the branch, delete the poller and its calls,
  remove `outcome` and narrow the CHECKs; rebuild `--set workforce`.
- [ ] **Step 4: Run** the finish line.
- [ ] **Step 5: Commit** `git commit -s -m "Count card payments from payments; delete the in-flight poller"`.

### Task 4: Measurement 1, after

- [ ] **Step 1:** On the same machine, build the year on this branch and `bench measure`; then
  `bench compare --before <base.json> --after <after.json>`. Paste the `attendance.day` row and the
  payment and sale rows.
- [ ] **Step 2: The failing result** is an `attendance.day` median over 50 ms, or `payment.final` /
  `payment.partial` printing `slower`: Stop point 1.

### Task 5: Measurement 5

- [ ] **Step 1:** From the after-year's `volume.json`: `staff_activity` rows ÷ 360 days, and rows per
  bill (÷ 90,000). Paste both. (Slice 0's review run wrote 14.3 facts a bill with every copy; this
  counts the remainder.)
- [ ] **Step 2: The failing result** is more than 2,500 a day: Stop point 2.

### Task 6: Protection list, backlog, finish

- [ ] **Step 1:** Protection list before and after; paste and mark.
- [ ] **Step 2:** Delete the backlog index line "Read attendance facts by the requested day".
- [ ] **Step 3:** `/finish-branch`.
