Resets venues in PR 2.

# A1568-3 · The server's last-orders rule

[Design, sections 2–4 and 6](../specs/2026-11-24-last-orders-per-station-design.md). The watcher’s
25 November 13:42 note reads “A1568-3 may start: A1515-3 2b is on main (f4e63f211c), which holds
the decision you replace”. PRs 2c, 3 and 4 stay with Lane B. Lane D’s watcher note on 25 November
quotes the owner on #4283 as “Yes, land it after the server part (Recommended)”.

**Finish line.** Lunch ends at 15:00. Kitchen stops at 14:45 and Bar takes desserts until 16:00. At
14:50 the dessert goes to Bar and the main asks for agreement. At 15:20 the dessert keeps Lunch’s
price and set-menu links. A saved 14:58 first order sent at 15:05 counts as ordered during Lunch.

**PR 1 · Routing rule.** In `packages/venue-service/src/menu-timetable.ts`, reuse `departmentDay`,
`serviceRuns` and `rangeSpanInDay` for the effective runs, menus and offsets. Clamp the run end at
the business-day boundary before applying an offset. In `last-orders.ts`, use `routingAt` to batch
maker decisions with the same snapshot and clock. Extend `MakerResolver` in `packages/module/src/module.ts`
and `routing-store.ts` to distinguish an explicit Any other time from the current route. Check the
period’s own maker, then the route immediately after the end. A contiguous successor that sells the
same dish or variant may take it immediately. Check all eligible ended runs against the current
route, including a gap or no next period. Main and staff menus, including set-menu offers, count.
Use the stand-in’s offset (zero when absent). When the dish has stopped, choose the maker that
stopped last and give the period’s own maker the tie. Keep the existing no-replacement, closed-zone
and missing-clock behavior. Keep the rule ready for the writes in PR 2.

In `last-orders.test.ts`, use the 14:44 / 14:45 / 15:20 / 16:00 case, a set-menu-only successor,
multiple ended runs, an unconfigured stand-in and Keep open, including an end at changeover.
Estimate 170–240 product and 120–170 test lines. No schema changes in this PR.

**PR 2 · Agreement, set menus and ordered-during.** Use the rule in `working-order-pricing.ts`,
`working-order-late-send.ts` and `makersByLine` in `working-order-kitchen-fire.ts` with one
`RoutingOnce` per operation. This reaches sending, edited dispatch, held no-preparation release and
`station-move.ts`. A moved stored dish keeps its original department’s cutoff. A manual station
choice changes dispatch only, and a sent dish’s extras use its existing station’s cutoff. Keep each
caller’s ask, mark or refuse policy and manager PIN. Refuse a stored rise at its own cutoff even if
the dish is also sold elsewhere. No preparation sends without asking. Store the agreed station in
`orders.ts` alongside the late mark, preserve it in `working-order-transfer.ts`, and apply station
closure fallbacks at dispatch. Include the field in the three `core.sql` line-update branches. Remove
the held-set-menu exemption and its synthetic mark, and remove the second check in `order-group-release.ts`.
In `set-menu-links.ts`, link each ended dish against all menus of its source run, with recorded offers
still valid after republishing. Keep existing grouping, locked prices and links on held dishes.

Stamp the first add in `orderDraftLines` (`order-drafts.ts` in schema and server), preserving it on
resave and split. Direct adds use their own request time. At order placement, keep the qualifying
run’s existing occurrence key on the bill in a small core state table keyed by bill and occurrence.
The fact survives cancellation, even when the dish row is deleted. Follow the existing bill-copy
paths on a move or split and use `partyFamily` across joined parties. A later department reads only
its own runs. Rebuild core once with these fields and the agreed station. Put “Resets venues” first
in the PR and regenerate on main’s baseline after overlapping migrations land.

Start with `working-order.late-send.test.ts` for the refusal and its dispatched station, a later edit,
no-preparation hold, extras and the stored rise before and after cutoff. Use `set-menu-period.test.ts`
for the linked main, a dessert at its original price and a held dish firing without a second check.
In `order-drafts.db.test.ts`, place a 14:58 first draft after 15:00 and distinguish a party that only
sat down before the end. Test a deleted dish and a split, move or joined party where the fact matters.
Run the existing Counter and move late checks, core migration guards and unedited fiscal checks.
Estimate 400–550 product and 250–350 test lines plus the generated baseline.

Keep the current till refusal and confirmation shape until piece 4 can name and confirm stations.
The existing menu-wide confirmation can cover a second station that closes during PIN entry.
Piece 4 owns the new till fields, screen, ticket copy and guide changes. Update the A1568 backlog
with each result. Tell Lane D when PR 2 is ready, with the till window limitation and landing order.
