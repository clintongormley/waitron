# A1308 jr4 — working-time processing and the mail jobs on the runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6). The certificate reminder job only changes when an existing decision
runs; nothing reaches AEAT.

**Goal:** End-of-day working-time processing (R4) stops opening a write transaction every 30 seconds
when there is nothing to do, wakes at once on its own work rows and on clocking, checks the role on
every pass, and starts on a box promoted after start; the one mail sender (R5), the certificate reminder decision (R6) and the box
alert decision (R7) run as runner jobs.

**Architecture:** Each becomes a `JobDefinition` (jr1) built beside its code. The mail sender is
3a-ii's `runMailPass` (`apps/server/src/mail-sender.ts`, plan
[`2026-11-08-a1308-3a-ii-mail-queue.md`](2026-11-08-a1308-3a-ii-mail-queue.md)), adopted as that
plan says (the runner comes later and adopts it); boot already awaits `abandonMailClaims` before
starting the sender (3a-ii), and 3a-iii
([`2026-11-08-a1308-3a-iii-account-mail.md`](2026-11-08-a1308-3a-iii-account-mail.md)) adds an
account-only sender on the time-zone repair start, which has no runner of its own today. The box alert decision is 3b-ii's
`startBoxEmailDuty`, which still decides once a minute ([3b plan](2026-11-08-a1308-3b-reminders-and-alerts-on-queue.md),
"What it leaves out": "The job runner adopting the box alert duty's minute timer").

**Spec:** [jobs.md §2 R4, R5, R6, R7; §3 rows "End-of-day working-time processing", "Missing-times emails", "AEAT certificate expiry reminder emails", "Managers' box alert emails"; §4 "Performance" (the 30 s write-lock turn), "Data loss" (duties started only if primary at start); §5 measure 8](../specs/2026-11-02-rationalisation/jobs.md).
Slice rules apply. **Timings:** `timings.x` is env1's `DutyTimings`, or `config.x` before env1.

## What it builds

1. `attendance.end_of_day`: an idle pass is one plain read that takes no write lock; the job wakes
   at once on the work table and the clocking tables; role read on every pass; discovery begun on
   the first pass as primary, even on a box promoted after start. Two shapes, by what is on `main`
   (Task 1): **while the discovery scan exists** (before pp11), "pending" also covers the scan's
   live end points, its due watches and the venue clock's fingerprint, and the ceiling stays 30 s;
   **once pp11 has deleted discovery** (every change marks its day, pp9), "pending" is due work rows
   alone and the next due time is the earliest due work row or the next end of a working day.
2. `mail.send`: 3a-ii's sender on the runner, woken by `outgoing_mail` changes; the time-zone repair
   start runs its account-only sender (3a-iii) on a runner of its own.
3. `fiscal.certificate_reminders`: the reminder decision on the runner.
4. `box.alert_mail`: 3b-ii's decision on the runner, once a minute.

## What it leaves out

Mail kinds and owners (3a, 3b, A1002, the fiscal slice); `email_inbox` publishing (jr12).

## Files

