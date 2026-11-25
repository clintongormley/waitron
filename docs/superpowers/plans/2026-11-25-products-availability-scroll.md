# Keep Products still after an availability click

When a pointer change sends a dish to the bottom of the Available sort, the Products table
keeps the same scroll offset. Keyboard changes still keep focus visible. The watcher’s 17:49
note in Lane H’s `questions.md` puts this fix before bulk availability.

This is a scroll jump in the rendered table. In macOS Chromium on
`985efb718fbfb5bdd0f5ded4fb84011855eea760`, the full screen file dropped from 131 to 77 px and
the next dish stayed at the same point inside the scroller. The isolated run held at 36 px,
with the All products row still visible. Partly covering the switched row with the sticky
heading reproduced the 54 px jump in isolation (134 to 80 px). Temporarily turning off scroll
anchoring on the scroller kept it steady. CI's starting scroll position is unverified.

1. In `apps/dashboard/src/screens/products-screen.test.ts`, keep the real pointer click and the
   assertion that the dish moves to the end. Set the scroll after the click, so the row extends
   both above and below the heading's bottom edge. Assert both bounds and a nonzero starting
   offset. Check with focus on the switch and with focus moved away during the write. Wait for
   two frames after the row moves, then assert the exact offset and that the marker is gone.
   Clear the saved table preferences in cleanup. Run the cases alone and confirm both fail on the
   original scroll assertion.
2. In `apps/dashboard/src/widgets/product-list.ts`, reuse the existing `data-availability-saving`
   marker and row rule. Set the marker synchronously in the list's `updated` while a write is
   pending. Clear it in the existing `#scheduleFit` callback after the `clientWidth` read lays
   out the moved row, once the last write has finished. Keep the existing focus behavior, table
   layout and API.
3. Re-run the single case and the full Products screen file. Keep the keyboard focus and scrolled
   refusal cases unchanged and run the refusal case alone as well. In a disposable copy, restore
   the old render-time clear and see the offset assertion fail. Keep the marker permanently and
   see the cleanup assertion fail. Compare outer page scroll on a refusal with the baseline.
   Run the lane’s unchanged fiscal and menu-refresh checks before normal review and CI.

Expect about 5 production lines and 20 test lines added. The Products redesign remains in the
backlog until its named features ship.
