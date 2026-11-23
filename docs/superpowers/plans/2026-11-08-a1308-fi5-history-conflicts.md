# A1308 fiscal 5: AEAT conflicts move into the fiscal history — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `fiscal_conflict_evidence` (a conflict AEAT reported on a sending attempt) and
`fiscal_lookup_conflicts` (a record of ours whose stored copy differs from AEAT's, from W41s-10a,
#2449) into `verifactu_history` as kinds `conflict.observed` and `conflict.lookup`, keeping every
uniqueness and CHECK they hold, and keeping the sale-path read that refuses issuance while a conflict
is active exactly as it decides today.

**Architecture:** Two new kinds on Fi4's table, each with one CHECK carrying its shape and its
natural key: `conflict:<registro>:<attempt>:<cause>` (was the unique
`(registro_id, attempt, cause)`) and `lookup:<registro>` (was the unique `registro_id`). Writers that
inserted "or do nothing on a conflict" now insert "or do nothing" on `event_key`. The `case_id`
column both tables carry goes: the case is the record's own (fi6 folds the case into the record's
submission row), and in this pull request `readActiveConflicts` still joins `filing_cases` by
`registro_id`, which is unique there (`filing_cases_registro_uq`).

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §0 (table:
"(2) absorbs `fiscal_conflict_evidence` — Breaks … Goes to (3)"; "(3) absorbs the conflicts W41s-10a
added"), §1.1 "The lookup conflict folds into `verifactu_history`", §3 (`conflict.observed`,
`conflict.lookup`), §5 (both rows), §8 item 4; README §10 "Applied as the design" ("The lookup
conflict folds into `verifactu_history`; the series conflict stays a table"); rules
[2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after [Fi4](2026-11-08-a1308-fi4a-history-table.md). Line numbers originally read
at `a086eedfb7`.

**Owner lands:** yes (`readActiveConflicts` refuses issuance on every sale, `backend.ts:187`,
`conflict-evidence.ts:25`).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 and Fi4's CHECK convention apply. Put the three new per-kind CHECKs after
  `verifactu_history_data_ck` and wrap each in `kind <> … OR coalesce(…, 0)`. Keep the malformed
  JSON test that asserts the data CHECK's name.
- **The same conflicts are active.** For every fixture, `readActiveConflicts` returns the same list,
  in the same order, with the same `cause`, `observedAt` and `evidence`; only `evidenceId` now names
  a history row. The conflict suites keep their assertions.
- `verifactu_series_conflicts` stays a table (README §10).

## Review Focus

1. **Order of the active list.** Today it is ordered by the record's `secuencia`, then the
   observation's `attempt` (`conflict-evidence.ts:78`), and the first row per record wins. With
   `attempt` read from JSON, the order must be numeric: `json_extract` returns an integer for a JSON
   integer, but the CHECK must make sure it is one.
2. **"Do nothing" on the right key.** `recordConflictEvidence` and `retainLookupConflict` ignore only
   a clash on `event_key` (CLAUDE.md §3: an untargeted `onConflictDoNothing` absorbs every unique
   conflict, `seq`'s included).
3. **The CHECKs fire** (tables-fiscal §8 item 4). Test both conflict kinds and each new column
   on a clock row.

---

## What it builds

- Append nullable `event_key` (`label`) and nullable `registro_id` (`id`) to
  `verifactu_history`. Use the unique index `verifactu_history_event_key_uq (event_key)` and
  the lookup index `verifactu_history_registro_kind_seq_idx (registro_id, kind, seq)`. Link `registro_id` to
  `verifactu_records.id` with `onDelete("restrict")` and verify that link in backup copies.
- `verifactu_history_kind_ck` admits `clock.confirmed`, `conflict.observed` and `conflict.lookup`.
  Extend the clock kind's checks with `verifactu_history_confirmed_links_ck`, requiring
  `event_key is null and registro_id is null` so a clock row cannot take a conflict or note's key.
- `conflict.observed` — from `fiscal_conflict_evidence`. `at` = `recorded_at`; `registro_id`;
  `data`: `attempt`, `cause`, `evidence`.
  - `verifactu_history_observed_ck`: `registro_id is not null and json_type(data, '$.attempt') = 'integer' and json_extract(data, '$.attempt') > 0 and json_extract(data, '$.cause') in ('fiscal.huella_divergente', 'fiscal.duplicado_anulado') and json_type(data, '$.evidence') is not null and person_id is null and event_key = 'conflict:' || registro_id || ':' || json_extract(data, '$.attempt') || ':' || json_extract(data, '$.cause')`
    (was `fiscal_conflict_evidence_attempt_ck`, `_cause_ck` and, with the unique `event_key`,
    `_attempt_uq`).
- `conflict.lookup` — from `fiscal_lookup_conflicts`. `at` = `recorded_at`; `registro_id`; `data`:
  `evidence`.
  - `verifactu_history_lookup_ck`: `registro_id is not null and json_type(data, '$.evidence') is not null and person_id is null and event_key = 'lookup:' || registro_id`
    (with the unique `event_key`, was `fiscal_lookup_conflicts_registro_uq`).
- `appendHistory(tx, entry, { ifAbsent: true })`: `insert … on conflict (event_key) do nothing`,
  returning `null` when nothing was written.
- Readers `observedConflicts(tx, registroIds)` and `lookupConflict(tx, registroId)` in `history.ts`.
- The writers and readers moved: `recordConflictEvidence` (`conflict-evidence.ts:134-164`, loses its
  `caseId` input), `retainLookupConflict` (`reconcile-conflicts.ts:6-21`), `readActiveConflicts`
  (`conflict-evidence.ts:35-87`), `checkOriginal` (`conflict-recovery.ts:75-96`), the call in
  `drain.ts:1914-1925`, and `readFilingOverview` (`filing-overview.ts:44–70`).
- Deleted: both tables, their schema files, classification and manifest entries, backup links
  (`backup-verification-history.ts:436–439`).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `filing_cases`, the cases' `caseId` in `ConflictRef`, and `readActiveConflicts`' join to cases | fi6 |
| `verifactu_series_conflicts` | Stays a table (README §10); fi1 renamed it |
| `evidenceId` meaning | Kept as a field; it now names a `verifactu_history` row (or a series conflict row, unchanged) |

## Interfaces

```ts
// added to HistoryEntry in packages/fiscal-verifactu/src/history.ts
| { kind: "conflict.observed"; nodeId: NodeId; at: Date; registroId: string;
    data: { attempt: number; cause: ConflictCause; evidence: ConflictEvidence } }
| { kind: "conflict.lookup"; nodeId: NodeId; at: Date; registroId: string;
    data: { evidence: LookupConflictEvidence } };

export function appendHistory(tx: Transaction, entry: HistoryEntry): Promise<{ id: string; seq: number }>;
export function appendHistory(tx: Transaction, entry: HistoryEntry, options: { ifAbsent: true }): Promise<{ id: string; seq: number } | null>;
export interface ObservedConflictRow { id: string; registroId: string; attempt: number; cause: ConflictCause; evidence: ConflictEvidence; recordedAt: Date }
export interface LookupConflictRow { id: string; registroId: string; evidence: LookupConflictEvidence; recordedAt: Date }
export function observedConflicts(tx: Transaction, registroIds: readonly string[]): Promise<ObservedConflictRow[]>;
export function lookupConflict(tx: Transaction, registroId: string): Promise<LookupConflictRow | null>;
```

`nodeId` for both kinds is the record's node, read from `verifactu_records` by the writer (the old
tables had no node column; the history's `node_id` is not null).

## Files

**Modify**
- `packages/fiscal-verifactu/src/history.ts`, `src/schema/verifactu-history.ts` (two columns, two
  indexes, record FK, three per-kind CHECKs and kind list), `src/schema/verifactu-history.test.ts`,
  `src/history.test.ts`.
- `packages/fiscal-verifactu/src/conflict-evidence.ts:1-164`, `reconcile-conflicts.ts`,
  `conflict-recovery.ts:27`, `:75-96`, `drain.ts:1914-1925`, `filing-overview.ts`.
- `packages/fiscal-verifactu/src/schema/index.ts`, `classification.ts:9-10`, the manifest's fiscal
  entry, `backup-verification-history.ts:436–439`.
- `scripts/append-only-triggers.test.ts`, `scripts/schema-constraints.test.ts`.
- Tests that seed or read the two tables: `backup-lookup-conflicts.test.ts`,
  `reconcile.conflicts.test.ts`, `conflict-issuance.test.ts`, `conflict-recovery.test.ts`,
  `filing-overview.test.ts`, `drain.conflict-recovery.test.ts`, `backup-verification-history.test.ts`,
  `packages/fiscal-verifactu/test/live-conflict-fixture.ts`, `apps/server/src/live-conflict-recovery.test.ts`,
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`ADDED_TABLES` lists both at `:28-29`;
  they leave it).

**Delete**
- `packages/fiscal-verifactu/src/schema/conflict-evidence.ts` (its exported types move to
  `conflict-types.ts`, which already holds `ConflictEvidence`'s siblings), `schema/lookup-conflicts.ts`.

**Generated:** `packages/fiscal-verifactu/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: schema and CHECKs 40, `history.ts` additions 60, `readActiveConflicts` 40, writers 25, recovery/overview reads 25, lists and backup link 10, type moves 10 | ~210 |
| Tests: CHECK and FK cases 105, writer/reader cases 50, plan case 20, re-pointed conflict and backup set-ups 100 | ~275 |
| **Total** | **~485** |

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/schema/verifactu-history.test.ts src/history.test.ts src/conflict-issuance.test.ts src/conflict-recovery.test.ts src/conflict-recovery-routes.test.ts src/conflict-recovery-contract.test.ts src/drain.conflict-recovery.test.ts src/reconcile.conflicts.test.ts src/reconcile.scope.test.ts src/backup-lookup-conflicts.test.ts src/backup-series-conflicts.test.ts src/backup-verification-history.test.ts src/drain.test.ts src/drain.probe.test.ts src/dashboard/conflict-recovery.test.ts src/filing-overview.test.ts
# and fi1's record suites
pnpm --filter @waitron/server exec vitest run src/live-conflict-recovery.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts
git grep -nw "fiscal_conflict_evidence\|fiscal_lookup_conflicts\|fiscalConflictEvidence\|fiscalLookupConflicts" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'
```

The grep prints nothing.

## Expected protection-list difference

Prediction for `composition=fiscal-verifactu database=venue`, beginning with `phase=sql-only`.
The missing lines were simulated on 2026-11-08 from `a086eedfb7` with the original Fi1–Fi4b plans.
The history changes below are predictions for the combined Fi4 base.

```text
missing index fiscal_conflict_evidence.primary key(id)
missing index fiscal_conflict_evidence_attempt_uq
missing index fiscal_lookup_conflicts.primary key(id)
missing index fiscal_lookup_conflicts_registro_uq
missing table fiscal_conflict_evidence
missing table fiscal_lookup_conflicts
changed table verifactu_history.checks[verifactu_history_kind_ck].expression
old: <Fi4's one kind, 'clock.confirmed'>
new: <the three-kind list above>
changed table verifactu_history.columnOrder
old: <Fi4's columns in declared order>
new: <same columns followed by event_key, registro_id>
extra table verifactu_history.columns[event_key]
extra table verifactu_history.columns[registro_id]
extra table verifactu_history.foreignKeys[registro_id->verifactu_records(id)]
extra table verifactu_history.checks[verifactu_history_confirmed_links_ck]
extra table verifactu_history.checks[verifactu_history_lookup_ck]
extra table verifactu_history.checks[verifactu_history_observed_ck]
extra index verifactu_history_event_key_uq
extra index verifactu_history_registro_kind_seq_idx
```

Under `phase=migrated` and `phase=change-feed`, the same plus

```text
missing trigger fiscal_conflict_evidence_append_only_delete
missing trigger fiscal_conflict_evidence_append_only_update
missing trigger fiscal_lookup_conflicts_append_only_delete
missing trigger fiscal_lookup_conflicts_append_only_update
```

Check the JSON for nullable columns, the record FK's `RESTRICT` action, the unique key and the
three-column index order. The design reasons are in tables-fiscal §5 under the two conflict tables.
The case FK leaves with `case_id`.

## Stop points (beyond rules §5)

1. A per-kind CHECK accepts a row it should refuse, or a JSON-reading CHECK precedes the data
   CHECK. Follow Fi4's first stop and take the result to the watcher before moving a JSON field into
   a typed nullable column with a plain CHECK.
2. `readActiveConflicts` returns a different list, order, cause, time or evidence for any existing
   fixture.
3. `readActiveConflicts`' plan scans either history alias instead of looking it up with
   `verifactu_history_registro_kind_seq_idx`.
4. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, or to which identity
   or series a sale uses: a fi1 record suite fails.

## Needs

Fi4, including its verified clock writer and its node and person backup links.

W41s-9 slice 1 (2026-11-10) added a reader of `fiscal_conflict_evidence` and
`fiscal_lookup_conflicts`, which this slice moves: `packages/fiscal-verifactu/src/filing-overview.ts`.
It lists them beside the cases from `openFilingCases` in `filing-cases.ts`. The Fiscal filing screen and its export name each case by its record id (`registroId`).

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1. Add the conflict columns, indexes and CHECKs (test first, §8 item 4)

- [ ] In `verifactu-history.test.ts`, pin each conflict CHECK with wrong values, missing fields
  and incorrect keys. Refuse a duplicate observed record/attempt/cause and a duplicate lookup on
  the unique index. Accept the same observed record and cause at attempt 2. Refuse text `"1"`
  as an attempt. Refuse a conflict with a missing record parent and accept one with a real parent.
  Use an otherwise valid clock row to test a non-null `event_key` and, separately, a non-null
  `registro_id` naming a real record. Both must fail `verifactu_history_confirmed_links_ck`.
  Accept two clock rows with distinct sequences and both links null.
- [ ] Run the cases to red. Add both columns, the two named indexes, the restricting record FK,
  the updated kind list and the three per-kind CHECKs in the declared order. Rebuild the set.
- [ ] Run the cases to green and check the generated CHECK order (stop 1). Commit
  "Conflict kinds in the fiscal history, with their checks (A1308 fiscal 5)".

### Task 2: writers and readers

- [ ] **Step 1: Failing tests** in `history.test.ts`: "writes an observed conflict once per record,
  attempt and cause" (`ifAbsent` returns `null` the second time and the table holds one row);
  "a clash on `seq` is not swallowed" (force a duplicate `seq` with a stub that returns a used
  number; the insert throws); "lookupConflict reads the one row for a record".
- [ ] **Step 2:** Re-point the conflict suites' set-up (inserts into the two tables become
  `appendHistory`; reads become the history readers). Assertions unchanged. Run them: FAIL.
- [ ] **Step 3:** Implement `ifAbsent` (`onConflictDoNothing({ target: verifactuHistory.eventKey })`,
  only allowed for kinds that derive a key: it throws for a kind whose key is null). Move
  `recordConflictEvidence` and `retainLookupConflict` onto it. `readActiveConflicts`: replace the two
  left joins with left joins to `verifactu_history` aliased `observed` (on
  `observed.registro_id = r.id and observed.kind = 'conflict.observed'`) and `lookup` (on
  `lookup.registro_id = r.id and lookup.kind = 'conflict.lookup'`); order by `r.secuencia`, then
  `json_extract(observed.data, '$.attempt')`; read `cause`, `evidence` and the time from the
  aliases. The join to `filing_cases` stays (Fi6). `checkOriginal` reads `lookupConflict`.
  In `readFilingOverview` use `observedConflicts(tx, listed)`, ordered by numeric attempt then
  `seq`. Read lookup rows in one query for the listed record IDs, ordered by `seq`. Keep the
  overview's output assertions.
- [ ] **Step 4:** Add a plan case: `readActiveConflicts`' statement uses
  `verifactu_history_registro_kind_seq_idx` for both aliases (stop 3).
- [ ] **Step 5:** Run the Finish line's fiscal-verifactu and server lines. PASS. Commit: "AEAT
  conflicts are read from and written to the fiscal history (A1308 fiscal 5)".

### Task 3: delete the two tables; protection list; finish

- [ ] **Step 1.** In `backup-verification-history.test.ts`, move conflict fixtures to history.
  With the new row in both copies, make its `registro_id` name a missing record and require a
  refusal. Run the case before and after adding the verifier link
  `verifactu_history.registro_id → verifactu_records.id`. Retire the old case-link refusal and keep
  the valid copy, including the clock row with a null record link, accepted. Keep the case where
  only the after copy loses a conflict row (`backup-verification-history.test.ts:977`), using the
  row's history ID so it leaves the clock history in place.
- [ ] **Step 2.** Delete the schema files (move their exported types to `conflict-types.ts` first),
  exports, classification and manifest entries, guard entries and the four old backup links. Remove
  both old tables from the demo test's `ADDED_TABLES` (the seed writes neither new kind). Rebuild the
  set and run the Finish line to green.
- [ ] **Step 3:** Protection list against `<A>`: exactly "Expected protection-list difference".
- [ ] **Step 4: Documents:** tables-fiscal.md §8 item 4, a dated line for these two kinds;
  `docs/developers/conventions-data.md`, any sentence naming the two tables. No backlog entry names
  them (searched `docs/backlog/` at `a086eedfb7`).
- [ ] **Step 5:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset`.
