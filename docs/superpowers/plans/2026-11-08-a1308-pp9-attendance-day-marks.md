# A1308 pp9 — every write that changes a day's attendance evidence marks that day: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** this is appendix measurement 3, built. Today a background *discovery* scan watches every
source row and re-queues a day when a row it remembered changes
(`apps/server/src/attendance-discovery.ts`, the ~1 million `attendance_source_state` rows a year).
pp12 deletes that scan. Before it can, every change the scan catches must instead mark its day in
the transaction that makes the change. This plan writes one failing test per such change, then the
marks. The scan still runs after this plan, so a missed mark loses nothing yet; pp12 removes it.

**Words used here.** To *mark* a day is to queue it for the checker or, if it is already queued,
raise its `dirty_revision` so it is checked again. The *evidence* for a day is what the checker
reads for it: sign-ins, order edits and events, payments and refunds taken, clock entries, and
shifts on published rota weeks.

**Architecture:** four functions in `@waitron/workforce`. The workforce package calls them itself
(clock appends, rota publication); the server calls them through an optional `markAttendance`
dependency that boot passes only when workforce is on, as it passes the attendance recorder today.

**How a mark finds its day (decision, from review).** A mark never computes fresh bounds and hands
them to `enqueueAttendanceDay`: that function throws `attendance.invalid` when a stored row has
different bounds (`packages/workforce/src/attendance-state.ts:31-33`), which happens after a
scheduled changeover change until the next pass refreshes unevaluated days
(`attendance-discovery.ts:556-578`), and for every past day after a time-zone change; and taking a
past instant's day from the *current* clock can pick the wrong day. Instead a mark first looks for
the stored day whose `start_at <= instant < end_at` (pp8's `attendance_days_start_idx`) and raises
its revision; only when no stored day contains the instant does it compute the day from the venue
clock and insert it. `apps/server/src/attendance-capture.ts:116-129` and
`attendance-source-changes.ts:45-51` already avoid the refresh this way.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Hono, Vitest.

**Spec:** [people appendix](../specs/2026-11-02-rationalisation/tables-people.md) "The short
version" (first bullet), §8 item 3 ("list each change the watches catch … and write a failing test
for each against the new design. Failing result: a change with no write path to hook → that one
source keeps a narrow watch"); its 2026-11-05 A1343 note ("the day-evidence read and write-path
marking audit below remain open").

**First line of the pull request:** none needed: no table changes (rules §2 applies to starting
migrations only).

**Who lands:** the lane (rules §6). It adds mark calls beside card-payment settlement and in
`apps/server/src/till-sale.ts` (the sale path) without changing what a sale or payment writes; the
fiscal checks in the finish line run unedited.

**Cites** read at `a086eedfb7`. os6, os12/os13 and pa3 have moved several of the write paths named
below; Task 1 re-reads them at the build head.

---

## What it builds

- `packages/workforce/src/attendance-marks.ts`:
  - `markAttendanceDay(tx: Transaction, at: Date | string): Promise<string>` — raises the revision
    of the stored day containing `at`, or inserts the day `businessDayAt(readVenueClock(tx), at)`
    with its bounds when none contains it; returns the business day.
  - `markPublishedShiftDays(tx: Transaction, shiftIds: readonly string[]): Promise<void>` — for each
    shift on a **published** week, marks the day containing its `starts_at` as it is now. Rota
    routes call it before a change (old days) and after it (new days); a deleted or superseded
    shift is marked before the change. Shifts on draft weeks are not evidence (the checker reads
    published weeks only, `apps/server/src/attendance-facts.ts:79-81`) and are not marked.
  - `ensureFutureShiftDays(tx: Transaction, now: Date): Promise<number>` — for each business day
    holding a shift on a published week that starts at or after `now`, inserts a day row if no stored
    day contains that shift's start (never raises an existing row's revision). Returns how many it
    inserted.
  - `markCorrectedDays(tx: Transaction, entryId: string): Promise<void>` — marks the day of the entry
    and of every entry it corrects or responds to, up its chain (the recursive walk discovery uses,
    `attendance-discovery.ts:284-292`).
- `appendToChain` (`packages/workforce/src/chain.ts:194`) calls `markAttendanceDay` for the new
  entry's `event_at` and `markCorrectedDays` when it has `corrects_entry_id` or
  `responds_to_entry_id`, in the append's own transaction.
- Workforce's rota routes keep their marks (`apps/server/src/workforce-api.ts:196-307`) but through
  `markPublishedShiftDays`, so they no longer write `attendance_source_state` watch rows
  (`attendance-source-changes.ts:59-82`); `markAttendanceSourceChanged` keeps its name and signature
  and is reimplemented on the new functions.
