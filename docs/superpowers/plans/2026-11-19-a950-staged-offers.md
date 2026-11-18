# A950 steps 1c and 1d. Keep release trust current and stage upgrades

A box on numbered releases can receive updated verification code and keys. Then a
release operator can offer a stable release to a group, widen the group or pause for
everybody. Boxes check without a Cloud account. The watcher authorised planning on
the signed-file default on 19 November at 00:01. This offer plan awaits the owner's
publication decision and watcher clearance. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Signed manual install](2026-11-18-a950-signed-manual-install.md)

## 1c. Refresh trust through checked numbered installs

- In `deploy/waitron.sh`, verify the numbered release with installed trust before
  fetching anything from its signed commit. Reuse `fetch_release_trust` to stage
  the verifier and both keys from that commit. The staged verifier must verify the
  same file. Activate the complete set under the existing host lock alongside the
  retained driver, before Apply. Atomically move a pointer to the staged directory,
  using the original trust directory as the initial fallback. A failed fetch or
  validation leaves the previous set usable. Restore keeps the retained
  driver and its matching trust. A key change keeps one key in common and uses it
  to sign the release that carries the change.
- Main currently signs `app` and `printAgent`. Lane J owns adding `tunnel` to the
  signer, verifier and shell. Coordinate the three field names through Lane J's
  questions.md. `gh release list` showed no releases when planning. Before the
  first signed release, seed boxes with the three-image verifier and matching
  driver using the documented main upgrade or box recipe. If a two-image release
  ships first, ship a two-image bridge that installs a verifier and shell able to
  read both inventories before publishing three images. Use the same bridge for a
  fourth role. The shell must reject an incomplete or unexpected digest inventory.
- Start with failing `scripts/waitron-sh.test.mjs` cases for trust rotation and for
  a failed fetch and Restore after failed Apply, with real signed files. The release-list and shell
  suites own the image inventory and mapping to Compose. Update `deploy/README.md`
  and the A950 backlog. Estimate +110/−20 production and +150/−0 tests and support.

## 1d. Publish and select a signed offer

- `scripts/box/release-offer.mjs` reuses the Ed25519 envelope from `release-list.mjs`
  with format 1, `kind: "offer"`, a serial, one version and the SHA-256 of its
  `waitron-release.json` bytes. Match any `bucketBelow` (1–99, exclusive),
  `installations` or `atLeast` rule. `none` and `all` each stand alone. Use
  `WAITRON_NODE_ID` from `trading.env`, which an operator can read on the box.
  Take the first four bytes of SHA-256 of `boxId + ":" + version` as an unsigned
  big-endian integer modulo 100. The publisher accepts only these format-1 rules.
- `.github/workflows/publish-upgrade-offer.yml` runs from a published numeric tag
  that contains the workflow, in the existing `release` environment. Its constant
  concurrency group serialises writes. `scripts/release/sign-release-offer.mjs`
  uses the workflow run number as the serial, refuses an older serial or conflicting
  retry, validates the stable release file and replaces only `waitron-offer.json`
  on the fixed `upgrade-offer` release (`--latest=false`). Pause with `none` from
  the newest eligible tag and confirm the run published it. Asset absence defers.
- Reuse bounded shell downloads in `deploy/waitron.sh`. The installed
  `verify-release.mjs` checks the proof, rules and strictly newer stable version,
  deferring for unknown input, setup or a development image. Remember the highest
  signed offer serial and its digest in the host directory, including `none`.
  Reject an older serial or different bytes at the same serial. Bind the selected
  release to its signed asset before returning the three image choices. Step 5
  rechecks immediately before Apply. A fresh pause read prevents a new start.
  An attempt past that recheck finishes and installed versions stay put.
- Start with `release-offer.test.mjs` for the groups and eligibility. The verifier
  suite owns wrong-kind, replay after pause, wrong asset and prerelease checks.
  The signer and workflow suites own refusal before upload and publication admission.
  Ship the new verifier module through the 1c trust update and box recipe path.
  Update `docs/operations/release.md` and the A950 backlog. Estimate +275/−20
  production and +320/−0 tests and support.

`pnpm release prepare 1.2.3-rc.1 --place Madrid` refuses the suffix. The separate
prerelease publishing slice changes fiscal-adjacent tagging and signing to mark
an ordinary numbered version while keeping its own declaration. The physical
rehearsal, automatic window, status and email remain separate steps.
