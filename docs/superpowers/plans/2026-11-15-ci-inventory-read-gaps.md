# INVENTORY-READ-GAPS implementation plan

**Request:** Watcher, 2026-11-15 14:04, recorded in `/Users/clintongormley/waitron-campaign-i/queue.md` and `questions.md`; this is not owner design approval.

> 5 of 29 runs since 12:30 fell back to GitHub because the capacity inventory read was incomplete ("empty page after 2 of 3 entries"), sometimes while our server had room. Name the failing endpoint from existing evidence, fix that read (retry inside the existing time budget, or read the pages correctly) with a test reproducing the empty page. No routing-rule change. One-page plan first.

**Goal:** Give an incomplete inventory one delayed, complete restart; report its failing path and page if it still refuses.

**Evidence supplied:** The lane’s `receipts/inventory-read-gaps-20261115/reader-reproduction.jsonl` records this request at 13:27:50.705Z:

`GET /repos/clintongormley/waitron/actions/workflows/ci.yml/runs?status=queued&per_page=100&page=1&created=%3E%3D2026-11-14T13%3A27%3A50.100Z`

It advertised five runs, returned four, then returned an empty page 2 with total five. An immediate complete restart stayed incomplete through 13:27:52.195Z; the following in-progress list included missing run `43718501717`. The real reader returned hosted/blind with supplied idle capacity. At 13:28:10 the endpoint returned 3/3. This identifies a reproduced endpoint, not each historical failure, GitHub’s internal cause or a guaranteed settling delay.

**Existing code:** `scripts/ci-server-health.mjs` already discards earlier rows and restarts once on an empty page or changed valid total. Reuse that reader, its imported `node:timers/promises` delay and existing `options.wait` seam. `docs/developers/ci-and-gates.md:235–256` describes the current contract.

## One bounded change, after clearance

- [ ] **Fail first:** Add a transient empty-page case to `scripts/ci-hosted-route.test.mjs` for the queued workflow endpoint above. Keep it incomplete until the wait seam is awaited, then return a complete inventory containing new rows. Assert server routing, pages `[1, 2, 1]`, one awaited `wait(1000)`, no rows mixed across reads and no writes. Run it and observe failure before changing implementation.
- [ ] Add a separate persistent missing-page case asserting hosted/blind and the refusal's endpoint and page 2. Observe its missing-diagnostic failure. Keep existing malformed, duplicate, excess, foreign-row and persistent two-enumeration assertions unchanged; reuse their refusal coverage rather than adding matrices.
- [ ] In `scripts/ci-server-health.mjs`, change internal `inventory`'s first argument from `request` to `options`, destructure `request` and `wait = delay`, and pass the relevant options at its four callers: `runJobs`, `serverHealth`, `serverRoute` (its wrapped `recent` options), and `completedServerTraffic`. Pass options through recursive restarts too.
- [ ] Await `wait(1000)` before the existing restart for either empty-page or changed-total drift. Keep exactly two enumerations at most per list, discard all first-read rows, and preserve count/duplicate/excess checks and their precedence, plus caller foreign-row checks. Add the failing request path and page to inventory refusal messages while retaining their reason text. Use direct options pass-through; no extra helper or export is needed.
- [ ] Update only this read behavior in `docs/developers/ci-and-gates.md`, the existing routing bundle in `docs/backlog/ci.md`, and its index line in `docs/backlog.md`. Describe a bounded opportunity to settle; leave live routing qualification open.

**Limits:** Keep the current two-minute workflow limit and routing/refusal policies. Separate lists may each wait once. No workflow, credential or routing-rule changes; no new helper, export, configuration, transport or independent deadline. Expected changes: code about +20/−10 lines; tests +55/−0; backlog documentation +10/−3, plus the short runbook update. Keep this plan within 55 lines.

## Verify and finish

- [ ] Run `pnpm exec vitest run --project root scripts/ci-hosted-route.test.mjs scripts/ci-server-health.test.mjs scripts/ci-server-first.test.mjs`; confirm reported test counts and passes. No package-wide run.
- [ ] In a disposable checkout, independently delete the awaited wait and the error-path addition; each new assertion must fail for its intended reason. Restore each control. These are later build checks, not actions authorised in this plan-only turn.
- [ ] Obtain Claude plan review and watcher clearance before any build; incorporate findings. Neither is owner approval.
- [ ] Once cleared, built and green, follow the lane runbook through `finish-branch` and, when authorised under that runbook, `land-branch`.
