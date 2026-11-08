# A1308 pp11 — the attendance scan and its million bookkeeping rows go; each day keeps a hash of its evidence: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** `attendance_source_state` (one remembered fingerprint per source row ever seen, about a
million rows a year) and the discovery scan that writes it are deleted. Change is detected per day:
pp9's marks at every write, plus `attendance_days.evidence_hash`, a hash of exactly what the last
evaluation of the day read. A start that applied a migration, or a code change in what counts as
evidence, marks every evaluated day's hash *stale*; the attendance pass re-checks stale days a few
at a time and re-queues only those whose evidence differs. An ordinary restart does nothing.

**How this adjusts the design for A1343.** The appendix (§8 item 2) proposed recomputing every
day's hash "on start (and after a restore)". Its 2026-11-05 note says the every-start rescan is
superseded by "restart reuse tied to the database file, the pre-migration schema version and applied
migration versions" (A1343, commit `8ee102018f`). A1343 needed the file and schema-version parts
because the scan kept **row positions** (`rowid` cursors, `attendance-discovery.ts:379-397`), which
a file replacement or `VACUUM` can renumber. With no row positions left, a restored or vacuumed file
is self-consistent: its day rows, hashes and dirty marks were copied with the sources they describe.
What still invalidates a stored hash is a migration that rewrites source rows, or new code that
reads evidence differently. So this plan keeps A1343's rule (an ordinary restart re-checks nothing)
and narrows the trigger to those two; it needs no stored identity stamp. Read, not run: the claim
that a restore copies a consistent file is the store's (`VACUUM INTO` and Litestream snapshots are
transactional); Task 5's restore test checks it on the real restore path.

**Architecture:** `readAttendanceEvidence(tx, day)` is the one read both the evaluation and the
sweep use; `attendanceEvidenceHash(evidence)` hashes it with a format version. The evaluation
stores the hash. Boot marks hashes stale when this start applied a migration or any stored hash has
another format version. The attendance pass sweeps a bounded batch of stale days before choosing
the next day, and chooses none while stale days remain (today's conservative rule: no day is
evaluated until the scans are complete, `attendance-discovery.ts:554`).

**Tech stack:** TypeScript, Node `crypto`, Drizzle on `node:sqlite`, Vitest, slice 0's `bench`.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U6 (`attendance_source_state`
deleted: "about a million bookkeeping rows a year; the checker already reads the sources"), §6
("Performance"); [people appendix](../specs/2026-11-02-rationalisation/tables-people.md) the A1343
note, "The short version" (first two bullets), §1 `attendance_days` (`evidence_hash`), §4, §5
(`attendance_source_state` row), §6 item 2, §8 item 2.

**First line of the pull request:** "Every venue is reset: workforce; backups and exports from
before this cannot be restored or imported." (rules §2)

**Who lands:** the lane (rules §6: nothing fiscal; the legal record is untouched).

**Cites** read at `a086eedfb7`; pp8–pp10 have renamed and narrowed the attendance tables and
rewritten parts of `attendance-discovery.ts`. A cite that no longer says what this plan says is a
stop (rules §5.1).

---

## What it builds

- `attendance_days.evidence_hash` `label`, null; `attendance_days_evidence_hash_ck`:
  `evidence_hash is null or evidence_hash glob 'v[0-9]*:*' or evidence_hash glob 'stale:v[0-9]*:*'`.
  Stored form: `v1:<64 hex>`; stale form: `stale:v1:<64 hex>`.
