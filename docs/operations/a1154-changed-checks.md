# A1154 changed test checks

> 2026-10-29: Start again no longer keeps the start-again note; the promotion's floor case now checks that a leftover note file is ignored (A1206).

Historical review inventory, 2026-10-28. The owner authorizes removal of the obsolete registration command and action, preservation of restore/setup/promotion checks, fixture renames and one series per node. The 2026-10-05 standing decision permits equally strict checks of deliberately changed behavior. The exact two protected helper references were approved on 2026-10-28; every other protected byte remains unchanged.

| File | Old check and resulting check |
| --- | --- |
| [apps/server/scripts/register-till.test.ts](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/scripts/register-till.test.ts) | Retired command-only suite; case inventory below. |
| [apps/server/scripts/restore-allocation.test.ts](../../apps/server/scripts/restore-allocation.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [apps/server/scripts/script-arguments.test.ts](../../apps/server/scripts/script-arguments.test.ts) | Remove obsolete command parser cases; retain record-one-sale argument guard. |
| [apps/server/src/hour-promotion.test.ts](../../apps/server/src/hour-promotion.test.ts) | Retire command-specific cases; convert start-again floor case to an admitted-spare promotion; keep exact floor and row-equality assertions. |
| [apps/server/src/provision-node-operation.test.ts](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts) | Retired command-only suite; case inventory below. |
| [apps/server/src/provision-seed-order.test.ts](../../apps/server/src/provision-seed-order.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [apps/server/src/receipt-print.test.ts](../../apps/server/src/receipt-print.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [apps/server/src/recovery-operation-input.test.ts](../../apps/server/src/recovery-operation-input.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [apps/server/src/recovery-operation.test.ts](../../apps/server/src/recovery-operation.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [apps/server/src/recovery-restore-input.test.ts](../../apps/server/src/recovery-restore-input.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [apps/server/src/restore-email.test.ts](../../apps/server/src/restore-email.test.ts) | Remove unused retired series-setting fixture; email assertions unchanged. |
| [apps/server/src/restore-fiscal-e2e.test.ts](../../apps/server/src/restore-fiscal-e2e.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [apps/server/src/retired-fiscal-operation-entry.test.ts](../../apps/server/src/retired-fiscal-operation-entry.test.ts) | Keep production restore-runner refusal and unchanged row equality; remove the two retired command entries. |
| [apps/server/src/served-at-huella.test.ts](../../apps/server/src/served-at-huella.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [apps/server/src/till-api.test.ts](../../apps/server/src/till-api.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [apps/server/src/venue-details.test.ts](../../apps/server/src/venue-details.test.ts) | Historical allocation fixture uses the retained restore hook instead of rerunning a seed; retained assertions unchanged. |
| [packages/db/src/reserved-identity.test.ts](../../packages/db/src/reserved-identity.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/allocated-lifecycle.test.ts](../../packages/fiscal-verifactu/src/allocated-lifecycle.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [packages/fiscal-verifactu/src/backup-verification-chain.test.ts](../../packages/fiscal-verifactu/src/backup-verification-chain.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/backup-verification-history.test.ts](../../packages/fiscal-verifactu/src/backup-verification-history.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/backup-verification.test.ts](../../packages/fiscal-verifactu/src/backup-verification.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/canje-columns.test.ts](../../packages/fiscal-verifactu/src/canje-columns.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/canje-path.e2e.test.ts](../../packages/fiscal-verifactu/src/canje-path.e2e.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/certificate-alerts.test.ts](../../packages/fiscal-verifactu/src/certificate-alerts.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/certificate-card.test.ts](../../packages/fiscal-verifactu/src/certificate-card.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/certificate-install.default-transport.test.ts](../../packages/fiscal-verifactu/src/certificate-install.default-transport.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/certificate-install.test.ts](../../packages/fiscal-verifactu/src/certificate-install.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/certificate-record.test.ts](../../packages/fiscal-verifactu/src/certificate-record.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/certificate-reminders.test.ts](../../packages/fiscal-verifactu/src/certificate-reminders.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/chain.concurrency.test.ts](../../packages/fiscal-verifactu/src/chain.concurrency.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/chain.node-rekey.concurrency.test.ts](../../packages/fiscal-verifactu/src/chain.node-rekey.concurrency.test.ts) | Keep contiguous positions and both origins; add distinct devices, equal node/SIF/series and unchanged node-series rows. |
| [packages/fiscal-verifactu/src/chain.test.ts](../../packages/fiscal-verifactu/src/chain.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/chain.validation-warnings.test.ts](../../packages/fiscal-verifactu/src/chain.validation-warnings.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/correction-path.e2e.test.ts](../../packages/fiscal-verifactu/src/correction-path.e2e.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/declared-paper-consumers.test.ts](../../packages/fiscal-verifactu/src/declared-paper-consumers.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [packages/fiscal-verifactu/src/drain.test.ts](../../packages/fiscal-verifactu/src/drain.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/fingerprint-refusal.test.ts](../../packages/fiscal-verifactu/src/fingerprint-refusal.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/hosted-hour-recovery.test.ts](../../packages/fiscal-verifactu/src/hosted-hour-recovery.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [packages/fiscal-verifactu/src/hour-activation.test.ts](../../packages/fiscal-verifactu/src/hour-activation.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/hour-configuration.test.ts](../../packages/fiscal-verifactu/src/hour-configuration.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [packages/fiscal-verifactu/src/hour-preparation.test.ts](../../packages/fiscal-verifactu/src/hour-preparation.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [packages/fiscal-verifactu/src/hour-recovery-state.test.ts](../../packages/fiscal-verifactu/src/hour-recovery-state.test.ts) | Convert committed recovery fixture to restore; exact mismatched-source reason becomes prior_activation_requires_replay. All state-equality checks remain. |
| [packages/fiscal-verifactu/src/hour-selection.test.ts](../../packages/fiscal-verifactu/src/hour-selection.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [packages/fiscal-verifactu/src/inmutabilidad.test.ts](../../packages/fiscal-verifactu/src/inmutabilidad.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/monetary-columns.test.ts](../../packages/fiscal-verifactu/src/monetary-columns.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/node-columns.test.ts](../../packages/fiscal-verifactu/src/node-columns.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/paper-custodian.recovery.test.ts](../../packages/fiscal-verifactu/src/paper-custodian.recovery.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [packages/fiscal-verifactu/src/provisioning.test.ts](../../packages/fiscal-verifactu/src/provisioning.test.ts) | Historical allocation fixture uses the retained restore hook instead of rerunning a seed; retained assertions unchanged. |
| [packages/fiscal-verifactu/src/reconcile.test.ts](../../packages/fiscal-verifactu/src/reconcile.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/rectificativa-columns.test.ts](../../packages/fiscal-verifactu/src/rectificativa-columns.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/registro-row.roundtrip.test.ts](../../packages/fiscal-verifactu/src/registro-row.roundtrip.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/registro-sif.test.ts](../../packages/fiscal-verifactu/src/registro-sif.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/registros-origin.test.ts](../../packages/fiscal-verifactu/src/registros-origin.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/restore-committed.test.ts](../../packages/fiscal-verifactu/src/restore-committed.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/restore.sold-node.test.ts](../../packages/fiscal-verifactu/src/restore.sold-node.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/restore.test.ts](../../packages/fiscal-verifactu/src/restore.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/slot.test.ts](../../packages/fiscal-verifactu/src/slot.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/substitution-path.e2e.test.ts](../../packages/fiscal-verifactu/src/substitution-path.e2e.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/fiscal-verifactu/src/verify.test.ts](../../packages/fiscal-verifactu/src/verify.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [packages/provisioning/src/venue-operation.test.ts](../../packages/provisioning/src/venue-operation.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [scripts/fiscal-allocation-migration.test.ts](../../scripts/fiscal-allocation-migration.test.ts) | Remove retired-action variants or convert recovery arithmetic to restore/promote; retain assertions for surviving operations. |
| [scripts/fiscal-certificate-migration.test.ts](../../scripts/fiscal-certificate-migration.test.ts) | Fixture/helper identifiers renamed; expected values and retained assertions preserved. |
| [scripts/generate-hour-release.test.mjs](../../scripts/generate-hour-release.test.mjs) | Require the retired bundle to be absent; all surviving release entries remain required. |

New coverage: `scripts/no-till-as-issuer.test.ts` exercises retired entry paths, action/setting spellings, fiscal identifiers, real file discovery, legitimate historical/device uses and migrated fiscal ownership. `packages/provisioning/src/venue-operation.test.ts` adds a no-input setup retry with stable node, exactly one seed and no second seed report.

The source mismatch in `hour-recovery-state.test.ts` previously checked the retired operation's `event_mismatch`. Its restore fixture now requires `prior_activation_requires_replay`, the existing refusal from `restore-committed.ts`. The request remains refused under the exact domain code, and counters, SIF rows and allocation evidence remain unchanged. This uses the existing restore refusal. The retired action is separately refused by the narrowed operation gates.

The runnable-selection fixture in `scripts/changed-packages.test.mjs` now pairs the remaining exempt package name with `bench/sqlite-failover`, its real manifest. The success/status and warning assertions are unchanged. Its old fixture looked up the retired benchmark directory and failed with status 1 after deletion.

The two protected references remain at `packages/fiscal-verifactu/src/inmutabilidad.test.ts:6` and `:29`. The exact source-refusal change is at `packages/fiscal-verifactu/src/hour-recovery-state.test.ts:262`; the bundle-absence check is at `scripts/generate-hour-release.test.mjs:437`. The added shared-device assertions are at `packages/fiscal-verifactu/src/chain.node-rekey.concurrency.test.ts:88`; the exempt-package fixture correction is at `scripts/changed-packages.test.mjs:876`.

The final review also adds private fiscal identifier coverage and renames the local `reregister` test helper to `replaceNodeIdentity`, retaining every assertion and argument.

## Removed command-only case inventory

Cases below refer to the original base and preserve their full source links. The mixed suite's archive/bucket cases moved to the restore suite; the setup seed-order case moved to its own suite.

| Original case | Disposition |
| --- | --- |
| [apps/server/scripts/register-till.test.ts:78](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/scripts/register-till.test.ts#L78) provisioning already left exactly one live SIF, so a second one can only come from here | Retired command-only case. |
| [apps/server/scripts/register-till.test.ts:83](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/scripts/register-till.test.ts#L83) re-registers the node in the directory WAITRON_VENUE_DIR names | Retired command-only case. |
| [apps/server/scripts/register-till.test.ts:96](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/scripts/register-till.test.ts#L96) finds the same directory from WAITRON_STATE_DIR alone | Retired command-only case. |
| [apps/server/scripts/register-till.test.ts:109](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/scripts/register-till.test.ts#L109) refuses a node the venue does not hold, by its domain code | Retired command-only case. |
| [apps/server/scripts/register-till.test.ts:118](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/scripts/register-till.test.ts#L118) leaves exactly one live SIF after every re-registration | Retired command-only case. |
| [apps/server/scripts/script-arguments.test.ts:92](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/scripts/script-arguments.test.ts#L92) accepts the supported argument shape $args | Retired command-only case. |
| [apps/server/scripts/script-arguments.test.ts:106](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/scripts/script-arguments.test.ts#L106) refuses an unsupported argument shape $args | Retired command-only case. |
| [apps/server/src/hour-promotion.test.ts:606](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/hour-promotion.test.ts#L606) re-registers through provisionNode with the matching key and frozen hour | Retired command-only case. |
| [apps/server/src/hour-promotion.test.ts:689](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/hour-promotion.test.ts#L689) a re-registration with the clock behind the start-again note is refused, not given a repeated name | Title/fixture renamed; retained behavior is covered. |
| [apps/server/src/hour-promotion.test.ts:789](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/hour-promotion.test.ts#L789) register-till consumes the authenticated selected hour and preserves counters on replay (derived venue %s) | Retired command-only case. |
| [apps/server/src/hour-promotion.test.ts:866](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/hour-promotion.test.ts#L866) the built register-till command activates its selected hour and replays without allocating again | Retired command-only case. |
| [apps/server/src/hour-promotion.test.ts:973](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/hour-promotion.test.ts#L973) register-till refuses %s without changing the selected venue | Retired command-only case. |
| [apps/server/src/hour-promotion.test.ts:1055](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/hour-promotion.test.ts#L1055) register-till refuses incomplete or unknown command arguments %j before opening a venue | Retired command-only case. |
| [apps/server/src/provision-node-operation.test.ts:41](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts#L41) collects for the real key outside the transaction, then passes scoped input to the node seed | Retired command-only case. |
| [apps/server/src/provision-node-operation.test.ts:75](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts#L75) refuses a wrong key before collecting evidence or running any seed | Retired command-only case. |
| [apps/server/src/provision-node-operation.test.ts:102](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts#L102) refuses a %s operation without running a seed | Retired command-only case. |
| [apps/server/src/provision-node-operation.test.ts:133](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts#L133) retains outside evidence but rolls back every seed when a later seed refuses | Retired command-only case. |
| [apps/server/src/provision-node-operation.test.ts:165](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts#L165) refuses a location changed while outside evidence is collected | Retired command-only case. |
| [apps/server/src/provision-node-operation.test.ts:191](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts#L191) rechecks the key after collection before entering the seeds | Retired command-only case. |
| [apps/server/src/provision-node-operation.test.ts:214](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts#L214) refuses input for an unselected module before any seed runs | Retired command-only case. |
| [apps/server/src/provision-node-operation.test.ts:233](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/provision-node-operation.test.ts#L233) detaches the node, input, binding and module list before its first awaited read | Retired command-only case. |
| [apps/server/src/restore-fiscal-e2e.test.ts:350](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/restore-fiscal-e2e.test.ts#L350) re-registers the SIF, replaces series, publishes trading identity, and keeps the ledger immutable | Title/fixture renamed; retained behavior is covered. |
| [apps/server/src/retired-fiscal-operation-entry.test.ts:66](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/apps/server/src/retired-fiscal-operation-entry.test.ts#L66) production %s refuses a signed paper input even with its correct key and outside files | Title/fixture renamed; retained behavior is covered. |
| [packages/fiscal-verifactu/src/chain.test.ts:410](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/packages/fiscal-verifactu/src/chain.test.ts#L410) creates the chain head row from scratch when a till has none yet | Title/fixture renamed; retained behavior is covered. |
| [packages/fiscal-verifactu/src/hour-recovery-state.test.ts:246](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/packages/fiscal-verifactu/src/hour-recovery-state.test.ts#L246) consults an exact committed re-registration without changing counters or evidence | Title/fixture renamed; retained behavior is covered. |
| [packages/fiscal-verifactu/src/paper-custodian.recovery.test.ts:182](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/packages/fiscal-verifactu/src/paper-custodian.recovery.test.ts#L182) exports re-registration only with its own current outside action binding | Title/fixture renamed; retained behavior is covered. |
| [packages/fiscal-verifactu/src/provisioning.test.ts:87](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/packages/fiscal-verifactu/src/provisioning.test.ts#L87) re-seeding an existing node mints a fresh installation number and a new chain | Title/fixture renamed; retained behavior is covered. |
| [packages/fiscal-verifactu/src/restore.sold-node.test.ts:17](https://github.com/clintongormley/waitron/blob/d11f4605d24485c030c290ef28c8b904cffe3f10/packages/fiscal-verifactu/src/restore.sold-node.test.ts#L17) re-registers a sold node onto the supplied SIF with an empty chain head | Title/fixture renamed; retained behavior is covered. |


## A1163 clock receipt before command retirement

Historical text from `docs/developers/testing-guide.md` at
`177985dbeb3647a8c1beb4e95f9a757421c63bf8`, preserved on 28 October 2026. A1154
retires the built-command test described here; the recovery-placement tests remain.

## A child process that freezes `Date` freezes `performance.now` with it

The setup hour clock (`packages/fiscal-verifactu/src/hour-setup-clock.ts`, `current`) refuses a
held reading with `sif.allocation_invalid` / `clock_corrected` when the wall time and the
process's elapsed time since that reading differ by more than a second. A child that freezes
`Date` but leaves `performance.now` real reads zero wall time against real elapsed time, so it is
refused whenever the run takes over a second between the reading and its re-check — on a busy CI
runner, not on a fast laptop. The in-process form of the same rule, for fake timers, is
[Freeze both clocks in a fixed first-setup fixture](#freeze-both-clocks-in-a-fixed-first-setup-fixture).

Cost: CI run 40594569075 (server shard 7) failed `hour-recovery-placement-1.test.ts`'s
archive process-death case: its child exited with no signal and printed nothing, so it never
reached the kill point. That log omitted the child's error, so the cause there is inferred from the
same outcome. Reproduced locally (A1163) by holding the child for 1.1 s of real time between its
clock reading and the re-check: both of that file's process-death cases (archive and stream)
then exited with code 1 and `clock_corrected`. Freezing `performance.now` beside `Date` made both pass with the hold in
place. The same hold made `hour-recovery-placement-2.test.ts`'s two process-death cases exit 1
with `clock_corrected`, and a hold in `hour-promotion.test.ts`'s built register-till child made it
refuse (`second_clock_missing`); freezing `performance.now` made each pass. Unlike the in-process
experiment, these holds stay in the three tests, so a child whose clocks disagree fails every run.
`expectChildKilled` (`apps/server/src/testing/child-process-death.ts`) prints the exit code,
stdout and stderr when a child is not killed as expected.
