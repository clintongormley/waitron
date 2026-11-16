# A1308 pa2: refuse payment deletion and restore/watch its triggers

**Result:** Every payment delete is refused. Boot repairs missing payment guards, refuses altered
ones, and the trading watch stops on missing or altered guards, including with Payments Off.
Ordinary capture remains allowed. Pa1 (#3465) landed as `4f5b758700`; **the owner lands pa2**.

**Authority:** The [design additions table](../specs/2026-11-02-rationalisation/README.md#additions-of-6-november-2026)
and [build order](2026-11-08-a1308-build-order.md) assign the delete refusal to pa2; the original plan
records the owner's 9 November confirmation. Watcher 16 November 06:53 cleared pa1 with its deletion
and boot/watch gaps disclosed; 07:02 requires this expanded forecast, one Claude read and
`PLAN FOR APPROVAL` before building (lane E `questions.md`). This is watcher clearance, not new owner
approval. Follow the [slice rules](2026-11-08-a1308-slice-rules.md); implement inline with TDD.

## Smallest approach

Reuse the existing store installer and catalogue comparison. Keep SQL solely in
`packages/payments/triggers/payments.sql`, carried by the generated migration. Do not classify
`payments` as append-only: its legitimate captures update it.

| Files | Change |
| --- | --- |
| `packages/store/src/{append-only,index}.ts` | Extract `ExpectedTrigger { name, table, definition }`, `installTriggers(target, triggers)` and `triggerFaults(target, triggers)` from the existing implementation; retain append-only wrappers and assertions. Definition is catalogue text after `CREATE TRIGGER`. Never replace an altered trigger. |
| `packages/migrations/src/{manifest,apply}.ts` | Optional `MigrationSetSource.migrationTriggers: readonly string[]`; optional `VenueMigrationOptions.expectedTriggers: readonly ExpectedTrigger[]`. Copy metadata in `manifestSets`; resolve declared definitions in `migrationOptionsFor` from `readMigrationFiles`' statements, preserving body/spacing and stripping the final delimiter. Match a first `CREATE TRIGGER` token after whitespace/line comments, case-insensitively with quoted or plain names; require one match per declared name. Derive its table from that header. Keep text from the name through END, without the trailing semicolon/whitespace. Missing/duplicate/unsupported definitions raise registered `migrations.trigger_definition_invalid`. Read no extra SQL for undeclared sets. Install after each venue set; extend the existing node-set refusal to expected definitions. |
| `packages/composition/src/modules.ts`, `packages/migrations/migrations.manifest.json` | Declare only `payments_guard_update` and `payments_no_delete`, on `payments`, in both producers; keep composition's descriptor/manifest equality. `packages/module/src/module.ts` already spreads the descriptor in `orderedMigrationSets`. |
| `apps/server/src/{append-only-watch,boot,upgrade-checks}.ts` | Pass optional expected definitions alongside table names through missing-before-migration, final integrity assertion and watch. Filter by existing tables before migration. Use boot pass 2's existing installed-module selection and upgrade's same selection, including Off sets; no selection change or first-pass work. Reuse current errors, warning and recovery; no broad rename. |

All migration callers use `migrationOptionsFor`: boot/upgrade, restore/placement/preview,
provisioning, rejoin, dev setup/onboarding, bench and fixtures. Preserve that shared path.
`useVenueDb` already saves/restores all triggers during reset; leave its interface alone. Register the definition error in `packages/migrations/src/errors.ts`; account for `firstSetupDatabaseIsEmpty` treating it as not empty and backup-target resolution also reading the definitions.
**Out:** new data structures, a general SQL parser, payment-specific server imports, unrelated manual
triggers, changes to pa1's predicate, refunds, payment-policy retirement and fiscal work.

## TDD tasks

Read the TDD skill before code. For each task, add the named assertions, observe their expected
failure, implement minimally, then rerun. Preserve existing behavioural assertions.

1. **Delete refusal.** Add unconditional `payments_no_delete` to the SQL source and export
   `PAYMENT_DELETE_REFUSAL = "a payment is never deleted"` through payments' `trigger-refusals.ts`
   and `index.ts`. `packages/payments/src/schema/payments-guard.test.ts` owns exact refusal and row
   preservation for DELETE and primary-key INSERT OR REPLACE. Keep normal capture/replay controls. Change only `scripts/append-only-triggers.test.ts`'s payments DELETE accepting control to the allowed `update payments set updated_at = updated_at`; an incorrectly installed unconditional append-only update trigger must still fail it.
   `scripts/behavioural-triggers.test.ts` owns its inventory entry and one product-migration refusal;
   unconditional deletion has no accepting delete control. Rebuild payments.
2. **Shared definitions.** `store/src/append-only.test.ts` owns conditional install/reinstall,
   unchanged altered SQL and catalogue faults. `migrations/src/manifest.test.ts` owns source and
   copied-bundle resolution plus invalid declared SQL. `apply-append-only.test.ts` owns repair on an
   already-migrated synthetic set, retaining journal/rows. In the real payments guard suite, migrate
   the actual set, check zero catalogue faults, remove/reinstall its guard and check zero again;
   this measures comment/delimiter handling against SQLite and catches startup false alarms. Composition's existing equality pins both
   names. No payment dependency in migrations and no repeated fault grid at callers.
3. **Wiring.** Server `boot.failed-start.test.ts`: Off repair of both names with retained
   payment/journal and warning; altered guard refuses and releases folder. `boot.restore.test.ts`:
   one Off payment fault causes recorded refusal and stop after an intact control period.
   `append-only-watch.test.ts` owns existing-table filtering. `boot.upgrade.test.ts` retains generic
   checks and adds one altered refusal. Capture and missing/altered combinations stay at their owner.
4. **Cleanup.** Remove remaining redundant payment cleanup and obsolete comments/imports from
   `packages/payments/src/{collection-owner.sweep,collection-owner,manual,reconcile,reconcile.wiring,simulator,store,testing/fake-async-provider,testing/fake-provider}.test.ts`
   and `packages/payments-stripe/src/{hosted-provider,reconciler,stripe-report-client}.test.ts`;
   pa1 already removed some. Retain other setup. Remove the completed DELETE backlog entry.
   Inventory raw DELETE and REPLACE plus builder deletes; verify configuration-transfer's generic
   deleter still excludes payments through its existing `configurationTransfer: { kind: "none" }`.
   A real product delete or an unplanned behavioural assertion change goes to the watcher.

## Checks and forecast

Run `pnpm --filter <package> exec vitest run <named-files-above>` at each task, then affected cleanup
suites. Read Tests counts. Root checks:
`pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/append-only-triggers.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/apply-migrations-callers.test.ts`.
Rebuild with `pnpm --filter @waitron/server migration-baseline rebuild --set payments`; its final
repetition must say unchanged. Generated forecast: four files—payments' baseline SQL, snapshot, journal and the epoch entry—roughly 15–25 changed lines, including the snapshot id churn (rebuild.ts:291–300). Record the actual diff; the forecast is not a receipt.
Run protection-list before/after from `apps/server`; expect only `extra trigger payments_no_delete`
under six venue headers, with pa1's guard unchanged. Explain the actual comparison in the PR.
Check product deletes with `git grep -n -i -E 'delete\(payments\)|delete from payments|(^|[^a-z])replace[[:space:]]+into[[:space:]]+payments' -- apps packages ':!*.test.ts'` (no hit, exit 1).
Focused checks, normal hook, current-head CI; no whole-package local run solely to finish.

**Forecast:** 250–330 code/SQL/metadata lines; 350–450 test lines, including consumer ports:
**600–780 counted lines**, replacing ~90. Generated output and pure cleanup deletions follow the
slice rules' exclusions. This is an estimate; material growth goes to the watcher.

**PR first line:** “Every venue is reset: payments; backups and exports from before this cannot be
restored or imported.” Say the added restore/watch work follows pa1's removal of the old triggers;
include `Sale-path read changed:` with the actual answer, and say the owner lands it. Disclose that the existing `append_only.triggers_restored/changed` messages now also name these conditional/manual guards. No tests or
experiments were run to write this plan. Claude review and watcher clearance remain required.
