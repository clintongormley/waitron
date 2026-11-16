# A700: Calendar views after an Opening hours read failure

Source: `/Users/clintongormley/waitron-campaign-d/queue.md`, watcher feed 2026-11-16 19:20, A700-CALENDAR-VIEWS.

Smallest usable result: Staffing/Rota render when the hours read fails; only Hours shows its existing announced error.

Claude reviews this plan, then the watcher clears inline implementation with TDD; no owner plan approval.

- [ ] In `packages/venue-service/src/dashboard/opening-hours-screen.test.ts`, reuse module fixtures (:2270–2360), `mountCalendar` with an optional failing hours request, and the contribution callback’s stub-view sentinel. Add exactly two tests: failed initial hours read at a Staffing address renders the chosen contribution without the hours error; switching to Hours still shows the error with `role=alert`. Observe the first fail before implementation; preserve existing assertions.
- [ ] In `packages/venue-service/src/dashboard/opening-hours-screen.ts`, move selected `moduleContent()` before the `!model` gate in `render` (:1576); suppress only the main hours `readError` while a module is selected. Reuse `calendar.ctx` (:473), heading and painter templates; preserve history/URL logic.
- [ ] Run the full changed test file only, expecting all tests to pass. Inspect both languages/themes at phone/desktop sizes. Keep translated messages unchanged.
- [ ] Delete A700 from `docs/backlog/workforce.md` and `docs/backlog.md`. No guide edit: existing instructions remain true.

Exclude A712, A699/A711, A703, other address changes, frameworks and cleanup. One PR.

Forecast: production +5/−5; tests +25/−2; docs +15/−8; approximately 60 changed lines. Seek outside opinion above 1.5× forecast.
