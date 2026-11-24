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
   503 from each pre-registration GET (run, job, named runner). Watch the missing retry timestamp
   fail. In `ci-canary.mjs` (`runCI`), use the existing 5xx marker for these pre-registration
   reads once cleanup confirms absence. Keep its 60-second wait, one replay and orphan guard.
   Verify zero registrations on a failed GET, one replay and no third try even if registration
   is the second 5xx. Use `ci-auto.test.mjs`’s existing automatic replay test for pickup before and
   after the wait. Leave quota handling, ambiguous lost replies and assigned jobs on their current
   paths. Run `node --test scripts/disposable-tests/{ci-runtime,ci-auto,ci-leases}.test.mjs`.
   About 8 production and 45 test lines. Qualify and release through the existing controller flow.
2. **Waitron planner.** Keep `serverHealth`’s scan and logs. In `scripts/ci-server-health.mjs`, when
   complete health reads find stalled jobs and the first-attempt snapshot is valid and zero to
   under five minutes old, give the usual first batch the free slots after charging the greater of
   published waiting jobs and the observed stalled count. Let a fully stalled pool fall back to
   GitHub. Read capacity once. Keep the current healthy split, retry rules and health recovery.
   In `scripts/ci-hosted-route.test.mjs` prove one stalled job leaves 11 of 12 slots, while 12
   stalled jobs or stale or absent capacity leaves zero. Run it with `ci-server-health.test.mjs`
   and `ci-server-first.test.mjs`. About 30 production and 55 test lines. Verify job labels on a
   real first attempt and report which refusal cases were exercised by fixtures only.

A1470 says unknown inventory goes to GitHub. The later owner decisions (18 and 20 November,
`docs/backlog/ci.md`) say to fill available slots and keep the split. Keep A1470 for the 37/39
case until the owner decides whether one repeatedly drifting job list can use the fresh spare
budget when all other reads succeed. Keep whole reruns on their existing policy unless cleared
separately. If the owner chooses that exception, pin the recorded drift and preserve the fallback
for an unreadable workflow list or more than one unreadable job list. Record the decision in
`docs/backlog/ci.md` and `docs/developers/ci-and-gates.md`. Use one pull request per repository,
with the controller change first. Neither change needs bigger guests or a routing-mode switch.
