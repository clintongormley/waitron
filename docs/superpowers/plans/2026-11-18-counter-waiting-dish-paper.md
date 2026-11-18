# Counter waiting dish kitchen paper

The watcher assigned COUNTER-WAITING-DISH-PAPER to Lane H on 18 November 2026.
It follows os10 (#3794, `7a4eb59399`). Lane H lands this item.

Staff can reprint a counter dish already on HOLD paper, cancel it on an open or paid bill and
give its old station a removal slip when they move it. A destination that waits and prints
advance HOLD gets a HOLD ticket. A destination that starts it immediately gets the regular
ticket. Use the existing paper flag on each ticket item at its current station for requested,
unfired, ungrouped work. Keep the group/station lookup for grouped dishes. Reuse the current
routing, notices and ticket formats. This covers the three queued commands.

1. **Failing checks.** In `apps/server/src/waiting-course-copy.test.ts`, adapt the base
   reproductions with the existing waiting-table and queued-paper fixtures. Reprint the fired
   Burger and waiting Tarta once, with Tarta in HOLD, and leave out a waiting Burger that never
   had paper. Cancel Tarta on an open bill with `cancelItemForTest` and on a paid bill with the
   keep-charge command. Expect one HOLD CANCELLED slip naming Tarta without a group. Use a
   flagged Tarta and an unprinted waiting Burger to check that only Tarta produces corrections.
   Move the waiting Tarta to a station that waits and prints advance HOLD, one that waits with
   advance HOLD off, and one that starts immediately. Check the old removal, the destination's
   HOLD, silence or regular ticket respectively, and the waiting or fired state. Use the
   unprinted Burger as a control for a move between waiting stations. Run the new cases before
   changing code and see the missing outputs fail.
2. **Reprint.** In `kitchen-print.ts`, add flagged ungrouped requested items to the HOLD part
   of `readReprintParts`, shared by Reprint and its printer-target read. Keep the grouped
   `readWaitingOnHoldPaper` lookup and `readSentItems`' existing counter path. For ungrouped
   items use the ticket's `queuedAt` under the order number. Requested time follows advance
   paper, and the flag carries no original print time. HOLD additions can lack job links
   (`docs/backlog/kitchen.md`, Task 6). The station move already updates `queuedAt` for its
   destination. Clarify the queue time for this case in both kitchen-service guides under
   `apps/server/src/guide/{en,es}/`, whose reprint section promises the first send time.
3. **Cancellation.** In `dish-kitchen.ts` and `line-service-cancel.ts` carry each ticket
   item's flag to `line-cancel.ts` for keep-charge. In `working-order.ts` use the same flag
   in `removeFromLine` and `removePortions` before they delete or reduce items, including
   each extra's own ticket. The adjustment route already calls both. Use
   `enqueueHoldCorrections` with an optional group in `kitchen-print.ts`.
4. **Station move.** In `station-move.ts` read the existing flag before clearing it.
   Pass an optional held marker for ungrouped corrections to `enqueueStationMoved` in
   `kitchen-print.ts`. Keep the marker inferred from the group number for existing callers.
   Keep ungrouped arrivals outside `destinationHoldPaper`'s group lookup. At a waiting
   destination with advance HOLD on, enqueue the existing HOLD ticket, which records paper
   for that station when queued. Keep the regular immediate-start path.
5. **Verify.** Run the changed suite and grouped controls in `station-move.test.ts`,
   `line-cancel.test.ts`, `kitchen-print.test.ts`, `kitchen-print.language.test.ts` and
   `kitchen-request.hold-paper.test.ts`. Run the queue's unedited fiscal and menu gates
   and the guide checks. Check the diff and sign off commits before finish-branch.

Expected size is about 150 production lines and 130 test lines, plus the two short guide edits.
