# Counter waiting dish kitchen paper

Lane H queue item COUNTER-WAITING-DISH-PAPER, assigned by the watcher on 18 November 2026.
Base dependency is os10 (#3794, `7a4eb59399`). Lane H lands this item.

When a dish on HOLD paper moves to the counter and still waits for the pass, staff can reprint it,
cancel it with a HOLD correction, or send it to another station with a removal at the old station
and HOLD at the new station if it also waits. A station that starts the dish immediately still
gets a regular ticket. Use the ticket item's existing `holdPaperQueued` at its current station
for ungrouped requested work. Grouped work keeps its group/station lookup. The existing printers,
notices and ticket formats do the work. Scope is those three commands.

1. In `apps/server/src/waiting-course-copy.test.ts`, adapt the lane's base reproductions into
   three named regressions with the existing waiting-table and queued-paper fixtures. Verify that
   a counter reprint includes the fired Burger and the waiting Tarta once, in their respective
   sections, and omits a waiting dish that had no HOLD paper. Verify that cancelling Tarta queues
   one HOLD CANCELLED slip naming it with no group heading. Verify that moving Tarta to another
   station that waits queues one removal and one HOLD with the source station, with Tarta still
   waiting. Run the changed file before implementation and see each missing output fail.
2. In `apps/server/src/kitchen-print.ts`, add ungrouped, requested, unfired flagged items to the
   HOLD part of `readReprintParts`, shared by the Reprint action and its printer-target read.
   Use the item's stored request time for its reprint heading when it no longer has a group
   timestamp. Clarify that case in the kitchen-service guides under
   `apps/server/src/guide/{en,es}/kitchen-service.md`, which describe the original send time.
3. Select the flag in `dish-kitchen.ts` and carry it through `line-service-cancel.ts` to
   `line-cancel.ts`. For an ungrouped requested dish on paper, use the existing
   `enqueueHoldCorrections` with no group number. Keep the grouped and fired branches.
4. In `station-move.ts`, read the flag before changing the station. Feed the old station's
   correction to `enqueueStationMoved` as held with no group number. Use the existing HOLD
   enqueue for the waiting arrival, which records paper at the new station if queued. Keep
   immediate start and grouped arrival routing. In `kitchen-print.ts`, identify held station
   corrections explicitly so an ungrouped one can use HOLD CANCELLED.
5. Run the changed suite plus the grouped controls in `station-move.test.ts`,
   `line-cancel.test.ts`, and the existing kitchen reprint suites. Run the queue's unedited
   fiscal and menu gates. Check the diff and sign off commits before finish-branch.

Expected size is about 100 production lines and 100 test lines, plus the short guide edits.
