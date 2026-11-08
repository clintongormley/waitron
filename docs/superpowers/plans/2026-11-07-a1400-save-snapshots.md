# A1400: an older copy must not undo a save

Implement inline with test-first changes, then the normal Claude run-it review and CI.
Claude read: 216 seconds. Watcher 2026-11-07 23:12 approved the bounded fix below.

**Goal/spec:** A1400 (`docs/backlog/dashboard.md` at `ac5fa4f0fd`) asks that an old
venue copy cannot restore a saved department name or remove a saved service step, and
that a theme list crossing a save does not hide another manager's newer theme.

**Current evidence:** three new browser repros fail: Appearance omits the extra theme;
Department settings restores `Restaurant` over `Restaurant revised` and drops `Coffee`.
The department repros inject raw copies directly. Move their assertions into real
loader/request tests before implementation: name `Restaurant revised`, steps
`["Set up", "Take order", "Dessert?", "Coffee"]`, and the next save retaining Coffee
with its returned id. The browser cases retain those original assertions through the real request flow.

**Architecture:** use the existing action-snapshot path rather than introducing stored
revisions. Return the existing venue-service model from the department save transaction;
publish that answered model before a crossing read can replace it. For Appearance, keep
its write counter and add a passive follow-up through the existing `readAfterSave` helper.

- [ ] **Department boundary.** In `packages/venue-service/src/routes.ts`, reuse one private
  `readModel(tx: Transaction): Promise<VenueServiceModel>` reader for the current GET and
  the settings PUT. The PUT retains its existing gate and writes, then reads in that same
  transaction and answers HTTP 200 with the model, including assigned step ids. Change
  `VenueServiceApi.saveDepartmentSettings` in `dashboard/client.ts` to return that model.
  Prove the returned names/step ids and unchanged refusals through the real route tests.
- [ ] **Department browser.** In `dashboard/department-settings.ts`, apply the answered
  step ids to the saved baseline without dropping edits made while waiting. Replace the
  held-model id workaround and reuse `willUpdate`/`followSteps` for that merge. Capture a
  stable publishing callback before the PUT, passed through `department-edit-dialog.ts`
  from `venue-departments-shell.ts`, so disconnect does not lose the answer. The shell
  synchronously adopts and emits `model-change` with `VenueServiceView` and its known
  floor-zone choices before close/refresh awaits. Reuse
  `venue-operations-loader.ts`'s existing action snapshot fence. Add real loader cases
  for an older live/one-off read before and after the write reply, a failed refresh,
  an added step followed by another save, disconnect while saving, and a manager read
  begun after the reply. Share the grown settings-response fixture through
  `src/testing/department-edit-fixture.ts`; keep its existing assertions.
- [ ] **Appearance.** In `apps/dashboard/src/screens/appearance-screen.ts`, the existing
  write-count admission check stays. After applying a change,
  make a passive read returning `Promise<boolean>` through `readAfterSave`. Its abort
  controller is renewed on connect and aborted on disconnect. Add cases for the newer crossing list, an old answer after the fresh
  read, refresh failure/recovery, disconnect, and two changes while reads wait.
- [ ] **Verify and finish.** Observe each real-I/O regression fail before its fix, then
  run focused route/client/browser suites and unchanged fiscal write-path/inmutabilidad
  tests. Preserve useful existing checks when fixtures gain returned models; list any
  changed status/whole-shape checks in the PR. Remove the finished A905 detail and both
  completed points; keep the named limit below in the existing A1400 backlog bundle. Keep
  guides' existing words unless staff must act differently. Use the normal hook, the
  Claude run-it seat, current-head CI and the authorised landing lock/cleanup workflow.

**Named limit (watcher 23:12):** a newer read after a PUT commits but before its reply can
be temporarily replaced if the follow-up fails. Record it in the PR and existing backlog;
this item adds no revision storage. The unchanged fiscal suites stay because the queue's
source-lane rule requires them for every item, despite the review's suggestion to drop them.

**Run-it correction (2026-11-07):** the completed Claude review reproduced an older
Appearance follow-up replacing a later live answer. Number reads in memory and keep the
newer answered read, retaining the approved write counter and retry helper. This is the
approved known-order requirement, without stored revisions. Its two weak waits are
strengthened by awaiting body consumption; a recovery control justifies suppressing the
old callback. The named commit-before-reply limit applies to both screens.
