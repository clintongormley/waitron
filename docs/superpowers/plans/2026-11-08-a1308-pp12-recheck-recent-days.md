# A1308 pp12 — the attendance scan and its million bookkeeping rows go; recent days are re-checked after a restore or migration: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** `attendance_source_state` (one remembered fingerprint per source row ever seen, about a
million rows a year) and the discovery scan that writes it are deleted. Change is detected by pp9's
marks at every write. As the safety net the scan was, a start re-checks the last 62 days when the
venue file was replaced (a restore), when the start applied a migration, or when the code's evidence
format changed. An ordinary restart re-checks nothing (A1343's rule). A guard checks that every file
writing an evidence table marks its day.

**Words used here.** To *re-check* a day is to raise its `dirty_revision` so the checker evaluates it
again; evaluation is re-runnable, and Task 2 pins that re-running it on unchanged evidence changes
nothing. A *stamp* is a small record of the venue file's identity and the evidence format version
the box last checked under.

## Decision: no per-day evidence hash; the safety net re-checks recent days

**Owner, 2026-11-09:** confirmed (no per-day hash; re-check the last 62 days). Where the stamp lives
stays the watcher's choice (below).

The appendix drew `attendance_days.evidence_hash`, a hash of exactly what a day's evaluation read
(§1, §8 item 2). Reading `processAttendanceDay` (`packages/workforce/src/end-of-day.ts:113-420`):
for each person the day concerns it reads the person's **whole** working-time record
(`readRecordedEntries(tx, { personId })`, `:231`), and its decision to write an automatic clock-out
depends on the person's latest live and effective entries (`effective.at(-1)`, `live.at(-1)`,
`:311-323`), which can lie any number of days after the day. So the set of rows an evaluation uses
cannot be bounded to the day: a hash over it would change whenever a person clocks in on a later day,
and after a restore would mark nearly every day changed. This plan takes the fallback the review
named and the appendix's own §8 item 2 fallback ("limit it to recent days, or run it only after a
restore"): **no hash; re-check every evaluated day of the last 62 days** when the stamp says the file
or format changed, or a migration ran.

**Why 62 days.** The default pay period is monthly (`pay_period_settings.frequency` defaults to
`monthly`, `packages/workforce/src/schema/pay-period-settings.ts:10`); 62 days covers the current and
the previous month in full, the window in which an unanswered working-time question still changes a
pay run. Older days keep their questions as they are. Measurement 2 (Task 6) times the re-check.

**How this keeps A1343's rule and the restore safety net.** A1343 (commit `8ee102018f`) made an
ordinary restart reuse the scan and rescan only after a file replacement, a prior schema change or a
migration. With no row positions left, `VACUUM` (same file) needs nothing. A replaced file (restore)
and a migration still re-check: the stamp holds the file's identity (device, inode and birth time,
as A1343's `attendance-discovery.ts:207-218`) and the evidence format, so a restored file carries the
old box's stamp and differs. `attendance-restore.test.ts:148` ("rescans a replaced database file even
when its schema cookie matches the source") keeps its meaning.