- Modify: `apps/server/src/attendance-loop.ts`, `attendance-loop.test.ts`, `attendance-discovery.ts`
  (only to export the read-only pieces Task 1 needs, while it exists), `mail-sender.ts`,
  `mail-sender.test.ts`, `certificate-reminder-worker.ts` (or the fiscal slice's successor file),
  `certificate-reminder-worker.test.ts`, `box-alert-email.ts`, `box-alert-email.test.ts`,
  `boot.ts` (the working-time start, `:2416-2457` at `a086eedfb7`; 3a-ii's `startMailSender`; the
  time-zone repair start's account sender, 3a-iii, `:2134-2211`; the reminder start, `:2459-2482`;
  `startBoxEmailDuty`, `:2982-3011`), `background-duties.ts`, `background-duties.test.ts`,
  `handover-stepdown.test.ts`, `boot.promote.test.ts`, `boot.zone-admission.test.ts`
- Cites into `boot.ts`, `background-duties.ts` and `handover-stepdown.test.ts` will have moved with
  3a, 3b and jr1–jr3: find them by the quoted text (a cite that only moved is not a stop).

## Size

| Hand-written | Lines |
| --- | --- |
| Code: attendance job and its two reads 150, mail job and `nextMailDueAt` 45, repair start's runner 20, reminder job 25, box alert halt and job 40, `boot.ts` 60, `background-duties.ts` 15 | **~355** |
| Tests: attendance 170, mail 60, repair start 20, reminders 40, box alert re-pointed 80, stepdown and duties 30, promotion 20 | **~420** |
| Total | **~775** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/attendance-loop.test.ts src/mail-sender.test.ts src/certificate-reminder-worker.test.ts src/box-alert-email.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts src/boot.promote.test.ts src/boot.restricted-quiet.test.ts src/boot.zone-admission.test.ts src/attendance-discovery.test.ts` (the last while it exists) — passes, `Tests` count printed.
2. Typecheck, format clean; protection list EQUAL.

## Expected protection-list difference

**EQUAL.** Any line is a stop.

## Stop points (beyond rules §5)

1. The fiscal slice has not folded `fiscal_certificate_reminders` into `outgoing_mail`: build Task 3
   against today's `runCertificateReminderLoop` (`certificate-reminder-worker.ts:23-45`) unchanged in
   what it does, and say so in the PR. If its file is in a fiscal package and the change would touch
   more than the loop, stop and ask.
2. An attendance test needs a changed assertion other than the two this plan names (Task 1).

## Needs

jr1, jr2, jr3; 3a-ii and 3a-iii (the sender, its repair-start use); 3b-ii (the box alert decision);
the people slice (its work-table name). Works with pp9–pp11 landed or not (Task 1's two shapes).

## Global Constraints

- Spain's working-time record is a legal duty from launch day: no change to what a pass records,
  only to when it runs (jobs.md R4).
- A pass that finds nothing due opens no write transaction (`tenancy.ts:35` takes the write lock).
- A send already under way at a stepdown finishes; no further row is claimed (3a-ii).
- The full-disk email keeps its direct send inside the box alert decision (jobs.md §1).

## Review Focus

1. **A box promoted after start with working time switched on.** Discovery begins once, on the first
   pass as primary, and processing follows. Task 1's promotion case.
2. **A clock-out written after the day ended, with no work row written.** Today only discovery's
   clock scan finds it (pp9's table, row 5: "A clock entry is appended — discovery's clock scan").
   The job wakes on the clocking tables and its idle read sees the chain's end point grow, so the
   pass runs and processes it. Task 1's "a clock-out that writes no work row is processed".
3. **A working day ending with nothing written.** The job wakes at the day's end by due time alone.
   Task 1's "processes a day at its end with no change written".
4. **The mail job waking on its own status writes.** An idle pass writes nothing, so it settles
   (3a-ii). Task 2's "an idle pass joins no write turn".
5. **A stepdown during a box alert check.** The decision's stop flag is set before the abort returns.

---

### Task 1: `attendance.end_of_day`

**Read `main` first.** If `apps/server/src/attendance-discovery.ts` still exists (pp11 not landed),
build **shape A**. If pp11 has deleted it, build **shape B**. pp9 alone does not change the shape:
discovery still runs after pp9.

**Interfaces (both shapes):**
- `attendanceJob(deps: AttendancePassDeps & { beginDiscovery?: () => Promise<void>; maxSleepMs: number }): JobDefinition` —
  name `attendance.end_of_day`; added only when working time is enabled (today `workforceEnabled`,
  `boot.ts:2421`), on every box; `applies: deps.isPrimary`; `minSleepMs: 500` (today's "more"
  sleep, `attendance-loop.ts:67`); `backoff { firstMs: 5_000, maxMs: 300_000 }`;
  `wakeOn: [<work table>, "time_entries", "workforce_chains"]` — the work table is
  `attendance_day_work`, or `attendance_days` once the people slice renamed it; the two clocking
  tables are today's names (follow any rename).
- `pass`: `attendanceWorkPending(db, now)` — a plain read on the read connection, no transaction —
  and only if it answers true, today's `runAttendancePass`. Returns `{ nextDueAt: now }` when the
  pass says `more`, else `{ nextDueAt: await nextAttendanceDueAt(db, now) }`.
- `runAttendanceLoop` is deleted.

**Shape A — discovery exists:**
- `beginDiscovery`: today's `beginAttendanceDiscovery` call (`boot.ts:2422-2429`), run once per
  process on the first pass where the job applies (today it ran only on a box primary at start).
- `attendanceWorkPending` answers true when any of these holds — each is what makes
  `discoverAttendanceDays` (`attendance-discovery.ts:427-530`) do work, read without writing:
  1. a scan row of this venue has `completed = false`;
  2. a live end point is past its saved scan's `endpoint`: `max(rowid)` of each row source
     (`rowSources`, `:117-168`, read as `endpoints` does, `:176-188`) and each `workforce_chains`
     row's `sequence_no` (the `clock` source), compared with the saved scan rows (`:465-485`) —
     `completed` stays true on a saved scan until a pass notices this, so the flag alone is not enough;
  3. the rota scan's saved clock fingerprint differs from the venue's clock now (`:446-463`; the
     same `readVenueClock` read, on the read connection);
  4. a watch row has `next_due_at <= now` (`:504-512`);
  5. a work row is due (the predicate at `attendance-loop.ts:41-51`).
- `nextAttendanceDueAt`: the earliest of future watch `next_due_at`, `max(next_due_at, end_at)` over
  work rows with work outstanding, and `end_at` over work rows whose day has not ended.
- `maxSleepMs: 30_000`. The other sources (till sessions, order events, bill payments, the rota,
  staff activity) are written constantly during service, so the job does not wake on them; their
  growth is seen by the idle read within 30 seconds, as today's poll sees it, but that read now
  takes no write lock.

**Shape B — discovery deleted (pp11):** no `beginDiscovery`; `attendanceWorkPending` is condition 5
alone; `nextAttendanceDueAt` drops the watches; `maxSleepMs: timings.maxTickMs` (jobs.md R4: next
due is the earliest due work row or the next end of day; every change marks its day in its own
transaction, pp9).

- [ ] **Step 1: Failing tests** in `attendance-loop.test.ts` (`useVenueDb`, runner with fake timers):
  `"processes a day at its end with no change written"`;
  `"a clock-out that writes no work row is processed"` — after the day ends, append a clock entry
  through the workforce chain only (no work-table write); the job wakes on the clocking change and
  the day is processed in that pass (both shapes: in A through condition 2, in B through pp9's mark);
  `"an idle pass opens no write transaction"` (count `withWriteLock` calls through a wrapped db);
  shape A only: `"an order event written after its day ended is found within 30 seconds"` and
  `"a watch that falls due is acted on"` and `"a change to the venue's day start re-scans the rota"`;
  `"reads the role on every pass"`; shape A: `"a box promoted after start begins discovery once and then processes"`
  (shape B: `"a box promoted after start processes a due day"`); `"a failing pass backs off 5 s, then 10 s"`.
  Today's loop cases are re-pointed with unchanged assertions, except the two this plan changes on
  purpose: the 0.5 s retry after a throw (now the back-off), and, in shape B only, the idle 30 s
  sleep (now the next due time).
- [ ] **Step 2–4:** Run — FAIL; implement; run — PASS. Commit: "Process finished working days on the job runner without an idle write lock".

### Task 2: `mail.send`

**Interfaces:**
- In `mail-sender.ts`: export `nextMailDueAt(deps: MailSenderDeps): Promise<Date | null>` (the read
  3a-ii's loop already makes after an idle pass) and
  `mailSendJob(deps: MailSenderDeps & { maxSleepMs: number }): JobDefinition` — name `mail.send`;
  `applies: deps.isPrimary` (the pass keeps its own step-0 check); `wakeOn: ["outgoing_mail"]`;
  `minSleepMs: 500`; `maxSleepMs: 60_000` (3a-ii's defaults); `backoff { firstMs: 5_000, maxMs: 60_000 }`;
  `pass`: `runMailPass` → processed gives `nextDueAt: now`, else `nextMailDueAt`.
- `runMailLoop` and `startMailSender` are deleted. The full start keeps 3a-ii's
  `await withTransaction(db, (tx) => abandonMailClaims(tx, owners, now()))`, then
  `jobRunner.add(mailSendJob(…))`, still inside `if (!fencedOrMirror)`.
- The time-zone repair start (3a-iii, `boot.ts:2134-2211`) has no runner: it makes one
  (`createJobRunner({ now, log })`), awaits `abandonMailClaims` for its account-only owners as 3a-iii
  does, adds `mailSendJob` with those owners, and its `stopWork` (`:2206`) awaits
  `runner.stopJobs()`. It builds nothing else on that runner.

- [ ] **Step 1:** Re-point 3a-ii's loop cases in `mail-sender.test.ts` (including "wakes on an
  insert through the change feed") to the job; assertions unchanged. `boot.zone-admission.test.ts`'s
  mock moves from `startMailSender` to `mailSendJob`; 3a-iii's repair-start cases (one sender, the
  reset mail delivered) keep their assertions, observed through the repair start's runner.
- [ ] **Step 2–4:** Run — FAIL; implement; run — PASS. Commit: "Run the mail sender on the job runner".

### Task 3: `fiscal.certificate_reminders`

**Interfaces:** `certificateReminderJob(deps: <today's pass deps minus signal>): JobDefinition` —
name `fiscal.certificate_reminders`; added only when `certificateDutiesEnabled` (`boot.ts:2461`);
`applies: deps.isPrimary`; `minSleepMs: 500`; `maxSleepMs: 3_600_000` (today's idle hour,
`certificate-reminder-worker.ts:40`); `backoff { firstMs: 3_600_000, maxMs: 3_600_000 }` (today a
failed pass waits the idle hour, `:31`); `pass`: the decision pass with `ctx.signal`, `processed`
gives `nextDueAt: now`; otherwise the next threshold if the decision reports one, else `null`.
The loop function is deleted.

- [ ] **Step 1–4:** Re-point the loop cases; FAIL; implement; PASS. Commit: "Decide certificate reminders on the job runner".

### Task 4: `box.alert_mail`

**Interfaces:** `startBoxEmailDuty` becomes `createBoxEmailDuty(deps)` returning
`{ check(): Promise<void>; halt(): void; remember }` (`halt` sets `stopped = true` and nothing else;
the minute timer and `stop` go, as jr3 did for the clock watch); `boxAlertMailJob(duty, intervalMs)` —
name `box.alert_mail`; `applies: () => true` (the decision keeps reading `isPrimary` inside, as 3b-ii
leaves it); `firstPassAfterMs = minSleepMs = maxSleepMs = BOX_EMAIL_CHECK_MS` (`box-alert-email.ts:204`);
`backoff` both `BOX_EMAIL_CHECK_MS`; its first pass hooks `ctx.signal` to `halt()` once.

- [ ] **Step 1:** Re-point `box-alert-email.test.ts`'s timer cases; assertions unchanged. In
  `handover-stepdown.test.ts`, drop `box-alert-email.ts` from the text check and `boxEmails` from
  `AT_STEPDOWN`.
- [ ] **Step 2–4:** FAIL; implement; PASS. Commit: "Decide box alert emails on the job runner".

### Task 5: Boot, duties, measure 8

- [ ] **Step 1:** Remove the working-time, mail, reminder and box alert handles, aborts and closers
  from `background-duties.ts`, and their `undoOnFailure` entries from boot (the runner's covers
  them). `ABORTS` in `handover-stepdown.test.ts` loses `attendanceController`, the mail controller
  and `certificateReminderController`.
- [ ] **Step 2:** `boot.promote.test.ts`: add `attendance.end_of_day` (working time on),
  `mail.send` (not a mirror) and `fiscal.certificate_reminders` (only when the case enables
  certificate duties) to `PRIMARY_ONLY`. Not `box.alert_mail`: it applies on every box and its first
  pass comes 60 s after start.
  The promotion case then asserts each passed after the promote, with no restart (measure 8).
- [ ] **Step 3:** Run the Finish line — PASS. `rg -n "runAttendanceLoop|runMailLoop|startMailSender|runCertificateReminderLoop|startBoxEmailDuty" apps packages docs`
  finds nothing but history; update any doc sentence that says working time starts only on a box
  primary at start. Commit: "Remove the working-time and mail loops from the duty table".
