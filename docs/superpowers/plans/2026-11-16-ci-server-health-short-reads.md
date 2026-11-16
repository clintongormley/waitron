# CI server health short reads

Separate Sol/high draft, checked by the Lane I driver. Claude reviews this plan;
the watcher clears it before implementation. Neither is owner design approval.

Request: `~/waitron-campaign-i/questions.md`, watcher 2026-11-16 15:20:

> Ask, ahead of SERVER-FIXED-SECRETS-2: (1) find why our server started no job while one waited (runner daemon, capacity record, or routing) and get it running again; (2) apply the same short-read handling to the server-inventory read, under ci-failure-rule.md, with this capture as its case; (3) say whether relying on GitHub's schedule alone is enough when it can skip an hour, and propose the smallest fix if not. One-page plan for (2) and (3).

**Finish line:** standalone `check` inspects the workflow rows GitHub returned after
its existing reread ends short, rather than abandoning those rows. It reports the
observation's limits. The schedule backstop was dropped by the watcher before build.

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

- [ ] **Red:** reproduce the captured queued list: 11 of 12 rows, missing target,
      no observed stall. Assert that `check` inspects returned jobs and reports a
      counted partial observation, not inventory-unavailable or global health.
      This tolerance changes the actual capture's reporting, not its missed pickup.
- [ ] One synthetic observed-stall case shows returned rows remain useful: an old
      queued server job with free capacity produces the existing `SERVER STUCK`.
      Preserve the single reread finding a missing row and complete-list behavior.
- [ ] **Green:** pass the existing fourth-argument discovery callback to `check`'s
      `serverHealth` call, enabled only for the **queued workflow-run list**. Keep
      in-progress lists strict: missing running work would make the global stall
      assertion unsound. Accept queued rows only after the existing reread ends empty
      and short with stable totals. Let the caller choose the diagnostic prefix;
      preserve the planner message bytes and existing metadata builder.
- [ ] A partial success reports inspected/advertised counts and says unread runs may
      contain waiting work. It never contains `No stalled server queue`; the step
      remains green and the existing failed-run watcher does not alert on it.
      A queued run with assigned work can still be omitted; this observation is limited.
- [ ] Preserve default `serverHealth`, routing, `recover`, `probe`, strict job and
      cancellation reads, full-server suppression and malformed/duplicate/excess/drift
      refusals. The existing check/in-progress refusal test remains unchanged.
      A short completed-history read can still prevent a global stall conclusion.
- [ ] Run `pnpm exec vitest run scripts/ci-server-health.test.mjs scripts/ci-hosted-route.test.mjs`.
      The unchanged baseline passed 234 cases. Update strict-standalone prose in the
      listed docs with a few sentences; retain the broad routing qualification and A935.
      These fixtures prove neither natural recovery nor GitHub's internal cause.

**Watcher amendment, 2026-11-16 15:36:** queued-only read-only repair cleared;
probe stays strict. The watcher accepted the timing correction and dropped both
schedule dispatch and alarm additions because their incident premise did not happen.
No schedule tooling is built. The broader pickup cause remains unproved.

Expected physical additions plus deletions: production 5–20, tests 40–85, docs
80–90 including this plan; total 125–195, outside scope opinion above 292.5.
The product documentation needs about 15 changed lines; the rest is this plan. One repair PR, focused tests,
required Claude run-it review/fixes read, signed commits, normal hook, current-head CI
and authorised landing. Record changed test checks; preserve the qualification remainder.

Claude reviewed the initial plan once (218 seconds). Driver revisions narrow the
exception to queued discovery, preserve every existing refusal assertion, name the
actual missing-target capture, and shrink the build. Watcher cleared the smaller repair on 16 November at 15:36.
