# Keep equipment switches with their device profile rows

**Finish line.** In a device profile's Equipment tab, switching a receipt, slip, drawer or invoice printer or a card reader changes just that assignment. Keep available rows in place as you switch them. Use Move up and Move down to change printer priority.

**Reproduction.** In Chromium, clicking Office A4 with the invoice list empty made Office and Terrace look on. The native switch that was clicked became the Terrace row. Save still sent only Office. The two render paths reuse switch elements by list position when membership changes the row order. A switch changes its own checked property on a real click.

**Change** in `apps/dashboard/src/screens/device-profiles-screen.ts`. Render printer and reader rows with Lit's keyed `repeat` by equipment id. Keep the initial order (saved assignments first, then available choices) for the edit. For each printer section, remember the row order when editing the list and update it with explicit Move actions. On enable, put that printer in the saved list at its position among the switched-on rows, so the screen and saved priority agree. Preserve the relative order of existing selections and the existing handling of undisplayed ids. Keep the readers in their initial displayed order while toggling them. Keep the existing availability rules, default handling, and save paths. Limit the change to the editor and the English and Spanish `staff.md` guides under `apps/server/src/guide`.

**Checks.**

- In `apps/dashboard/src/screens/device-profiles-screen.test.ts`, click the native controls on the Equipment tab with `userEvent`. Start with the A4 reproduction and cover the other four sections using the same test shape. Check that only the clicked control changes on and off, its row and focus stay in place, and the saved assignment matches the choice. Observe the failure before changing the screen.
- Keep the existing tests for priority, undisplayed ids and defaults. Add a check that changing two switches in reverse screen order saves them in screen order. Run the changed browser file, dashboard typecheck and the guide checks. Look at the Equipment tab in both languages and themes at phone and desktop widths.

**Size.** About 70 added lines in the screen, 60 in tests and a short guide edit in each language.
