# Dialog close waits — plan

Smallest usable result: tests await the target dialog's `wt-close` or the screen's resulting close event before checking close-driven effects, keeping every behavioral assertion.

Original ask, verbatim from `/Users/clintongormley/waitron-campaign-i/queue.md`, DIALOG-CLOSE-WAITS:
> The ask: find the tests that close a dialog and then check after a single flush, and make each wait for the wt-close event or the screen's resulting close event (CLAUDE.md §4). wt-dialog.test.ts's "closes on a real Escape press" waits for wt-close; the stays-open tests keep their timer. List every changed file in the PR. Test-only. Plan first only if the search finds more than about 15 sites.

The owner's initiating message authorises the campaign, finish-branch and land-branch, not this design.
Claude reviewed the draft on 14 November 2026; the driver applied its smaller-route corrections.
The watcher cleared commit `71878ff38b` at 02:19 in the lane’s local `questions.md`.
The broad candidate count below is not a defect count; calendar day-box actions and Escape paths exceeded about 15 event-owned paths.

1. Finish the narrow audit before editing tests. Classify every entry in
   `/Users/clintongormley/waitron-campaign-i/receipts/dialog-close-20261114/candidates.json`
   (177 matches across 53 files), then search all browser suites for `requestClose`, `closeAfter`,
   native `.close()`, Escape and Cancel/save helpers, including unsaved suites outside that list.
   Record defects, awaited events, refused closes, resets and popovers; trace each handler to its assertion, target event and layout settling.

2. Trace these initial candidates; change only confirmed close-driven waits:

   - `apps/dashboard/src/screens/menus-screen.test.ts`: Add menu save/cancel focus, row-window
     focus (including the 14-case table), reopening and focus after refresh. Classify every
     `afterDialogCloses` call at 1115 onward; some follow layout or direct resets, not closes.
   - `apps/dashboard/src/widgets/menu-publications.save-state.test.ts`: schedule draft reset
     and quiet action after close/reopen (263).
   - `packages/venue-service/src/dashboard/zone-edit-dialog-lifecycle.test.ts`: `closed`, dirty-scope
     disposal and retained-editor reset (77, 93); separate discard work from later close effects.
   - `packages/staffing/src/dashboard/staffing-month.test.ts`: classify the day-box removal and
     focus checks after Escape (1107–1176): `calendar-day-box-close` follows native `toggle`.
   Also classify `apps/dashboard/src/screens/business-day-start-editor.unsaved.test.ts`,
   `apps/dashboard/src/screens/modules-screen.unsaved.test.ts`,
   `packages/staffing/src/dashboard/staff-role-dialog.unsaved.test.ts` and
   `packages/venue-service/src/dashboard/period-dialog.unsaved.test.ts`: distinguish discard
   cleanup/editor removal from refused closes and checks of the close decision alone.
   Reuse dashboard `widgets/test-helpers.ts`'s `dialogClosed(Element): Promise<unknown>` and local
   one-shot promises elsewhere. Capture the target before acting, await its event, then retain
   needed updates/frames and all focus, reset and refusal assertions.
   At nested sites use a local listener checking `event.target === dialog`; keep the shared helper
   unchanged. Leave owner-open checks whose handler already establishes the asserted effect alone.
   Record the popover decision in the PR: repair only effects owned by a delayed close/toggle event;
   synchronous state/visibility checks and refused closes keep their existing waits. No framework.

3. Before repairs, use a registered disposable worktree to probe the menus focus-table case
   “Add products, saved”. A capture listener on the target modal's shadow root stops the first
   native `close`, then resends it once after 500 ms without intercepting its own resend. Keep
   native closing and the `open` poll real. Predict the old focus assertion fails before the close
   report, then verify it; the event-wait repair must pass the same assertions under that delay.
   If focus is already restored independently, record that result and leave that site alone rather
   than manufacture a failure. Keep the probe out of the shipped tree; run repaired files normally.

4. Run every changed file with real Chromium, sequentially, using
   `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts src/widgets/menu-publications.save-state.test.ts`,
   `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/zone-edit-dialog-lifecycle.test.ts`
   and `pnpm --filter @waitron/staffing exec vitest run src/dashboard/staffing-month.test.ts` where changed.
   Add any audit-confirmed changed suite to its package's focused run; read actual Tests counts.

5. Keep `wt-dialog.test.ts`'s already-awaited real Escape case (1c8bd5b22d) and stays-open timer.
   Exclude product behavior, config, thresholds, ignores, test moves and general guards.
   After audit/repair and the recorded popover decision, remove completed entries from
   `docs/backlog.md` and `docs/backlog/ci.md`; retain only work the audit establishes is still open. One PR lists every changed file, with
   finish-branch reviews, the normal push hook and current-head scoped CI; no whole-workspace run.

Expected diff, provisional until classification: tests +200/-80 lines; test support +10/-10 (local settling helpers; shared helpers unchanged); production +0/-0.
Report actual added/removed counts separately. Growth beyond 1.5× this estimate goes to the watcher before build.
