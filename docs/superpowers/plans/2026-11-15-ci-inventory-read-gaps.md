# INVENTORY-READ-GAPS implementation plan

**Request:** Watcher, 2026-11-15 14:04, recorded in `/Users/clintongormley/waitron-campaign-i/queue.md` and `questions.md`; this is not owner design approval.

> 5 of 29 runs since 12:30 fell back to GitHub because the capacity inventory read was incomplete ("empty page after 2 of 3 entries"), sometimes while our server had room. Name the failing endpoint from existing evidence, fix that read (retry inside the existing time budget, or read the pages correctly) with a test reproducing the empty page. No routing-rule change. One-page plan first.

**Status: uncleared.** Claude’s first read (`receipts/inventory-read-gaps-20261115/plan-review.md`) rejected the original one-second proposal’s unmeasured benefit; that plan was never cleared. Watcher 14:40 required three timed short-page captures before repair and a revised one-page plan, not owner design approval. This revision goes through the sole remaining corrections read, then watcher decision; no build before watcher clearance.

**Measurement by the Codex driver:** `/Users/clintongormley/waitron-campaign-i/receipts/inventory-read-gaps-20261115/timed/report.md` records 506.3 seconds of natural GET-only traffic and three captures of `GET /repos/clintongormley/waitron/actions/workflows/ci.yml/runs?status=queued` with the same 24-hour cutoff. Recorded rows/total at approximate request-start offsets:

| Capture | 0 s | 1 s | 3 s | 10 s |
| --- | --- | --- | --- | --- |
| 1 | 5/6 | 5/6 | 5/6 | 5/5 |
| 2 | 4/5 | 4/5 | 4/4 | 3/3 |
| 3 | 2/3 | 2/2 | 2/2 | 2/3 |

Count-correction samples kept the same IDs; capture 3 regressed at 10 seconds and its page 2 was empty with total 3. No single fixed delay in {0,1,3,10} was complete in all three. Retrying near 3 seconds, then near 10 only if still incomplete, encounters a complete recorded answer in each: a trace-based counterfactual, not an executed repaired-reader success or guarantee. Outside the repo, `timed/live.jsonl` retains exact URLs, cutoff, start times, latencies, headers and IDs. Page reads add latency, so waits of 3 and 7 seconds do not reproduce the sampled request-start offsets exactly; live benefit remains to be qualified.
An all-status recent-list contrast returned 489/489 over five pages while queued returned 2/2. Both were complete: no discrimination, only extra read cost; no broad unfiltered scan is proposed or established as a fix.

## Smallest proposed change — requires watcher clearance

- Only routing’s queued CI-workflow inventory gets initial enumeration plus up to TWO complete fresh enumerations: await 3000 ms before the first restart and 7000 ms before the final restart, only while incomplete. This deliberately grows that one list from two to three enumerations and supersedes the previous single-restart decision only there, subject to watcher clearance.
- All other lists, job reads, hosted-count lists and standalone `check`/`recover`/`recover-planners`/`probe` retain exactly one immediate restart (two enumerations), with no waits. Strict `total_count`, duplicate/excess-before-drift guards, malformed/foreign checks, discarding every earlier enumeration’s rows and blind-hosted fallback after persistent failure stay; no cross-status reconciliation.
- In `scripts/ci-server-health.mjs`, use private `inventory(options, path, key, limit, pageSize = 100, remainingRetryWaits = [0])`; destructure `request` and `wait = delay`. On existing empty-page/valid-total drift restart paths, consume the next wait, await it only when nonzero, then recurse with `slice(1)`. Reuse imported `node:timers/promises` delay and `options.wait`; skipping `wait(0)` preserves recovery wait expectations.
- Exact four caller sites: `runJobs` (jobs), `serverHealth` (CI-workflow runs), `serverRoute` (hosted runs), `completedServerTraffic` (completed CI-workflow runs). Pass options at each; preserve wrapped `recent` options at the hosted read. `serverRoute` adds private `queuedWorkflowRetryWaits: [3000, 7000]` to existing `recent`; `serverHealth` passes that choice ONLY for its queued CI-workflow inventory; every other call uses `[0]`.
- Add endpoint/status and page to inventory refusal messages, retaining reason text. At most 10 seconds of added wait TOTAL per routing invocation: exactly one list, not `2+N+2+M` lists. HTTP/network work stays under the existing two-minute workflow deadline and its hosted fallback on expiry; no claim that all traffic finishes within 120 seconds.
- No ignored totals, routing-rule, credential or workflow changes; no new helper, export, public configuration, transport, deadline, persistent state or generic retry framework.

## Build and checks — only after clearance

- [ ] In root `scripts/ci-hosted-route.test.mjs`, add targeted queued CI-workflow transient fixtures named for first-3s recovery and final-10s recovery. Watch them fail before implementation. Shared fixture wait is a no-op (no real sleep); each new case uses an asynchronous wait whose completion gates fresh replies so removing `await` fails. Assert server routing, only fresh rows survive, exact waits `[3000]` / `[3000,7000]`, two / three enumerations and no writes.
- [ ] Add endpoint/status and page assertions beside the existing persistent `empty page after 1 of 2` assertion; observe the diagnostic failure, without a new diagnostic matrix. Explicitly change “uses hosted after two incomplete reads of the active run list” to THREE enumerations (including its unexpected-enumeration guard), only after watcher clearance; list this under **Changed test checks** in the PR. All other persistent two-enumeration assertions and unrelated checks remain.
- [ ] Implement the private pass-through and bounded retries above; rerun the failing cases to green. Preserve existing transient job-inventory fresh-row assertions, count/duplicate/excess/foreign refusals, recovery’s 24-wait expectations and `step timeout` assertions.
- [ ] Focused run: `pnpm exec vitest run --project root scripts/ci-hosted-route.test.mjs scripts/ci-server-health.test.mjs scripts/ci-server-first.test.mjs`; require reported test counts and passes. Root fixtures own behavioral proof; no package-wide run.
- [ ] In a disposable copy, independently remove the waited retry and the error endpoint; each critical control must fail for its intended reason, then restore it.
- [ ] Update minimal clauses in `docs/developers/ci-and-gates.md`, the existing routing bundle `docs/backlog/ci.md` and its `docs/backlog.md` index. Keep live qualification open: require a natural choosing log at the actual workflow candidate before claiming a live fix.
- [ ] After the remaining corrections read and watcher clearance, implement with TDD, then `finish-branch` / `land-branch` as authorised by the campaign runbook; no owner approval is claimed.

**Finish line:** Routing can retry this one short queued list and identify a refusal’s endpoint; reuse the existing reader, wait seam, delay import and root fixtures. Exclusions are above; the three named root files own focused checks, CI retains its existing checks, and live qualification stays open. Expected production +35/−12, tests +75/−4, current docs +12/−3; plan under 55 lines.
