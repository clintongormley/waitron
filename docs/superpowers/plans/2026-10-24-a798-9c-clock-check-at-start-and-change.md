# A798-B slice 9c — a clock check at every start and after every change, with selling stopped while it waits

> **Revision 1 (2026-10-24).** Planned beside slice 9's revision 4
> ([2026-10-23-a798-9-clock-restart.md](2026-10-23-a798-9-clock-restart.md), whose "Owner FYI
> defaults" cover this slice too: items 18–21) and slice 9b
> ([2026-10-24-a798-9b-box-sets-its-clock.md](2026-10-24-a798-9b-box-sets-its-clock.md)). Design:
> revision 7, §4.9 a, b, f, h. **Depends on slices 9 and 9b being on `main`**: this slice adds stops,
> and lands only once the box can confirm and correct its clock. Its own branch and pull request:
> `python3 ~/workspace/tools/worktree.py new waitron feat/a798-9c-clock-check --headless`.
> **Parked for the owner** (it stops every record while a check waits). Review path: FULL, two
> Codex run-it reviews side by side.
>
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Implementers
> are dispatched as `subagent_type: "implementer"`; each task is test-first and well under 100 tool
> calls; one past about 150 stops at a passing or cleanly red point, commits, and hands over.

**Goal:** the box checks its clock at every start and whenever its clock changes by more than a
minute in either direction; while a check waits, everything slice 8's stop refuses is refused with
`clock.unconfirmed`, staff see the red strip, managers the bell and (after five minutes) an email;
AEAT's time, two agreeing tills or handhelds, or an administrator's own device confirm it (and, by
slice 9b, correct the clock); a confirmation after a change lists the records the wrong clock may
have dated.

## What this rests on

- **The check's state is in the database**, so the check inside the record append sees it without
  touching `chain.ts`: `attemptAppend` already calls `refuseWhileClockBehind(tx, reading)` from
  `clock-behind.ts` (`packages/fiscal-verifactu/src/chain.ts:137`, read), which this slice extends.
  The tables were made by slice 9's migration (`clock_checks`; `clock_confirmations.check_id`):
  **no migration here**.
- **Which check is open** is decided by order of writing, never by time: the check with the largest
  `seq` is open while no confirmation names it. A restored database's old open check is older than
  the start check this node writes, so it never governs (slice 9 revision 4, R1).
- **A change of the clock** is read as slice 9's clock watch reads a jump: the wall clock against
  `CLOCK_BOOTTIME` through `/proc/uptime` ("A nonsettable system-wide clock … also includes any
  time that the system is suspended", `clock_gettime(2)`; `elapsedClock` in
  `apps/server/src/clock-watch.ts`). As built it counts only forward jumps (slice 9 plan, revision
  4, T3). Whether `/proc/uptime` stays put across a set of the wall clock on Linux is slice 9b's
  Task 0 line M3; **this slice may not start until M3 printed its expected line**.
- **Tests that boot a whole server and sell** will meet the start check. A count on 2026-10-24:
  `grep -l 'bootServer\|serverFixture\|startServer' apps/server/src/*.test.ts` names 73 files, 35 of
  which also name Veri\*Factu, `recordSale`, `/api/sales` or `/api/pay`. Task 5 handles them with a
  seam, never by weakening the check.

## Decisions

1. **What opens a check** (seat method `openClockCheck(tx, { reason, at, detail })`, writes a
   `clock_checks` row unless the latest check is already open, in which case it answers that one):
   - `start`: `bootServer` in trading mode, on the primary, when the fiscal seat has the method —
     before `serve()`, so no request is served before the check exists;
   - `change`: the clock guard (decision 3) sees the wall clock off by more than 60 000 ms, either
     way, from where the boot-time clock says it should be since the last confirmation or start;
     `detail` `{ stepMs, wallBefore, wallAfter, heads }` (`heads` as slice 9's decision 10);
   - a promotion that makes this node the seller: if it restarts the server, the start covers it;
     if not, it opens a `start` check (Task 6 finds out which, and tests it).
2. **The stop.** `refuseWhileClockBehind` (`clock-behind.ts`) refuses, after the 28-10-2024 rule and
   before the chain comparison, `clock.unconfirmed { since, reason, stepMs? }` while a check is
   open. Every reader of the stop already goes through it or `clockBehindChain` (slice 9 plan R1
   read; re-check by grep in Task 1): the named check on every money route, the chain's check, the
   staff notice, the bell's source, the Box status read, the tender-refund recovery loop's pause and
   the clock-stop email. New code `clock.unconfirmed` in the Veri\*Factu registry, error severity,
   area `box`, `system.manage`.
3. **The clock guard** (`apps/server/src/clock-guard.ts`): an anchor `{ wall, boot }` set at the
   start, after each confirmation and after each set the box makes (slice 9b); every second it
   compares `(wall − anchor.wall) − (boot − anchor.boot)`; past ±60 000 ms it opens a `change`
   check in a transaction and re-anchors. Cheap (two clock reads a second), unref'd, stopped on
   `undoOnFailure` and on close like the clock watch. A change of up to a minute in total is not a
   check (FYI 18).
4. **The start's first try** (FYI 19): right after opening the start check, before serving, one AEAT
   read (5 s at most) and, if it agrees, a confirmation; if it disagrees, slice 9b's correction;
   otherwise the check waits for the watch, the tills and an administrator.
5. **What closes a check**: any confirmation (slice 9's three sources, slice 9b's corrections) while
   a check is open writes `check_id` = the open check and `reason` = its reason. The confirmation
   rules are slice 9's, with "the stop" widened to "a stop or an open check"; for a check with no
   clock-behind stop, "taken during the stop" means a witness noted after the check opened (by the
   steady clock: the witness store is cleared when a check opens).
6. **Wrongly dated after a change** (design §4.9 f): when a confirmation closes a `change` check and
   applies no step of more than a minute (so the changed clock was right and the clock before it
   wrong), every record written after the previous confirmation's `heads` and up to the check's
   `heads` is listed, with slice 9's "ahead" rule beside it; when it steps the clock back by the
   change (the change was wrong), only slice 9's "ahead" rule applies (records stamped behind more
   than a minute were refused when made, slice 8). `misdatedRecords` gains the second rule; the
   alert and the email are slice 9's.
7. **What staff and managers see.** Staff: the red strip "No se puede cobrar: comprobando la hora
   del equipo · Avisa al encargado" / "Payments stopped: checking the box's clock · Tell a manager",
   and every refused action "No se puede cobrar hasta que se compruebe la hora del equipo. Avisa al
   encargado." / "Payments are stopped until the box's clock is checked. Tell a manager." Managers:
   the bell's error "Payments are stopped until the box's clock is confirmed ({reason:clock_check_reason}).
   The box asks the tax agency and the tills; an administrator can confirm it with their own phone on
   the Box status page." with reasons "the box has just started" / "its clock changed by
   {stepMinutes} minutes"; the email when a check has waited five minutes (FYI 20), once per check.
8. **Only the Veri\*Factu module stops** (FYI 21). Clock-ins, orders and the kitchen carry on, as in
   slice 8.

## Behaviour this slice changes

After every start, and after every clock change of more than a minute, payments and records stop
until the clock is confirmed — seconds with internet, about fifteen seconds with two tills on,
otherwise until an administrator confirms. This is the owner's decision (2026-10-24, answers 1 and
"check its clock at every start"); CLAUDE.md §5's "nothing external" holds because the
administrator's path needs nothing outside the venue (design §4.9 h).

