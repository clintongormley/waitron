# Check current server capacity before rescuing a CI planner

A waiting PR planner should keep its server place while a current reading shows every server slot
occupied. When a cancelled attempt cannot safely be retried, the health log should name the check
that refused it. The watcher assigned this investigation on 27 November at 06:26 CET.

[#4452 attempt 1](https://github.com/clintongormley/waitron/actions/runs/45943582508/attempts/1)
used the server for 29 jobs and its planner. All 30 passed. The planner placed the other work when
it ran, and those labels persisted after the server finished. [#4465 attempt 1](https://github.com/clintongormley/waitron/actions/runs/45943852902/attempts/1)
queued its server planner at 05:07:05 UTC while the controller was filling slots with #4452's older
jobs. At cancellation at 05:12:21 UTC, #4452 had 12 server jobs in progress. The
[health job](https://github.com/clintongormley/waitron/actions/runs/45943751778/job/140323637910)
used the 05:04:54 UTC snapshot of 1 running on 12 slots, already outside its five-minute limit.
Controller request counts show successful variable updates at 05:10:41 and 05:12:08 UTC. The counts
omit values, so the exact server occupancy a fresh read would have returned remains unverified.

The post-cancel check gave a generic refusal. Later API reads show the same open owned PR head,
matching run and label, planner cancelled with runner ID 0 and its original 05:07:05 start (317s
before completion), and one skipped sibling. Those readings satisfy the retry checks retrospectively.
The response that failed immediately after cancellation is unavailable. The later
[attempt 2 planner](https://github.com/clintongormley/waitron/actions/runs/45943852902/job/140329740152)
logged `CI route: hosted; A previous attempt waited for the server and was cancelled.` The route
returns there before reading current capacity. Both runs had useful checks underway when inspected.
The controller's supported move is from the server to GitHub for an untouched run.

- Give only the recovery step in `.github/workflows/server-health.yml` the existing capacity read
  secret. Let `main` in `scripts/ci-server-health.mjs` reuse the route command's read and source
  report for `recover-planners`. Keep the five-minute and full-slot checks in `serverFull`. A failed
  read retains the workflow snapshot. Keep the separate read-only queue alarm on its current
  snapshot and observed progress rules.
- In `recoverServer`, log the existing post-cancel verification refusal with the run, attempt and
  planner job IDs. Keep each retry condition, obsolete-head handling and intervention failure.
- In `scripts/ci-server-health.test.mjs`, use the planner fixture to show that a stale workflow
  snapshot currently causes cancellation despite a fresh full snapshot being available. Expect one
  dedicated-token read, a full-server skip and zero writes after the change. Fresh free capacity
  must still cancel then retry. Extend the cancelled-planner label-refusal case with the reason
  and absence of a retry. Pin the workflow step's token scope in `scripts/ci-server-first.test.mjs`.
  Run those suites plus `scripts/ci-hosted-route.test.mjs` and `scripts/ci-workflow.test.mjs`.
- Update the capacity and skip reporting paragraphs in `docs/developers/ci-and-gates.md` and the
  routing entry in `docs/backlog/ci.md`. Read a normal main health run that consults capacity. Keep
  the full-day measurement open. Existing job placement and controller movement stay out of scope.

Estimate about 15 production and workflow lines and 65 test lines in one PR.
