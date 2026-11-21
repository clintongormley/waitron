# A950 maintenance releases

A maintainer can prepare and tag `1.2.1` from a branch cut at `v1.2.0` after
`2.0.0` has shipped. A new minor of major 1 works the same way. The tag's full
CI run still gates publication, the producer checks, the declaration and signing.
The Lane F queue records the ask at A950-MAINTENANCE-BRANCH and the watcher's
03:21 note on 21 November applies the lower-number rule to the older branch.

- [ ] In `scripts/release/waitron-release.test.mjs`, first show that maintenance
  prepare opens the declaration PR against its branch and tag requires a green
  push run for that branch's exact tip. In `waitron-release.mjs`, give prepare
  an optional `--base maintenance/v1.2.0` and let tag use the currently checked-out
  main or maintenance branch. Keep the clean latest-remote-tip check, the
  producer's confirmation, the committed declaration check, the tag annotation
  and the global duplicate check. Keep the global version-order check on main.
- [ ] Reuse the version comparator in a shared rule in
  `scripts/release/release-source.mjs`. A remote `maintenance/v1.2.0` must fork
  from main exactly at the stable tag `v1.2.0`. The candidate must be off main,
  advance that line, and carry no release of the same or a higher version in its
  history. A patch stays in the base's major and minor. A new minor advances the
  base's minor within the same major. In the CI publish step, fetch main,
  maintenance refs and version tags with complete history under the existing
  bounded retry. Validate the existing direct annotated tag, then require its
  commit to belong to main or a qualifying remote maintenance branch. Refuse a
  lower-numbered main tag whose commit already contains a higher release.
  In `scripts/ci-workflow.test.mjs`, exercise the step on real Git history:
  accept an older branch's patch and an older major's minor, refuse an unqualified
  side branch, and refuse `v1.2.1` on main after `v2.0.0`.
- [ ] In `scripts/released-declarations.test.ts`, show that main and a maintenance
  branch each pass when the other line has released a declaration they lack.
  In `scripts/released-declarations.mjs`, still check every tag's own file and
  protect every tagged declaration present at HEAD. Require the file at HEAD
  when its tag is in that checkout's history. Keep the missing-tag check within a
  line. In `.github/workflows/ci.yml`, give root guards full tag history, and run
  CI on pushes and PRs to `maintenance/*` so the CLI can check the target's push.

Run the three focused files before and after the code changes, and run the
Git-spawning tests with `GIT_DIR` set. Update the release runbook, CI notes and A950
backlog. Future maintenance branches carry this tooling from their release base.
Publishing an actual tag, changing repository settings, and changing box upgrade
selection are outside this slice. Estimate 180 production and 190 test lines.
