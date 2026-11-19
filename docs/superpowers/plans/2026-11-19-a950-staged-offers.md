# A950 steps 1c and 1d. Keep release trust current and stage upgrades

A box on numbered releases can receive updated verification code and keys. Then a
release operator can offer a stable release to a group, widen the group or pause for
everybody. Boxes check without a Cloud account. Trust refresh (1c) landed in #3814.
The owner chose the signed offer on 19 November. Claude reviewed the revised offer plan (1d).
The watcher cleared it on 19 November at 15:24 in Lane F’s questions.md. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
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
A release operator publishes one signed offer beside the releases. Step 5 will read it from
the fixed location, `waitron-offer.json` on the `upgrade-offer` release. The owner chose a
version per group and a default on 19 November at 13:26–13:30, as relayed in Lane F’s
questions.md at 13:31. The watcher authorised revising the plan at 15:06.

### 1d(i). Select a version from a signed offer

- Add the pure selector to `scripts/box/release-list.mjs`, which numbered installs already
  download through `fetch_release_trust`. Reuse its Ed25519 envelope and key checks and the
  numeric version comparison from `scripts/box/verify-release.mjs`. The format-1 payload has
  `kind: "offer"`, a positive integer serial, ordered entries and a required default. An entry
  has one condition and a target. The default is a target. Each target names a numbered version
  or `none`. The first matching entry wins, otherwise the default. Only a strictly newer
  version can proceed. A match with `none` or an equal or older version ends selection.
- `installations` matches the box ID. `atLeast` compares the installed version with its floor.
  For `bucketBelow`, take SHA-256 of `boxId + ":" + targetVersion`, read its first four bytes
  as an unsigned big-endian integer and take the remainder modulo 100. The threshold is an
  integer from 1 to 99. Match when the result is below it. To pause a percentage group, put
  `none` in its target and keep the previous target in `bucketVersion` for the hash. An empty
  entry list with default `none` pauses every box.
- Pass offer bytes, trusted keys, box ID, installed version and last-seen serial and digest to
  the selector. It returns the selected version or no upgrade and the accepted serial and
  digest. Refuse offers above 16 KiB, lower serials and different bytes at the same serial.
  Accept an identical retry. An unknown format or rule defers the offer. Skipping it could
  apply the default to a box the publisher meant to exclude.
- `scripts/box/release-list.test.mjs` owns first match, an older default, group and full pauses,
  stable percentage membership, bad signatures or rules, non-newer targets and replay after
  pause. Preserve the manual verifier’s version cases in `scripts/box/verify-release.test.mjs`.
  Estimate production +140/−20 lines and tests +190/−0.

### 1d(ii). Publish and read back one file

- Add `scripts/release/publish-upgrade-offer.mjs` and `.github/workflows/publish-upgrade-offer.yml`.
  Accept entries and default as one dispatch JSON input. Refuse formats other than 1, unknown
  conditions and a signed file above 16 KiB. For each named version, verify its published,
  signed, non-prerelease `waitron-release.json`. Dispatch from a numbered tag containing the workflow after it lands
  on main, with a published GitHub Release and signed release file. Use the existing
  `release` environment and signing secret once its `v*` tag rule is in place.
- The operator creates `upgrade-offer` with `--latest=false`. Keep one concurrency group and the
  workflow path fixed. Its run number is the serial. A missing asset permits publication.
  A failed read, lower serial or conflicting retry refuses it. Replace only `waitron-offer.json`
  and verify the bytes read back. Confirm a pause’s serial and targets before dispatching
  another change. In an emergency cancel outstanding publication runs, remove the asset and
  publish an empty list with default `none`. Republish with the shared key before retiring
  a signing key, so the publisher can still verify the existing offer.
- Test refusal before upload, retry and read-back in `scripts/release/publish-upgrade-offer.test.mjs`.
  Use `scripts/ci-workflow.test.mjs` for publication admission. Update `docs/operations/release.md`
  and the A950 backlog. Run the first real publication with the test-box rehearsal once the
  keys, declaration and tunnel digest are ready. Estimate production +155/−0 lines and tests
  and support +180/−0.

Step 5 owns downloads, saving the highest accepted serial and digest including pauses, missing
state policy and the recheck before Apply. It reads `WAITRON_NODE_ID` from `trading.env` through
the state-volume reader in `deploy/waitron.sh` and defers on a missing ID. Document that a
fresh-identity restore changes the box’s group membership. A box takes its first offer-capable
release through the checked manual path. Automatic installs use that path’s existing signed
release check with an additional prerelease refusal. Pauses stop attempts that have yet to
pass the recheck. Manual installs remain independent of the offer.

`pnpm release prepare 1.2.3-rc.1 --place Madrid` refuses the suffix. The separate
prerelease publishing slice changes fiscal-adjacent tagging and signing to mark
an ordinary numbered version while keeping its own declaration. The physical
rehearsal, automatic window, status and email remain separate steps.
