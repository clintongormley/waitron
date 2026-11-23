# A1308 fiscal 4 — Move verified clock steps into fiscal history

Fi5 moves observed and lookup conflicts into the shared history, Fi6 moves filing case notes there,
and Fi7 keeps AEAT answers there when they are cleared. Fi8–Fi11 use other tables. Keeping today's
conflict tables would avoid Fi5's move, but Fi6 would still need a store for notes and Fi7 would
still need an append-only store for answers. The [agreed A1308 design](../specs/2026-11-02-rationalisation/README.md)
gives them one home. Before Fi5, the verified clock step is the only writer the table needs.
The live caller uses the returned confirmation ID. Backup retention reads the incident, and
backup verification compares the stored row as history. No product decision reads its payload
(`apps/server/src/clock-correction.ts:175–185`, `packages/fiscal-verifactu/src/clock-step.ts:172–186`,
`packages/fiscal-verifactu/src/backup-verification-history.ts:497–501`).

Claude's review proposed dropping the two dead tables, trimming `clock_confirmations` and letting
Fi5 create shared history when the first product reader needs it. That would make Fi4 smaller and
move table creation into Fi5. Lane E recommended keeping the agreed destination for verified clock
evidence and combining the storage and writer in one PR and one reset. The owner answered “lane e's
view” and the watcher cleared that combined slice (Lane E's `questions.md`, 2026-11-23 13:55 and
13:59 CET). Land these revised plans on the docs branch before building.

**Base** is Fi3 at `f971e5506c`, including A1420 #3003 (`6e88c96309`). Follow the
[slice rules](2026-11-08-a1308-slice-rules.md). Estimate 400–600 hand-written lines including tests.
Stop for the watcher if the change grows past about 900 lines. **Landed by the owner.** Open the
one PR with “Every venue is reset: fiscal-verifactu; backups and exports from before this cannot be
restored or imported.”

## Global constraints

- Put `verifactu_history_data_ck` before the per-kind CHECKs. Test malformed JSON against that
  named CHECK before any later expression can try to read it. Wrap every per-kind CHECK as
  `kind <> '<kind>' OR coalesce(condition, 0)` so a missing JSON key fails.
- Keep invoice numbering, hashes, chain and record writes, and all clock admission, start
  confirmation and payment decisions as they are.
- The owner's 2026-11-09 guard was for a confirmation carrying a clock-check ID (see the original
  Fi4a plan, “A confirmation names a clock check”). A1420 removed the relationship. Fi4 uses
  the normal append-only triggers, and [Fi6](2026-11-08-a1308-fi6-cases-into-submissions.md)
  creates the module's first hand-written trigger file for its submission guards.

## Task 1. Pin the storage and live writer

- [ ] Take the base protection list from `apps/server` (rules §3).
- [ ] In `packages/fiscal-verifactu/src/schema/verifactu-history.test.ts`, use `useVenueDb` with
      fiscal migrations and seed real nodes and people. Accept admin and staff rows.
      Check the named refusals for malformed JSON and an array, an unknown kind, and each wrong
      value or missing JSON key in the per-kind CHECKs below. Also check duplicate `seq`, missing
      node and person parents, restricted deletion of a linked person, and append-only refusals on
      UPDATE and DELETE. In `src/history.test.ts`, assert that two appends with decreasing `at`
      get sequences 1 and 2 and that each returned ID names the stored payload.
- [ ] Re-point the storage assertions in `src/clock-step.test.ts` and the server's
      `src/{boot.clock-watch,clock-set.route,till-box-clock-api}.test.ts` to `clock.confirmed`.
      Use a fixture-local projection for the stored values. Seed real people for hard-coded IDs
      (for example with `seedPerson` from `@waitron/db/testing/seed.js`). Add a verified step of
      999.6 ms and assert stored 1000 and raw 999.6 in the proof and incident. Keep the latest-step
      test that skips zero, generating a verified zero-step incident through the live writer.
      Run the new schema, writer and live cases before the move and confirm that they fail
      because the new storage or writer is missing.
