# Server shard deadlines

Authority: Lane I's `SERVER-SHARD-DEADLINE` in `/Users/clintongormley/waitron-campaign-i/queue.md`.
The watcher queued this work at 21:45 on 16 November 2026. No owner design or plan approval is claimed.
The driver checks and commits this plan, obtains one Claude plan review, corrects it, then requests watcher clearance before building.

Finish line: all eight unwrapped commands get the existing deadline, with room to report before GitHub's job limit.
A blocked server/node child proves unfinished-file reporting, a process snapshot and exit 124; neither incident's cause is solved.
Reuse `scripts/run-with-deadline.mjs` unchanged, its existing diagnostic CLI case, the workflow guard near line 3922,
and `scripts/root-scope-consumers.test.mjs`. No wrapper/reporter redesign, helper, test timeout change, re-sharding or merge-job change.

- [ ] Before implementation, make one bounded read of recent scheduled main full-run job/step records and relevant logs:
  `43791398545` / `3c92d99c` (16 November), `43667121845` / `9d060ed8` (15 November), `43545365252` / `58d3c38b` (14 November).
  Qualify timings under `~/waitron-campaign-shared/ci-failure-rule.md`: incident history has no overlapping Actions,
  Git Operations, API Requests or Webhooks incident; slowest checkout is under about 10 seconds; no download HTTP 5xx.
  Use successful test steps only, even in failed runs. Record run/job/step IDs, test-step ranges, setup/upload times,
  chosen seconds and remaining room in the CI guide and PR, from actual records rather than historical prose.
  For each family, justify a limit above measured successful times with headroom, while setup + limit + 2-second snapshot
  + 5-second stop grace + uploads/remaining steps + margin fits below 600 seconds. Do not copy 360 everywhere.
  Return unjustified limits or missing healthy data to the watcher; no measurement dispatch or invented limit.

- [ ] Update the existing wrapper consumer list in `scripts/changed-scope.mjs` for the newly wrapped packages.
  Its existing root-scope guard owns list completeness; retain its assertions. This necessary routing-data edit is included in watcher clearance.
  Ask before changing any existing guard assertion; additive deadline cases leave the browser assertions intact.

- [ ] RED: add table cases beside the existing browser deadline case in `scripts/ci-workflow.test.mjs`, leaving browser assertions intact.
  Name them “bound <family>'s Vitest command and retain deadline diagnostics”, covering `test-server`, `test-server-stream`,
  `test-heavy` (db), `test-provisioning`, `test-identity`, `test-workforce`, `test-light-a` and `test-light-b`.
  Assert diagnostic wrapping with the measured limits and room below the ten-minute job limit. Existing workflow tests retain ownership
  of selection, shard/coverage flags, file lists, blob paths, reporters and light-bin filters/concurrency; do not duplicate their checks.
  Preserve pipes and pipefail. Run the new cases and observe missing-wrapper failures.
- [ ] GREEN: prefix only those eight Vitest invocations in `.github/workflows/ci.yml` with the existing CLI and qualified seconds.
  Apply the watcher-cleared consumer-list update, including literal server/db/provisioning/identity/workforce and detected light-bin consumers.
  Run the workflow and root-scope guards; all cases, including the existing browser assertions, must pass.

- [ ] In `scripts/run-with-deadline.test.mjs`, minimally extend the existing “the diagnostic CLI names unfinished files and snapshots
  processes before killing a blocked child” case with a server/node-marked variant, preserving its browser proof.
  Keep one completed file and one unfinished file, a real blocked Node child, its identifiable process snapshot, both streams and exit 124.
  The CLI owns stopping/diagnostics once; workflow cases own wiring. RED: remove diagnostics in a disposable copy and observe
  the report assertion fail. GREEN: use the unchanged wrapper. Drop the temporary fault; no production hung file remains.
  Use a disposable CI hang only if this existing CLI case cannot supply the proof, and bring that need to the watcher first.

- [ ] Generalise the browser deadline section in `docs/developers/ci-and-gates.md`; retain its legacy anchor used by `CLAUDE.md`
  and `docs/developers/testing-guide.md`. In `docs/backlog/ci.md` change only the diagnostic-gap wording in the shard-19 paragraph
  and incident-table row; keep both incidents open. Update their summary in `docs/backlog.md` only for the diagnostic gap.
- [ ] Final focused check: `pnpm exec vitest run scripts/run-with-deadline.test.mjs scripts/ci-workflow.test.mjs scripts/root-scope-consumers.test.mjs`.
  Read test counts and failures. Then use normal finish-branch review, push-hook checks and current-head scoped CI; no whole-workspace local run.

Expected: 100–250 changed lines; workflow 8–20, scope data 15–30 if cleared, tests 40–90, docs 50–100 including this plan.
Production wrapper/reporter: 0 lines. No extra tests, helpers, architecture, measurement system or stall repair.
