# PR 14a implementation plan · Table details

From the table name, open Guests, Name the party or Allergies with Back. The editor fills a
narrow screen or takes the order column on a wide till. Bill requested remains the direct switch
specified in §6 and §14.2 and built in PR 13a.

Use the [approved design](../specs/2026-11-26-till-handheld-redesign-design.md) (§§6, 8, 12–14)
and [pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md). The watcher assigned 14a at 01:40
on 27 November. Claude read this slice against #4456 at `e41a39f0c5cecd056128a915c7bdfe6d99f7a100`.
The watcher assigned 14a the shared wide placement and cleared this plan with these corrections
at 01:59 on 27 November. Build after #4456 lands.

## Build

- Measure the approved HTML in `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`.
  Use `i` 1–2 for the table menu, `h` 3 and `ah` 2 for shared panel bars, and `m`/`s` for the wide
  column. The three editors have no dedicated frame. Keep their existing fields. Follow §14.1 where
  a frame predates the text and §§7.10–7.11 for the borrowed bars.
- In `apps/till/src/widgets/party-guests-dialog.ts`, `party-name-dialog.ts` and the edit mode of
  `party-allergy-dialog.ts`, use `wt-dialog full-screen`, `wt-full-screen-panel`, `wt-top-bar` and
  `wt-foot-button-bar` directly. Each editor owns its fields and buttons. Pay and later editors
  can use the same shared primitives. Move the modal name from `heading` to `aria-label` and name
  the scroll body. Back uses the existing `action.back` strings (Back/Atrás) and replaces the
  editor's Cancel button. Call `requestClose` to use the same leave check as Escape. Keep
  `trackDialog`, nested Escape order, and focus return to the opener, including Change beside the
  allergy summary. Put the form error message and allergy refusal above the foot, with field
  errors beside their input.
- Add the optional start inset in `packages/ui/src/components/wt-dialog.ts`. It defaults to full
  width and dims the whole display evenly, as 13a's sheet does. In `till-table-order-screen.ts`,
  share the `[data-draft-pane]` edge and width decision already used by `#placePartyMenu` with the
  editors. Pass the active order screen's live edge up to `till-app.ts` for the edit-mode allergy
  dialog in both table-order mounts. Keep the same order draft, bill and menu mounted. PR 15b and
  14b–d reuse this placement.
- Keep the name and guest write events, blank to clear, current validation timing and refusal
  reopening. For a changed, invalid guest count, Save stays enabled until the first press shows
  the field error. Keep the allergy editor's read, save, stale review and field refusal behavior.

14b moves Move, Join and Split from the in-page action panel to this route and covers Finish table.
14c–d cover bill actions. Put the phone Send and move allergy prompts in 14d. Their question,
guest and assignment steps have distinct actions and Back behavior. The estimated change to
retain their wide dialog and convert all narrow steps exceeds 60 product lines. Bill requested
is covered by 13a's switch. Seating, payments, receipts, invoices, APIs and stored data
are outside 14a.

## Verify

Write and run the failing panel checks first. Use `pnpm --filter @waitron/till exec vitest run`
with the affected files. Keep existing behavioral assertions, including 13a’s Bill requested checks.

- In `till-table-order-screen.table-menu.test.ts` and `.actions-unsaved.test.ts`, click the rows.
  Check 390 px and wide bounds, Back and Escape, keep/discard, same bill and focus on return.
  Run `widgets/party-{name,guests}-dialog.{save-state,unsaved}.test.ts` and
  `screens/party-{name,guests}.unsaved.test.ts`. Update the old Cancel targets to Back and keep
  the existing leave assertions.
- In `till-app-allergy.test.ts`, check both entry points and reuse `.editor-recovery.test.ts`
  for stale reads and refusals. Run `till-app-allergy.{move,recovery}.test.ts`, the screen's
  `.allergy`, `.allergy.unsaved` and `.allergy.look` cases, and all three editor axe suites in
  both themes. Prove inset and default bounds in `packages/ui/src/components/wt-dialog.test.ts`.
- Update `apps/server/src/guide/{en,es}/table-service.md`, `docs/developers/design-system.md` and
  the `TILL-REDESIGN-1` backlog entry. Compare with the approved HTML at 390 px and till widths,
  portrait and landscape, EN/ES and light/dark. Check keyboard fit. Say in the PR that the editors
  keep today's fields under the shared bars. Send captures outside Git to the watcher for Lane P,
  then the owner. Land after recorded picture OK and current-head CI.

Allow about three hours, with 210–300 changed product lines and 150–220 changed test lines.
