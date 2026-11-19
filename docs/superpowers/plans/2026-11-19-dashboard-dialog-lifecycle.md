# Dialog lifecycle bundle

When a till dish picker is temporarily removed and put back, keep its edits, focus and scroll
position. Settle the remaining points in [the dialog backlog](../../backlog/dashboard.md#bundle-wt-dialog-lifecycle)
from the browser evidence and source. Use one pull request.

1. **Keep the picker window.** #2642 is on main at `c7ca274eeb1426f64a825164ee3411630545efcd`.
   In `apps/till/src/widgets/modifier-picker.unsaved.test.ts`, extend the A738 reconnect case.
   Focus the native note field, put the overflowing modal body at a nonzero scroll position,
   then remove and return the picker. Check that the same field retains focus and the body
   retains its position. Keep the existing checks for native modality, edits, Escape and
   navigation, and Keep and Discard. Confirm the focus check fails when reconnect creates a
   fresh window. In `apps/till/src/widgets/modifier-picker.ts`, remove the Lit key and rely on
   the existing `wt-dialog` reconnect behavior. Update the connection comment to explain why
   the counter still guards delayed Add note focus. Keep draft cleanup and dialog registration.
   Run the picker unsaved, quantity and note files plus the basket line-edit cases.
2. **Resolve the caret entry from the existing controls.** The November 9 run-it control saw End
   scroll the overflowing dialog body and a plain overflowing control, leaving selection
   `[0,6]` in both. Its tall-page control saw the page move without containment and stay still
   with it. The November 19 compact control kept selection `[0,6]` and page scroll at 800 with
   both settings. Record those observed results in the PR. Keep vertical containment and the
   browser's native keys.
3. **Keep the opening order and both dashboard wrappers.** The department shell's `#content`
   renders either a keyed department editor or a keyed zone editor in one slot. Our source trace
   found no current screen that puts a retained lower editor back under an open upper editor.
   The November 19 native control reproduced Escape closing the lower dialog or doing nothing
   when the lower was raised without restoring the upper. Keep covered-dialog restoration and
   wrapper cleanup as open backlog points with those reasons. Any change to Escape routing or
   the wrappers' visible reopening behavior goes to the watcher with a real route and a browser
   check.
4. **Keep the dashboard fallbacks with watcher clearance.** The initial readers load, omitted
   backup reload error, optional returning-device data and unrestricted device-profile zones all
   have empty cases in source. The backlog also allows keeping redundant fallbacks defensively,
   as in its November 17 decision. Ask the watcher to extend that decision to the named printer,
   payment, backup and device files. Update `docs/backlog/dashboard.md` and `docs/backlog.md`
   with the decisions and the work still open.

Expect up to 10 changed production lines, 25 test lines and 25 backlog lines, plus this plan.