**Where the stamp lives (open question to the watcher).** A one-field settings document,
`attendance_evidence`, `transfers: false`, defined with 1b's `defineSettingsDocument` and saved with
`saveSettings` (`{ fileStamp: string | null; evidenceFormat: string | null }`). It is not
configuration (README R3 describes settings as configuration), but it is the only existing per-module
store in `venue.db`, and a stamp must live in the file it describes so a restored copy carries the
old one. The alternative is a column on `box` in `node.db` (the venue-and-box area's table). This
plan builds the settings document unless the watcher picks the alternative before the build.

## What it builds

- `packages/workforce/src/attendance-recheck.ts`:
  - `export const EVIDENCE_FORMAT = "v1";` with the one comment this plan adds: changing what the
    facts read returns, or how a fact is labelled, must change this value so the next start re-checks
    recent days (this replaces the backlog's "explicitly invalidate the retained scan marker" rule).
  - `ATTENDANCE_EVIDENCE` — the settings document above.
  - `recheckRecentDays(tx, input: { today: string; days: number }): Promise<number>` — one update
    raising `dirty_revision` of every row with `evaluated_revision > 0` and `business_day` in the last
    `days` days; returns the count.
  - `attendanceStartCheck(tx, input: { fileStamp: string; migrated: boolean; today: string }): Promise<{ rechecked: number; reason: "migration" | "file" | "format" | null }>`
    — compares the stored stamp with `fileStamp` and `EVIDENCE_FORMAT`; if a migration ran, the file
    stamp differs, the format differs, or no stamp is stored while evaluated days exist, calls
    `recheckRecentDays(…, { days: 62 })`; then saves the current stamp.
- Boot (`apps/server/src/boot.ts:2422-2429`): the `beginAttendanceDiscovery` call and
  `attendanceSchemaBeforeMigrations` (`:1177`, `:1205`) go. In their place, when workforce is on and
  the box is the primary: read `schemaVersionsByModule` before `applyMigrations` as well as after
  (`:1266` reads it after today); `migrated` is true if any set's version rose; compute the file
  stamp from `pragma database_list` and `lstat` exactly as A1343 does; call `attendanceStartCheck`.
- Deleted: `attendance_source_state` (schema, classification, exports, every list); from
  `apps/server/src/attendance-discovery.ts`, `beginAttendanceDiscovery`, `discoverAttendanceDays`,
  `remember`, `capturedRow`, `sourcePage`, `watchedRow`, `endpoints`, `dirtyDay`, `rowSources`,
  `scanScope`; `attendance-source-changes.ts`'s remaining watch code (pp9 already marks through
  `markPublishedShiftDays`). `nextAttendanceDay` no longer waits for scans
  (`attendance-discovery.ts:554`). Kept and moved to `apps/server/src/attendance-days.ts`:
  `reconcileAttendanceBeforeClock`, `reconcileAttendanceDay`, `nextAttendanceDay`.
- A guard, `scripts/attendance-evidence-writers.test.ts` (root project): for every non-test `.ts`
  file under `apps` and `packages` that contains an `insert(`, `update(` or `delete(` of one of the
  evidence tables' drizzle names (`tillSessions`, `orderAmendments`, `orderEvents`, `billPayments`,
  `refunds`, `payments`, `timeEntries`, `shifts`, `rosterVersions`, `staffActivity`) or their raw-SQL
  forms, the same file must call `markAttendance`, `markAttendanceDay`, `markPublishedShiftDays`,
  `recordAttendanceFact` or `appendToChain`, or appear in an allowlist inside the guard that names the
  caller that marks for it (for example `packages/payments/src/store.ts` → the server settlement
  callers pp9 lists). **Weaker than its name:** it reads text and judges a file, not a call path: a
  file that marks in one function and writes evidence in another passes, a write spelled another way
  is not seen, and an allowlisted caller is trusted to mark. CLAUDE.md §3 gains one line naming it
  so, with its limits in `docs/developers/conventions-data.md`.