- [ ] Add `src/schema/verifactu-history.ts` in the fiscal package, with `id` as the primary key
      defaulted by `newId`, required `seq` as a `count` with `verifactu_history_seq_uq`, and
      required `kind`, `node_id`, `at` and `data` using `label`, `id`, `ts` and `json`.
      Link `node_id` to `nodes.id` and nullable `person_id` to `persons.id`, both with restricted
      deletion (design U11). Declare these CHECKs in order.
  - `verifactu_history_data_ck` requires valid JSON with an object at its root.
  - `verifactu_history_kind_ck` admits `clock.confirmed`.
  - The `verifactu_history_confirmed_` CHECKs end in `source_ck` (admin or staff), `reason_ck`
    (start or unusable), `person_ck` (a nonempty person ID) and `shape_ck` (text `confirmedAt`,
    integer `stepMs`, object `proof`).
- [ ] In `src/history.ts` implement
      `appendHistory(tx: Transaction, entry: HistoryEntry): Promise<{ id: string; seq: number }>`.
      The entry has `kind: "clock.confirmed"`, `nodeId: NodeId`, `at: Date`, `personId: string`
      and `data: { confirmedAt: string; stepMs: number; source; reason; proof }` with the types
      above. Assign `max(seq) + 1`, starting at 1, and insert in the caller's write transaction.
- [ ] In `src/clock-step.ts:115–165` call `appendHistory` in place of the old sequence lookup
      and insert. Use the before reading for `at`, ISO after reading for `data.confirmedAt` and
      `Math.round(input.stepMs)` for `data.stepMs`. Carry `source`, `reason` and `storedWitnesses`.
      Staff proof names the till under `staff`. An admin on a till has a separate `device` beside
      `admin`. Keep `proof.step` with before, after, target and raw milliseconds. Keep the raw step
      in the incident. A verified step of any size writes the history and linked incident in one
      transaction. Use the new ID and sequence in the existing `ClockStepRecorded` return, with
      `confirmation.checkId` and `confirmation.recordId` still null. An unverified move writes only
      an incident with a null confirmation ID when its absolute size exceeds 1000 ms. At or below
      1000 ms it writes nothing. Remove the writer's old table description.
- [ ] Keep `request.admin.personId` as the source of the person. The dashboard uses the authorised
      management session (`apps/server/src/box-health-api.ts:222–253`), the till uses its staff
      session person or authorised administrator, including a PIN override
      (`till-box-clock-api.ts:348–367`), and mirror promotion uses its authenticated operator
      (`apps/server/src/node-operation-preparation.ts:160–181`). The setup and
      restore setter writes its setup note through its own backend
      (`apps/server/src/setup-clock-set.ts:108–119`).
- [ ] Keep `latestClockStep` reading the last nonzero `clock.corrected` incident in insertion order
      (`clock-step.ts:172–186`), including large unverified moves. Backup retention checks the
      in-flight or pending step first (`apps/server/src/clock-correction.ts:367–372`,
      `boot.ts:3600–3606`). Keep the tests for both paths.

## Task 2. Replace the schema and backup links

- [ ] Export the new table from `src/schema/index.ts` and replace the old tables in the fiscal
      `classification.ts` (use `appendOnly` as `ledger`), migration manifest, fiscal
      `schema-ownership.test.ts` and root `append-only-triggers` and `schema-constraints`
      expectations. Delete `src/schema/{clock-checks,clock-confirmations,clock-stop-restarts}.ts`
      and their barrel exports. Add the history table to the Madrid seed test's `ADDED_TABLES` and
      the three old tables to `REMOVED_TABLES` (captured counts are zero). Keep the capture files.
- [ ] Rebuild once with `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`.
      Check the generated CHECK order and run the Task 1 cases to green.
