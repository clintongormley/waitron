# A1308 pa3: requester, refund attempts and reconciliation name

**Plan for watcher clearance · corrected 16 November 2026.** The watcher assigned this bounded rewrite at 08:52 in Lane E `questions.md`. The [12 November 11:38 build-order note](2026-11-08-a1308-build-order.md) records the owner's “Yes, one way”: whole/part payments use the Pay route, quick Counter saves then pays in one request, comp to zero closes/files immediately, and presented bills allow parts. No special delayed-card flow. These choices do not constitute approval of this implementation plan.

**Finish line:** every card attempt records its initiating person through the single Pay path; provider refund attempts are immutable and read provider/reference from their parent; the existing reconciliation table is called `reconciliation_runs`. Reuse the store, adapters, manual-card writer, payment guard and existing reconciliation code. Add no record or runtime abstraction.

**Dependencies:** pa1 and pa2 are landed (`4f5b758700`, `8a6e3532eb`). The separate one-way-to-pay slice must land before pa3; its assignment remains the watcher's decision. Do not implement that slice here or overlap os12/os13 refund work. Pa3 precedes pp9. Pa2b need not hold this plan: preserve its `migrationTriggers` metadata when present and recheck its landed form.

**Out:** route consolidation, UI/recovery deletions, comp/partial admission changes, attendance consumption (pp11), till/provider refund unification (os12/os13), job-runner changes, compatibility/backfill and fiscal writers. A739's revised [memory-only slips plan](2026-11-10-a739-memory-only-card-slips.md) and current schema have no `order_payment_contexts` or `bill_payment_slip_copies`; delete the old conditional task for those tables.

**Basis:** current source `1707d6f91d`; [slice rules](2026-11-08-a1308-slice-rules.md); design [README](../specs/2026-11-02-rationalisation/README.md) U9/U11, `tables-fiscal.md` §§1.3/5/6, `tables-venuebox.md` §§1.15/5, `tables-people.md` §7 and `jobs.md` R2 in that directory. Today's Pay entry is `apps/server/src/bill-payments-api.ts:230`, with two card starts in `bill-payments.ts:1356,1683`; three legacy starts remain in `till-sale.ts`. Re-anchor after the prerequisite, rather than port those legacy starts.

## Build with failing tests first

Prefixes: `P=packages/payments/src`, `S=apps/server/src`, `PS=packages/payments-stripe/src`, `PU=packages/payments-sumup/src`. For each task observe the named assertion fail, implement minimally, rerun and read the Tests count. Use existing `useVenueDb`/person/header fixtures. Before code, run `pnpm protection-list list --out <empty absolute A>` from `apps/server`.

1. **Requester:** append nullable `requested_by` with `payments_requested_by_fk` → `persons.id` restrict in `P/schema/payments.ts`; fix it from insertion in `packages/payments/triggers/payments.sql`. Thread optional `requestedBy?: string` through `P/{provider,store,manual,simulator,testing/fake-provider,testing/fake-async-provider}.ts`, `PS/{provider,device-provider,hosted-provider}.ts`, `PU/provider.ts`. `insertPayment` defaults omission to null; surviving `S/bill-payments.ts` starts pass `operator.personId`. Preserve capture/set-once allowances and both payment trigger names; settlement/recovery never overwrites the requester.
2. **Refund attempts:** drop `provider`/`paymentRef` from `P/schema/payment-refunds.ts` and `P/store.ts` inserts; add `payment_refunds_authorized_by_fk` → `persons.id` restrict. Declare `appendOnly("payment_refunds", "ledger", LEDGER)` in `P/classification.ts`; put `["payment_refunds"]` in payments' manifest `appendOnlyTables`, retaining any pa2b metadata. Composition derives its descriptor list. Port removed-field readers through the parent payment and date fixtures at insertion; preserve money/refund-ceiling assertions. Update root schema/append-only inventories and backup reference/immutable-table expectations.
3. **Rename:** commit idempotent `scripts/a1308/pa3-reconciliation-runs.mjs` with its output. Replace `scheduled_runs`, `scheduledRuns`, `scheduled-runs` in tracked apps/packages/scripts, `eslint.config.js` and `docs/developers/conventions-data.md`; exclude drizzle output, country demo fixtures, rename scripts and historical audit docs. Rename `P/schema/scheduled-runs.ts` and `P/scheduled-runs-migrations.test.ts`, including CHECK/unique names; preserve expressions and columns. In `P/reconciliation-schedule/store.ts`, target `claimGap`'s conflict at duty/periodFrom/generation. Keep stored duty keys and `RunState`/`SCHEDULER_TABLES`. Remove the finished refund-delete and `claimGap` backlog leaves.

