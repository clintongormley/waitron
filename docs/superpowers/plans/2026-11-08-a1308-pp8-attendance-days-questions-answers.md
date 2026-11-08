# A1308 pp8 — attendance days, questions that point at their day, and answers nobody can change: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** three reshapes of the attendance checker's own tables, with no change to what it decides:
(1) `attendance_day_work` becomes `attendance_days` and loses `deferred_shift_ids`; (2)
`attendance_questions` points at its day through `attendance_day_id` instead of copying the day's
`business_day`, `start_at` and `end_at`; (3) `attendance_response_commands` becomes
`attendance_answers` and is append-only.

**Words used here.** The *attendance checker* looks at each finished business day, compares what
people did (signed in, took orders, took payments, clocked in and out) with the legal clock record
and the rota, and asks a person a *question* when something is missing ("you were clocked out
automatically — when did you leave?"). Its *work item* is one row per business day. An *answer* is
what a person or manager replied (confirm, propose times, approve, decline…). *Append-only* means
database triggers refuse any update or delete of a row (`appendOnly()` in a module's classification).

**Architecture:** a committed rename script renames the two tables and their identifiers. The day
row's "has deferred shifts" becomes `next_due_at > end_at`, which the evaluation already sets
(`packages/workforce/src/end-of-day.ts:416-417`). The question's day is a key; every reader that
used the copied bounds joins `attendance_days`, and the question views keep their fields. Answers
gain `appendOnly()`.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U9 ("the people area's
attendance renames"), §10 "Applied as the design" ("`attendance_answers` keeps its list of entries
as a column"); [people appendix](../specs/2026-11-02-rationalisation/tables-people.md) §1
`attendance_days`, `attendance_questions`, `attendance_answers`; §4; §5 (their rows); §6 items 4
and 6.

**First line of the pull request:** "Every venue is reset: workforce; backups and exports from
before this cannot be restored or imported." (rules §2)

**Who lands:** the lane (rules §6: nothing fiscal; the legal record `time_entries` is untouched).

**Cites** read at `a086eedfb7`. Slice 5 removed `location_id` and gave `attendance_day_work` its
venue-wide keys; slice 3b moved `attendance_mail` onto `outgoing_mail`. 

---

## What it builds

- `scripts/a1308/pp8-attendance-renames.mjs` and its test: whole-word renames, everywhere in
  `apps`, `packages`, `scripts` (not `**/drizzle/**`): `attendance_day_work` → `attendance_days`,
  `attendanceDayWork` → `attendanceDays`, `attendance_response_commands` → `attendance_answers`,
  `attendanceResponseCommands` → `attendanceAnswers`; constraint and index names that begin with
  the old table names follow. At `a086eedfb7` no file declares any of the four new names (`git grep -nw`
  finds none), so no collision step is needed; the script still refuses one (as pp1's).
- `attendance_days.deferred_shift_ids` dropped. Its one write (`end-of-day.ts:416`) goes; its two
  reads (`apps/server/src/attendance-loop.ts:48`, `apps/server/src/attendance-discovery.ts:586`)
  become `next_due_at > end_at` (appendix §1: the same evaluation sets `next_due_at` to the earliest
  deferred shift's end, or the day's end when none is deferred).
- `attendance_days_start_idx` on `attendance_days(start_at)`: pp9 marks a day by finding the
  stored day whose bounds contain an instant (`start_at <= ? order by start_at desc limit 1`, then
  `end_at > ?`), on every till sign-in and clock entry, so the lookup is indexed from the start.
- `attendance_questions.attendance_day_id` `id` not null, `attendance_questions_day_fk` →
  `attendance_days(id)` on delete restrict; `business_day`, `start_at`, `end_at` and
  `attendance_questions_bounds_ck` dropped (the bounds CHECK already lives on the day,
  `attendance_days_bounds_ck`). The own-questions index `attendance_questions_own_idx` is replaced
  by `attendance_questions_own_day_idx (person_id, active, resolved_by_entry_id, attendance_day_id, id)`;
  a new name, so the protection list prints one missing and one extra line instead of a changed
  line per column position.
- Writers set `attendance_day_id` from the day row the evaluation already holds
  (`end-of-day.ts:124-127` reads it and refuses a day whose bounds differ). The "bounds changed"
  refusal (`packages/workforce/src/attendance-questions.ts:123-129`) becomes "the question's day
  changed": a question found for this shift key whose `attendance_day_id` is not this day's id
  throws the same `attendance.invalid` with reason `attendance question day changed`. The merge
  check (`:199-201`) compares `attendance_day_id`.
- Readers that read a question's `business_day`, `start_at` or `end_at` join `attendance_days` and
  return the same fields: `attendance-questions.ts:43-45`, `:173-174` (ordering by the day's
  `business_day`, `start_at`), `attendance-reads.ts:59-77`, `attendance-rota.ts:32`,
  `end-of-day.ts:180`, `:259`, `personal-data.ts` (workforce), and the attendance reminder owner
  slice 3b wrote on `outgoing_mail` (it reads the question's day for the email,
  `apps/server/src/attendance-email-worker.ts` at `a086eedfb7`).
- `attendance_answers` classified with `appendOnly("attendance_answers", "ledger", …)` in
  `packages/workforce/src/classification.ts` (it was `state`), so `applyMigrations` installs
  `attendance_answers_append_only_update` and `…_delete`; `scripts/append-only-triggers.test.ts`
  (`:62`, `:77` list workforce's append-only tables) gains it.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `attendance_days.evidence_hash` | pp11 (introduced with the code that uses it) |
| `attendance_operation_facts` → `staff_activity` | pp10 |
| `attendance_source_state` | pp11 |
| `evidence_keys` as a list of labels | stays a list (owner, 2026-11-04; appendix §1) |
| `entry_ids` on answers | stays a list (README §10) |

## Files

- Create: `scripts/a1308/pp8-attendance-renames.mjs`, `.test.mjs`.
- Changed by the script (uncounted): 65 files at `a086eedfb7` (`git grep -l` over the four old names, outside `drizzle/`),
  including `packages/workforce/src/schema/attendance.ts`, `schema/attendance-responses.ts`,
  `attendance-state.ts`, `end-of-day.ts`, `attendance-response-commands.ts`, `attendance-reads.ts`,
  `attendance-responses.ts`, `attendance-question-responses.ts`, `personal-data.ts`,
  `dashboard/live-queries.ts`, `classification.ts`; `apps/server/src/attendance-*.ts`; the Madrid
  fixtures.
- Hand edits: `packages/workforce/src/schema/attendance.ts` (drop the column, the question bounds,
  add the key, change the index), `end-of-day.ts`, `attendance-questions.ts`, `attendance-reads.ts`,
  `attendance-rota.ts`, `personal-data.ts`, `classification.ts`, `apps/server/src/attendance-loop.ts:48`,
  `apps/server/src/attendance-discovery.ts:586`, the reminder owner from 3b,
  `scripts/append-only-triggers.test.ts`.
- Tests: `packages/workforce/src/attendance-questions.test.ts`, `end-of-day.test.ts`,
  `attendance-reads.test.ts`, `attendance-response-schema.test.ts`, `attendance-state.test.ts`,
  `personal-data.test.ts`; `apps/server/src/attendance-loop.test.ts`, `attendance-discovery.test.ts`,
  `attendance-rota.test.ts`, the reminder owner's test.
- Generated (uncounted): workforce's starting migration, snapshot, epoch.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Rename script | 90 |
| Its test | 50 |
| Schema changes (with the start index and its plan test) | 45 |
| Question writers (day id) and the "day changed" refusal | 40 |
| Question readers (join the day) | 90 |
| Deferred-shift reads | 10 |
| Classification and append-only guard | 10 |
| New tests: key, dropped bounds, deferred rule, append-only refusals | 170 |
| Re-pointed tests (fixtures that wrote question bounds) | 120 |
| **Total** | **≈ 625** |

## Finish line

```bash
pnpm exec vitest run scripts/a1308/pp8-attendance-renames.test.mjs
pnpm --filter @waitron/workforce exec vitest run src/attendance-questions.test.ts src/end-of-day.test.ts \
  src/attendance-reads.test.ts src/attendance-responses.test.ts src/attendance-response-commands.test.ts \
  src/attendance-response-schema.test.ts src/attendance-state.test.ts src/attendance-rota.test.ts \
  src/personal-data.test.ts src/classification.test.ts
pnpm --filter @waitron/server exec vitest run src/attendance-loop.test.ts src/attendance-discovery.test.ts \
  src/attendance-rota.test.ts src/till-attendance-api.test.ts src/management-attendance-api.test.ts \
  src/attendance-obligations.test.ts src/attendance-restore.test.ts src/boot.attendance.test.ts
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts \
  scripts/schema-constraints.test.ts
node scripts/a1308/pp8-attendance-renames.mjs --write && git diff --exit-code
```

The reminder owner's test from slice 3b is added to the server run (its name is in 3b's plan).

## Expected protection-list difference

Lines without a phase note appear under all six `database=venue` headers. Measured on the base list:
all three tables have the three change-feed triggers. Index names below assume slice 5 kept the
`attendance_day_work_` prefix on the two day indexes and renamed none of the question indexes; the
builder writes slice 5's real names into the report and checks the rest of each line.

| Table | Lines | Design reason (appendix §5) |
| --- | --- | --- |
| `attendance_day_work` → `attendance_days` | `missing table attendance_day_work`; `extra table attendance_days`; `missing index attendance_day_work.primary key(id)`; `extra index attendance_days.primary key(id)`; the unique `business_day` index and the `next_due_at` index each print as `missing index attendance_day_work_…` / `extra index attendance_days_…`; `extra index attendance_days_start_idx`; change-feed only: `missing trigger waitron_change_attendance_day_work_insert`, `…_update`, `…_delete`; `extra trigger waitron_change_attendance_days_insert`, `…_update`, `…_delete` | "UNIQUE (business_day); index (next_due_at); CHECKs bounds, revisions — kept"; deferred ids dropped (§6 item 6) |
| `attendance_questions` | `missing table attendance_questions.columns[business_day]`, `…columns[start_at]`, `…columns[end_at]`; `extra table attendance_questions.columns[attendance_day_id]`; `changed table attendance_questions.columnOrder`; `missing table attendance_questions.checks[attendance_questions_bounds_ck]`; `extra table attendance_questions.foreignKeys[attendance_day_id->attendance_days(id)]`; `missing index attendance_questions_own_idx`; `extra index attendance_questions_own_day_idx`; change-feed only: `changed trigger waitron_change_attendance_questions_update.when` | "gains a day FK; loses copied bounds"; "bounds CHECK moves to `attendance_days`" |
| `attendance_response_commands` → `attendance_answers` | `missing table attendance_response_commands`; `extra table attendance_answers`; `missing index attendance_response_commands.primary key(id)`; `extra index attendance_answers.primary key(id)`; `missing index attendance_response_commands_question_idx`; `extra index attendance_answers_question_idx`; under the four `migrated` and `change-feed` headers: `extra trigger attendance_answers_append_only_update`, `extra trigger attendance_answers_append_only_delete`; change-feed only: `missing trigger waitron_change_attendance_response_commands_insert`, `…_update`, `…_delete`; `extra trigger waitron_change_attendance_answers_insert`, `…_update`, `…_delete` | "kept; **new** append-only triggers" |

The builder checks by hand, in the new list's JSON, that `attendance_questions_own_day_idx` covers
`(person_id, active, resolved_by_entry_id, attendance_day_id, id)`. Any other line is a stop.

## Stop points (beyond rules §5)

1. A test that asserts a question's `businessDay`, `startAt` or `endAt` sees a different value: the
   views must return the day's own values, which equal the old copies by construction
   (`attendance-questions.ts:123-129` refused any difference).
2. A product path updates or deletes an answer (the new triggers refuse it in a suite). At
   `a086eedfb7` `git grep -n "update(attendanceResponseCommands)\|delete(attendanceResponseCommands)"`
   finds none in any file.
3. A product path deletes a day row while a question points at it (the restrict key refuses). At
   `a086eedfb7` only a test clean-up deletes day rows (`apps/server/src/attendance-rota.test.ts:82`,
   in a `beforeEach`); it deletes the questions first after this plan (a set-up change, not an
   assertion). A product delete is a stop.

## Needs

- Batch 1: slice 5 (venue-wide attendance keys), slice 3b (`attendance_mail` on `outgoing_mail`),
  1a.
- pp6, pp7 only for the order of workforce rebuilds (rules §2.4 makes either order work).

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- The checker decides exactly as before: every attendance behaviour test keeps its assertions.
- Every commit `git commit -s`.

## Review Focus

1. **"Has deferred shifts"** reads the same days as before in `attendance-loop.test.ts` and the
   end-of-day deferred cases.
2. **Question views** return the same fields from the join.
3. **Append-only answers**: an update and a delete are refused; an insert and a replay
   (`readAttendanceCommand`) still work.

---

### Task 1: The rename script

- [ ] **Step 1: Write the failing test** over temporary fixture files: renames in a schema file,
  a drizzle import, a raw SQL string and a live-query list; idempotent; refuses a collision.
- [ ] **Step 2: Run, see it fail. Step 3: Implement. Step 4: Run, see it pass.**
- [ ] **Step 5: Run on the tree** with `--write`; typecheck workforce and server.
- [ ] **Step 6: Commit** script, test and output: `git commit -s -m "Rename the attendance day and answer tables with a committed script (pp8)"`.

### Task 2: Deferred shifts read from the due time

**Files:** `schema/attendance.ts`, `end-of-day.ts`, `attendance-loop.ts`, `attendance-discovery.ts`,
`attendance-state.ts` (its insert names no deferred list), tests.

- [ ] **Step 0: The start index.** Add `attendance_days_start_idx` with a plan test in
  `attendance-state.test.ts`: `"finds the day containing an instant through the start index"`
  (`EXPLAIN QUERY PLAN` names it).
- [ ] **Step 1: Write the failing test** in `apps/server/src/attendance-loop.test.ts`:
  `"keeps a day due while a deferred shift's end is still to come, and stops once evaluated past
  it"` built only from `next_due_at` and `end_at` (it fails while the code reads
  `json_array_length(deferred_shift_ids)`, because the fixture writes no list). Keep every existing
  deferred-shift case.
- [ ] **Step 2: Run, see it fail. Step 3: Implement** (drop the column, its write, the two reads).
- [ ] **Step 4: Rebuild** `--set workforce`; run the loop, discovery and end-of-day tests.
- [ ] **Step 5: Commit** `git commit -s -m "Read deferred attendance shifts from the day's due time"`.

### Task 3: Questions point at their day

- [ ] **Step 1: Write the failing tests** in `attendance-questions.test.ts`:
  `"refuses a question for a day that does not exist"` (database key), `"a question's view shows its
  day's business day and bounds"`, `"refuses a question whose day changed"` (the renamed refusal),
  `"lists a person's questions in day order"` (ordering through the join).
- [ ] **Step 2: Run, see them fail. Step 3: Implement** the column, key, index, writers, readers.
  Fixtures that inserted questions with bounds insert a day row (or reuse the one the evaluation
  made) and pass its id; their assertions do not change.
- [ ] **Step 4: Rebuild** `--set workforce`; run the workforce and server finish-line runs.
- [ ] **Step 5: Commit** `git commit -s -m "Attendance questions point at their day instead of copying it"`.

### Task 4: Answers are append-only

- [ ] **Step 1: Write the failing tests** in `attendance-response-schema.test.ts`:
  `"refuses changing an answer"`, `"refuses deleting an answer"` (each asserts the trigger's
  message `attendance_answers is append-only`, the form `time_entries_append_only_update` uses),
  `"still records and replays an answer"`. Add `attendance_answers` to
  `scripts/append-only-triggers.test.ts`'s workforce list.
- [ ] **Step 2: Run, see them fail. Step 3: Implement** the classification change.
- [ ] **Step 4: Run** the finish line's schema-guard run.
- [ ] **Step 5: Commit** `git commit -s -m "Make attendance answers append-only"`.

### Task 5: Protection list, finish

- [ ] **Step 1:** Protection list before and after; paste and mark.
- [ ] **Step 2:** Run the finish line; `/finish-branch`.
