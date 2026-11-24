# A1568-2 · Last orders settings

[Design, sections 1 and 7](../specs/2026-11-24-last-orders-per-station-design.md)

A manager can set Kitchen to 15 minutes before Lunch ends and Bar to one hour after. The form
shows stations that can receive those dishes. Calendar and the staffing painter show Bar's longer
hours and keep Kitchen's painted end. A configuration export carries the settings to a fresh venue.

**Save and transfer.** Add `lastOrders` to the period saved by `menu-timetable.ts` and accepted by
`routes.ts`. In `packages/db/src/schema/venue-service/menus.ts`, store the nonzero offsets in
`menu_periods.last_orders` as `{ stationId: string | null, minutes: number }[]`. `null` means No
preparation. Missing entries mean At the end. Accept only −60, −45, −30, −15, 0, 15, 30, 45, 60,
90 or 120. Validate the list, unique targets and active station ids. A PATCH without the field
keeps the offsets. Remove a deleted station's entries in `station-delete-settings.ts` in the
existing write. In `configuration-transfer.ts`, use the same validation and declare the station id
path `[*].stationId` for remapping. Bump the bundle format and rebuild core's starting migration.
This requires a venue reset. Start with `menu-timetable-routes.test.ts` for save, reopen and
refusal, `station-delete-settings.test.ts` for cleanup, and the real round trip in
`apps/server/src/configuration-transfer.test.ts` for remapped station ids and No preparation.

**Edit.** In `last-order-routing.ts`, reuse `periodProductIds` and `selectRoutingCell` to resolve
the draft customer and staff menus across the department's zones. Include configured targets during
the period and after it, using Any other time for gaps and the next period's routing where painted
blocks touch in a season or special day. A new unpainted period uses its normal routing and Any other
time. Leave daily station closures to the service rule. Read the choices through a passive GET in
`routes.ts` and `dashboard/opening-hours-client.ts`. Refresh for draft menu and routing changes
without reloading the draft. In `dashboard/period-{editing,dialog}.ts`, use the existing draft scope
and shared field for each reachable target, with the Prep stations link and sentence from `form3`.
Keep saved offsets for stations outside the current list. In `dashboard/strings.ts`, localize the
relative labels and the routing editor's Any other time label. Extend `period-dialog.test.ts` for
takeover-only and No preparation choices, draft changes and Save. Test the reach calculation once
with split zones and touching versus gapped periods.

**Show hours.** In `planned-service-guides.ts`, keep the existing ranges, use `serviceRuns` for each
painted run and add positive tails for the routes that would receive its dishes at those times.
Use the running period's route or Any other time through each tail. Cap the tail at the business-day
end and apply the existing zone-closure subtraction. Keep the department paint and staffing blocks
as saved. Extend `station-service-times.test.ts` with a special-day Lunch and a takeover-only Bar,
Kitchen left at the painted end, and a tail stopped by the business-day boundary.

Allow about 500–600 product lines and 275–350 test lines, plus generated migration and guides.
Update the English and Spanish Opening hours and Kitchen service guides and the backlog. Run the
changed files' tests, schema guards and unedited fiscal immutability test. Send the form, routing
label and Calendar captures to the owner through the watcher. Hold the reviewed PR until the watcher
confirms A1568-3 can follow it. Dish availability, send decisions, till display and demo stay in their
queued pieces.
