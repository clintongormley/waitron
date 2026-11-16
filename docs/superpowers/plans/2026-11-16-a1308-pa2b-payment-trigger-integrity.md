# A1308 pa2b: restore and watch the payment triggers — owner lands

**Decision, 16 November:** Lane E `questions.md`, watcher 08:55, records the owner's words:
“Yes, queue pa2b”. Watcher 08:59 records pa2 landed as #3473/`8a6e3532eb` and clears this build
on the corrected plan. The owner lands pa2b. Claude's earlier 335-second plan read covered this
shared-mechanism approach; the scope choice it requested is now answered.

**Result:** Boot repairs missing payment guards, refuses altered ones, and the trading watch stops on missing or altered guards, including Payments Off. Normal capture stays allowed. Pa1 landed as `4f5b758700`; pa2 supplies the delete refusal.

**Authority:** Watcher 16 November 07:36 split the expanded pa2 plan after Claude's 335-second read: build delete-only pa2; put this restore/watch proposal to the owner. This document extracts the corrected shared-mechanism portion of that read. Apply the [slice rules](2026-11-08-a1308-slice-rules.md).

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
**Out:** new stored records, a general SQL parser, payment-specific server imports, unrelated manual
triggers, changes to pa1's predicate, refunds, payment-policy retirement and fiscal work.

## TDD tasks

Read the TDD skill before code. For each task, add the named assertions, observe their expected
failure, implement minimally, then rerun. Preserve existing behavioural assertions.

1. **Shared definitions.** `store/src/append-only.test.ts` owns conditional install/reinstall,
   unchanged altered SQL and catalogue faults. `migrations/src/manifest.test.ts` owns source and
   copied-bundle resolution plus invalid declared SQL. `apply-append-only.test.ts` owns repair on an
   already-migrated synthetic set, retaining journal/rows. In the real payments guard suite, migrate
   the actual set, check zero catalogue faults, remove/reinstall its guard and check zero again;
   this measures comment/delimiter handling against SQLite and catches startup false alarms. Composition's existing equality pins both
   names. No payment dependency in migrations and no repeated fault grid at callers.
2. **Wiring.** Server `boot.failed-start.test.ts`: Off repair of both names with retained
   payment/journal and warning; altered guard refuses and releases folder. `boot.restore.test.ts`:
   one Off payment fault causes recorded refusal and stop after an intact control period.
   `append-only-watch.test.ts` owns existing-table filtering. `boot.upgrade.test.ts` retains generic
   checks and adds one altered refusal. Capture and missing/altered combinations stay at their owner.

## Checks and forecast

Run `pnpm --filter <package> exec vitest run <named-files-above>` at each task, then affected callers. Read Tests counts. Root checks:
`pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/apply-migrations-callers.test.ts`.
No SQL predicate or schema change is planned. Run protection-list before/after from `apps/server`;
expect no object difference against the landed-pa2 base. A different outcome needs explanation
before continuing. Pa2 owns the generated migration, deletion controls and cleanup.
Focused checks, normal hook, current-head CI; no whole-package local run solely to finish.

**Forecast:** 240–320 code/metadata lines; 310–400 test lines:
**550–720 counted lines** for the extracted follow-up. Generated output and pure cleanup deletions follow the
slice rules' exclusions. This is an estimate; material growth goes to the watcher.

**Disclosure:** This restores protection that pa1's retired follow-up tables had. Existing
`append_only.triggers_restored/changed` messages also name these manual/conditional guards.
The earlier Claude report reviewed the expanded pa2 approach, not a built pa2b.
