# A950 step 1c. Publish and read a staged upgrade offer

A release operator can offer a stable release to a group of boxes, expand the group,
or pause it for everybody. A box can check the offer without a Cloud account. The
nightly installer will use this check when step 5 connects it. The watcher authorised
planning on the signed-file default on 19 November at 00:01. Implementation awaits
both the owner's publication decision and watcher clearance. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Signed manual install](2026-11-18-a950-signed-manual-install.md)

## 1c. Offer publication and selection

- Reuse the Ed25519 envelope in `scripts/box/release-list.mjs` for `kind: "offer"`.
  `scripts/box/release-offer.mjs` defines format 1 with one candidate `version`, the
  SHA-256 of its `waitron-release.json` bytes, and one rule. Accept `bucketBelow` (0–100,
  exclusive), `installations` (a list of box IDs), `atLeast` (a running version floor),
  `none` or `all`. Use the box UUID that `host.mjs` reads from `trading.env`. For the
  bucket, take the first four bytes of SHA-256 over `boxId + ":" + version`, as an
  unsigned big-endian integer modulo 100. Keep the rule vocabulary fixed in format 1.
- Add `.github/workflows/publish-upgrade-offer.yml` and `scripts/release/sign-release-offer.mjs`.
  Dispatch from a numbered tag into the existing tag-restricted `release` environment.
  Verify the tag's published stable release file with the committed keys, check its
  version and rule, then sign with the existing secret and replace only `waitron-offer.json`
  on a fixed `upgrade-offer` release. Limit the writer to one run at a time. Publish `none`
  to pause the current offer. A missing asset during replacement defers selection.
- In `scripts/box/verify-release.mjs` add a read-only offer command. Read the offer
  afresh from the fixed HTTPS address with bounded downloads and the installed trust.
  Defer on bad proof, unknown rule or format, missing input or a candidate that is
  already installed or older. For a matching rule, fetch the numbered release, verify
  its signature and bind its bytes to the offer's hash. The existing signed file holds
  `app`, `printAgent` and `tunnel` (Lane J's proposed fields). Pass its verified release
  to step 5, which must check the live offer again before applying. To add a fourth
  image, first ship a verifier that reads both inventories, then enable the expanded
  inventory after the supported boxes can read it. The offer continues to bind the file.
- Start with failing cases in `scripts/box/release-offer.test.mjs` for stable groups,
  changed grouping across releases, rule boundaries and unknown rules. The verifier
  suite owns bad signatures, swapped release bytes, version and prerelease refusal,
  and the three image digests. `scripts/release/sign-release-offer.test.mjs` owns
  refusal before upload and the pause command. The workflow guard owns tag/environment
  admission and the asset path. Update `docs/operations/release.md` and the A950 backlog.
  Estimate +240/−20 production and +280/−0 tests and support.

## 1d. Keep numbered-release boxes able to verify the next release

- Reuse `fetch_release_trust` in `deploy/waitron.sh` and the trust layout from
  `deploy/box/build.sh`. The installed verifier checks the numbered release first.
  Fetch the complete verifier and both keys from that signed source commit. Validate
  the staged files before activating them as a unit after a successful checked upgrade.
  Retain old trust on interrupted staging or rollback. Teach the package and fetch
  paths to carry `release-offer.mjs`. The first release that changes a key keeps one
  trusted key in common and is signed by that key.
- Start with failing `scripts/waitron-sh.test.mjs` cases for rotation on a numbered
  box and retaining usable old trust after a failed download or upgrade. Use real
  signatures for the old-to-new verifier handoff. Update `deploy/README.md` and the
  A950 backlog. Estimate +105/−20 production and +145/−0 tests and support.

Prerelease publishing and the real release-to-release rehearsal have their own steps.
Automatic installs, the window, Box status and email follow in steps 5 and 7.
