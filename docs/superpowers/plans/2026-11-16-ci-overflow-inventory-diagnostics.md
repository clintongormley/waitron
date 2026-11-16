# CI overflow inventory diagnostics plan

**Status:** Codex draft; Claude review pending. Watcher cleared the diagnostic scope in Lane I `questions.md`, 2026-11-16 09:31; plan clearance remains pending under `RUNNER.md`. No owner design approval is claimed.

**Queue ask, verbatim** (`~/waitron-campaign-i/queue.md`, CI-OVERFLOW-INVENTORY):
> under ci-failure-rule.md: reproduce from the failed runs' logs (ci-run-story.sh on #3470's first attempt and on run 43818588507), fix at the cause, prove it with the case that failed. This is the natural evidence CI-ROUTING-QUALIFY waited for: record it there too. Write the one-page plan first; one PR.

**Cleared partial result:** “the small test-first change that makes the inventory refusal say the request path, page, read attempt, starting and reply totals and returned row ids; keep every completeness refusal and cancellation gate; no fallback, policy change or drill.” The watcher directs landing quickly, reading the next natural refusal, then writing the cause-fix plan the same day.

**Finish line:** the next refusal identifies which list and read failed, with enough count and ID context to guide reproduction. Diagnostics do not repair overflow; the cause-fix outcome stays open.

**Evidence and limits** (Lane I `receipts/ci-overflow-inventory-20261116/diagnosis.md` and routing-window logs):
- Server health `43823616837`, `recover-planners`, 07:24:53Z: “empty page after 1 of 2 entries”; health `43828425789`, `check`, 08:05:32Z: empty page after 3 of 4 entries, both on 16 November.
- #3470 run `43818588507`, attempt 1: `changes` had no runner. The per-run watchdog depends on `changes`, so it could not rescue that queued planner; the observed refusal came from independent Server health recovery.
- The retained failure logs contain neither the failed API path nor its reply. Three live read-only traces completed; they do not reproduce or explain either refusal. Actual cause remains unknown.

**Build only after Claude's read and watcher plan clearance:**
1. Reuse `inventory()` in `scripts/ci-server-health.mjs`, its single immediate whole-list restart and existing `InventoryUnavailable` errors. Append contextual suffixes to their original words; preserve every guard, return condition, cancellation gate and existing routing exception.
2. Include the exact request path with query/page, read 1 or 2, initial and reply totals, collected row count and returned row IDs, distinguishing collected IDs from the failing page's IDs. Add fields only when meaningful; read validated scalars safely so malformed payload diagnostics neither throw another error nor print raw payloads or secrets. No new records, framework, retries, success logging, fallback, policy change or drill. Do not touch `CLAUDE.md`.
3. Test first in `scripts/ci-server-health.test.mjs`: extend the existing incomplete-inventory/no-writes fixture, parameterised for workflow-run lists and current-attempt jobs lists. Assert the original refusal words plus exact path/page, second read, totals and IDs; record request calls so the restart and absence of writes are actually checked. Observe failure because context is missing before implementation.
4. Reuse existing malformed-count, duplicate, excess and changing-count cases where practical: assert useful available context and no secondary diagnostic error or payload/secret disclosure. Keep existing refusal and cancellation assertions; do not change guard expectations or add a speculative suite.
5. Update `docs/backlog.md` and `docs/backlog/ci.md` in the existing routing qualification bundle with the exact run/step/time/refusal evidence above and diagnostic scope. Keep the cause fix and remaining CI-ROUTING-QUALIFY requirements open; do not treat complete traces or richer errors as qualification of repaired overflow.

**Verification after clearance:** run focused root suites only: `pnpm exec vitest run scripts/ci-server-health.test.mjs scripts/ci-hosted-route.test.mjs scripts/ci-server-first.test.mjs`; read actual test counts. The health suite owns refusal context/no-writes, routing and server-first suites retain their existing policy/gate checks. Use the normal hook and current-head CI, with separate built-work review through `finish-branch`; one PR for this diagnostic slice.

**Next natural refusal:** retain its contextual log under `ci-failure-rule.md`, record it in the same qualification bundle, then write the cause-fix plan that day. Reproduce the captured failing case before fixing its cause; any repair needs its own Claude read and watcher clearance. No deliberate failure or rescue drill.

**Size forecast:** about 120 physical changed lines: source +20/−8, tests +30/−5, backlog docs +15/−2, plan about 30. At 180 changed lines, stop for the outside opinion required by `RUNNER.md`; this is not a ceiling.
