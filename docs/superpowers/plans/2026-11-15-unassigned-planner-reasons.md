# Explain planning jobs left waiting

**Goal:** You can read the existing Server health recovery log to identify a
queued server planning job by run id, attempt and job id, and see why this pass
left it waiting. This diagnoses a recurrence; it does not repair the earlier incident.

**Request:** Lane I queue, UNASSIGNED-PLANNER-REASON (queued 2026-11-15 11:52):
“Make Waitron's existing recovery pass log, for each old unassigned planner job it
declines to rescue, the job and run id and the reason (server full, PR link missing,
head mismatch, not stalled long enough…).” Codex wrote this plan; Claude reviewed it in two reads. The watcher cleared the
build on 2026-11-15 at 12:08 in Lane I's questions.md, with the two changes below.
No owner approval of the design or plan is recorded.

**Approach:** Reuse `serverHealth`, `recoverServer`, their existing inventories,
`old`, server labels and `options.report`. Emit a plain line such as
`Planner rescue skipped: run=12 attempt=1 job=123; PR head changed.` at existing
pre-cancellation decisions. In planner-only mode retain the scanned planner job
alongside its run for later reason lines; do not change other callers' results.
Keep every cancellation/retry predicate and its order. Do not log decline lines
from `eligible(true)` after cancellation; its existing outcome reports stay.

Only report queued, unassigned self-hosted `changes` jobs from owned PR runs.
Use the already-read job list to explain an incorrect planning label, without
admitting it. For age, distinguish missing/invalid timestamp from a measured wait
under five minutes; print the selected timestamp field and measured age for the
latter. Already-assigned jobs stay quiet; assignment after the scan gets a reason.
Hosted-marked and retry runs remain excluded from `stuck` and from recovery:
their extra job reads identify reasons only, and failures there are reported
without changing the prior skip. Fork and non-PR planning stays quiet.

For full capacity, emit the existing full-server line before any diagnostic read.
Then read only run/job lists to name old, unassigned planning jobs; no PR reads,
`eligible()` or writes. Catch every diagnostic-read error, report it, and retain
today's successful full-server return. These extra reads cannot enable recovery.
The watcher's 12:08 changes: the full-server path names marked and retry runs too,
using only `server full`; test a throwing diagnostic job read for an excluded run,
keeping the existing result/output and no writes to that run while the pass continues.

**Files:** `scripts/ci-server-health.mjs` adds planner reasons for capacity, age,
label, hosted marker, retry, missing/changed PR link, changed run/head/PR identity,
closed/foreign PR, newly assigned jobs and other started/completed work.
`scripts/ci-server-health.test.mjs` extends the scheduled-planner cases and
fixture; keep every behavioral assertion. `docs/developers/ci-and-gates.md`
explains that no line does not prove eligibility: inventories, run-list status,
earlier errors, deadlines and a pass that never runs limit what it sees/reaches.
Fork and non-PR planning is hosted, so those runs stay quiet.
`docs/backlog.md` and `docs/backlog/ci.md` add one clause to the existing routing
bundle; keep the historical diagnosis and qualification work open.

**Build and verification:**
- [x] The controller examples for lane G are already written, outside Git, in
  `/Users/clintongormley/waitron-campaign-i/receipts/reorient-20261115-1140/controller-ask.md`:
  `CI planner skipped: repository=… run=… attempt=… job=…; PR link missing.` and
  equivalent head-differs/full-pool lines. No controller implementation here.
- [ ] Add report assertions for full capacity, young/unknown age, missing PR link
  and changed head; observe failures due to missing run/job/reason. Implement
  minimal logging, then cover other decline reasons in the existing case table.
  Assert no POST after awaited recovery. Marked/retry cases must not print
  `Preserved` or `Recovering`; existing successful cancellation/retry checks stay.
  A cancelled run found obsolete prints its existing outcome without a skip line.
- [ ] Run `pnpm exec vitest run scripts/ci-server-health.test.mjs
  scripts/ci-hosted-route.test.mjs scripts/ci-server-first.test.mjs` and read counts.
  Exercise a plain diagnostic-read error on full capacity: command resolves,
  full-server reason remains, no POST. Assert the existing general recovery
  `Preserved runs …` line is unchanged.
- [ ] Update current docs from measured cases, then finish-branch, current-head CI
  and land-branch. No live cancellation, dispatch, deployment or recurrence wait.

**Initial size estimate and exclusions:** About +80/-20 production lines, +120/-0 test lines,
+12/-3 current documentation lines, plus this plan. No new recovery policy,
transport, credential, storage, workflow, timer or dependency. Other commands
retain their current reads and output. No fiscal, UI or Cloud changes.

The watcher cleared the review correction on 2026-11-15 at 12:21: eligible rescues
precede excluded-run diagnostic job reads, using the existing run inventory once;
log a retry even when it has no old unassigned server planner. At 12:27 the watcher
cleared the size growth with duplicate excluded-read failure checks merged.

The watcher clarified at 12:35 that only per-job retry reasons are in scope;
there is no run-level line for a retry without an old unassigned planner.
