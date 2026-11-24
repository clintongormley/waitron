# Keep CI moving when a server job gets stranded

The watcher assigned two fixes on 25 November at 00:00 in Lane I’s questions. The hosted retry of
main run 45504069340 has already passed. New run 45505956621 has started 11 jobs on the server.
The fixes should let an unassigned job recover from an admission 503 and let fresh spare server
capacity serve a new run even when an earlier job is stranded or one inventory read is short.

**Evidence.** The controller logged `GitHub GET refused (503)` and exit 125 for lint job
138834858930. Its saved turn has only fingerprint, slot and generation. The controller excludes
that turn because a 5xx retry marker is written for runner registration only.
The planner for 45505583351 sent no jobs to the server after naming the stranded run. The planner
for 45505754894 sent none after page 2 of that run’s retry changed its advertised total from 37 to
39 on the second read. Both returned before reading the controller capacity. The failed Server
health checks diagnosed the wait. The planners’ own logs give the placement reasons.

1. **Cloud controller.** In `scripts/disposable-tests/ci-runtime.test.mjs`, return HTTP 503 from
   the first pre-registration job fetch using its existing fixture. Expect no registration on the
   failed turn, the existing retry timestamp after cleanup and one successful retry after 60
   seconds. Watch the marker assertion fail. In `scripts/disposable-tests/ci-canary.mjs` (`runCI`),
   classify a received 5xx in the pre-registration reads with the same bounded handling as a
   registration 5xx. Reuse the existing recorded turn, cleanup and retry eligibility. Leave
   identity checks, quota handling, assigned jobs and persisted field names alone. Run
   `node --test scripts/disposable-tests/{ci-runtime,ci-auto,ci-leases}.test.mjs`. About 8 production
   lines and 30 test lines. Qualify and release through the existing controller workflow.
2. **Waitron planner.** In `scripts/ci-hosted-route.test.mjs`, use the first-attempt family fixture
   with fresh positive capacity. The route should allocate the free slots when another run has
   an old unassigned job or advertises 37 jobs on page 1 and 39 on page 2, including on reread.
   Check that old or absent capacity still leaves those cases on GitHub. Watch the fresh cases fail. In
   `scripts/ci-server-health.mjs` (`serverRoute`), let the first-attempt split use a valid capacity
   snapshot less than five minutes old with free slots before the general health inventory decides
   the route. Reuse `slots - serverRunning - serverWaiting` and the existing family order. Keep the
   status alarm and recovery reads, explicit hosted routing and rerun rules. Run
   `pnpm exec vitest run scripts/ci-hosted-route.test.mjs scripts/ci-server-health.test.mjs scripts/ci-server-first.test.mjs`.
   Update the planner rule in `docs/developers/ci-and-gates.md`. About 20 production lines and 60
   test lines. Check one real first attempt’s planner output, job labels and completed checks.

Use one pull request per repository. The two changes work independently. The controller can gain
its bounded retry without the planner change. Keep the repository routing mode, slot sizes and
health alerts as they are.
