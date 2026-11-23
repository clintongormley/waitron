# A950. Rehearse a checked upgrade on an isolated Prepare box

The watcher cleared planning this rehearsal in Lane F `questions.md` on 22 November at 21:58.
At 21:56 the watcher relayed the owner’s “let's not do a real release yet.” ENV8 has landed.
The rehearsal will show whether the installed command upgrades a running Prepare box and
restores its previous app and data after a failed check.

1. **Start with a trading fixture.** Use an existing disposable Debian/systemd guest with its own
   Docker, disk and network, or a dedicated isolated Prepare box. Supply a synthetic Prepare
   archive and adjacent settings JSON as described in [the bench instructions](../../../bench/box-installer/README.md#check-a-manual-upgrade-and-interrupted-recovery).
   Confirm `/health`, clock sync, image IDs and fingerprints of one fiscal sale and one open order
   with a line. Allow installer downloads
   and time sync. Exclude venue integrations and paired boxes. Follow `test-box.md` on the shared
   host. Take the helper lock, run well under an hour, reduce concurrency below ~2 GB available,
   release promptly and try elsewhere on exit 75. Keep the host’s running Waitron and its resources
   outside the guest. Use another machine if the rig’s ~8 GiB requirement cannot fit.
2. **Enter through install.** Against the guest’s existing Compose and state volume, run
   `sudo bash /opt/waitron-host/waitron.sh install <unnumbered-upstream-commit-SHA>` with a different
   build from baseline. In `deploy/waitron.sh`, `cmd_install` calls `cmd_checked_install`, which
   invokes `apply` with `__candidate`. Require the online trial, stopped-copy migration and fiscal
   checks, TLS readiness, print-agent check and cash sale to pass. Verify `committed`/`candidate`,
   candidate image IDs, healthy reopen and unchanged fiscal, sale and order rows. Replay from
   baseline using the guest-only failure controls in `bench/box-installer/upgrade.mjs`
   (`failedOnlineTrialProbe`, `upgradePayload`). Trial refusal must preserve the old container and
   start time and leave the baseline rows intact. Use the port blocker to fail readiness after
   copying. Read `waitron.sh status`
   (`awaiting-choice`, `copied: true`), release the blocker and run `waitron.sh restore`. Verify
   old images, Compose/settings, row fingerprints and healthy reopen. Keep the bench’s direct
   `apply` results as comparison evidence. [Installer instructions](../../../deploy/README.md#checked-manual-upgrades)
3. **Check fixtures and time the stages.** Run `pnpm exec vitest run scripts/box/{verify-release,release-list,upgrades/cli}.test.mjs`
   for trusted and invalid signatures, selection, pause and replay. Exercise the 03:00–05:00
   venue-local default and the 30-minute cutoff in `checkUpgradeWindow` and `recheckOfferedUpgrade`.
   `deploy/waitron.sh`’s `verify_numbered_release` fetches the numbered asset
   upstream. Keep fixture trust in the suites and leave scheduling opt-in. Save commands, refs,
   image digests and outcomes. Time download/build, trial, drain, copy, final checks, Restore and
   reopen from guest logs and phase timestamps. Use the half-hour timer cadence as a reference
   for possible trigger delay. Keep scheduling opt-in through the real signed release-to-release
   check, which will cover publication, actual timer and download timings, and automatic rollback.

**Size.** This page is the only proposed repository change. The rehearsal uses existing
production code and tests. If a guest cannot exercise an operation, take the missing operation
and smallest proposed change to the watcher before writing code.
