# Dialog lifecycle bundle

When a till dish picker is temporarily removed and put back, keep its edits and focus.
Check scroll restoration in the shared dialog's browser suite. Settle the remaining points in
[the dialog backlog](../../backlog/dashboard.md#bundle-wt-dialog-lifecycle)
from the browser evidence and source. Use one pull request.

1. **Keep the picker window.** The shared dialog's reconnect restoration landed in #2444 at
   `1c8bd5b22d0407a187673b8d37293b7f49f87380`.
   In `apps/till/src/widgets/modifier-picker.unsaved.test.ts`, extend the A738 reconnect case.
   Focus the native note field, then remove and return the picker. Check that the same field
   retains focus. Keep the existing checks for native modality, edits, Escape and
   navigation, and Keep and Discard. Confirm the focus check fails when reconnect creates a
   fresh window. In `apps/till/src/widgets/modifier-picker.ts`, remove the Lit key and rely on
   the existing `wt-dialog` reconnect behavior. Update the connection comment to explain why
   the counter still guards delayed Add note focus. Keep draft cleanup and dialog registration.
   Run the picker unsaved, quantity and note files plus the basket line-edit cases. In
   `packages/ui/src/components/wt-dialog.test.ts`, check that an overflowing dialog body
   keeps its scroll position when the dialog itself is put back. The test failed on the
   base. On November 19 at 19:58 the watcher said to “fix it here, reusing the existing restore
   path with the last body position seen while attached.” Do that in `wt-dialog.ts`.
2. **Resolve the caret entry from the existing controls.** The November 9 run-it control saw End
   scroll the overflowing dialog body and a plain overflowing control, leaving selection
   `[0,6]` in both. Its tall-page control saw the page move without containment and stay still
   with it (800 to 4156 without containment, 800 with it). The November 19 compact control
   reported FAILURE: selection stayed at `[0,6]` and page scroll stayed at 800 with both settings.
   Record both results in the PR. Delete the caret backlog entry and record the decision to keep
   native keys and vertical containment, based on the November 9 comparison.
3. **Keep the opening order and both dashboard wrappers.** The department shell's `#content`
   renders either a keyed department editor or a keyed zone editor in one slot. Our source trace
   found no current screen that puts a retained lower editor back under an open upper editor.
   The November 19 native control reproduced Escape closing the lower dialog or doing nothing
   when the lower was raised without restoring the upper. Keep the wrappers because removing them
   changes how editors come back on top and the source trace supplied no screen to verify that
   change. Merge covered-dialog restoration and wrapper cleanup into one open backlog point.
4. **Keep the dashboard fallbacks.** The initial readers load, omitted
   backup reload error, optional returning-device data and unrestricted device-profile zones all
   have empty cases in source. The backlog also allows keeping redundant fallbacks defensively,
   as in its November 17 decision. The watcher cleared adding the printer, payment, backup and
   device files to that decision on November 19 at 19:25. Delete the picker and coverage points
   from `docs/backlog/dashboard.md` and narrow its entry in `docs/backlog.md`.

Expect up to 25 changed production lines and 25 test lines, plus the backlog edit and this plan.
