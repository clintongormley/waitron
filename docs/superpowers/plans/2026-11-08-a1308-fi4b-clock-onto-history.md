# A1308 fiscal 4b — Move the verified clock step and remove the old tables

After [Fi4a](2026-11-08-a1308-fi4a-history-table.md), move the verified step's single write in
`packages/fiscal-verifactu/src/clock-step.ts:115–153` to `verifactu_history`. A1420 #3003
(`6e88c96309`) removed the old stop's readers and writers. Retire `clock_checks`,
`clock_confirmations` and `clock_stop_restarts` after moving the remaining write. Follow the
[slice rules](2026-11-08-a1308-slice-rules.md). Estimated 40–70 code lines and 160–230 test lines,
plus deletions. **Landed by the owner.** Open the PR with “Every venue is reset: fiscal-verifactu;
backups and exports from before this cannot be restored or imported.”

## Move the write

- [ ] Take the base protection list (rules §3). Re-point the live assertions in
      `clock-step.test.ts` and the server's `boot.clock-watch.test.ts`, `clock-set.route.test.ts` and
      `till-box-clock-api.test.ts` to the new kind. Check that they fail while the old writer is in use.
      Use a fixture-local projection for stored fields and seed real people for hard-coded ids
      (for example with `seedPerson` from `@waitron/db/testing/seed.js`). Add a verified step
      of 999.6 ms to pin stored 1000 and raw 999.6 in the proof and incident.
- [ ] Replace the sequence lookup and insert with Fi4a's `appendHistory` in the supplied
      transaction. Store `at` from the before reading, ISO `data.confirmedAt` from the after reading
      and `Math.round(input.stepMs)` in `data.stepMs`. Carry `source`, `reason` and `storedWitnesses`:
      staff proof names the till under `staff`, and an admin on a till has a separate `device` beside
      `admin`. Keep `proof.step` with before, after, target and raw milliseconds. Keep the raw step in
      the incident too. Use the history id and sequence in the existing `ClockStepRecorded` return,
      with `confirmation.checkId` and `confirmation.recordId` null. A verified step writes the row
      and linked incident in one transaction regardless of size. An unverified step
      writes only an incident when the absolute move exceeds 1000 ms, with a null confirmation id.
      At or below 1000 ms it writes nothing.
- [ ] Keep the person from `request.admin.personId`: the dashboard takes the authorised management
      session person (`box-health-api.ts:222–253`), the till takes its staff session person or the
      authorised administrator, including a PIN override (`till-box-clock-api.ts:348–367`), and mirror
      promotion uses its authenticated operator and requires a person name
      (`node-operation-preparation.ts:160–181`). The setup and restore setter writes its setup note via
      its own backend (`setup-clock-set.ts:108–119`). Stop if a real path fails Fi4a's U11 person link.
- [ ] Rerun the live cases. Preserve clock admission, start confirmation and payment decisions.
      `latestClockStep` still takes the last nonzero `clock.corrected` in insertion order
      (`clock-step.ts:172–186`); backup retention checks the in-flight or pending step first
      (`clock-correction.ts:367–372`, `boot.ts:3600–3606`). These paths must still see large
      unverified moves. Keep the test that skips a zero step by generating a verified zero-step
      incident with the live writer in place of the old synthetic authority confirmation.

## Remove the three tables and their wiring

- [ ] Delete `src/schema/{clock-checks,clock-confirmations,clock-stop-restarts}.ts` and the barrel
      exports. Remove their fiscal classification, manifest, schema ownership, root append-only and
      schema-constraint entries.
      In the Madrid seed test, add the three names to `REMOVED_TABLES` (all captured counts are zero).
      Keep the capture files. Rebuild with
      `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`.
- [ ] In `backup-verification-history.ts`, replace the six old links with
      `verifactu_history.node_id → nodes.id` and `person_id → persons.id`. In its test, replace the
      three retired fixture rows with a valid verified step. Keep the valid no-record case and
      matching-copy corruption refusal for the node link, and add the person-link case. Retire the
      removed check/record link cases and duplicate old node-link checks. Prove the new failing cases
      before replacing the verifier links.
- [ ] Retire `clock-confirmations.test.ts` and `clock-stop-restarts.test.ts`. Fi4a carries the live
      sequence, append-only, node, source, reason and person protections. The deleted check reasons,
      check uniqueness and links, record pairing, restart uniqueness and stop-only values leave
      with their tables. In live suites, retire the `clock_checks` counts and the old row's null
      `check_id`, `registro_id` and `record_at` slots. Keep all remaining stored values and return
      assertions, including the null links on the confirmation.
      Record those retirements and the guard baseline edits in the PR. Search the full tracked tree
      for the old names, with the demo capture and its retirement list as expected data hits.
      Remove the finished backlog entries in `docs/backlog/{architecture,box}.md` and update the live
      step paragraph in `docs/developers/conventions-data.md`, preserving historical receipts.

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/{clock-step,clock-step.setup-source,chain.earlier-time,backup-verification-history,history,classification,schema-ownership,schema/schema-conformance,schema/verifactu-history,write-path.e2e,inmutabilidad}.test.ts
pnpm --filter @waitron/server exec vitest run src/{boot.clock-watch,clock-set.route,till-box-clock-api,clock-unconfirmed-gate,clock-correction.backup-hold,handover-preparation}.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/{append-only-triggers,append-only-migration-sets,behavioural-triggers,schema-constraints,classification-complete,starting-migrations,migration-upgrade,two-file-foreign-keys}.test.ts
```

Require passing test counts, with golden huella and `inmutabilidad` unedited.

## Expected protection-list difference

For `composition=fiscal-verifactu database=venue`, all three phases should report `missing table` for
the three retired tables and `missing index` for each table's `<table>.primary key(id)` plus
`clock_checks_seq_uq`, `clock_confirmations_seq_uq`, `clock_confirmations_check_uq`,
`clock_confirmations_registro_idx` and `clock_stop_restarts_registro_uq`. In `migrated` and
`change-feed`, also expect two `missing trigger` lines per retired table
(`<table>_append_only_delete` and `<table>_append_only_update`). The protections needed by the
verified step are already in Fi4a. Compare the lists and account for each line in the PR. Apply the
slice-rule stops, run `/finish-branch` and reset after the owner lands.
