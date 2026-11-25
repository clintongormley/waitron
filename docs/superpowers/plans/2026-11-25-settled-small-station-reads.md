# Read prep stations from the supervisor’s Calendar

A supervisor can choose a prep station in **Show** in Month or Week, read its service times, and see its **Changes after sending** setting. For A1079, the watcher recorded the owner's picker answer B on 25 October 2026 at about 02:56 in Lane C's `archive/questions-to-2026-11-21.md`, lines 67–69.

> A supervisor (anyone who could read it on the old Kitchen tab, per the 2026-10-04 decision) can open a station's "Changes after sending" setting and read it, but not change it.

The answer names no screen. The plan puts the policy in Calendar alongside the times, which the watcher placed there for A506-12 ASK A1. The owner's earlier A455 answer 35 took Prep stations away from supervisors. This pull request covers the two station reads in [SETTLED-SMALL](../../backlog/till.md#settled-small-small-answers-the-owner-gave-that-are-not-built-yet). The order, extras and wording items remain queued.

## Reuse the Calendar

- In `packages/venue-service/src/dashboard/opening-hours-screen.ts`, lift the three read-only guards on station reads and remove the old A722 comment. Keep the current view and contribution filters, passive requests, and `readOnly` on editing paths. Viewers gain the existing Month and Week station choices, including **All prep stations** and **Show all**, and the same station rows in each view's day box, including Year. Existing endpoints supply the data.
- When a read-only viewer selects one station, show its saved policy as plain text before `readErrors()` in Month and Week. Read it from the selected `PrepStation` and drop the line on a department or group selection. Move the existing `CHANGES_LABELS` map from `station-editor.ts` to `strings.ts`, sharing its existing translations. Managers keep their editor.
- Update the English and Spanish `opening-hours.md` and `kitchen-service.md` guides under `apps/server/src/guide/`. Update the current rules in `docs/developers/design-system.md` and `dashboard-live-updates.md`. Link the new behavior from the historical Calendar decision in `docs/backlog/service-periods.md` and close the policy notes in `docs/backlog/kitchen.md` and `dashboard.md`. Remove the two delivered bullets from `docs/backlog/till.md` and the index in `docs/backlog.md`. Change lane I to F only in that index, the SETTLED-SMALL heading note and the Task 15 bullet.

## Verify the change

- First replace both old read-only expectations in `packages/venue-service/src/dashboard/opening-hours-screen.week.test.ts`. A viewer's station link opens Grill and its known department hours. Switch to another station with a different policy, then a department, and check the label follows or disappears and the policy has no input or Save. Verify **All prep stations** draws both stations. Open a day and check `special-add` and `special-edit` are absent. Run the new assertions on the old code before implementing.
- Use `packages/venue-service/src/dashboard/calendar-station-month.test.ts` and its existing viewer switch for the Month policy and date selection. Extend the Year day-box fixture in `opening-hours-screen.test.ts` to check a station row for a viewer. Run the changed browser files and the station editor's existing label tests. Look at the Calendar in English and Spanish, light and dark, at desktop and phone widths.
- Extend the existing supervisor case in `apps/server/src/management-api.test.ts` to read the saved policy and refuse a valid attempted change with `authorization.not_permitted`, then check the saved choice. Keep its original name-write refusal. Run the existing individual and batch supervisor reads in `packages/venue-service/src/routes.test.ts`. Browser tests own what appears on screen. Route tests own authorization.

Estimate 25–45 production lines and 65–115 test lines, plus guide and backlog edits. Use the normal reviewed branch and CI workflow.
