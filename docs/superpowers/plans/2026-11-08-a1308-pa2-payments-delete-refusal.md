# A1308 pa2: refuse payment deletion and restore/watch its triggers

**Result:** Every payment delete is refused. Boot repairs missing payment guards, refuses altered
ones, and the trading watch stops on missing or altered guards, including with Payments Off.
Ordinary capture remains allowed. Build after pa1 (#3465) lands; **the owner lands pa2**.

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
| `packages/migrations/src/{manifest,apply}.ts` | Optional `MigrationSetSource.migrationTriggers: readonly { name, table }[]`; optional `VenueMigrationOptions.expectedTriggers: readonly ExpectedTrigger[]`. Copy metadata in `manifestSets`; resolve declared definitions in `migrationOptionsFor` from `readMigrationFiles`' statements, preserving body/spacing and stripping the final delimiter. Support the shipped header form, fail on a missing declaration, and read no extra SQL for undeclared sets. Install definitions after each venue set. |
| `packages/composition/src/modules.ts`, `packages/migrations/migrations.manifest.json` | Declare only `payments_guard_update` and `payments_no_delete`, on `payments`, in both producers; keep composition's descriptor/manifest equality. `orderedMigrationSets` already spreads the descriptor. |
| `apps/server/src/{append-only-watch,boot,upgrade-checks}.ts` | Pass optional expected definitions alongside table names through missing-before-migration, final integrity assertion and watch. Filter by existing tables before migration. Both boot passes and upgrade use installed-module selection, including Off sets. Reuse current errors, warning and recovery; no broad rename. |

All migration callers use `migrationOptionsFor`: boot/upgrade, restore/placement/preview,
provisioning, rejoin, dev setup/onboarding, bench and fixtures. Preserve that shared path.
`useVenueDb` already saves/restores all triggers during reset; leave its interface alone.
**Out:** new data structures, a general SQL parser, payment-specific server imports, unrelated manual
triggers, changes to pa1's predicate, refunds, payment-policy retirement and fiscal work.

## TDD tasks

Read the TDD skill before code. For each task, add the named assertions, observe their expected
failure, implement minimally, then rerun. Preserve existing behavioural assertions.

1. **Delete refusal.** Add unconditional `payments_no_delete` to the SQL source and export
   `PAYMENT_DELETE_REFUSAL = "a payment is never deleted"` through payments' `trigger-refusals.ts`
   and `index.ts`. `packages/payments/src/schema/payments-guard.test.ts` owns exact refusal and row
   preservation for DELETE and primary-key INSERT OR REPLACE. Keep normal capture/replay controls.
   `scripts/behavioural-triggers.test.ts` owns its inventory entry and one product-migration refusal;
   unconditional deletion has no accepting delete control. Rebuild payments.
2. **Shared definitions.** `store/src/append-only.test.ts` owns conditional install/reinstall,
   unchanged altered SQL and catalogue faults. `migrations/src/manifest.test.ts` owns source and
   copied-bundle resolution plus missing declared SQL; `apply-append-only.test.ts` owns repair on an
   already-migrated synthetic set, retaining journal/rows. Composition's existing equality pins both
   names. No payment dependency in migrations and no repeated fault grid at callers.
3. **Wiring.** Server `boot.failed-start.test.ts`: On repair with accepted capture; Off repair of both
   names with retained payment/journal and warning; altered Off guard refuses and releases folder.
   `boot.restore.test.ts`: missing-update and altered-delete guards while Off cause recorded refusal
   and stop, after an intact control period. `append-only-watch.test.ts` owns existing-table filtering.
   `boot.upgrade.test.ts` keeps generic assertions and adds one Off repair and one altered refusal.
4. **Finish.** Remove redundant empty-table payment cleanup, obsolete comments/imports in touched
   payment/Stripe suites, retaining other setup. Remove the completed DELETE backlog entry.
   A real product delete or an existing behavioural assertion needing change goes to the watcher.

## Checks and forecast

Run `pnpm --filter <package> exec vitest run <named-files-above>` at each task, then affected cleanup
suites. Read Tests counts. Root checks:
`pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/apply-migrations-callers.test.ts`.
Rebuild with `pnpm --filter @waitron/server migration-baseline rebuild --set payments`; its final
repetition must say unchanged. Generated changes are payments' `drizzle/**` and the epoch entry.
Run protection-list before/after from `apps/server`; expect only `extra trigger payments_no_delete`
under six venue headers, with pa1's guard unchanged. Explain the actual comparison in the PR.
Check product deletes with `git grep -n -i -E 'delete\(payments\)|delete from payments' -- apps packages ':!*.test.ts'` (no hit, exit 1).
Focused checks, normal hook, current-head CI; no whole-package local run solely to finish.

**Forecast:** 250–330 code/SQL/metadata lines; 350–450 test lines, including consumer ports:
**600–780 counted lines**, replacing ~90. Generated output and pure cleanup deletions follow the
slice rules' exclusions. This is an estimate; material growth goes to the watcher.

**PR first line:** “Every venue is reset: payments; backups and exports from before this cannot be
restored or imported.” Say the added restore/watch work follows pa1's removal of the old triggers;
include `Sale-path read changed:` with the actual answer, and say the owner lands it. No tests or
experiments were run to write this plan. Claude review and watcher clearance remain required.
