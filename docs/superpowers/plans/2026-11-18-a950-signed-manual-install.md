# A950 step 1b. Check a signed release before installing it by hand

On a provisioned box an administrator can run `sudo /opt/waitron-host/waitron.sh install v1.2.3`
to install a numbered release. With venue data, this uses the existing trial migration,
disposable-copy sale and Restore/Keep path. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Signed file](2026-11-18-a950-signed-release-file.md)

Lane F’s queue records the owner’s 18 November direction that “prereleases should only be
installable manually” and the watcher’s 20:36 instruction to verify with the files already on the box.

- **Put trust on the box first.** Package a small CLI around `verifyReleaseList` in
  `scripts/box/verify-release.mjs`. Ship it, `release-list.mjs`, its `upgrades/contracts.mjs`
  import and both PEMs in a separate `release-trust` folder under the host directory.
  The USB recipe (`deploy/box/build.sh`) and the checked development upgrade to `main`
  seed this folder from their own source revision. Staging a complete set before installing
  it preserves existing trust if a download fails. Before the owner lands the keys,
  development setup still works and numbered installs refuse. Document the installed
  command and how the existing test box gets it through a development upgrade without
  wiping data. Numbered installs require the retained script, verifier and runtime.
  The current and spare keys both work. Replenishing the spare after rotation stays open.
- **Check before fetching the candidate.** In `deploy/waitron.sh` fetch the public
  GitHub release asset at `releases/download/<tag>/waitron-release.json` (60 seconds,
  at most 16 KiB). The local CLI checks the signature and that the signed version
  matches the requested tag. Under the host lock, read `org.opencontainers.image.ref.name`
  from the running or stopped app container's immutable image, or the configured local
  image after container removal. Allow an unnumbered development image or the same
  numbered version. Refuse a lower number, including on reset, or an unreadable image
  on an existing box. Use numeric component comparison. The local runtime already
  exists on this route, so the candidate's bootstrap does not need to retake the lock.
- **Keep the chosen images through boot.** Resolve source metadata and fetch box files
  and the driver by signed SHA, with tag self-refresh skipped. Have the already-installed
  script prepare the candidate and pass the two digest-qualified references to the
  existing transaction, before replacing the retained driver. For fresh or reset installs
  on a box with trust, use the same verification and digest references for both pulls and
  Compose startup, including when the invoking shell exports image overrides. Verify
  before showing reset confirmation. Development refs keep their existing install path.
- **Start with failing checks.** Add `scripts/box/verify-release.test.mjs` for local trust,
  tag binding and numeric comparison. In `scripts/waitron-sh.test.mjs`, replace the
  mutable-tag expectations with signed SHA and digest checks. Show refusal before
  candidate downloads, pulls or reset, and cover the existing development-to-release
  path and a lower version on a stopped box. Reuse the transaction's recovery tests.
  Run those files and `scripts/box/release-list.test.mjs`. Update `deploy/README.md` and
  both A950 backlog entries.

The manual verifier accepts a signed prerelease with its own ordinary version number.
The fiscal-adjacent publishing slice adds `pnpm release tag <version> --prerelease`
and passes the annotated tag's marker to the signer and GitHub release. `prepare` still
requires a separate declaration for that version. After the keys and verifier land, update
the test box's trust, then cut two declared signed releases for the later booked rehearsal.
Staged offers, schedules, status and email follow. Paired upgrades await A947.

Estimate +210/−35 production and +200/−15 tests and support. Target three hours to open the PR.
