# A1308 jr8 — scheduled backups on the runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** Scheduled backups (R12) become a runner job: next due is the next scheduled time, a settings
save wakes it, and the role is checked on every pass, so a box promoted after start begins backing
up without a restart. Measure 9 decides whether jr9 moves the backup copy to a worker thread.

**Architecture:** Today `BackupSupervisor.reload()` (`apps/server/src/backup-supervisor.ts:227-356`)
checks the role once and starts `runBackupSweep`, a loop of its own (`backup-sweep.ts:451-499`). The
loop's scheduling (fire time fixed per cycle, the clock-stepped-back escape, the run at every reload)
moves, unchanged, into a small scheduler object whose `pass` the job calls; `runOnce`
(`backup-sweep.ts:190-356`) and the staging turn (`:501-516`) do not change. The supervisor keeps the
settings, the backends, the status and the room note. The job applies on the primary; when its pass
finds the supervisor last loaded while the box was not primary (so nothing is open and no schedule
exists), it reloads first. A promotion reaches it at once, because `roleChanged()` ends the job's
sleep (jr1); nothing else is needed — a job that does not apply sleeps its ceiling (one hour here),
so waiting for a slow re-check would not do.

**Spec:** [jobs.md §1 "One backup service with several backends"; §2 R12; §3 row "Scheduled backups"; §4 "Data loss"; §5 measures 8 and 9](../specs/2026-11-02-rationalisation/jobs.md);
README §7 ("Heavy reads and the backup copy move to a worker thread"). Slice rules apply.

## What it builds

1. `createBackupSchedule(deps)` with `pass(now, signal)`: today's loop logic as passes.
2. `backups.scheduled` on the runner; `BackupSupervisor` no longer starts a loop.
3. A promoted box reloads the supervisor in its next pass and backs up; a settings save (the route's
   existing `reload()`) wakes the job.
4. Measure 9 (Task 1).

## What it leaves out

Waitron Cloud as a backend (jr10); the copy on a worker thread (jr9, only if measure 9 says so);
backups configured only on the dashboard and the backup settings document (env5, env6).

## Files

- Modify: `apps/server/src/backup-sweep.ts` (`:451-499` the loop), `backup-sweep.test.ts`
  ("runBackupSweep (loop logic …)", `:475-1157`), `backup-supervisor.ts` (`:198-356`, `:500-520`),
  `backup-supervisor.test.ts`, `boot.ts` (`:2861-2893`, the holders listener from jr2),
  `background-duties.ts` (`backupSupervisor`), `background-duties.test.ts`,
  `handover-stepdown.test.ts` (`:284-292`), `boot.promote.test.ts`

## Size

