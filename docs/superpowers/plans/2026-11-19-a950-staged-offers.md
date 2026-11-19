# A950 steps 1c and 1d. Keep release trust current and stage upgrades

A box on numbered releases can receive updated verification code and keys. Then a
release operator can offer a stable release to a group, widen the group or pause for
everybody. Boxes check without a Cloud account. Trust refresh (1c) landed in #3814.
The owner chose the signed offer on 19 November. The revised offer plan (1d) awaits
watcher clearance. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Signed manual install](2026-11-18-a950-signed-manual-install.md)

## 1c. Refresh trust through checked numbered installs

- In `deploy/waitron.sh`, verify the numbered release with installed trust before
  fetching anything from its signed commit. Run from the 1c installer or newer.
  Keep the downloaded file so both verifiers can check the same bytes and
  agree on the commit and image digests. Reuse `fetch_release_trust` to stage
  the verifier and both keys from that commit. Recheck installed trust under
  the lock before replacing it.
  Activate the complete set under the existing host lock alongside the
  retained driver, before Apply. Rename the `release-trust` symlink over its
  previous link so the verifier and keys switch together. A failed fetch or
  validation leaves the previous set usable. Remove old sets under the lock.
  Restore keeps the retained driver and its matching trust. Fresh and reset
  installs keep the existing trust set. A key change keeps one key in common and
  uses it to sign the release that carries the change. Introduce a new verifier
  file to the retained download list and recipe one release before importing it.
  Keep both keys as they are in the release introducing the new file. Boxes must
  take that release before trying one that needs the file.
- Lane J adds `tunnel` beside `app` and `printAgent`. Publish the first signed
  release after that lands. Seed test boxes with the three-image verifier and
  driver using the documented main upgrade or box recipe. The shell rejects an
  incomplete or unexpected digest inventory. After go-live, adding a fourth
  role needs a transition release that understands both inventories.
- Start with failing `scripts/waitron-sh.test.mjs` cases for trust rotation and for
  a failed fetch and Restore after failed Apply, with real signed files. The
  release-list and shell suites own the image inventory and mapping to Compose. Update `deploy/README.md`
  and the A950 backlog. Estimate +110/−20 production and +150/−0 tests and support.

## 1d. Publish and select a signed offer

A release operator can publish one signed offer at the fixed location, the `upgrade-offer`
release’s `waitron-offer.json`. The selector can find the version allowed for a box without a
Cloud account. Step 5 connects it to automatic upgrades. The owner chose a version per group and a
default on 19 November at 13:26–13:30, as relayed in Lane F’s questions.md at 13:31.

- Add `scripts/box/release-offer.mjs`, reusing the Ed25519 envelope and key checks in
  `scripts/box/release-list.mjs`. Its strict format-1 payload has `kind: "offer"`, one serial,
  ordered entries and a required default. Each entry has one `bucketBelow`, `installations` or
  `atLeast` condition and a target; the default is a target. A target is `none` or a stable
  version plus SHA-256 of that version’s signed `waitron-release.json` bytes. `installations`
  matches the installation ID; `atLeast` compares the installed version with its floor. First
  matching entry wins, otherwise default. A pause or a target no newer than installed ends
  selection without falling through. An unsupported rule defers the offer so an older verifier
  cannot fall through to a version intended for other boxes. An empty entry list with default
  `none` pauses everybody.

- Keep `bucketBelow` at integers 1–99, exclusive. Hash `installationId + ":" + targetVersion`;
  take SHA-256’s first four bytes as an unsigned big-endian integer modulo 100. When its target
  becomes `none`, retain the paused version as `bucketVersion` in that same signed entry, solely
  to seed the hash and preserve membership. Require it for paused bucket entries; reject it
  elsewhere. No release download is needed for this seed. Step 5 reads `WAITRON_NODE_ID` from
  `trading.env`, reusing `deploy/waitron.sh`’s state-volume reader. Failed reads or absent IDs
  defer. A restore retaining its ID retains membership for the same seed.

- The pure selector takes offer bytes, trusted keys, box ID, installed version and last-seen
  serial and digest. It returns the selected target or no upgrade, together with the accepted
  offer’s serial and digest. Compare against the entire signed offer. Refuse older serials and
  changed bytes at the same serial. Accept identical retries. Verify the selected release in a
  second pure check with its own signed bytes, matching version, stable status and exact
  metadata-byte digest before returning image choices. Publication checks every non-paused
  target’s own signed release. An older default remains eligible even when an earlier group names
  a newer release.

- Add `scripts/release/publish-upgrade-offer.mjs` and
  `.github/workflows/publish-upgrade-offer.yml`. Admit only a published numeric tag containing the
  workflow, after it lands on main. Use the `release` environment after its owner-configured `v*`
  tag restriction. Keep the workflow path fixed because its run number supplies the single serial.
  Use publication with a constant concurrency group. The operator creates `upgrade-offer` with
  `--latest=false`. Verify the existing offer before comparison; refuse older serials, conflicting
  retries and unreadable existing assets. Validate and sign before upload, replace only
  `waitron-offer.json`, then read back and compare bytes. Publish pauses from the newest eligible
  tag and confirm serial and targets. Emergency asset removal stops fresh reads. Follow it with
  signed default `none`.

- Start with failing `scripts/box/release-offer.test.mjs` cases distinguishing overlapping groups,
  newer group/older default upgrades, equal/older targets, default/group pauses, preserved bucket
  membership and offer replay after pause. That suite also owns unsupported rule,
  wrong-kind/signature, substituted metadata and prerelease refusals. Add
  `scripts/release/publish-upgrade-offer.test.mjs` for refusals before upload, retries and
  read-back failures. Use `scripts/ci-workflow.test.mjs` for publication admission and the fixed
  workflow path. Retain `release-list.test.mjs` assertions when sharing envelope code. Run these
  focused files through root Vitest. `scripts/waitron-sh.test.mjs` owns changed trust-download
  assertions.

- Modify `deploy/waitron.sh` and `deploy/box/build.sh` to ship the offer module through 1c’s trust
  path. Introduce download-list additions one release before importing them, keep keys unchanged
  in that transition release, and offer it before releases needing the file. Step 5 owns
  downloads, durable highest-serial/digest storage for every accepted offer including pauses,
  missing/unreadable replay-state policy, and the pre-Apply recheck. A fresh pause prevents a new
  start; an attempt past that recheck finishes. Update `docs/operations/release.md` with the fixed
  asset, selection/pause examples and reading only the installation ID. Update the A950 backlog.
  Automation, manual release checks, signing setup, prerelease publishing and physical
  qualification stay in their slices. Estimate production +330/−20 lines and tests/support
  +420/−0.

`pnpm release prepare 1.2.3-rc.1 --place Madrid` refuses the suffix. The separate
prerelease publishing slice changes fiscal-adjacent tagging and signing to mark
an ordinary numbered version while keeping its own declaration. The physical
rehearsal, automatic window, status and email remain separate steps.
