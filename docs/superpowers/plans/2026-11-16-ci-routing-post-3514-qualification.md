# CI routing after #3514: targeted qualification slice

**Authority:** Lane I RUNNER.md; original item start **2026-11-15 18:49** stays unchanged.
Separate Sol/high draft, checked and corrected by the Codex driver after Claude's read.
Claude reviewed the plan once; the watcher cleared this docs-only slice on 16 November
at 14:15 in Lane I questions.md. No owner design approval is claimed.

**Queue ask, verbatim** (`~/waitron-campaign-i/queue.md`):

> **Ask:** docs/backlog.md "Finish qualifying CI's server routing and action setup" (bundle of 2, size M): A1424's remaining capacity and hosted-fallback qualification, and A935's action-repository download at job setup. Detail in docs/backlog/ci.md. Qualify with real runs (run, attempt, source and runner identities, as ci-and-gates.md asks), fix what the runs show, delete the entries. Today's INVENTORY-READ-GAPS fix is part of the evidence. One-page plan first.

**Finish:** qualify and delete each proved sub-requirement below, then deliver one concrete
A935 experiment proposal for watcher clearance. Unseen cases stay open. This partial slice
cannot promise the whole bundle's deletion. Watcher direction: questions.md, 16 November 14:02.
Reuse the checked first-slice evidence and [`2026-11-15-ci-routing-qualification.md`](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-ci-routing-qualification.md).

1. **Inspect real runs since #3514, targeting four open proofs:** natural planner shortfall
   followed by eligible rescue; routing's agreeing-row inventory exception followed by selected
   jobs and aggregate; scheduled idle-probe dispatch followed by first-attempt server pickup and
   aggregate; untouched per-job overflow with identified controller source and actual movement.
   Delete only each proved sub-requirement in `docs/backlog/ci.md:339-347`; preserve other gaps.
   No new rescue/full-run drill or observation wait for cases that do not occur.
2. **Match code and placements.** #3514 is `9543152d2c2401fe530660251318432958614855`
   (13:55 CET); it changed planner discovery, not routing's callers or policy. Require its
   checked-out health module for the planner proof. For routing compare the relevant inventory/
   serverRoute code to the last qualified revision, retaining actual workflow/module identities.
   PR workflow identity comes from the run's referenced local reusable workflow commit and
   the checked local call, keeping source head separate. Retain `/attempts/N/jobs` for every
   inspected attempt: IDs, labels, runner ID/name/version, selected checks and final outcomes.
   Report `started_at - created_at` as creation-to-start, never assignment time; no start is
   established for an unassigned queued job even when its API started_at equals created_at.
   Distinguish route-time hosted choice, inline watchdog rescue and controller movement.
   Controller qualification requires its actual source/log receipt; unavailable identity stays open.
   Save route/capacity reason and inputs actually logged; idle/blind/retry paths need not log
   hosted comparison inputs. Preserve health/refusal evidence. No queue-time improvement claim.
3. **A935: concrete next experiment, at most 30 minutes.** The prior source trace is complete.
   Relevant guest tools at current Cloud `4fbb31cd6bca8ff6e9ed39812dd8ce0b89439314`
   are unchanged from inspected `6cfbabb374f8cc94dc02188f36f63824526ad9cb` (`git diff` on
   guest-exec.py, operations.py, session.py, host.py and runner-tools.sh is empty); do not repeat it.
   Write a proposal for one owned, pool-accounted disposable guest, actual runner version and
   action/source, short job timeout, successful-download control and a selective stalled archive
   request. Investigate guest-local archive-host resolution to a local listener as a candidate,
   not a verified mechanism: verify the actual archive host, TLS/request phase, control reachability
   and isolation in the proposal. Name listener cancellation/worker-exit evidence, independent
   guest-destroy safety stop, cleanup, exact files/size and shared effects. Return it to the watcher
   BEFORE building/running any mechanism or workflow. If unavailable, state the concrete missing
   capability and smallest alternative; no repeated source-only audit or residual-risk self-approval.
4. **Record/verify:** compact checked evidence in `docs/developers/ci-and-gates.md`; remove
   proved sub-requirements from `docs/backlog/ci.md`; change `docs/backlog.md` only to mirror
   proved scope. Keep other requirements unchanged. Raw logs/API records stay local. Real runs
   own placement and recovery; existing route/workflow suites own semantics, no new tests here.
   Any demonstrated fix needs separate watcher clearance, then focused failing test and minimal
   correction. Incident/5xx/checkout screening applies before any later performance claim.

**Size/budget:** one hour of active work, including the 30-minute A935 proposal; stop observing
at the hour and record missing proofs. Final docs about +20–40/−10–30 lines plus this page;
source/tests 0. No pool, variable, credential, controller, image or shared-network change;
no other-lane edits. A1027 stays blocked. Claude's simplicity findings and this partial scope
were settled by the watcher’s 14:15 clearance. The A935 experiment still needs separate clearance.
