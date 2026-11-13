# A950: usable manual upgrade, build plan

**Request:** "A950. First remote venue: safe manual upgrades, then automation".
Separate Sol-high draft; Claude reads: 418/354 seconds, no Critical. Watcher
12 November 19:40 clears one PR/~2,300 changed lines/10 working hours; 19:46
requires the restart experiment below. No owner design approval claimed.
[Historical grouping](2026-11-09-a950-shorter-upgrades.md) remains input.

**Result:** `sudo bash waitron.sh install <ref>` preserves single-box orders/data,
requires a successful primary cash sale on a disposable copy, then
reopens or holds for manual restore/keep. No live test sale.

H=`scripts/box/upgrades/`; S=`apps/server/src/`; B=`deploy/box/`.

1. **Host.** Add H/`cli.mjs` apply/status/restore/keep/offline-recovery dispatch through
   H/`host.mjs:{createUpgradeHost,recoverInstalledUpgrade}` and
   H/`transaction.mjs:{applyUpgrade,recoverUpgrade,upgradeStatus}`. Install
   H/`bootstrap.sh` and H/`{cli,host,transaction,copy}.mjs` from `RAW_BASE/<resolved-sha>/scripts/box/upgrades/`
   into `/opt/waitron-host/box/upgrades/`; use `/opt/waitron-host/node-v26.7.0/bin/node`.
   Retain recovery code/runtime. Run `bootstrap.sh /opt/waitron-host "$WAITRON_DIR"` first, releasing its
   lock, then acquire/recheck the attempt lock. Status reads
   `upgradeStatus`; without Node retain image status. Status/restore/keep never bootstrap.
   Update `deploy/waitron.sh:{main,usage,cmd_install,cmd_status,cmd_reset,select_image,fetch_box_files}`:
   refuse pending attempts before self-refresh; pin/tag old IDs before builds/pulls,
   including stopped boxes. Resolve pulled main through its image revision label;
   fetch Compose/modules from that revision, not moving Git main. A preparation callback returns
   candidate-ID maps and refreshed Compose, bypassing registry resolution for local
   images; retain the active tunnel's resolved ID. Resolve candidate interpolation from candidate
   environment. Refresh AppArmor/Bluetooth/host service before attempts. Fresh/reset
   installs bypass apply; pending attempts block refresh/reset. Setup-only fails
   readiness and stays held, never skips the sale.

2. **Copy checks.** Extend S/`upgrade-check-entry.ts:runUpgradeChecks` with executable
   main and explicit `--entrypoint`; retain existing `deploy/Dockerfile` bundle.
   Extend S/`upgrade-checks.ts`; add S/`upgrade-sale.ts:checkUpgradeSale`.
   Use one fresh disposable tree under the attempt: readiness, then separate sale
   process; restore reads only intact `copies/`. Finally remove the disposable tree,
   pass/fail; recover only its owned leftovers after interruption. Extend H/`host.mjs:assertCopyRoom` for both/reserve; reuse H/`copy.mjs`.
   Pass Compose environment/deployment/backup settings with isolated
   state, `venue.db`/`node.db`, logs, backups and agent mounts; never `compose run`.
   Readiness uses host networking/503 listener. Sale uses `--network none`; agent
   shares its namespace without hardware mounts. Require agent `/status.json`, stop
   it before the sale; no job-route override. Containers never restart; remove only
   owned leftovers. Use loopback TLS cash requests. Reuse S/`first-setup-launch.ts:startServerOrFirstSetupResolution`,
   S/`boot.ts:startServer`, listener/menu/Orders readers; retain admission,
   accepted-copy placement, legacy-workspace and peer/start-clock checks.

   Seed before startup; use HTTP once running. Fixture: insert a new copy-only admin
   operator into `@waitron/db:persons` using
   `@waitron/identity:{hashPin,foldForUniqueness}`; `verifyPersonCredential` precedes
   `startManagementSession`. Use `@waitron/layouts:createDeviceProfile`, identity
   `setProfileAdmission`, catalogue
   `createCatalogue/createProduct/addProductToMenu/previewMenu/publishMenu`.
   Use venue-service `operations.ts:{createDepartment,createServiceZone}`,
   `menu-timetable.ts:{saveMenuPeriod,replaceMenuWeek}` and
   `business-day-schedule.ts:readBusinessDayScheduleRevision` for a copy-only counter
   open throughout the week; `profile-access.ts:setProfileServiceScope` binds its profile.
   Normal device/join HTTP routes preserve window/number/claim checks; `loginWithPin`
   then `/api/sales` with `x-waitron-person`. No test-helper imports/identity edits. Require invoice/totals, configured-backend persistence and VeriFactu chain
   continuation; every refusal fails.
   H/`host.mjs` relays literal `clock.status\n`/one real reply at
   `/run/waitron-box/box.sock`, uid10001-accessible; other commands get wire refusals.
   S/`box-host-client.ts:boxHostClient` interprets replies; missing/unsynchronised fails.

