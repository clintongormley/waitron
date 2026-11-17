# Restore integrity test: check offloading without a timer race

**Status:** Proposed by Codex. Claude review and watcher clearance pending. The owner authorizes the queue item; no owner approval of this design is claimed. Execute inline with TDD after clearance.

**Ask:** RESTORE-TICKS-FLAKE in Lane I's queue: diagnose the twice-failing restore timer test on Linux under load, fix the cause, show a test-only repair still fails with main-thread checking, explain #3508, and delete the two backlog paragraphs. The exact item and measured traces are in `~/waitron-campaign-i/receipts/restore-ticks-flake-20261117/{item,diagnosis}.md`.

**Finish line:** One test-only PR that checks the real restore integrity entry point still works when SQLite statement preparation is refused on the main thread, with its main-thread mutation failing and current-head CI passing. Existing damaged-copy checks remain unchanged.

**Measured cause and limit:** With the original 15,000-row fixture, all ten deliberately paused native Linux samples returned intact with zero timer callbacks; all ten unpaused controls ticked, including five of each under four busy workers. Every main-thread preflight exceeded 10 ms. An I/O callback held the main thread until the real SQLite worker finished, then another 50 ms: queued worker completion could run before the overdue interval and clear it. This disproves the test's timing premise; it does not prove why either historical CI run paused. Uninjected probes passed. #3508 added the deadline wrapper and forwarding call, leaving `isCopyIntact` and its SQLite worker source unchanged (`git show dbc1a721bc -- apps/server/src/handover-integrity.ts apps/server/src/restore-stream.ts`); the current wrapper also reproduces zero ticks under the injected pause.

**Files and existing code:**

- `apps/server/src/restore-stream.test.ts`: replace only the large-file/timer case, reusing `fixtureDb`, `fresh` and `copyFile` like its healthy-copy neighbour. A scoped `vi.spyOn(DatabaseSync.prototype, "prepare")` throws a distinct marker while real `checkIntegrity(file)` must answer `true`; restore it in `finally`. Worker SQLite has its own prototype. No worker or check-function mock.
- `docs/backlog/ci.md`: remove the two restore paragraphs and only their portion of the shared incident row. Preserve every other incident. `docs/backlog.md`: narrow the existing incident-index wording to the remaining sightings, as the queue requires an index update.
- This plan. Read/run, but do not edit, `apps/server/src/handover-integrity.test.ts`: its existing `setImmediate`/`turned === true` case owns the event-loop yield check.

**Implementation and proof:**

- [ ] Retain the Linux loaded/unloaded reproduction and the historical uncertainty in the PR. Prove the temporary preparation refusal works with one local SQLite call; keep that control outside committed tests.
- [ ] In an installed disposable checkout, replace the worker call with equivalent read-only main-thread integrity/foreign-key checks. Run the proposed case and require an assertion failure from refused preparation, not a setup error; restore worker code and require green. No mutation enters the feature checkout or PR.
- [ ] Run the changed file and the unchanged integrity suite: `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts src/handover-integrity.test.ts`. Record test counts and results. Preserve every other assertion, including damaged files and missing parents.
- [ ] Remove settled backlog text. Run `finish-branch`, the normal push hook, selected current-head CI and `land-branch` under the existing campaign rules.

**Excluded:** Production changes, Lane L's read-only-open work, other test edits, worker gates, new helpers, fixture-size thresholds, timer changes, retries and CI changes. A production finding returns to the watcher before editing.

**Expected physical additions + deletions:** production 0; tests 50–65; docs 55–80; total 105–145. Reproduction scripts remain in local receipts. Ask the watcher before growth beyond 217 changed lines.
