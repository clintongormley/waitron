# A949 reconciliation coverage implementation plan

Author: Codex Sol-high. Task requested by the watcher; no owner design approval is claimed.
Request recorded verbatim in Lane F `questions.md`, WATCHER 2026-11-14 14:57:
> Before anything else: add tests that exercise the uncovered functions through real behaviour (each with an assertion that fails if the function is deleted). No exclude, no ignore comment, no threshold change (CLAUDE.md §2). Run payments’ test:coverage locally, read the per-file table, open one small PR and land it once green.

Baseline reproduced at `6e88c96309`: `pnpm --filter @waitron/payments test:coverage` ran 1,010 passing tests but exited 1: functions 97.91% (235/240); `reconcile.ts` functions 83.87%. This matches full main run `43601629573`, `light-a` job `132467760160`.
Scope: only `packages/payments/src/reconcile.test.ts` and this plan; update the backlog only if made stale.
Expected size: 0 production lines, 60–120 added test lines, no new helper files.
Keep payment behaviour, coverage configuration and thresholds unchanged; no excludes, ignore comments, live requests or broad failure matrices.

1. Obtain campaign plan review and watcher clearance before implementation; this plan-writing task runs neither review nor implementation.
2. Read the external local baseline when it finishes, including the per-file table and uncovered functions in `reconcile.ts`; record its revision and command. If needed, rerun `pnpm --filter @waitron/payments test:coverage` after it finishes, without sharing an active report directory.
3. Reuse the real `useVenueDb` suite, `seedWorkingOrder`, `capture`, `setOrderStatus`, `deps`, `settlement`, `FakeSettlementReport`, recording reversal and incident helpers; exercise `reconcilePayments`, without mocking database operations.
4. Add the smallest `prepareOrphans` case covering real prepared rows inside and outside the period: assert each counts once, appears once as an orphan, is reported as claimed and reaches reversal.
5. In those cases, assert settlement mapping by reference rather than report position, including an unrelated report entry; check exact reported settled amounts. Do not fabricate a prepared row without provider evidence merely to cover a fallback branch.
6. Only if the baseline leaves it uncovered, add an unconfirmed reversal case: assert the exact `remediationUnconfirmed` references, zero successful remediations and no remediation failure result or incident.
7. Run `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts`; read the test count and preserve existing behavioural assertions.
8. Use a disposable checkout containing the candidate tests with dependencies installed for deletion controls. Disable each newly exercised production callback path separately; first observe the intended behavioural assertion fail, then restore it and observe the focused tests pass. Keep every control outside the feature checkout.
9. Run `pnpm --filter @waitron/payments test:coverage` locally; read the per-file table, verify the targeted functions execute and retain the results. If the narrow additions do not meet the bar, return the measured gap to the watcher before expanding scope.
10. Run `finish-branch` for its Claude review, fresh read of fixes, signed-off commit, normal push hook and one small PR. Wait for required CI on the current head; land through the campaign's authorised landing process once green.

Finish line: payments package coverage passes unchanged 98/98/98/95, and each added callback path assertion fails in an isolated deletion control.
