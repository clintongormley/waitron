# Keep Products still after an availability click

When a pointer change sends a dish to the bottom of the Available sort, the Products table
keeps the same scroll offset. Keyboard changes still keep focus visible. The watcher’s 17:49
note in Lane H’s `questions.md` puts this fix before bulk availability.

The existing Products screen case failed on `985efb718fbfb5bdd0f5ded4fb84011855eea760` in the
full file on macOS Chromium (131 px before save, 77 px after). In isolation, partly covering the
clicked row with the sticky heading before the save resolves reproduced the same 54 px move.
Temporarily setting `overflow-anchor: none` on the scroller kept the offset. The existing row
rule stops applying in the same render that sends the row to the bottom.

1. In `apps/dashboard/src/screens/products-screen.test.ts`, keep the real pointer click and the
   assertion that the dish moves to the end. Use the phone viewport and leave the top of the
   clicked row just under the heading before resolving the write. Assert a nonzero starting offset
   and exact preservation after the move. Run the case alone and confirm the scroll assertion fails.
2. In `apps/dashboard/src/widgets/product-list.ts`, reuse the existing `data-availability-saving`
   marker and row rule. Keep the marker through the table’s update and a layout read, then clear it
   once the last write has finished. Enabled anchoring still applies to later updates. Keep the
   existing focus behavior. Make no change to shared tables, the API or bulk selection.
3. Re-run the single case and the full Products screen file. Keep the keyboard focus and scrolled
   refusal cases unchanged. Remove the layout read in a disposable copy and check whether the
   pointer case catches the original jump. Run the lane’s unchanged fiscal and menu-refresh checks
   and finish the branch through normal review and CI.

Expect about 12 production lines and 10 test lines added. The Products redesign remains in the
backlog until its named features ship.
