# A1308 fiscal 4a: the fiscal history table, its checks, writer and readers — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `verifactu_history`, the Veri\*Factu module's own append-only log, with the clock
kinds `clock.check_opened` and `clock.confirmed`: the table, every CHECK and unique index the clock
tables hold today re-expressed per kind and measured on the app's own SQLite engine, the one writer
`appendHistory`, the typed readers, and the confirmation read's query plan on a grown venue. The
clock code does not move yet: [fi4b](2026-11-08-a1308-fi4b-clock-onto-history.md) moves it onto
this table and deletes `clock_checks`, `clock_confirmations` and `clock_stop_restarts`.

**Why two pull requests:** the old single fiscal-4 plan was over the size cap (rules §1). At
`a086eedfb7`, `git grep -w "clock_checks\|clock_confirmations\|clock_stop_restarts\|clockChecks\|clockConfirmations\|clockStopRestarts" -- '*.test.ts' | wc -l`
printed 211 test lines (201 outside `clock-stop-restarts.test.ts`, which goes), against 120 the
single plan budgeted. This plan adds the table and everything that can be proved on it alone; fi4b
re-points those lines.

**Architecture:** One table in the `fiscal-verifactu` set, classified `ledger` and `appendOnly()`.
Common facts are columns (`seq`, `kind`, `event_key`, `node_id`, `at`, `registro_id`, `ref_id`,
`person_id`); each kind's own fields are a JSON `data` object, checked by one named CHECK per old
protection, written with `json_extract`/`json_type` and wrapped so a missing field fails rather than
passes. One writer, `appendHistory`, assigns `seq` (`max + 1` in the write transaction, as the clock
tables do today, `clock-checks.ts:60-70`) and derives `event_key` per kind. `seq`, not time, orders
the log, because the clock is what is in doubt (tables-fiscal §0.3). fi5, fi6 and fi7 add their
kinds to the same table.

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest; fi2's `bench grow-fiscal`.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §0.3 (what the
clock stop reads back), §1.1 `verifactu_history`, §3 (the kinds and their `data`), §4
(`clock_checks`, `clock_confirmations`, `clock_stop_restarts`), §5 (their protections and the note
after the table), §8 items 3 and 4; README §3 ("The Veri\*Factu module keeps its own append-only
history"), §5 U11 (person keys), §6 Performance; CLAUDE.md §5 "More than a minute behind the latest
fiscal record"; rules [2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi3. Names are fi1's. Line numbers read at `a086eedfb7`.

**Owner lands:** yes (the table will hold the clock stop's confirmations, which decide whether a sale
may be recorded; CLAUDE.md §5).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply.
- **Nothing the product does changes.** No production code writes or reads the new table in this
  pull request; the clock stop still uses `clock_checks` and `clock_confirmations` until fi4b.
- **A CHECK that evaluates to NULL passes in SQLite.** Every per-kind CHECK is written
  `kind <> '<kind>' OR coalesce(<condition>, 0)`, so a missing field (which `json_extract` reads as
  NULL) is refused. Task 1 tests the missing-field case for every CHECK.
- **`verifactu_history_data_ck` is declared first**, before every per-kind CHECK. SQLite runs the
  CHECKs in the order the table declares them; a per-kind CHECK run first on malformed JSON raises
  `malformed JSON` (not a CHECK failure), and on a JSON array it fails under its own name instead of
  `verifactu_history_data_ck`. Measured on 2026-11-08 (Node v26.13.0's `node:sqlite`, a scratch
  table with one whole-row CHECK and one per-kind CHECK, both orders): data first, `{not json` and
  `[1,2]` each failed `CHECK constraint failed: h_data_ck`; per-kind first, `{not json` raised
  `malformed JSON` and `[1,2]` failed under the per-kind name. drizzle-kit writes CHECKs in the
  order the table callback lists them (`packages/db/src/schema/series.ts:43-45` lists purpose,
  next number, code, and the built `invoice_series` lists its CHECKs in that order); the builder
  confirms the order in the rebuilt `0000_baseline.sql`.
- The engine is `node:sqlite` through `useVenueDb`, never the `sqlite3` command line (CLAUDE.md §3).
- `person_id` has a key to `persons` (design U11). A fixture that invents a person creates it first.

## Review Focus

1. **A CHECK that does not fire.** tables-fiscal §8 item 4. Each CHECK has a refused row for a wrong
   value and for a missing field, and an accepted row; malformed JSON and a JSON array are refused
   by `verifactu_history_data_ck` by name.
2. **One sequence instead of two.** Checks and confirmations each had their own `seq`; now they
   share one. Nothing compares a check's `seq` with a confirmation's (read `clock-checks.ts:38-70`,
   `clock-behind.ts:112-150`, `clock-stop-incidents.ts:205-216`): each orders within one kind. The
   `seq` values tests see do change; fi4b lists them.
3. **The confirmation read's plan** (tables-fiscal §8 item 3), on an empty table (Task 2) and on a
   grown venue (Task 3).

---

## What it builds

**Table `verifactu_history`** (`packages/fiscal-verifactu/src/schema/verifactu-history.ts`):

| Column | Builder (`packages/db/src/schema/columns.ts`) | Rules |
| --- | --- | --- |
| `id` | `id`, primary key, `newId` | |
| `seq` | `count`, not null | unique (`verifactu_history_seq_uq`) |
| `kind` | `label`, not null | `verifactu_history_kind_ck`: in this PR `kind in ('clock.check_opened', 'clock.confirmed')`; fi5–fi7 extend the list |
| `event_key` | `label`, null | unique (`verifactu_history_event_key_uq`) |
| `node_id` | `id`, not null | → `nodes` |
| `at` | `ts`, not null | the box's reading when written |
| `registro_id` | `id`, null | → `verifactu_records` |
| `ref_id` | `id`, null | → `verifactu_history(id)` |
| `person_id` | `id`, null | → `persons`, `onDelete("restrict")` |
| `data` | `json<Record<string, unknown>>`, not null | `verifactu_history_data_ck`: `json_valid(data) and json_type(data) = 'object'`, declared first |

Indexes `verifactu_history_kind_seq_idx (kind, seq)` (the open check) and
`verifactu_history_registro_kind_seq_idx (registro_id, kind, seq)` (the clock stop's "latest
confirmation naming this record").

**Kinds and their CHECKs** (each `kind <> '…' OR coalesce(…, 0)`, declared after
`verifactu_history_data_ck` and `verifactu_history_kind_ck`):

- `clock.check_opened` — from `clock_checks`. `at` = `opened_at`. `data`: `reason`, `detail`.
  - `verifactu_history_check_reason_ck`: `json_extract(data, '$.reason') in ('start', 'change', 'behind_chain', 'disagrees')` (was `clock_checks_reason_ck`).
  - `verifactu_history_check_shape_ck`: `json_type(data, '$.detail') is not null and registro_id is null and ref_id is null and person_id is null and event_key is null`.
- `clock.confirmed` — from `clock_confirmations`. `at` = `box_clock_at` (the box's reading when
  the clock was judged, before any step); `data`: `confirmedAt`, `stepMs`, `source`, `reason`,
  `proof`, `recordAt`; columns `registro_id`, `ref_id` (the check), `person_id`. `boxClockAt` is not
  repeated in `data`: it is `at` (R6; README §11 leaves the exact columns to the builder).
  - `verifactu_history_confirmed_source_ck`: `json_extract(data, '$.source') in ('authority', 'devices', 'admin', 'staff', 'elapsed')`.
  - `verifactu_history_confirmed_reason_ck`: `json_extract(data, '$.reason') in ('start', 'change', 'behind_chain', 'disagrees', 'unusable')`.
  - `verifactu_history_confirmed_person_ck`: `(json_extract(data, '$.source') in ('admin', 'staff')) = (person_id is not null)` (was `clock_confirmations_person_ck`; the old non-empty half is now the key to `persons`).
  - `verifactu_history_confirmed_record_ck`: `(registro_id is null) = (json_extract(data, '$.recordAt') is null)` (was `clock_confirmations_record_ck`).
  - `verifactu_history_confirmed_shape_ck`: `json_type(data, '$.confirmedAt') = 'text' and json_type(data, '$.stepMs') = 'integer' and json_type(data, '$.proof') is not null and json_type(data, '$.recordAt') is not null` (the last term makes `recordAt` present, as JSON `null` or a time, so a row that leaves it out is refused rather than read as "no record").
  - `verifactu_history_confirmed_key_ck`: `event_key is (case when ref_id is null then null else 'clock.confirmed:' || ref_id end)`. With the unique `event_key`, this is "one confirmation per check" (was `clock_confirmations_check_uq`).
- The `seq` unique replaces `clock_checks_seq_uq` and `clock_confirmations_seq_uq` (one shared
  sequence, tables-fiscal §5 `clock_checks` row: "the shared unique `seq`");
  `verifactu_history_registro_kind_seq_idx` replaces `clock_confirmations_registro_idx` (fi4b
  deletes the old ones).
- **A confirmation names a clock check** (**owner, 2026-11-09:** add the rule; tables-fiscal §5,
  the note after the table: "Add a trigger if that matters"). The old table's foreign key to
  `clock_checks` refused a confirmation naming anything else; the history's `ref_id` key only proves
  the row exists, so one `BEFORE INSERT` trigger restores the rest, in a new hand-written file
  `packages/fiscal-verifactu/triggers/fiscal-verifactu.sql` (slice 1a's rebuild command appends a
  set's `triggers/<set>.sql`, [1a](2026-11-08-a1308-1a-baseline-rebuild.md), "Words used here"):

  ```sql
  CREATE TRIGGER verifactu_history_confirmation_names_check BEFORE INSERT ON verifactu_history
  WHEN new.kind = 'clock.confirmed' AND new.ref_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM verifactu_history h
                WHERE h.id = new.ref_id AND h.kind <> 'clock.check_opened')
  BEGIN SELECT RAISE(ABORT, 'verifactu_history: a clock confirmation names a clock check'); END
  ```

  It fires only when the named row exists and is another kind, so a `ref_id` naming no row is still
  refused by the foreign key, as the carried case at `clock-confirmations.test.ts:132-139` expects
  (a `BEFORE` trigger runs before the key is checked; written from how SQLite orders them, and Task 1
  runs both cases). A confirmation with no check (`ref_id` null) is not touched. The refusal text is
  a constant, `HISTORY_CONFIRMATION_CHECK_REFUSAL`, in a new
  `packages/fiscal-verifactu/src/trigger-refusals.ts`, with a comment saying why: a confirmation is
  the evidence that lifts the clock stop for one check, so naming anything but that check would let
  it answer a check it never saw. `scripts/behavioural-triggers.test.ts` imports it, like core's
  (`:9-29`). This plan, not fi6, now creates both files; fi6, fi7 and fi9 add to them.

Ten CHECKs in all (`data`, `kind`, two for checks, six for confirmations) and four foreign keys.

**The writer and readers** (`packages/fiscal-verifactu/src/history.ts`, Interfaces below), tested
here on their own; fi4b moves the clock code onto them.

**Measured:** tables-fiscal §8 item 3 (the confirmation read's plan, empty and grown) and item 4
(the CHECKs fire).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Moving the clock code, re-pointing the clock suites, deleting `clock_checks`, `clock_confirmations`, `clock_stop_restarts` and their tests | [fi4b](2026-11-08-a1308-fi4b-clock-onto-history.md) |
| `conflict.observed`, `conflict.lookup` | fi5 |
| `case.note` | fi6 |
| `aeat.answer_cleared` | fi7 |
| Pruning | Never: append-only (README U10) |

## Owner decision

1. **Should the database refuse a confirmation whose `ref_id` names a row that is not a clock
   check?** **Owner, 2026-11-09: yes** — the trigger in "What it builds" ("A confirmation names a
   clock check"). Without it the only guard was the one writer, which takes a check id only from
   `openCheck`'s answer (fi4b).

## Interfaces

```ts
// packages/fiscal-verifactu/src/history.ts
export type ClockCheckReason = "start" | "change" | "behind_chain" | "disagrees";
export type ClockConfirmationSource = "authority" | "devices" | "admin" | "staff" | "elapsed";
export type ClockConfirmationReason = ClockCheckReason | "unusable";

export type HistoryEntry =
  | { kind: "clock.check_opened"; nodeId: NodeId; at: Date;
      data: { reason: ClockCheckReason; detail: unknown } }
  | { kind: "clock.confirmed"; nodeId: NodeId; at: Date; checkId: string | null;
      registroId: string | null; personId: string | null;
      data: { confirmedAt: Date; stepMs: number; source: ClockConfirmationSource;
              reason: ClockConfirmationReason; proof: unknown; recordAt: Date | null } };
// fi5–fi7 add members to this union.

/** The only writer. `seq` = max + 1 in `tx`; `event_key` derived from the kind. Dates stored as ISO text; `recordAt: null` is written, not left out. */
export function appendHistory(tx: Transaction, entry: HistoryEntry): Promise<{ id: string; seq: number }>;

export interface ClockCheckRow { id: string; seq: number; nodeId: string; openedAt: Date; reason: ClockCheckReason; detail: unknown }
export interface ClockConfirmationRow {
  id: string; seq: number; nodeId: string; boxClockAt: Date; confirmedAt: Date; stepMs: number;
  source: ClockConfirmationSource; personId: string | null; reason: ClockConfirmationReason;
  /** As stored: JSON text, parsed by the caller with `parsedStored` (`clock-behind.ts:69-76`). */
  proof: string; checkId: string | null; registroId: string | null; recordAt: Date | null;
}
export function latestClockCheck(tx: Transaction): Promise<ClockCheckRow | null>;
export function confirmationOf(tx: Transaction, checkId: string): Promise<ClockConfirmationRow | null>;
export function latestConfirmationNaming(tx: Transaction, registroId: string): Promise<ClockConfirmationRow | null>;
export function confirmationsNamingRecords(tx: Transaction): Promise<ClockConfirmationRow[]>; // registro_id not null, by seq
export function clockConfirmation(tx: Transaction, id: string): Promise<(ClockConfirmationRow & { checkDetail: unknown }) | null>;
```

The row interfaces carry today's field names (`schema/clock-checks.ts`,
`schema/clock-confirmations.ts`), so fi4b's clock code changes its `from` and keeps its logic.

## Files

**Create**
- `packages/fiscal-verifactu/src/schema/verifactu-history.ts`, `src/history.ts`.
- `packages/fiscal-verifactu/triggers/fiscal-verifactu.sql` (the one trigger) and
  `src/trigger-refusals.ts` (its refusal text).
- `packages/fiscal-verifactu/src/schema/verifactu-history.test.ts` (the CHECKs, Task 1).
- `packages/fiscal-verifactu/src/history.test.ts` (writer, readers, plans, Task 2).

**Modify**
- `packages/fiscal-verifactu/src/schema/index.ts`, `src/classification.ts`,
  `packages/migrations/migrations.manifest.json` (fiscal entry: add `verifactu_history`).
- `scripts/append-only-triggers.test.ts` (`EXPECTED` gains the table), `scripts/schema-constraints.test.ts`
  (the new keys, uniques and CHECKs), `scripts/behavioural-triggers.test.ts` (the new trigger: a
  product-migrated database refuses a confirmation naming another confirmation with
  `HISTORY_CONFIRMATION_CHECK_REFUSAL`).
- `apps/server/scripts/bench/grow-fiscal.ts` and `grow-fiscal.test.ts` (`--history <n>`, Task 3).
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`verifactu_history` joins
  `ADDED_TABLES`, `:24-37`; the seed writes no row to it).

**Generated:** `packages/fiscal-verifactu/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: schema with CHECKs 95, `history.ts` 170, lists 15, bench flag 30, trigger file and refusal constant 15 | ~325 |
| Tests: CHECK test 230 (with the cases carried from `clock-confirmations.test.ts`), the trigger's two cases 20, behavioural-triggers guard 15, writer/reader/plan test 110, bench case 20, demo list 2 | ~397 |
| **Total** | **~722** |

Not counted: the generated migration.

## Assertions that change, by design

None in an existing test: no existing test file changes its assertions in this pull request.

The cases of `packages/fiscal-verifactu/src/clock-confirmations.test.ts` (a test of the old
tables' protections) are carried into `schema/verifactu-history.test.ts` one for one, so that fi4b
can delete the old file with nothing lost. These carried cases differ from the old ones as follows
(design: tables-fiscal §5, the `clock_checks` and `clock_confirmations` rows and the note after the
table; README U11 for the person key). Every other carried case keeps its assertion with the table
re-pointed.

| Old case (`clock-confirmations.test.ts`) | Carried as |
| --- | --- |
| `:93-106`, `:194-209` "refuses an update and a delete" | `triggerRaised(…, "verifactu_history is append-only")` (the message is built from the table name) |
| `:108-118` "refuses an undeclared reason" (check) | `checkFailed(error, "verifactu_history_check_reason_ck")` |
| `:120-130`, `:302-312` "refuses a second row with the same seq" | `refusalOn(error, UNIQUE_VIOLATION, { table: "verifactu_history", columns: ["seq"] })`; plus a new case: a check and a confirmation with the same `seq` are refused (one shared sequence) |
| `:143-191` "keeps a full row for every declared source and reason" | The check takes `seq` 1, so the eight confirmations take 2–9 (they took 1–8 in their own sequence); the expected list reads `[2, "admin", …] … [9, "authority", "unusable"]`. `PERSON` is created as a person first (rules §4) |
| `:211-250` `it.each` refusals | Check names `verifactu_history_confirmed_person_ck`, `…_source_ck`, `…_reason_ck`, `…_record_ck`; "a devices confirmation naming an empty person" is still a CHECK refusal under `…_person_ck` (`""` is not null) |
| `:252-262` "refuses an administrator's confirmation naming an empty person" | **Now refused by the key to `persons`**, not a CHECK: `isRefusal(error, FOREIGN_KEY_VIOLATION)`. `""` is not null, so `verifactu_history_confirmed_person_ck` passes; no person has id `""`. The old CHECK's non-empty half is what the key replaces (README U11) |
| `:264-273`, `:275-285` staff cases | `PERSON` created first; the second's check name `verifactu_history_confirmed_person_ck` |
| `:287-300` "refuses a record without its record_at" | `verifactu_history_confirmed_record_ck` |
| `:314-326` "refuses a second closing of the same check" | `refusalOn(error, UNIQUE_VIOLATION, { table: "verifactu_history", columns: ["event_key"] })`: one confirmation per check is now the unique `event_key` |
| `:132-139`, `:339-361` rows naming no node, check or record | Unchanged: foreign-key refusals (`ref_id` → `verifactu_history`, `registro_id` → `verifactu_records`, `node_id` → `nodes`) |

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/schema/verifactu-history.test.ts src/history.test.ts src/classification.test.ts src/schema-ownership.test.ts src/clock-confirmations.test.ts
# and fi1's record suites (fi1 plan, "Finish line")
pnpm --filter @waitron/server exec vitest run scripts/bench/grow-fiscal.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts
pnpm --filter @waitron/composition exec vitest run src/composition.test.ts
```

Each Vitest run shows a `Tests` count with no failures (CLAUDE.md §4). The clock suites are not in
this list because nothing they run changes; CI runs them.

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue`. Extra lines only (from this plan's
schema; a prediction).

`phase=sql-only`:

```text
extra index verifactu_history.primary key(id)
extra index verifactu_history_event_key_uq
extra index verifactu_history_kind_seq_idx
extra index verifactu_history_registro_kind_seq_idx
extra index verifactu_history_seq_uq
extra table verifactu_history
extra trigger verifactu_history_confirmation_names_check
```

(The hand-written trigger is part of the starting migration's SQL, so it is there from `sql-only`.)

`phase=migrated` and `phase=change-feed`: the same, with the two append-only triggers the code
installs at migration; the trigger lines then read, at the end,

```text
extra trigger verifactu_history_append_only_delete
extra trigger verifactu_history_append_only_update
extra trigger verifactu_history_confirmation_names_check
```

Where the tool prints a new trigger's position among the table's triggers (rules §3), the
hand-written trigger is the only `BEFORE INSERT` one on the table, so it has no neighbour to be
ordered against; read the real `list` output and mark it.

The new table's four keys and ten CHECKs are fields of `extra table verifactu_history`; the
reviewer reads them in the list's JSON for `verifactu_history` against "What it builds". No
change-feed trigger: the fiscal module declares no live-update source (fi1 plan, "Expected
protection-list difference"). Design reasons: tables-fiscal §1.1 `verifactu_history`, §5 the
`clock_checks` and `clock_confirmations` rows and the note after the table (the trigger: owner,
2026-11-09).

## Stop points (beyond rules §5)

1. **A CHECK does not fire** (tables-fiscal §8 item 4, rules §5.4): the Task 1 test inserts a row
   the CHECK should refuse and it is stored. Fallback, confirmed by the watcher first: that field
   becomes a typed, nullable column of `verifactu_history` with a plain CHECK.
2. **The confirmation read scans** (§8 item 3): its plan contains `SCAN verifactu_history`, at
   Task 2 or on the grown venue in Task 3. Fallback: keep `clock_confirmations` as its own table
   (fi4b then moves only the checks).
3. The rebuilt `0000_baseline.sql` lists any per-kind CHECK before `verifactu_history_data_ck`, and
   reordering the table callback does not change that.
4. Any of fi1's record suites fails.
5. The rebuild command does not append `packages/fiscal-verifactu/triggers/fiscal-verifactu.sql`
   (the protection list's `sql-only` phase has no `verifactu_history_confirmation_names_check`), or
   boot's append-only check refuses a table carrying a hand-written trigger beside its two
   append-only ones.

## Needs

fi3. fi2's `bench grow-fiscal`, which needs slice 0's bench: branch `feat/a1308-s0-bench`, not on
`main` on 2026-11-08, must land first.

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: the table and its CHECKs, measured first (§8 item 4)

**Files:** create `schema/verifactu-history.ts`, `schema/verifactu-history.test.ts`,
`triggers/fiscal-verifactu.sql`, `src/trigger-refusals.ts`; modify `schema/index.ts`,
`classification.ts`, the manifest, `scripts/append-only-triggers.test.ts`,
`scripts/behavioural-triggers.test.ts`, `scripts/schema-constraints.test.ts`, the demo test's
`ADDED_TABLES`; rebuild the set.

- [ ] **Step 1: Failing test** `verifactu-history.test.ts` (`useVenueDb` with the fiscal migrations;
  seed a node, a person and a record with the package's fixtures). For **each** CHECK in "What it
  builds": one insert breaking its condition with a wrong value and one with the field missing (or,
  for column conditions, the column set or empty the wrong way); each refused, and identified by its
  name (`CHECK constraint failed: <name>`). `data` written as `{not json` and as `[1,2]`: each
  refused as `verifactu_history_data_ck` (the declaration-order check). Then one accepted row per
  kind, and the unique cases: a second row with the same `seq`; a check and a confirmation with the
  same `seq`; a second `clock.confirmed` naming the same check (same `event_key`); update and delete
  refused (`triggerRaised(error, "verifactu_history is append-only")`); a `person_id` with no person
  refused by its key. The trigger's two cases: `"a confirmation naming a clock check is stored"`
  (a check, then a `clock.confirmed` with `ref_id` = its id: one row more) and `"a confirmation
  naming a row that is not a clock check is refused"` (a check, a confirmation of it, then a second
  confirmation whose `ref_id` is the first confirmation's id: refused,
  `triggerRaised(error, HISTORY_CONFIRMATION_CHECK_REFUSAL)`, and no row added). Proof by deletion:
  with the trigger left out of `triggers/fiscal-verifactu.sql` and the set rebuilt, the second case
  fails because the row is stored; restore and rebuild. Carry every case of
  `clock-confirmations.test.ts` as "Assertions that change, by design" lists; the carried "naming no
  check" case (`:132-139`) must still be refused by the foreign key, not the trigger.
- [ ] **Step 2:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/schema/verifactu-history.test.ts`. FAIL.
- [ ] **Step 3:** Write the schema as "What it builds": `verifactu_history_data_ck` first in the
  table callback, then `verifactu_history_kind_ck`, then the per-kind CHECKs, every per-kind
  condition inside `coalesce(…, 0)`. Write `triggers/fiscal-verifactu.sql` and
  `trigger-refusals.ts` as "What it builds", and add the trigger to
  `scripts/behavioural-triggers.test.ts`. Classify `appendOnly("verifactu_history", "ledger", LEDGER)`;
  manifest; guards; `ADDED_TABLES`.
  `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`. Read the
  rebuilt `packages/fiscal-verifactu/drizzle/0000_baseline.sql`: the `verifactu_history_data_ck`
  constraint line comes before every per-kind one (stop 3 if not).
- [ ] **Step 4:** Run it. **Passing:** every refusal case refused under the expected name, every
  accepted row stored. **Failing:** any refusal case stored. That is stop 1; record which CHECK in
  `questions.md`.
- [ ] **Step 5:** Commit: "Add the Veri\*Factu history table with its per-kind checks (A1308 fiscal 4a)".

### Task 2: the writer and readers; the confirmation read's plan (§8 item 3)

**Files:** create `src/history.ts`, `src/history.test.ts`.

- [ ] **Step 1: Failing test** `history.test.ts`:
  - "numbers entries in one sequence across kinds": a check, a confirmation, a check get `seq` 1, 2, 3.
  - "derives a confirmation's key from its check": stored `event_key` is `clock.confirmed:<check id>`;
    a confirmation with no check stores null.
  - "stores dates as ISO text and reads them back as dates"; "writes `recordAt: null` rather than
    leaving it out".
  - "latestConfirmationNaming takes the largest `seq`, not the latest time": two confirmations
    naming one record, the later `seq` with the earlier `confirmedAt`; the later `seq` is returned.
  - "latestClockCheck is the open check only while no confirmation names it" (`clock-checks.ts:38-58`).
  - "confirmationOf", "confirmationsNamingRecords" (by `seq`, only rows naming a record) and
    "clockConfirmation" (with its check's detail) each read what they name.
  - Plans (capture as `apps/server/src/history-read-plans.test.ts:26-64`): `latestConfirmationNaming`
    plans `SEARCH verifactu_history USING INDEX verifactu_history_registro_kind_seq_idx (registro_id=? AND kind=?)`;
    `latestClockCheck` plans `SEARCH … USING INDEX verifactu_history_kind_seq_idx (kind=?)`. Neither
    contains `SCAN verifactu_history`.
- [ ] **Step 2:** Run it. FAIL.
- [ ] **Step 3:** Implement `history.ts` as Interfaces. `appendHistory` reads
  `coalesce(max(seq), 0) + 1` and inserts in `tx`; it is the only insert into the table
  (fi5 adds the "if absent" form).
- [ ] **Step 4:** Run; PASS. A plan with `SCAN verifactu_history` is stop 2. Commit: "One writer and
  typed readers for the fiscal history (A1308 fiscal 4a)".

### Task 3: the plan on a grown venue

- [ ] **Step 1:** Add `--history <n>` to `bench grow-fiscal`: after growing records, write `n`
  `clock.check_opened` and `n` `clock.confirmed` rows through `appendHistory`, each confirmation
  naming a grown record. Extend `grow-fiscal.test.ts` by one case (history rows rise by `2n`, and
  `latestConfirmationNaming` of the last grown record returns the last confirmation). Run; PASS.
- [ ] **Step 2:** Build and grow a venue on this branch (fi2 Task 5 Step 1, with `--history 2000`)
  and plan `latestConfirmationNaming`'s statement on it with `node:sqlite` (fi2 Task 1 Step 5's
  one-liner, this query). **Passing:** as Task 2. **Failing:** `SCAN verifactu_history` (stop 2).
  Paste the plan into the pull request.
- [ ] **Step 3:** Commit: "Grow the fiscal history on the bench and plan its read (A1308 fiscal 4a)".

### Task 4: protection list, documents, finish

- [ ] **Step 1:** `pnpm protection-list list --out <B>`; compare with `<A>`; exactly "Expected
  protection-list difference". Read the `verifactu_history` entry in `<B>/protection-list.json` and
  tick each key and CHECK against "What it builds" in the pull request.
- [ ] **Step 2: Documents** (rules §9): tables-fiscal.md §8 items 3 and 4, a dated line each with
  the result.
- [ ] **Step 3:** Commit; `/finish-branch` (full wave: fiscal is a risk trigger). After landing,
  `wa-wt reset`.
