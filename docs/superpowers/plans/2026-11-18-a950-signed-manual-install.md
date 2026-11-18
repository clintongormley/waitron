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
  development setup still works and numbered installs refuse. For the first checked
  upgrade to main, download and run the new main script: the previously installed copy
  cannot seed trust. On plain Debian, first install main, then run that checked upgrade
  to main before a numbered install. Document and test this handoff without wiping data.
  Numbered installs require the retained script, verifier and runtime. Both keys work.
  The later offer-file slice delivers new keys and verifier code to numbered-release boxes.
- **Check before fetching the candidate.** In `deploy/waitron.sh` fetch the public
  GitHub release asset at `releases/download/<tag>/waitron-release.json` (60 seconds,
  at most 16 KiB). The local CLI checks the signature and that the signed version
  matches the requested tag. On an existing box, fetch the candidate bootstrap and
  driver by the signed SHA. Run the bootstrap after verification and before the
  installer's lock, since the bootstrap takes that lock itself. Under the lock, read
  `org.opencontainers.image.ref.name` from the running or stopped app container's
  immutable image, or the configured local image after container removal. Allow an
  unnumbered development image or the same numbered version. Refuse an unreadable
  image or lower version on this path. Compare version components numerically.
- **Keep the chosen images through boot.** Resolve source metadata and fetch box files
  and the driver by signed SHA, skipping tag self-refresh. The installed script verifies
  the file, then installs the new driver and runs its transaction with both signed digests
  on the new script's `__candidate` call. The new driver handles any held Restore/Keep.
  Fresh or reset installs on a box with trust use the signed references for both pulls and
  Compose startup, including when the invoking shell exports image overrides. Verify
  before reset confirmation. Reset accepts an older signed release because it wipes
  the venue data (watcher's choice at 22:47, open to the owner).
- **Start with failing checks.** Add `scripts/box/verify-release.test.mjs` for local trust,
  tag binding and numeric comparison. In `scripts/waitron-sh.test.mjs`, replace the
  mutable-tag expectations with signed SHA and digest checks. The signed fresh-install
  case checks both Compose image variables during pull and startup. Show refusal
  before candidate downloads, pulls or reset, and cover the development-to-release
  path and a lower version on a stopped box. Reuse the transaction's recovery tests.
  Run those files and `scripts/box/release-list.test.mjs`. Update `deploy/README.md` and
  both A950 backlog entries.

The manual verifier accepts a signed prerelease with its own ordinary version number.
The fiscal-adjacent publishing slice adds `pnpm release tag <version> --prerelease`
and passes the annotated tag's marker to the signer and GitHub release. `prepare` still
requires a separate declaration for that version. After the keys and verifier land, update
the test box's trust, then cut two declared signed releases for the later booked rehearsal.
Staged offers, schedules, status and email follow. Paired upgrades await A947.

Estimate +210/−35 production and 350–450 test and support lines. Target three hours to open the PR.
