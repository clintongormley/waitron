# A1308 fiscal 5: AEAT conflicts move into the fiscal history — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `fiscal_conflict_evidence` (a conflict AEAT reported on a sending attempt) and
`fiscal_lookup_conflicts` (a record of ours whose stored copy differs from AEAT's, from W41s-10a,
#2449) into `verifactu_history` as kinds `conflict.observed` and `conflict.lookup`, keeping every
uniqueness and CHECK they hold, and keeping the sale-path read that refuses issuance while a conflict
is active exactly as it decides today.

**Architecture:** Two new kinds on fi4a's table, each with one CHECK carrying its shape and its
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

**Base:** `main` after fi4b (fi4a built the table and writer; fi4b moved the clock onto it). Line
numbers read at `a086eedfb7`.

**Owner lands:** yes (`readActiveConflicts` refuses issuance on every sale, `backend.ts:187`,
`conflict-evidence.ts:25`).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply; fi4a's CHECK rule (`kind <> … OR coalesce(…, 0)`) applies to every new CHECK,
  and each new CHECK is declared after `verifactu_history_data_ck` (fi4a, Global Constraints: a
  `json_extract` CHECK run before it raises `malformed JSON` on malformed data instead of failing
  under the data CHECK's name).
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
3. **The CHECKs fire** (tables-fiscal §8 item 4), for both kinds.

---

## What it builds

- `verifactu_history_kind_ck` extended to `('clock.check_opened', 'clock.confirmed', 'conflict.observed', 'conflict.lookup')`.
- `conflict.observed` — from `fiscal_conflict_evidence`. `at` = `recorded_at`; `registro_id`;
  `data`: `attempt`, `cause`, `evidence`.
  - `verifactu_history_observed_ck`: `registro_id is not null and json_type(data, '$.attempt') = 'integer' and json_extract(data, '$.attempt') > 0 and json_extract(data, '$.cause') in ('fiscal.huella_divergente', 'fiscal.duplicado_anulado') and json_type(data, '$.evidence') is not null and ref_id is null and person_id is null and event_key = 'conflict:' || registro_id || ':' || json_extract(data, '$.attempt') || ':' || json_extract(data, '$.cause')`
    (was `fiscal_conflict_evidence_attempt_ck`, `_cause_ck` and, with the unique `event_key`,
    `_attempt_uq`).
- `conflict.lookup` — from `fiscal_lookup_conflicts`. `at` = `recorded_at`; `registro_id`; `data`:
  `evidence`.
  - `verifactu_history_lookup_ck`: `registro_id is not null and json_type(data, '$.evidence') is not null and ref_id is null and person_id is null and event_key = 'lookup:' || registro_id`
    (with the unique `event_key`, was `fiscal_lookup_conflicts_registro_uq`).
- `appendHistory(tx, entry, { ifAbsent: true })`: `insert … on conflict (event_key) do nothing`,
  returning `null` when nothing was written.
- Readers `observedConflicts(tx, registroIds)` and `lookupConflict(tx, registroId)` in `history.ts`.
- The writers and readers moved: `recordConflictEvidence` (`conflict-evidence.ts:134-164`, loses its
  `caseId` input), `retainLookupConflict` (`reconcile-conflicts.ts:6-21`), `readActiveConflicts`
  (`conflict-evidence.ts:35-87`), `checkOriginal` (`conflict-recovery.ts:75-96`), the call in
  `drain.ts:1914-1925`.
- Deleted: both tables, their schema files, classification and manifest entries, backup links
  (`backup-verification-history.ts:435-438`).

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

export function appendHistory(tx: Transaction, entry: HistoryEntry, options?: { ifAbsent?: boolean }): Promise<{ id: string; seq: number } | null>;
export interface ObservedConflictRow { id: string; registroId: string; attempt: number; cause: ConflictCause; evidence: ConflictEvidence; recordedAt: Date }
export interface LookupConflictRow { id: string; registroId: string; evidence: LookupConflictEvidence; recordedAt: Date }
export function lookupConflict(tx: Transaction, registroId: string): Promise<LookupConflictRow | null>;
```

`nodeId` for both kinds is the record's node, read from `verifactu_records` by the writer (the old
tables had no node column; the history's `node_id` is not null).

## Files

**Modify**
- `packages/fiscal-verifactu/src/history.ts`, `src/schema/verifactu-history.ts` (two CHECKs, the kind
  list), `src/schema/verifactu-history.test.ts`, `src/history.test.ts`.
- `packages/fiscal-verifactu/src/conflict-evidence.ts:1-164`, `reconcile-conflicts.ts`,
  `conflict-recovery.ts:27`, `:75-96`, `drain.ts:1914-1925`.
- `packages/fiscal-verifactu/src/schema/index.ts`, `classification.ts:9-10`, the manifest's fiscal
  entry, `backup-verification-history.ts:435-438`.
- `scripts/append-only-triggers.test.ts`, `scripts/schema-constraints.test.ts`.
- Tests that seed or read the two tables: `backup-lookup-conflicts.test.ts`,
  `reconcile.conflicts.test.ts`, `conflict-issuance.test.ts`, `conflict-recovery.test.ts`,
  `drain.conflict-recovery.test.ts`, `backup-verification-history.test.ts`,
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
| Code: two CHECKs and the kind list 25, `history.ts` additions 60, `readActiveConflicts` 40, writers 25, recovery check 15, lists 6, type moves 10 | ~180 |
| Tests: CHECK cases 90, writer/reader cases 50, plan case 20, re-pointed conflict set-ups 90 | ~250 |
| **Total** | **~430** |

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/schema/verifactu-history.test.ts src/history.test.ts src/conflict-issuance.test.ts src/conflict-recovery.test.ts src/conflict-recovery-routes.test.ts src/conflict-recovery-contract.test.ts src/drain.conflict-recovery.test.ts src/reconcile.conflicts.test.ts src/reconcile.scope.test.ts src/backup-lookup-conflicts.test.ts src/backup-series-conflicts.test.ts src/backup-verification-history.test.ts src/drain.test.ts src/drain.probe.test.ts src/dashboard/conflict-recovery.test.ts
# and fi1's record suites
pnpm --filter @waitron/server exec vitest run src/live-conflict-recovery.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts
git grep -nw "fiscal_conflict_evidence\|fiscal_lookup_conflicts\|fiscalConflictEvidence\|fiscalLookupConflicts" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'
```

The grep prints nothing.

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue`. Under `phase=sql-only` (missing
lines simulated on 2026-11-08 from `a086eedfb7` with fi1–fi4b applied; the rest from this plan):

```text
missing index fiscal_conflict_evidence.primary key(id)
missing index fiscal_conflict_evidence_attempt_uq
missing index fiscal_lookup_conflicts.primary key(id)
missing index fiscal_lookup_conflicts_registro_uq
missing table fiscal_conflict_evidence
missing table fiscal_lookup_conflicts
changed table verifactu_history.checks[verifactu_history_kind_ck].expression
old: <fi4a's kind list>
new: <the four-kind list above>
extra table verifactu_history.checks[verifactu_history_lookup_ck]
extra table verifactu_history.checks[verifactu_history_observed_ck]
```

Under `phase=migrated` and `phase=change-feed`, the same plus

```text
missing trigger fiscal_conflict_evidence_append_only_delete
missing trigger fiscal_conflict_evidence_append_only_update
missing trigger fiscal_lookup_conflicts_append_only_delete
missing trigger fiscal_lookup_conflicts_append_only_update
```

The tool prints missing and changed lines by object name, then extras. Design reasons: tables-fiscal
§5, the `fiscal_lookup_conflicts` and `fiscal_conflict_evidence` rows ("the append-only pair; the
unique `event_key` … the FK to records. The case FK goes with `case_id`").

## Stop points (beyond rules §5)

1. **A CHECK does not fire** (§8 item 4). Fallback as fi4a stop 1 (the field becomes a typed column),
   confirmed by the watcher.
2. `readActiveConflicts` returns a different list, order, cause, time or evidence for any existing
   fixture.
3. `readActiveConflicts`' plan contains `SCAN verifactu_history`.
4. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, or to which identity
   or series a sale uses: a fi1 record suite fails.

## Needs

fi4b (and so fi4a).

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: the two kinds' CHECKs, measured first (§8 item 4)

- [ ] **Step 1: Failing cases** in `verifactu-history.test.ts`, as fi4a Task 1 for each condition of
  the two new CHECKs (wrong value, missing field, a column set the wrong way, a wrong `event_key`),
  plus: two `conflict.observed` rows for one record, attempt and cause refused on `event_key`; the
  same record with attempt 2 accepted; a second `conflict.lookup` for one record refused; an
  `attempt` of `"1"` (text) refused.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Add the CHECKs and the kind list; rebuild the set.
- [ ] **Step 4:** Run. **Passing:** every refusal refused. A stored refusal case is stop 1. Commit:
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
  aliases. The join to `filing_cases` stays (fi6). `checkOriginal` reads `lookupConflict`.
- [ ] **Step 4:** Add a plan case: `readActiveConflicts`' statement uses
  `verifactu_history_registro_kind_seq_idx` for both aliases and contains no
  `SCAN verifactu_history`.
- [ ] **Step 5:** Run the Finish line's fiscal-verifactu and server lines. PASS. Commit: "AEAT
  conflicts are read from and written to the fiscal history (A1308 fiscal 5)".

### Task 3: delete the two tables; protection list; finish

- [ ] **Step 1:** Delete the schema files (move the exported types to `conflict-types.ts` first),
  exports, classification and manifest entries, guard entries and the four backup links. Remove both
  from `ADDED_TABLES` in the demo test and add `verifactu_history`'s new kinds nowhere (the seed
  writes none). Rebuild the set. Run the Finish line. PASS.
- [ ] **Step 2:** Protection list against `<A>`: exactly "Expected protection-list difference".
- [ ] **Step 3: Documents:** tables-fiscal.md §8 item 4, a dated line for these two kinds;
  `docs/developers/conventions-data.md`, any sentence naming the two tables. No backlog entry names
  them (searched `docs/backlog/` at `a086eedfb7`).
- [ ] **Step 4:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset`.
