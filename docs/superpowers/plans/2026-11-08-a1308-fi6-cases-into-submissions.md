# A1308 fiscal 6: a filing case is part of its record's submission row — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-11-10 (watcher decision, from the owner's "make these tests periodic rather than
> automatic"):** this slice no longer builds or times a bench venue inside its own steps, and the
> stop points that read a `bench compare` result no longer apply. Instead its pull request says
> `Sale-path read changed:` and names the measurement this plan's bench steps describe, for the next
> periodic run to report. Where the slice's own correctness turns on how SQLite plans a query (an
> index choice), check that plan with `EXPLAIN QUERY PLAN` on the box image's SQLite (CLAUDE.md §4).
> See [when the bench runs](../../developers/testing-guide.md#when-the-bench-runs).

**Goal:** Fold `filing_cases` (at most one problem case per record) and the one resolution a case can
take (`filing_case_events` of kind `resolved`) into set-once columns of `verifactu_submissions`; move
case notes into `verifactu_history` as kind `case.note`; hold the folded columns with a guard trigger;
and settle the A805 follow-up for `envios` (now `verifactu_submissions`): a submission row is never
deleted. Measure first that the every-sale conflict check does not start scanning.

**Architecture:** `verifactu_submissions` already has exactly one row per record, written in the
record's own transaction (`backend.ts:347`, `:487`, `:578`, `:706`; `record-remedy.ts:195`,
`record-remedy-absent.ts:157`; every record is appended by the one insert at `chain.ts:264`), so "one case per record" (`filing_cases_registro_uq`) and "one
resolution per case" (`filing_case_events_one_resolution_uq`) become the shape of that row. Opening a
case sets three columns that were empty; resolving sets four more. A trigger refuses any later change
to them, and any delete of the row. The case's own id goes; everything that named it names the record instead
(the case is on the record whose submission row holds it). A partial index on `case_opened_at` keeps
the sale-path conflict check reading only the rows that have a case.

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest; slice 0's bench and fi2's
`bench grow-fiscal`.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §0 table rows (2),
§1.1 `verifactu_submissions` (columns, protections, "The case's own id goes", "Weaker in one way"),
§3 (`case.note`), §4 (`filing_cases`, `filing_case_events`), §5 (their rows), §8 items 2 and 5
(`verifactu_submissions` half); README "Additions of 6 November 2026" (`envios`: settle the delete
refusal); rules [2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md). Other designs:
A1089's filing-case decision route ([backlog](../../backlog.md), "A1089: fiscal filing-case alerts
need a real decision route") is not built; whatever of it lands first is folded here (Needs).

**Base:** `main` after fi5. Line numbers read at `9c66ef0356` (which includes #2570, `df7fc95182`);
fi1–fi5 move some of them, and a cite that has only moved and still says the same is not a stop
(rules §5.1).

**Owner lands:** yes (AEAT sending state, and the conflict check on every sale).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply; fi4a's CHECK rule applies to the `case.note` CHECK.
- **Filing decides exactly as today.** Which records are held, probed, retried or set aside, which
  cases open, with what cause and evidence, which conflicts are active: the drain, reconcile, remedy
  and conflict suites keep every assertion.
- Every remedy route stays disabled in production (`record-remedy-routes.ts:20`, an empty set); this
  plan changes their request shape, not whether they run.
- Measurement before code (Task 1).

## Review Focus

1. **The guard refusing a legitimate write** (tables-fiscal §8 item 5). Every writer of the
   submission row runs under the trigger in the drain, reconcile and remedy suites.
2. **The conflict check's plan** (§8 item 2): it now starts from a table with one row per record.
3. **A key reused across a note and a resolution.** One unique index covered both before; now the
   database checks each in its own place, and `recordCaseEvent` checks both (tables-fiscal §1.1
   "Weaker in one way").
4. **Event order in `listFilingCases`** (below).

---

## What it builds

**Columns on `verifactu_submissions`** (all nullable; names from tables-fiscal §1.1):

| Column | Builder | From |
| --- | --- | --- |
| `case_cause` | `label`, typed `FilingCaseCause` | `filing_cases.cause` |
| `case_evidence` | `json<FilingCaseEvidence>` | `filing_cases.evidence` |
| `case_opened_at` | `ts` | `filing_cases.opened_at` |
| `case_resolved_at` | `ts` | the resolution's `recorded_at` |
| `case_resolved_by` | `id`, → `persons`, `onDelete("restrict")` | the resolution's `person_id` |
| `case_resolution_action` | `label` | the resolution's `action` |
| `case_resolution_key` | `label` | the resolution's `action_key` |
| `case_remedy_registro_id` | `id`, → `verifactu_records` | the resolution's `remedy_registro_id` |

- `verifactu_submissions_case_ck`: `(case_cause is null) = (case_evidence is null) and (case_cause is null) = (case_opened_at is null) and (case_cause is null or case_cause <> '')`
  (was `filing_cases_cause_ck`, plus "the three case columns are all null or all set").
- `verifactu_submissions_resolution_ck`: `(case_resolved_at is null) = (case_resolved_by is null) and (case_resolved_at is null) = (case_resolution_action is null) and (case_resolved_at is null) = (case_resolution_key is null) and (case_resolved_at is null or case_opened_at is not null) and (case_remedy_registro_id is null or (case_resolved_at is not null and case_remedy_registro_id <> registro_id))`.
- Unique `verifactu_submissions_resolution_key_uq (case_resolution_key)`.
- Partial index `verifactu_submissions_case_idx (case_opened_at) where case_opened_at is not null`.
- `packages/fiscal-verifactu/triggers/fiscal-verifactu.sql` (created by fi4a for its one history
  trigger, owner 2026-11-09; this plan appends to it; slice 1a's command appends a set's
  `<package>/triggers/<set>.sql`, [1a](2026-11-08-a1308-1a-baseline-rebuild.md):60), two statements:

  ```sql
  CREATE TRIGGER verifactu_submissions_guard_update BEFORE UPDATE ON verifactu_submissions
  WHEN new.registro_id IS NOT old.registro_id
    OR (old.case_opened_at IS NOT NULL AND (new.case_cause IS NOT old.case_cause
        OR new.case_evidence IS NOT old.case_evidence OR new.case_opened_at IS NOT old.case_opened_at))
    OR (old.case_resolved_at IS NOT NULL AND (new.case_resolved_at IS NOT old.case_resolved_at
        OR new.case_resolved_by IS NOT old.case_resolved_by
        OR new.case_resolution_action IS NOT old.case_resolution_action
        OR new.case_resolution_key IS NOT old.case_resolution_key
        OR new.case_remedy_registro_id IS NOT old.case_remedy_registro_id))
  BEGIN SELECT RAISE(ABORT, 'verifactu_submissions: a filing case and its resolution are set once'); END
  --> statement-breakpoint
  CREATE TRIGGER verifactu_submissions_no_delete BEFORE DELETE ON verifactu_submissions
  BEGIN SELECT RAISE(ABORT, 'verifactu_submissions: a submission row is never deleted'); END
  ```

  The refusal texts are constants in `packages/fiscal-verifactu/src/trigger-refusals.ts` (created by fi4a),
  imported by `scripts/behavioural-triggers.test.ts` like core's (`:9-29`), each with a comment
  saying why: the case and its resolution are evidence of what a person did about a filing; the row
  is the record's outbox, and deleting it silently drops a legal filing (the A805 decision for
  `envios`).