- In `packages/workforce/src/attendance-evidence.ts`:
  - `export const EVIDENCE_FORMAT = "v1";` with the one comment this plan adds: changing what
    `readAttendanceEvidence` reads, or how a fact is labelled, must change this value, so every
    stored hash goes stale on the next start (this replaces the backlog's "explicitly invalidate the
    retained scan marker" rule).
  - `readAttendanceEvidence(tx, day): Promise<AttendanceEvidence>` = `{ facts, planned, entries }`:
    the server's facts and planned shifts (passed in as a reader, since the facts read lives in
    `apps/server/src/attendance-facts.ts`) and the `time_entries` rows the evaluation reads
    (`end-of-day.ts:144-146` and any other entry read inside `processAttendanceDay`, moved into one
    `readDayEntries(tx, day)`).
  - `attendanceEvidenceHash(evidence): string` = `EVIDENCE_FORMAT + ":" +` SHA-256 hex of
    `JSON.stringify` of: facts as `[source, key, personId, kind, at]` in their sorted order; planned
    as `[id, personId, startsAt, endsAt, rosterVersionId]` sorted by `startsAt`, `endsAt`, `id`;
    entries as `[id, entry_hash]` sorted by `id`. (`entry_hash` already covers an entry's content,
    `packages/workforce/src/chain-hash.ts`.)
  - `markEvidenceStale(tx, reason: "migration" | "format"): Promise<number>` — `migration`: every
    non-null, not-stale hash gets the `stale:` prefix; `format`: only hashes whose prefix is not
    `EVIDENCE_FORMAT`. Returns the count.
  - `sweepStaleEvidence(tx, input: { batch: number }): Promise<{ checked: number; changed: number; remaining: boolean }>`
    — takes up to `batch` stale days (newest `business_day` first), recomputes each hash; equal to
    the stored hash without its prefix → the prefix is removed; different → the hash is set to null
    and the day is marked (its revision raised), so the next evaluation stores a fresh hash.
- `processAttendanceDay` (`packages/workforce/src/end-of-day.ts`) takes the evidence instead of
  separate `facts`/`planned`, and stores its hash with the evaluated revision. The day's own
  automatic clock-out marks the day again (pp9, case 7), so the following evaluation stores the hash
  that includes it.
- The attendance pass (`apps/server/src/attendance-loop.ts`): `ensureFutureShiftDays` (pp9), then
  `sweepStaleEvidence(tx, { batch: 7 })`, then `nextAttendanceDay` (which answers null while any
  stale day remains); `more` is true while stale days remain.
- Boot (`apps/server/src/boot.ts:2422-2429`): the `beginAttendanceDiscovery` call and A1343's
  identity inputs (`attendanceSchemaBeforeMigrations`, `:1177`, `:1205`) go. In their place, when
  workforce is on and the box is the primary: read `schemaVersionsByModule` before
  `applyMigrations` as well as after (it is read after today, `:1266`); if any set's version rose,
  `markEvidenceStale(tx, "migration")`; then always `markEvidenceStale(tx, "format")`.
- Deleted: `attendance_source_state` (schema, classification, exports, every list); from
  `apps/server/src/attendance-discovery.ts`, `beginAttendanceDiscovery`, `discoverAttendanceDays`,
  `remember`, `capturedRow` (if pp10 left any), `sourcePage`, `watchedRow`, `endpoints`,
  `dirtyDay`, `rowSources`, `scanScope`; `apps/server/src/attendance-source-changes.ts`'s watch
  writes (pp9 already marks through `markShiftDays`; the file keeps `markAttendanceSourceChanged`
  only if a caller remains, else it goes). Kept and moved to a file named for what it does,
  `apps/server/src/attendance-days.ts`: `reconcileAttendanceBeforeClock`, `reconcileAttendanceDay`,
  `nextAttendanceDay`.
