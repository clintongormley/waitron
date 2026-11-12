# A950: usable manual upgrade, draft

**Request:** "A950. First remote venue: safe manual upgrades, then automation".
Drafted by the separate GPT-6.1 Sol plan writer. Owner 22:04 grouping is recorded in
[the historical plan](2026-11-09-a950-shorter-upgrades.md). Watcher 12 November 18:55
cleared proposing remaining 3b plus 8 before advisory trial 4, with A790's fix round first.
This draft has no Claude review, watcher build clearance or owner approval. The driver
gets Claude's plan read, then posts PLAN FOR APPROVAL to the watcher before code.

**Usable result:** You run `sudo bash waitron.sh install <ref>` at an installed
single-box host console. Open orders and data survive. Required checks include a
successful actual primary cash sale on a fresh disposable copy using the configured
backend. Success commits before reopening; failure offers manual restore/keep.
The live venue receives no test sale. No other project, signing, window, automation
or pair prerequisite applies.

Paths below: H=`scripts/box/upgrades/`, S=`apps/server/src/`, B=`deploy/box/`.

1. **Executable stopped-copy qualification (3b).** Extend
   S/`upgrade-check-entry.ts:runUpgradeChecks` and
   S/`upgrade-checks.ts:{checkUpgradeData,openUpgradeListener}`; add
   S/`upgrade-sale.ts:checkUpgradeSale`. Reuse S/`boot.ts:startServer` and
   S/`first-setup-launch.ts:startServerOrFirstSetupResolution`, two-file state,
   first-setup and existing menu/Orders readers. Contain background effects before
   starting them; preserve ordinary admission, accepted-copy placement, legacy-workspace,
   peer and start-clock checks. Keep the real TLS listener and menu/history reads.
   Create the operator/session, device/profile and offered item only in the disposable
   copy; use the ordinary cash-payment route and require invoice/totals, backend
   persistence and VeriFactu chain continuation. Use separate disposable readiness/sale
   trees; never mount the intact restore copy writable. Discard both trees.
   Every sale must succeed; refusal and setup-only cannot pass. Start the print agent
   without sending jobs. Extend H/`host.mjs:createUpgradeHost` to invoke this candidate
   entry in isolation. Add its read-only clock forwarder there. Forward only real host `clock.status`, using
   S/`box-host-client.ts:boxHostClient` and the existing wire format; refuse setting,
   missing and unsynchronised answers. Reuse the existing bundle in `deploy/Dockerfile`.

2. **Installed manual activation (8).** In `deploy/waitron.sh`, change
   `cmd_install`, `select_image`, `fetch_box_files`, `cmd_status` and `cmd_reset`:
   stage candidate inputs before installed-file mutation and call
   H/`transaction.mjs:{applyUpgrade,recoverUpgrade,upgradeStatus}` through
   H/`host.mjs:{createUpgradeHost,recoverInstalledUpgrade}`. Add H/`cli.mjs` as their
   installed caller, including status/restore/keep. Pin resolved source/candidate IDs,
   including the existing ref-build path. Reuse H/`bootstrap.sh`, host lock,
   marker, image pins, shutdown-completion refusal and
   H/`copy.mjs:{copyStoppedTree,restoreStoppedTree}`. Interrupted restore always starts
   again from the intact copy. Bootstrap/recovery stay independent of Docker; host
   runtime refresh stays outside attempts. Add B/`waitron-app.service` and
   B/`waitron-upgrade-recovery.service`; update B/`{build.sh,start-dev.sh,waitron-dev.service}`
   and S/`run-server.ts`'s restart explanation. Remove all four `deploy/compose.yml`
   restart policies only in this same activation change, when services own restart,
   hold unresolved attempts and preserve the B3 AppArmor environment.

**Tests and qualification:** Use failing behavioral tests first. Server admission,
containment and sale assertions belong in S/`boot.upgrade.test.ts` and new
S/`upgrade-sale.test.ts`; reuse `testing/{order-venue,bill-venue,tab-person-setup}.ts`; retain
S/`run-server.test.ts`. Sender/host/transaction tests own failures once; shell tests
assert wiring/answers only. Run `pnpm --filter @waitron/server exec vitest run
src/boot.upgrade.test.ts src/upgrade-sale.test.ts src/run-server.test.ts` and `pnpm exec vitest run
scripts/box/upgrades/{host,transaction,copy,bootstrap,cli}.test.mjs
scripts/waitron-sh.test.mjs scripts/box/{installed-start,recipe-setup,rig-contract}.test.mjs`.
Extend existing `bench/box-installer/run.mjs` QEMU ownership/restart support and
`scripts/box/rig-contract{,.test}.mjs`; add planned cases `upgrade-readiness`,
`upgrade-manual`, `upgrade-power-cut`. Run each with `node bench/box-installer/run.mjs
--case <case> --run-dir <owned-directory>` on Linux before activation. Check interrupted
copy/restore, reboot holds, open-order preservation and absence of test-sale changes
in live data. Update `deploy/README.md` and `bench/real-upgrade/README.md`; leave
`index.json` unqualified. Normal hook and current-head scoped CI follow.

**Limits:** Never change fiscal writers, hashes, chains, number allocation or identity;
fake/confirm time, sell as a spare, bypass guards, or reach AEAT/providers/hardware/live
mounts. Add no protocol, durable record, ledger, deadline, email/support surface or
foundation cleanup. Online advisory trial follows this manual result; automation,
windows, reporting, signing and pairs remain later.

**Estimate:** Production +850/−150; tests +650/−80; support +400/−20; prose +110/−45
lines. Allow 9–13 hours: runnable qualification PR 4–6, activation/qualification PR
5–7. These are estimates, not measurements. No credible three-hour usable PR fits:
the smallest independently usable split is the executable qualification followed by
installed activation, not another dormant library. Watcher must settle this larger
boundary; three-hour checkpoints are progress checks, not permission to omit work.
