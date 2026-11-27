# Check current server capacity before rescuing a CI planner

A waiting PR planner should keep its server place while a current reading shows every server slot
occupied. When a cancelled attempt cannot safely be retried, the health log should name the check
that refused it. This is the watcher's 27 November 06:26 CI routing assignment to Lane I.

[#4452 attempt 1](https://github.com/clintongormley/waitron/actions/runs/45943582508/attempts/1)
selected 29 server jobs plus the planner, and all 30 passed there. Its remaining placements were
made when the planner ran. [#4465 attempt 1](https://github.com/clintongormley/waitron/actions/runs/45943852902/attempts/1)
queued its planner on the server at 05:07:05 UTC. The controller's oldest-run-first selection and
completed job records show #4452 taking the available work ahead of it. At cancellation, the job
timestamps show 12 concurrent #4452 server jobs. The
[health run](https://github.com/clintongormley/waitron/actions/runs/45943751778) used the 05:04:54 UTC
capacity reading, outside its five-minute limit by 05:12:21. It refused to retry with a generic
message. The later reads show the original planner cancelled with no assigned runner. The specific
reply that failed the intervening check is unavailable. Attempt 2 used the existing hosted fallback.

- In `.github/workflows/server-health.yml`, give only the planner recovery step the existing
  repository variables read secret. In `scripts/ci-server-health.mjs`, let `main` reuse the route
  command's capacity read and source report for `recover-planners`. `serverFull` keeps the existing
  five-minute and full-slot checks. A failed read retains the workflow snapshot. Missing or stale
  data still permits rescue when the existing PR and job checks pass.
- In `recoverServer`, report the existing final verification refusal reason after cancellation for
  a still-current PR, with the run, attempt and planner job IDs already used for skip diagnostics.
  Keep the obsolete-head handling, intervention failure and all retry conditions as they are.
- In `scripts/ci-server-health.test.mjs`, use the existing planner fixture to first show that an old
  workflow snapshot makes `main('recover-planners')` cancel even when a fresh full snapshot is
  available. After the change, expect one capacity read with the dedicated token, a full-server skip
  and zero writes. The free-capacity control must still cancel then retry. Exercise the cancelled
  planner's existing label-refusal case and assert the logged reason and absence of a retry. Run
  `pnpm exec vitest run scripts/ci-server-health.test.mjs scripts/ci-hosted-route.test.mjs scripts/ci-server-first.test.mjs scripts/ci-workflow.test.mjs`.
- Update `docs/developers/ci-and-gates.md` and the routing entry in `docs/backlog/ci.md` with the actual
  behavior and run evidence. Read the first normal main health run that consults capacity. Keep the
  full-day measurement open. Existing placements and the controller's movement policy are outside
  this slice. No synthetic cancellation of another lane's run.

Estimate about 15 production and workflow lines and 55 test lines. Allow one PR for both changes to
this recovery path.
