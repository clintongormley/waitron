# A1308 jr4 — working-time processing and the mail jobs on the runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6). The certificate reminder job only changes when an existing decision
runs; nothing reaches AEAT.

**Goal:** End-of-day working-time processing (R4) wakes on its own work rows and due times instead
of opening a write transaction every 30 seconds, checks the role on every pass, and starts on a box
promoted after start; the one mail sender (R5), the certificate reminder decision (R6) and the box
alert decision (R7) run as runner jobs.

**Architecture:** Each becomes a `JobDefinition` (jr1) built beside its code. The mail sender is
3a-i's `runMailPass` (`apps/server/src/mail-sender.ts`, plan
[`2026-11-08-a1308-3a-mail-queue.md`](2026-11-08-a1308-3a-mail-queue.md) Task 3), adopted as that
plan says ("the job runner comes later and adopts it"). The box alert decision is 3b-ii's
`startBoxEmailDuty`, which still decides once a minute ([3b plan](2026-11-08-a1308-3b-reminders-and-alerts-on-queue.md),
"What it leaves out": "The job runner adopting the box alert duty's minute timer").

**Spec:** [jobs.md §2 R4, R5, R6, R7; §3 rows "End-of-day working-time processing", "Missing-times emails", "AEAT certificate expiry reminder emails", "Managers' box alert emails"; §4 "Performance" (the 30 s write-lock turn), "Data loss" (duties started only if primary at start); §5 measure 8](../specs/2026-11-02-rationalisation/jobs.md).
Slice rules apply. **Timings:** `timings.x` is env1's `DutyTimings`, or `config.x` before env1.

## What it builds

1. `attendance.end_of_day`: next due is the earliest due work row or the next end of a working day;
   woken by a change to the work table; no write transaction on an idle pass; role read on every pass;
   discovery begun on the first pass as primary, even on a box promoted after start.
2. `mail.send`: 3a-i's sender on the runner, woken by `outgoing_mail` inserts.
3. `fiscal.certificate_reminders`: the reminder decision on the runner.
4. `box.alert_mail`: 3b-ii's decision on the runner, once a minute.

## What it leaves out

Mail kinds and owners (3a, 3b, A1002, the fiscal slice); `email_inbox` publishing (jr12).

## Files