- **`case.note`** in `verifactu_history`: `at` = the note's time; `registro_id` = the case's record;
  `person_id`; `event_key` = `'case.note:' || <the note's action key>`; `data`: `action`.
  `verifactu_history_note_ck`: `registro_id is not null and person_id is not null and substr(event_key, 1, 10) = 'case.note:' and length(event_key) > 10 and json_type(data, '$.action') = 'text' and ref_id is null`.
  `verifactu_history_kind_ck` gains `'case.note'`.
  **Why the prefix** (departs from tables-fiscal §3's `event_key` row, "a note's `action_key`"): the
  action key is chosen by the caller (`record-remedy-http.ts:43` reads it from the request body),
  and `verifactu_history.event_key` is one unique column shared with fi5's `lookup:<registro>` and
  `conflict:<registro>:<attempt>:<cause>` keys and fi4a's `clock.confirmed:<check>`. fi5 writes a lookup
  conflict with "insert or do nothing on `event_key`" (fi5 plan, `appendHistory(…, { ifAbsent: true })`;
  today `reconcile-conflicts.ts:18-21`'s `onConflictDoNothing` on the record), so a note stored under
  the bare key `lookup:R` would make the later lookup conflict for record `R` vanish without an
  error, and `readActiveConflicts` would not see it. With the prefix a note's key cannot equal
  another kind's key, because fi4a's and fi5's CHECKs tie each of their keys to its own prefix. The
  key the API takes and returns stays the bare action key; the prefix is added on write and
  stripped on read, in `filing-cases.ts` only.
- The case API re-pointed (Interfaces): `openFilingCase`, `openAcceptedWithErrorsCase`,
  `recordCaseEvent`, `listFilingCases`, `openFilingCasesSummary`, `heldRecords`
  (`filing-cases.ts:51-304`); `readActiveConflicts` joins the submission row
  (`conflict-evidence.ts:36`, the case join at `:60`); `checkOriginal` (`conflict-recovery.ts:79`);
  `releaseBrakeHold` (`drain.ts:1031-1056`); `openCase` and `setAside` (`drain.ts:1623-1640`,
  `:926-949`; `openCase`'s caller passes `opened.id` on at `:1914`); the five remedy writers;
  `ConflictRef` loses `caseId` (`conflict-types.ts:35-39`, and the `caseId?: never` at `:45`), with
  `conflictReference`, `conflictSourceId` (`conflict-reference.ts:6`, `:12`), `validRef` and the
  active-row check (`conflict-recovery-contract.ts:131-132`, `:290-302`) and the dashboard client.
- **Raw SQL that names `filing_cases`**, re-pointed to the submission row's `case_opened_at`
  (found by the first command under Files → "How the lists were made"):
  - `drain.ts:1004` (`HELD_HEADS`): `not exists (select 1 from filing_cases own where own.registro_id = d.id)`
    becomes `de.case_opened_at is null` (`de` is `d`'s own submission row, `:989`).
  - `drain.ts:1043` (`releaseBrakeHold`): `join filing_cases c on c.registro_id = (…preceding…)` and
    `c.id = ${caseId}` become `join verifactu_submissions c on c.registro_id = (…)` and
    `c.registro_id = ${caseRegistroId} and c.case_opened_at is not null`.
  - `drain.ts:1173` (`releasableHeads`' stop): `join filing_cases stop_case on stop_case.registro_id = stop.id`
    becomes `and stop_envio.case_opened_at is not null` on the submission row already joined at `:1172`.
  - `submission-alerts.ts:112`, `:125`, `:130-131`, `:134` (the repeated-refusals alert): the same
    four shapes, each read from the submission row (`case_opened_at is null` / `is not null`, and
    `stop_case.opened_at` becomes the preceding row's `case_opened_at`).
  - `filing-cases.ts:260`, `:269` (`heldRecords`), as Task 3 says.
- Deleted: `filing_cases`, `filing_case_events`, their schema file, classification and manifest
  entries, backup links (`backup-verification-history.ts:432-434`).
- Measured: tables-fiscal §8 item 2, and item 5 for `verifactu_submissions`.

**Decisions this plan makes** (confirmed by the owner, 2026-11-09):

- *A remedy request names the case by its record:* the body field `caseId` becomes
  `caseRegistroId` (`record-remedy-http.ts:37-41`, `record-remedy-corrective-http.ts:79-87` and the
  three parsers in `record-remedy-held.ts:22`, `-brake.ts:21`, `-absent.ts:30`). It is the record
  whose submission row holds the case; for a held follower it differs from the request's
  `registroId`, as `caseId`'s case did. Error params `filing_case.*` `{ caseId }` become
  `{ caseRegistroId }` (`errors.ts:286-302`; no screen words them: `git grep` finds no `filing_case.`
  in `apps/*/src`).
- *A resolution has no row id.* `recordCaseEvent` returns `{ kind, actionKey, … }`; the remedy
  results' `eventId` becomes `actionKey` (the key the request supplied).
- *`listFilingCases`' event order:* notes by `seq`, with the resolution placed before the first note
  whose `at` is later than `case_resolved_at` (ties: the resolution first). Today's order is write
  order (`rowid`, `filing-cases.ts:181-193`); with two stores, write order between a note and the
  resolution is not recorded. The order is for display only: no code decides from it. Its only
  callers are tests (`git grep -n listFilingCases`).
- *`HeldRecord.caseId` becomes `caseRegistroId`.*

## Assertions that change, by design

Rules §4: each is a deleted case or a renamed field, with the design section that changes it. No
other assertion changes.

| Test | Change | Design reason |
| --- | --- | --- |
| `record-remedy-corrective.test.ts:472` "refuses a missing delivery" | **Deleted.** It deletes the target's submission row and expects `fiscal.remedy_invalid`. After this slice the row cannot be deleted (`verifactu_submissions_no_delete`), and the state it tests cannot exist either: the case now lives on that same row, so "a case but no submission row" is not representable. The product read it exercised, the separate `delivery` select at `record-remedy-corrective.ts:99-102` and its `delivery?.` checks at `:121-123`, merges into the one read of the case's row (Task 3), so no branch is left without a test. "refuses a missing case" (`:468`) still covers a request naming a record with no case. | README "Additions of 6 November 2026" (`envios`: settle the delete refusal; this plan settles it as "never deleted"); tables-fiscal §1.1 (`verifactu_submissions`: the case columns on the record's own row). |
| `record-remedy-held.test.ts:486` "refuses a missing %s delivery" (`current` and `held`) | **Deleted, both rows of the `it.each`.** `held`: as above, the held record's case and its submission row become one row (`record-remedy-held.ts:65-66` become one read). `current`: the accepted record's submission row is inner-joined (`:67-71`); with the row undeletable, `accepted === undefined` (`:80`) is reached only by naming a record that does not exist, which "refuses a missing acceptedRegistroId row" (`:302`) already covers. | As above. |
| `reconcile.concurrent.test.ts:255` "defers records whose delivery rows disappeared during the lookup" | **Kept, assertions unchanged; set-up changes.** The branch it reaches, `latest === undefined` (`reconcile.ts:183`), stays reachable without a delete: `rowsForPeriod` leaves out a record that has a correction (`reconcile.ts:328-331`), so a correction recorded during the lookup makes the record absent from the re-read. No case records a correction during the lookup today (`git grep -n "during the lookup" packages/fiscal-verifactu/src` names only this case and `reconcile.unheld.test.ts`, which records none). The case keeps its delete, inside its own transaction, as: read the `verifactu_submissions_no_delete` text from `sqlite_master`, `drop trigger`, `delete from verifactu_submissions`, re-create the trigger from that text. The re-create is required: `useVenueDb` builds its reset plan once (`packages/db/src/testing/venue-db.ts:136-144`, called at `:212-215`) and its reset runs `drop trigger "<name>"` for every trigger the plan listed, which fails on a trigger the case left dropped. What the case then proves: the deferral for a row present at the network read and absent at the re-read, for any reason; it no longer claims the app can delete that row. | README "Additions of 6 November 2026". |
| Every case and fixture that reads `caseId`, `eventId` or a `filing_cases` id | Renamed only: `caseId` → `caseRegistroId`, `eventId` → `actionKey`, `ConflictRef` without `caseId`, `HeldRecord.caseRegistroId`. The PR lists each file. | tables-fiscal §1.1, "The case's own id goes". |

Test deletes that are set-up, not behaviour (no assertion changes; they go because the trigger
refuses them):

- `drain.test.ts:268`, `:358`, `:592`, `:1632`, `:1663`, `:1677`, `:1731`, `:1792`, `:1794`, `:1850`,
  `:1853` (11 statements, each in an `afterEach` or in a `finally` at the end of its case) and
  `migrations.test.ts:28` (an `afterEach`): **deleted.** Both suites use `useVenueDb` with the default
  `resetPerTest` (`venue-db.ts:196`; `drain.test.ts:34`, `migrations.test.ts:21`), whose reset after
  every case drops every trigger, then empties every table (`venue-db.ts:218-219`), so these
  statements empty a table the reset empties anyway. The `delete from envio_flujo` beside some of
  them stays.
- `apps/server/src/boot.test.ts:2658`, `:2704`, `:2946` and `apps/server/src/boot.promote.test.ts:228`:
  each sets the seeded rows `estado = 'aceptado'` instead of deleting them, which leaves nothing due
  (the comment at `boot.test.ts:2657` says why the rows matter).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `acks`, `aeat.answer_cleared` | fi7 |
| A decision route for filing-case alerts (A1089) | A1089, built on these columns |
| Enabling any remedy in production | The owner's later decision (`record-remedy-routes.ts:20`) |

## Interfaces

```ts
// packages/fiscal-verifactu/src/filing-cases.ts
export interface FilingCase { registroId: string; cause: FilingCaseCause; evidence: FilingCaseEvidence; openedAt: Date }
export interface FilingCaseResolution { registroId: string; actionKey: string; personId: string; action: string; remedyRegistroId: string | null; recordedAt: Date }
export type FilingCaseEvent =
  | ({ kind: "resolved" } & FilingCaseResolution)
  | { kind: "note"; id: string; registroId: string; actionKey: string; personId: string; action: string; remedyRegistroId: null; recordedAt: Date };
export interface FilingCaseReport extends FilingCase { estado: string; status: "open" | "resolved"; events: FilingCaseEvent[] }
export interface HeldRecord { registroId: string; caseRegistroId: string | null }

export function openFilingCase(tx: Transaction, input: { registroId: string; cause: FilingCaseCause; evidence: FilingCaseEvidence; now: Date }): Promise<FilingCase>;
export function recordCaseEvent(tx: Transaction, input: {
  caseRegistroId: string; actionKey: string; kind: "note" | "resolved"; personId: string; action: string;
  remedyRegistroId?: string | null; now: Date;
}): Promise<FilingCaseEvent>;
// listFilingCases, openFilingCasesSummary, heldRecords: same names and arguments as today.

// packages/fiscal-verifactu/src/conflict-types.ts
export interface ConflictRef { registroId: string; sifId: string }
```

`openFilingCase` updates the row `where registro_id = ? and case_opened_at is null` and, when that
changes nothing, returns the case already there (today's "returns the one it already has untouched",
`filing-cases.ts:50-69`); a record with no submission row throws (every record has one: the six
inserts above).

## Files

**Create**
- `packages/fiscal-verifactu/src/filing-case-plans.test.ts` (the conflict check's plan).

**Modify (fi4a created them)**
- `packages/fiscal-verifactu/triggers/fiscal-verifactu.sql`, `src/trigger-refusals.ts`: this plan's
  two triggers and their constants go after fi4a's history trigger.

**Modify (product)**
- `packages/fiscal-verifactu/src/schema/verifactu-submissions.ts` (columns, CHECKs, indexes),
  `src/schema/verifactu-history.ts` and its test (`case.note`), `src/history.ts`.
- `packages/fiscal-verifactu/src/filing-cases.ts`, `conflict-evidence.ts`, `conflict-recovery.ts`,
  `conflict-types.ts`, `conflict-reference.ts`, `conflict-recovery-contract.ts`,
  `dashboard/conflict-recovery.ts`, `dashboard/conflict-recovery-client.ts`, `drain.ts`,
  `submission-alerts.ts`, `reconcile-conflicts.ts`, `record-remedy.ts`, `record-remedy-held.ts`,
  `record-remedy-brake.ts`, `record-remedy-absent.ts`, `record-remedy-corrective.ts`,
  `record-remedy-http.ts`, `record-remedy-corrective-http.ts`, `errors.ts:286-302`,
  `schema/index.ts`, `classification.ts`, `backup-verification-history.ts:432-438`, the manifest's
  fiscal entry (`packages/migrations/migrations.manifest.json:68-69`).
- `packages/fiscal-verifactu/src/clock-step.ts:181`: cut "as `listFilingCases` orders" from the
  comment (it orders by `seq` after this slice; the rest of the comment stands).
- `apps/server/README.md:23`, `:691`: "the `filing_cases` table" becomes the submission row's case
  columns (the alert code `fiscal.filing_cases_open` keeps its name).
- `apps/server/scripts/bench/grow-fiscal.ts` (`--cases <n>`, Task 1).

**Modify (guards)**
- `scripts/behavioural-triggers.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/schema-constraints.test.ts`.

**Modify (tests and fixtures).** How the lists were made, at `9c66ef0356`, from the repository root
(re-run them on the base; a file they add is a fixture edit, not a stop, rules §5.5):

```bash
# 1. every reader or writer of the case tables (raw SQL and drizzle)
git grep -n -E "filing_cases|filing_case_events|filingCases|filingCaseEvents" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'
# 2. every user of the case id
git grep -n -w caseId -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'
# 3. every delete of a submission row (the table is `envios` until fi1 renames it)
git grep -n -E "delete from envios|\.delete\(envios\)" -- apps packages scripts ':!**/drizzle/**'
```

At `9c66ef0356` command 1 named 99 lines in test files, command 2 named 150 lines in test files
(and 87 in product files), and command 3 named 19 statements (15 in `packages/fiscal-verifactu`, 4
in `apps/server`). The files, and how each changes:

- Deletes (command 3): "Assertions that change, by design" says what happens to every one of the 19.
- `packages/fiscal-verifactu/src/`: `filing-cases.test.ts` (the case API's own suite: set-up through
  the new API; the event-order cases read the decided order), `backup-verification-history.test.ts`
  and `backup-verification.test.ts:424` (the case links become the two new submission-row links; the
  raw `insert into filing_cases` becomes an update of the submission row's case columns),
  `conflict-issuance.test.ts`, `conflict-lookup-contract.test.ts`, `conflict-recovery.test.ts`,
  `conflict-recovery-contract.test.ts`, `conflict-recovery-routes.test.ts`,
  `dashboard/conflict-recovery.test.ts`, `drain.cases.test.ts`, `drain.conflict-recovery.test.ts`,
  `drain.outage.restart.test.ts`, `drain.probe.test.ts`, `drain.record-versions.test.ts`,
  `reconcile.test.ts`, `reconcile.completeness.test.ts`, `reconcile.conflicts.test.ts`,
  `reconcile.scope.test.ts`, `reconcile.unheld.test.ts`, `record-remedy.test.ts`,
  `record-remedy-absent.test.ts`, `record-remedy-brake.test.ts`,
  `record-remedy-corrective.test.ts`, `record-remedy-corrective-http.test.ts`,
  `record-remedy-facts.test.ts`, `record-remedy-held.test.ts`, `record-remedy-http.test.ts`,
  `submission-alerts.cases.test.ts`: reads of `filing_cases` become reads of the submission row's
  case columns; `caseId: opened.id` becomes `caseRegistroId: <the record id>`.
  `schema-ownership.test.ts:18-19` drops the two table names; `schema/schema-conformance.test.ts:15`
  is a comment naming `filing_case_events.kind`: cut that clause.
- `packages/fiscal-verifactu/test/live-conflict-fixture.ts:107`, `test/conflict-browser-fixture.ts:7`,
  `test/drain-fixtures.ts`: the returned or literal `caseId` goes.
- `apps/server/src/`: `conflict-payment-recovery.test.ts:159`, `:169`, `:268`,
  `live-conflict-recovery.test.ts:226`, `:239`, `:475`, `:504` (their "cases unchanged" snapshots read
  the submission rows' case columns instead of `select * from filing_cases`),
  `till-sale-integrated.db.test.ts:625`, `zone-preservation.test.ts:323`, `:334` (the `caseId` they
  build or match by goes: `ConflictRef` is `{ registroId, sifId }`),
  `fiscal-remedy.staff-refund.test.ts` (12 `caseId` lines, renamed).
- Retained-row cases that insert a raw `filing_cases` row to make a database non-empty:
  `apps/server/src/first-fiscal-hour-finish.test.ts:380`, `apps/server/src/first-setup-unused-pdf.test.ts:253`,
  `packages/provisioning/src/first-setup-empty-database.test.ts:72`. Each keeps its case name and
  assertion; its insert becomes a `verifactu_history` row of kind `case.note`.

**Delete**
- `packages/fiscal-verifactu/src/schema/filing-cases.ts` (its two exported types move to
  `filing-cases.ts`).

**Generated:** `packages/fiscal-verifactu/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: schema 45, trigger file 20, refusals 10, `case.note` kind and key prefix 25, `filing-cases.ts` 140, conflict read and recovery 40, contract, reference, dashboard 30, drain (three raw queries, `releaseBrakeHold`, `openCase`, `setAside`) 45, `submission-alerts.ts` 15, remedy writers, parsers and the merged reads 50, errors 8, lists 6, bench flag 20, comment and README 6 | ~460 |
| Tests: trigger cases 110, CHECK cases (with the note key's prefix) 55, plan test 45, re-pointed tests 290 (the 150 `caseId` lines and 99 case-table lines the commands under Files name, most changed in place, plus `filing-cases.test.ts`' restructure), boot cleanups 8, the reconcile case's trigger drop 10, retained-row inserts 6 | ~525 |
| **Total** | **~985** |

Not counted (rules §1): the 12 deleted set-up statements and the two deleted cases. The total is at
the cap. If the re-pointed tests run past ~350 lines, split at Task 3: fi6a lands Tasks 0–2
(columns, guard, note kind, the A805 delete refusal and its test deletes) with its own protection
list; fi6b lands Tasks 3–5. Stop 6 (rules §5.6) applies past ~1,200.

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/filing-case-plans.test.ts src/filing-cases.test.ts src/submission-alerts.test.ts src/submission-alerts.cases.test.ts src/conflict-issuance.test.ts src/conflict-lookup-contract.test.ts src/conflict-recovery.test.ts src/conflict-recovery-routes.test.ts src/conflict-recovery-contract.test.ts src/dashboard/conflict-recovery.test.ts src/record-remedy src/reconcile src/backup-verification-history.test.ts src/backup-verification.test.ts src/schema-ownership.test.ts src/schema/schema-conformance.test.ts src/schema/verifactu-history.test.ts src/migrations.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain   # every drain file (§8 item 5), drain.test.ts included
# and fi1's record suites
pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/boot.promote.test.ts src/live-conflict-recovery.test.ts src/fiscal-remedy.staff-refund.test.ts src/conflict-payment-recovery.test.ts src/till-sale-integrated.db.test.ts src/zone-preservation.test.ts src/first-fiscal-hour-finish.test.ts src/first-setup-unused-pdf.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/first-setup-empty-database.test.ts
pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/two-file-foreign-keys.test.ts
git grep -nw "filing_cases\|filing_case_events\|filingCases\|filingCaseEvents\|caseId" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
git grep -n -E "delete from (envios|verifactu_submissions)|\.delete\((envios|verifactuSubmissions)\)" -- apps packages scripts ':!**/drizzle/**'
```

The first grep prints nothing (`-w` does not match inside the alert code `fiscal.filing_cases_open`).
The second prints only the `delete from verifactu_submissions` inside
`reconcile.concurrent.test.ts`' trigger-dropping transaction.

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue`. Missing lines simulated on
2026-11-08 (`a086eedfb7` with fi1–fi5 applied); the rest from this plan. Under `phase=sql-only`:

```text
missing index filing_case_events.primary key(id)
missing index filing_case_events_action_key_uq
missing index filing_case_events_case_idx
missing index filing_case_events_one_resolution_uq
missing index filing_cases.primary key(id)
missing index filing_cases_registro_uq
missing table filing_case_events
missing table filing_cases
changed table verifactu_history.checks[verifactu_history_kind_ck].expression
old: <fi5's four kinds>
new: <the five kinds, with 'case.note'>
changed table verifactu_submissions.columnOrder
old: [<today's twelve columns>]
new: [<the twelve, then case_cause, case_evidence, case_opened_at, case_resolved_at, case_resolved_by, case_resolution_action, case_resolution_key, case_remedy_registro_id>]
extra table verifactu_history.checks[verifactu_history_note_ck]
extra table verifactu_submissions.columns[case_cause]
extra table verifactu_submissions.columns[case_evidence]
extra table verifactu_submissions.columns[case_opened_at]
extra table verifactu_submissions.columns[case_remedy_registro_id]
extra table verifactu_submissions.columns[case_resolution_action]
extra table verifactu_submissions.columns[case_resolution_key]
extra table verifactu_submissions.columns[case_resolved_at]
extra table verifactu_submissions.columns[case_resolved_by]
extra table verifactu_submissions.foreignKeys[case_remedy_registro_id->verifactu_records(id)]
extra table verifactu_submissions.foreignKeys[case_resolved_by->persons(id)]
extra table verifactu_submissions.checks[verifactu_submissions_case_ck]
extra table verifactu_submissions.checks[verifactu_submissions_resolution_ck]
extra index verifactu_submissions_case_idx
extra index verifactu_submissions_resolution_key_uq
extra trigger verifactu_submissions_guard_update
extra trigger verifactu_submissions_no_delete
```

Under `phase=migrated` and `phase=change-feed` the same, plus among the missing
`missing trigger filing_case_events_append_only_delete`, `…_update`,
`missing trigger filing_cases_append_only_delete`, `…_update`. The order within the extras follows
the tool (table sub-paths in field order, then new objects by name); the builder marks each line,
not its position. If the columns are declared in another order, the `columnOrder` line's `new:` shows
it; the order above is the plan's. Design reasons: tables-fiscal §5, the `filing_cases` and
`filing_case_events` rows; §1.1 "New partial index" and "New guard trigger"; README "Additions of 6
November 2026" for `verifactu_submissions_no_delete`.

## Stop points (beyond rules §5)

1. **The conflict check scans** (§8 item 2): at Task 1 or in the plan test, the plan for the
   submission rows is `SCAN s` without `USING INDEX verifactu_submissions_case_idx`, or the query
   starts from `verifactu_records` with a `SCAN`. Fallback, confirmed by the watcher: cases stay a
   table of their own (`filing_cases` and its resolution as today, under the `verifactu_` naming
   rule); notes still go to the history.
2. **A writer legitimately changes a column the guard holds** (§8 item 5). This can first happen at
   Task 3 Step 4's run: until Task 3 nothing writes the case columns, so Task 2 Step 5 tests only
   the `registro_id` half of the guard and the delete refusal. Fallback, confirmed by the watcher: that column comes off the guarded list, with the reason in the refusal constant's comment.
3. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, to which records are
   held, probed or set aside, or to which identity or series a sale uses.
4. A test asserting an event order in `listFilingCases` disagrees with the decided order.
5. A1089 landed code that reads `filing_cases` and is not in this plan's file list (rules §5.5).

## Needs

fi5. fi2's `bench grow-fiscal`. Any part of A1089's filing-case route that has landed (U11: "A1089
… land before the slice that touches their tables, or are re-planned onto the new shape"); its files
are added to Files before Task 2.

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: measure the conflict check before writing it (§8 item 2)

- [ ] **Step 1:** Add `--cases <n>` to `bench grow-fiscal`: open a case (today's `openFilingCase`) on
  `n` grown records spread evenly through the chain, cause `fiscal.registro_rechazado`. One case in
  `grow-fiscal.test.ts`.
- [ ] **Step 2:** On a copy-on-write copy of a base-built venue grown to 500,000 records with
  `--cases 200` (fi2 Task 1 Step 4, on this base), add the proposed columns **to the copy only**,
  with `node:sqlite`, fill them from `filing_cases`, print the plan, then create the index and print
  it again:

  ```bash
  node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);
  for (const c of ["case_cause text","case_evidence text","case_opened_at text"]) db.exec("alter table verifactu_submissions add column "+c);
  db.exec("update verifactu_submissions set case_cause=(select cause from filing_cases c where c.registro_id=verifactu_submissions.registro_id), case_evidence=(select evidence from filing_cases c where c.registro_id=verifactu_submissions.registro_id), case_opened_at=(select opened_at from filing_cases c where c.registro_id=verifactu_submissions.registro_id)");
  const node=db.prepare("select node_id from verifactu_identities where revocado_en is null").get().node_id;
  const plan=()=>db.prepare(`explain query plan select r.id from verifactu_submissions s join verifactu_records r on r.id = s.registro_id join verifactu_identities i on i.id = r.sif_id and i.node_id = r.node_id left join verifactu_history o on o.registro_id = r.id and o.kind = 'conflict.observed' left join verifactu_history l on l.registro_id = r.id and l.kind = 'conflict.lookup' where s.case_opened_at is not null and i.node_id = ? and i.revocado_en is null and (o.id is not null or l.id is not null or s.case_cause in ('fiscal.huella_divergente','fiscal.duplicado_anulado')) order by r.secuencia`).all(node).map(r=>r.detail);
  console.log("before index", plan());
  db.exec("create index verifactu_submissions_case_idx on verifactu_submissions(case_opened_at) where case_opened_at is not null");
  console.log("after index", plan());' <copy>/venue.db
  ```

  **Control (the "before index" line):** expected to show the failing shape: `SCAN s` with no
  `USING INDEX` (all 500,000 submission rows read), or the query starting from another table with
  a `SCAN`. If the "before" plan already reads no table whole, the "after" line cannot show what the
  index changes: stop and report both plans.
  **Passing (the "after index" line):** the line for `s` uses `verifactu_submissions_case_idx` (`SCAN s USING INDEX …` reads
  only the indexed rows and is a pass), `r` is `SEARCH r USING INDEX sqlite_autoindex_verifactu_records_1 (id=?)`
  or the primary key, and neither history alias scans. If the planner starts elsewhere, retry with
  `from verifactu_submissions s cross join verifactu_records r …` (SQLite keeps a `CROSS JOIN`'s
  order) and use that form in Task 3. **Failing:** no passing plan with either form. Stop 1.

### Task 2: columns, CHECKs, guard and the note kind (test first; §8 item 5)

- [ ] **Step 1: Failing cases.** In `scripts/behavioural-triggers.test.ts`: changing `registro_id`;
  changing any case column once `case_opened_at` is set; changing any resolution column once
  `case_resolved_at` is set; deleting a row — each refused with its constant. Accepting controls:
  every drain-style update of `estado`, `intentos`, `proximo_intento_en`, `csv`, `codigo_error`,
  `mensaje_error`, `enviado_en`, `confirmado_en`, `incidencia`, `technical_incidence`,
  `reconciled_resubmit_at`; opening a case on a row without one; resolving an open case. In the
  fiscal package's schema tests: each half of the two CHECKs refused (case columns half set; a blank
  cause; a resolution without a case; a remedy naming the row's own record; a remedy without a
  resolution); a duplicate resolution key refused; a `case_resolved_by` with no person refused. In
  `verifactu-history.test.ts`: `verifactu_history_note_ck` as fi4a Task 1, plus a `case.note` whose
  `event_key` lacks the `case.note:` prefix, or is the bare prefix, refused; and a lookup-conflict
  row for record `R` still written after a note with action key `lookup:R` (the collision the prefix
  prevents).
- [ ] **Step 2:** Run them. FAIL.
- [ ] **Step 3:** Add the columns, CHECKs, indexes, the trigger file, the constants and the kind.
  Rebuild the set. Run; PASS.
- [ ] **Step 4: The test deletes the trigger refuses** (Files, command 3; "Assertions that change,
  by design"): delete the 11 `drain.test.ts` statements and `migrations.test.ts:28`; delete the
  corrective "refuses a missing delivery" case and the held "refuses a missing %s delivery"
  `it.each`; wrap `reconcile.concurrent.test.ts:260`'s delete in the trigger drop and re-create;
  change the four `apps/server` boot cleanups to set the rows `aceptado`.
- [ ] **Step 5: The guard under every writer of today's columns.** Run
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain src/reconcile src/record-remedy src/migrations.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/boot.promote.test.ts`, with
  the code still writing `filing_cases`. This shows only that no writer changes `registro_id` or
  deletes a row; nothing writes the case columns until Task 3, where stop 2 applies.
  **Passing:** every file passes. **Failing:** a refusal from `verifactu_submissions_guard_update` or
  `verifactu_submissions_no_delete` raised by product code (rules §5.5); one raised by a test
  delete the commands did not find is a fixture edit.
- [ ] **Step 6:** Commit: "Set-once case columns and a guard on the submission row (A1308 fiscal 6)".

### Task 3: the case API on the submission row

- [ ] **Step 1:** Re-point the case, remedy, conflict and drain tests' set-up and reads to the
  Interfaces (assertions unchanged except the decided renames: `caseId` → `caseRegistroId`,
  `eventId` → `actionKey`, `ConflictRef` without `caseId`; list each in the pull request). Run: FAIL.
- [ ] **Step 2:** Implement:
  - `openFilingCase`/`openAcceptedWithErrorsCase` as Interfaces.
  - `recordCaseEvent`: the case is `case_opened_at is not null` on `caseRegistroId`'s row
    (`filing_case.not_found` otherwise). Replay: look up `actionKey` among the row's resolution key
    and among `case.note` history rows' `event_key`; same content returns the stored event,
    different content `filing_case.action_mismatch`; a key used in the other place for this or any
    other case is also `action_mismatch` (the cross-place check). A resolution sets the four columns
    with `where registro_id = ? and case_resolved_at is null` (none changed: `filing_case.already_resolved`).
    A note is `appendHistory({ kind: "case.note", … })`, stored under `'case.note:' || actionKey`;
    every read strips the prefix.
  - `listFilingCases`, `openFilingCasesSummary` read rows `where case_opened_at is not null`
    (summary: `count(*)`, `min(case_opened_at)` where `case_resolved_at is null`); notes from the
    history by `seq`; event order as decided.
  - `heldRecords` (`filing-cases.ts:244-304`): `c.id` (`:257`, `:269`) becomes
    `case when e.case_opened_at is not null then e.registro_id end`; the preceding-case subquery
    (`:259-262`) reads `preceding_envio.case_opened_at` the same way.
  - `readActiveConflicts`: Task 1's form; `checkOriginal` reads the row's `case_opened_at`;
    `releaseBrakeHold(tx, registroId, caseRegistroId, …)` joins `verifactu_submissions c` with
    `c.registro_id = ${caseRegistroId} and c.case_cause = 'fiscal.registro_rechazado'`.
  - The raw SQL in `drain.ts` and `submission-alerts.ts` as What it builds lists.
  - `record-remedy-corrective.ts:95-102` and `record-remedy-held.ts:65-66`: the separate case read
    and submission-row read become one read of the case's row (`caseRegistroId`, which must equal
    `registroId`, as `filingCase.registroId !== registroId` requires today); the checks that used
    `delivery?.` read that row.
  - The remedy writers and parsers, the contract, the reference and the dashboard client as decided.
- [ ] **Step 3:** Create `filing-case-plans.test.ts`: `readActiveConflicts`' statement plans as
  Task 1's passing plan; `openFilingCasesSummary`'s uses `verifactu_submissions_case_idx`.
- [ ] **Step 4:** Run the Finish line's fiscal-verifactu, server and provisioning lines. PASS. A
  refusal from `verifactu_submissions_guard_update` in a writer's path here is stop 2. Commit: "A
  filing case lives on its record's submission row (A1308 fiscal 6)".

### Task 4: delete the case tables; the A805 delete refusal's callers

- [ ] **Step 1:** Delete `schema/filing-cases.ts` (types moved first), exports, classification and
  manifest entries, guard entries, the three backup links (add
  `["verifactu_submissions", "case_remedy_registro_id", "verifactu_records", "id"]` and
  `["verifactu_submissions", "case_resolved_by", "persons", "id"]`). Rebuild the set.
- [ ] **Step 2:** Run the Finish line's server and provisioning lines. PASS.
- [ ] **Step 3:** The demo capture: both tables held no row; `REMOVED_TABLES` gains them.
- [ ] **Step 4:** Commit: "Remove the case tables the submission row replaced (A1308 fiscal 6)".

### Task 5: measure after, protection list, documents, finish

- [ ] **Step 1:** Build and grow on this branch (fi2 Task 5 Step 1, with `--cases 200`); plan the
  conflict check on it (passing as Task 1); `pnpm bench compare` against the base at both sizes.
  **Failing:** `slower` for `sale.counter` or `payment.final` (each runs the conflict check through
  `refuseNewIssuance`, `backend.ts:187`), or a failing plan: stop 1.
- [ ] **Step 2:** Protection list against `<A>`: exactly "Expected protection-list difference".
- [ ] **Step 3: Documents** (rules §9): tables-fiscal.md §8 items 2 and 5, dated results; delete
  "`envios`: decide the remaining DELETE restriction (A805 follow-up)" from the bundle; add to
  `grants-retirement-audit.md` after `:144`: "**2026-11-xx:** `envios` (now `verifactu_submissions`)
  was settled by A1308 fiscal 6: a submission row is never deleted
  (`verifactu_submissions_no_delete`)." `docs/developers/conventions-data.md`: sentences naming
  `filing_cases` or `filing_case_events` name the submission row's case columns or `case.note`.
- [ ] **Step 4:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset`.
