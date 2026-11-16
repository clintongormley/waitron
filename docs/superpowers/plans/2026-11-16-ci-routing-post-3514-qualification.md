# CI routing after #3514: next qualification slice

**Authority:** Lane I RUNNER.md; original item start **2026-11-15 18:49** remains unchanged.
This is its next slice, not new ownership. Driver checks this separate Sol/high plan;
Claude reviews it and the watcher clears execution. No owner design approval is claimed.

**Queue ask, verbatim** (`~/waitron-campaign-i/queue.md`):
> **Ask:** docs/backlog.md "Finish qualifying CI's server routing and action setup" (bundle of 2, size M): A1424's remaining capacity and hosted-fallback qualification, and A935's action-repository download at job setup. Detail in docs/backlog/ci.md. Qualify with real runs (run, attempt, source and runner identities, as ci-and-gates.md asks), fix what the runs show, delete the entries. Today's INVENTORY-READ-GAPS fix is part of the evidence. One-page plan first.

**Smallest usable result:** checked post-repair routing and hosted-fallback evidence, then
either a concrete A935 experiment proposal for clearance or a bounded feasibility blocker.
Keep every unproved bundle point open; a source-only audit cannot complete qualification.
Watcher direction: `~/waitron-campaign-i/questions.md`, **2026-11-16 14:02**.

1. **Establish the boundary.** Reuse the first-slice audit on main `52aa441257` and
   `2026-11-15-ci-routing-qualification.md`; retain inventory refusal `43858443488` as context.
   #3514 merged as `9543152d2c2401fe530660251318432958614855` at 13:55 CET;
   main CI `43871018662` passed. Check these receipts and each candidate's actual workflow
   SHA and fetched routing/health module commit for the repaired implementation. Source head
   or run date alone cannot establish the boundary, including on retries.
2. **Inspect natural records first.** Use existing ordinary CI and Server health records
   since that boundary, not fresh rescue or full-run drills. For every selected job retain
   run/attempt/job, source head, workflow/module SHA, requested/runner labels, runner name/id/version,
   creation and assignment timestamps and their interval, selected checks and final result.
   State how assignment was identified; label timestamp proxies and missing evidence.
   Retain route reasons and capacity source, observation age, slots, occupied/waiting counts
   and comparison inputs, alongside contemporaneous health logs. Reconcile actual placements
   across attempts, including hosted fallback; a routing decision alone proves no assignment.
3. **Qualify only observed cases.** Inspect post-#3514 health for short-list discovery,
   eligible planner rescue and fallback without assuming recurrence. A discovery diagnostic
   cannot qualify routing's agreeing-row exception. Match observations to the existing
   backlog requirements for scheduled idle pickup, workload/coverage, overflow and capacity;
   reuse completed drills. Missing natural cases and full-day capacity proof remain open.
   Before judging performance require healthy GitHub incident history, no download HTTP 5xx
   and checkout about 10 seconds. Report observed intervals and limits even when this screen
   fails; queue intervals alone establish no speed gain.
4. **A935 feasibility only, at most 30 minutes.** Reuse the completed runner source trace.
   Read current existing owned-guest tools, runner source and logs without changing a guest.
   Prior inspection found no ready selective fault tool; do not invent one as available.
   A proposal must name one owned, pool-accounted disposable guest, a selectively stalled
   setup action archive transfer with control traffic reachable, successful-download control,
   actual runner version/action/source/job timeout, independent safety stop, listener
   cancellation and worker-exit logs, and cleanup. Before building or running any new fault
   mechanism or workflow, return its exact isolation, shared effects, files and size to the
   watcher for clearance. Otherwise record inspected commands/files and the bounded blocker.
5. **Record and verify.** Update `docs/developers/ci-and-gates.md` with compact linked evidence
   and limits; `docs/backlog/ci.md` with results and remaining proofs; `docs/backlog.md` with
   matching scope. Delete entries only when all their requirements are proved. Driver checks
   each claim against retained logs/API identities; raw receipts stay local. Existing
   `scripts/{ci-hosted-route,ci-server-health,ci-server-first}.test.mjs` own route semantics;
   `scripts/ci-workflow.test.mjs` owns workflow-text constraints; live logs own scheduling.
   No source/test changes before a demonstrated defect and separately watcher-cleared fix,
   then failing focused test, minimal correction and affected checks. No broad suite runs.

**Size/time/exclusions:** docs about +30–60/−15–35 lines plus this plan; source/tests 0 unless
separately cleared. Evidence checkpoint about 45 minutes into this slice; finish below 3 hours,
reporting gaps rather than waiting for cases. Driver records results on the existing item.
No pool, credential, global or variable changes, controller edits, image activation, other-lane
edits or shared network disruption. A1027 stays blocked on a captured recurrence.
