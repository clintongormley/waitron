# A950: usable manual upgrade, revised draft

**Request:** "A950. First remote venue: safe manual upgrades, then automation".
Separate GPT-6.1 Sol draft; first Claude read: 418 seconds. Revisions await
one reread, not build clearance. Watcher 12 November 19:40 settles scope and
grants one PR roughly 2,300 changed lines/10 working hours; 19:46 requires the
restart experiment below first. Build follows reread
unless Critical. A790's fix round comes first. No owner approval of this design;
[historical grouping](2026-11-09-a950-shorter-upgrades.md) remains input.

**Result:** `sudo bash waitron.sh install <ref>` preserves single-box orders/data,
requires a successful actual primary cash sale on a disposable copy, then
commits/reopens or holds for manual restore/keep. No live test sale or other project prerequisite.

H=`scripts/box/upgrades/`; S=`apps/server/src/`; B=`deploy/box/`.

1. **Host.** Add H/`cli.mjs` apply/status/restore/keep/offline-recovery dispatch through
   H/`host.mjs:{createUpgradeHost,recoverInstalledUpgrade}` and
   H/`transaction.mjs:{applyUpgrade,recoverUpgrade,upgradeStatus}`. Install
   H/`bootstrap.sh` and H/`{cli,host,transaction,copy}.mjs` from `RAW_BASE/<resolved-sha>/scripts/box/upgrades/`
   into `/opt/waitron-host/box/upgrades/`; use `/opt/waitron-host/node-v26.7.0/bin/node`.
   Keep attempt-writing code/runtime for recovery. Run `bootstrap.sh /opt/waitron-host "$WAITRON_DIR"` first, releasing its
   lock, then acquire/recheck the attempt lock. Status only discovers/reads
   `upgradeStatus`; status/restore/keep never bootstrap.
   Update `deploy/waitron.sh:{main,usage,cmd_install,cmd_status,cmd_reset,select_image,fetch_box_files}`:
   stage candidate Compose/environment; pin/tag old IDs before builds/pulls, including
   stopped sources. After old tagging, a candidate-preparation callback returns explicit
   candidate-ID maps and Compose, bypassing registry resolution for built/local
   images; retain the active tunnel's resolved ID
   across previously pinned Compose. Resolve candidate interpolation from candidate
   environment. Refresh AppArmor/Bluetooth/host service before attempts. Fresh/reset
   installs bypass apply; pending attempts block refresh/reset. Setup-only fails
   readiness and stays held, never skips the sale.

2. **Copy checks.** Extend S/`upgrade-check-entry.ts:runUpgradeChecks` with executable
   main and explicit `--entrypoint`; retain existing `deploy/Dockerfile` bundle.
   Extend S/`upgrade-checks.ts`; add S/`upgrade-sale.ts:checkUpgradeSale`.
   Use one fresh disposable tree: readiness, then separate sale process, plus intact
   restore copy. Extend H/`host.mjs:assertCopyRoom` for both/reserve; reuse H/`copy.mjs`.
   Pass real Compose environment/deployment/backup settings with explicit isolated
   state, `venue.db`/`node.db`, logs, backups and agent mounts; never `compose run`.
   Sale app: `--network none`; agent: `--network container:<app>`, no hardware mounts.
   Block `/print-api/agent/jobs` dispatch before polling; prove agent startup without sending jobs.
   Use loopback TLS cash requests. Reuse S/`first-setup-launch.ts:startServerOrFirstSetupResolution`,
   S/`boot.ts:startServer`, real listener/menu/Orders readers; retain ordinary admission,
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
   then `/api/sales` with `x-waitron-person`. No test-helper imports/existing-identity
   edits. Require invoice/totals, configured-backend persistence and VeriFactu chain
   continuation; every refusal fails.
   H/`host.mjs` forwards only literal `clock.status\n` to the real host socket,
   relaying one reply line through a socket accessible to uid10001; setting refused.
   S/`box-host-client.ts:boxHostClient` interprets replies; missing/unsynchronised fails.

3. **Activation.** Before writing replacement services, run the Linux power-cut
   case once with today's Docker restart rules (watcher 19:46). Retain the log:
   if reboot leaves the box safely held, drop the systemd change; otherwise keep
   it with that receipt. Reuse marker/lock/shutdown-completion refusal; interrupted
   restore restarts from intact copy. Bootstrap/offline recovery remain Docker-independent.
   Only if the experiment requires replacement owners, add B/`waitron-{app,upgrade-recovery}.service`; update
   B/`{build.sh,start-dev.sh,waitron-dev.service}`, including marker holds/AppArmor,
   and S/`run-server.ts` restart prose. Remove four `deploy/compose.yml` restart
   policies only with replacement owners and Linux qualification.

**Verification:** TDD; S/`boot.upgrade.test.ts`/new `upgrade-sale.test.ts` own admission/sale;
H sibling tests own sender/host/transaction failures once; shell tests wiring/answers,
without repeated matrices. Run
`pnpm --filter @waitron/server exec vitest run src/{boot.upgrade,upgrade-sale,run-server}.test.ts`;
`pnpm exec vitest run scripts/box/upgrades/{host,transaction,copy,bootstrap,cli}.test.mjs scripts/waitron-sh.test.mjs scripts/box/{installed-start,recipe-setup,rig-contract}.test.mjs`.
Extend `bench/box-installer/run.mjs` and `scripts/box/rig-contract{,.test}.mjs`:
planned `upgrade-manual`/`upgrade-power-cut` cases use owned Linux QEMU resources,
tar-loaded pinned images and installed CLI against `/opt/waitron`; qualify interrupted
copy/restore, reboot holds, preserved orders and no live test-sale changes before
activation. Docker power-cut behavior remains runtime unverified until that
experiment. Normal hook/current-head CI follow.

Update `deploy/README.md`, `bench/real-upgrade/README.md`; leave `index.json` unqualified.
Online trial follows; automation/windows/reporting/signing/pairs remain later.
Never change fiscal writers/hash/chain/numbers, fake/confirm time, sell as spare,
bypass guards or reach AEAT/providers/hardware/live mounts. No new upgrade protocol/record/ledger/deadline/support surface/cleanup.

**Estimate:** production +850/−150, tests +650/−80, support +400/−20, prose +110/−45:
2,305 changed lines, approximately the ceiling; 9–13 hours, so ten-hour completion
is uncertain. One PR; signed commit after each task; report production/tests/support
at checkpoints. Past either ceiling, stop/report to watcher; no rig-only or sale-free split.
