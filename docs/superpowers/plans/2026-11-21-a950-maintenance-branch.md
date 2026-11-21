# A950 maintenance releases

A maintainer can prepare and tag `1.2.1` from `v1.2.0` after `2.0.0` ships.
An older major can also get a new minor, then patches to that minor. The tag's
full CI, the declaration, producer checks and signing still gate publication.
The Lane F queue item and the watcher's 21 November 03:21 note record the ask.

- [ ] In `scripts/release/waitron-release.test.mjs`, first exercise prepare's
  declaration PR against `maintenance/*` and tag's green push CI on that branch's
  exact tip. In `waitron-release.mjs`, give prepare `--base <branch>` and let tag
  use the checked-out branch. Reuse the clean remote-tip check, signing prompt,
  committed declaration check and tag annotation. Check both branches for
  duplicate versions before signing or tagging. Main keeps the global version
  order. Maintenance fetches origin's version tags and must contain the latest
  lower stable release at prepare and tag time.
- [ ] Share the source rule in `scripts/release/release-source.mjs` using the
  existing version comparator. A maintenance commit's fork from main must be
  a lower release tag of the same major (watcher clearance, 05:15). Refuse equal or higher tagged versions in its history,
  excluding the current tag in CI. Fetch origin's main, `maintenance/*` and
  release tags. First check main ancestry, including refusal when a higher tag
  is an ancestor. Otherwise require the commit to be on a remote maintenance
  branch whose GitHub rules require PRs, `ci`, and protect ref creation, deletion
  and force pushes. CLI checks the named branch. CI accepts a qualifying branch
  containing the commit, even when its tip has moved. Publication depends on
  the tag's history so another lower release cannot prevent a retry.
- [ ] In `.github/workflows/ci.yml`, run maintenance PR and push CI. Give
  publish and root guards full history with `blob:none` on both attempts. Use
  the standard bounded Node setup in publish and keep the direct tag and
  annotation checks. The rules API gets the same 90-second limit and second
  attempt as the fetch. An empty or failed read cannot qualify a branch.
- [ ] Test patch, minor, its patch, later main refusal, untagged fork refusal
  and sibling-tag retry once in `release-source.test.mjs`. In the CLI suite
  exercise the latest lower stable tag before signing and tagging, branch
  rules and exact-tip green CI. Keep publish's annotation checks and exercise
  its protected-branch admission, retry and shallow refusal. The CLI's existing
  command double supplies the rules JSON. The workflow suite runs real Git
  with a `gh` stand-in returning rules JSON, an empty list or a failed call.
- [ ] In `scripts/released-declarations.test.ts`, show that main and maintenance
  can each lack the other's declaration. In `scripts/released-declarations.mjs`,
  check every tagged version's own file and any tagged declaration at HEAD.
  Require the file when its tag is reachable, refuse shallow history with
  release tags, and keep the missing-tag check within a checkout.
- [ ] In `scripts/release/github-release.sh` and its test, use the publish result
  to keep maintenance releases out of GitHub's Latest slot.

Run the five focused suites and the Git-spawning cases with `GIT_DIR` set.
Use disposable versions for qualification. Update the release runbook, CI
notes and A950 backlog. List the exact ruleset on `refs/heads/maintenance/*`
and how to carry fixes forward by hand. The owner applies the ruleset and
creates each maintenance branch at a release tag. Older branches carry release tooling
through backports when needed. Estimate 220 production and 230 test lines.
