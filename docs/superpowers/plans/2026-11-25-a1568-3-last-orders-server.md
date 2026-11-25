Resets venues in PR 2 and PR 3.

# A1568-3 · The server's last-orders rule

[Design, sections 2–4 and 6](../specs/2026-11-24-last-orders-per-station-design.md), approved by
the owner on 24 November (“y”, recorded in the design). The watcher cleared these three pull
requests on 25 November at 14:14, incorporating its plan review. Lane D's watcher note quotes the
owner on #4283 as “Yes, land it after the server part (Recommended)”. #4283 follows PR 2.

**PR 1 · Routing rule and order paths.** When Kitchen stops at 14:45 and Lunch runs to 15:00, a
main asks for agreement and a dessert Bar still takes is sent there. Reuse `departmentDay`,
`serviceRuns`, `rangeSpanInDay` and `routingAt` in `packages/venue-service/src/`. Clamp the day
boundary before adding an offset. Distinguish Any other time from the running route in
`MakerResolver` and `routing-store.ts`. Check the period's maker, the route immediately after its
end, and every ended run that takes the dish. A contiguous successor that sells the product or
variant can take it immediately, including through a set menu. A stand-in uses its own offset or
zero. On a stop, the latest cutoff wins, with the period's own maker winning a tie. Keep the
existing behavior for closed zones, missing clocks and unavailable routes. Skip the added routing
reads when no configured cutoff can apply.

Use the rule in `working-order-pricing.ts`, `working-order-late-send.ts` and `makersByLine` in
`working-order-kitchen-fire.ts`. Share `RoutingOnce` across pricing and dispatch, including an
edit. For a moved stored dish, read offsets in its original department and use the receiving
zone's routes, with the existing foreign-period fallback. A manual choice only changes dispatch.
Extras added to a sent dish use that dish's station. A stored rise obeys its own cutoff and can
use an open takeover. The refusal identifies the cutoff without suggesting a different menu.
Keep the existing agreement mark and dispatch by `late_period_id`, the set-menu exemption and
its held mark. Keep each caller's ask, mark or refuse policy and manager PIN.

Start `working-order.late-send.test.ts` with a refusal at 14:45. In `last-orders.test.ts`, test
14:44, 14:45, 15:20 and 16:00, a set-menu-only successor, competing ended runs, a stand-in and
Keep open at changeover. Server tests check the dispatched or refused stored result, including a
stored rise in each direction. Estimate 260–350 product and 170–240 test lines. Ask the watcher if
wiring passes about 350 product lines. No schema work in PR 1.

**PR 2 · Agreement, set menus and held dishes.** Store the agreed station in `orders.ts`, carry it
through `working-order-transfer.ts` and the three `core.sql` line-update branches, and apply
closures at dispatch. In `set-menu-links.ts`, use the source run's menus for each ended dish.
Recorded copies still work after republishing, including when their menu did not run today.
Keep grouped prices and links. Delete the exemption's synthetic held mark and the second check
in `order-group-release.ts`. The `set-menu-period.test.ts` check “asks before firing a held
set-menu %s after lunch” now expects Fire to succeed without asking. Check the stored agreement,
linked main, original dessert price, and held send. Rebuild core and run the migration guards
and unedited fiscal checks. Estimate 160–230 product and 100–150 test lines plus generated files.
Lead the PR with “Resets venues”. Tell Lane D when it is ready. Until piece 4, the menu-wide
confirmation can cover another station during PIN entry and the heading can say Lunch ended at
14:45. Tell the owner about that heading when #4283 lands.

**PR 3 · Ordered during.** Stamp the first add in draft lines, preserving it on resave and split.
Direct adds use their request time. Keep the qualifying run's existing occurrence key in a core
state table keyed by bill and occurrence so cancellation can delete a dish without losing the
fact. Carry it through moves and splits. Piece 4 reads joined bills through `partyFamily` and
looks only at runs in the current department. Use `order-drafts.db.test.ts` for a 14:58 first draft
placed after 15:00, an earlier seating alone, a cancelled dish and a moved or split bill. Rebuild
core, run the migration guards and lead the PR with “Resets venues”. Estimate 140–210 product and
90–140 test lines plus generated files. Piece 4 owns the till fields, window and guide changes.
Update the A1568 backlog with each result.