## Global constraints

As slice 9 revision 4's: the fiscal core untouched, `chain.ts`, the golden huella test and
`inmutabilidad` unedited and green after every task in `packages/fiscal-verifactu`; **no
migration**; no time from a device or AEAT stamped on a record; refusals assert the code and params
with row counts; English only outside translation files; Chromium runs after a memory check.

## Tasks

### Task 1: The open check stops every record and money route

**Files:** `packages/fiscal-verifactu/src/clock-checks.ts` (`openClockCheck`, `openCheck(tx)`),
`clock-behind.ts` (decision 2), `errors.ts`, `staff-notices.ts`, `clock-behind-alerts.ts`,
`backend.ts`; `packages/fiscal/src/backend.ts` (optional `openClockCheck`); tests
`clock-checks.test.ts`, `chain.clock-unconfirmed.test.ts`.
- [ ] **Failing tests**: a `start` check open → `recordSale` through `VerifactuBackend` refused
  `clock.unconfirmed { reason: "start" }`, no record; `refuseWhileClockBehind` the same; the staff
  notice and the bell source answer it; a confirmation naming the check → the sale recorded; a
  second `openClockCheck` while one is open → the same row, count 1; an older open check below a
  newer confirmed one (a restored database) → not stopped; before 28-10-2024 → `clock.unusable`
  first. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-checks.test.ts
  src/chain.clock-unconfirmed.test.ts inmutabilidad src/write-path.e2e.test.ts`; then
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts scripts/alert-codes.test.ts
  scripts/ongoing-alert-codes.test.ts scripts/errors-reachable.test.ts`. The fiscal-core check
  prints nothing. Commit.

### Task 2: A confirmation closes the open check, and lists what a change dated wrongly

**Files:** `clock-confirmation.ts`, `clock-misdated.ts` and their tests.
- [ ] **Failing tests**: a `start` check closed by AEAT, by two devices noted after it opened, by an
  administrator; devices noted BEFORE it opened do not count; a `change` check of +2 h endorsed (no
  step) → every record written between the previous confirmation's `heads` and the check's listed;
  the same change undone (a step of −2 h) → none of them listed, slice 9's ahead rule only; a
  confirmation with no open check and no stop → refused `not_stopped`. Commands as Task 1. Commit.

### Task 3: The clock guard

