# A1308 fiscal 4b: the clock stop moves onto the fiscal history — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the clock stop's writes and reads from `clock_checks` and `clock_confirmations` onto
[fi4a](2026-11-08-a1308-fi4a-history-table.md)'s `verifactu_history` (kinds `clock.check_opened` and
`clock.confirmed`), re-point the clock suites, and delete the two tables and `clock_stop_restarts`,
which nothing writes.

**Architecture:** fi4a built the table, its CHECKs, the one writer `appendHistory` and the typed
readers, whose row shapes carry today's field names. This plan changes each clock function's
`from` and keeps its logic; the clock suites change their set-up and reads, and keep their
assertions except the `seq` values listed under "Assertions that change, by design", which move
because checks and confirmations now share one sequence (tables-fiscal §5).

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §0.3, §3, §4
(`clock_checks`, `clock_confirmations`, `clock_stop_restarts`), §5 (their rows and the note after
the table); README §3, §5 U10; CLAUDE.md §5 "More than a minute behind the latest fiscal record";
rules [2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi4a. Names are fi1's. Line numbers read at `a086eedfb7`.

**Owner lands:** yes (the clock stop decides whether a sale may be recorded; CLAUDE.md §5).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply.
- **The clock stop decides exactly as today.** Same refusals, same confirmations covering the same
  readings, same open check, same alerts. The clock suites listed in the Finish line keep every
  assertion except those under "Assertions that change, by design"; they are re-pointed at the
  history, never rewritten.
- The engine is `node:sqlite` through `useVenueDb`, never the `sqlite3` command line (CLAUDE.md §3).
- `person_id` has a key to `persons` (design U11). A fixture that invents a person creates it first.

## Review Focus

1. **One sequence instead of two.** Nothing compares a check's `seq` with a confirmation's (read
   `clock-checks.ts:38-70`, `clock-behind.ts:112-150`, `clock-stop-incidents.ts:205-216`): each
   orders within one kind. A reviewer confirms by reading those three readers, and the clock suites
   run it. The only assertions that move are the `seq` values listed below.
2. **A deleted test that held something else.** `clock-stop-restarts.test.ts` also holds the
   latest-record query-plan case; Task 3 moves it before the file goes.
3. **`clock-confirmations.test.ts`** goes only because fi4a carried each of its cases into
   `schema/verifactu-history.test.ts` (fi4a, "Assertions that change, by design"). A reviewer
   checks the carried list against the file before it is deleted.

---

## What it builds

- The clock code moved onto `appendHistory` and the `history.ts` readers: `clock-checks.ts`
  (`openCheck`, `nextCheckSeq`, `nextConfirmationSeq`, `writeClosing`, `openClockCheck`),
  `clock-confirmation.ts` (latest confirmation, `confirmClockStop`), `clock-step.ts`,
  `clock-misdated.ts`, `clock-stop-incidents.ts`, `clock-behind.ts`.
- `packages/fiscal-verifactu/test/history-fixture.ts`: `clockCheckRows(db)` and
  `clockConfirmationRows(db)` (every row of the kind, by `seq`, in fi4a's row shapes) for tests that
  selected from the old tables, and `countOfKind(db, kind)` for tests that counted them.
- **Deleted:** `clock_checks`, `clock_confirmations`, `clock_stop_restarts` and their schema files,
  classification entries, manifest entries, `EXPECTED` and `schema-constraints` entries, backup
  links (`backup-verification-history.ts:444-449`); `clock-stop-restarts.test.ts` (its three table
  cases go with the table; its plan case moves first, Task 3); `clock-confirmations.test.ts` (each
  case carried by fi4a).
- The backup walk's links for `verifactu_history`: `node_id` → `nodes`, `registro_id` →
  `verifactu_records`, `ref_id` → `verifactu_history`, `person_id` → `persons`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The table, its CHECKs, writer and readers | fi4a (landed first) |
| `conflict.observed`, `conflict.lookup` | fi5 |
| `case.note` | fi6 |
| `aeat.answer_cleared` | fi7 |

## Files

**Create**
- `packages/fiscal-verifactu/test/history-fixture.ts`.

**Modify**
- `packages/fiscal-verifactu/src/clock-checks.ts:23-70`, `:184-296`; `clock-confirmation.ts:37`,
  `:90-105`, `:219-247`; `clock-step.ts:17`, `:104-138`; `clock-misdated.ts:11-12`, `:52-64`;
  `clock-stop-incidents.ts:11`, `:205-216`; `clock-behind.ts:8`, `:112-123`.
- `packages/fiscal-verifactu/src/schema/index.ts`, `src/classification.ts`,
  `packages/migrations/migrations.manifest.json` (fiscal entry: remove the three),
  `src/backup-verification-history.ts:428-450` (links: drop the clock tables', add
  `verifactu_history`'s four).
- `scripts/append-only-triggers.test.ts` (`EXPECTED`), `scripts/schema-constraints.test.ts`
  (`:414-416`, `:577-581`: the old uniques and CHECKs leave).
- `packages/fiscal-verifactu/src/clock-behind.test.ts` (gains the plan case, Task 3).
- The test files that name the old tables. At `a086eedfb7`,
  `git grep -cw "clock_checks\|clock_confirmations\|clock_stop_restarts\|clockChecks\|clockConfirmations\|clockStopRestarts" -- '*.test.ts'`
  printed 211 lines in 20 files: `clock-confirmations.test.ts` 50 and `clock-stop-restarts.test.ts`
  10 (both deleted); `clock-misdated.test.ts` 22, `apps/server/src/clock-watch.restart.test.ts` 22,
  `clock-stop-incidents.test.ts` 16, `clock-step.test.ts` 16, `clock-checks.test.ts` 13,
  `clock-confirmation.test.ts` 10, `backup-verification-history.test.ts` 10,
  `clock-misdated-detail.test.ts` 8, `apps/server/src/clock-confirm.route.test.ts` 7,
  `scripts/schema-constraints.test.ts` 6, `clock-behind.restart.test.ts` 4,
  `backend.clock-stop.test.ts` 4, `scripts/append-only-triggers.test.ts` 3,
  `schema-ownership.test.ts` 3, and 1–2 each in `apps/server/src/zone-clock-stop-interaction.test.ts`,
  `till-box-clock-api.test.ts`, `clock-set.route.test.ts`, `boot.clock-watch.test.ts`. That is 151
  lines to re-point in files that stay. Direct inserts among them (become `appendHistory`):
  `git grep -n "insert(clockChecks)\|insert(clockConfirmations)\|insert into clock_checks\|insert into clock_confirmations" -- '*.test.ts'`.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`REMOVED_TABLES`, `:39`).
- Documents (Task 5).

**Delete**
- `packages/fiscal-verifactu/src/schema/clock-checks.ts`, `clock-confirmations.ts`,
  `clock-stop-restarts.ts`; `src/clock-stop-restarts.test.ts`, `src/clock-confirmations.test.ts`.

**Generated:** `packages/fiscal-verifactu/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: clock readers and writers re-pointed 110, lists and backup links 15 | ~125 |
| Tests: fixture 40, re-pointed clock tests 190 (151 lines named above, inserts grow into `appendHistory` calls), changed `seq` assertions 15, moved plan case 15, demo list 2 | ~262 |
| Documents | ~40 |
| **Total** | **~427** |

Not counted: the three deleted schema files, the two deleted test files, the generated migration.

## Assertions that change, by design

Design: tables-fiscal §5, the `clock_checks` row ("the shared unique `seq`") and §1.1 (`seq`
"orders the log"): checks and confirmations draw from one sequence, so a confirmation written after
a check takes the next number after it. Only `seq` values move; every other field of each
assertion stays. The values below were predicted by reading each test's set-up (which rows it
writes, in what order) at `a086eedfb7`, not by running; the builder runs each and records the real
value. A `seq` that moves to a value other than the one predicted here, or any other changed field,
is a stop (rules §5.3).

| Site (`packages/fiscal-verifactu/src/`) | Before | Predicted after | Rows written before it |
| --- | --- | --- | --- |
| `backend.clock-stop.test.ts:113` (the confirmation's answer) | `seq: 1` | `seq: 2` | the check opened at `:102-104` |
| `clock-checks.test.ts:226` (the second check) | `seq: 2` | `seq: 3` | check, its closing, then this check |
| `clock-checks.test.ts:244` (the closing of the first check) | `seq: 1` | `seq: 2` | the first check |
| `clock-checks.test.ts:458` and `:485` (`closedWith`'s row and answer) | `seq: 1` | `seq: 2` | each caller opens one check first (`caseB`, `:408-411`) |
| `clock-confirmation.test.ts:222`, `:252` | `seq: 1` | `seq: 2` | `openCheck(R)` at `:200` |
| `clock-confirmation.test.ts:509-512` | `[…, 1, …]`, `[…, 2, …]` | `[…, 2, …]`, `[…, 4, …]` | check, confirmation, check, confirmation |
| `clock-confirmation.test.ts:615`, `:648` | `seq: 1` | `seq: 2` | `openCheck(R)` at `:607` |
| `clock-confirmation.test.ts:821`, `:854` | `seq: 1` | `seq: 2` | `waitingCheck()` opens one check (`:807-810`) |
| `clock-step.test.ts:224` (the step's answer) | `seq: 1` | `seq: 2` | the step opens a check first (`checkIds()` has one at `:208`) |

Found with `git grep -n "seq: [0-9]\|row.seq" -- 'packages/fiscal-verifactu/src/*clock*.test.ts' 'packages/fiscal-verifactu/src/backend.clock-stop.test.ts'`
at `a086eedfb7`, then each hit read; hits that are a fixture's input (`clock-misdated.test.ts:802`,
the stubbed answers in `apps/server/src/clock-watch.test.ts:35`, `clock-watch.anchor.test.ts:37`,
`clock-watch.start-up.test.ts:91`) are not assertions and stay. `clock-confirmations.test.ts`'s
`seq` and refusal assertions are fi4a's list, not this one.

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/schema/verifactu-history.test.ts src/history.test.ts src/clock-behind.test.ts src/clock-behind.restart.test.ts src/clock-checks.test.ts src/clock-confirmation.test.ts src/clock-misdated.test.ts src/clock-misdated-detail.test.ts src/clock-step.test.ts src/clock-stop-incidents.test.ts src/clock-behind-alerts.test.ts src/chain.clock-behind.test.ts src/backend.clock-stop.test.ts src/backend.clock-behind.test.ts src/drain.clock-step.test.ts src/backup-verification-history.test.ts src/classification.test.ts src/schema-ownership.test.ts
# and fi1's record suites
pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts src/clock-watch.restart.test.ts src/zone-clock-stop-interaction.test.ts src/boot.clock-watch.test.ts src/clock-set.route.test.ts src/till-box-clock-api.test.ts src/clock-watch.start-up.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts
pnpm --filter @waitron/composition exec vitest run src/composition.test.ts
git grep -nw "clock_checks\|clock_confirmations\|clock_stop_restarts\|clockChecks\|clockConfirmations\|clockStopRestarts" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing. Each Vitest run shows a `Tests` count with no failures (CLAUDE.md §4).

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue`. Simulated on 2026-11-08 from a list
of `a086eedfb7` with fi1–fi3 applied (a prediction); nothing about `verifactu_history` changes.

`phase=sql-only`:

```text
missing index clock_checks.primary key(id)
missing index clock_checks_seq_uq
missing index clock_confirmations.primary key(id)
missing index clock_confirmations_check_uq
missing index clock_confirmations_registro_idx
missing index clock_confirmations_seq_uq
missing index clock_stop_restarts.primary key(id)
missing index clock_stop_restarts_registro_uq
missing table clock_checks
missing table clock_confirmations
missing table clock_stop_restarts
```

`phase=migrated` and `phase=change-feed`: the same, plus, among the missing,

```text
missing trigger clock_checks_append_only_delete
missing trigger clock_checks_append_only_update
missing trigger clock_confirmations_append_only_delete
missing trigger clock_confirmations_append_only_update
missing trigger clock_stop_restarts_append_only_delete
missing trigger clock_stop_restarts_append_only_update
```

Design reasons: tables-fiscal §5, the `clock_checks`, `clock_confirmations` and
`clock_stop_restarts` rows and the note after the table.

## Stop points (beyond rules §5)

1. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, to which identity or
   series a sale uses, or to whether a reading is refused by the clock stop: a fi1 record suite or a
   clock suite needs a changed assertion beyond the `seq` list above.
2. A clock suite's set-up invents a `person_id`: create the person (rules §4); if the production
   writer can be given a person id that is not a `persons` row, stop.
3. A case of `clock-confirmations.test.ts` has no carried twin in `schema/verifactu-history.test.ts`:
   add it there (fi4a's list says how it changes) before deleting the file; a case whose carried
   form would need a change fi4a did not list is a stop.

## Needs

fi4a.

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: re-point the clock suites (they fail first)

- [ ] **Step 1:** Write `test/history-fixture.ts` (What it builds).
- [ ] **Step 2:** Re-point the clock suites' set-up and reads (the files in Files, except the two
  deleted): selects from `clockChecks`/`clockConfirmations` become `clockCheckRows(db)`/
  `clockConfirmationRows(db)`; counts become `countOfKind`; direct inserts become `appendHistory`
  (whose `seq` it assigns, so the hand-numbered `seq` set-ups at `clock-behind.restart.test.ts:134-154`,
  `clock-misdated.test.ts:124`, `:145`, `clock-misdated-detail.test.ts:142`, `:162` and
  `clock-stop-incidents.test.ts:758-760` go); a confirmation's `checkId` is a check's history id.
  Change the `seq` values in "Assertions that change, by design", nothing else.
- [ ] **Step 3:** Run the Finish line's clock files: they FAIL (the code still writes the old tables).

### Task 2: move the clock code onto the history

- [ ] **Step 1:** Move each writer to `appendHistory` and each reader to the `history.ts` readers:
  `writeClosing`, `openClockCheck`, `confirmClockStop`, `confirmClockStep` write;
  `openCheck` → `latestClockCheck`; `nextCheckSeq` and `nextConfirmationSeq` are deleted (their
  callers stop needing a `seq`); `uncoveredBy` → `latestConfirmationNaming`; `clock-confirmation.ts:90-105`
  → `latestConfirmationNaming`; `clock-misdated.ts:52-64` → `clockConfirmation`;
  `recordDisproofs` → `confirmationsNamingRecords`. Logic after each read is unchanged.
- [ ] **Step 2:** Run the Finish line's fiscal-verifactu and server lines. PASS, each `seq` at the
  value predicted (record any that differs: stop). Commit: "The clock stop reads and writes the
  fiscal history (A1308 fiscal 4b)".

### Task 3: keep the latest-record plan case

`clock-stop-restarts.test.ts:82-95`, "reads the latest record through the time index, sorting only
the ties by id", pins `latestRecordQuery`'s plan (`clock-behind.ts`): after fi1,
`SCAN verifactu_records USING INDEX verifactu_records_generado_idx` and
`USE TEMP B-TREE FOR LAST TERM OF ORDER BY`, and that the text ends `limit ?`. It has nothing to do
with `clock_stop_restarts`; the backlog entry asks for it to move first
(`docs/backlog/box.md:2301-2304`).

- [ ] **Step 1:** Move the case, unchanged, into `clock-behind.test.ts` (with its imports and
  `seedPendingEnvios` set-up). Run it there: PASS. Deletion proof: drop
  `verifactu_records_generado_idx` in a scratch copy of the case; it fails on the plan line.

### Task 4: delete the clock tables and `clock_stop_restarts`

- [ ] **Step 1:** Check every case of `clock-confirmations.test.ts` against fi4a's carried list
  (stop 3). Delete the three schema files, `clock-stop-restarts.test.ts`,
  `clock-confirmations.test.ts`, their exports, classification and manifest entries, `EXPECTED` and
  `schema-constraints` entries; replace the clock links in `backup-verification-history.ts` with
  `["verifactu_history", "node_id", "nodes", "id"]`, `["verifactu_history", "registro_id", "verifactu_records", "id"]`,
  `["verifactu_history", "ref_id", "verifactu_history", "id"]`, `["verifactu_history", "person_id", "persons", "id"]`,
  with a broken-link case for one of them in `backup-verification-history.test.ts` in the file's
  existing style. Rebuild the set.
- [ ] **Step 2: The demo capture:** the three tables held no captured row (manifest counts 0); add
  them to `REMOVED_TABLES` (`seed.madrid-baseline.test.ts:39`).
- [ ] **Step 3:** Run the whole Finish line. PASS. Commit: "Remove the clock tables the history
  replaced, and clock_stop_restarts (A1308 fiscal 4b)".

### Task 5: protection list, documents, finish

- [ ] **Step 1:** `pnpm protection-list list --out <B>`; compare with `<A>`; exactly "Expected
  protection-list difference".
- [ ] **Step 2: Documents** (rules §9).
  - Backlog: delete "`clock_stop_restarts` is written by nothing …" from "What A1308 retires"
    (`docs/backlog/architecture.md:1304-1306`) and its detail (`docs/backlog/box.md:2294-2304`).
    In `docs/backlog.md:1862-1865` and `docs/backlog/box.md:1775`, `clock_confirmations` becomes
    "the fiscal history's `clock.confirmed` rows".
  - `docs/developers/conventions-data.md`: list the hits with
    `git grep -nw "clock_checks\|clock_confirmations\|clock_stop_restarts\|clock-stop-restarts.test.ts" -- docs/developers`
    (12 lines at `a086eedfb7`). Sentences about today's behaviour name `verifactu_history` and the
    kind: `:4071` (the plan case now in `clock-behind.test.ts`), `:4175-4194` ("The tables": one
    table now, one shared `seq`, the person refused by its key rather than a CHECK, one closing
    per check by `event_key`, `clock_stop_restarts` gone), `:4227`, `:4358`, `:4415`, `:4528`,
    `:5630`. The receipt at `:4164-4171` (runs against a prototype) keeps its words.
  - CLAUDE.md §5's clock rule names no table (`CLAUDE.md:874-892` at `a086eedfb7`), so it needs no
    edit.
- [ ] **Step 3:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset`.
