# CI routing and action-setup qualification

**Authority:** Lane I RUNNER.md. This separate Sol/high invocation writes only the plan. Driver: obtain Claude's read, resolve findings, then watcher clearance before build. Owner authorises finish/land, not design approval.

**Queue ask, verbatim** (`~/waitron-campaign-i/queue.md`):
> ### CI-ROUTING-QUALIFY. Finish qualifying CI's server routing and action setup — `in-progress` started 2026-11-15 18:49 — preparing the required plan and Claude read
> - **Ask:** docs/backlog.md "Finish qualifying CI's server routing and action setup" (bundle of 2, size M): A1424's remaining capacity and hosted-fallback qualification, and A935's action-repository download at job setup. Detail in docs/backlog/ci.md. Qualify with real runs (run, attempt, source and runner identities, as ci-and-gates.md asks), fix what the runs show, delete the entries. Today's INVENTORY-READ-GAPS fix is part of the evidence. One-page plan first.

**Smallest usable finish:** replace stale qualification claims with checked real-run evidence and narrow A935's setup-cancellation question by reading the runner source. This first slice cannot close the bundle; watcher clearance must explicitly accept that partial result. Keep every unproved requirement open.

## Reuse and file responsibilities

- Read `.github/workflows/ci.yml` for placement, workflow-SHA module fetch, watchdog and probe; `.github/workflows/server-health.yml` for scheduled rescue/idle checks. No initial workflow edits.
- Reuse `scripts/ci-server-health.mjs`: `route` owns inventory/capacity decisions, `check` reports stalls, `recover-planners` rescues eligible planners, `probe` checks pickup.
- Reuse `2026-11-15-ci-inventory-read-gaps.md` beside this plan and Lane I `receipts/inventory-read-gaps-20261115/`: #3366 landed as `842707bbb07ab04d84ac1bcd5fa9d4f04bb79212`; natural stale-count acceptance remains open (progress.log, 16:04).
- Reuse Lane I `receipts/a1473-overflow-drill-20261113/` and documented run `43390920001`: unchanged head `f855208c36b9b79828a899d1f09c14f3cd264544`, unassigned target cancelled, three hosted fixtures passed in attempt 2. This qualifies one forward move, not product checks/stuck cancellation.
- Audit existing tool/history/API run `43183718354`, scheduled rescue `43185958559` of unavailable-label run `43184702181`, and actual planner pickup `43190152811` on runner `9030` (`2026-11-12-a1473-planner-admission.md`; Lane I `receipts/firing-20261112-0624/{placement,planner}-drill-*`). Reuse these before proposing another drill.
- Final edits: `docs/developers/ci-and-gates.md` owns observations/commands/limits; `docs/backlog/ci.md` retains unfinished requirements; `docs/backlog.md` mirrors them. Raw evidence stays in local Lane I receipts; no collector/ledger/framework.

## Checks, in order

1. Audit receipts before dispatch. Retain event, workflow path/actual commit, source/PR head and merge SHA, run/attempt, job ID/name, runner ID/name/labels/version, timestamps and selected results. Resolve actual `GITHUB_WORKFLOW_SHA`, which may differ from source; retrieve workflow/module there. Unresolved identity leaves qualification open.
2. Read ordinary server-scoped PR, scheduled health/idle and hosted-retry evidence: tools/history/browser requirements, contributor-admission setting, capacity source/age/ratio inputs, route, assignment and selected checks/aggregate. Coverage requires selected merge results from an existing natural nightly, release or otherwise-full main run routed to the server; never dispatch a full run for this audit. No qualifying record means this requirement stays open. Check source continuity before reusing old evidence.
3. Seek a natural choosing log containing today's fix: require `Stale queued CI inventory count`, IDs/rows/both starting counts/cutoff, then route and assignment. Complete reads or synthetic replay do not qualify it. Episodic capacity/queue observations cannot prove full-day no-avoidable-wait behaviour.
4. No new drill is cleared by this slice. A deliberately unassigned job can divert other lanes to hosted and raise the shared stuck-queue alarm. Name an exact missing fact, isolation mechanism and expected shared effects before requesting separate watcher clearance. Automatic idle evidence needs a scheduled dispatch and actual server pickup, not a manual/hosted probe. Never manufacture pool pressure.
5. A935: spend at most 15 minutes reading the actual runner version from retained logs, then that version's official `JobRunner`, `JobExtension`, `ActionManager` and listener cancellation path. Trace job-budget cancellation into setup and download, quote short source excerpts with provenance, and label the result source inference rather than a live bound. Distinguish backlog v2.337.0 from v2.338.2 and hosted from self-hosted results.
6. Spend at most 30 further minutes inspecting existing owned-guest tools/diagnostics for a selective action-transfer stall that keeps control traffic reachable. Build no fault tool. Report feasibility and the smallest alternative to the watcher. Any later experiment needs a separately cleared concrete plan: one owned runner at a time, existing pool accounting, pinned version/source/action/job limit, successful-download control, and a named external safety stop/cleanup. A fast refusal or manual cancellation cannot qualify the setup bound.
7. Keep historical causes unproved. For a demonstrated small defect, obtain explicit watcher clearance for exact files/correction before building; then failing focused test, minimal fix, passing check. No speculative suite.

## Verification, size and time boundary

Existing decision/refusal tests: `scripts/ci-hosted-route.test.mjs`, `scripts/ci-server-health.test.mjs`, `scripts/ci-server-first.test.mjs`; workflow-text constraints: `scripts/ci-workflow.test.mjs`. Run affected files only for cleared fixes. Live logs/API identities prove scheduling/cancellation, not module tests. Check selected current-head jobs; apply documented incident-history/HTTP-5xx/checkout-health screening before timing claims.

**Expected size:** source +0/−0; tests +0/−0; final docs about +20–40/−20–40 lines, plus this plan ≤60 lines. Replace qualified “remains open” clauses in the three existing docs rather than append history; use a compact evidence table. Any demonstrated fix needs exact files, estimate and watcher clearance first.

**Three-hour split:** from recorded 18:49 start, including planning/review, audit/reuse evidence and trace A935; reserve final 45 minutes for documentation/findings and authorised finish/land. At that checkpoint any unseen natural stale-count or scheduled-idle case stays open, with no further waiting. Report before a second slice; it is not cleared here. Full-day observation stays on the backlog; outside waits follow RUNNER.md.

**Excluded:** per-job routing redesign, pool changes, image-smoke activation, Cloud/controller edits, draining lanes, credential/variable/global-setting changes, shared-process interference and the separate A935 October checkout-incident entry. Use/clean only owned resources. Claude reviews built changes separately. Retain full-day/per-job/remaining-workflow/image-guest/historical-planner requirements unless their own evidence closes them.
