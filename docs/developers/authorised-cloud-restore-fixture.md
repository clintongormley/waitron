# A disposable venue for an authorised ordinary restore

Cloud's backup-data verifier does not grant permission to restore a fiscal venue. For D79's
separate ordinary-restore exercise, use the existing `archiveHost()` fixture in
[`apps/server/test/hour-recovery-host.ts`](../../apps/server/test/hour-recovery-host.ts).
Its companion `archiveCommand()` builds the ordinary restore command's arguments and private
environment. This is a test fixture, not an operator procedure for an installed venue.

## Reproduce the fixture

The qualification below uses Waitron commit `0ee4ec275461cae439b74ef62bfba884b9466d12`,
Node `v26.11.1` and Vitest `4.1.12`. Use an isolated checkout at that commit and install with
`pnpm install --frozen-lockfile`. Run from its root:

```sh
node scripts/run-with-deadline.mjs 600 -- pnpm --filter @waitron/server exec vitest run \
  src/hour-recovery-placement-1.test.ts \
  src/hour-recovery-placement-2.test.ts \
  src/hour-recovery-placement-3.test.ts --maxWorkers=1
```

On 2026-10-22 this command exited 0 with **3 files and 99 tests passed**, in 118.62 seconds.
The unedited `write-path.e2e.test.ts` and `inmutabilidad.test.ts` in
`@waitron/fiscal-verifactu` also passed: 2 files, 20 tests, exit 0. No implementation,
fixture, test assertion, migration or restore rule was changed for this qualification.

The helper registers Vitest setup and teardown hooks. Import it from a Vitest suite, rather
than running the helper as a standalone Node script. `useVenueDb` owns the source database;
the helper creates and removes its own temporary `hour-recovery-host-*` directory.

Identify this fixture by its helper and source commit. It uses `TENANT_A`, taxpayer test value
`89890001K`, node `a0000000-0000-4000-8000-000000000008` and location
`a0000000-0000-4000-8000-000000000002`, stamped `preproduction`. The source location's name
comes from the existing fiscal test seed; it is not Cloud's `Cloud Test Venue` fixture.

## Keep the authority attached to its own archive

Build the fixture through its existing setup and helpers:

1. The helper's setup seeds the disposable database and calls `mintBreakGlassKey` for its
   node. Retain the returned `key.secret` privately for this run. The archive password is
   a different secret. Initial setup goes through `createHourPreparation` and
   `activatePreparedModuleAllocation`; the test then sets the recovered counters to 123.
2. `archiveHost()` archives that database, builds and encrypts its archive, then calls
   `previewRecoveryArchive`. The resulting source identifier binds recovery to those
   encrypted bytes. It constructs `createSelectedRecoveryPreparation` with that selection,
   the node key, all composed modules and explicit old-machine-offline and sole-recovery
   facts. It compares clocks and selects the recovery hour through the preparation API.
3. Keep `f.outcome.input`, `f.options.binding`, `f.roots` and the preparation journal together.
   `archiveCommand(f)` writes the encrypted artifact and the operation JSON, constructs the
   migrations directory and supplies `WAITRON_RECOVERY_OPERATION_FILE`,
   `WAITRON_NODE_RECOVERY_KEY`, `WAITRON_BACKUP_RECOVERY_KEY`, the owned state and venue paths,
   and both `--confirm-old-box-gone` and `--confirm-sole-recovery`.
4. Follow the existing case **“the default archive command reconstructs selected-hour
   preparation with explicit isolation”** in
   [`hour-recovery-placement-1.test.ts`](../../apps/server/src/hour-recovery-placement-1.test.ts).
   It supplies a controlled usable internet-clock observation before calling `runRestore`
   with those arguments. The helper controls the date and release clock too; these are test
   observations, not a check of a real clock service.

The fixture supplies its isolation facts. It does not prove a separate running server stopped.
D79 must arrange its own disposable source's isolation before the separately authorised restore.

The command case asserts exit 0 and its restored-artifact message. It opens the restored
database and checks active series `A-06RC`, `FF-06RC`, `R-06RC`, recovered retired counters
`123, 123, 123`, two fiscal allocation rows, unchanged preparation history and no archive
password or node secret in output. The ordinary restore performs a separately authorised
fiscal recovery; do not describe that operation as having made no fiscal activation.

The same suites also contain the wrong-node-key control and **“a valid node key without
module preparation refuses before replacing the destination”**. The latter expects
`sif.allocation_invalid` with `outside_confirmation_missing` and checks both destination
sentinels remain unchanged. Keep both controls when adapting the fixture. A key and an
operation JSON file alone do not replace the saved preparation and its confirmation.

## What D79 still needs to execute

Use this existing fixture as the authority recipe for D79's disposable ordinary-recovery
exercise. Do not transplant its key, operation or preparation journal onto the previously
captured `Cloud Test Venue` archive. Those are different sources. Creating a new capture
also requires preparing recovery against that capture's exact source identifier.

The helper's archive includes synthetic state entries and is not qualified here as an input
to the complete Cloud data verifier. This qualification runs the ordinary restore and its
existing controls. It does not run Cloud capture, publication, verifier-container isolation,
catalogue admission, v2 recovery, continuous-source absence or published-image qualification.
It supplies no portable artifact or production credential. The test tears down its generated
secrets and files.

D79 must execute and retain its own same-run proof using its actual pinned Waitron runtime.
Keep its existing `FISCAL_RESTORE` refusal receipt. Do not mark that receipt successful using
the independent test run above, combine phase evidence from different runs, or enable
snapshots on the strength of this qualification.

Distinguish the verifier's `activation: "not_attempted"` from the separately authorised
ordinary restore, which creates the fresh fiscal allocation described above. At the time
of this handover, D79's unpublished strict validator requires both ordinary restore executed
and recovery activation not attempted. Lane D needs to reconcile that evidence wording with
the real authorised restore, while retaining its checks that verification grants no authority
and moves no route. This document changes neither restore rules nor Cloud's validator.
