# PR 14a implementation plan · Table details

From the table name, open Guests, Name the party or Allergies with Back. The editor fills a
narrow screen or takes the order column on a wide till. Bill requested remains the direct switch
specified in §6 and §14.2 and built in PR 13a.

Use the [approved design](../specs/2026-11-26-till-handheld-redesign-design.md) (§§6, 8, 12–14)
and [pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md). The watcher assigned 14a at 01:40
on 27 November. Claude read this slice against #4456 at `e41a39f0c5cecd056128a915c7bdfe6d99f7a100`.
Start once the watcher clears the plan, settles who supplies wide placement, and #4456 lands.

## Build

- Measure the approved HTML in `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`.
  Use `i` 1–2 for the table menu, `h` 3 and `ah` 2 for shared panel bars, and `m`/`s` for the wide
  column. The three editors have no dedicated frame. Keep their existing fields. Follow §14.1 where
  a frame predates the text and §§7.10–7.11 for the borrowed bars.
- In `apps/till/src/widgets/party-guests-dialog.ts`, `party-name-dialog.ts` and the edit mode of
  `party-allergy-dialog.ts`, use `wt-dialog full-screen`, `wt-full-screen-panel`, `wt-top-bar` and
  `wt-foot-button-bar`. Give the modal its `aria-label` and name the scroll body. Back uses the
  existing `action.back` strings (Back/Atrás) and replaces the editor's Cancel button. Route it
  through the same leave check as Escape. Keep `trackDialog`, nested Escape order, and focus return
  to the opener, including Change beside the allergy summary. Put refusals and the form error
  message above the foot, with field errors beside their input.
- Share one wide placement mechanism with Lane I’s PR 15b. Recommend that 14a supply one optional
  start inset in `packages/ui/src/components/wt-dialog.ts`, full width by default, using the same
  dimming as 13a. Reuse `till-table-order-screen.ts`'s `[data-draft-pane]` measurement and width
  decision for the sheet and editors. Pass the live edge from the active order screen up to
  `till-app.ts` for the edit-mode allergy dialog in both table-order mounts. Keep the same order
  draft, bill and menu mounted. Later panels reuse the shared placement.
- Keep the name and guest write events, blank to clear, current validation timing and refusal
  reopening. Keep the allergy editor's read, save, stale review and field refusal behavior.

14b covers Move, Join, Split and Finish table. 14c–d cover bill actions. The Send and move allergy
prompts keep their current presentation in this slice. Seating, payments, receipts, invoices,
APIs and stored data are outside 14a.

## Verify

Write and run the failing panel checks first. Use `pnpm --filter @waitron/till exec vitest run`
with the affected files. Keep existing behavioral assertions, including 13a’s Bill requested checks.

- In `till-table-order-screen.table-menu.test.ts` and `.actions-unsaved.test.ts`, click the rows.
  Check 390 px and wide bounds, Back and Escape, keep/discard, same bill and focus on return.
  Run the name and guest save-state and unsaved suites in `widgets/` and `screens/`.
- In `till-app-allergy.test.ts`, check both entry points and reuse `.editor-recovery.test.ts`
  for stale reads and refusals. Run `till-app-allergy.{move,recovery}.test.ts`, the screen's
  `.allergy`, `.allergy.unsaved` and `.allergy.look` cases, and all three editor axe suites in
  both themes. If 14a supplies the inset, prove opt-in and default bounds in `wt-dialog.test.ts`.
- Update `apps/server/src/guide/{en,es}/table-service.md`, `docs/developers/design-system.md` and
  the `TILL-REDESIGN-1` backlog entry. Compare with the approved HTML at 390 px and till widths,
  portrait and landscape, EN/ES and light/dark. Check keyboard fit. Send captures outside Git to
  the watcher for Lane P, then the owner. Land after recorded picture OK and current-head CI.

Allow about three hours, with 210–300 changed product lines and 150–220 changed test lines.
