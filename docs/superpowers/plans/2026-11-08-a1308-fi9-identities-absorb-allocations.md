# A1308 fiscal 9: an identity row holds the approval that granted it — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `fiscal_allocations` (the approval behind each activated identity) into
`verifactu_identities` as seven columns that are empty together or set together; hold every identity
column fixed except a one-time `revocado_en` with a guard trigger; settle the A805 follow-up for
`registro_sif` (now `verifactu_identities`): an identity row is never deleted.

**Architecture:** In product code every identity row is written by `activate`
(`packages/fiscal-verifactu/src/allocation.ts:437-479`) together with exactly one allocation row
naming it, in one transaction, repeating its NIF, software id and installation number
(tables-fiscal §1.1 "Why the fold is sound"). After this slice `activate` writes one row, after the
series it creates, because the row's `result` names their ids. The two other writers of identity
rows, `registerSif` and `writeReservedSif` (`registro-sif.ts:78-158`), have no non-test caller, so
they move into the test fixtures, where they keep writing an identity with no allocation: the seven
allocation columns are left empty. Every reader of allocations reads the identity rows whose
allocation columns are set; a row with them empty is read exactly as an identity with no allocation
row is read today. The name history keeps reading an "activation" record per identity and an
"intent" record per identity that has an allocation.

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §0 table row
"(3) absorbs identity allocations — Better elsewhere", §1.1 `verifactu_identities` (columns,
protections, guard, Start again and its 2026-11-08 note, "Why the fold is sound"), §3, §4
(`fiscal_allocations`, `registro_sif`), §5 (both rows), §6; README "Additions of 6 November 2026"
(`registro_sif`); CLAUDE.md §5 ("Restore and promotion start a new chain under a new installation
name … a minute whose name is already in a history the box reads is not taken"); rules
[2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi8 (which removed the reservation readers and the paper-standby tests,
`standby-allocation.test.ts` and `dormant-takeover.test.ts` among them). Line numbers read at
`9c66ef0356`, before fi1–fi8 landed: there the tables are still `registro_sif` / `registroSif`
(fi1 renames them `verifactu_identities` / `verifactuIdentities`), and every search below matches
both spellings so it runs the same before and after fi1. A line that has only moved is not a stop
(rules §5.1).

**Owner lands:** yes (the fiscal identity).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply.
- **Which identity a sale uses, and which names are refused, do not change.** Activation, restore,
  promotion, Start again and the name history decide as today; their suites keep every assertion
  except those listed under "Assertions that change, by design".
- No column of the record changes (`verifactu_records.sif_id` keeps pointing at `verifactu_identities`).
- Waitron Cloud's fixtures that read `fiscal_allocations`
  (`waitron-cloud/scripts/cloud-cost/fixtures/remote-browser-conformance.test.mjs:52`,
  `replay-conformance.test.mjs:590`) are changed by the Cloud lane in step (README U11).

## Review Focus

1. **Name reuse.** `verifactu_identities_instalacion_uq (nif, id_sistema_informatico, numero_instalacion)`
   stays, and its three columns are `not null`, so an identity with empty allocation columns still
   holds its name; the no-delete trigger keeps every name for good. Whether the second index,
   `fiscal_allocations_identity_uq`, is kept is the owner question below.
2. **An empty allocation group read as an allocation.** Every reader in "Readers" either finds rows
   by `event_key` or `allocation_key` equality (an empty group never matches) or filters
   `event_key is not null`; the reviewer checks each one.
3. **The guard against a legitimate write:** activation's revocation of the previous identity
   (`allocation.ts:437-440`) must pass.
4. **Checks that now compare a row with itself** are deleted, not kept as dead branches (below).

---

## Decisions this plan makes (open to the owner)

- **The seven allocation columns are nullable, all empty or all set** (one CHECK). This departs from
  tables-fiscal §1.1, which marks them `not null`. Why: the fixtures that create identities
  (`seedFixtureSif`, `registerSif`, `writeReservedSif`, 31 raw inserts, below) create identities with
  no allocation row, and the name history and the backup checks read such an identity differently
  from one with an allocation: an allocation is checked against the series it names
  (`hour-history-reader.ts:131-166`; `backup-verification-history.ts:292-345`), so a fixture
  allocation naming no real series would, by those lines, mark the history incomplete (read from
  the code, not run; the 2026-11-08 review's finding 3). Giving every fixture a made-up allocation
  could change what those suites decide; leaving the group empty
  keeps today's "identity with no allocation row" exactly. The production writer, `activate`, always
  sets all seven, and it is the only product writer of identity rows (the search in "Why the fold is
  sound" finds no other). The weakening is stated at the columns.
  Never-reuse is not weakened: the index that refuses a used name has no nullable column (Review
  Focus 1), and the experiment under the owner question shows it refuses a name held by a row with
  an empty group.
- **The intent record's reference** becomes `verifactu_identities/allocation/<event_key>` (it was
  `fiscal_allocations/<event_key>`; the table is gone), in the venue reader and the backup reader
  alike, and `hour-recovery-state.ts:71` matches it.
- **Start again** (departs from tables-fiscal §1.1, whose text does not match the code; the dated
  note added there on 2026-11-08 says so): Start again deletes no rows today. `startAgainDeletable`
  only stops a listed append-only table's rows from counting as kept records, which refuse Start
  again (`apps/server/src/first-setup-database-holdings.ts:207-236`;
  `first-setup-resolution.ts:62-71`); Start again then removes the attempt's database files
  (`packages/provisioning/src/first-setup-start-again-deletion.ts:535-559`), or, where it finds
  files it did not expect, offers to move them aside (`apps/server/src/recovery-start-again.ts:69-73`).
  `verifactu_identities` is not append-only and its new triggers are not named
  `<table>_append_only_*` (the names the holdings reader looks for, `packages/store/src/append-only.ts:74-76`),
  so its rows never count as kept, `FISCAL_START_AGAIN_DELETABLE` empties, and the no-delete trigger
  is never reached by Start again. The log-only `rows=` count in a Start again refusal is one lower
  per activation, because the allocation row is now part of the identity row.

**Owner question — keep or drop `fiscal_allocations_identity_uq`? Recommended default: drop it.**
tables-fiscal §1.1 keeps it as `(nif, id_sistema_informatico, environment, numero_instalacion)`,
"the backstop that stops an installation number being reused in any environment". On the folded
table it refuses nothing `verifactu_identities_instalacion_uq` does not already refuse: its columns
are that index's three plus `environment`, and those three are `not null`
(`packages/fiscal-verifactu/src/schema/sif.ts:20-22`, index `:28-32`). Experiment (node:sqlite,
2026-11-08, a scratch table with both indexes, then each alone, holding one row with an allocation
and one with an empty group; five inserts each time): with both indexes, four refused and one (a new
name) accepted; with `instalacion_uq` alone, the same four refused and the same one accepted; with
`identity_uq` alone (the control), three of those four were accepted (the same name in another
environment, the same name with an empty group, and an empty-group row's name taken with an
environment). The one difference with both present: an exact duplicate is reported under
`identity_uq`'s columns rather than `instalacion_uq`'s, and no code reads either name
(`git grep -n "identity_uq\|instalacion_uq" -- apps packages scripts ':!**/drizzle/**'` finds
comments, a test comment and `scripts/schema-constraints.test.ts`'s list). Its backstop role held
while the allocation lived in a separate append-only table that could outlive a deleted identity;
with the no-delete trigger, `instalacion_uq` does that job. The builder takes the default unless the
owner answers otherwise before Task 1. Keeping it is one schema line, one unique case and one
protection-list line (`extra index verifactu_identities_identity_uq`).

## What it builds

**`verifactu_identities` columns** (tables-fiscal §1.1; today's seven plus seven from
`fiscal_allocations`):

| Column | Builder | From |
| --- | --- | --- |
| `id`, `node_id`, `nif`, `id_sistema_informatico`, `numero_instalacion`, `registrado_en`, `revocado_en` | unchanged | `registro_sif` |
| `environment` | `label`, nullable | `fiscal_allocations.environment` |
| `event_key` | `label`, nullable | `fiscal_allocations.event_key` (was its primary key) |
| `allocation_key` | `label`, nullable | `fiscal_allocations.allocation_key` |
| `allocation`, `approval`, `bases`, `result` | `json`, nullable | `fiscal_allocations` |

`fiscal_allocations.taxpayer_nif`, `software_id`, `installation_identity`, `sif_id` and
`activated_at` are today's `nif`, `id_sistema_informatico`, `numero_instalacion`, `id` and
`registrado_en` (same transaction, `allocation.ts:441-479`).

- `verifactu_identities_allocation_ck`: `(event_key is null) = (environment is null) and (event_key is null) = (allocation_key is null) and (event_key is null) = (allocation is null) and (event_key is null) = (approval is null) and (event_key is null) = (bases is null) and (event_key is null) = (result is null)`.
  The comment at the columns: empty together means an identity with no recorded approval, which only
  test fixtures write; `activate` sets all seven.
- Unique `verifactu_identities_event_key_uq (event_key)`, `verifactu_identities_allocation_uq (allocation_key)`
  (was `fiscal_allocations_allocation_uq`); `verifactu_identities_identity_uq` only if the owner
  keeps it; kept: `verifactu_identities_numero_ck`, `_instalacion_uq`, `_activo_uq`. Empty groups do
  not collide on the two new indexes (SQLite treats nulls in a unique index as distinct).
- Triggers in `packages/fiscal-verifactu/triggers/fiscal-verifactu.sql` (fi6 creates the file):

  ```sql
  CREATE TRIGGER verifactu_identities_guard_update BEFORE UPDATE ON verifactu_identities
  WHEN new.id IS NOT old.id OR new.node_id IS NOT old.node_id OR new.nif IS NOT old.nif
    OR new.id_sistema_informatico IS NOT old.id_sistema_informatico
    OR new.numero_instalacion IS NOT old.numero_instalacion OR new.environment IS NOT old.environment
    OR new.event_key IS NOT old.event_key OR new.allocation_key IS NOT old.allocation_key
    OR new.allocation IS NOT old.allocation OR new.approval IS NOT old.approval
    OR new.bases IS NOT old.bases OR new.result IS NOT old.result
    OR new.registrado_en IS NOT old.registrado_en
    OR (old.revocado_en IS NOT NULL AND new.revocado_en IS NOT old.revocado_en)
  BEGIN SELECT RAISE(ABORT, 'verifactu_identities: only revocado_en may be set, once'); END
  --> statement-breakpoint
  CREATE TRIGGER verifactu_identities_no_delete BEFORE DELETE ON verifactu_identities
  BEGIN SELECT RAISE(ABORT, 'verifactu_identities: an identity is never deleted'); END
  ```

  `IS NOT` treats an empty group as a value, so the group cannot be filled in after the insert
  either. The constants in `trigger-refusals.ts` say why: the allocation fields are the evidence
  that an identity was granted (they replace an append-only table); a deleted identity, even one that
  signed nothing, would let its installation name be taken again
  (`docs/compliance/verifactu-findings.md`:276-280, "No puede repetirse nunca"). The A805 decision
  for `registro_sif`: refuse every delete (the record foreign key already refused deleting an
  identity that signed a record).
- `activate` (`allocation.ts:437-479`): revoke the live identity (`:437-440`, unchanged), reset the
  chain head and retire and create the series as today (`:448-463`), then insert the one identity
  row with all fourteen columns and `result` (moved from `:441-447` and `:465-478`).
- **One reader helper**, `allocationOf(row)` in `packages/fiscal-verifactu/src/identity-allocation.ts`:
  returns the seven fields typed non-null, or `undefined` when `event_key` is null. Every product
  reader below goes through it, so "an empty group is no allocation" is decided in one place.
- **Readers** (each re-pointed to `verifactu_identities`; what an empty group does):
  - Found by `event_key` or `allocation_key` equality, so an empty group never matches and needs no
    new branch, only the type narrowing: `allocation.ts:98-101` ("allocation already used"),
    `:359-362` (replay's prior activation), `cloud-preparation.ts:259-262`,
    `conflict-recovery.ts:118-121` (`prior.sifId` becomes `prior.id` at `:129` and `:131`),
    `initial-setup.ts:606-609`, `hour-recovery-state.ts:76-79` (and the reference at `:71`),
    `restore-committed.ts:12-16`.
  - Read by identity, where an empty group must answer as "no allocation row" does today:
    `allocation-operation.ts:50-63` (`readAllocated`: `retained === undefined` becomes "the live
    identity's group is empty", `activation_superseded` as today); `reconcile-series.ts:20` (the
    `exists (… fiscal_allocations a where a.sif_id = s.id and a.environment = ?)` becomes
    `s.environment = ?`; an empty environment never equals, as a missing row never existed).
  - Read whole, which must filter `event_key is not null` or an empty group would be read as a
    malformed allocation: `hour-history-reader.ts:228-244` (the `allocations` array; the `sifs`
    array at `:217-227` keeps reading every row), `backup-verification.ts:55` (the intent records,
    `:89-108`), `backup-verification-history.ts:477-487` (the walk; the `fiscal_allocations` link at
    `:431` goes, the identity's at `:430` stays; `SCOPE`, `:81-87`, names the identity's columns).
  - Test helpers: `apps/server/src/testing/staged-hour-crash.ts:265`, `staged-hour-restore.ts:256`
    and `packages/fiscal-verifactu/test/live-conflict-fixture.ts:106` read through `allocationRows`
    (Interfaces).
- **Checks that now compare a row with itself**, deleted with the tests that reached only them
  (listed under "Assertions that change, by design"):
  - `allocation-operation.ts:59-61` — `retained.taxpayerNif !== sif.taxpayerNif`,
    `retained.softwareId !== sif.softwareId`, `retained.installationIdentity !== sif.identity`:
    `retained` and `sif` are now the same row. `:58` (against the taxpayer) and `:62` (against the
    stamped environment) stay.
  - `allocation.ts:415-417` — after `:414` has found the live identity is the prior activation's
    (`activeSif?.id !== prior.sifId`, which stays as `prior.id`), comparing their NIF, software id
    and installation number compares one row with itself.
  - `hour-history-reader.ts:137-141` — `sif === undefined` and the four comparisons of the
    identity's columns with the allocation's copies; the comparisons of the columns with the
    allocation's own JSON (`:142-147` onward) stay.
  - `backup-verification-history.ts:317-324` — the second lookup of the same row by `sif_id`: its
    `node_id` comparison is with itself, and its NIF, software id and installation number
    comparisons with the allocation JSON repeat `SCOPE` (`:302`) once `SCOPE` names the identity's
    columns.
- `FISCAL_START_AGAIN_DELETABLE` (`start-again-holdings.ts:6`) is removed with its export
  (`src/index.ts:49`) and its use in `packages/composition/src/modules.ts:32`, `:298` (Decisions).
  The module seat `startAgainDeletable` (`packages/module/src/module.ts:1527-1530`) stays: the
  held-files test fixture fills it (`apps/server/test/start-again-held-fixture.ts:26-39`).
- Deleted: `fiscal_allocations`, `schema/allocations.ts` (its `ActivationResult` re-export: importers
  take it from `allocation-types.ts`), its exports (`src/index.ts:50`, `schema/index.ts:19`),
  classification (`classification.ts:12`) and manifest entries, and
  `packages/fiscal-verifactu/test/later-installation.ts`, whose one export has no caller
  (`git grep -n "writeLaterInstallation\|later-installation" -- apps packages` finds only its own
  definition).

## Test set-ups the guard or the fold changes

Every search below was run at `9c66ef0356`; the builder re-runs each at the base and reconciles the
list before Task 2 (a site the list lacks is a stop only if it is not a fixture or an import,
rules §5.5). Counts exclude the product writers (`allocation.ts`, `registro-sif.ts`) and the files
fi8 deletes.

**1. Deleting an identity in a live database** (the no-delete trigger refuses):

```bash
git grep -n -i -E "delete from \"?(registro_sif|verifactu_identities)" -- apps packages scripts
git grep -l -E "[\"'](registro_sif|verifactu_identities)[\"']" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/**' | xargs /usr/bin/grep -l 'delete from ${sql.identifier'
```

| Site | Change |
| --- | --- |
| `packages/fiscal-verifactu/src/reserved-sif.test.ts:21-27` (the `afterEach`) | Deleted. `useVenueDb`'s own per-test reset (`packages/db/src/testing/venue-db.ts:218-224`) drops every trigger, empties every table and puts the triggers back after each test; this hook ran first and is now refused. |
| `apps/server/src/testing/clear-provision-fixture.ts:5-69`, reached by the six cases of `describe("clearProvisionFixture")` (`apps/server/src/provision.test.ts:432-…`; their venue's identity comes from `seedFixtureSif` through `packages/provisioning/test/allocated-venue.ts:25`) | The delete loop runs inside `withoutIdentityTriggers` (Interfaces). The cases assert counts only, unchanged. |
| `packages/fiscal-verifactu/src/restore.test.ts:118-140`, "THE REUSE EXPERIMENT" (delete at `:123`, un-revoke at `:124-126`) | Kept; both statements run inside `withoutIdentityTriggers`. What it then proves: a database that lacks a later identity, as an older backup brought back by a restore does (no trigger stops a restore bringing back an older file), still does not let restore re-take that later name, because restore takes the supplied one. Its assertions are unchanged. |
| `apps/server/src/handover-compare.test.ts:1307`; `packages/fiscal-verifactu/src/backup-verification-chain.test.ts:277`, `:308` | Unchanged: they edit a copy with every trigger dropped (`handover-compare.test.ts:220-232`, `backup-verification-chain.test.ts:127-145`). |
| `packages/fiscal-verifactu/src/backup-verification-history.test.ts:318-321` ("missing historical SIF") | Deleted (Assertions that change). |

**2. Changing a held identity column in a live database** (the guard refuses):

```bash
git grep -n -i -E "update \"?(registro_sif|verifactu_identities)" -- apps packages scripts
git grep -n -A3 -E "update\((registroSif|verifactuIdentities)\)" -- apps packages
```

30 raw and 16 drizzle sites at `9c66ef0356`. Those that change a column other than `revocado_en`:

| Site | Change |
| --- | --- |
| `allocation-operation.test.ts:639-675`, rows `"identity"` (`:653-654`) and `"software"` (`:669`) | Deleted with `allocation-operation.ts:59-61` (Assertions that change). The other six rows stay. |
| `allocation.test.ts:765-781` (three replay cases) | Deleted with `allocation.ts:415-417` (Assertions that change). |
| `hour-dormant-standby.test.ts:506` (`"sif-nif"`) | The set-up becomes `update tenants set tax_id = '50000000R'`: the check is `sif.nif !== tenant.taxId` (`hour-dormant-standby.ts:248`), reached now from the taxpayer's side. Assertion unchanged; if another refusal fires first, stop (rules §5.3). |
| `restore.test.ts:124-126` (un-revoke) | Row 1's `withoutIdentityTriggers`. |
| `backup-verification-chain.test.ts` (14 statements), `backup-verification-history.test.ts:297-307`, `:509`, `:743`, `backup-verification.test.ts:317`, `:380` | Copies with every trigger dropped (`backup-verification-history.test.ts:218-233`, `backup-verification.test.ts:148-163`): no guard change. The history and `backup-verification.test.ts` ones are re-pointed under 5. |

The rest set `revocado_en`, which the guard allows once. Six set it with no row filter, so on a
table that already holds a revoked identity they would rewrite that revocation, which the guard
refuses: `allocation-operation.test.ts:670`, `hour-dormant-standby.test.ts:505`,
`hour-standby-activation.test.ts:172`, `hour-surviving-history.test.ts:142`,
`reconcile.unheld.test.ts:168`, `:205`. Each gains `revocado_en is null` (drizzle:
`isNull(…revocadoEn)`), which changes nothing for an identity not yet revoked. The others name one
row (`allocation.test.ts:860`, `completed-recovery-document.test.ts:66`,
`conflict-recovery.test.ts:378`, `conflict-issuance.test.ts:124`,
`drain.conflict-recovery.test.ts:361`, `:406`, `hour-history-reader.test.ts:96`,
`hour-standby-activation.test.ts:381`, `hour-surviving-history.test.ts:113`,
`reconcile.conflicts.test.ts:200`) and are unchanged unless the run shows that row already revoked.

**3. Inserting an identity** without an allocation:

```bash
git grep -n -i -E "insert\((registroSif|verifactuIdentities)\)|insert into \"?(registro_sif|verifactu_identities)" -- apps packages scripts ':!packages/fiscal-verifactu/src/allocation.ts' ':!packages/fiscal-verifactu/src/registro-sif.ts'
```

31 sites in 20 files once fi8 has deleted `standby-allocation.test.ts` (six in
`allocation.test.ts`; three in `packages/provisioning/src/first-setup-runtime.test.ts`; two each in
`test/drain-fixtures.ts`, `registro-sif.test.ts`, `hour-history-reader.test.ts`,
`apps/server/src/hour-promotion.test.ts`; one each in `test/later-installation.ts` (deleted),
`test/fixtures.ts`, `reconcile.conflicts.test.ts`, `installation-start.test.ts`,
`initial-setup.test.ts`, `hour-recovery-state.test.ts`, `drain.conflict-recovery.test.ts`,
`conflict-issuance.test.ts`, `apps/server/src/testing/fiscal-fixtures.ts`,
`apps/server/src/testing/allocated-contract.ts`, `restore-fiscal-receipt.test.ts`,
`restore-fiscal-e2e.test.ts`, `restore-command.archive.test.ts`, `handover-minute-history.test.ts`).
**Unchanged**: each writes an identity with no allocation, which the empty group keeps legal and
reads as today. Two need a change:

| Site | Change |
| --- | --- |
| `apps/server/src/testing/allocated-contract.ts:71-89` | It copies the source's live identity row into a second database without its allocation. A `select()` now returns fourteen columns; the copy takes the seven identity columns only, so the group stays empty, as today's copy of `registro_sif` without `fiscal_allocations`. |
| `hour-history-reader.test.ts:131-151` (`seedRows`) with `:233-286` (`seedAllocation`) | `seedRows` takes an optional group and writes it in the one insert; `seedAllocation` passes it. The `change` keys of the cases at `:293-305` become the identity's names (`softwareId` → `idSistemaInformatico`, `installationIdentity` → `numeroInstalacion`; `nodeId`, `allocationKey`, `allocation`, `approval`, `result`, `bases` keep theirs). Read from the code (not run), each case's assertion holds without the deleted `:137-141`, and a failure is stop 2: every change still disagrees with the row's own JSON (`allocation.allocationId`, `allocation.softwareId`, `allocation.installationIdentity`, `approval.targetNodeId`) or fails the JSON and bases checks. |

**4. Writing a separate allocation:**

```bash
git grep -n -i -E "(into|update|delete from) fiscal_allocations" -- apps packages scripts
git grep -n -E "(insert|update|delete)\(fiscalAllocations\)" -- apps packages
```

The drizzle inserts at `9c66ef0356`: `allocation.ts:465` (product, Architecture),
`hour-history-reader.test.ts:266` (3 above), `test/later-installation.ts:52` (deleted),
`standby-allocation.test.ts:234` (fi8). The 13 raw statements are `update`s on copies with triggers
dropped (5 below) and `allocation.test.ts:909`, `:913` (Assertions that change).

**5. Reading `fiscal_allocations`:**

```bash
git grep -c -w "fiscalAllocations\|fiscal_allocations" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'
git grep -n -i -E "from fiscal_allocations|join fiscal_allocations|[\"'\`]fiscal_allocations[\"'\`]" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'
```

At `9c66ef0356` the first gives 520 lines in 122 files; 275 are `select().from(fiscalAllocations)`,
which the script rewrites to `allocationRows(…)`. The second gives 80 lines in 40 files, about 65
of them in tests: raw SQL and table-name lists, converted by hand. Raw SQL: `from fiscal_allocations`
becomes `from verifactu_identities where event_key is not null`, with `taxpayer_nif` → `nif`,
`software_id` → `id_sistema_informatico`, `installation_identity` → `numero_instalacion`,
`sif_id` → `id`, `activated_at` → `registrado_en`. A table-name list that already names the
identities loses `fiscal_allocations`. The copy edits in `backup-verification-history.test.ts`
(the `change` helper, `:243-250`, and the statements at `:309-316`, `:514`, `:748`, `:774`, `:783`,
`:890`, `:1086`) and `backup-verification.test.ts:366` take the same renames on the one row.
Two copy edits change meaning, because a renamed installation number now moves the intent record
with the identity (they changed only the identity before): `backup-verification.test.ts:317`
(expects `invalid`) and `:380` (expects `unsupported`). Run them; an assertion that no longer holds
is a stop (rules §5.3), not an edit.

`toEqual` against a selected identity row: the hits of
`git grep -n "revocadoEn:" -- '*.test.ts' | grep -v "set({\|values({"` at `9c66ef0356` are spreads
of a row selected earlier (`{ ...before, revocadoEn: expect.any(Date) }`), `toMatchObject`, or an
explicit column list; none writes out the seven columns by hand, so none changes.

## Assertions that change, by design

| Test | Change | Design |
| --- | --- | --- |
| `allocation-operation.test.ts:639-675`, rows `"identity"` and `"software"` | Deleted, with `allocation-operation.ts:59-61` | §1.1 (one row: "The FK to registro_sif is now the row itself", §5) and the guard (§1.1 "New guard trigger") |
| `allocation.test.ts:765-781`, "refuses replay after the retained SIF %s changes" (three cases) | Deleted, with `allocation.ts:415-417` | Same |
| `allocation.test.ts:735-761`, row `["audit result", "before insert on fiscal_allocations"]` | Deleted: the allocation is written by the identity insert, which the `"insert SIF"` row already refuses | §4 (`fiscal_allocations`: merge into `verifactu_identities`) |
| `allocation.test.ts:904-916`, "retains audit evidence against both update and deletion" | The two statements run on `verifactu_identities` (`allocation_key`, then a delete); the expected messages become the guard's and the no-delete trigger's constants | §1.1 guard; README "Additions of 6 November 2026" (no-delete) |
| `hour-history-reader.test.ts:290` | Reference `fiscal_allocations/event` becomes `verifactu_identities/allocation/event` | §4 (the table is gone) |
| `backup-verification-history.test.ts:318-321`, "missing historical SIF" | Deleted: an allocation can no longer outlive its identity (one row); a copy missing identity rows stays covered by `backup-verification-chain.test.ts:277`, `:308` | §1.1, §5 |
| `backup-verification-history.test.ts:297-299` ("registration node") and `:309` ("allocation node") | Both become `update verifactu_identities set node_id='missing' where event_key='event-0'`; one is deleted as a duplicate | §5 (one row) |
| `packages/composition/src/composition.test.ts:533-540` | Title and expectation: no module lists a Start-again-deletable table (`[]`) | §4; Decisions (Start again) |
| `start-again-holdings.test.ts:124-126`; `index.test.ts:8`, `:29` (`getTableName(fiscalAllocations)`) | Deleted with the constant and the export | §4 |
| `scripts/append-only-triggers.test.ts:46`, `schema-ownership.test.ts:20` | `fiscal_allocations` leaves the lists (the table is gone; the identity's guard is checked in `behavioural-triggers.test.ts`) | §5 |

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `verifactu_certificates` (a `local` table) | Unchanged (tables-fiscal §1.1) |
| The paper protocol's own records | fi8 decided what goes; the rest stays |
| The `startAgainDeletable` seat in `packages/module` | Stays (the held-files fixture fills it) |

## Interfaces

```ts
// packages/fiscal-verifactu/src/identity-allocation.ts
export interface IdentityAllocation {
  environment: string; eventKey: string; allocationKey: string; allocation: FiscalAllocation;
  approval: RecoveryApproval; bases: readonly { code: string; purpose: string }[]; result: ActivationResult;
}
/** The approval stored on an identity row, or undefined for an identity with none. */
export function allocationOf(row: typeof verifactuIdentities.$inferSelect): IdentityAllocation | undefined;

// packages/fiscal-verifactu/test/allocation-rows.ts (test-only)
/** Every identity with an allocation, in `fiscal_allocations`' old shape, by `registrado_en` then `id`. */
export function allocationRows(db: Database | Transaction): Promise<Array<{
  eventKey: string; allocationKey: string; nodeId: string; sifId: string; taxpayerNif: string;
  softwareId: string; environment: string; installationIdentity: string; allocation: unknown;
  approval: unknown; bases: unknown; result: unknown; activatedAt: Date;
}>>;

// packages/fiscal-verifactu/test/sif-fixture.ts (gains registerSif and writeReservedSif, moved)
export function seedFixtureSif(tx: Transaction, params: { nodeId: NodeId; nif: string; idSistemaInformatico: string; numeroInstalacion?: string }): Promise<SifRegistration>;
/** Drops the two identity triggers, runs `fn`, and recreates them from their stored text, in one transaction. */
export function withoutIdentityTriggers<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T>;
```

## Files

**Modify:** as listed in "What it builds" and "Test set-ups", plus `schema/verifactu-identities.ts`
(fi1's name for `schema/sif.ts`), `trigger-refusals.ts`, `triggers/fiscal-verifactu.sql`,
`registro-sif.ts` (loses `registerSif`, `writeReservedSif` and their export at `src/index.ts:31`),
`src/index.ts`, `classification.ts:12`, the manifest's fiscal entry, `start-again-holdings.ts`,
`packages/composition/src/modules.ts:32`, `:298`, `packages/fiscal-verifactu/test/sif-fixture.ts`,
`src/testing/seed.ts:1`, `test/fixtures.ts:1`, `test/drain-fixtures.ts:1` (their imports),
`scripts/behavioural-triggers.test.ts`, `scripts/append-only-triggers.test.ts`,
`scripts/schema-constraints.test.ts` (the new unique indexes), and
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`: `fiscal_allocations` held 0 rows in
every captured phase (`packages/country-es/test-fixtures/demo/madrid-before-move.manifest.json`), so
it joins `REMOVED_TABLES`; the captured `registro_sif` row gains the seven nullable columns, each
null, the way the test already adds columns to `registros_facturacion` (`seed.madrid-baseline.test.ts:148-157`).

**Create:** `packages/fiscal-verifactu/src/identity-allocation.ts`,
`packages/fiscal-verifactu/test/allocation-rows.ts`; `scripts/a1308/fiscal-allocations-fold.mjs` — a
re-pointing script (rules §1, fi1's parser and idempotence rules): in tracked `.ts` files under
`apps/` and `packages/`, `<receiver>.select().from(fiscalAllocations)` with no further chained call
becomes `allocationRows(<receiver>)` with the import added; raw SQL naming `fiscal_allocations` is
printed for hand conversion, not rewritten. It prints every other site.

**Delete:** `packages/fiscal-verifactu/src/schema/allocations.ts`,
`packages/fiscal-verifactu/test/later-installation.ts`.

**Generated:** `packages/fiscal-verifactu/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: schema and CHECK 35, triggers and constants 30, `activate` 25, `allocationOf` 25, readers 145 (history reader 40, backup readers 37, the rest 68), exports, classification, Start again 15, staged-hour helpers 6 | ~280 |
| Script | ~90 |
| Tests: trigger, CHECK and unique cases 140; fixture writers moved and `withoutIdentityTriggers` 110; `allocationRows` 30; hand-converted SQL and lists 110; `hour-history-reader` set-up 40; backup copy edits 30; the other set-ups (contract copy, clear-fixture, reuse experiment, revocation filters, tenant case, allocation tests, guards, demo capture) 75 | ~535 |
| **Total** | **~905** |

Not counted: the script's output, the deletions (`schema/allocations.ts`, `later-installation.ts`,
the deleted cases and branches), the generated migration. Inside the cap; stop 6 of rules §5 applies
past about 1,100.

## Finish line

```bash
node scripts/a1308/fiscal-allocations-fold.mjs --check
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/allocation.test.ts src/allocation-operation.test.ts src/allocation-identity.test.ts src/allocation-envelope.test.ts src/hour-activation.test.ts src/hour-history-reader.test.ts src/hour-history.test.ts src/hour-selection.test.ts src/hour-recovery-state.test.ts src/hour-recovery-preparation.test.ts src/hour-standby-activation.test.ts src/hour-dormant-standby.test.ts src/hour-surviving-history.test.ts src/restore-committed.test.ts src/restore.test.ts src/cloud-preparation.test.ts src/conflict-recovery.test.ts src/conflict-recovery-routes.test.ts src/conflict-issuance.test.ts src/drain.conflict-recovery.test.ts src/reconcile.conflicts.test.ts src/reconcile.unheld.test.ts src/reconcile-series.test.ts src/completed-recovery-document.test.ts src/initial-setup.test.ts src/installation-start.test.ts src/start-again-holdings.test.ts src/backup-verification.test.ts src/backup-verification-history.test.ts src/backup-verification-chain.test.ts src/registro-sif.test.ts src/reserved-sif.test.ts src/minute-selection-unknown-name.test.ts src/index.test.ts src/schema-ownership.test.ts
# and fi1's record suites
pnpm --filter @waitron/server exec vitest run src/first-fiscal-hour-finish.test.ts src/first-fiscal-setup.e2e.test.ts src/hour-promotion.test.ts src/hour-recovery-host.test.ts src/restore-fiscal-e2e.test.ts src/restore-emergency-crash.e2e.test.ts src/handover-activation.test.ts src/handover-minute-history.test.ts src/live-conflict-recovery.test.ts src/mirror-bundle-api.test.ts src/mirror-bundle.test.ts src/reserved-identity.test.ts src/provision.test.ts src/first-setup-start-again-held.test.ts src/first-setup-start-again-held-recovery.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/venue-operation.fiscal.test.ts src/first-setup-command-import.test.ts src/first-setup-runtime.test.ts src/throwaway-allocation.test.ts
pnpm --filter @waitron/composition exec vitest run src/composition.test.ts
pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts
git grep -nw "fiscal_allocations\|fiscalAllocations\|FISCAL_START_AGAIN_DELETABLE\|writeLaterInstallation" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing. CI runs the package suites (rules §4); a server or provisioning file the
searches above name and this line omits is still read in CI's result before the pull request is
called green.

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue`. Under `phase=sql-only` (missing
lines simulated on 2026-11-08 from `a086eedfb7` with fi1–fi8 applied; the extras from this plan):

```text
missing index fiscal_allocations.primary key(event_key)
missing index fiscal_allocations_allocation_uq
missing index fiscal_allocations_identity_uq
missing table fiscal_allocations
changed table verifactu_identities.columnOrder
old: ["id","node_id","nif","id_sistema_informatico","numero_instalacion","registrado_en","revocado_en"]
new: [<the seven, with environment, event_key, allocation_key, allocation, approval, bases, result in the order the schema declares them>]
extra table verifactu_identities.checks[verifactu_identities_allocation_ck]
extra table verifactu_identities.columns[allocation]
extra table verifactu_identities.columns[allocation_key]
extra table verifactu_identities.columns[approval]
extra table verifactu_identities.columns[bases]
extra table verifactu_identities.columns[environment]
extra table verifactu_identities.columns[event_key]
extra table verifactu_identities.columns[result]
extra index verifactu_identities_allocation_uq
extra index verifactu_identities_event_key_uq
extra trigger verifactu_identities_guard_update
extra trigger verifactu_identities_no_delete
```

If the owner keeps the second index, add `extra index verifactu_identities_identity_uq`. Under
`phase=migrated` and `phase=change-feed`, the same plus
`missing trigger fiscal_allocations_append_only_delete` and `…_update`; if the change-feed phase
lists `waitron_change_verifactu_identities_update`, its `.when` changes with the column list
(rules §3) and is marked as predicted. The builder records the `new:` column order the schema
produced. Design reasons: tables-fiscal §5, `fiscal_allocations` ("the guard trigger holds these
columns fixed, and both uniques are kept. The FK to `registro_sif` is now the row itself"; the
second unique and `not null` are this plan's decisions above) and `registro_sif` ("plus a new guard
trigger"); README "Additions of 6 November 2026" for the no-delete trigger.

## Stop points (beyond rules §5)

1. **A writer legitimately changes a guarded identity column** (the §8 item 5 rule applied to this
   guard). Fallback, confirmed by the watcher: that column comes off the list, with the reason at its
   constant.
2. **A history-reading or backup test changes its decision** after Task 2 (an `incomplete`
   contradiction, a refused name, a different selection, `backup-verification.test.ts:317` or
   `:380`). No fallback is pre-chosen: the empty group was meant to keep every such decision; the
   watcher decides.
3. Any change to which identity a sale uses, which installation names are refused, or to the bytes
   of a record's hashed fields.
4. A product path deletes an identity row (Start again included).

## Needs

fi8; fi6 (creates `triggers/fiscal-verifactu.sql` and `trigger-refusals.ts`). The Cloud lane's
fixture change, in step. The owner's answer on the second unique index, or its default.

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: the columns, the guard and the fixture writers (test first)

- [ ] **Step 1: Failing cases** in `scripts/behavioural-triggers.test.ts`: changing each guarded
  column refused; filling an empty group after the insert refused; setting `revocado_en` again
  refused; clearing it refused; deleting an identity refused (one with no record, so the record key
  is not what refuses). Accepting controls: activation's revocation of the live identity; activating
  a new identity; inserting an identity with an empty group. In the package's schema test: the CHECK
  refuses a group half set (one case per column left empty while `event_key` is set, and one with
  only `event_key` set); unique cases for a second identity with the same `allocation_key`, the
  same `event_key`, and (if kept) the same `(nif, id_sistema_informatico, environment, numero_instalacion)`;
  two identities with empty groups accepted.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Add the columns, CHECK, indexes, triggers and constants; `activate` writes the one
  row after the series; move `registerSif` and `writeReservedSif` into `test/sif-fixture.ts`
  unchanged (they write an empty group) and add `withoutIdentityTriggers`; rebuild the set. Run;
  PASS.
- [ ] **Step 4:** Commit: "An identity row carries the approval that granted it, held fixed (A1308
  fiscal 9)".

### Task 2: the test set-ups the guard refuses

- [ ] **Step 1:** Re-run the searches of "Test set-ups" 1–3 on this branch and reconcile.
- [ ] **Step 2:** Make the changes of 1–3 (the deletions listed under "Assertions that change" wait
  for Task 3, with the branches they reach).
- [ ] **Step 3:** Run the Finish line's fiscal-verifactu line and `apps/server`'s
  `src/provision.test.ts src/mirror-bundle-api.test.ts src/mirror-bundle.test.ts src/reserved-identity.test.ts`.
  **Passing:** the only failures are the cases Task 3 deletes or re-points. **Failing:** any other
  failure; a refusal from `verifactu_identities_guard_update` in a product path is stop 1, a changed
  history decision stop 2.
- [ ] **Step 4:** Commit: "Test set-ups that deleted or rewrote identities (A1308 fiscal 9)".

### Task 3: re-point the readers; delete the table

- [ ] **Step 1:** Write and run `scripts/a1308/fiscal-allocations-fold.mjs`; commit its output
  alone. Convert the sites it printed by hand ("Test set-ups" 4–5).
- [ ] **Step 2:** Add `allocationOf`; re-point the product readers listed in "What it builds",
  through it; in the history and backup readers, the `event_key is not null` filter and the new
  reference. Delete the self-comparisons and the tests listed under "Assertions that change", and
  change the other assertions listed there.
- [ ] **Step 3:** Delete `fiscal_allocations`, its entries and `later-installation.ts`; remove
  `FISCAL_START_AGAIN_DELETABLE`. Rebuild the set. Run the Finish line. PASS. Commit: "Remove
  fiscal_allocations, now part of each identity (A1308 fiscal 9)".

### Task 4: protection list, documents, finish

- [ ] **Step 1:** Protection list against `<A>`: exactly "Expected protection-list difference".
- [ ] **Step 2: Documents** (rules §9): delete "`registro_sif`: decide the remaining DELETE
  restriction (A805 follow-up)" from the bundle; add to `grants-retirement-audit.md` after `:144`:
  "**2026-11-xx:** `registro_sif` (now `verifactu_identities`) was settled by A1308 fiscal 9: an
  identity is never deleted (`verifactu_identities_no_delete`), and only `revocado_en` may change,
  once." `docs/developers/conventions-data.md`: sentences naming `fiscal_allocations` name the
  identity row's allocation columns. tables-fiscal §1.1: a dated line recording the nullable group
  and the owner's answer on the second unique index. Tell the Cloud lane the table and column map
  (the script's header lists it).
- [ ] **Step 3:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset`.
