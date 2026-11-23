# A1084 late dish routing implementation plan

When the kitchen agrees to make a dish after its period ends, use that period's routing. A Lunch mojito confirmed at 14:05 goes to the Downstairs bar even if a dish ordered from the current menu goes Upstairs. The same rule applies when you hold the dish, fire it or release it from a closed station. Station availability and fallbacks use the time of routing. The ask is [A1084 in the backlog](../../backlog/service-periods.md#a1084-a-confirmed-late-dish-routes-by-the-period-running-when-it-is-sent-not-the-period-the-kitchen-agreed-for) and the Lane K queue of 23 November. [A789 slice 3](https://github.com/clintongormley/waitron/pull/2051) records current-period routing as D33's limit for that slice. The owner's Q39 answer covers confirmation and the optional PIN.

## Carry the period through the order

- In `packages/venue-service/src/menu-timetable{,-types}.ts` and `packages/module/src/module.ts`, carry the ended period id with its name in `endedMenus`. Reuse the same matched occurrence at confirmation in `apps/server/src/working-order.ts`. Store its id alongside the existing name and confirmer through `LineContextInput.late`, `LineContextColumns` and the writers in `packages/venue-service/src/operations.ts`. Copy the id with the line when splitting it. Keep an empty id for unasked marks and where no period was identified. Retain the name for the ticket and keep the confirmation request and response shape.
- Add nullable `latePeriodId` to `packages/db/src/schema/orders.ts` as a snapshot reference. Period deletion can remove the routing rule while a held or historical line retains its recorded mark. Protect the id alongside the mark in `packages/db/triggers/core.sql`, including the first-mark exception. Rebuild the core baseline and disclose the venue reset in the PR.

## Route each line through the existing snapshot

- Add a keyed dish batch to `MakerResolver` in `packages/module/src/module.ts` with `{ key, productId, periodId? }`. Keep the product-keyed callers on `makers`. In `packages/venue-service/src/routing-store.ts`, share the existing batched product facts and routing snapshot between methods. Select an agreed period line for the order's zone department while keeping the same station status and fallback computation in `routing.ts`. Use the cell's base target when the named period has no rule, and current-period routing when the line has no applicable agreement. Pass each extra's agreed period through `extraMakers`.
- In `apps/server/src/working-order.ts` use line-keyed results in `fireLines` and `heldNoRouteLines`, and pass the stored period into `insertSplitExtras`. In `apps/server/src/station-move.ts` use the stored period when `rerouteHeldAtRelease` looks for a replacement. Keep explicit station choices and the existing rules for when held work can move.

## Verify the two destinations

- Test first in `apps/server/src/till-api.service-periods.test.ts`. Reverse the confirmed mojito's station and ticket assertions while keeping the mark assertions and neighbouring current-period cases. Add a held and released dish with a separately routed extra. Use `apps/server/src/station-move.test.ts` to prove a closed station resolves a replacement under the agreed period at release. In `packages/venue-service/src/routing-store.test.ts`, verify one keyed batch can route the same product for two periods and keeps the zone's own department and live station fallbacks.
- Run the changed test files, the core migration guards named in `CLAUDE.md`, and the unedited fiscal write-path and immutability cases. Update the English and Spanish kitchen-service guides and remove A1084 from both backlog files.

One PR. About 260 production lines, 200 test lines and 20 guide and backlog lines. Count regenerated core files separately and include them in review.
