# Read prep stations from the supervisor’s Calendar

A supervisor can choose a prep station in **Show** in Month or Week, read its service times, and see its **Changes after sending** setting. A1079 is the owner’s 25 October read-only answer. A506-12 ASK A1 is the watcher’s application of that answer to station hours. [SETTLED-SMALL](../../backlog/till.md#settled-small-small-answers-the-owner-gave-that-are-not-built-yet) records both. This pull request covers those two station reads. The order, extras and wording items remain queued.

## Reuse the Calendar

- In `packages/venue-service/src/dashboard/opening-hours-screen.ts`, let read-only calendars use the existing station list and timing watches. Keep their current filters for view and contribution and their passive requests. Use the same Show choices, station links and day-box hours as the editable Calendar. Keep `readOnly` on the existing editing paths. The Prep stations editor and its access rules stay where they are.
- Show the chosen station’s saved policy once as plain text before the Month or Week. Read it from the selected `PrepStation` that `watchStations` already supplies. Share the three policy labels with `station-editor.ts` through `strings.ts`. The policy belongs to one station and disappears when the selection returns to a department or a group. Existing list, times and write endpoints suffice.
- Update `apps/server/src/guide/en/opening-hours.md` and its Spanish twin to tell supervisors where to read the two values. Update the old Calendar decision in `docs/backlog/service-periods.md` with a dated pointer. Remove the two finished bullets from `docs/backlog/till.md` and the index in `docs/backlog.md`, and correct the remaining lane references there from I to F.

## Verify the change

- First replace the old expectation in `packages/venue-service/src/dashboard/opening-hours-screen.week.test.ts`. A read-only Calendar at a station address names Grill in Show, reads its times and draws a known department’s hours. Set distinct policies on two stations, switch between them and then select a department. Check that the wording follows the selection and that opening a day offers no edit action. Run that case on the old code and observe the missing station choices before implementing.
- Exercise Month through the same screen fixture with the station already selected and assert the same policy and that day selection stays read-only. Run the changed browser files and the station editor’s existing label tests.
- Run the existing supervisor station-list read/write refusal in `apps/server/src/management-api.test.ts` and the individual and batch supervisor timing reads in `packages/venue-service/src/routes.test.ts`. The browser tests own what appears on screen. Those route tests own authorization. Check the screen in English and Spanish, light and dark, at desktop and phone widths.

Estimate 30–55 production lines and 55–95 test lines, plus the guide and backlog edits. Use the normal reviewed branch and CI workflow.
