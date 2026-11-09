# A1308 pp10 — the attendance checker reads sign-ins, payments, refunds and amendments where they live: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** `attendance_operation_facts` becomes `staff_activity`. The copies of till sign-ins, bill
payments, refunds and order amendments stop being written; the checker reads those rows where they
live, each filtered by its own time column. Order events keep their attributed-at-write rows (the
decision below). pp11 then moves card payments onto `payments`, deletes the in-flight poller, drops
`outcome`, narrows the CHECKs and runs measurements 1 and 5.

**Words used here.** A *copy* is a row written into `attendance_operation_facts` with another row's
id, person and (for some) time, so the checker could read it in one place (appendix §6 item 1).
*Qualifies* means the activity counts as evidence that the person was working.

**Architecture:** a committed rename script; then each removed copy-writing call becomes pp9's
`markAttendance` call; the facts read (`apps/server/src/attendance-facts.ts:9-63`) gains per-source
branches for the four sources. Discovery and the integrated poller are untouched here.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U3; [people
appendix](../specs/2026-11-02-rationalisation/tables-people.md) "The short version" (third bullet),
§1 `staff_activity`, §5, §6 item 1, §7 (orders area).

**First line of the pull request:** "Every venue is reset: workforce; backups and exports from
before this cannot be restored or imported." (rules §2)

**Who lands:** the lane (rules §6).

**Cites** read at `a086eedfb7`; os6 and os12/os13 rewrote several files named; Task 1 re-reads every
copy writer at the build head.

---

## Decision: order events keep their attribution as it was when they were written

Today an order event counts in two ways: a copy written at the time, only if the event's draft or
party already had a bill (`apps/server/src/order-drafts.ts:1578-1595`,
`apps/server/src/order-groups.ts:2797-2813`), which keeps counting whatever happens to the bill later
— "a captured event still marks its day after its party loses every order",
`apps/server/src/attendance-discovery.test.ts:1019` — and the source row itself, only while its
party has a bill (`attendance-facts.ts:22-30`, joined to `working_orders` by party). Events of a
party that never had a bill do not count (the case just before, `:1005-1015`). A bill moved to
another party (`apps/server/src/move-bill.ts:335`, `:506`) changes the second answer but not the
first.

No read of `order_events` alone keeps both tests: "attributed now" loses the first, "count every
actor's event" breaks the second. So this plan keeps attribution fixed at write: an event attributed
when it is written still records a `staff_activity` row (source `draft`, key `event:<id>` or
`group:<id>`, as os6 keeps them, its plan's ":136-137"), and the read keeps today's union (the event
row while its party has a bill and no such `staff_activity` row exists, plus every `staff_activity`
row). This departs from the appendix, which lists these copies among those that go (§6 item 1);
**Owner, 2026-11-09:** confirmed, so no one needs to confirm it before building. pp9's case 11 already marks both
parties' days when a bill moves.

## What it builds

- `scripts/a1308/pp10-staff-activity-rename.mjs` and test: whole-word renames
  `attendance_operation_facts` → `staff_activity`, `attendanceOperationFacts` → `staffActivity`, and
  the index names' prefix (57 file users at `a086eedfb7`, `git grep -l` over both names outside
  `drizzle/`).
- Copies removed; each copy call becomes `markAttendance(tx, <the source row's time>)` in the same
  place (Task 1 is the list at the build head; at `a086eedfb7`): till sign-in (`till-api.ts:1475`),
  bill payment created and received (`bill-payments.ts:1159-1185` and its receive path), refund
  created and state changed (os12/os13's writers in place of `bill-refunds.ts:120-136`,
  `tender-refunds.ts:134-142`, `tender-refund-sends.ts:200`), amendment copies
  (`working-order.ts:7340-7356`, `captureOrderAmendment`).
- Kept, recording `staff_activity`: order edits per revision (`working-order.ts:361-369`), kitchen
  service actions (`captureKitchenActivity`, `attendance-capture.ts:22-41`), the whole-order payment
  taken at the till (`till-sale.ts:121-139`, `captureWholePayment`), order events attributed at
  write (decision above), and — until pp11 — the integrated card attempt.
- The facts read: the `session`, `order` (amendment), `bill-payment` and `refund` branches read the
  source rows, each filtered by text comparison `>= ${day.startAt} and < ${day.endAt}` on its own
  time column (Task 1 step 3 checks each writer stores `toISOString()` spelling):

