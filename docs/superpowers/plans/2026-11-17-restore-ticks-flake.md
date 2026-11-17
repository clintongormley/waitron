# Restore integrity test: check offloading without a timer race

**Status:** Proposed by Codex; Claude read it once (217 seconds), and the corrections below incorporate its findings. Watcher clearance pending. The owner authorizes the queue item; no owner approval of this design is claimed. Execute inline with TDD after clearance.

**Ask:** RESTORE-TICKS-FLAKE in Lane I's queue: diagnose the twice-failing restore timer test on Linux under load, fix the cause, show a test-only repair still fails with main-thread checking, explain #3508, and delete the two backlog paragraphs. The exact item and measured traces are in `~/waitron-campaign-i/receipts/restore-ticks-flake-20261117/{item,diagnosis}.md`.

**Finish line:** One test-only PR that checks the real restore integrity entry point still returns an intact result without SQLite statement preparation on the main thread, with its main-thread mutation failing and current-head CI passing. Existing damaged-copy checks remain unchanged.

**Measured cause and limit:** With the original 15,000-row fixture, all ten deliberately paused native Linux samples returned intact with zero timer callbacks; all ten unpaused controls ticked, including five of each under four busy workers. Every main-thread preflight exceeded 10 ms. An I/O callback held the main thread until the real SQLite worker finished, then another 50 ms: queued worker completion could run before the overdue interval and clear it. This disproves the test's timing premise; it does not prove why either historical CI run paused. Uninjected probes passed. #3508 added the deadline wrapper and forwarding call, leaving `isCopyIntact` and its SQLite worker source unchanged (`git show dbc1a721bc -- apps/server/src/handover-integrity.ts apps/server/src/restore-stream.ts`); the current wrapper also reproduces zero ticks under the injected pause.

**Files and existing code:**

- `apps/server/src/restore-stream.test.ts`: remove the flaky large-file/timer case and add its offloading check to the neighbouring healthy-copy case, retaining that case’s `true` assertion. Reuse `fixtureDb`, `fresh` and `copyFile`. After copying, record calls with `vi.spyOn(DatabaseSync.prototype, "prepare")` (no replacement implementation), await the real `checkIntegrity(file)`, and assert the spy was not called; restore it in `finally`. Worker SQLite has its own prototype. The case names preparation, not timer fairness; it does not cover constructors, thread startup or `createTagStore` SQL.
- `docs/backlog/ci.md`: remove the two restore paragraphs and only their portion of the shared incident row. Preserve every other incident. Rewrite the shared row’s second cell to “See detail” after removing its restore-only latest-sighting link. Leave the generic `docs/backlog.md` incident link unchanged: it names no restore incident; ask the watcher to clear this exception to the queue’s mandatory index edit.
- This plan. Read/run, but do not edit, `apps/server/src/handover-integrity.test.ts`: its existing `setImmediate`/`turned === true` case owns the event-loop yield check.

**Implementation and proof:**

- [ ] Retain the Linux loaded/unloaded injected reproduction and historical uncertainty in the PR. No separate spy/framework control is needed: the mutation must produce recorded main-thread calls.
- [ ] In an installed disposable checkout, mutate each boundary separately: `isCopyIntact` in `handover-integrity.ts`, then restore’s `checkIntegrity` in `restore-stream.ts` bypassing `checkCopyIntegrity`. Each mutation first awaits `setImmediate`, then performs the real read-only main-thread integrity/foreign-key queries with the existing false-on-damage handling. Require the new case to fail with recorded preparation calls while the existing `setImmediate` case still passes; restore and require green. These mutations prove the new guard adds coverage beyond yielding once. No production mutation enters the feature checkout or PR.
- [ ] Run the changed file and the unchanged integrity suite: `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts src/handover-integrity.test.ts`. Also check the new case against Lane L’s current integrity change in a disposable candidate before landing; preserve its live worktree. Record test counts and results. Preserve every other assertion, including damaged files and missing parents.
- [ ] Remove settled backlog text. Run `finish-branch`, the normal push hook, selected current-head CI and `land-branch` under the existing campaign rules.

**Excluded:** Production changes, Lane L's read-only-open work, other test edits beyond that healthy-case merge, worker gates, new helpers, fixture-size thresholds, timer changes, retries and CI changes. A production finding returns to the watcher before editing.

**Expected physical additions + deletions:** production 0; tests 50–65; docs 55–80; total 105–145. Reproduction scripts remain in local receipts. Ask the watcher before growth beyond 217 changed lines.
