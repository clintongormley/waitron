# Put new CI jobs on our server when GitHub has a long queue

Let the first CI batch use one server-sized queue while GitHub has at least a full batch waiting.
In [run 45547846950](https://github.com/clintongormley/waitron/actions/runs/45547846950), the planner
read 12 busy slots and one job waiting in a 121-second-old snapshot and selected no server jobs.
The watcher saw 2 of 12 busy and 119 GitHub jobs waiting a minute later. Occupancy at the decision
and the hosted counts in that snapshot are unknown. The owner’s 20 November decision to keep the
split stands until the watcher resolves it for this proposal.

1. In `scripts/ci-server-health.mjs`, start from today’s free-slot split. Extend it only when
   the server has positive capacity, its existing health scan can be read and reports no stall,
   and the capacity snapshot is less than five minutes old and dated no later than now. Require
   published `hostedRunning` and `hostedWaiting` of at least 20 each, using the existing capacity
   variable and the existing estimate of 20 hosted slots. Missing counts keep the current split.
   This is a coarse wait comparison using queue depth. It leaves job timing and family priority alone.
2. Count waiting, unassigned server-labelled jobs from the inventory `serverHealth` already reads.
   Use the larger of that count and published `serverWaiting`. When the allowance is active, select
   up to two times usable slots, minus published busy slots and that waiting count, while preserving
   at least the existing free-slot result. This holds one wave of waiting jobs beyond occupied slots
   in the observed inventory. Earlier planners’ visible jobs count against it. Simultaneous reads
   and jobs still being created can briefly exceed it. Log observation time, both pools and extras.
3. Keep output shape, labels, initial planner placement, dependent jobs, reruns and stall fallback.
   A newly mixed run can add a hosted watchdog. Waiting server jobs can send later planners to
   GitHub. The Cloud controller’s untouched-PR overflow can still send work back if conditions
   change. Its current source skips overflow while at least 20 hosted jobs are running, or when
   server queue depth per slot is no greater than GitHub’s.
4. Start with a failing test in `scripts/ci-hosted-route.test.mjs` using a synthetic 12 busy, 1
   waiting server snapshot and a 20 busy, 119 waiting hosted snapshot. Expect 11 selected jobs in
   family order. Check an unchanged snapshot with a second planner’s already visible server jobs,
   and confirm quiet, stale, missing or stalled inputs retain today’s behavior. Run the focused
   `ci-hosted-route`, `ci-server-health`, `ci-server-first` and `ci-workflow` root test files.
5. Update `docs/developers/ci-and-gates.md` and the routing bundle in `docs/backlog.md` and
   `docs/backlog/ci.md`. Qualify with an ordinary first attempt that places extras. Record the
   run, attempt, source, snapshot time, job creation and start, and runner identities. Compare
   server extras with concurrently created hosted jobs in that run and check for a hosted retry.
   Record same-snapshot planners if observed. Keep full-day qualification open.

Expected diff is about 40–55 production and 60–90 test lines, plus documentation.