3. **Activation.** Before replacement services, run the Linux power-cut
   case once with current Docker rules (watcher 19:46); log decides: held means
   drop systemd changes, otherwise retain them. Reuse marker/lock/shutdown-completion refusal; interrupted
   restore restarts from intact copy. Bootstrap/offline recovery remain Docker-independent.
   Only if the experiment requires replacement owners, add B/`waitron-{app,upgrade-recovery}.service`; update
   B/`{build.sh,start-dev.sh,waitron-dev.service}`, including marker holds/AppArmor,
   and S/`run-server.ts` restart prose. Remove four `deploy/compose.yml` restart
   policies only with replacement owners and Linux qualification.

**Verification:** TDD; S/`boot.upgrade.test.ts`/new `upgrade-sale.test.ts` own admission/sale;
H sibling tests own sender/host/transaction failures once; shell tests wiring/answers,
Run
`pnpm --filter @waitron/server exec vitest run src/{boot.upgrade,upgrade-sale}.test.ts`;
`pnpm exec vitest run scripts/box/upgrades/{host,transaction,copy,bootstrap,cli}.test.mjs scripts/waitron-sh.test.mjs scripts/box/{installed-start,recipe-setup,rig-contract}.test.mjs`.
Extend `bench/box-installer/run.mjs` and `scripts/box/rig-contract{,.test}.mjs`:
planned `upgrade-manual`/`upgrade-power-cut` cases use owned Linux QEMU resources,
tar-loaded pinned images and installed CLI against `/opt/waitron`; qualify interrupted
copy/restore, reboot holds, preserved orders and no live test-sale changes before
activation. Docker reboot behavior awaits that experiment. Run restart tests only if changed; normal hook/current-head CI follow.
The real self-refresh/build shell path remains runtime UNVERIFIED unless exercised;
state that in the PR. Setup-only guidance names `--reset install`/keep.

Update `deploy/README.md`, `bench/real-upgrade/README.md`; leave `index.json` unqualified.
Online trial follows; automation/windows/reporting/signing/pairs remain later.
No fiscal-writer/hash/chain/number edits, fake time/auto-confirmation, spare sales, guard
bypasses, AEAT/providers/hardware/live mounts or new protocol/record/ledger/deadline/support surface.

**Estimate:** production +850/−150, tests +650/−80, support +400/−20, prose +110/−45:
2,305 changed lines **including systemd**; 9–13 hours, ten-hour completion uncertain.
Dropping systemd saves roughly 600 lines/3–5 hours (estimate). Signed task checkpoints
report production/tests/support. Past either ceiling, stop/report; no rig-only/sale-free split.

**12 November, restart experiment:** the current B3 start and Compose policies reopened
all three containers after a QEMU kill while the durable manual marker still read
`candidate`, `copied: true`. The watcher’s 19:46 condition therefore retains the
restart-service work. Lane F receipt: `receipts/a950-usable-manual-plan-20261112/restart-evidence/restart-result.json`
and its `cut-serial.log` / `after-cut-serial.log`. This used an already-stopped,
setup-only synthetic source and same-image candidate, paused after the real stopped-tree
copy; it does not qualify the installed manual command or successful sale on Linux.

**12 November, driver source (watcher 22:20/22:25, Lane F questions.md):** bootstrap
one fixed driver before the attempt lock; retain it throughout apply and recovery.
Prefer the registry image's revision read without pulling. If no label or the whole
driver is absent there, use the resolved Git SHA for every driver file and log the
fallback. Candidate Compose still follows its image revision. The installed managed
Compose omits restart policies; the source template retains them for unmanaged use.

**12 November, watcher 22:59/23:02 (Lane F questions.md):** reuse the agent's existing
Docker healthcheck, then read status once; remove the separate 90-second status wait.
Linux tests, docs and review fixes may reach about 2,600 changed lines; the ten-hour
working budget stays. These are watcher clearances, not owner design approval.

**13 November 00:32 amendment, watcher:** replace the persistent restart owner described
above with a oneshot boot gate; retain pre-Docker offline recovery and ordinary Docker
restart policies. Disable existing containers' policies before the durable attempt marker;
Compose restores them on reopen after the recorded decision. Remove restart.mjs and its
monitor tests; the wrapper's boot-gate tests remain. The discriminating control with only
B3's pending guard reopened all three running containers before stop, but held after the
stopped copy. A control adding policy-disable must hold at both boundaries before the one
fresh fixes read. No new review wave. Mandatory copy-sale and manual/interrupted-restore
qualification remain. This amendment supersedes the policy-removal/monitor references above.

**13 November, runtime correction:** actual `compose up --wait` left an unchanged container's
policy at `no`; reopen therefore explicitly restores the Compose-declared policies after up.
The owned Docker probe is retained as `compose-policy-reopen-probe.json` in the lane receipts.
