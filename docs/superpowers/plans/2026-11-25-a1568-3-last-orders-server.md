# A1568-3 · The server's last-orders rule

[Design, sections 2–4 and 6](../specs/2026-11-24-last-orders-per-station-design.md). Start from
A1515-3 PR 2b (`f4e63f211c`) and the saved `lastOrders` values already on main. The watcher’s
25 November 13:42 note assigns this work to Lane F and keeps the remaining A1515-3 PRs with Lane B.

**Finish line.** With Lunch ending at 15:00, Kitchen stopping at 14:45 and Bar taking desserts until
16:00, a 14:50 dessert goes to Bar and a main asks for Kitchen's agreement. At 15:20, a dessert still
uses Lunch's price. The server can tell the till which Lunch run the party ordered during and which
dishes are still available. Lane D can land #4283 after the server write rule lands.

**1. Apply the cutoff when writing an order.** In `packages/venue-service/src/menu-timetable.ts`,
reuse `departmentDay`, `serviceRuns` and `rangeSpanInDay` to read occurrence ids, menus, offsets and
boundaries, including Keep open and the business-day end. Add `last-orders.ts` for the dish rule and
expose it through `service.ts`. Use batched `routingAt().makers` in `routing-store.ts` with explicit
current, named-period and Any other time choices. Read the effective routing at the send's time so
stand-ins use their own offsets, defaulting to zero. Look one route ahead while a period runs. If its
immediate successor sells the same dish too, use that route. After the end, try current routing
against the ended run's deadline. Match the exact dish or variant across main and staff menus,
including set-menu offers. At the exclusive cutoff, choose the eligible station that stopped last.
Keep the existing no-replacement, closed-zone and missing-clock paths.

Replace the ended-menu decisions in `working-order-pricing.ts` and `working-order-late-send.ts` with
that result. Keep the existing per-caller ask, mark or refuse policy, including the manager PIN.
Carry the rule's destination through `working-order-kitchen-fire.ts` and keep a saved agreement's
station with its existing late mark. A manual station choice only changes dispatch. Extras added to a
sent dish use its existing station. Remove the special held set-menu check in `order-group-release.ts`.
Pass the originating menu into `set-menu-links.ts` for each ended-period dish so it can link the copies
that dish could have linked from there during service. Leave grouping and locked prices alone.
Keep the current `menu_period.ended` envelope usable by the existing till and add station and cutoff
for the later window. No preparation can stop for display and still sends without an agreement.

Start with the 14:44 / 14:45 / 15:20 / 16:00 boundary and routing cases in `last-orders.test.ts`,
including a contiguous successor selling the same variant, an effective Keep open end and a stand-in
with no setting. In `working-order.late-send.test.ts` assert refusal, the agreed kitchen destination,
extras and late marks. Use the existing set-menu bill fixtures for a linked main that asks, a late
first order linking Lunch's copy at its original price and a held dish firing without a second ask.
Run the existing focused Counter, move and stored-edit late checks. Estimate 360–500 product and
250–330 test lines, plus a rebuilt core baseline if the agreement needs a nullable station field.

**2. Supply ordered-during and dish status for the till.** In the existing draft and working line
schemas (`order-drafts.ts`, `orders.ts`), keep when a parent dish was first added. Stamp it on the
server in the draft write and carry it to the working line. Direct adds use their own request time.
Preserve it on edits, transfers and splits, and read cancelled rows too. Use the line's original
service department when matching its occurrence and the current department to choose the ended menus
for display. In the existing till bill/menu reads, give piece 4 the eligible occurrences and dish
status from the same rule. A 14:58 draft sent at 15:05 qualifies. A table that only sat down at 14:55
does not. Cover party bills, split and move, cancellations and the first-order draft in
`order-drafts.db.test.ts` and the existing till order read tests. Rebuild the core baseline and run
the schema guards and unchanged fiscal checks. Estimate 200–300 product and 150–230 test lines,
plus generated migration. Update the A1568 backlog after each slice and retain the till and demo work.

Work test-first in each slice. Keep the current till and dashboard screens, till window, ticket copy,
guides for those screens and demo in their respective pieces. Coordinate the read fields with piece 4
and give Lane D the server write PR when it is ready. No fiscal records or filing change.
