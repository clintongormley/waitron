# A1400: an older copy must not undo a save

Implement inline with test-first changes, then the normal Claude run-it review and CI.

**Goal/spec:** A1400 (`docs/backlog/dashboard.md` at `ac5fa4f0fd`) asks that an old
venue copy cannot restore a saved department name or remove a saved service step, and
that a theme list crossing a save does not hide another manager's newer theme.

**Current evidence:** three new browser repros fail: Appearance omits the extra theme;
Department settings restores `Restaurant` over `Restaurant revised` and drops `Coffee`.
The two department repros inject raw copies directly. Move their same name/step/next-save
assertions into the real loader/request flow before implementation, where read start and
write completion are observable. Keep the existing behavioral assertions throughout.

**Architecture:** use the existing action-snapshot path rather than introducing stored
revisions. Return the existing venue-service model from the department save transaction;
publish that answered model before a crossing read can replace it. For Appearance, number
reads and applied answers and use the existing `readAfterSave` retry helper.

- [ ] **Department boundary.** In `packages/venue-service/src/routes.ts`, reuse one private
  `readModel(tx: Transaction): Promise<VenueServiceModel>` reader for the current GET and
  the settings PUT. The PUT retains its existing gate and writes, then reads in that same
  transaction and answers HTTP 200 with the model, including assigned step ids. Change
  `VenueServiceApi.saveDepartmentSettings` in `dashboard/client.ts` to return that model.
  Prove the returned names/step ids and unchanged refusals through the real route tests.
- [ ] **Department browser.** In `dashboard/department-settings.ts`, apply the answered
  step ids to the saved baseline without dropping edits made while waiting. Publish a
  bubbling `model-change` carrying `VenueServiceView` (retain the known floor-zone choices).
  `department-edit-dialog.ts` and `venue-departments-shell.ts` must adopt/forward it
  synchronously, before their existing close or refresh awaits. Reuse
  `venue-operations-loader.ts`'s existing action snapshot fence. Add real loader cases
  for an older live/one-off read before and after the write reply, a failed refresh,
  an added step followed by another save, and a genuinely later manager change.
  Grow every settings-write fixture's missing response; keep its existing assertions.
- [ ] **Appearance.** In `apps/dashboard/src/screens/appearance-screen.ts`, replace the
  write-count admission check with a sequence assigned when each read starts and when
  a change is applied. An older read or failure cannot replace a later answer. After
  applying a change, make a passive read through `readAfterSave`, cancelling its waits
  on disconnect. Add cases for the newer crossing list, an old answer after the fresh
  read, refresh failure/recovery, disconnect, and two changes while reads wait.
- [ ] **Verify and finish.** Observe each real-I/O regression fail before its fix, then
  run focused route/client/browser suites and unchanged fiscal write-path/inmutabilidad
  tests. Preserve useful existing checks when fixtures gain returned models; list any
  changed status/whole-shape checks in the PR. Remove both A1400 backlog points. Keep
  guides' existing words unless staff must act differently. Use the normal hook, the
  Claude run-it seat, current-head CI and the authorised landing lock/cleanup workflow.

No migration, new table, permission, fiscal writer or background duty is part of this change.
