# Period dialogs bundle

Authored by Codex Sol-high (GPT-6.1 Sol, high effort), 2026-11-12.
Status: pending Claude approach review and watcher clearance; no owner design approval recorded. No build before both.

## Request and finish line

Queue ask, recorded in the driver brief for Lane D:
> ### Period dialogs bundle — pending
> - Ask (docs/backlog/service-periods.md:485, four entries): the Periods window is the unsized modal ("about 300 px blank above Close"); at 390 px a colour swatch shrinks; a painter opened from the window does not return to it on close; the delete dialog can keep Delete greyed out.
> - Where: packages/venue-service/src/dashboard/opening-hours-screen.ts:435, periods-list.ts, period-delete-dialog.ts. About200–300lines. One PR.
> - How: short plan, Claude read, build; screenshots EN/ES, both themes,1280and390. Delete the entries in the same PR.

A manager can use a shorter Periods window, read equal-sized swatches beside wrapping names,
open either kind of Painted in chip and return to Periods, and retry Delete after its required refresh. One PR; A1209 PR2956 and other lanes remain independent.

## Existing pieces and boundaries

All component/test filenames below are under `packages/venue-service/src/dashboard/`.
Reuse `calendarWindowPath`, `seasonPainterPath`, `specialDayPainterPath`, `writeAddress`,
`markPushedPainter` and `closePainter`; keep the existing draft and navigation guards.
Reuse local mounts/fakes, `captureShellLinks`, `season-painter-fixture.ts` and `window-settled.ts`
under `packages/venue-service/src/testing/`; test-support changes: zero.
Use the existing modal sizing contract and `PERIOD_COLOUR_TOKENS`, styling table cells via parts.
Seasons is a width reference, not another window to change; its unsized modal is also full height.
No new record, controller, framework, helper, API/server behaviour or migration.
Leave the fourth backlog bullet, rare slightly old delete counts, outside this work under RUNNER's unlikely-clash rule.

## Build after review and clearance

1. **Reproduce before fixing.** Add focused browser assertions for each named defect; run each
   against unchanged production code and record its expected failure before its minimal fix.
   - `opening-hours-screen.painter.test.ts`: measure the loaded Periods modal at 1280 × 900;
     expect the shared medium-height token rather than viewport height, retaining wide table room.
   - `periods-list.test.ts`: at 390 px, make a period name wrap and compare its rendered swatch
     width and height with `--wt-space-4` and a short-name row. This layer owns cell layout.
   - `opening-hours-screen.painter.test.ts` and `opening-hours-screen.special-day.test.ts`:
     click actual season/special-day Painted in links with `userEvent.click` through shell capture;
     close the painter and assert the original Periods address and visible window return.
   - `periods-list.delete.test.ts`: reuse the changed-clock refusal setup, detach/reappend the
     list while its required impact read waits, then answer it; assert the native Delete button
     enables, retains an offered replacement and submits the refreshed revision. This layer owns recovery.
   If any defect no longer reproduces, report that result to the driver and avoid an unnecessary fix.
2. **Apply only reproduced fixes.** In `opening-hours-screen.ts`, explicitly choose `size="wide"`
   and `height="medium"`; preserve the existing desktop width and shared scrolling/footer behaviour.
   In `periods-list.ts`, prevent swatch shrink using its existing token dimensions and part styling.
   Route ordinary chip activation through the screen's existing painter navigation/return machinery,
   respecting the shell's `data-own-click` convention; retain each chip's target and full Periods origin.
   Keep normal modified-link behaviour and existing direct-load/unsaved-draft assertions.
   Fix only the reproduced delete recovery in `periods-list.ts`/`period-delete-dialog.ts`.
   `period-delete-dialog.test.ts` owns rendering from impact/busy/refusal properties; retain its checks
   and add a native-control assertion there only if that component's rendering needs a change.
3. **Verify and close the documentation.** Run changed browser files and the existing focused
   screen, list and delete-dialog suites; include `opening-hours-screen.test.ts` as a screen regression check.
   Run `pnpm --filter @waitron/venue-service test --project browser src/dashboard/<file>.test.ts` for the named files, grouped in one invocation; require an actual passing Tests count.
   Inspect screenshots in EN/ES, light/dark, at 1280 and 390 px after content loads, including return
   and recovered Delete; keep screenshots uncommitted. Update `docs/developers/design-system.md`
   where sizing/return prose changes. Adjust guide EN/ES twins only if staff actions actually change.
   Remove the resolved first three bullets (four concrete issues) from `docs/backlog/service-periods.md`.
   Use the normal hook and current-head scoped CI; no whole-workspace local run. During `finish-branch`,
   use one Claude run-it review and one fresh read of fixes; two reviews only for an actual risk trigger.

Expected diff: production +35–60 / −10–20 lines; tests +150–190 / −0–10; support +0 / −0.
Documentation is separate. Report actual additions/removals by category; material growth goes to the watcher.
