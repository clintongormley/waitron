# Dialog lifecycle bundle

Keep a till dish edit usable when the same picker returns to the page. Resolve each remaining
question in [the dialog backlog](../../backlog/dashboard.md#bundle-wt-dialog-lifecycle) with a
browser result or a named reason to leave it open. Deliver the changes that pass these checks in one
pull request.

1. **Keep the same picker window.** #2642 is on main at `c7ca274eeb1426f64a825164ee3411630545efcd`.
   In `apps/till/src/widgets/modifier-picker.unsaved.test.ts`, extend the existing A738 reconnect
   case. Retain the original modal node, edit the dish, disconnect and return the picker, then check
   that the same window is modal and Escape still offers Keep and Discard against the original
   draft. The node comparison fails while `modifier-picker.ts` keys the modal by connection.
   Remove that key and reuse `WtDialog.returnToOpeningOrder`. Keep the connection counter that
   stops a pending Add note focus request from crossing a disconnect, and keep draft cleanup and
   registration. Run the picker tests, including quantity and note, and the basket line-edit tests.
   Keep the key if the shared window fails to restore modality or preserve the draft.
2. **Establish the keyboard result in a long form.** Use `packages/ui/src/components/wt-dialog.scroll.test.ts`
   with real Home and End on a selected native field, a plain overflowing control in the same
   browser, and a tall underlying page. Record selection and both scroll positions. The November 9
   review saw End scroll the plain control too. The November 19 compact check kept page scroll at
   800 with both containment settings. Treat the short input result as insufficient. If the form
   follows the native control and the page stays still, document the observed result and close the
   caret entry. If the dialog diverges, keep vertical containment and send the measured difference
   and smallest proposed correction to the watcher before changing key or scroll behavior.
3. **Check the covered window at its callers.** Trace department and zone mounting in
   `packages/venue-service/src/dashboard/venue-departments-shell.ts` and the picker's till hosts.
   The retained November 19 control reproduced Escape reaching the lower window or being swallowed
   when the lower is inserted without restoring the upper. Keep the shared native opening order and
   the department and zone wrapper behavior while this risk is open. If a current screen can put
   the lower editor back while the upper has choices open, give the watcher that exact route and a
   recommendation before changing Escape. The owning tests would be `wt-dialog.test.ts` and the
   department and zone lifecycle suites. Keep native modal order, upper choices, and draft guards as
   acceptance checks. The browser's state-preserving move only applies when the caller moves a node
   that remains connected. The recorded path removes and puts it back.
4. **Close the coverage audit on evidence.** Trace the named printer, payment, backup and device
   fallbacks in `apps/dashboard/src/screens/`. Keep reachable defaults such as a backup reply
   with no `reloadErrorCode` and a device profile with unrestricted zones. Propose deletion only
   where the producer and all inputs guarantee the value. Run each affected screen file if any
   deletion qualifies. Narrow the bundle and index in `docs/backlog/dashboard.md` and
   `docs/backlog.md`. Record each remaining reason in the PR.

Allow 10–50 production lines, 35–110 test lines and up to 30 backlog lines. Trace or browser
controls live in the lane receipts. Run focused Chromium files and inspect the affected picker at
desktop and phone widths, in both themes and languages, before finish-branch.
