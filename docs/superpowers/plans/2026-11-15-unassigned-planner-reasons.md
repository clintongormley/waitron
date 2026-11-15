# Explain planning jobs left waiting

**Goal:** When you read the existing Server health recovery log, you can identify a
queued server planning job by run id, attempt and job id, and see the condition
that left it waiting. This diagnoses a recurrence; it does not repair the earlier incident.

**Request:** Lane I queue, UNASSIGNED-PLANNER-REASON, watcher 2026-11-15 11:52:
“Make Waitron's existing recovery pass log, for each old unassigned planner job it
declines to rescue, the job and run id and the reason (server full, PR link missing,
head mismatch, not stalled long enough…).” The watcher cleared the diagnostic
scope, not this implementation plan. Codex wrote this plan; build awaits the
watcher's clearance after Claude's read.

**Approach:** Reuse `serverHealth`, `recoverServer`, their existing API inventories,
`old`, exact server labels and `options.report`. Emit a plain line such as
`Planner rescue skipped: run=12 attempt=1 job=123; PR head changed.` at the
existing decision that declines a queued, unassigned server `changes` job.
Preserve every cancellation/retry predicate and its order. Log young/unknown-age
jobs as waiting for the existing five-minute threshold, without admitting them.
For run-level exclusions (hosted marker or retry), read jobs only to identify the
planner being declined. On the full-capacity short circuit, gather identities for
diagnostics without enabling cancellation; if that diagnostic inventory fails,
retain the full-server refusal and report the inventory failure.

**Files:** `scripts/ci-server-health.mjs` adds reasons to the existing planner-only
scan and final eligibility checks: full server, age, hosted marker, retry,
missing/changed PR link, changed run/head/PR identity, closed/foreign PR,
assignment or other started/completed work. Other commands retain their current
output and reads. `scripts/ci-server-health.test.mjs` extends the existing
scheduled-planner cases and fixture, keeping every behavioral assertion.
`docs/developers/ci-and-gates.md` explains the log and its inventory limits;
`docs/backlog.md` and `docs/backlog/ci.md` update only the existing routing bundle,
retaining its open historical diagnosis and qualification work.

**Build and verification:**
- [ ] Add report assertions to existing planner cases for full capacity, young job,
  missing PR link and changed head; observe failures due to missing run/job/reason.
- [ ] Add the smallest logging implementation, then cover remaining existing
  decline branches using the same fixture. Assert no POST for declined cases;
  retain the successful eligible-planner cancellation/retry assertions.
- [ ] Run `pnpm exec vitest run --project root scripts/ci-server-health.test.mjs
  scripts/ci-hosted-route.test.mjs scripts/ci-server-first.test.mjs` and read counts.
  Check full-capacity diagnostic inventory failure still makes no POST. No live
  cancellation, manual workflow dispatch or controller deployment is needed.
- [ ] Update current documentation from those measured cases, then finish-branch,
  current-head CI and land-branch. Do not wait for another production recurrence.

**Size and exclusions:** About +70/-20 production lines, +110/-0 test lines,
+10/-3 current documentation lines, plus this plan. No new recovery policy,
transport, credential, storage, workflow, timer or dependency. No controller edit;
its requested log examples go in the lane's `controller-ask.md` for lane G.
