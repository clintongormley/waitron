# Keep CI moving when a server job gets stranded

The watcher assigned two fixes at 00:00 on 25 November. Main run 45504069340 passed on its hosted
retry. The next run, 45505956621, started 11 jobs on the server. A stranded admission should get
one retry. One stranded job should leave the rest of the server’s available slots usable.

The controller logged `GitHub GET refused (503)` and exit 125 for lint job 138834858930. Its saved
turn had no retry marker. Run 45505583351’s planner named that stranded job. Run 45505754894’s
planner named drift while reading its hosted retry: page 1 advertised 37 jobs and page 2 said 39
on the reread. Both sent all jobs to GitHub before reading capacity. Their input snapshots were
58.5 and 86.1 seconds old, each with 12 slots, zero running and one waiting. Server health reported
that wait. The two planners’ own logs identify their placement decisions.

1. **Cloud controller.** In `scripts/disposable-tests/ci-runtime.test.mjs`, stand in a received
   503 from each pre-registration GET (run, job, named runner). Watch the missing marker fail.
   In `ci-canary.mjs` (`runCI`), reuse the existing 5xx marker when cleanup confirms absence.
   Verify zero registrations on a failed GET, one replay after 60 seconds, and no third try even
   if registration is the second 5xx. The existing `ci-auto.test.mjs` replay test covers automatic
   pickup and the orphan guard. Keep quota, lost replies and assigned jobs on their current paths.
   Update Cloud's self-recovery backlog and controller guide. A second 5xx strands the job for
   the watcher's 20-minute queue alarm, as clarified on 25 November at 00:15.
   Run `node --test scripts/disposable-tests/{ci-runtime,ci-auto,ci-leases}.test.mjs`. About 8
   production and 45 test lines. Qualify and release through the existing controller flow.
2. **Waitron planner.** In `scripts/ci-server-health.mjs`, keep the stall scan and log the reason.
   The first-attempt split can use its published free slots if reads are complete and the snapshot
   is zero to under five minutes old. Published waiting jobs already use slots. Stale or missing
   capacity sends the stalled batch to GitHub. A PR's initial `changes` placement still goes to
   GitHub while the snapshot reports server jobs waiting. Reruns and recovery keep their rules.
3. **Drifting job list.** For routing only, after the existing reread still finds numerical count
   drift in an attempt’s job list, make one more full read after a 10-second pause, at most once per
   planner. Accept a complete, consistent list. A1470 and the 18 November split still send an
   unreadable inventory to GitHub. Inject the wait in tests. In `scripts/ci-hosted-route.test.mjs`,
   first reproduce 37/39 drift and then give a complete reply. Test persistent drift, one stalled
   job leaving 11 slots, 12 stalled jobs in one run using all 12, and missing or stale capacity.
   Retitle the no-families case in `ci-server-health.test.mjs`; keep the recovery drift assertions.
   Run all three affected files, including `ci-server-first.test.mjs`. Update the CI guide and
   routing backlog. About 45 production and 80 test lines for Waitron.

Open one pull request per repository in parallel. Check the planner output and actual job
labels on a real first attempt. Report which failure cases only the fixtures exercised. Take a wider
inventory exception or a rerun change back to the watcher if the bounded repair falls short.
