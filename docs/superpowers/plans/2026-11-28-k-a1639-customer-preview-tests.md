# Customer menu preview test fixes

Managers can switch the phone preview to Computer and jump to a menu section. Keep checking that
the link moves the canvas, focuses the heading and leaves the dashboard and browser address alone.
Land the timing fix from main before rebasing the customer-menu sharing PR #4579.

## Wait for the Computer preview before pressing its section link

In `apps/dashboard/src/screens/menus-screen.customer-preview.test.ts`, wait two animation frames
after the size choice in the existing 390 px Computer case. The test can read the active section
left by Phone mode before the resize observer has moved scroll tracking to the Computer canvas.
Keep the keyboard interaction and all assertions. A disposable test that switches and activates the
link in the same turn reproduces canvas scroll 0 and dashboard scroll 395. With the frame wait, it
reaches canvas scroll 601 and dashboard scroll 0. The exact callback timing in CI is unmeasured.

## Check price alignment at a wide desktop size on #4579

The watcher cleared the revised approach on 28 November 2026 at 16:03, after Claude's plan read.
The GitHub run for the named-styles PR passed the preview file before it landed. In the same local
Linux Chromium setup at 1200 px, the heading measured 258 px at its green CI head `8dbb07e001` and
225.11 px at both sharing heads `7db84413c0` and `05ee6b98b4`. The price range measured 121.56 px
in all three, and the alignment assertion failed locally in all three. The sharing card gives its
settings more space. Check side-by-side price alignment at 1440 px on that branch, keeping the
existing narrow-price wrap and phone assertions. Run the changed preview file and the customer
menu page tests. Both changes fit in the existing test file and leave the product and guides alone.