**Files:** `apps/server/src/clock-guard.ts` (+ test), `apps/server/src/boot.ts` (start, stop on
`undoOnFailure` and on close), `apps/server/src/boot.clock-guard.test.ts` (the shape of
`boot.clock-watch.test.ts`).
- [ ] **Failing tests** (injected wall, boot clock and timer): +61 s → one `change` check, `stepMs`
  61 000; −61 s → one; +59 s → none; +30 s then +31 s → one at the second (cumulative); a suspend of
  an hour (wall and boot both +1 h) → none; after a confirmation the anchor moves; after a set the
  box made (slice 9b tells it) → none; a failing write logs `clock_guard.check_failed` and retries
  next second; `stop` waits for a write in flight. `pnpm --filter @waitron/server exec vitest run
  src/clock-guard.test.ts src/boot.clock-guard.test.ts src/boot.failed-start.test.ts`. Commit.

### Task 4: The start opens a check before serving, and tries AEAT once

**Files:** `apps/server/src/boot.ts` (decision 1 `start`, decision 4; seam
`seams.clockCheckAuthority?: () => Promise<AuthorityTimeSample | null>` replacing the seat's reader
at start only), `apps/server/src/boot.clock-check.test.ts`.
- [ ] **Failing tests** (`serverFixture`): with a fake AEAT agreeing → `/api/sales` cash 200 at
  once and one closed `start` check; with none → 409 `clock.unconfirmed`, the bell shows it, the
  strip shows on an equipment read; then an administrator off the box confirms → 200; a fake AEAT
  that never answers → the boot still serves within 6 s, stopped; a demo-mode boot (no filing)
  checks too. `pnpm --filter @waitron/server exec vitest run src/boot.clock-check.test.ts`. Commit.

### Task 5: Test fixtures that boot a server confirm at start

**Files:** `apps/server/src/testing/server-fixture.ts`, `apps/server/src/testing/boot-harness.ts`
and any other helper that calls `bootServer`; tests that boot `bootServer` directly.
- [ ] Give the shared fixtures the Task 4 seam with a fake AEAT that answers the box's own time.
  Then run `pnpm --filter @waitron/server test:coverage` (memory first; it is long) and read every
  failure: one whose cause is `clock.unconfirmed` gets the seam in its setup (a setup change, no
  assertion); **any other failure, or one that would need an assertion changed, is a STOP**. Commit
  with the list of files in the message. Proof: remove the seam from `serverFixture` and name three
  files that fail with `clock.unconfirmed`.
  If more than about fifteen files need the seam, stop at a green point, commit, and hand the rest
  to a fresh implementer as Task 5b with the list of files still failing.

### Task 6: A promotion

Find how a node becomes the seller (`apps/server/src/promote-api.ts`, `promotion-operation.ts`): if
the server restarts after it, add a test that the restarted node opens a `start` check; if not, open
one at the promotion and test that. Commit.

### Task 7: The watch confirms checks; the administrator's dialog works for them

**Files:** `apps/server/src/clock-watch.ts` (15 s while a check is open; the witness store cleared
when one opens), `apps/server/src/box-health.ts` (`clockCheck: { since, reason, stepMs } | null`),
`box-health-api.ts` (the confirm route accepts an open check as well as a stop),
`apps/dashboard/src/screens/box-status-rows.ts`, `box-status-screen.ts`, strings; tests.
- [ ] **Failing tests**: an open check and two LAN devices → closed within a watch check; the Clock
  row "Checking the clock since {time}: the box has just started" / "…its clock changed by {n}
  minutes"; the administrator's button shown for a check with no stop; the dialog refused on the box.
  Commit.

### Task 8: The till's words

**Files:** `apps/till/src/i18n/staff-notices.ts`, `apps/till/src/i18n/codes.ts` (EN and ES),
the till's tests for a refused payment and the strip. `pnpm --filter @waitron/till exec vitest run`
on the files touched (Chromium: memory first); `pnpm exec vitest run
scripts/staff-notice-codes.test.ts`. Commit.

### Task 9: The email after five minutes

**Files:** `apps/server/src/box-alert-email.ts`, `apps/server/src/i18n/box-emails.ts`, tests: no email
for a check closed within five minutes; one per manager at five minutes; none again for the same
check. Words: subject "Payments stopped at {venue}: the box's clock needs checking" / "No se puede
cobrar en {venue}: hay que comprobar la hora del equipo"; text says what started it and the three
ways out. Commit.

### Task 10: Docs, guides and LOOK

CLAUDE.md §5: a new rule line — "Every start, and every change of the box's clock by more than a
minute, opens a clock check; while one is open no record is written and no money moves
(`clock.unconfirmed`), until AEAT's time, two devices off the box or an administrator's device off
the box confirms it." Guards named, weaker than their names; `docs/developers/conventions-data.md`
receipt; guides EN/ES (`box-status.md`, `till-notices.md`) with shared `{#id}`s; the backlog
(A798-B done; open entries: a venue with no internet, under two tills and no administrator present
cannot sell after a start; slow drift of an unsynchronised clock is not a change and is caught only
by AEAT's comparison); asesor Q51's interim treatment gains the start and change checks. LOOK: the
till's strip and refusal, the Clock row and the bell during a `start` and a `change` check, light and
dark, 1280 and 390 (dashboard) and the till's sizes. Commit.