## Tests by owner

| Files | Behavior owned here |
| --- | --- |
| `P/{store,manual}.test.ts`, `P/schema/{payments-guard,payments-follow-ups}.test.ts` | First-row writers retain requester/absent null; unknown requester/authoriser refuses with the FK error; requester mutation refuses; capture retains it. Refund update/delete refuses; failed attempts do not consume the successful-refund ceiling. |
| `PS/{provider,device-provider,hosted-provider}.test.ts`, `PU/provider.test.ts`, simulator/fake tests beside their writers | Each adapter passes requester to its first row; retain existing outcomes without repeating store's grid. |
| `S/{bill-payments.card,bill-payments-api}.test.ts` | Reader/manual card use the authenticated starter; retry/recovery preserves them. The prerequisite owns whole/part, quick Counter and zero-comp admission. |
| Refund/backup and reconciliation consumers | Run changed `P/{reverse,reversal.concurrency,backup-verification}.test.ts`, `P/reconciliation-schedule/*.test.ts`, renamed migrations test, `PU/{reverse,reconciler}.test.ts`; affected server refund/reconcile/pass/Payments-Off suites and provisioning's `first-setup-empty-database.test.ts`. Keep their original values and one-winner claim assertion. |

**Assertions changed by design:** renamed schema names and backup immutable-table expectation `payment_refunds` (fiscal appendix §1.3). Removed-field expectations read the same values through the parent. No invoice, money or drawer assertion is relaxed.

## Expected protection-list difference

Both fiscal compositions, venue file only; no node-file change. Source: fiscal appendix §§1.3/5/6, venue/box §5 and U9/U11. Recheck the prediction against the prerequisite's base before code.

| Table/phases | Predicted report |
| --- | --- |
| `payments`, all | extra `columns[requested_by]` and FK `requested_by->persons(id)`; changed `columnOrder` and `payments_guard_update.body` for the equality only. Delete guard unchanged. |
| `payment_refunds`, all | missing columns `provider`/`payment_ref`; changed `columnOrder`; extra FK `authorized_by->persons(id)`. Existing key/index/CHECKs unchanged. |
| `payment_refunds`, migrated/change-feed | extra `payment_refunds_append_only_update` and `_delete` triggers. |
| Reconciliation, all | missing `scheduled_runs` table, `scheduled_runs_key` and `scheduled_runs.primary key(id)` indexes; corresponding extra reconciliation objects. Same columns/expressions, renamed CHECKs. |
| Change-feed only | changed `waitron_change_payments_update.when` adds requester; refund update `.when` removes copied fields. Reconciliation is not a change source. |

Rebuild payments only with `pnpm --filter @waitron/server migration-baseline rebuild --set payments`. Run focused changed files, composition equality, unchanged fiscal `inmutabilidad`, and root schema-constraints/append-only-triggers/append-only-migration-sets/behavioural-triggers/starting-migrations/classification-complete/migration-upgrade guards. Verify any pa2b real-SQL check against the rebuilt guard, without duplicating boot/watch tests. Run rename twice and compare diffs; list `<B>` and compare protections with `<A>`. Unexpected differences/assertion changes/growth follow slice stop rules. Bench stays periodic; name any actual sale-path read change in the PR.

**Forecast:** hand-written production/script 140–190 lines, tests/fixtures/guards 320–440; automated rename output 170–220 and generated migration output 250–400 separately. Measure additions/removals; generated files are payments' baseline SQL, snapshot/journal and epoch entry, never hand-edited. Finish in one approximately three-hour slice, normal hook, finish-branch and current-head CI. **Lane lands pa3.** PR first line: “Every venue is reset: payments; backups and exports from before this cannot be restored or imported.” Disclose newly append-only refunds and their possible first-start warning.
