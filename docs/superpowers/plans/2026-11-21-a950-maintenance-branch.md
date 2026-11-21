# A950 maintenance releases

A maintainer can prepare and tag `1.2.1` from `v1.2.0` after `2.0.0` ships.
An older major can also get a new minor, then patches to that minor. The tag's
full CI, the declaration, producer checks and signing still gate publication.
The Lane F queue item and the watcher's 21 November 03:21 note record the ask.

- [ ] In `scripts/release/waitron-release.test.mjs`, first exercise prepare's
  declaration PR against `maintenance/*` and tag's green push CI on that branch's
  exact tip. In `waitron-release.mjs`, let prepare take `--base <branch>` and tag
  use the checkout's current branch. Reuse the clean remote-tip check, signing
  prompt, committed declaration check and tag annotation. Fetch version refs
  from origin for maintenance. Keep duplicate and global version-order checks on
  main. Verify the maintenance branch has main's PR, CI and ref protections
  using GitHub's branch-rules read. Document how to apply them before first use.
- [ ] Share the source rule in `scripts/release/release-source.mjs` using the
  existing version comparator. A maintenance candidate belongs to a protected
  remote `maintenance/*` branch. It contains the highest tagged predecessor
  below its version and has no equal or higher version in its history. Its fork
  from main is itself a lower released tag, so branching at an untagged main
  commit fails. The branch can advance past that fork through later releases.
  Main has no predecessor requirement and refuses a tag with a higher tagged
  ancestor. In `.github/workflows/ci.yml`, run maintenance PR and push CI. For
  publish, fetch origin's branch and release refs and unshallow within the
  bounded retry. Use the standard two-attempt Node setup. Keep the direct tag
  and annotation checks. `scripts/ci-workflow.test.mjs` runs the real step from
  shallow Git history. Cover the patch and new minor followed by a patch, a
  skipped predecessor, an unprotected branch and a lower tag on later main.
- [ ] In `scripts/released-declarations.test.ts`, show that main and maintenance
  can each lack the other's declaration. Keep checking every tagged version's
  own file and every tagged declaration present at HEAD. Require the file at HEAD
  when its tag is reachable, and keep the missing-tag check within the checkout.
  In `scripts/released-declarations.mjs`, refuse shallow history when there are
  release tags. Give both root-guard checkouts full history with `blob:none`.
- [ ] In `scripts/release/github-release.sh` and its test, keep maintenance
  releases out of GitHub's Latest slot using the publish step's source result.

Run those focused suites, including the Git-spawning cases with `GIT_DIR` set.
Update the release runbook, CI notes and A950 backlog. Branches from releases
predating these tools need the release changes backported. A live tag, settings
write and changes to box upgrade selection are outside this slice. Estimate
220 production and 230 test lines.
