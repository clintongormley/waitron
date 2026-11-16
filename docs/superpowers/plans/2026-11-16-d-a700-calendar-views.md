# A700: Calendar views after an Opening hours read failure

Source: Lane D queue, watcher feed 2026-11-16 19:20, A700-CALENDAR-VIEWS.

Smallest usable result: Staffing/Rota render when the hours read fails; only Hours shows its existing announced error.

Claude reviews this plan, then the watcher clears inline implementation with TDD; no owner plan approval.

- [x] In `packages/venue-service/src/dashboard/opening-hours-screen.test.ts`, reuse module fixtures (:2270–2360), `mountCalendar` with an optional failing hours request, and the contribution callback’s stub-view sentinel. Add exactly two tests: fail only the initial hours-model read at `/manage/opening-hours/view/staffing` (no month), fix the browser date, then assert `stubView`’s `data-test="stub-staffing"` paragraph draws with that month and without the hours error or any alert; switching to Hours still shows the error with `role=alert`. Observe the first fail before implementation; preserve existing assertions.
- [x] In `packages/venue-service/src/dashboard/opening-hours-screen.ts`, move selected `moduleContent()` before the `!model` gate in `render` (:1576); suppress only the main hours `readError` while a module is selected. Reuse `calendar.ctx` (:440), heading and painter templates. In `moduleMonth` (:385), fall back to `browserToday()` when the model is absent before calling `businessDateToday`; remove the obsolete model-loaded comment. A month-less address can adopt the business month after recovery, as its existing fallback does; no new address is written. Preserve other history/URL logic.
- [x] Run the changed test file and the host consumer `packages/staffing/src/dashboard/index.test.ts`, expecting passing test counts. The normal pre-push hook supplies scoped typechecks; do not duplicate them locally. Inspect both languages/themes at phone/desktop sizes. Keep translated messages unchanged.
- [x] Delete A700 from `docs/backlog/workforce.md` and `docs/backlog.md`. No guide edit: existing instructions remain true.

Exclude A712, A699/A711, A703, other address changes, frameworks and cleanup. One PR.

Forecast: production +9/−9; tests +35/−2; docs +17/−8; approximately 80 changed lines. Seek outside opinion above 120. Allow 30–50 build minutes.

The watcher cleared this corrected plan, including the browser-month fallback, in Lane D questions.md at 2026-11-16 19:37. Claude reviewed the approach; no owner design approval is recorded.
