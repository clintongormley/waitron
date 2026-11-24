# A1568-2 · Last orders settings

[Design, sections 1 and 7](../specs/2026-11-24-last-orders-per-station-design.md)

A manager can set Kitchen to 15 minutes before Lunch ends and Bar to one hour after. Calendar and
staffing show Bar's longer hours and keep Kitchen's painted end. Configuration export carries the
settings to a fresh venue. The watcher cleared the two-pull-request split on 24 November at 20:44.

## 1. Save and transfer

Add optional `lastOrders` to `menu-timetable-types.ts`, `menu-timetable.ts` and `routes.ts`. Store
nonzero offsets as an array in `menu_periods.last_orders` in `packages/db/src/schema/venue-service/menus.ts`.
Use `RouteTarget` with `minutes`, once per target. Share the parser and the allowed minutes in
`menu-timetable-rules.ts` (−60, −45, −30, −15, 0, 15, 30, 45, 60, 90, 120). Missing entries mean At
the end. Omitted PATCH keeps stored values. Reject unknown ids and drop a known deleted station
from a stale save. Drop the whole entry in `station-delete-settings.ts` and count it in the delete
warning. Add localized copy in `dashboard/station-delete-copy.ts` and the `menu_periods` live
dependency. Declare `[*].stationId` in venue-service's `configuration-transfer.ts` and validate its
targets. Bump the format in provisioning and rebuild core's starting migration. Lead the PR with the
venue reset. This PR adds no period form control and can land once green.

Start with `menu-timetable-routes.test.ts` for save, reopen and refusal, `menu-timetable.test.ts`
for preserving offsets when replacing a deleted menu, and `station-delete-settings.test.ts` for
cleanup and the count while No preparation keeps its own offset. Check the localized count and live
dependency in `dashboard/station-delete-copy.test.ts` and `dashboard/live-queries.test.ts`. Run the
real transfer round trip in `apps/server/src/configuration-transfer.test.ts`, schema guards and
unedited fiscal immutability test. Allow 190–260 product lines and 150–210 test lines plus generated migration.

## 2. Show and edit

Use `selectRoutingCell` across the draft menus' products and the department's zones. In
`last-order-routing.ts`, share the routing intervals during each run and up to two hours after it
with `planned-service-guides.ts`. Use season weeks and `readSpecialDayPlan` and
`resolveDepartmentsDays` in `day-resolver.ts` for effective special-day paint. Use whichever period
runs then, or Any other time during gaps. Extend `periodProductIds` for the picker and Calendar to
walk included active set-menu roots through `reachableProducts`. Test a set-menu-only dish and a later
period that starts after a gap. Check the set-menu-only case through Prep stations' routing editor.
If it omits the period, correct the reach there here if small, or split that fix into its own PR.

Add the passive GET to `routes.ts`, `dashboard/opening-hours-client.ts` and `dashboard/live-queries.ts`.
In `dashboard/period-{editing,dialog}.ts`, reuse the draft scope and shared select fields. Omit
`lastOrders` during the first read, after a refusal or while draft choices are pending. Ignore stale
replies. Localize the labels, Prep stations link and routing dialog in `dashboard/strings.ts`.
Test omission in all three read states and saving a changed target in `period-dialog.test.ts`.

In `planned-service-guides.ts`, include set-menu dishes in base hours and after-end extensions. Clamp
at the business-day end and subtract zone closures. In the same station and department, its own
painted block owns overlap. Where extensions overlap, show the latest period to end. Keep other
paint as saved. In `station-service-times.test.ts`, test Kitchen kept to 15:00, Bar's Lunch shown
until 16:00 when it serves nothing in Afternoon, Afternoon winning when Bar serves both, and the
special-day extension clipped at day end.

Allow 410–490 product lines and 300–340 test lines plus guides. Update both languages of Opening
hours and Kitchen service, the design-system label and backlog. Send form, routing and Calendar
captures for owner OK. Hold this PR until A1568-3 can follow. Dish availability, sending, till display
and demo stay in their queued pieces.