| Fact `source` | Row | person | time | Condition |
| --- | --- | --- | --- | --- |
| `session` | `till_sessions` join `devices` | `person_id` | `opened_at` | — |
| `order` | `order_amendments` join `working_orders` | `actor_id` | `event_at` | — |
| `bill-payment` | `bill_payments` join `working_orders` | `requested_by` | `created_at` | `received_at is not null` |
| `refund` | `refunds` | `requested_by` | `created_at` | `state = 'completed'` |
| `draft` | `order_events` (as os6 re-pointed it) | `actor_id` | `at` | its party has a bill, and no `staff_activity` row has its source and key |
| everything else | `staff_activity` | `person_id` | `at` | `business_day = ${day.businessDay}`, the time window, `outcome = 'qualifying'` (until pp11) |

  The `not exists` against copies stays only for `draft`.

## What it leaves out

| Left out | Owner |
| --- | --- |
| Card payments from `payments`; deleting `attendance-integrated.ts`; dropping `outcome`; narrowing the CHECKs; `payments_created_at_idx`; measurements 1 and 5 | pp11 |
| Deleting discovery and `attendance_source_state` | pp12 |
| Pruning `staff_activity` | A980 (README U10) |
| Time indexes on `order_amendments`, `bill_payments`, `refunds`, `order_events` | os6, os12/os13 (assumed landed) |

## Files

- Create: `scripts/a1308/pp10-staff-activity-rename.mjs`, `.test.mjs`.
- Changed by the script (uncounted): the table's file users.
- Modify: `apps/server/src/attendance-capture.ts`, `attendance-facts.ts`, `attendance-discovery.ts`
  (its `capturedRow` merge keeps working on the remaining copies), the copy writers from Task 1.
- Tests: `apps/server/src/attendance-facts.test.ts`, `attendance-capture.test.ts`,
  `attendance-bill-payments.test.ts`, `attendance-amendments.test.ts`, `attendance-orders.test.ts`,
  `attendance-draft-events.test.ts`, `till-clock-attendance.test.ts`, `attendance-discovery.test.ts`
  (its `:1005-1019` cases unchanged), and every `attendance-*.test.ts` that asserted a removed copy
  row (Task 1 step 2).
