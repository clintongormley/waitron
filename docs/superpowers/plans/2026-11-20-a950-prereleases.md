# A950 step 1. Publish prereleases by their full version

A release operator prepares and tags `1.3.0-rc.1` with its own declaration and the same CI checks
as a release. A box administrator can install `v1.3.0-rc.1` by hand and later upgrade to `v1.3.0`.
Only stable releases can appear in automatic offers.

The owner chose the suffixes and release process on 20 November at 14:19, recorded in Lane F's
`questions.md`. That answer replaces the ordinary-number and `--prerelease` approach in #3862.
Keep the existing signing, three image digests, and checked-install steps. The first live
publication, the test-box rehearsal and scheduled upgrades are separate steps.

## Publish and find the declaration

- Accept `X.Y.Z` and `X.Y.Z-{alpha,beta,rc}.N` within the existing 50-character limit. All
  numeric parts use the existing no-leading-zero convention. Compare the three core numbers
  first, then alpha, beta, rc and stable in that order, and compare each channel's sequence as
  a number. Share the Node parser and comparison through `scripts/box/release-list.mjs`, which
  already ships in the retained verifier. Use it in `scripts/release/waitron-release.mjs` and
  `scripts/bundle-node.mjs`. Keep the shared TypeScript check and shell boundaries in agreement.
- Derive the tag annotation and publication flag from the suffix. Start with failing cases in
  `scripts/release/waitron-release.test.mjs` and `scripts/ci-workflow.test.mjs`: prepare the full
  declaration filename, tag the full version, reject a tag whose annotation disagrees with its
  suffix, and pass the derived flag to GitHub and signing. Keep exact-tag and retry checks.
  In `scripts/released-declarations.test.ts`, cover a changed tagged RC declaration and a stable
  declaration prepared above its RC. Update `.github/workflows/ci.yml` and the release scripts.
- Run the bundle and declaration checks with `1.3.0-rc.1`. Extend `scripts/bundle-node.test.mjs`
  and `packages/shared/src/built-release.test.ts` for accepted and refused forms. Exercise full
  declaration lookup with `packages/fiscal-verifactu/src/declaration/command.test.ts` and the
  installed declaration with `apps/server/src/declaration-pages.test.ts`, where the folder
  reader can reuse `isReleaseVersion`. Test the exact version at the built server's release check.

## Install by hand and keep automatic offers stable

- In `scripts/box/release-list.mjs`, require the signed version and prerelease flag to agree.
  Update `deploy/waitron.sh` to recognise the suffix on requests and installed images so both
  go through the retained verifier. Prove the signed install of an RC and refusal of an RC over
  the corresponding stable in `scripts/waitron-sh.test.mjs`. Test sequence order and a
  mismatched signed payload in the existing `scripts/box/` verifier and release-list suites.
- Keep the offer file's version fields stable so the format stays readable by existing boxes.
  Refuse a suffix as an offer target and let an installed RC satisfy ordering against a stable
  target. Prove stable can follow its RC in `scripts/box/release-list.test.mjs` and no prerelease
  offer is published in `scripts/release/publish-upgrade-offer.test.mjs`.
- Update the release instructions, affected developer and deploy guides, and A950's backlog
  entry. Verify with local tags and the existing GitHub and container test doubles.

Start each part with failing focused cases and preserve stable assertions. Estimate +100/−45
production, +180/−30 tests, no new test support. Update #3862 within three hours of clearance.
