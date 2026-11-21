# A950 step 1. Publish prereleases by their full version

Prepare and tag `1.3.0-rc.1` with its own declaration and the usual CI checks. A box administrator
can install `v1.3.0-rc.1` by hand and later upgrade to `v1.3.0`. Only stable releases can be offered
automatically. The owner chose “-alpha.1 or -beta.1 or -rc.1 tags for prereleases” in the watcher’s
20 November 14:19 note in Lane F's `questions.md`. The same answer keeps the declaration, main CI
and tag steps. Keep signing, the three image digests and checked installs. Live publication,
the test-box rehearsal and scheduled upgrades have separate steps.

## Publish, declare and show the version

- Accept `X.Y.Z` and `X.Y.Z-{alpha,beta,rc}.N` within 50 characters. Numbers allow zero and no
  leading zeroes. Compare the three core numbers, then alpha, beta, rc and stable, then the
  sequence number within a channel. Reuse the parser and ordering in
  `scripts/box/release-list.mjs` from the release CLI and bundle build. Keep
  `packages/shared/src/built-release.ts` and both shell entry points in agreement.
- Remove `--prerelease` from `scripts/release/waitron-release.mjs`. Derive the tag annotation and
  CI publication flag from the suffix. Test the full declaration filename, annotated RC tag,
  mismatched annotation refusal and the flag reaching both publication steps in
  `scripts/release/waitron-release.test.mjs` and `scripts/ci-workflow.test.mjs`. Preserve the
  exact-tag and retry checks. Keep the single version order, pending watcher clearance. In
  `scripts/released-declarations.test.ts`, cover an edited tagged RC, a stable declaration above
  its tagged RC, and an untagged RC that was left behind when the next declaration was prepared.
- Exercise the full suffix in `scripts/bundle-node.test.mjs`,
  `packages/shared/src/built-release.test.ts`, the fiscal declaration command suite and the built
  server's `check-release` path. In `apps/server/src/declaration-pages.ts`, reuse `isReleaseVersion`
  for the folder and put the numeric ordering next to that shared check for the kept list.
  Pin both comparisons to the same cases and check that a running stable release lists and serves
  its earlier RC in `apps/server/src/declaration-pages.test.ts`. Validate the suffixed fiscal
  version with the existing `software-identity.test.ts` fixture and run the golden write-path
  and immutability suites unchanged.

**20 November, 22:45.** The owner asked to allow older version lines to receive releases at any
time. The watcher directed Lane F to remove the highest-version requirement from preparation,
tagging and the declaration guard. The release guide describes the result.

## Install by hand and keep offers readable

- Require the signed prerelease flag and version suffix to agree in `scripts/box/release-list.mjs`.
  In `deploy/waitron.sh`, recognise suffixes on the requested and installed images. Prove an RC
  goes through the signed install and cannot replace its stable release in
  `scripts/waitron-sh.test.mjs`. Cover channel and sequence order and signed-flag mismatch in
  the retained verifier and release-list suites.
- Keep offer targets, `atLeast` floors, `bucketVersion` values and the offer dispatch tag stable.
  The selector compares an installed RC with stable values. Test the three field refusals and
  the upgrade from an installed RC to stable in `scripts/box/release-list.test.mjs`. Check that an
  RC dispatch or target cannot publish in `scripts/release/publish-upgrade-offer.test.mjs`.
- Update release and deploy instructions, affected developer guides, and the A950 backlog.
  Tell operators to refresh the retained installer and verifier before trying a prerelease.
  Explain the single version order and how to remove an abandoned, never-tagged declaration
  before preparing the next version. Verify with local tags and the existing test doubles.

Start with failing focused cases and preserve stable assertions. Estimate +130/−55 production,
+210/−30 tests, +45/−30 docs, and no new test support. Update #3862 within three hours of clearance.
