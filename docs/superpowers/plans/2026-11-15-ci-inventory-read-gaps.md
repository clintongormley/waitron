# INVENTORY-READ-GAPS implementation plan

**Request:** Watcher, 2026-11-15 14:04, recorded in Lane I's queue.md and questions.md: “5 of 29 runs since 12:30 fell back to GitHub because the capacity inventory read was incomplete ("empty page after 2 of 3 entries"), sometimes while our server had room. Name the failing endpoint from existing evidence, fix that read (retry inside the existing time budget, or read the pages correctly) with a test reproducing the empty page. No routing-rule change. One-page plan first.”

**Reviewed and cleared:** Claude reviewed the original plan and its sole corrections read (187 and 176 seconds; Lane I receipts/inventory-read-gaps-20261115/plan-review.md and timed/plan-fixes-review.md). Neither delayed retry proposal was cleared or built. Watcher 15:10 replaced those proposals and explicitly directed “No further plan read: build it.” No owner design approval is recorded. After both built reviewers questioned A1470's scope, the watcher reaffirmed the rule at 15:55, including its limitation that both reads could miss the same run, and said the owner had been told.

> Rule instead: read once; if rows fall short of the count, read again at once; if both reads list the same rows, use those rows as the inventory and log the stale count (run ids, rows, count) instead of falling back blind; if the two reads differ, keep today's fallback. Test: equal rows with a higher count are used and logged; differing rows still fall back. No added waits, one list only, every other reader unchanged.

**Evidence:** The unchanged reader reproduced queued CI-workflow rows 4/5 followed by an empty page, twice, on `/repos/clintongormley/waitron/actions/workflows/ci.yml/runs?status=queued` at 13:27:50–52 UTC. It chose hosted/blind with supplied idle capacity. Three later GET-only captures over 506.3 seconds returned rows/total at about 0/1/3/10 seconds: 5/6,5/6,5/6,5/5; 4/5,4/5,4/4,3/3; 2/3,2/2,2/2,2/3. Count agreement came from falling counts, not late rows. Raw traces and driver measurement are in Lane I's receipts/inventory-read-gaps-20261115/timed/. These identify this endpoint's failure, not each historical log's omitted URL or GitHub's internal cause.

## Smallest result and implementation

Routing can use agreeing queued CI-workflow row sets ending on empty pages, logging IDs, row count, starting counts and the date cutoff. Two agreeing snapshots cannot prove that GitHub omitted no row; live qualification remains open.

- Reuse `inventory`, its existing immediate whole-list restart, and the `serverHealth` call in `serverRoute`, in scripts/ci-server-health.mjs. Add an optional private stable-short-read context to the reader, enabled only by an optional third `serverHealth` argument from routing and only for status=queued. Keep request as inventory's first argument.
- On an empty page before the total, retain the first enumeration's rows/count only for that context. The existing restart runs immediately. If the second also ends short and both row sets agree by complete values (order-independent), report the stale counts and return the second set. Different rows still refuse. A complete second read continues to replace the first. Built-review correction: retain the first rows if its empty page changes the count, too; a changing count within the second read remains a refusal. Log both starting counts and the request's date cutoff.
- Keep two enumerations maximum, duplicate/excess/malformed guards, foreign-job validation, all other lists and standalone check/recover/recover-planners/probe readers unchanged. No waits, workflow, credentials, routing ratio, public options key, deadline, record or framework.
- Wire the diagnostic to the route command's existing report callback; no separate output or blind marker for an accepted short list.

## Tests and documentation

1. Root scripts/ci-hosted-route.test.mjs owns the new behavior: reproduce two empty second pages with inflated counts and equal rows, including reordered rows; require normal routing and IDs/row/count diagnostics. Changed IDs or changed values still require hosted/blind. Observe failure before implementation.
2. Update existing queued-list assertions only where the watcher's new rule deliberately changes them; retain the same refusal assertions using differing-row fixtures where appropriate. Record every changed check in the PR. Existing job, hosted-list and recovery tests keep their strict assertions.
3. Run `pnpm exec vitest run scripts/ci-hosted-route.test.mjs scripts/ci-server-health.test.mjs scripts/ci-server-first.test.mjs`. In a disposable candidate remove acceptance, row comparison and diagnostic independently and observe the corresponding failures. No package-wide local run.
4. Amend only current routing clauses in docs/developers/ci-and-gates.md and the existing routing bundle in docs/backlog/ci.md and docs/backlog.md. Keep broader qualification open, requiring a natural choosing log at the actual workflow candidate before claiming live benefit.
5. Use authorised finish-branch and land-branch; preserve other lanes, routing markers and global settings. Claude reviews built work separately from the plan.

**Expected size:** production +35/−12; tests +85/−8; current docs +12/−5; plan under 40 lines. The prior wait proposal is superseded, not implemented. Finish line is the bounded reader behavior and its diagnostic, with natural live qualification reported separately.
