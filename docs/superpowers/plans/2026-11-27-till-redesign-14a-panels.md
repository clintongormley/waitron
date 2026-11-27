# PR 14a implementation plan · Table details

From the table name, open Guests, Name the party or Allergies with Back. The editor fills a
narrow screen or takes the order column on a wide till. Bill requested acts directly in the sheet.

Use the [approved design](../specs/2026-11-26-till-handheld-redesign-design.md) (§§6, 8, 12–14)
and [pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md). The watcher assigned 14a to Lane E
at 01:40 on 27 November. The planning base is #4456 at `e41a39f0c5cecd056128a915c7bdfe6d99f7a100`.
Start the build once the watcher clears the plan and #4456 lands.

## Build

- Measure §12’s approved HTML in `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`.
  Use `i` 1–2 for the menu trigger, rows and switch, `h` 3 and `ah` 2 for the shared action panel,
  Back and foot, and `m`/`s` for the wide order column. The three editors use existing fields and
  labels with those shared pieces. Follow §14.1 where frames predate the text and §§7.10–7.11 for
  the borrowed bars.
- Add `apps/till/src/widgets/table-party-panel.ts`. Use the existing `wt-dialog full-screen` for
  modal focus, keyboard clearance and leave checks, and `wt-full-screen-panel`, `wt-top-bar` and
  `wt-foot-button-bar` for the scrolling body, Back and actions. In `packages/ui/src/components/wt-dialog.ts`
  allow an optional `--wt-dialog-full-screen-start` inline inset, default zero. Use the actual
  `[data-draft-pane]` edge in `till-table-order-screen.ts`, following its existing width decision
  and remeasuring on resize. Keep the draft, selected bill and menu mounted underneath.
- Use the layout in `party-guests-dialog.ts` and `party-name-dialog.ts`. Keep `wt-input`, blank to
  clear, validation and `draftScopeFor`, with Save enabled only for a valid change. Preserve the
  existing write events and refusal reopening with the submitted value. In `party-allergy-dialog.ts`
  use it for edit mode only. Wire the same placement from `till-app.ts` through both table-order
  mounts. Keep the current-party read, save, stale review and field refusals with the app.
- Route Back and Escape through the existing leave check. Keep `trackDialog`, nested Escape order
  and focus return to the opener, including Change beside the allergy summary. Keep `table-party-menu.ts`’s
  shared switch, whole-row activation, busy guard, one event, and saved state after a refusal.

14b covers Move, Join, Split and Finish table. 14c–d cover bill actions. Seating, allergy prompts
for Send and moves, payments, receipt and invoice issuance, APIs and stored data stay outside 14a.

## Verify

Write and run the failing panel checks first. Use `pnpm --filter @waitron/till exec vitest run`
with each affected test file. Keep the existing behavioral assertions.

- `till-table-order-screen.table-menu.test.ts` and `.actions-unsaved.test.ts` under `screens/`.
  Click the real rows. Check 390 px and wide bounds, Back and Escape, discard/keep, the same bill
  on return and focus. Verify on/off and busy on the row and switch. In `till-app-parties.test.ts`,
  keep the name and guest write checks and assert that a refused switch reopens at its saved value.
- Run each name and guest widget’s save-state and unsaved suite for validation, clearing and draft
  retention. In `till-app-allergy.test.ts` and `.editor-recovery.test.ts`, cover both edit entry
  points and reuse the stale/refusal cases. Run the existing Send and axe checks for the widget.
  In `wt-dialog.test.ts`, prove the inset affects only opted-in full-screen dialogs.
- Update both `apps/server/src/guide/{en,es}/table-service.md` pages, `docs/developers/design-system.md`
  and the `TILL-REDESIGN-1` backlog entry. Compare the build with the approved HTML at 390 px and
  till widths, portrait and landscape, in EN/ES and light/dark. Check keyboard fit. Give the watcher
  uncommitted captures for Lane P, then the owner. Land after recorded picture OK and current-head CI.

Allow about three hours, with 230–320 changed product lines and 150–220 changed test lines.
