# A997 · Keep a saved dish’s item count when its unit changes

A 330 ml dish written to an order line still counts as one after its product moves to a whole unit. This covers Parked orders, the floor’s Held and Ready signals, Sent, and Find a bill. New order lines take the unit in the published menu, so an assignment takes effect for new orders at the next publish. Deliver this in one pull request for Lane H’s A997 assignment.

[A757 point 15](2026-10-21-a757-6-item-counts-by-state.md#owner-points-each-with-the-default-this-plan-builds-the-owner-is-away-until-2-nov) records the live lookup as the plan’s default while the owner was away. On base `308838b867`, a test using `parkOrder`, `assignProductUnit` and `readOrderStateCounts` read one item before reassignment and failed at 330 afterward.

## Store the rule on the order line

- Store a required boolean `countAsPortions` on `working_order_lines` in `packages/db/src/schema/orders.ts`. Use the `takesExtras(selection.unit)` result that `priceOrderLines` already computes in `apps/server/src/working-order.ts`. Default to true for synthetic rows and direct fixtures that represent whole items. Set-menu headings count as whole items. Copy the value in `carveLines` when splitting a row. Whole moves retain the row, and portion copies already spread it.
- Read the flag in `order-state-counts.ts`, `order-groups.ts` and `table-signals.ts`. Use the dish’s flag for extra work at a station. Keep Sent’s `countsWholePortions` response field. In `find-bill-bills.ts`, use the flag in the existing SQL sum before Items sorting and pagination. The sum reads working lines. Keep prices, quantities, service rules and sale records as they are.
- Open drafts in the New order panel still use the product’s current unit for Parked orders. If a manager changes the unit before the next publish, a draft’s count can change when it becomes an order line priced from the published menu. Confirm this limit with the watcher before building.
- Include the flag in all three unchanged-column comparisons in `packages/db/triggers/core.sql` beside `unit_precision`. Run `pnpm --filter @waitron/server migration-baseline rebuild --set core` for the preproduction reset. Remove A997 and its empty bundle from `docs/backlog.md` and `docs/backlog/till.md`. Add a dated pointer at A757 point 15 and update A893’s open-points note in `docs/backlog/till.md`. Update the count paragraph in the English and Spanish `guide/*/kitchen-service.md`.

## Prove the change

Start with `order-state-counts.test.ts` and the parked 330 ml regression. Cover a saved custom whole unit reassigned to a measure, a new line before and after publishing, and a split that carries the source’s rule. Use the existing floor cases in that file and `table-signals.test.ts`, the response in `current-orders.test.ts`, and the saved sum in `find-bill-bills.test.ts` to prove each reader survives reassignment. Keep the existing assertions for fractions, inherited units, cancellations, stations and drafts. Set original units before ordering where tests currently change them afterward to model the original unit.

Run every changed test file, `history-read-plans.test.ts`, the four root schema and baseline guards, and the unchanged fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts` and menu `till-api.sell-published.test.ts` and `till-app-menu-refresh.test.ts` gates. Expect about 100 production lines and 160 test lines, plus generated baseline and documentation. Get branch review and green current-head CI before landing.
