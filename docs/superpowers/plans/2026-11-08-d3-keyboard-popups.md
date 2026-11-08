# D3 keyboard popups — proposed implementation plan

**Proposed, not approved.** Parent commits this artifact and obtains Claude’s plan read/corrections, then watcher approval. No build is approved. Implementation stays inline, with an observed failing test before implementation code.

> Assignment provenance: Lane D queue, watcher 2026-11-08 10:52, D3 “Pop-up menus and lists work by keyboard and stay on screen (Wt popups: A1256, A1258, A781, A1058)”.

Dependencies, verified ancestors of main per assignment: #2360=`e5bfb0b074718e1d431d9a80a4d405ebd999bc4e`; #1842=`5857195470affed334c7c12a0541ccdc81bbd57a`.

## Build and boundaries

Fix row-action selection focus and menu-only keyboard semantics (A1256), open-menu resize/rotation and cleanup (A1258), shared placement/navigation (A781), and combobox anchor overlap (A1058). Keep A625, A903 and the no-search `aria-required` entry. No dependencies, popup framework, unrelated cleanup or form-semantic changes.

Reading receipts: `wt-row-actions.ts` judges clicks in capture, closes after action handlers, and watches popup size without window resize. `table-bill-controls.ts` and `till-shell.ts` already slot menu/radio content; table actions also open focused steps through `#leavingActions`. `menu-popover.ts` already serves language/theme. Colour tiles select while moving; combobox arrows only highlight and deliberately reach disabled rows. Preserve those differences.

Add small `placePopup` and `nextPopupIndex` helpers, retaining component-owned opening, selection and dismissal. Measure width before height, position before first paint, then remeasure content, viewport and ancestor-scroll changes. Attach listeners/observers only while open; remove on every close/removal. Fit below, otherwise above; if neither fits, scroll on the roomier side without covering the anchor. Preserve `opens-below` preference and partial-row scrolling cue where space permits, logical alignment/RTL, colour’s two/four columns and stable search position where still valid. Relative-time keeps closing on scroll.

For slotted menus alone, add `aria-haspopup="menu"`, checked/first-item opening focus, wrapping arrows and Home/End. Skip hidden/disabled menu actions; handle empty lists. Ordinary slotted content keeps its native Tab sequence. Preserve Escape, Tab exit, `data-keep-open`, links and composed events. Restore eligible selection focus before action handlers can take it elsewhere; never refocus after a dialog/navigation wins, outside click or Tab dismissal. Keep capture-time disabled judgement.

## Exact scope and usable slices

Paths below are relative to the checkout; braces enumerate exact files. Each slice remains usable, takes at most three hours, and joins **one PR**. Estimates count changed implementation/test lines separately, including removals: **600 code / 850 tests** overall.

1. **Menus, 3h: 300 code / 450 tests.** Create `packages/ui/src/popup-helpers{,.test}.ts`; modify `packages/ui/src/menu-popover.ts` and `packages/ui/src/components/wt-row-actions.ts`. Tests/token paints/axe: `packages/ui/src/components/wt-{row-actions,language-chooser,theme-chooser}{.test,.a11y.test}.ts`. Till tests: `apps/till/src/screens/till-table-order-screen.{bill-switcher.test,bill-controls.a11y.test,table-menu.test,actions-unsaved.test}.ts` and `apps/till/src/widgets/till-shell.device-zones.test.ts`.
2. **Fields, 3h: 220 code / 280 tests.** Modify `packages/ui/src/components/wt-{combobox,colour-chooser}{,.test,.a11y.test}.ts`; reuse helpers. Preserve original behavioral assertions during refactoring; replace only assertions explicitly requiring the superseded overlap behavior.
3. **Remaining UI placement copies/documentation, 2h: 80 code / 120 tests.** Modify `packages/ui/src/components/wt-{help-tooltip,relative-time}{,.test,.a11y.test}.ts`; check their existing `.guard.test.ts` twins. Update `docs/developers/design-system.md`, `apps/server/src/guide/{en,es}/table-service.md` at shared `{#bill-switcher}`, `docs/backlog.md` and `docs/backlog/dashboard.md`; delete only the four completed asks and correct bundle counts. Calendar-specific placement and inline address suggestions stay outside scope. Additional files/checks require watcher approval.

## Executable TDD and finish

- For each slice, add regressions first; run `pnpm --filter @waitron/ui test src/popup-helpers.test.ts src/components/wt-{row-actions,language-chooser,theme-chooser,combobox,colour-chooser,help-tooltip,relative-time}{.test,.a11y.test}.ts src/components/wt-{help-tooltip,relative-time}.guard.test.ts`. First failures: slice 1 menu arrows/focus and resize bounds; slice 2 bottom/no-search overlap; slice 3 constrained tooltip overlap. Helper tests mount real controls and assert focus, emitted selection and visible bounds, not formulas alone.
- Run `pnpm --filter @waitron/till test src/screens/till-table-order-screen.{bill-switcher.test,bill-controls.a11y.test,table-menu.test,actions-unsaved.test}.ts src/widgets/till-shell.device-zones.test.ts`. Use real keyboard bill selection, update the selected bill through its event, assert label/radio/focus; include delayed leave-dialog focus. Observe failures, minimally implement, rerun both commands with reported test counts.
- Cover top/bottom/neither-side constraints, resize/rotation while open, arriving content, scrolling, disabled/hidden/empty/RTL, Tab/outside dismissal and close/removal/reopen teardown. Retain token paints and both-theme axe states. Check guides with `pnpm --filter @waitron/server test src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
- LOOK using the named mounted suites at phone/desktop, English/Spanish, light/dark; no extra harness files. Commit no mockups/screenshots. Finish when bill switcher and row menus work by keyboard and remain visible, focused checks pass, and backlog/docs agree; announce readiness for `finish-branch`, whose normal hook/review/current-head CI still apply.