- Docs: the backlog entry "Audit attendance discovery invalidation…" (what pp9 left of it) and its
  `docs/backlog/workforce.md` section are deleted; a dated pointer line is added under the A1343 note
  at the top of `docs/superpowers/specs/2026-11-02-rationalisation/tables-people.md` and in
  `docs/superpowers/plans/2026-10-14-a10-3-end-of-day-plan.md` ("<date>, A1308 pp11: the scan and
  its restart reuse are gone; see the pp11 plan"); `docs/developers/conventions-data.md` gains
  nothing unless it describes the scan (grep `attendance_source_state\|discovery`).

## What it leaves out

| Left out | Owner |
| --- | --- |
| The attendance loop on the job runner | batch 3 (`jr1` lists `attendance.end_of_day`) |
| Pruning `till_sessions`, `staff_activity` | A980 (README U10) |
| A sweep on every start | not built: A1343's rule stands (above) |

## Files

- Create: `packages/workforce/src/attendance-evidence.ts`, `attendance-evidence.test.ts`;
  `apps/server/src/attendance-days.ts` (moved functions), `apps/server/src/attendance-evidence.test.ts`.
- Modify: `packages/workforce/src/schema/attendance.ts`, `end-of-day.ts`, `index.ts`,
  `classification.ts`; `apps/server/src/attendance-loop.ts`, `attendance-facts.ts` (exposes its
  reads as the evidence reader), `boot.ts`, `till-clock-api.ts` (imports
  `reconcileAttendanceBeforeClock` from the new file), `workforce-api.ts` (imports).
- Delete: `apps/server/src/attendance-discovery.ts` (after the move), `attendance-source-changes.ts`
  if empty, `apps/server/src/attendance-discovery.test.ts`'s scan and watch cases (its
  reconcile cases move to `attendance-days.test.ts`).
- Modify (bench): `apps/server/scripts/bench/measure.ts` gains `attendance.sweep-batch`.
- Tests re-pointed from discovery to marks (pp9 made them pass without it): `attendance-cutover-settings.test.ts`,
  `till-clock-attendance.test.ts`, `attendance-obligations.test.ts`, `attendance-capture.test.ts`,
  `attendance-loop.test.ts`, `attendance-rota.test.ts`; replaced (Task 5): `attendance-restore.test.ts`,
  `boot.attendance.test.ts`; `packages/workforce/src/index.test.ts`, `schema-ownership.test.ts`,
  `attendance-state.test.ts` (table lists).
- Generated (uncounted): workforce's starting migration, snapshot, epoch.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| `attendance-evidence.ts` | 110 |
| Evaluation stores its hash; one entries read | 40 |
| Pass, boot | 50 |
| Moved functions (moved lines uncounted; edits only) | 20 |
| Schema column and CHECK; classification | 15 |
| Bench case | 40 |
| Evidence and sweep tests | 200 |
| Restart, migration, restore and format tests (Task 5) | 180 |
| Re-pointed attendance tests | 100 |
| Docs | 20 |
| **Total** | **≈ 775** |

Uncounted: about 550 deleted lines of `attendance-discovery.ts` and the scan and watch test cases,
the table, generated files.

## Finish line

```bash
pnpm --filter @waitron/workforce exec vitest run src/attendance-evidence.test.ts src/end-of-day.test.ts \
  src/attendance-state.test.ts src/attendance-marks.test.ts src/index.test.ts src/schema-ownership.test.ts
pnpm --filter @waitron/server exec vitest run src/attendance-evidence.test.ts src/attendance-days.test.ts \
  src/attendance-loop.test.ts src/attendance-marks.test.ts src/attendance-restore.test.ts \
  src/boot.attendance.test.ts src/attendance-cutover-settings.test.ts src/till-clock-attendance.test.ts \
  src/attendance-obligations.test.ts src/attendance-capture.test.ts src/attendance-rota.test.ts \
  src/attendance-facts.test.ts src/till-clock-api.test.ts
pnpm exec vitest run scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts \
  scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/schema-constraints.test.ts
git grep -nE 'attendance_source_state|attendanceSourceState|discoverAttendanceDays|beginAttendanceDiscovery|attendanceSchemaBeforeMigrations' -- apps packages scripts ':!**/drizzle/**'; test $? -eq 1
```

## Expected protection-list difference

Lines without a phase note appear under all six `database=venue` headers. Measured on the base list:
`attendance_source_state` has a primary-key index, two named indexes (renamed by slice 5; the
builder writes their names) and the three change-feed triggers; `attendance_days` has the three
change-feed triggers (pp8).

