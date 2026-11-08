# A1398: warning-only scope and qualified server-table refresh

**Authority: Lane F questions.md WATCHER2026-11-08 10:06:**

> "Refresh the server duration table in this PR, with the existing scripts/test-durations.mjs, from the reports of your manual full run (qualified data, not guesses). A warning that fires on all 24 shards at landing tells nobody anything. State the before/after missing-file counts in the PR. Packing changes stay out."

> "Late status: yes, a later authenticated re-read of the same manual-run rows once GitHub publishes completion, identities retained; real API or parsing failures still need repair."

> "Root CLAUDE.md: no change. Its line ("refresh it with scripts/test-durations.mjs when a shard drifts past 4 minutes") stays true with a warning added; do not ask for a rewording."

**Driver-reported status:** Missing-file warning and final bounded nonblocking step implemented. All original assertions preserved. 20 extracted-shell tests and 37 sequencer/timing cases pass; sibling/default-deadline controls each fail once, restored suite passes 20. Independent Claude execution review completed (482s); final prebuild read completed (252s) before warning build.

- [ ] Obtain a short amendment read through `~/workspace/tools/claude-seat.sh review-branch` BEFORE generating/replacing the table. Preserve warning-only product scope, algorithms, shard counts, workers, consumers/guards, exclusions, coverage, thresholds and gates. No new package packing or dbprobe changes; never request stream refresh.
- [ ] Publish reviewed warning head through normal hook. After the known GitHub release-asset 504 recovers (watcher 10:05), dispatch manual full CI on that feature branch. Obey CI failure rule: diagnose/fix failures; no retry loop.
- [ ] Qualify reports against incident history: no overlapping Actions/Git/API/Webhooks incident, no download 5xx, slowest checkout under about 10s; one coverage mode. Retain exact run/head/attempt, jobs and logs locally.
- [ ] Run existing `scripts/test-durations.mjs` over that run's real 24 `test-server` shard logs only. Exclude stream/unrelated logs; never substitute guessed/old times. Driver's real Vitest list with CI exclusions reports 1,277 selected, 37 missing, all 24 shards affected before refresh. Check every selected nonstream file has measured time; record before/after missing counts in PR. Change existing server-table values/packing estimates only, without new packing policy. Report generated file/size truthfully. Run focused sequencer/timing checks; update guide's six-run historical instruction with dated exception provenance if needed.
- [ ] After table commit, run normal hook, scoped CI and exact-final-head manual full CI before authorised locked landing. Retain execution review unless substantial new code. Inspect warning log against real rows; delayed completion permits only the quoted authenticated re-read. Repair real API/parsing failures. Require all current-head checks passing; claim no hosted speed gain.
- [ ] Keep other-package packing in backlog and exactly: "an inventory of run test files, only if a same-count wrong-files case is ever seen". A949 follows when A1398 waits on CI or lands, per runner.
