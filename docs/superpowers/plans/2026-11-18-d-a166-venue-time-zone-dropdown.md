# Choose the venue time zone from its country pack

**Finish line.** In Venue settings → Venue details, a manager can choose a time
zone from the country pack, review the clock preview and save. Spain offers
`Europe/Madrid` and `Atlantic/Canary`. A direct attempt to save another zone gets
a field error. The owner asked for the dropdown in A166 on 1 October 2026. The
watcher's Lane D queue entry (18 November 2026, 02:15) directs the save check too.
The watcher cleared the plan at 02:29 after Claude’s read, with the changes
recorded below.

The owner’s A166 request, previously recorded in `docs/backlog/setup.md`, was
“in fact this should be chosen from a dropdown, and the options specified in
the country package, eg Spain has two time zones, one for mainland and one for las canarias”.

- [ ] **Read and save.** Add `timeZones: readonly string[]` beside `provinces`
  in `apps/server/src/venue-detail-types.ts` and `apps/dashboard/src/api/client.ts`.
  In `apps/server/src/venue-details.ts`, return the taxpayer country's pack list
  or an empty list. At the existing input check, before stale and history
  checks, use `requireCountryTimeZone`. Translate only its
  `venue.time_zone_invalid` AppError into `venue.detail_invalid` with
  `field: "timeZone", reason: "time_zone"`. Save in the existing transaction.
  Apply the country check to new values in the Venue details write.
- [ ] **Compare and choose.** In the writer and dashboard's
  `venue-details-form.ts`, exact equality comes first. Classify the saved
  spelling as stored, including the expected snapshot in the writer, and
  normalize the proposed spelling separately. A padded saved value stays
  visible and quiet until explicitly replaced. In `venue-details-panel.ts`,
  reuse the labelled `wt-combobox` from zone repair with pack order and automatic
  search. Show an equivalent valid alias as its listed option and an off-list
  saved value as a disabled current option. Keep the existing preview and
  explicit Save flow. Add optional zone names to `CountryPack` in
  `packages/country/src/country.ts` and supply English and Spanish names in
  `packages/country-es/src/spain.ts`. Use the dashboard language for labels
  and keep the zone identifier visible. Update `i18n/strings.ts` in both
  languages. Venue details still locks the zone once the venue has traded.
- [ ] **Test first.** In `venue-details-api.test.ts`, assert the GET list and a
  PATCH for `UTC` that refuses both the zone and a bundled name edit. In
  `venue-details.test.ts`, exercise explicit replacement of padded Madrid and
  an exact padded no-op bundled with a name edit. Use legal Canary changes
  in the existing lock, revision, concurrency and consumer tests. Move the
  station/booking and workforce instants where needed to preserve the
  business-day boundary. Keep the lock and downstream assertions in
  `business-day-start.test.ts`, `boot.venue-details.test.ts`, `print-api.test.ts`
  and `backup-sweep.test.ts` with eligible inputs. Keep the saved `US/Eastern`
  alias test unchanged. Turn the signed `Etc/GMT+2` edit into a country-list
  refusal and retain the signed-zone clock preview test. Use the shared dashboard
  `venue-details-fixture.ts`. In `venue-details-panel.test.ts`, choose Canary
  through the dropdown, verify the preview and saved patch, and check that an
  off-list initial value keeps Save quiet. Adapt affected save-state, leave,
  accessibility and form tests. Observe the new assertions fail, then pass.
  Run the changed suites and inspect English and Spanish in both themes at
  phone and desktop widths.
- [ ] **Guide and backlog.** Add the dashboard steps with a shared section ID
  in `apps/server/src/guide/{en,es}/time-zone.md` and run the guide checks.
  Remove A166 from `docs/backlog/setup.md` and its open-status reference from
  `docs/backlog/fiscal.md`. Link the historical A696 design to this plan.

**Expected size.** About 70–110 lines of product code, 160–260 lines of tests
and fixture edits, and short guide and backlog edits. One pull request.
