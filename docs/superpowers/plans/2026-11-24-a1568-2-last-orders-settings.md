# A1568-2 · Last orders settings

[Design, sections 1 and 7](../specs/2026-11-24-last-orders-per-station-design.md)

A manager can set Kitchen to 15 minutes before Lunch ends and Bar to one hour after. Calendar and
staffing show Bar's longer hours and keep Kitchen's painted end. Configuration export carries the
settings to a fresh venue.

**Save and transfer.** Add optional `lastOrders` to `menu-timetable-types.ts`, `menu-timetable.ts`
and `routes.ts`. Store nonzero offsets as an array in `menu_periods.last_orders` (`packages/db/src/schema/venue-service/menus.ts`).
Use the existing `RouteTarget` variants with `minutes`. Accept −60, −45, −30, −15, 0, 15, 30, 45,
60, 90 or 120 once per target. Missing entries mean At the end. Share the minutes and parser in
`menu-timetable-rules.ts`. Omitted PATCH keeps stored values, including when a menu is replaced.
Validate supplied entries, refuse unknown ids and drop a known deleted station from a stale save.
In `station-delete-settings.ts`, drop the whole entry in the same write and count it in delete
impact and the `menu_periods` live dependency, with copy in `dashboard/station-delete-copy.ts`. Declare `[*].stationId` in
`configuration-transfer.ts` and validate its targets. An invalid station entry cannot become No
preparation. Bump the format in `packages/provisioning/src/configuration-transfer.ts` and rebuild
core's starting migration. The venue needs a reset. Start with `menu-timetable-routes.test.ts`
for save, reopen and refusal, `station-delete-settings.test.ts` for cleanup with No preparation
present, and `apps/server/src/configuration-transfer.test.ts` for real remapping and reimport.

**Choose stations.** In `last-order-routing.ts`, take the period's customer and staff menu drafts
through the existing section graph. Extend `periodProductIds` with an opt-in for the picker and
Calendar. Walk each included active set menu's root with `reachableProducts`. The routing grid and
its validation keep their existing product list. Reuse `selectRoutingCell` across the department's zones. For each painted run in
a season or resolved special day, share the routing intervals from the run through two hours after
its end. Use the running period's route, or Any other time in gaps. A new unpainted period uses its
normal routing and Any other time. Test a set-menu-only dish and a tail that reaches a later period
after a gap. Use a passive GET in `routes.ts`, `dashboard/opening-hours-client.ts` and
`dashboard/live-queries.ts`. In `dashboard/period-{editing,dialog}.ts`, refresh choices for draft
menu and routing changes, ignoring stale replies. Reuse the draft scope and shared select fields.
Save offsets for the currently listed targets. Localize the labels and Prep stations link in
`dashboard/strings.ts`, including the routing dialog's new label. Extend `period-dialog.test.ts`
for a takeover-only target, No preparation, an obsolete reply and saving a changed draft.

**Show hours.** In `planned-service-guides.ts`, include set-menu dishes in base hours and after-end
extensions. Clamp extensions at the business-day end and subtract zone closures. In each station
and department row, a painted block owns its overlaps. Where extensions overlap, show the latest
period to end. Keep the earlier cutoff out of the painted hours and leave department and staffing
blocks as saved. Extend `station-service-times.test.ts` for Kitchen kept to 15:00, a set-menu-only
station shown during and after Lunch, and a special-day tail clipped by a block and by day end.

Allow 600–750 product lines and 450–550 test lines, plus generated migration and docs. Update both
languages of the Opening hours and Kitchen service guides, design-system wording and the backlog.
Run the changed tests, schema guards and unedited fiscal immutability test. Send form, routing label
and Calendar captures for owner OK, including a station serving adjoining periods. Hold the
reviewed PR until the watcher confirms A1568-3 can follow it. Dish availability, send decisions,
till display and demo stay in their queued pieces.
