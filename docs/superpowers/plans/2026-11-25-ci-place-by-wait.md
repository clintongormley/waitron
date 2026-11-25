# Place new CI jobs by the expected wait

When GitHub has a long queue, the first CI batch can put a few jobs in our server’s queue if they
are likely to start there sooner. Build the change in `scripts/ci-server-health.mjs`. Keep the job
order and the existing `server_jobs` output, its watchdog, initial `changes` placement, dependent
jobs, and reruns. The watcher queued this on 25 November after run
[45547846950](https://github.com/clintongormley/waitron/actions/runs/45547846950) allocated no
server jobs. The new rule is limited to a long hosted queue, a condition absent from the trial
the owner declined on 20 November. The watcher clears the plan before the build.

1. Reuse `hostedRunning` and `hostedWaiting` from the `DISPOSABLE_TESTS_CAPACITY` read that
   already supplies the server counts. Start with today’s free-slot allocation. With a valid
   snapshot less than five minutes old, a healthy server with positive capacity and at least 20
   jobs waiting at GitHub, allow up to four waiting jobs on the server including those already
   counted there. For each extra place, divide the jobs ahead (running, waiting and earlier
   placements in this batch) by the available slots and round down to estimate how many waves
   must finish before the job can start. Use the existing 20-slot GitHub estimate. Give the server
   the extra place only if its next start is a wave earlier. This first cut uses equal-duration
   waves. No new timing table, API calls, credentials or reservations. Missing hosted counts,
   ambiguous capacity age or a stalled server retain the existing routing decision.
2. Reuse the CI run and job inventory already read by `serverHealth`. Give only the lowest run ID
   among visible same-repository first-attempt runs with an in-progress `changes` job the extra
   allowance, and require the current run to appear in that set. Simultaneous planners that see
   the same inventory choose the same run. If inventories disagree, each decision is still capped
   at four extra jobs. Report both pool counts, snapshot age, and extra places granted.
3. In `scripts/ci-hosted-route.test.mjs`, start with a first batch that gets zero server jobs today
   from a 12-running/1-waiting server snapshot and a 20-running/119-waiting GitHub snapshot. Its
   three extra jobs should select the first three enabled jobs. Use the same fixture to check that
   only one of two visible planners queues extra jobs, and compare quiet/tied queues and
   missing/stale counts against today’s free-slot result. Keep the existing health, hosted
   fallback and retry assertions. Run `pnpm exec vitest run scripts/ci-hosted-route.test.mjs scripts/ci-workflow.test.mjs`.
4. Update `docs/developers/ci-and-gates.md` and the routing bundle in `docs/backlog.md` and
   `docs/backlog/ci.md`. For qualification, capture a healthy ordinary first-attempt run with an
   extra placement and one with the existing split. Record run, attempt, source SHA, snapshot and
   runner identities with actual queue-to-start times. Keep full-day qualification open.

Expected diff is about 45–60 production and 60–90 test lines, plus the documentation.
