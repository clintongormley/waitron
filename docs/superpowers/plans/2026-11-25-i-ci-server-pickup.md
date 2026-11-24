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
   Run `node --test scripts/disposable-tests/{ci-runtime,ci-auto,ci-leases}.test.mjs`. About 8
   production and 45 test lines. Qualify and release through the existing controller flow.
2. **Waitron planner.** In `scripts/ci-server-health.mjs`, count the waiting jobs in stalled runs,
   clearing the count when progress clears the stall. Keep the scan and its reasons. With complete
   reads and a valid first-attempt capacity snapshot zero to under five minutes old, charge the
   greater of published waiting jobs and observed stalled jobs. Guard the capacity read and keep
   its missing or stale fallback and stall reason. First-attempt planner placement, healthy split,
   reruns and recovery keep their rules. If admission is down despite a fresh snapshot, another
   batch can queue until the waiting count uses up the spare budget. A second 5xx can still strand
   its job. Both limits keep the existing health alarm and recovery path.
3. **Drifting job list.** For routing only, after the existing reread still finds numerical count
   drift in an attempt’s job list, make one more full read after a short pause, at most once per
   planner. Accept a complete, consistent list. A1470 and the 18 November split still send an
   unreadable inventory to GitHub. Leave recovery reads strict. In `scripts/ci-hosted-route.test.mjs`,
   first reproduce 37/39 drift and then give a complete reply. Test persistent drift, one stalled
   job leaving 11 slots, 12 stalled jobs in one run using all 12, and missing or stale capacity.
   Run it with `ci-server-health.test.mjs` and `ci-server-first.test.mjs`. Update the split and read
   rules in `docs/developers/ci-and-gates.md`. About 45 production and 80 test lines for Waitron.

Use one pull request per repository, controller first. Check the planner output and actual job
labels on a real first attempt. Report which failure cases only the fixtures exercised. Take a wider
inventory exception or a rerun change back to the watcher if the bounded repair falls short.
