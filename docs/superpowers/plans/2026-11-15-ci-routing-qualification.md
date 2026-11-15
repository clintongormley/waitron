# CI routing and action-setup qualification

**Authority:** Lane I RUNNER.md. This separate Sol/high invocation writes only the plan. Driver: obtain Claude's read, resolve findings, then watcher clearance before build. Owner authorises finish/land, not design approval.

**Queue ask, verbatim** (`~/waitron-campaign-i/queue.md`):
> ### CI-ROUTING-QUALIFY. Finish qualifying CI's server routing and action setup — `in-progress` started 2026-11-15 18:49 — preparing the required plan and Claude read
> - **Ask:** docs/backlog.md "Finish qualifying CI's server routing and action setup" (bundle of 2, size M): A1424's remaining capacity and hosted-fallback qualification, and A935's action-repository download at job setup. Detail in docs/backlog/ci.md. Qualify with real runs (run, attempt, source and runner identities, as ci-and-gates.md asks), fix what the runs show, delete the entries. Today's INVENTORY-READ-GAPS fix is part of the evidence. One-page plan first.

**Smallest usable finish:** actionable guidance identifying qualified server placement/recovery and setup cancellation, with explicit remaining gaps. Delete only proved backlog requirements. This plan cannot promise full bundle closure: full-day queue behaviour, per-job overflow and excluded guest work remain unfinished.

## Reuse and file responsibilities

- Read `.github/workflows/ci.yml` for placement, workflow-SHA module fetch, watchdog and probe; `.github/workflows/server-health.yml` for scheduled rescue/idle checks. No initial workflow edits.
- Reuse `scripts/ci-server-health.mjs`: `route` owns inventory/capacity decisions, `check` reports stalls, `recover-planners` rescues eligible planners, `probe` checks pickup.
- Reuse `2026-11-15-ci-inventory-read-gaps.md` beside this plan and Lane I `receipts/inventory-read-gaps-20261115/`: #3366 landed as `842707bbb07ab04d84ac1bcd5fa9d4f04bb79212`; natural stale-count acceptance remains open (progress.log, 16:04).
- Reuse Lane I `receipts/a1473-overflow-drill-20261113/` and documented run `43390920001`: unchanged head `f855208c36b9b79828a899d1f09c14f3cd264544`, unassigned target cancelled, three hosted fixtures passed in attempt 2. This qualifies one forward move, not product checks/stuck cancellation.
- Final edits: `docs/developers/ci-and-gates.md` owns observations/commands/limits; `docs/backlog/ci.md` retains unfinished requirements; `docs/backlog.md` mirrors them. Raw evidence stays in local Lane I receipts; no collector/ledger/framework.

## Checks, in order

1. Audit receipts before dispatch. Retain event, workflow path/actual commit, source/PR head and merge SHA, run/attempt, job ID/name, runner ID/name/labels/version, timestamps and selected results. Resolve actual `GITHUB_WORKFLOW_SHA`, which may differ from source; retrieve workflow/module there. Unresolved identity leaves qualification open.
2. Read ordinary server-scoped PR, scheduled health/idle and hosted-retry evidence: tools/history/browser requirements, contributor-admission setting, capacity source/age/ratio inputs, route, assignment and selected checks/aggregate. Coverage needs full-run merge results. Reuse till/browser and fallback evidence only after checking identities and source continuity.
3. Seek a natural choosing log containing today's fix: require `Stale queued CI inventory count`, IDs/rows/both starting counts/cutoff, then route and assignment. Complete reads or synthetic replay do not qualify it. Episodic capacity/queue observations cannot prove full-day no-avoidable-wait behaviour.
4. Fill only missing evidence with an existing owned probe/unavailable-label PR drill, without variable changes. Require visible first-attempt non-assignment/failure/cancellation and unchanged-source hosted retry with runner/results. Automatic idle qualification requires scheduled dispatch followed by server pickup; a manual/hosted probe is insufficient. Never repeat qualified overflow or manufacture pool pressure.
5. A935 feasibility discovery, at most 30 minutes: inspect local `network-limits-20261113` receipts, owned guest access and runner diagnostics. Retained overflow jobs are shell-only; retained guest/runner provisioning scripts establish no download-fault mechanism. Demonstrate a way to stall only an actual setup action-bundle transfer while preserving runner control/cancellation, without controller/shared-network edits. Otherwise retain A935 and report the concrete limitation/smallest alternative to the watcher; no invented harness.
6. If feasible and cleared, use equivalent fresh owned runners, identical workflow/source/action revision/job limit, for one actual setup-download stall and one successful-download control. Retain setup/worker/transfer logs and job start/deadline/cancellation/API results. Control downloads and reaches its first step; stall remains in “Download action repository” before any step. Measure whether job-budget cancellation ends worker/transfer or setup outlives it. Fast refusal, action-step timeout and manual cancellation prove no bound. Use an external safety deadline; needing it leaves A935 open.
7. Keep historical causes unproved. For a demonstrated small defect, obtain explicit watcher clearance for exact files/correction before building; then failing focused test, minimal fix, passing check. No speculative suite.

## Verification, size and time boundary

Existing decision/refusal tests: `scripts/ci-hosted-route.test.mjs`, `scripts/ci-server-health.test.mjs`, `scripts/ci-server-first.test.mjs`; workflow-text constraints: `scripts/ci-workflow.test.mjs`. Run affected files only for cleared fixes. Live logs/API identities prove scheduling/cancellation, not module tests. Check selected current-head jobs; apply documented incident-history/HTTP-5xx/checkout-health screening before timing claims.

**Expected size:** source +0/−0; tests +0/−0; final docs +40–80/−0–30 lines, plus this plan ≤60 lines. A demonstrated small fix provisionally adds ≤30 source/≤60 test lines; watcher clears exact files/estimate first. Larger work needs a cleared split.

**Three-hour split:** from recorded 18:49 start, including planning/review, first audit/reuse evidence and discover feasibility; reserve final 45 minutes for documentation/findings and finish/land preparation. Checkpoint missing evidence. A second watcher-cleared ≤3-hour slice runs feasible A935 controls/cleared correction. Full-day observation remains separate and on the backlog; external waits follow RUNNER.md.

**Excluded:** per-job routing redesign, pool changes, image-smoke activation, Cloud/controller edits, draining lanes, credential/variable/global-setting changes and shared-process interference. Use/clean only owned resources. Claude reviews built work separately; driver follows authorised finish/land and retains unfinished backlog entries.