- [ ] In `src/backup-verification-history.test.ts`, replace the three retired fixture rows with
      a valid verified step. Keep the valid backup case. Use the existing matching-copy corruption
      helper to put a missing node ID or missing person ID in the history row, in separate cases.
      Run those controls before replacing the six verifier links in
      `src/backup-verification-history.ts:445–450` with `verifactu_history.node_id → nodes.id` and
      `verifactu_history.person_id → persons.id`. Require the valid backup to be accepted and each
      corrupt copy refused. Retire the old check and record link cases and the duplicate node cases.
- [ ] Confirm the first-setup guard before relying on the person link. Configuration import may
      delete non-admin people (`packages/provisioning/src/configuration-transfer.ts:873–879`).
      Its production caller is a `provisionVenue` callback (`apps/server/src/boot.ts:1759–1771`).
      `provisionVenue` checks for an existing taxpayer before invoking that callback
      (`apps/server/src/provision.ts:124–137,183–191`), so this path runs before a verified staff
      step can exist. Keep the first-setup import and repeat-provision cases green.
- [ ] Retire `src/clock-confirmations.test.ts` and `src/clock-stop-restarts.test.ts`. List the
      retired assertions and guard baseline edits in the PR. The new schema tests carry the
      live sequence, append-only, node, source, reason and person protections. The deleted check
      reasons, check uniqueness and links, record pairing, restart uniqueness and stop-only values
      leave with their tables. In live suites retire `clock_checks` counts and the old stored
      null `check_id`, `registro_id` and `record_at` slots. Keep the other storage and return
      assertions, including the null links on the returned confirmation.
- [ ] Search the tracked tree for the three table names and their TypeScript exports. Account for
      the demo capture and its retirement list and dated historical receipts. Remove the finished
      backlog entries in `docs/backlog/{architecture,box}.md` and update the live step paragraph in
      `docs/developers/conventions-data.md`, preserving the historical receipts.

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/{clock-step,clock-step.setup-source,chain.earlier-time,backup-verification-history,history,classification,schema-ownership,schema/schema-conformance,schema/verifactu-history,write-path.e2e,inmutabilidad}.test.ts
pnpm --filter @waitron/server exec vitest run src/{boot.clock-watch,clock-set.route,till-box-clock-api,clock-unconfirmed-gate,clock-correction.backup-hold,handover-preparation,provision,first-fiscal-setup.e2e}.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/{append-only-triggers,append-only-migration-sets,behavioural-triggers,schema-constraints,classification-complete,starting-migrations,migration-upgrade,two-file-foreign-keys}.test.ts
```

Require passing test counts for all three commands and keep the golden huella (invoice
fingerprint) and `inmutabilidad` suites unedited.

## Expected protection-list difference

Prediction for `composition=fiscal-verifactu database=venue` in all three phases.

- `extra table verifactu_history`, `extra index verifactu_history.primary key(id)` and
  `extra index verifactu_history_seq_uq`. Inspect the new table in the JSON for both foreign keys
  and all six CHECKs.
- `missing table` for each of `clock_checks`, `clock_confirmations` and `clock_stop_restarts`.
  `missing index` for their three `<table>.primary key(id)` entries and for `clock_checks_seq_uq`,
  `clock_confirmations_seq_uq`, `clock_confirmations_check_uq`, `clock_confirmations_registro_idx`
  and `clock_stop_restarts_registro_uq`.
- In `migrated` and `change-feed` also expect `extra trigger` for
  `verifactu_history_append_only_delete` and `verifactu_history_append_only_update`, and
  `missing trigger` for both `<table>_append_only_delete` and `<table>_append_only_update` for
  each retired table.

Take the after list and account for each line of the comparison in the one PR. Run
`/finish-branch` with one whole-branch review wave. After the owner lands it, handle the single
venue reset under the slice rules and Lane E's Santet owner-reset rule.

## Stops beyond the slice rules

1. The app's SQLite accepts a row that a per-kind CHECK should refuse, or the generator puts a
   JSON-reading CHECK before the data CHECK. Take the result to the watcher before using the
   design's fallback of a typed nullable column with a plain CHECK.
2. A live clock path cannot supply the required person, or a product import reaches person
   replacement after a venue has recorded a verified staff step.
