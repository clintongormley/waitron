# Balance new CI jobs by queue pressure per runner slot

New CI batches can queue on our server when GitHub has more work per slot. In
[run 45547846950](https://github.com/clintongormley/waitron/actions/runs/45547846950), the planner
read 12 busy server slots and one job waiting in a 121-second-old snapshot and chose no server jobs.
The watcher later observed 2 of 12 busy and 119 hosted jobs waiting. The hosted counts at the decision
are unknown. On 25 November at 10:00 the watcher recorded the owner’s instruction to keep queues even
and cleared this revision of the Claude-reviewed plan.

1. In `scripts/ci-server-health.mjs`, use the capacity snapshot that already supplies server counts.
   With positive server capacity, both hosted counts, a readable health inventory and a snapshot
   younger than five minutes and dated no later than now, take the larger published or visible
   total for each pool. The watcher cleared this on 25 November at 11:02 after two reviews found
   that jobs in preparation could count twice and the visible hosted queue was ignored. Fill
   available server slots first. Then use the enabled first batch size
   to equalize total jobs per slot across the two pools, rounding the server allocation up and
   clipping it to the batch. Log observation time, counts and jobs beyond free slots. The existing
   free-slot rules apply when hosted counts are missing, the snapshot is stale or the server is
   stalled. Unreadable inventory and unverified server capacity keep their current fallback.
2. Keep family order, workflow outputs, reruns and dependent jobs as they are. Trace the watchdog and
   the Cloud controller’s overflow check. A later planner can see earlier jobs on both pools.
   Simultaneous planners reserve nothing and can still choose from the same observations. The age
   check limits how long they can use one snapshot, without imposing a shared admission limit.
3. In `scripts/ci-hosted-route.test.mjs`, run the first-batch route with 12 busy plus 1 waiting on
   the server and 20 busy plus 39 waiting on GitHub. Expect 31 of 45 movable jobs on the server, in
   family order, and 16 if 12 running and 25 unassigned server jobs are already visible. Include the quiet case,
   non-current snapshots, the existing stalled and unreadable paths, a server preparing admitted
   jobs and two planners reading one publication as both queues grow. Run the focused routing,
   server health and workflow guard files before review.
4. Update `docs/developers/ci-and-gates.md` and the routing bundle in `docs/backlog.md` and
   `docs/backlog/ci.md`. Qualify on an ordinary first attempt that places jobs beyond free slots.
   Retain snapshot, job and runner identities, creation and start times, and any hosted retry.
   Compare with jobs created alongside them and record shared-snapshot decisions if observed. Keep
   full-day qualification open. No timing model, additional API read or controller change.

Expected diff after review is about 70 production lines and 150 test lines, plus documentation.
