# Server shard deadlines

Source: Lane I SERVER-SHARD-DEADLINE, queued by the watcher at 21:45 on 16 November 2026.
Separate Sol/high draft checked by the driver; Claude reviewed it (238s), then its corrections (136s).
The driver accepted all findings, including the final light-bin qualification limit. No owner plan or design approval is claimed.
Watcher cleared the corrected plan at 22:08 and the eleven-second checkout timing source at 22:19
on 16 November 2026 (Lane I questions.md).

Finish line: a hang inside the eight named test steps reports unfinished files and processes before GitHub's job limit.
Reuse the existing deadline runner, reporter and workflow guards. No new wrapper, reporter, helper, re-sharding,
merge-job change, test-timeout change or repair of the unknown incidents. Setup/runner-loss hangs remain outside this result.

- [x] Read recent main full-run step records and relevant logs once: 43791398545, 43667121845, 43545365252.
  Qualify timings using ci-failure-rule.md: incident history has no overlapping relevant incident, checkout under about
  ten seconds, and no download HTTP 5xx. Retain run/job/step/source identities, successful test ranges and setup/upload times.
  Choose the largest per-family limit that fits 600 seconds minus measured setup, two-second snapshot, five-second grace,
  always-run upload attempts and a stated margin; check it is well above successful test times. Equal limits are fine.
  Record arithmetic in the guide/PR, not a test. Return missing healthy evidence or unjustified limits to the watcher.

- [x] RED: add one table test in scripts/ci-workflow.test.mjs pinning the chosen diagnostic limits for test-server,
  test-server-stream, test-heavy's db command, test-provisioning, test-identity, test-workforce, test-light-a and test-light-b.
  Leave browser assertions intact; existing tests retain ownership of selection, flags, files, reporters, pipes and blob paths.
  Observe missing-wrapper failures. GREEN: prefix those eight invocations in .github/workflows/ci.yml, preserving arguments.
  Find the stream step by its actual name as the existing stream guard does, rather than shardStep.
  In the same commit add only apps/server, packages/db, packages/identity, packages/provisioning and packages/workforce
  to scripts/changed-scope.mjs's wrapper consumers. Existing root-scope assertions stay intact: its scanner finds no literal
  positive light-bin filters, so record that wrapper-only changes do not select light bins; add no scanner feature.

- [x] Watcher scope decision: permit the smallest correction to scripts/run-with-deadline.mjs's existing diagnostics parser.
  Retained nightly light-a output has `packages/contract test:coverage: [file-progress] start ...`; the unchanged parser
  reports no unfinished file for that line, but tracks the same line without its prefix (prefix-proof.json in lane receipts).
  RED: add focused createDeadlineDiagnostics cases in scripts/run-with-deadline.test.mjs for the real pnpm prefix and two
  packages running the same relative file, only one ending. Preserve the existing unprefixed/browser assertions.
  GREEN: recognise the observed prefix and keep its package identity in each running-file key; no stripping away identity,
  broader output protocol, reporter change or other wrapper behavior change. Confirm the new assertions fail without this fix.

- [x] Prove the real server path once with a disposable temporary server test: print an entered-hang marker, then block
  synchronously. Run only that file through the actual server Vitest/reporter command and a short diagnostic deadline.
  Require the entered marker, that unfinished filename, the live worker's process snapshot and exit 124; then remove the file.
  Keep the existing permanent CLI browser proof unchanged. No new permanent CLI variant or forced CI drill.

- [x] Generalise docs/developers/ci-and-gates.md's deadline section, preserving its existing linked anchor. State limits:
  root-guards remains unwrapped and setup is not bounded. The shared diagnostic text covers workers and browsers.
  In docs/backlog/ci.md update only the shard-19 paragraph and incident-table diagnostic gap: a hang inside the test step
  leaves a report; both causes remain open. The generic docs/backlog.md incidents index needs no edit; request that exception.
- [ ] Run `pnpm exec vitest run scripts/run-with-deadline.test.mjs scripts/ci-workflow.test.mjs scripts/root-scope-consumers.test.mjs`.
  Read counts and failures, then normal finish-branch review, hook and current-head CI. No whole-workspace local test run.
  This PR does not select light-a/light-b: their path has the wiring table and real-line parser unit cases only; its first
  natural runtime check is a scheduled/manual full run on main, since ordinary main pushes run no package tests.

Expected changed lines: existing parser 8–15, workflow 8–20, scope data 5, tests 40–70, docs 50–90 including this plan.
The initial review's smaller proof, five-consumer scope, measured-room rule and doc limits are accepted.
