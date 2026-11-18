# A950 step 1a. Publish a signed file for each numbered release

[Parent upgrade plan](2026-11-09-a950-shorter-upgrades.md) · [B3 release-list handoff](2026-11-03-b3-3-installer-policy.md#re-map-against-main-on-2026-11-03)

A release maintainer can attach a signed file that identifies the exact Waitron and print-agent images for a numbered release. A reader with the trusted public key can check that file before trusting any image reference. Real publication starts after the owner confirms key custody and the release secret is set.

## Format and implementation

- [ ] In `scripts/box/release-list.mjs`, add `verifyReleaseList(bytes, trustedPublicKeys)` and `signReleaseList(release, privateKey)`. Use Node Ed25519 with PEM keys (SPKI public, PKCS#8 private). The UTF-8 JSON file carries base64url `payload` and `signature`. Sign the exact decoded payload bytes and verify before parsing them. The version-1 payload has `kind: "release"`, the numbered version, full Git commit SHA, platform, two named OCI image digests and `minimumInstaller`. The installer number is an integer compatibility level starting at 1 and changes only when a later installer is required. B3 can pass its embedded current and spare public keys through the same verifier when it adds qualified USB assets.
- [ ] In `.github/workflows/ci.yml`, pass the two push steps’ digest outputs to the existing tag-only release job. In `scripts/release/publish-release-list.mjs`, sign those digests and the tag’s SHA, version and platform. Add `waitron-release.json` to that GitHub Release with no overwrite. An identical asset on a retry succeeds. Different bytes fail. Expose `WAITRON_RELEASE_SIGNING_KEY` only to the bounded signing and upload step. With the secret unset, the existing declaration publication proceeds and the signed asset step reports it was skipped. Document the asset and custody gate in `docs/operations/release.md` and update the A950 entries in `docs/backlog.md` and `docs/backlog/box.md`.

## Checks and scope

- [ ] First run `pnpm exec vitest run scripts/box/release-list.test.mjs scripts/release/publish-release-list.test.mjs scripts/ci-workflow.test.mjs` with failing assertions. The verifier accepts a generated current or spare key and refuses changed payload bytes, the wrong key, unsupported format and missing or swapped image roles. The publisher test uses a stand-in GitHub CLI and asserts the upload’s verified contents, skip with no key and repeat behavior. The workflow guard checks the step reads the two pushed digests and the key reaches only that step. Rerun after implementation. Use generated keys and discard them after testing.
- [ ] The next reviews cover signed manual admission and numbered prereleases (including the fiscal declaration tooling), the signed rollout offer and rule checks, then the nightly window and Box status/email. Run the locked physical release-to-release rehearsal after step 1. Paired upgrades wait for the A947 decision. This PR covers the per-release file and uses the current stable version grammar.

Estimate for this PR: production +190/−5 lines, tests +240/−0, no test support or generated files. Target three hours to an open PR after review and watcher clearance, excluding the wait.
