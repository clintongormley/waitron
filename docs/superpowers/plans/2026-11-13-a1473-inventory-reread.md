# A1473: one fresh inventory reread

**Goal:** recover transient pagination inconsistency through one complete fresh enumeration; persistent uncertainty stays hosted.

**Authority:** Lane I `questions.md`, 13 November 05:29, quoted in the request:
> You are right: the partial page already reads as unknown and goes to GitHub, under the owner's unknown-goes-hosted policy. Keep that policy. Add one bounded fresh whole-inventory reread on a pagination mismatch: route to the server only if the complete fresh read justifies it, otherwise stay unknown and hosted. A failing transient-page test first. Then points 2 and 3 of my 05:25 note as written.

The watcher cleared this behavior, not an owner-approved design; building waits for Claude plan review and watcher plan clearance, handled by the driver.

**Context:** supplied planner receipt `43360103809`, 03:39:12Z, reported unknown/hosted after an empty page following one of two entries, not unknown-as-zero; A1454 returned to twelve fixed slots. Separate Cloud operations: land publisher PR #1199, then announce one bounded new-release trial and compare a healthy comparable run; roll back only for admissible server room with no admission for five minutes, job failure or a guest killed for memory, not hosted queuing while genuinely full.

**Exact files:** production `scripts/ci-server-health.mjs`; tests `scripts/ci-hosted-route.test.mjs` and `scripts/ci-server-health.test.mjs`; prose `docs/developers/ci-and-gates.md`, `docs/backlog.md`, `docs/backlog/ci.md` (update existing A1473 text, retaining separate qualification work).

**Reuse and decision:** keep `inventory(request, path, key, limit, pageSize = 100)` and its `InventoryUnavailable` contract. Allow two enumerations per call: restart at page 1 with no retained rows or total. Only an empty page before completion (including page 1), or a changed otherwise-valid total between pages, earns the reread. Malformed data/counts, duplicates, excess rows, foreign identities, HTTP errors and safety refusals do not. Validate non-retryable conditions before granting a reread. Exhaustion throws; partial counts never escape. Preserve page sizes, the unrestricted-read 1000 bound and completed-history limit 100. Leave `readInventory` uncertainty handling and `githubRequest` GET-5xx retry/JSON/write behavior intact.

**Consumer trace:** direct inventory reads serve health and hosted run lists and `completedServerTraffic`; `runJobs`/`serverJobs` serve health, previous-attempt evidence, hosted counts and recovery eligibility. These feed `serverRoute`, `recoverServer`, `needsServerProbe` and route/check/recover/recover-planners/probe commands. Keep every identity, assignment, PR-head, age and mutation guard. Reuse existing fixtures, request overrides, call capture and `replyJobs`; sibling support needs no new helper.

**One task, inline TDD:**

- [ ] RED first in `ci-hosted-route.test.mjs`: transient empty page after one of two entries, then fresh page 1 with different rows/total. Assert pages `1,2,1`, placement from fresh evidence, no stale-row influence, no BLIND marker and no writes. Extend to changed totals and health/hosted paths; exercise fresh server and hosted outcomes. Persistent mismatch stays hosted, with one BLIND marker and no third enumeration.
- [ ] In `ci-server-health.test.mjs`, extend final-inventory coverage: transient empty later page followed by a complete read exposing an assigned sibling permits no cancel/rerun. Preserve persistent-mismatch no-write command assertions, extending to check/recover-planners; retain planner interrupted-pass reporting, duplicate/foreign refusals, history bounds and HTTP/JSON/permission behavior. Strengthen request counts for non-retryable faults.
- [ ] Run `pnpm exec vitest run scripts/ci-hosted-route.test.mjs scripts/ci-server-health.test.mjs`; observe expected behavioral failures before changing production. Implement the bounded restart only inside `inventory`, then rerun for GREEN with actual test counts.
- [ ] Update named prose; run `pnpm exec vitest run scripts/ci-server-first.test.mjs` for workflow consumers. Broad checks belong to CI; driver handles finish-branch review, normal hooks and current-head CI.

**Size/exclusions:** estimate 20–40 production and 30–70 test lines changed, plus brief prose; no test quota, workflow edit, persistent state, routing variable, sleep/backoff, live mutation, controller rewrite, reverse movement or Cloud implementation.

**Finish:** fresh complete evidence determines placement; persistent mismatch remains unknown/hosted and recovery/probe safety assertions hold. This author only writes the plan; driver owns review, clearance and execution. Synthetic tests do not qualify live routing or authorise another memory trial.
