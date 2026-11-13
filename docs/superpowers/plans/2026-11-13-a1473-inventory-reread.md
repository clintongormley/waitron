# A1473: one fresh inventory reread

**Goal:** recover transient pagination inconsistency through one complete fresh enumeration; persistent uncertainty stays hosted.

**Authority:** Lane I `questions.md`, 13 November 05:29, quoted in the request:
> You are right: the partial page already reads as unknown and goes to GitHub, under the owner's unknown-goes-hosted policy. Keep that policy. Add one bounded fresh whole-inventory reread on a pagination mismatch: route to the server only if the complete fresh read justifies it, otherwise stay unknown and hosted. A failing transient-page test first. Then points 2 and 3 of my 05:25 note as written.

Claude reviewed the plan on 13 November (Lane I receipt `a1454-20261113/a1473-plan-review.md`). The watcher cleared the corrected plan at 05:43 in Lane I `questions.md`: “One” is per list; only an empty page or changed valid total earns the reread; duplicate/excess rows stay unknown and hosted. No owner approval of this design is recorded.

**Context:** supplied planner receipt `43360103809`, 03:39:12Z, reported unknown/hosted after an empty page following one of two entries, not unknown-as-zero; A1454 returned to twelve fixed slots. Separate Cloud operations: land publisher PR #1199, then announce one bounded new-release trial and compare a healthy comparable run; roll back only for admissible server room with no admission for five minutes, job failure or a guest killed for memory, not hosted queuing while genuinely full.

**Exact files:** production `scripts/ci-server-health.mjs`; tests `scripts/ci-hosted-route.test.mjs` and `scripts/ci-server-health.test.mjs`; prose `docs/developers/ci-and-gates.md`, `docs/backlog.md`, `docs/backlog/ci.md` (update existing A1473 text, retaining separate qualification work).

**Reuse and decision:** keep `inventory(request, path, key, limit, pageSize = 100)` and its `InventoryUnavailable` contract. Allow two enumerations per list read, so one routing decision can retry several different lists; restart at page 1 with no retained rows or total. Only an empty page before completion (including page 1), or a changed otherwise-valid total between pages, earns the reread. Deliberately keep duplicates/excess rows as refusals, pending watcher confirmation. Malformed data/counts, foreign identities, HTTP errors and safety refusals also do not retry. Validate each new page’s total and rows before classifying a changed valid total. Exhaustion throws the second pass’s own error with existing wording; partial counts never escape. Preserve page sizes, the unrestricted-read 1000 bound and completed-history limit 100. Leave `readInventory` uncertainty handling and `githubRequest` GET-5xx retry/JSON/write behavior intact.

**Consumer trace:** direct inventory reads serve health and hosted run lists and `completedServerTraffic`; `runJobs`/`serverJobs` serve health, previous-attempt evidence, hosted counts and recovery eligibility. These feed `serverRoute`, `recoverServer`, `needsServerProbe` and route/check/recover/recover-planners/probe commands. Keep every identity, assignment, PR-head, age and mutation guard. Reuse existing fixtures, request overrides, call capture and `replyJobs`; sibling support needs no new helper.

**One task, inline TDD:**

- [ ] RED first in `ci-hosted-route.test.mjs`: transient empty page after one of two entries, then fresh page 1 with different rows/total. Parameterise empty later page and changed valid total. Assert pages `1,2,1`, placement from fresh evidence, no stale-row influence and no writes. Add a two-enumeration ceiling assertion to the existing persistent-mismatch case; retain existing unknown/hosted and BLIND assertions.
- [ ] In `ci-server-health.test.mjs`, extend final-inventory coverage: transient empty later page followed by a complete read exposing an assigned sibling permits no cancel/rerun. Keep existing command, planner, history, duplicate/foreign and HTTP/JSON/permission cases. Extend existing duplicate and malformed-later-total cases with read counts to show they do not earn a retry; do not duplicate the other refusal matrices.
- [ ] Run `pnpm exec vitest run scripts/ci-hosted-route.test.mjs scripts/ci-server-health.test.mjs`; observe expected behavioral failures before changing production. Implement the bounded restart only inside `inventory`, then rerun for GREEN with actual test counts.
- [ ] Update named prose with the per-list restart and possible extra reads, retaining the existing route-step time limit; run `pnpm exec vitest run scripts/ci-server-first.test.mjs` for workflow consumers. Broad checks belong to CI; driver handles finish-branch review, normal hooks and current-head CI.

**Size/exclusions:** estimate 20–40 production and 30–70 test lines changed, plus brief prose; no test quota, workflow edit, persistent state, routing variable, sleep/backoff, live mutation, controller rewrite, reverse movement or Cloud implementation.

**Finish:** fresh complete evidence determines placement; persistent mismatch remains unknown/hosted and recovery/probe safety assertions hold. This author only writes the plan; driver owns review, clearance and execution. Synthetic tests do not qualify live routing or authorise another memory trial.
