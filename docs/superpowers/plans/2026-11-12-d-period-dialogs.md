# Period dialogs bundle

Authored by Codex Sol-high, 2026-11-12; driver revised after Claude’s approach read.
Status: Claude read completed; corrections applied, pending watcher clearance.
No owner design approval recorded. No build before watcher clearance.

## Request and finish line
Lane D queue.md asks:
> the Periods window is the unsized modal ("about 300 px blank above Close"); at 390 px a colour swatch shrinks; a painter opened from the window does not return to it on close; the delete dialog can keep Delete greyed out.
> Where: `packages/venue-service/src/dashboard/opening-hours-screen.ts:435`, `periods-list.ts`, `period-delete-dialog.ts`. About 200–300 lines. One PR.
> How: short plan, Claude read, build; screenshots EN/ES, both themes, 1280 and 390. Delete the entries in the same PR.

A manager gets a shorter Periods window, equal swatches beside wrapping names and return to
Periods from its Painted in links, including a period editor opened inside it.
Delete recovery is conditional on reproducing its named failure; no fix is presumed necessary.

## Existing pieces and limits
Component/test names below are in `packages/venue-service/src/dashboard/`.
Reuse the chip’s real `seasonPainterPath`/`specialDayPainterPath` href, the plain-click filtering
pattern in `period-editing.ts`, `writeAddress`, `markPushedPainter` and `closePainter`.
Keep full return addresses in existing browser history; no new return record/controller/helper.
Reuse existing mounts/fakes, `captureShellLinks`, `season-painter-fixture.ts` and `window-settled.ts`.
Support changes: zero. No API/server change, migration, general navigation framework or rare-counts fix.
Seasons stays full height. Periods chooses the existing medium height (512 px at default text size):
a long list scrolls sooner, with Close visible. No shared modal sizing change.
The slightly-old-counts backlog bullet remains outside this work.

## Build after clearance
1. **Reproduce the named effects before changing production.** Use the existing screen/list
   browser fixtures; inspect the loaded demo before the visual fixes. Watch each new behavior
   assertion fail for its named reason before its minimal fix. If it already passes, do not add a fix.
2. **Window and swatch:** `opening-hours-screen.ts` selects `size="wide" height="medium"`.
   Add only the mode-selection assertion to the existing Periods-window screen case; shared
   `wt-modal` tests own the pixels. In `periods-list.ts`, prevent `::part(swatch)` flex shrink.
   In `periods-list.test.ts`, at 390 px compare a wrapping row’s rendered swatch width/height
   with its token and a short-name row. Update its M1 modal frame/comment to the selected height.
3. **Return from chips:** update `periods-list.ts`, `period-dialog.ts` and `opening-hours-screen.ts`.
   Intercept ordinary clicks via `data-own-click`; keep href and modified-link behavior unchanged.
   Push the actual chip target, preserving its department and the full Periods origin; use the
   existing painter-entry marker even when Periods was opened over another painter.
   Do not route viewer links through `openSpecialPainter`’s edit-only guard, or replace the chip’s
   department with the screen’s. Preserve draft guards; closing returns to the original window.
   `periods-list.test.ts` replaces its plain-click defaultPrevented=false assertion with plain versus
   modified-click behavior. Existing painter/special-day screen suites own return-address assertions:
   cover both kinds, a viewer’s special-day link, another department and a window over a painter.
   Include one period-editor chip opened from Periods; retain direct-load/unsaved-draft checks.
4. **Delete: one bounded reproduction, no speculative permanent test.** Existing
   `periods-list.delete.test.ts` covers clock refusal (line 466) and an answer while detached (634).
   After clearance, combine the named sequence once in a disposable probe: clock refusal,
   list detach/reappend during the required impact read, answer, then native Delete and new revision.
   If it passes unchanged, add no product fix/test; report “not reproduced” and use the watcher’s
   disposition of that backlog bullet. If it fails, keep the failing behavior case and minimally fix
   `periods-list.ts`/`period-delete-dialog.ts`; avoid duplicating the dialog’s existing render tests.
5. **Verification/docs:** run every changed browser file plus focused list, painter/special-day,
   screen and delete-dialog regressions: `pnpm --filter @waitron/venue-service exec vitest run
   --project browser src/dashboard/<file>.test.ts` (one grouped invocation, actual Tests count).
   Inspect EN/ES × light/dark × 1280/390 screenshots, demo fit and one long list with scrolling/Close.
   Update the Periods sizing/return prose in `docs/developers/design-system.md`; guide twins only
   where staff instructions change. Remove resolved bullets from `docs/backlog/service-periods.md`,
   and correct its bundle count and the index in `docs/backlog.md`; no “fixed” claim for an unreproduced Delete.
   Normal hook, current-head CI and finish-branch review follow; no whole-workspace local run.

Expected diff: production +30–60/−8–20; tests +85–130/−8–20; support +0/−0; docs separate.
Claude report: `~/waitron-campaign-d/receipts/period-dialogs/plan-review.md` (426 s).