| Hand-written | Lines |
| --- | --- |
| Code: schedule object 90, supervisor 110, job 40, `boot.ts` 25, duties 10 | **~275** |
| Tests: loop cases re-pointed through a 20-line driver 90, supervisor 120, job 70, promotion 15 | **~295** |
| Total | **~570** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/backup-sweep.test.ts src/backup-supervisor.test.ts src/backup-api.route.test.ts src/low-space-backups.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts src/boot.promote.test.ts src/start-full-disk.e2e.test.ts` — passes, `Tests` count printed.
2. Typecheck, format clean; protection list EQUAL; measure 9's table in the PR description.

## Expected protection-list difference

**EQUAL.** Any line is a stop.

## Stop points (beyond rules §5)

1. A case in "runBackupSweep (loop logic …)" or "a step back of the box's clock during the wait"
   (`backup-sweep.test.ts:914`) needs a changed assertion.
2. `handover-stepdown.test.ts`'s "backups and Litestream are not stopped before the answer" changes
   its assertion (backups keep running until the close; catalogue mark `keepRunning`).

## Needs

jr1–jr3. If env5/env6 have landed, `buildConfig` reads the backup document; nothing here depends on
where the settings live.

## Global Constraints

- A backup runs at every reload, as today (`backup-sweep.ts:456`'s first `tick`).
- The fire time is fixed for the cycle and never recomputed mid-wait, except when the clock stepped
  back past it (`backup-sweep.ts:474-482`).
- Everything that writes in `<state>/backup-staging` does it inside the staging turn (CLAUDE.md §3).
- A box that is not primary makes no backup; the role is read on every pass.

## Review Focus

1. **A settings save while a backup is copying.** The reload aborts the copy's signal, as today's
   teardown does (`:510-519`); the job's next pass sees the new schedule and runs at once.
2. **A promotion.** `roleChanged()` ends the job's sleep; its pass reloads the supervisor, which now
   opens the venue copy, and makes a backup (a backup runs at every reload). Measure 8's case.
3. **A demotion in process.** The job stops applying, so no further backup starts; one under way
   finishes or is cut by the close. The open handle stays until the next reload or the close.
4. **A clock step back during the wait.** The fire time is worked out again, as the loop does today.
5. **A stepdown during a backup.** Backups keep running until the close (catalogue); the close stops
   the job first, then the supervisor.

---

### Task 1: Measure 9 — what moves off the main thread

- [ ] **Step 1:** On the reference micro PC if the lane can reach it, otherwise on the build machine
  (recorded as a stand-in — **any stand-in result is a stop for the watcher**, whatever it shows,
  never a "not built" decision), through the real store, on the bench's year-of-trading copy: run
  `perf_hooks.monitorEventLoopDelay` (resolution 10 ms) on the server while, one at a time, (a) a
  backup runs (`archiveTo` is one synchronous statement, `packages/store/src/archive.ts:24-34`),
  (b) each report and export read the dashboard offers runs on the year, and (c) a sale write every
  2 seconds runs throughout. Record each one's longest main-thread stall and the sale write's
  longest wait.
- [ ] **Step 2:** In a throwaway script, open a second `node:sqlite` connection to the same venue
  file in a `worker_threads` worker while the server holds the venue lock and Litestream runs, and
  run `VACUUM INTO` there. Record whether it opens and completes, and the main thread's longest stall.
- [ ] **Step 3: Verdicts, written in advance** (jobs.md §5.9):
  - the backup copy stalls the main thread for 200 ms or more **and** the worker's connection works
    beside the lock and Litestream → jr9 is built (the copy moves to a worker thread);
  - the worker's connection does not fit → the copy stays on the main thread (the design's
    fallback); jr9 is not built;
  - the copy stalls the main thread less than 200 ms → jr9 is not built;
  - a heavy read stalling 200 ms or more is listed in the PR description for the watcher; moving
    reads is not in this part.
  Stop and ask the watcher with the table (rules §5.4) when the verdict is anything but "not built"
  **or the numbers come from a stand-in machine**. A stand-in can only say what to measure next.

### Task 2: The schedule as passes

**Interfaces:**

```ts
// backup-sweep.ts
export interface BackupSchedulePass { nextDueAt: Date | null }
export function createBackupSchedule(deps: Omit<BackupSweepDeps, "sleep">): {
  /** Runs a backup when due (and on the first pass after creation), else returns the fixed fire
   *  time; works the fire time out again only after a backup or a clock step back past it. */
  pass(now: Date, signal: AbortSignal): Promise<BackupSchedulePass>;
};
// The job's ceiling is the loop's chunk, MAX_SLEEP_MS (one hour, backup-schedule.ts:10).
```

`runBackupSweep` is deleted; `runOnce`, `tick`'s staging-turn wrapper and `onScheduled` keep their
behaviour (`onScheduled(null)` while a backup runs, the fire time while waiting).

- [ ] **Step 1:** In `backup-sweep.test.ts`, replace the loop cases' calls to `runBackupSweep(deps)`
  with a test-local `driveSchedule(deps)` that loops `pass` and `deps.sleep(min(MAX_SLEEP_MS, nextDueAt - now), signal)`
  until aborted — the runner's own behaviour for a job with this ceiling. Assertions unchanged
  (stop point 1).
- [ ] **Step 2–4:** FAIL; implement; PASS. Commit: "Turn the backup loop into scheduled passes".

### Task 3: The job, the supervisor, the role

**Interfaces:**
- `BackupSupervisor`: `reload()` builds the schedule (`createBackupSchedule`) instead of starting a
  worker, still only on the primary with backups enabled (`:266-276`); new
  `pass(now: Date, signal: AbortSignal): Promise<BackupSchedulePass>` — when the last reload ran
  while the box was not primary (a new `#loadedAsPrimary` flag, set from `readSingletonRole()` at
  each reload, `:266-276`), it reloads first; then `{ nextDueAt: null }` when no schedule is built
  (backups off, or no key), else the schedule's pass under `AbortSignal.any([signal, <the reload's controller>])`.
  A reload already in progress (`backup.reload_in_progress`) makes the pass return
  `{ nextDueAt: <now + 60 s> }` instead of throwing. Deps gain `onReloaded?: () => void`, called at
  the end of every reload. `stop()` keeps its meaning (terminal).
- `backupsJob(supervisor: BackupSupervisor, isPrimary: () => boolean): JobDefinition` — name
  `backups.scheduled`; `applies: isPrimary`; `pass` →
  `supervisor.pass`; `minSleepMs: 1_000`; `maxSleepMs: MAX_SLEEP_MS`;
  `backoff { firstMs: 60_000, maxMs: MAX_SLEEP_MS }` (`runOnce`'s failures are already
  caught and logged by `tick`, `backup-sweep.ts:512-515`, so a throw here is unforeseen);
  `onStop`: `supervisor.stop()`.
- Boot: `onReloaded: () => jobRunner.wake("backups.scheduled")`. No holders listener: the job's own
  pass reloads on the primary. `backupSupervisor` leaves `background-duties.ts` (the job's `onStop`
  stops it).

- [ ] **Step 1: Failing tests:** `backup-supervisor.test.ts` — `"reload builds no loop of its own"`;
  `"a pass makes a backup when due and returns the next fire time"`; `"a reload aborts a backup under way"`;
  `"onReloaded is called after every reload"`; `"a pass on the primary after a reload taken while not primary reloads, then backs up"`;
  `"a pass while a reload is in progress tries again in a minute"`. A `backupsJob` case —
  `"a box that is not primary makes no backup"`; `"a promoted box backs up without a restart"` (a
  local-folder destination saved while the box was a secondary; `roleChanged()`; within 5 s an
  archive is in the folder). `boot.promote.test.ts`: add
  `backups.scheduled` to `PRIMARY_ONLY` (with a local-folder destination set before the promote).
- [ ] **Step 2–4:** FAIL; implement; PASS. Re-point the supervisor suites that awaited the worker
  ("stop() landing inside a reload, and a worker that fails", `:684`) to the job. Commit: "Run scheduled backups on the job runner".
- [ ] **Step 5:** `rg -n "runBackupSweep|backup.worker_rejected" apps packages docs` — history only.
  Update any runbook sentence that says backups start only on a box primary at start or need a restart
  after a promotion. Run the Finish line.