| Table | Lines | Design reason (appendix §5) |
| --- | --- | --- |
| `attendance_source_state` | `missing table attendance_source_state`; `missing index attendance_source_state.primary key(id)`; `missing index attendance_source_state_scope_uq` and `missing index attendance_source_state_watch_idx` (slice 5's names); change-feed only: `missing trigger waitron_change_attendance_source_state_insert`, `…_update`, `…_delete` | "UNIQUE scope, watch index, CHECKs source/kind/shape — dropped with the table" |
| `attendance_days` | `extra table attendance_days.columns[evidence_hash]`; `changed table attendance_days.columnOrder`; `extra table attendance_days.checks[attendance_days_evidence_hash_ck]`; change-feed only: `changed trigger waitron_change_attendance_days_update.when` | "evidence_hash — hash of the evidence the last evaluation read (new, §8)" |

Any other line is a stop.

## Stop points (beyond rules §5)

1. **Measurement 2's failing result** (Task 6): one sweep batch of 7 days holds the write
   transaction for a median over 50 ms on the bench year, or `bench compare` prints `slower` for
   `payment.final` or `sale.counter` while a full sweep runs beside it. The design's fallback: split
   the pass per day (batch 1), limit the sweep to recent days, or run it only after a restore. Stop;
   the watcher chooses and confirms.
2. A test that passed with discovery fails without it (Task 2): a change pp9 did not mark. That is
   measurement 3's failing result after all (pp9 Stop point 1); stop with the case.
3. The real restore path (Task 5) produces a database whose stored hashes differ from recomputed
   ones with no migration applied: the "a restore copies a consistent file" reasoning above is
   wrong; stop.
4. `processAttendanceDay` reads `time_entries` in a way that cannot be routed through one
   `readDayEntries` without changing what it reads.

## Needs

- pp9 (marks) and pp10 (the source reads); slice 0's bench for measurement 2.

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- The legal record and every attendance decision are unchanged; only how a day is found to need
  checking changes.
- Each sweep batch is one short write transaction inside the attendance pass (CLAUDE.md §3).
- Every commit `git commit -s`.

## Review Focus

1. **An ordinary restart re-checks nothing** (A1343's rule), and a day due at start is evaluated on
   the first pass.
2. **A changed day after a migration is re-evaluated; an unchanged one is not.**
3. **The hash covers exactly what the evaluation read.** A fact, planned shift or clock entry added
   to the day changes it; an unrelated day's row does not.
4. **Nothing reads `attendance_source_state`**, and no test still drives `discoverAttendanceDays`.

---

### Task 1: The evidence and its hash

**Files:** `packages/workforce/src/attendance-evidence.ts`, its test, `end-of-day.ts`, the schema.

- [ ] **Step 1: Write the failing tests** (`attendance-evidence.test.ts`, `useVenueDb`):
  `"hashes the same evidence the same way, whatever order the rows were written in"`, `"a new fact
  changes the day's hash"`, `"a new published shift changes it"`, `"a correction appended to one of
  the day's entries changes it"`, `"a fact on another day does not"`, `"the hash starts with the
  format version"`, `"the evaluation stores its evidence hash with the evaluated revision"`,
  `"refuses a malformed stored hash"` (CHECK) and `"accepts a stale one"`.
- [ ] **Step 2: Run, see them fail. Step 3: Implement** (column, CHECK, the read, the hash, the
  evaluation storing it). **Step 4: Rebuild** `--set workforce`; run the workforce finish-line run.
- [ ] **Step 5: Commit** `git commit -s -m "Each attendance day keeps a hash of the evidence it was checked on (pp11)"`.

### Task 2: Run every attendance test with discovery switched off, before deleting it

- [ ] **Step 1:** In a scratch commit, make `discoverAttendanceDays` return `{ more: false }` at once
  and `beginAttendanceDiscovery` do nothing. Run the finish line's server run.
- [ ] **Step 2:** Every failure is Stop point 2 unless the test calls discovery directly to assert
  its own behaviour (those are deleted in Task 4). Record the run's `Tests` count and failures in the
  pull request. Drop the scratch commit.

### Task 3: Stale marking and the sweep

**Files:** `attendance-evidence.ts`, `attendance-loop.ts`, `attendance-days.ts`.

- [ ] **Step 1: Write the failing tests:** `"marking stale for a migration prefixes every stored
  hash once"`, `"marking stale for a format change prefixes only other formats"`, `"the sweep clears
  the mark on a day whose evidence is unchanged"`, `"the sweep re-queues a day whose evidence
  changed and clears its hash"`, `"the sweep takes newest days first, a batch at a time"`, `"no day
  is chosen while stale days remain"`, `"an interrupted sweep resumes where it stopped"` (sweep one
  batch, start a new pass object, the rest are still stale and get swept).
- [ ] **Step 2: Run, see them fail. Step 3: Implement. Step 4: Run.**
- [ ] **Step 5: Commit** `git commit -s -m "Re-check stale attendance days a few at a time"`.

### Task 4: Discovery and its table go

- [ ] **Step 1:** Move the three kept functions to `apps/server/src/attendance-days.ts` (a move; the
  only edits are dropping their scan checks), and their tests to `attendance-days.test.ts`.
- [ ] **Step 2:** Delete the scan, the watches, the table and every list naming it; delete the
  discovery tests that assert the scan's own behaviour (generations, cursors, watch rows, endpoints):
  they test the mechanism the design deletes (appendix §4: "a per-row change detector; replaced by
  per-day dirty marks and an evidence hash"). Name each deleted test in the commit body.
- [ ] **Step 3: Rebuild** `--set workforce`; run the finish line.
- [ ] **Step 4: Commit** `git commit -s -m "Delete attendance discovery and attendance_source_state"`.

### Task 5: Restart, migration, restore and format (replacing A1343's cases)

**Files:** `apps/server/src/boot.attendance.test.ts`, `attendance-restore.test.ts`, `boot.ts`.

A1343's tests assert the scan's restart rule through its generation id (`boot.attendance.test.ts:246`,
the restore and `VACUUM` cases in `attendance-discovery.test.ts` and `attendance-restore.test.ts`).
The generation is gone; each case is replaced by one that asserts the same outcome for the person
using the box.

- [ ] **Step 1: Write the failing tests:**
  - `boot.attendance.test.ts`: `"an ordinary restart marks no day stale and evaluates a due day on
    the first pass"`; `"a start that applies a migration marks every evaluated day stale, and only a
    day whose evidence changed is re-evaluated"` (simulate with a set version raised between two
    boots, and one source row rewritten directly between them); `"a start after a change of evidence
    format marks the old hashes stale"` (store a `v0:` hash, boot).
  - `attendance-restore.test.ts`: `"a restored archive evaluates a day that was dirty when the
    archive was taken"`; `"a restored archive of the same version marks nothing stale"` (through the
    real restore path the file already uses); `"VACUUM changes nothing the checker reads"`.
- [ ] **Step 2: Run, see them fail. Step 3: Implement** boot's two `markEvidenceStale` calls and
  remove A1343's inputs. **Step 4: Run** the finish line.
- [ ] **Step 5: Commit** `git commit -s -m "Mark attendance evidence stale only when a start migrated or the format changed"`.

### Task 6: Measurement 2

- [ ] **Step 1: Add the bench case** `attendance.sweep-batch`: on the year (built on this branch),
  outside the timer mark every day stale; inside, one `withTransaction` running
  `sweepStaleEvidence(tx, { batch: 7 })`; 50 samples (re-mark between samples outside the timer).
- [ ] **Step 2:** Measure, and run `bench measure` for the payment and sale cases with a full sweep
  running beside them in the same process (`load: "sweep"` in the result file); `bench compare`
  against an idle run on the same build.
- [ ] **Step 3: The failing result** is Stop point 1. Paste both results into the pull request.
- [ ] **Step 4: Commit** the bench case: `git commit -s -m "Bench the stale-evidence sweep"`.

### Task 7: Protection list, docs, finish

- [ ] **Step 1:** Protection list before and after; paste and mark.
- [ ] **Step 2:** The backlog deletions and the two dated pointers in "What it builds".
- [ ] **Step 3:** `/finish-branch`.