- Generated (uncounted): workforce's starting migration, snapshot, epoch.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Rename script and test | 120 |
| Copy writers turned into marks (about eight sites) | 50 |
| Facts read (four branches, draft branch kept) | 60 |
| Read tests (each source with no copy present; not-qualifying cases) | 160 |
| Day-boundary tests (bill payment, order event) | 60 |
| Re-pointed tests (assert the source row's fact instead of a copy row) | 200 |
| **Total** | **≈ 650** |

## Finish line

```bash
pnpm exec vitest run scripts/a1308/pp10-staff-activity-rename.test.mjs
pnpm --filter @waitron/server exec vitest run src/attendance-facts.test.ts src/attendance-capture.test.ts \
  src/attendance-bill-payments.test.ts src/attendance-amendments.test.ts src/attendance-orders.test.ts \
  src/attendance-draft-events.test.ts src/attendance-discovery.test.ts src/attendance-loop.test.ts \
  src/attendance-marks.test.ts src/till-clock-attendance.test.ts src/attendance-whole-payments.test.ts
pnpm --filter @waitron/workforce exec vitest run src/end-of-day.test.ts src/attendance-questions.test.ts
pnpm exec vitest run scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts \
  scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/schema-constraints.test.ts
node scripts/a1308/pp10-staff-activity-rename.mjs --write && git diff --exit-code
git grep -nE 'attendance_operation_facts|attendanceOperationFacts' -- apps packages scripts ':!**/drizzle/**'; test $? -eq 1
```

## Expected protection-list difference

Lines without a phase note appear under all six `database=venue` headers. The table has the three
change-feed triggers and no primary-key index (an integer primary key). Index names assume slice 5
renamed `attendance_operation_facts_day_idx` without changing its prefix.

| Table | Lines | Design reason |
| --- | --- | --- |
| `attendance_operation_facts` → `staff_activity` | `missing table attendance_operation_facts`; `extra table staff_activity`; `missing index attendance_operation_facts_source_uq` / `extra index staff_activity_source_uq`; `missing index attendance_operation_facts_day_idx` / `extra index staff_activity_day_idx`; `missing index attendance_operation_facts_person_idx` / `extra index staff_activity_person_idx`; `missing index attendance_operation_facts_pending_idx` / `extra index staff_activity_pending_idx`; change-feed only: `missing trigger waitron_change_attendance_operation_facts_insert`, `…_update`, `…_delete`; `extra trigger waitron_change_staff_activity_insert`, `…_update`, `…_delete` | the rename (U9); columns and CHECKs unchanged until pp11 |

Any other line is a stop.

## Stop points (beyond rules §5)

1. (Answered: **owner, 2026-11-09** — order-event rows stay in `staff_activity` with their
   attribution fixed as written; no watcher check is needed before building.)
2. A behaviour test's expected result changes because a fact's time moved from the write's clock
   reading to the row's `created_at` (appendix §6 item 1 predicts it for bill payments). Name each
   with the two times; the watcher confirms (rules §5.3).
3. os6 did not re-point the checker's event reads at `order_events`, or os12/os13's `refunds` has no
   `requested_by`/`created_at`/`state` as drawn (`tables-ordersales.md` §1.11).

## Needs

- pp9 (marks exist for every source this plan stops copying).
- os6, os12/os13 (with their time indexes).

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- The checker decides as before, from the same activity; only where four kinds of fact are read
  from, and (for bill payments) which instant they carry, changes.
- Every commit `git commit -s`.

## Review Focus

1. **Nothing qualifies that did not**: a pending bill payment, a refund not completed.
2. **Every removed copy writer marks its day instead** (pp9's tests stay green).
3. **`attendance-discovery.test.ts:1005-1019`** pass unchanged.

---

### Task 1: Inventory of copy writers and time spellings

- [ ] **Step 1:** `git grep -n "recorder(\|attendance(tx\|deps.attendance?.(tx\|captureKitchenActivity\|captureWholePayment\|captureOrderAmendment\|recordDraftEvents\|recordGroupEvent" -- apps/server/src ':!*.test.ts'`.
  For each call, record: removed (session, bill payment, refund, amendment), kept (order edit,
  service, whole-order till payment, attributed order event, integrated attempt).
- [ ] **Step 2:** List the tests that assert a removed copy row
  (`git grep -ln "attendanceOperationFacts\|attendance_operation_facts" -- '*.test.ts'`).
- [ ] **Step 3:** For each time column in the read table, cite the writer that fills it and confirm
  it stores `Date.prototype.toISOString()` spelling (CLAUDE.md §3). A writer with another spelling is
  a stop.

### Task 2: The rename

- [ ] **Steps 1–4:** Script test (fixtures, idempotent, collision refused), implement, run on the
  tree, typecheck.
- [ ] **Step 5: Commit** script, test and output:
  `git commit -s -m "Rename attendance_operation_facts to staff_activity with a committed script (pp10)"`.

### Task 3: Read the four sources, stop their copies

- [ ] **Step 1: Write the failing tests** in `attendance-facts.test.ts`:
  - `"reads a till sign-in from till_sessions"`, `"…an order amendment from order_amendments"`,
    `"…a received bill payment from bill_payments at its created_at"`, `"…a completed refund from
    refunds"` — each with **no** `staff_activity` row present.
  - `"does not read a pending bill payment or an uncompleted refund"`.
  - `"writes no staff_activity row for a sign-in, bill payment, refund or amendment"` (through the
    real routes).
  - **Day boundary** (review): `"a bill payment whose clock reading falls before the changeover and
    created_at after it counts on the created_at day"`, and the same for an order event read from
    `order_events` (its `at`); both the read and pp9's mark land on that day.
  - `"an attributed order event still counts after its bill moves to another party"` (the decision;
    passes today and must keep passing).
- [ ] **Step 2: Run, see them fail. Step 3: Implement** the four branches and turn each removed copy
  call into a mark. Re-point Task 1 step 2's tests to assert the fact the checker reads, not the copy
  row (expected facts unchanged except Stop point 2).
- [ ] **Step 4: Rebuild** `--set workforce`; run the finish line.
- [ ] **Step 5: Commit** `git commit -s -m "Read sign-ins, bill payments, refunds and amendments where they live"`.

### Task 4: Protection list, backlog, finish

- [ ] **Step 1:** Protection list before and after; paste and mark.
- [ ] **Step 2:** `/finish-branch`. (The backlog line "Read attendance facts by the requested day"
  is deleted by pp11, when every source is read by day.)
