# A1470: hosted fallback for blind new-run routing

**PLAN FOR APPROVAL. No build authorised.** Lane I `questions.md`, watcher 2026-11-10 06:00: “After A1463's PR is open, write a short plan (no build) for the smallest change that stops it”. The 06:10/06:16 instructions retain unqualified timing and put this plan before D-Bus diagnosis. A1463 Cloud PR #1131 is open. Requests are transcribed in receipt `author-brief.txt`; driver holds originals under RUNNER’s private-approval exception.

**Outcome and evidence.** Stop adding new runs to the server solely because routing inputs cannot be verified. In `~/waitron-campaign-i/receipts/a1470-routing-plan-20261110/`, `routing-reasons.json` and the three `*-changes.log` files identify:

| Run | Actual server-choice reason |
| --- | --- |
| 42757661018 | “CI routing inputs could not be verified; using the server: Incomplete server inventory: empty page after 2 of 3 entries” |
| 42756873587 | “CI inventory could not be verified; using the server: Incomplete server inventory” |
| 42756936892 | “CI inventory could not be verified; using the server: Incomplete server inventory: empty page after 5 of 6 entries” |

Each emits `CI_ROUTE_BLIND`. D's published snapshot has server 3 running/85 queued/6 slots. Those snapshots also show hosted queues; they do not establish hosted room at decision time. The 06:00 watcher observation is later: server 108 waiting, GitHub 2 running/0 waiting.

**Smallest supported choice.** Weighting misses these exits. Published hosted counts only in fallback would add a second comparison on currently unvalidated snapshot fields, still needing a default when capacity/module is missing; normal routing could stay unchanged. Change only blind fallback to hosted. Degraded API reads can send new runs to hosted and leave our server idle; BLIND will count hosted choices. Balanced queues are not guaranteed. Approval must explicitly replace the watcher’s 2026-11-09 10:34/10:47 server-on-uncertainty policy, retained by the 17:19 plan. Keep normal readable ratios/server ties.

**Ownership and exact files** (source baseline `dc798de2eb`; driver’s `routing-source-digests.json` records matching module bytes across all three receipt heads):

- `scripts/ci-server-health.mjs`: `serverRoute` handles uncertain health inventories; `healthCommand("route")` handles exceptions, including missing/malformed capacity and failed/partial/foreign API inventories. Both choose hosted, retaining existing reasons and one BLIND marker. Shared misleading inventory wording stays outside this policy change.
- `.github/workflows/ci.yml`: failed workflow-SHA module download chooses hosted after existing retry. Keep timeout/empty-output hosted fallback. Consumers require `server_route == 'server'`; preserve mode, HEAD, fork/trust and exact hosted-attempt gates. Server mode remains eligibility for comparison. Keep explicit probe routing, watchdog gating, hosted exceptions and image input/default unchanged.
- Tests: `scripts/ci-hosted-route.test.mjs`, `scripts/ci-server-health.test.mjs`, `scripts/ci-server-first.test.mjs`.
- Prose: `docs/developers/ci-and-gates.md:183`, `:203–204`, `:237–239`, `docs/backlog.md`, `docs/backlog/ci.md`; add a dated replacement pointer to historical `docs/superpowers/plans/2026-11-09-a1440-queue-wait-routing.md`.

Provisional lines added/removed: code **4/4**; workflow **2/2**; tests **25/25**; prose **16/12**; generated **0/0**. No new helper.

**Implementation after approval, inline:**

1. Change existing fallback expectations to hosted and rename their server-choice cases. Add only the hosted-scan “empty page” row in `ci-hosted-route.test.mjs:430`’s table. Run the focused command below before implementation. First observed failures against old server fallbacks are the named negative control. Preserve existing trust/recovery/no-write assertions without rewriting their scope.
2. Change the three exits minimally. Preserve readable-stall/retry evidence, retries and operator/trust gates. The strict inventory reader remains shared with recovery cancellation checks: do not loosen it or expand pagination for new-run selection. Change no recovery/probe/controller behavior; move no running work.
3. Rerun `pnpm exec vitest run scripts/{ci-hosted-route,ci-server-health,ci-server-first,ci-workflow}.test.mjs` and `actionlint .github/workflows/ci.yml`; require actual passing counts. Update prose, then normal finish-branch checks and current-head CI.

Exclude timing weights, duration estimators, history, new state/protocol/deadline, reservations, approval machinery and Cloud changes. A1463 timings remain **unqualified** because of slow checkouts and uncontrolled host cache; use neither weights nor savings claims.

**Finish line.** Claude source read is complete; driver submits corrected PLAN FOR APPROVAL. Build approval remains absent. After approved delivery, retain the first natural blind decision's workflow/source SHA, run/attempt, reason/BLIND line, output and actual hosted runner labels/results. No natural blind decision means live fallback remains unverified; do not manufacture one or claim queue savings.

**Build clearance, 2026-11-10 15:40.** The owner chose “Unsure → GitHub (Recommended)” in `~/waitron-campaign-shared/desk/done/20261110-0946-I-a1470-ci-routing.md`. The watcher cleared this corrected plan (54ff4538e0) in Lane I `questions.md`, WATCHER 15:40 A1470. Claude reviewed the approach in 197 seconds; all five findings were incorporated. This dated clearance supersedes the pending status above.