- Modify: `apps/server/src/attendance-loop.ts`, `attendance-loop.test.ts`, `mail-sender.ts`,
  `mail-sender.test.ts`, `certificate-reminder-worker.ts` (or the fiscal slice's successor file),
  `certificate-reminder-worker.test.ts`, `box-alert-email.ts`, `box-alert-email.test.ts`,
  `boot.ts` (the working-time start, `:2416-2457` at `a086eedfb7`; 3a-i's `startMailSender`; the
  reminder start, `:2459-2482`; `startBoxEmailDuty`, `:2982-3011`), `background-duties.ts`,
  `background-duties.test.ts`, `handover-stepdown.test.ts`, `boot.promote.test.ts`
- Cites into `boot.ts`, `background-duties.ts` and `handover-stepdown.test.ts` will have moved with
  3a, 3b and jr1–jr3: find them by the quoted text (3b's own rule for the same files).

## Size

| Hand-written | Lines |
| --- | --- |
| Code: attendance job and its two reads 110, mail job and `nextMailDueAt` 45, reminder job 25, box alert halt and job 40, `boot.ts` 60, `background-duties.ts` 15 | **~295** |
| Tests: attendance 120, mail 60, reminders 40, box alert re-pointed 80, stepdown and duties 30, promotion 20 | **~350** |
| Total | **~645** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/attendance-loop.test.ts src/mail-sender.test.ts src/certificate-reminder-worker.test.ts src/box-alert-email.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts src/boot.promote.test.ts src/boot.restricted-quiet.test.ts src/attendance-discovery.test.ts` — passes, `Tests` count printed.
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

jr1, jr2, jr3; 3a-i; 3b-ii; the people slice (its work-table name).

## Global Constraints

- Spain's working-time record is a legal duty from launch day: no change to what a pass records,
  only to when it runs (jobs.md R4).
- A pass that finds nothing due opens no write transaction (`tenancy.ts:35` takes the write lock).
- A send already under way at a stepdown finishes; no further row is claimed (3a-i, Review Focus 3).
- The full-disk email keeps its direct send inside the box alert decision (jobs.md §1).

## Review Focus

1. **A box promoted after start with working time switched on.** Discovery begins once, on the first
   pass as primary, and processing follows. Task 1's promotion case.
2. **A clock-out written after the day ended.** It bumps the day's work row
   (`attendance-source-changes.ts:49`), which wakes the job; no 30 s poll is needed. Task 1.
3. **A working day ending with nothing written.** The job wakes at the day's end by due time alone.
   Task 1's "processes a day at its end with no change written".
4. **The mail job waking on its own status writes.** An idle pass writes nothing, so it settles
   (3a-i Review Focus 5). Task 2's "an idle pass joins no write turn".
5. **A stepdown during a box alert check.** The decision's stop flag is set before the abort returns.

---

### Task 1: `attendance.end_of_day`

**Interfaces:**
- `attendanceJob(deps: AttendancePassDeps & { beginDiscovery: () => Promise<void>; maxSleepMs: number }): JobDefinition` —
  name `attendance.end_of_day`; added only when working time is enabled (today `workforceEnabled`,
  `boot.ts:2421`), on every box; `applies: deps.isPrimary`; `wakeOn: [<the work table's resource type>]`
  (`attendance_day_work`, or `attendance_days` once the people slice renamed it, tables-people.md
  "`attendance_days` — rename of `attendance_day_work`"); `minSleepMs: 500` (today's "more" sleep,
  `attendance-loop.ts:67`); `maxSleepMs: timings.maxTickMs`; `backoff { firstMs: 5_000, maxMs: 300_000 }`.
- `pass`: on the first pass where it applies, `await deps.beginDiscovery()` once per process
  (today's `beginAttendanceDiscovery` call, `boot.ts:2422-2429`, which then ran only on a box
  primary at start). Then `attendanceWorkPending(db, now)` — a plain read, no transaction — and only
  if it answers true, today's `runAttendancePass`. Returns `{ nextDueAt: now }` when the pass says
  `more`, else `{ nextDueAt: await nextAttendanceDueAt(db, now) }`.
- `attendanceWorkPending(db: Database, now: Date): Promise<boolean>` — true when the discovery scan
  is unfinished (read its scan state as `discoverAttendanceDays` does, `attendance-discovery.ts:427-520`)
  or a work row is due (the predicate at `attendance-loop.ts:41-51`).
- `nextAttendanceDueAt(db: Database, now: Date): Promise<Date | null>` — a plain read: the earliest of
  `max(next_due_at, end_at)` over rows with work outstanding (dirty above evaluated, or deferred
  shifts) and `end_at` over rows whose day has not ended.
- `runAttendanceLoop` is deleted.

- [ ] **Step 1: Failing tests** in `attendance-loop.test.ts` (`useVenueDb`, runner with fake timers):
  `"processes a day at its end with no change written"`; `"a clock-out after the day ended wakes the job and is processed"`;
  `"an idle pass opens no write transaction"` (count `withWriteLock` calls through a wrapped db);
  `"reads the role on every pass"`; `"a box promoted after start begins discovery once and then processes"`;
  `"a failing pass backs off 5 s, then 10 s"`. Today's loop cases are re-pointed with unchanged
  assertions, except the two this plan changes on purpose: the idle 30 s sleep (now the next due
  time) and the 0.5 s retry after a throw (now the back-off).
- [ ] **Step 2–4:** Run — FAIL; implement; run — PASS. Commit: "Process finished working days on the job runner, by due time and wake".

### Task 2: `mail.send`

**Interfaces:**
- In `mail-sender.ts`: export `nextMailDueAt(deps: MailSenderDeps): Promise<Date | null>` (the read
  3a-i's loop already makes after an idle pass) and
  `mailSendJob(deps: MailSenderDeps & { maxSleepMs: number }): JobDefinition` — name `mail.send`;
  `applies: deps.isPrimary` (the pass keeps its own step-0 check); `wakeOn: ["outgoing_mail"]`;
  `minSleepMs: 500`; `maxSleepMs: 60_000` (3a-i's defaults); `backoff { firstMs: 5_000, maxMs: 60_000 }`;
  `pass`: `runMailPass` → processed gives `nextDueAt: now`, else `nextMailDueAt`.
- `runMailLoop` and `startMailSender` are deleted. Boot runs `abandonMailClaims` in its own
  transaction (as `startMailSender` did first), then `jobRunner.add(mailSendJob(…))`, still inside
  `if (!fencedOrMirror)`.

- [ ] **Step 1:** Re-point 3a-i's loop cases in `mail-sender.test.ts` (including "wakes on an
  insert") to the job; assertions unchanged. `boot.zone-admission.test.ts`'s mock moves from
  `startMailSender` to `mailSendJob`.
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
- [ ] **Step 2:** `boot.promote.test.ts`: add `attendance.end_of_day`, `mail.send` and
  `box.alert_mail` to `PRIMARY_ONLY` when the test venue builds them (working time on; not a mirror).
  The promotion case then asserts each passed after the promote, with no restart (measure 8).
- [ ] **Step 3:** Run the Finish line — PASS. `rg -n "runAttendanceLoop|runMailLoop|startMailSender|runCertificateReminderLoop|startBoxEmailDuty" apps packages docs`
  finds nothing but history; update any doc sentence that says working time starts only on a box
  primary at start. Commit: "Remove the working-time and mail loops from the duty table".
