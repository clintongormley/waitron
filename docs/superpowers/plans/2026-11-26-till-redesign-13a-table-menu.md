# Till redesign 13a. Open table actions from the table name

Tap the table name to open a sheet with Allergies, Guests, Name the party, the Bill requested
switch, Move to another table, Join tables and Split the table. Finish table sits by itself at the
bottom. Each choice opens its current screen or runs its current command.

The [design (§§6, 9.12 and §12)](../specs/2026-11-26-till-handheld-redesign-design.md) at
`46a29becbb` and the [pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md)
set the scope. Its Status line records the owner's approval of both passes. Section 6 quotes the
owner asking to split table and bill choices. On 26 November at 20:35 the watcher cleared this plan
with the changes below. Picture i, frames 1 and 2 in light and dark, supplies the trigger, the
sheet's heading and rows, the switch, and the separate Finish table button. Pass 2 drops the sheet's
floor-edit row. Keep the existing status pin and floor edit routes while the floor slices land.
PR 13b redesigns the bill menu. PRs 14a–d redesign the panels, including A1290 and A1359.
Full invoice, Print and Receipt copy keep their handlers. This changes no receipt or invoice issuing.

## Build

- Create `apps/till/src/screens/table-party-menu.ts` using PR 1’s `wt-row-actions` bottom sheet at
  phone and till widths. The watcher’s 21:39 review replaces the earlier naming rule. Use the active
  table’s name for the trigger and sheet, with the guest count and party name below the trigger. Use
  the shared sheet and rows from #4449 (§14.2). Show the saved allergy summary, guest count and party
  name beside their choices. Keep the status pin for table details. Offer Join and Move for an empty table.
- In `table-bill-controls.ts`, show the existing anchored ⋮ only when there is a current bill.
  Keep the selector used by Full invoice and reuse all bill eligibility and document handlers.
  The bill picker is the route to **+ New bill**. Keep Split for parties at two or more tables.
- Use `wt-row-actions` in panel mode with ordinary controls. The shared sheet focuses the first
  enabled choice. The watcher’s 01:26 note keeps today’s shared switch and makes its whole row
  tappable. The wide sheet starts at the measured order column and ends at the screen’s right
  edge, with even dimming across the display. Bind `wt-switch` through Lit’s `live()` to the saved `billRequestOf` state. Keep the
  busy guard, call the sheet’s `hide()` on an accepted toggle and send the existing `request-bill`
  event once. Use the saved state on reopening after a refusal. In `#refocusMenu` and
  `#placeStepFocus`, return focus to the actual opener. Verify return from the app’s allergy
  dialog too. Keep the existing Back, Escape and discard behavior. Add EN/ES labels in `i18n/strings.ts`.

## Verify and hand off

- Start test-first with a real click on the missing name trigger in `till-table-order-screen.table-menu.test.ts`.
  At 390 px, check that the sheet rises from the bottom and Finish sits last, on its own. Check both
  menus, absence of an empty ⋮, switch refusal and busy state. Preserve the bill-state assertions.
- Run `pnpm --filter @waitron/till exec vitest run` with these `src/` tests and every changed test file.
  Include `till-app-parties`, `till-app-split-table`, `till-app-split-table.reads`,
  `till-app-split-table.snapshot`, `till-app-handheld-pay` and `till-app-allergy`. Under `screens/`,
  include `till-table-order-screen` and its `.table-menu`, `.actions-unsaved`, `.bill-controls.a11y`
  (both themes), `.bill-switcher`, `.parties`, `.split-table`, `.split-table.unsaved`, `.panel-footer`
  and `.loading` tests. Retarget moved locators while keeping their assertions.
- Update both `apps/server/src/guide/*/table-service.md` pages, `docs/developers/design-system.md`
  and the remaining backlog scope. The watcher cleared the larger split at 21:26. Capture before
  and after at phone and till widths in both orientations, themes and languages. Place 390 px captures
  beside frame i at actual size. Send paths outside Git to the watcher for Lane P’s finish review.
  Land after the owner’s picture OK and green CI on the current head.
