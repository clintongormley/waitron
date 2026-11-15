# Edit user language implementation plan

Drafted by separate Sol-high for **EDIT-USER-LANGUAGE**, queued in `/Users/clintongormley/waitron-campaign-d/queue.md` (watcher, 2026-11-15 17:30). **Claude approach review and watcher clearance pending.** The driver owns implementation. Target: one PR, under three hours.

1. **Extend the existing read/write contract.** In `packages/identity/src/staff.ts`, add saved `locale: string | null` to `PersonSummary`/`listPersons` and `updatePersonDetails`. Validate non-null input with `assertSupportedLocale`; include it in the existing update. In `apps/server/src/management-api.ts`, parse null or string and forward through the existing PUT transaction. Preserve permission checks, email/status fresh-sign-in requirements and transaction boundaries. Trace callers and fixtures before changing types.

2. **Add the chooser to Edit user.** Extend `PersonSummary` and `PersonEditDetails` in `apps/dashboard/src/api/client.ts`; retain `savePerson` and `apps/dashboard/src/screens/staff-screen.ts`’s existing forwarding. In `apps/dashboard/src/widgets/person-edit.ts`, reuse `api.getLocales()` and Your profile’s required `wt-combobox`, `name="locale"` and `t("profile.language")`. Display `venueDefault` for null, retaining raw null on unrelated saves and when a changed choice is returned to that displayed default. Opening or saving a name must preserve the stored preference. Include locale in `FIELDS`, loading, validation, submission, `FormFeedback` refusal mapping and `draftScopeFor`. Map `locale.unsupported` locally to this field; keep choice-loading/refusal recovery in the form and leave Add user unchanged.

3. **Implement with focused TDD.** For each layer, add assertions, run them and observe the expected failure, implement minimally, then rerun:
   - `packages/identity/src/staff-lifecycle.test.ts` and `person-locale.test.ts`: roster preference, supported update, null preservation, unsupported refusal with no partial write.
   - `apps/server/src/management-api.accounts-and-receipt-config.test.ts`: GET/PUT round trip, malformed input and atomic refusal; retain `management-api.staff-rule2.test.ts` permission assertions.
   - Dashboard `api/client.test.ts`, `screens/staff-screen.test.ts`, and `widgets/person-edit.test.ts`, `person-edit.save-state.test.ts`, `person-edit.unsaved.test.ts`, `person-edit.a11y.test.ts`: forwarding, choices/fallback, locale-only save/revert, inline errors, discard protection and accessible labeling in both themes. Reuse existing fixtures.

4. **Document and finish.** Update `apps/server/src/guide/{en,es}/staff.md`; delete the completed `docs/backlog.md` entry. Session resolution reads the saved locale; the shell applies it during existing session probes, including visibility return. Promise no immediate cross-browser switch. Run focused checks, inspect phone/theme rendering, then the normal finish-branch review and current-head CI.

**Forecast:** production code +70–110/−5–15 lines; tests +100–160/−10–25. No schema, endpoint, Add-user, authentication or compatibility work. Preserve TABLE-PAGING during later rebases.
