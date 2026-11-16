# CI server health short reads

Separate Sol/high draft, checked by the Lane I driver. Claude reviews this plan;
the watcher clears it before implementation. Neither is owner design approval.

Request: `~/waitron-campaign-i/questions.md`, watcher 2026-11-16 15:20:

> Ask, ahead of SERVER-FIXED-SECRETS-2: (1) find why our server started no job while one waited (runner daemon, capacity record, or routing) and get it running again; (2) apply the same short-read handling to the server-inventory read, under ci-failure-rule.md, with this capture as its case; (3) say whether relying on GitHub's schedule alone is enough when it can skip an hour, and propose the smallest fix if not. One-page plan for (2) and (3).

**Finish line:** standalone `check` inspects the workflow rows GitHub returned after
its existing reread ends short, rather than abandoning those rows. It reports the
observation's limits. The schedule backstop below is a proposal, not a build.

**Evidence:** `~/waitron-campaign-i/receipts/firing-20261116-1520/`.
`scheduled-health.log:538` captures run 43882357125's queued workflow list:
11 rows/count 12, then empty page 2/read 2. This is not a jobs or runners list.
The last schedule was 14:06:47Z / 15:06:47 CET, about 14 minutes before the watcher
sample. Server jobs completed through 14:18:42Z; PR #3522's planner passed on server
runner 24902 at 14:23:43Z. The 25-minute unassigned planner wait is real; continuous
idleness and an hour schedule outage are not established. Manual health retried no
planner. Its later cancellation's actor and the missed pickup's cause remain unproved;
the driver continues that diagnosis separately, without claiming this repair solves it.

**Files:** `scripts/ci-server-health.mjs`, `scripts/ci-server-health.test.mjs`,
`docs/developers/ci-and-gates.md`, `docs/backlog/ci.md`, `docs/backlog.md`, this plan.
Reuse the inventory reader, optional planner-discovery callback and existing API fixtures.
No workflow, shared-script, controller, cache, record or cancellation-policy change.

- [ ] **Red:** in the health suite, run real `healthCommand("check", …)` against
      the captured 11-of-12 workflow shape and an observed old queued server job with
      free capacity. Expect `SERVER STUCK` naming its run, strict job reads, the
      shortfall diagnostic and no writes. Watch today's inventory-unavailable answer fail.
- [ ] Cover the queued and in-progress scan requests, a partial observation without a
      stall, and the existing reread finding a missing row. Keep existing full-server,
      malformed/duplicate/excess/count-drift, strict jobs and cancellation assertions.
- [ ] **Green:** generalize the optional discovery callback for `check` only. Accept
      collected workflow rows at an empty page after the existing single immediate
      reread, preserving stable-total validation. Keep planner diagnostic wording;
      report check path/page/read/totals/count/IDs with the existing diagnostic builder.
      A partial no-stall answer says it inspected returned rows and may omit other work.
- [ ] Preserve default `serverHealth`, routing, `recover`, `probe`, completed-traffic
      reads and all cancellation job checks. The opt-in never reaches a job inventory.
      Request explicit watcher clearance for changing only `check`/`workflow_runs` in
      `identifies the refused $key read in $command without writes` (health suite:1402).
- [ ] Run `pnpm exec vitest run scripts/ci-server-health.test.mjs scripts/ci-hosted-route.test.mjs`.
      Read counts; unchanged baseline at 7558cfb36e passed 234 cases. Audit strict-standalone
      prose across the listed docs. Keep broad routing qualification and A935 open;
      fixtures establish no natural recovery or GitHub-internal cause.

**Schedule proposal, separately cleared before implementation:** reuse the machine-local
`~/waitron-campaign-shared/watch-stalls.sh` server-stuck alarm. When its existing
status-backed conditions find old waiting work, free slots and no recent admission,
read Server health history. With no queued/running pass and none created for ten
minutes, dispatch existing `server-health.yml` on `main` under its existing 30-minute
alarm suppression. Unreadable history reports uncertainty. Add no service or scheduler.
Mac off and GitHub/API outages remain limits; schedule alone cannot guarantee cadence.

| Source                                                                                                                                             | Source words                                                              | Implication                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [GitHub schedule docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), read 2026-11-16 | “The `schedule` event can be delayed”; “some queued jobs may be dropped.” | Keep an independent trigger available; this capture proves only the measured gap. |

Expected physical additions plus deletions: production 30–60, tests 80–140, docs
80–110, total 190–310; outside scope opinion above 465. One repair PR, focused tests,
required Claude run-it review/fixes read, signed commits, normal hook, current-head CI
and authorised landing. Record changed test checks; preserve the qualification remainder.
