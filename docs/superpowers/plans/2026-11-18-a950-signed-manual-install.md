# A950 step 1b. Check a signed release before installing it by hand

With the trusted verifier and public keys on the box, an administrator can run
`waitron.sh install v1.2.3` to install a signed numbered release. On an existing box the
same command runs the trial migration, disposable-copy sale and Restore/Keep path.
[Parent plan](2026-11-09-a950-shorter-upgrades.md) · [Signed file](2026-11-18-a950-signed-release-file.md)

- **Install trust ahead of the upgrade.** Reuse `verifyReleaseList` from
  `scripts/box/release-list.mjs` in a small local CLI at `scripts/box/verify-release.mjs`.
  Ship it, its two local modules and the current and spare public keys through
  `deploy/box/build.sh`. Document how to seed those same files, the installer and the
  pinned host Node runtime on a Debian or earlier test box from a separately trusted
  Waitron checkout. Reuse `scripts/box/upgrades/bootstrap.sh` for the runtime.
  Numbered installs with missing local trust refuse and point to that setup step.
  A candidate install never replaces the local verifier or keys.
- **Verify first and use the result.** In `deploy/waitron.sh` route each numbered
  install, including a fresh install or explicit reset, through a bounded download of
  the tag's `waitron-release.json`. The local CLI verifies the signature and matches
  the signed version to the requested tag before emitting the commit and both digests.
  Compare the candidate number with the installed app image's numbered release label,
  using integer components. Read the running or stopped container's immutable image
  first and the configured local image if the container was removed. Refuse an older
  number or a failed read on an existing box, and allow the same version for repairs.
  Check the installed version under the existing host lock before any box changes.
- **Use the signed references throughout.** Fetch the upgrade driver, Compose and
  host files from the signed commit through the existing GitHub downloads. Skip
  tag-driven self-refresh on numbered installs. Hand the signed digests to the
  existing candidate preparation command and pull by digest on both install paths.
  Use the existing upgrade transaction on a box with state and the existing setup or
  reset flow otherwise. Main and branch/commit installs remain development paths.
  The manual path accepts the signed prerelease flag with a numbered tag. Producing
  prereleases with their own declarations, staged offers, schedules, status and
  email, and the booked physical rehearsal are later slices. Paired upgrades await A947.
- **Start with failing checks.** `scripts/box/verify-release.test.mjs` owns the local CLI
  contract, tag binding and numeric comparison. `scripts/waitron-sh.test.mjs` exercises
  install with a signed fixture, exact SHA and both digest pulls, and proves missing
  or untrusted metadata stops before candidate downloads, pulls, or reset. Cover the
  existing-box path including an older release on a stopped box, plus fresh and reset
  dispatch. Reuse the transaction's existing check and recovery tests. Run the changed
  files with root Vitest and the existing release-file tests. Update `deploy/README.md`
  and the A950 lines in `docs/backlog.md` and `docs/backlog/box.md`.

Estimate +190/−35 production and +190/−15 tests and support. Target three hours to
open the PR after the watcher clears this plan.