- The attendance pass (`apps/server/src/attendance-loop.ts:20-54`) calls `ensureFutureShiftDays`
  first, so a venue clock change that moves a future published shift into a day with no row still
  gets that day checked (discovery's rota rescan covers this today, `attendance-discovery.ts:446-463`).
  Its count joins `more`.
- Server write paths that change evidence with no copy that marks today (Task 1's inventory is the
  list): every card-payment settlement (the writes in `packages/payments/src/store.ts`, among them
  `settleInitiated` `:592` and nine other `update(payments)` sites, are marked by their server
  callers), and every write that changes which party a bill belongs to or removes a bill (case 11).
- The backlog entry "Audit attendance discovery invalidation for late attribution and rule changes"
  (`docs/backlog.md:1643-1645`, `docs/backlog/workforce.md` "## Attendance discovery invalidation")
  loses its late-attribution half (case 11); pp12 deletes the rest.

## What it leaves out

| Left out | Owner |
| --- | --- |
| Deleting discovery and `attendance_source_state`; the evidence hash; the guard that every evidence writer marks | pp12 |
| Removing the copies in `attendance_operation_facts`, which already mark their days | pp10 (replaces each removed copy with a mark) |
| The attendance loop on the job runner | batch 3 (`2026-11-08-a1308-jr1-runner-core.md` lists `attendance.end_of_day`) |

## Files

- Create: `packages/workforce/src/attendance-marks.ts`, `attendance-marks.test.ts`;
  `apps/server/src/attendance-marks.test.ts` (the server write-path cases).
- Modify: `packages/workforce/src/chain.ts`, `index.ts`; `apps/server/src/attendance-source-changes.ts`,
  `attendance-loop.ts`, `workforce-api.ts` (only if its call shape changes), the card-settlement
  callers Task 1 lists (at `a086eedfb7` among them `till-sale.ts`, `webhook.ts`,
  `pending-card-recovery.ts`, `bill-payments-loop.ts`, `reconcile-duty.ts`, `payments-api.ts`),
  `move-bill.ts` (`:335`, `:506`), `working-order.ts` (bill creation, `:1713`, and any removal),
  and `boot.ts` (passes `markAttendance` where it passes `attendance` today).
- Tests: the new files, plus `packages/workforce/src/chain.test.ts`, `apps/server/src/attendance-loop.test.ts`,
  `attendance-rota.test.ts`, `attendance-cutover-settings.test.ts`, `packages/staffing/src/rota.test.ts`
  (case 1's inverted check).
- Docs: `docs/backlog.md`, `docs/backlog/workforce.md` (above).

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| `attendance-marks.ts` (containing-day lookup, insert fallback) | 110 |
| `appendToChain`, source-changes reimplementation | 40 |
| Server write paths (about twelve sites) and boot wiring | 90 |
| Attendance pass | 15 |
| Workforce mark tests (incl. the changeover and time-zone cases) | 190 |
| Server write-path tests (one per case, plus the day-boundary cases) | 420 |
| Backlog | 10 |
| **Total** | **≈ 875** |

## Finish line

```bash
pnpm --filter @waitron/workforce exec vitest run src/attendance-marks.test.ts src/chain.test.ts \
  src/clocking.test.ts src/corrections.test.ts src/end-of-day.test.ts
pnpm --filter @waitron/staffing exec vitest run src/rota.test.ts
pnpm --filter @waitron/server exec vitest run src/attendance-marks.test.ts src/attendance-loop.test.ts \
  src/attendance-rota.test.ts src/attendance-cutover-settings.test.ts src/attendance-discovery.test.ts \
  src/till-clock-api.test.ts src/webhook.test.ts src/payments-api.test.ts src/party-move-bill.test.ts \
  src/till-api.move-bill.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

Before relying on it, check each named test file exists (`ls`): Vitest skips a missing file and
still exits 0. A name that does not exist is replaced by the real suite that covers the route.

## Expected protection-list difference

None: the report must print `EQUAL`. Any line is a stop.

## Stop points (beyond rules §5)

1. **Measurement 3's failing result**: Task 1 finds a change discovery catches that has no write
   path this plan can hook (for example a settlement inside `@waitron/payments` whose server caller
   cannot learn which payments it settled). The design's fallback: that one source keeps a narrow
   watch. Stop; the watcher confirms and says where the watch lives (no new table is in the design).
2. A case's test passes on the base for a reason other than an existing mark (a fixture runs
   discovery): fix the fixture so the test proves the mark, then continue.
3. A mark would need to run outside the writing transaction (CLAUDE.md §3).

## Needs

- pp8 (this area: `attendance_days` and `attendance_days_start_idx`).
- Outside: os6 (`order_events`, `2026-11-08-a1308-os6-order-events.md`), os12 and os13
  (`refunds`), pa3 (`payments.requested_by`, `2026-11-08-a1308-pa3-requester-and-refund-attempts.md`;
  the build order moves pa3 ahead of pp9).

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- A mark raises a stored day's revision or inserts a missing day; it never calls
  `enqueueAttendanceDay` with bounds it computed.
- Await marks in turn, never `Promise.all` (CLAUDE.md §3).
- Every commit `git commit -s`.

## Review Focus

1. **The changeover case.** With a changeover change scheduled for tomorrow, a clock-in today
   succeeds and marks today (the required test in Task 2). Before this decision it would have thrown
   from the legal record's append path.
2. **Old and new days.** Moving a published shift or correcting an entry marks the day it left as
   well as the day it reached.
3. **No mark with workforce off** (the dependency is absent, as `attendance` is today).
4. **The inventory is complete.** The reviewer re-runs Task 1's greps.

---

### Task 1: The inventory (read, then record)

The cases discovery covers, from its sources (`attendance-discovery.ts:114-168`, `:184-187`) and
watches (`:509-535`, `apps/server/src/attendance-integrated.ts:96-152`):

| # | Change | Marked today by | Expected on base |
| --- | --- | --- | --- |
| 1 | A rota edit on a **draft** week (staffing or workforce routes) | not evidence; discovery records it | inverted: the test asserts **no** day is marked |
| 4 | A workforce rota route publishes or supersedes a week, or edits a published week's shift | `markAttendanceSourceChanged` | green |
| 5 | A clock entry is appended | discovery's `clock` scan | red |
| 6 | A correction or response for an earlier day is appended | discovery's root walk | red |
| 7 | The checker appends an automatic clock-out | discovery's `clock` scan (`attendance-loop.ts:38-39`) | red |
| 8 | A bill payment is received after its day was checked | its copy's outcome change (`attendance-capture.ts:74-99`) | green |
| 9 | A refund completes after its day was checked | its copy's outcome change | green |
| 10 | A card payment for a whole order settles after its day was checked | the integrated poller (`attendance-integrated.ts:96-152`), every 30 s | red |
| 11 | A bill's party changes (`move-bill.ts:335` sets it null, `:506` sets another party) or a bill is created for, or removed from, a party with order events | nothing for creation (the backlog's probe); discovery's watch for the rest | red |
| 12 | The venue's changeover or time zone changes, moving a future published shift into a day with no row | discovery's rota rescan from now | red |
| 13 | A source row, or a row the read joins (`devices`, `working_orders`, `order_drafts`), is deleted | discovery's watch marks `deleted` | per inventory |

(Cases 2 and 3 of the first draft, draft-week shift moves and deletes, are folded into case 1:
draft weeks are not evidence, `packages/workforce/src/clocking.ts:411-417`, `:456-470`.)

- [ ] **Step 1: Re-read each write path at the build head.** For every table the checker reads
  (`till_sessions`, `order_amendments`, `order_events`, `bill_payments`, `refunds`, `payments`,
  `time_entries`, `shifts`, `roster_versions`, `attendance_operation_facts`) and every table its read
  joins, run `git grep -n "insert(<drizzle name>)\|update(<drizzle name>)\|delete(<drizzle name>)"`
  and the raw-SQL forms over `apps packages ':!*.test.ts'`. For each hit, record in the pull request
  which case it is, and whether a copy already marks it (cases 8, 9 and every copy pp10 removes),
  this plan marks it, or it is not product code. A hit that fits no case and changes evidence is
  Stop point 1.
- [ ] **Step 2: Record the card-payment settlement sites.** `packages/payments/src/reconcile.ts:441`,
  `:500` build mismatch reports and settle nothing. The writes are in `packages/payments/src/store.ts`
  (`settleInitiated` `:592` and the other `update(payments)` sites at `:195`, `:224`, `:267`, `:301`,
  `:545`, `:569`, `:619`, `:825`, plus any added since), `packages/payments/src/manual.ts` and
  `simulator.ts`. For each one that can set `settled_at`, name the server function that calls it in
  the same transaction and holds the payment's `created_at`. If a site has none: Stop point 1.

### Task 2: The workforce functions, test first

**Files:** `packages/workforce/src/attendance-marks.ts`, `attendance-marks.test.ts`, `chain.ts`.

- [ ] **Step 1: Write the failing tests** (`useVenueDb`, each reading `attendance_days` inside the
  test's own transaction right after the call):
  - `"marking an instant raises the revision of the stored day that contains it"`.
  - `"marking an instant no stored day contains inserts its day from the venue clock"`.
  - **Required:** `"with a changeover change scheduled for tomorrow, a clock-in today succeeds and
    marks today"` (store today's day, schedule the change, append a clock-in through
    `appendToChain`: no throw, today's revision raised, no second row for today).
  - `"after a time-zone change, marking a past instant raises the stored past day rather than
    computing a new one"`.
  - `"marks the day under the changeover: 03:00 belongs to the previous day with a 04:00 changeover"`.
  - `"marks a published shift's old and new day when it moves"`; `"marks nothing for a shift on a
    draft week"` (case 1).
  - `"ensures a day row for each future published shift without raising an existing one"` and
    `"ignores draft weeks and past shifts"`.
  - Case 5 `"appending a clock entry marks its day"`; case 6 `"appending a correction marks the
    corrected entry's day and its own"`; case 7 `"the checker's automatic clock-out marks its day
    again"`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** the four functions and the two calls in `appendToChain`.
- [ ] **Step 4: Run** the workforce finish-line run; existing chain and clocking assertions must not
  change.
- [ ] **Step 5: Commit** `git commit -s -m "Mark attendance days from clock appends and published shifts"`.

### Task 3: Rota writes

**Files:** `apps/server/src/attendance-source-changes.ts`, `apps/server/src/attendance-rota.test.ts`,
`packages/staffing/src/rota.test.ts`.

- [ ] **Step 1: Write the failing tests:** in `attendance-rota.test.ts`, case 4 asserts a publish
  marks the week's days **and writes no `attendance_source_state` row**; in `rota.test.ts`, case 1
  asserts a staffing edit of a draft week marks no day.
- [ ] **Step 2: Run, see the "no watch row" part fail.**
- [ ] **Step 3: Implement**: `markAttendanceSourceChanged` keeps its signature and marks through
  `markPublishedShiftDays` (for a version: the days of every shift on it, read before and after the
  route's change, as the route calls it on both sides, `workforce-api.ts:300-307`).
- [ ] **Step 4: Run** the staffing and server rota tests.
- [ ] **Step 5: Commit** `git commit -s -m "Rota publication marks the days it changes"`.

### Task 4: Server write paths

**Files:** `apps/server/src/attendance-marks.test.ts`, the sites from Task 1, `boot.ts`.

**Interfaces:** `export type AttendanceMarker = (tx: Transaction, at: Date | string) => Promise<void>;`
in `apps/server/src/attendance-capture.ts`, bound by boot to `markAttendanceDay` when workforce is
on; each site's deps gain `markAttendance?: AttendanceMarker` beside its existing `attendance`.

- [ ] **Step 1: Write the failing tests** in `apps/server/src/attendance-marks.test.ts`, through the
  real routes or functions each case's site belongs to:
  - Cases 8 and 9 (expected green): `"receiving a bill payment later marks its day"`,
    `"completing a refund later marks its day"`.
  - Case 10, one test per settlement site Task 1 recorded: `"settling a whole-order card payment
    <through site> marks the day containing its created_at"`.
  - Case 11: `"opening a bill for a party marks the days of its earlier order events"`; `"moving a
    bill to another party marks the days of both parties' order events"`; `"taking a bill off its
    party marks the days of that party's order events"`; one per removal path Task 1 found.
  - Case 12: `"after a changeover change, the next pass queues the day a future published shift
    moved into"` (through `runAttendancePass`).
  - Case 13: one test per product delete Task 1 found.
  - **Day boundary, one per source whose time pp10 moves** (bill payment, order event, card payment):
    `"a <source> written just before the changeover with its row created just after marks the
    created_at day"` — the write's clock reading on one side of the changeover and the row's
    `created_at` on the other; the mark lands on the `created_at` day (pp10's read uses the same
    instant, and its own boundary tests pin that).
  - `"marks nothing when workforce is off"` (no `markAttendance` dependency).
- [ ] **Step 2: Run, see the red cases fail.**
- [ ] **Step 3: Implement** the marks at each site and the boot wiring; `runAttendancePass` calls
  `ensureFutureShiftDays` first.
- [ ] **Step 4: Run** the finish line.
- [ ] **Step 5: Commit** `git commit -s -m "Server writes that change attendance evidence mark their day"`.

### Task 5: Backlog, finish

- [ ] **Step 1:** In `docs/backlog/workforce.md` "## Attendance discovery invalidation", delete the
  first paragraph (the late-attribution probe, now case 11) and keep the second (rule changes),
  which pp12 finishes; shorten the `docs/backlog.md` index line to match.
- [ ] **Step 2:** Protection list: `EQUAL`.
- [ ] **Step 3:** `/finish-branch`.
