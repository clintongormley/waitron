# A950 step 1. Publish a numbered prerelease

A release operator can publish a signed prerelease with its own declaration. An administrator can
install it by number through the checked manual path. The offer publisher refuses to target it.

The owner asked for manual-only prereleases and a declaration for each one on 18 November, as
recorded under A950-LATER in Lane F's queue. The watcher cleared ordinary X.Y.Z numbers with a
signed prerelease flag as a direction on 18 November at 20:36. This slice covers release tooling.
The live release and test-box rehearsal, scheduled checks, status and pairs have separate steps.
[Staged-offer plan](2026-11-19-a950-staged-offers.md)

## Tag and carry the choice

- Add `pnpm release tag <version> --prerelease` in `scripts/release/waitron-release.mjs`.
  Use the current `prepare` command and its declaration PR. The tag, build and declaration share
  one X.Y.Z number. The operator chooses the flag at tagging. The next release gets a higher number.
  Store the choice in the annotated tag. The stable message remains `Waitron <version>` and
  the prerelease message is `Waitron prerelease <version>`.
- In `.github/workflows/ci.yml`, fetch the exact tag with an explicit forced refspec alongside
  main in the existing bounded fetch. Require an annotated tag pointing directly to the checked-out
  commit. Compare its subject with the two messages for that tag's version and require an empty
  body. Git exposes the signature separately. Pass exactly `true` or `false` from the publish
  job to both release steps. Full CI, the declaration check, the producer guard and the three
  named image digests still gate publication.
- In `scripts/release/github-release.sh`, use the flag to create a GitHub prerelease and keep it
  out of Latest. On retry require the existing Release to have the same prerelease flag before
  attaching the declaration. In `scripts/release/sign-release-list.mjs`, write that same boolean
  to the signed payload. Each consumer refuses a missing or unrecognised flag before it can create
  a Release or sign. Reuse the existing signature and asset retry checks. The checked manual
  installer accepts a signed prerelease. The offer publisher rejects a target marked prerelease
  by either GitHub or the signed file. Step 5 will also check the signed file on the box.

## Verify and document

- Start with failing cases in `scripts/release/waitron-release.test.mjs` for the CLI option and
  annotated tag, and `scripts/ci-workflow.test.mjs` for deriving the flag from a real annotated tag,
  refusing a mismatched tag and passing the flag to both steps.
- In `scripts/release/github-release.test.mjs`, exercise creation as a prerelease and refusal of a
  mismatched retry. In `scripts/release/sign-release-list.test.mjs`, verify the resulting signed bytes
  carry the flag. Both suites check a missing flag. Run the existing prerelease install in
  `scripts/waitron-sh.test.mjs` and refusal
  cases in `scripts/release/publish-upgrade-offer.test.mjs`. Preserve existing stable assertions.
- Update `docs/operations/release.md` and the A950 entry in `docs/backlog.md`. Explain that you use
  a new number and sign a new declaration for the next version. Keep the tag fixed once pushed.
  The workflow reads its annotation when the publish job runs. The signed file records the result.
  For an existing GitHub Release whose flag disagrees, direct the operator to check its signed
  file and restore the matching flag before retrying. Verify using local tags and the existing
  GitHub and container test doubles. The declaration template's item 1.d) blocker governs a real release.

Estimate +80/−10 production, +110/−5 tests, +0/−0 test support. One PR, within three hours once
cleared. The slice touches fiscal-adjacent publication and the signature consumers.