- Docs: the backlog entry "Audit attendance discovery invalidation…" (what pp9 left of it) and its
  `docs/backlog/workforce.md` section are deleted; a dated pointer is added under the A1343 note at
  the top of `docs/superpowers/specs/2026-11-02-rationalisation/tables-people.md` and in
  `docs/superpowers/plans/2026-10-14-a10-3-end-of-day-plan.md` ("<date>, A1308 pp12: the scan is
  gone; recent days are re-checked after a restore, migration or format change; no evidence hash —
  see the pp12 plan").

## What it leaves out

| Left out | Owner |
| --- | --- |
| `attendance_days.evidence_hash` | not built (decision above) |
| The attendance loop on the job runner | batch 3 (`jr1` lists `attendance.end_of_day`) |
| Pruning `till_sessions`, `staff_activity` | A980 (README U10) |

## Files

- Create: `packages/workforce/src/attendance-recheck.ts`, `attendance-recheck.test.ts`;
  `apps/server/src/attendance-days.ts` (moved functions), `attendance-days.test.ts` (moved cases);
  `scripts/attendance-evidence-writers.test.ts`.
- Modify: `packages/workforce/src/schema/attendance.ts`, `index.ts`, `classification.ts`, the
  workforce module descriptor (declares `ATTENDANCE_EVIDENCE` in `settings`);
  `apps/server/src/attendance-loop.ts`, `boot.ts`, `till-clock-api.ts` and `workforce-api.ts`
  (imports); `CLAUDE.md` (one guard line), `docs/developers/conventions-data.md`.
- Delete: `apps/server/src/attendance-discovery.ts` (after the move), `attendance-source-changes.ts`
  if empty, the scan and watch cases of `attendance-discovery.test.ts`.
- Modify (bench): `apps/server/scripts/bench/measure.ts` gains `attendance.recheck-pass` and
  `attendance.recheck-contention`.
- Tests re-pointed from discovery to marks (pp9 made them pass without it):
  `attendance-cutover-settings.test.ts`, `till-clock-attendance.test.ts`,
  `attendance-obligations.test.ts`, `attendance-capture.test.ts`, `attendance-loop.test.ts`,
  `attendance-rota.test.ts`; changed by design (Task 5): `attendance-restore.test.ts`,
  `boot.attendance.test.ts`; `packages/workforce/src/index.test.ts`, `schema-ownership.test.ts`,
  `attendance-state.test.ts` (table lists).
- Generated (uncounted): workforce's starting migration, snapshot, epoch.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| `attendance-recheck.ts` and the settings document | 80 |
| Boot, pass | 50 |
| Moved functions (edits only) | 20 |
| Guard and its allowlist | 110 |
| Bench cases (pass, contention) | 70 |
| Re-check tests, re-evaluation idempotence test | 170 |
| Restart, migration, restore and format tests (Task 5) | 170 |
| Re-pointed attendance tests | 100 |
| CLAUDE.md line, conventions-data receipt, pointers | 30 |
| **Total** | **≈ 800** |

Uncounted: about 550 deleted lines of `attendance-discovery.ts`, the scan and watch test cases, the
table, generated files.

## Finish line

```bash
pnpm --filter @waitron/workforce exec vitest run src/attendance-recheck.test.ts src/end-of-day.test.ts \
  src/attendance-state.test.ts src/attendance-marks.test.ts src/index.test.ts src/schema-ownership.test.ts
pnpm --filter @waitron/server exec vitest run src/attendance-days.test.ts src/attendance-loop.test.ts \
  src/attendance-marks.test.ts src/attendance-restore.test.ts src/boot.attendance.test.ts \
  src/attendance-cutover-settings.test.ts src/till-clock-attendance.test.ts src/attendance-obligations.test.ts \
  src/attendance-capture.test.ts src/attendance-rota.test.ts src/attendance-facts.test.ts src/till-clock-api.test.ts
pnpm exec vitest run scripts/attendance-evidence-writers.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts \
  scripts/schema-constraints.test.ts scripts/claude-md-pointers.test.ts
git grep -nE 'attendance_source_state|attendanceSourceState|discoverAttendanceDays|beginAttendanceDiscovery|attendanceSchemaBeforeMigrations' -- apps packages scripts ':!**/drizzle/**'; test $? -eq 1
```

## Expected protection-list difference

Lines without a phase note appear under all six `database=venue` headers. `attendance_source_state`
has a primary-key index, two named indexes (slice 5's names; the builder writes them) and the three
change-feed triggers.

| Table | Lines | Design reason (appendix §5) |
| --- | --- | --- |
| `attendance_source_state` | `missing table attendance_source_state`; `missing index attendance_source_state.primary key(id)`; `missing index attendance_source_state_scope_uq` and `missing index attendance_source_state_watch_idx` (slice 5's names); change-feed only: `missing trigger waitron_change_attendance_source_state_insert`, `…_update`, `…_delete` | "dropped with the table" |

No `attendance_days` line: the evidence hash is not built. The settings document is a row, not
schema. Any other line is a stop.

## Stop points (beyond rules §5)

1. **Measurement 2's failing result** (Task 6): one re-check pass (one day's evaluation) holds the
   write transaction for a median over 50 ms on the bench year, or the contention case shows a
   `payment.final` request waiting more than 50 ms longer than idle. The appendix's fallbacks: split
   the pass further or limit to fewer days. Stop; the watcher chooses.
2. A test that passed with discovery fails without it (Task 3): a change pp9 did not mark — pp9's
   Stop point 1 after all; stop with the case.
3. **Re-evaluation is not idempotent** (Task 2): re-evaluating an already-evaluated day with
   unchanged evidence changes a question, an entry or a reminder. The re-check would then change
   people's records; stop.
4. After a real restore and the re-check, the restored venue's questions or entries differ from the
   source's (Task 5's restore case).

## Needs

- pp9, pp10, pp11; 1b (`defineSettingsDocument`, `saveSettings`); slice 0's bench for measurement 2.

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- The legal record and every attendance decision are unchanged; only how a day is found to need
  checking changes.
- Every commit `git commit -s`.

## Review Focus

1. **An ordinary restart re-checks nothing**, and a day due at start is evaluated on the first pass.
2. **A replaced file, a migration and a format change each re-check exactly the last 62 days.**
3. **Re-evaluation is idempotent** (Task 2's snapshot test).
4. **The guard's allowlist** names, for each entry, the caller that marks.

---

### Task 1: The re-check and the stamp

- [ ] **Step 1: Write the failing tests** (`attendance-recheck.test.ts`): `"an unchanged stamp
  re-checks nothing"`; `"a changed file stamp re-checks every evaluated day of the last 62 days and
  none older"`; `"a migration re-checks the same days"`; `"a changed evidence format re-checks them"`;
  `"no stored stamp with evaluated days re-checks them; with none it only saves the stamp"`;
  `"the stamp is saved after the check"`; `"the stamp does not travel in a configuration export"`.
- [ ] **Step 2: Run, see them fail. Step 3: Implement. Step 4: Run.**
- [ ] **Step 5: Commit** `git commit -s -m "Re-check recent attendance days when the file, format or schema changed (pp12)"`.

### Task 2: Re-evaluation changes nothing on unchanged evidence

- [ ] **Step 1: Write** `end-of-day.test.ts` `"re-evaluating an evaluated day with unchanged evidence
  leaves questions, entries and reminders as they were"` — evaluate a day with a missing clock-out (an
  automatic clock-out is written) and a missing-times question; snapshot questions, time entries and
  the day's `outgoing_mail` rows; raise its revision and evaluate again; the snapshot is equal. Add the
  same with a later clock-in on the following day before the second evaluation (the case the design
  decision rests on: the latest-entry inputs change, the result must not).
- [ ] **Step 2: Run.** It should pass on the current code; **a failure is Stop point 3.** Commit.

### Task 3: Every attendance test with discovery switched off, before deleting it

- [ ] **Step 1:** In a scratch commit, make `discoverAttendanceDays` return `{ more: false }` at once
  and `beginAttendanceDiscovery` do nothing. Run the finish line's server run.
- [ ] **Step 2:** Every failure is Stop point 2 unless the test calls discovery directly to assert its
  own behaviour (deleted in Task 4). Record the `Tests` count and failures; drop the scratch commit.

### Task 4: Discovery and its table go; the guard arrives

- [ ] **Step 1:** Move the three kept functions to `apps/server/src/attendance-days.ts` (a move; the
  only edits drop their scan checks) and their tests to `attendance-days.test.ts`.
- [ ] **Step 2:** Delete the scan, the watches, the table and every list naming it; delete the
  discovery tests that assert the scan's own behaviour (generations, cursors, watch rows, endpoints):
  they test the mechanism the design deletes (appendix §4). Name each deleted test in the commit body.
- [ ] **Step 3: The guard.** Write `scripts/attendance-evidence-writers.test.ts`; prove it by
  deletion (remove one mark call from a writer: the guard names that file) and with a legitimate case
  (an allowlisted writer passes). Add the CLAUDE.md §3 line and its receipt.
- [ ] **Step 4: Rebuild** `--set workforce`; run the finish line.
- [ ] **Step 5: Commit** `git commit -s -m "Delete attendance discovery and attendance_source_state; guard the evidence writers"`.

### Task 5: Restart, migration, restore and format (changed by design)

A1343's cases assert the scan's restart rule through its generation id. The generation is gone; each
keeps its meaning with assertions on the re-check instead. Named here as changed by design (rules
§5.3 does not apply to these):

- `attendance-restore.test.ts:148` `"rescans a replaced database file even when its schema cookie
  matches the source"` → `"re-checks recent days after a replaced database file even when its schema
  cookie matches the source"`: its schema-cookie assertion and its final
  `expect(await snapshot(restored.venue)).toEqual(before)` stay; the generation and cursor assertions
  become "the last 62 days' evaluated rows have `dirty_revision > evaluated_revision` after start",
  and its first-pass expectation becomes "a pass evaluates a re-checked day".
- The `"restarts persisted scans and retains exactly one legal finish"` cases keep their chain
  assertions (exactly one automatic finish) with the re-check in place of the scan.
- `boot.attendance.test.ts:246` (a normal restart keeps the same discovery generation) →
  `"an ordinary restart re-checks nothing and evaluates a due day on the first pass"`.

- [ ] **Step 1: Write the new cases:** `"a start that applies a migration re-checks the last 62
  days"`, `"a start after a change of evidence format re-checks them"`, `"VACUUM re-checks nothing"`,
  and **the restore case** `"after a real restore and the re-check, the restored venue's questions,
  time entries and reminders equal the source's"` (through the real restore path the file already
  uses) — Stop point 4 if not.
- [ ] **Step 2: Rewrite the A1343 cases** as listed. **Step 3: Implement** boot's start check.
  **Step 4: Run** the finish line.
- [ ] **Step 5: Commit** `git commit -s -m "Re-check recent days after a restore, migration or format change"`.

### Task 6: Measurement 2

Slice 0's bench measures an idle box only (`"load": "idle"`). This plan adds two cases instead of a
general load mode:

- [ ] **Step 1: `attendance.recheck-pass`:** on the year (built on this branch), outside the timer
  re-check the last 62 days; inside, one `runAttendancePass`; 62 samples (one per day).
- [ ] **Step 2: `attendance.recheck-contention`** (a minimal load generator): start one
  `runAttendancePass` on a re-checked day and, at the same moment in the same process, a
  `payment.final` request (`Promise.all`; both go through the venue's one write queue, so the payment
  waits behind the pass); time the payment request only. Compare its median with `payment.final` idle
  on the same build.
- [ ] **Step 3: The failing result** is Stop point 1. Paste both results.
- [ ] **Step 4: Commit** `git commit -s -m "Bench the attendance re-check"`.

### Task 7: Protection list, docs, finish

- [ ] **Step 1:** Protection list before and after; paste and mark.
- [ ] **Step 2:** The backlog deletions and the two dated pointers.
- [ ] **Step 3:** `/finish-branch`.
