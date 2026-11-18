# Choose the venue time zone from its country pack

**Finish line.** In Venue settings → Venue details, a manager can choose the venue's
time zone from the country pack, review the clock preview and save. Spain offers
`Europe/Madrid` and `Atlantic/Canary`. A direct attempt to save another zone gets
a field error. The source is A166 in [the setup backlog](../../backlog/setup.md)
and the Lane D queue's instruction to enforce the same list on save.

- [ ] **Read and save.** Add `timeZones: readonly string[]` beside `provinces`
  in `apps/server/src/venue-detail-types.ts` and `apps/dashboard/src/api/client.ts`.
  In `apps/server/src/venue-details.ts`, return the taxpayer country's pack list.
  Use `requireCountryTimeZone` for a genuine edit and map its own refusal to the
  existing `venue.detail_invalid` with `field: "timeZone"` and `reason: "time_zone"`.
  With no pack, use the existing geography lock and `country_unavailable` refusal.
  Use `classifySavedTimeZone` for the stored spelling and the expected snapshot
  in no-op and stale checks. Keep the existing history checks and the single
  transaction for a save. A saved off-list zone can stay while you edit other
  fields, or be replaced explicitly when the time zone is editable. Scope the
  list enforcement to the Venue details write. The clock preview calculates with
  the proposal it receives.
- [ ] **Choose in the dashboard.** Use the existing `wt-combobox` in
  `apps/dashboard/src/screens/venue-details-panel.ts`, with the picker pattern
  and zone names from `venue-zone-repair.ts`. A zone absent from the options can
  still appear as the current text without becoming a selectable option or
  choosing another zone on open. Keep the existing preview, acknowledgement and
  explicit Save. In `venue-details-form.ts`, compare the saved spelling as stored
  and normalize a proposed value separately. Update field wording in
  `apps/dashboard/src/i18n/strings.ts` and the shared `venue-details-fixture.ts`.
- [ ] **Test first.** In `venue-details-api.test.ts`, pin the GET options and a
  PATCH for `UTC` that returns the field error and leaves a bundled name edit
  unsaved. In `venue-details.test.ts`, keep the lock, revision and next-sale
  assertions using a permitted change, and cover an unavailable pack plus an
  explicit choice of Madrid when the stored spelling is padded. In
  `venue-details-panel.test.ts`, choose Canary through the dropdown, check the
  preview and saved patch, and verify an off-list initial value leaves Save
  quiet. Adapt the affected save-state, leave, accessibility and form tests to
  the new field. See the new assertions fail for the expected reasons before
  implementing. Run all changed test files, and inspect the panel in English
  and Spanish, in both themes and at phone and desktop widths.
- [ ] **Guide.** Add the dashboard steps with a shared section ID in
  `apps/server/src/guide/{en,es}/time-zone.md`, run the guide checks and remove
  A166 from `docs/backlog/setup.md` once the dropdown and save validation work.

**Expected size.** About 70–110 lines of product code, 130–230 lines of tests
and fixture edits, and a short guide update. One pull request.
