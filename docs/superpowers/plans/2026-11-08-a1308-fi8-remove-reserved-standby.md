# A1308 fiscal 8: remove the standby's reserved identity and the paper-standby path — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `fiscal_reservations`, the inactive fiscal identity a standby box reserved when it
joined, with every piece of code that only it serves: the paper-standby path (reserve, establish and
promote under a paper or declared-paper authority), its name-history and backup readers, and the tests
of that path. The hour path that A947 and A1018 build on stays exactly as it is.

**Architecture:** Mostly deletion. The standby seat `ALLOCATED_FISCAL_STANDBY`
(`packages/fiscal-verifactu/src/allocated-standby.ts:163-219`) tries the hour (dormant) path first
and falls back to paper: `reserve` after `reserveHourDormant` returns nothing (`:167-194`), `establish`
after `establishHourDormant` returns false (`:197-216`). Promotion dispatches on the authority:
`hour` → `activateAuthenticatedHourStandbyAllocation`, otherwise →
`activateAuthenticatedDormantAllocation`, which reads the reservation (`allocation-operation.ts:257-276`;
`allocation.ts:224-285`). After this pull request the fallbacks refuse instead, with refusals the code
already gives, so no new wording or error code is needed.

**Tech stack:** TypeScript, Vitest.

**Spec:** README §5 U5 ("Removed: `fiscal_reservations` … Removing it removes the paper-standby path
with it … It is a fiscal slice, so the owner lands it"), U6, §10 ("Second box (U5) | Keep the path A947
and A1018 build on. Only `fiscal_reservations` goes"); [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md)
§4 "What goes with `fiscal_reservations`", §5 (its row); A947 design §4 item 3 ("No fiscal identity
is reserved at joining"); rules [2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi7. Line numbers read at `a086eedfb7` and re-checked at `9c66ef0356` for the
lines this plan's review fixes touched (`allocated-standby.ts`, `allocation.ts`,
`allocation-operation.ts`, `mirror-bundle.ts`): unmoved except where a new number is given. The design's cites into
`mirror-bundle.ts:190` and `promote.ts:276` have moved (at `a086eedfb7` the module standby hooks are
at `apps/server/src/promote.ts:275-286`, and `mirror-bundle.ts:170` is the shared reservation
transaction), which is why Task 1 traces before deleting.

**Owner lands:** yes (the fiscal identity; README U5 and U6).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply.
- **The hour path is untouched.** Every test of the dormant/hour standby, adoption, promotion under an
  hour authority, and the A1018 handover keeps passing with no edit: `hour-dormant-standby.test.ts`,
  `hour-standby-activation.test.ts`, `apps/server/src/handover-*.test.ts`, `hour-promotion.test.ts`'s hour cases,
  `mirror-bundle-api.test.ts`'s dormant cases.
- Delete only what can reach `fiscal_reservations`; anything that also serves another path stays
  (stop 2).
- A refusal replacing a removed branch reuses an existing `sif.allocation_invalid` reason.

## Review Focus

1. **A deleted function the hour path still reached.** The reviewer re-runs Task 1's trace.
2. **The name history** still refuses every installation name already used (CLAUDE.md §5
   "a minute whose name is already in a history the box reads is not taken"): reservations were one
   of its sources (`hour-history-reader.ts:178-191`, `:247-259`); with the table gone it reads the
   identities, allocations and series, which hold every name a box has signed under.

---

## What it builds

- **Deleted** (Task 1 confirms each reaches only `fiscal_reservations`):
  - `fiscal_reservations`: `schema/reservations.ts`, its export, classification entry
    (`classification.ts:13`), manifest entry, `EXPECTED` entry, `schema-constraints` entries.
  - `standby-allocation.ts` (`validateStandbyAllocation`, `establishDormantAllocation`) and its test.
  - The paper fallbacks in `allocated-standby.ts` `reserve` (`:168-194`) and `establish`
    (`:198-216`). After the hour attempt, each first checks the authority as `readPrepared` does today
    (`:133-137`: no operation, or no fresh scoped authority, refuses
    `sif.allocation_invalid` `{ reason: "reauthentication_required" }`), and only then refuses
    `{ reason: "outside_confirmation_missing" }`, the refusal production's preparation already gives
    for an input it does not take (`hour-configuration.ts:69-72`, `:86-88`). The order matters:
    `mirror-bundle.ts:183-184` calls `reserve` with whatever `moduleOperationFor` returns, which can
    be no operation, and `reserveHourDormant` returns `undefined` for that (`hour-dormant-standby.ts:263`),
    so without the authority check first a reserve with no authority would answer
    `outside_confirmation_missing` where it answers `reauthentication_required` today
    (`allocated-standby.test.ts:227-236`, which keeps its refusal assertion; its `:235` line is listed below).
  - `allocation.ts`: `activateAuthenticatedDormantAllocation` (`:224-243`),
    `activateDormantAllocation` (`:245-254`), `activateDormant` (`:256-…`), and the reservation check
    in validation (`:92-97`). In `allocation-operation.ts:257-276`, a `promote` whose authority is not
    `hour` refuses `sif.allocation_invalid` `{ reason: "reservation_missing" }`, which is what
    `activateDormant` answered for a box with no reservation (`allocation.ts:278`).
  - The standby half of `createPaperAllocationPreparation` (`allocation-preparation.ts:26-34`: `reserve`
    and `establish` no longer dispatch to a standby preparation) and `createPaperStandbySource`
    (`allocation-paper-source.ts:222-…`).
  - `declared-paper-standby.ts` and its test, if Task 1 finds its only consumers are the fallback,
    `allocation-configuration.ts` and `allocation-standby-source.test.ts`; `allocation-configuration.ts`
    loses that branch (fi11 reworks the file).
  - Readers: `hour-history-reader.ts:178-191` (the reservation records) and `:247-259`, with
    `HourHistoryRows.reservations`; `backup-verification.ts:56` and its use;
    `backup-verification-history.ts:359-428` (`reservationRow`) and the loop's reservation arm
    (`:477-487`).
  - Exports in `src/index.ts` (`:64`, `:79-89`) of what goes.
  - Tests of the path: `standby-allocation.test.ts`, `allocated-standby.test.ts`'s paper cases,
    `declared-paper-standby.test.ts`, `declared-paper-consumers.test.ts`'s standby cases,
    `dormant-allocation.test.ts` (whole file, 349 lines: its one `describe`, "persisting a named
    spare's dormant paper allocation", imports `standby-allocation.js` and `fiscalReservations`,
    `:10-11`), `dormant-takeover.test.ts` (whole file, 687 lines: its one `describe`, "a retained
    dormant reservation consumed for a separate takeover", `:205`, imports
    `establishDormantAllocation` and `fiscalReservations`, `:11`, `:13`; every case, including `:435`
    "a paper standby promotion given version 2 is refused" from #2428, is the paper path),
    `allocation-standby-source.test.ts`,
    `test/allocation-fixture.ts:106-…` (the standby preparation helper), and the paper-standby cases in
    `apps/server/src/allocated-standby-host.test.ts`, `reserved-identity.test.ts`,
    `standby-public-operation.fiscal.test.ts`, `mirror-bundle-api.test.ts`, `hour-promotion.test.ts`.
- **New tests:** one each that the two refusals above are given (a paper `reserve` input after the
  hour attempt declines; a non-hour `promote`).

## Assertions that change, by design

| Test | Assertion | Why |
| --- | --- | --- |
| `allocated-standby.test.ts:139` (the `reservations` key of `rows()`), `:235`, `:266`, `:526`, `:573`; `:184-186` belongs to a paper case deleted below | "no reservation was written" | The table goes (README U5); the same tests' identity and series row counts, which `rows()` also returns, stay and still show nothing was written |
| `allocated-standby.test.ts`'s paper `reserve`/`establish` cases | a paper input is reserved or established | The paper-standby path goes (README U5: "Removing it removes the paper-standby path with it"); Task 2's new case asserts the refusal instead |
| `dormant-allocation.test.ts`, `dormant-takeover.test.ts`, `standby-allocation.test.ts`, `declared-paper-standby.test.ts`, `allocation-standby-source.test.ts` | whole files | the same |

The builder lists every other assertion Task 3 removes in the pull request, each under one of these
rows; one that fits none is stop 1.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Adoption, `node_mirror_link`, `node_primary_key`, the box's role and promotion, the handover tables | Kept (README U5) |
| `WAITRON_MIRROR_ALLOW_EXPOSED` | A947 slice 3b (README U5) |
| The paper protocol used by first setup and restore (`paper-*.ts` outside the standby path) | Kept: built and sound, and outside U5 (R5). Task 1 lists any it finds unreachable after the deletion; they are reported, not deleted |
| Folding `fiscal_allocations` into the identities | fi9 |

## Files

Listed in "What it builds"; Task 1 finalises the list before any edit and records it in the pull
request. Plus `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`fiscal_reservations` to
`REMOVED_TABLES`; it held no captured row) and the generated `packages/fiscal-verifactu/drizzle/*`,
`scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: two refusal branches with the authority check 16, history-reader and backup type edits 25, exports 10 | ~50 |
| Tests: two refusal cases 50, re-pointed history and backup cases 60, `rows()` without `reservations` 10 | ~120 |
| **Total** | **~170** |

Not counted: the deletions (`wc -l` at `9c66ef0356` gives 2,495 lines for `standby-allocation.ts`,
`declared-paper-standby.ts`, `schema/reservations.ts` and their tests,
`allocation-standby-source.test.ts`, `dormant-allocation.test.ts` (349) and `dormant-takeover.test.ts`
(687); plus the fallbacks, the dormant activation, the readers and the paper-standby cases in other
files), the generated migration.

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-dormant-standby.test.ts src/hour-standby-activation.test.ts src/allocated-standby.test.ts src/allocated-lifecycle.test.ts src/allocation.test.ts src/allocation-operation.test.ts src/allocation-preparation.test.ts src/hour-history-reader.test.ts src/hour-history.test.ts src/hour-selection.test.ts src/minute-selection-unknown-name.test.ts src/backup-verification.test.ts src/backup-verification-history.test.ts src/provisioning.test.ts src/index.test.ts src/schema-ownership.test.ts
# and fi1's record suites
pnpm --filter @waitron/server exec vitest run src/allocated-standby-host.test.ts src/hour-promotion.test.ts src/mirror-bundle-api.test.ts src/reserved-identity.test.ts src/standby-public-operation.fiscal.test.ts src/handover-activation.test.ts src/handover-preparation.test.ts src/handover-compare.test.ts src/boot.promote.test.ts src/promote-endpoint-e2e.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/venue-operation.fiscal.test.ts src/cli.venue-details.test.ts
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/module-seams.test.ts
git grep -nw "fiscal_reservations\|fiscalReservations\|establishDormantAllocation\|validateStandbyAllocation\|activateDormantAllocation\|activateAuthenticatedDormantAllocation" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing.

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue` (simulated on 2026-11-08 from
`a086eedfb7` with fi1–fi7 applied). Under every phase:

```text
missing index fiscal_reservations.primary key(event_key)
missing index fiscal_reservations_allocation_uq
missing index fiscal_reservations_identity_uq
missing table fiscal_reservations
```

and under `phase=migrated` and `phase=change-feed` also

```text
missing trigger fiscal_reservations_append_only_delete
missing trigger fiscal_reservations_append_only_update
```

Design reason: tables-fiscal §5, `fiscal_reservations`: "Dropped with the table (U5)".

## Stop points (beyond rules §5)

1. Any hour-path, adoption, promotion-under-hour or handover test fails or needs an edit.
2. Task 1 finds a function on the deletion list that the hour path, first setup or restore also
   reaches.
3. A function outside the list becomes unreachable and is not on the design's list: report it, do
   not delete it.
4. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, or to which identity
   or series a sale uses.

## Needs

fi7. A947's slice 3b is not needed: the dormant path already reserves nothing
(`hour-dormant-standby.ts:247-277`, README U5).

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: trace before deleting

- [ ] **Step 1:** For each candidate in "What it builds", list its callers with
  `git grep -n "<name>(" -- packages apps ':!*.test.ts'` and follow each caller up to a route, a
  module seat or a test. Mark it **delete** when every chain ends in `fiscal_reservations` (a read or
  write), in a paper/declared-paper standby input, or only in tests of those; **keep** otherwise.
  Paste the table (candidate, callers, verdict) into `questions.md` if any verdict is **keep** for a
  design-listed item (stop 2); otherwise into the pull request.
- [ ] **Step 2:** Commit nothing yet.

### Task 2: the two refusals (test first)

- [ ] **Step 1: Failing tests.** In `allocated-standby.test.ts`: "a standby input the hour path does
  not take is refused": `ALLOCATED_FISCAL_STANDBY.reserve` with a paper input (today's fixture) and a
  fresh scoped authority throws `sif.allocation_invalid` with
  `reason: "outside_confirmation_missing"` and writes nothing (row counts of `verifactu_identities`,
  `invoice_series`, `fiscal_reservations` unchanged); the existing "refuses %s without a fresh scoped
  authority" (`:227`) still answers `reauthentication_required` for both actions. In
  `allocation-operation.test.ts`: "a promotion without an hour authority is refused" with
  `reason: "reservation_missing"`.
- [ ] **Step 2:** Run; FAIL (today they take the paper path). **Step 3:** Replace the fallbacks and
  the promote branch. Run; PASS. Commit: "Standby preparation and promotion take only the hour path
  (A1308 fiscal 8)".

### Task 3: delete the path and the table

- [ ] **Step 1:** Delete everything marked **delete**, the table and its entries; re-point the name
  history and backup readers' types and tests (a test that seeded a reservation to show it counted
  in the history is deleted with the feature; a test that seeded identities and series keeps its
  assertions). Rebuild the set.
- [ ] **Step 2:** Run the Finish line. PASS. Commit: "Remove fiscal_reservations and the paper-standby
  path (A1308 fiscal 8, design U5)".

### Task 4: protection list, documents, finish

- [ ] **Step 1:** Protection list against `<A>`: exactly "Expected protection-list difference".
- [ ] **Step 2: Documents:** `docs/developers/conventions-data.md` and the A947/A1018 docs under
  `docs/developers/` that describe the reserved identity (search `reservation`, `fiscal_reservations`,
  `paper standby`): each sentence describing the removed path goes; historical plans and specs get no
  edit. `docs/backlog/` entries about the paper standby (search the same words) are deleted when this
  pull request finishes them; list each in the pull request.
- [ ] **Step 3:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset`.
