# Wait for Your profile to close before checking the retained draft

The watcher requested this on 14 November 2026 at 10:46 in Lane D’s questions.md:
“find the cause (a timing or ordering dependency in that test or the modal close path) and fix it at the root, test first. One small PR.”

**Finish line:** the existing device-profile draft test checks the completed close from Back and the close button, without mistaking Back’s intermediate address for completion. Staff behavior stays as it is.

**Cause measured:** holding the navigation guard’s first `history.go(1)` for 200 ms reproduces CI’s `expected true to be false`. At the old pathname poll’s completion, location names the device profile, the guard still accepts `/manage/profile`, and the modal is open. The same probe passes when that poll waits for the modal’s `open` to become false. Probe patches and red/green logs: Lane D `receipts/profile-back-close/held-restore*`. This establishes the timing mechanism; the original CI run had no guard-stage trace.

**Reuse and scope:** keep the existing parameterized test, real navigation guard, shell, device editor, and its assertions on the retained name, destination and absent unsaved-changes question. Replace its pathname poll with a poll for the modal to close. Remove the later duplicate synchronous open assertion. No new helper, test case, product code, timeout or production navigation change. The hold stays a disposable diagnostic, not shipped test plumbing.

**Files:** `apps/dashboard/src/dashboard-app.test.ts`; add the measured lesson to `docs/developers/testing-guide.md`. No backlog entry names this incident, so no open work is retired.

- [ ] Replay the held-restoration red/green control and retain both outcomes; then remove the diagnostic hold.
- [ ] Change only the completion wait in the existing two-case test. Run `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts`, including both close paths and its neighboring Back/Forward cases. Run a bounded repeated sample of the named Back case with a separate log per attempt.
- [ ] Finish through the normal hook, Claude build review and current-head scoped CI; land under the campaign’s existing authorisation.

**Expected size:** production +0/−0; tests +1/−2; support +0/−0; documentation approximately 10–15 lines beyond this plan. This plan is written by Codex; no owner design approval is claimed.
