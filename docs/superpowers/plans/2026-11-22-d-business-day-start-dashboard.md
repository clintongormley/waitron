# Business-day start dashboard checks

Source: Lane D queue, BDS-DASHBOARD, assigned by the watcher at 01:24 on 22 November 2026. See
[Loose ends left by A788](../../backlog/service-periods.md#loose-ends-left-by-a788). The branch
starts after #3990, which gives the preview its unlisted clash count.

- **A863, find the clashing hours.** In `packages/venue-service/src/dashboard/clock-change-conflict.ts`,
  use the editor's order for the first range: department, zone, weekday or date, period, then hours.
  Include the season when supplied. Reuse `weekdayLabel` from `season-week-view.ts` for weekly
  hours. Use the special day's name and month/day for dated hours, since a repeating date can fall
  on a different weekday. Keep the new start, its effective moment and the clash reason distinct
  from the range. Use the sibling `strings.ts` for new wording. First extend
  `clock-change-conflict.test.ts` to fail on the missing department and weekday in English and
  Spanish. Use the same period name and differing clash and changeover weekdays, and cover a
  dated special day and a zone or department range. Update the shared
  `../testing/clock-change-conflict.ts` fixture and run its consumers if its sentence changes.
- **A873, recover when the editor becomes stale.** In
  `apps/dashboard/src/screens/business-day-start-editor.ts`, retain the Save refusal and show the
  existing close-and-reopen instruction when the draft's clock identity differs from the model.
  Put the instruction in the footer on its own and above it when a refusal already occupies it.
  A `venue.business_day_changed` Save refusal already tells people to reopen, so show it once.
  A locked-change refusal still needs the instruction after a clock update. Clear the stale
  preview, its Retry and its field refusal. First extend `business-day-start-editor.test.ts`
  to fail on the missing instruction after a refused Save and on a stale Retry. Keep the
  assertions for the Save refusal, draft, disabled Save and stale field refusal.
- **A874, verify the existing recovery.** The timing mismatch is real: `#scheduleReread` subtracts
  browser `Date.now()` from the scheduled instant and retries a past instant once. The box decides
  what is in force in `apps/server/src/business-day-start.ts` via `venue-settings-api.ts`. With the
  page active and reads succeeding, the next scheduled 60-second refresh after the box's boundary
  corrects the display, subject to request and browser scheduling delays.
  `apps/dashboard/src/api/live-queries.ts` and `packages/dashboard-kit/src/live-data.ts` keep that
  passive refresh on even while live updates are connected. Recommend keeping both reads.
  The watcher cleared an ahead-clock case at 01:34. In
  `apps/dashboard/src/screens/venue-details-business-day.test.ts`, connect live updates and give
  the box a clock behind the browser so both boundary reads return early. Advance to the 60-second
  tick measured from mount and check that the row clears and only the opening read was active.
  Temporarily quiet the query while connected to show the test catches the lost refresh. When the
  browser clock is behind, the regular refresh can reach the box before the boundary timer fires.
  Bring contrary results back to the watcher before changing refresh policy.
- Add the shared `{#business-day-start}` heading to
  `apps/server/src/guide/{en,es}/opening-hours.md`. Explain how to find the named hours and reopen
  a stale edit. Add the key `opening-hours.business-day-start` in `apps/dashboard/src/help-guide.ts`
  and point the editor's help tooltip there. Remove A863 and A873 from
  `docs/backlog/service-periods.md` once verified. Move A874 to decisions if the watcher clears
  this recommendation and the control passes. The parent bundle still covers other open items.

Finish line: a manager can locate the hours that block a change and knows to reopen a stale draft
even after Save fails. The waiting row clears on the active page after the box reaches the boundary.
Estimated 45–75 added and 15–30 removed production lines, 65–110 added and 10–20 removed test
lines, and 20–30 guide and backlog lines. Run the named Vitest files, the editor's accessibility
and unsaved-draft files, and the guide-content and guide-link checks. Inspect the wording and
dialog in Chromium at phone and desktop sizes in both themes and languages.
