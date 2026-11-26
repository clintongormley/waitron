# Till redesign 13a. Open table actions from the table name

Tap the table name to open a sheet with Allergies, Guests, Name the party, the Bill requested
switch, Move to another table, Join tables and Split the table. Finish table sits by itself at the
bottom. Each choice opens its current screen or runs its current command.

The [design (§§6, 9.12 and frame i)](../specs/2026-11-26-till-handheld-redesign-design.md) at
`46a29becbb` and the [pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md#prs-after-the-bill-picker)
set the scope. The 26 November 20:18 watcher note applies pass 2's removal of Floor plan details.
PR 13b redesigns the bill menu. PRs 14a–d redesign the panels, including A1290 and A1359.

## Build

- Create `apps/till/src/screens/table-party-menu.ts` using PR 1’s `wt-row-actions` bottom sheet at
  phone and till widths. Show the known allergy summary, guest count and party name beside their
  choices. In `till-table-order-screen.ts`, use `detailsHeading` for one table, `partyTablesLabel`
  for a party spanning several, and Table actions as the fallback. Pass the active table ID from
  both mounts in `till-app.ts`. The status pin opens table details. This table-name trigger occupies
  the name position Lane F’s order header will use. Offer Join and Move when there is no party.
- In `table-bill-controls.ts`, show the existing anchored ⋮ only when there is a current bill.
  Keep the selector used by Full invoice and reuse all bill eligibility and document handlers.
  The bill picker is the route to **+ New bill**. Keep Split for parties at two or more tables.
- Use `wt-row-actions` in panel mode with ordinary controls. On open, focus the first enabled
  choice. Bind `wt-switch` through Lit’s `live()` to the saved `billRequestOf` state. Keep the
  busy guard, call the sheet’s `hide()` on an accepted toggle and send the existing `request-bill`
  event once. Use the saved state on reopening after a refusal. In `#refocusMenu` and
  `#placeStepFocus`, return focus to the actual opener. Verify return from the app’s allergy
  dialog too. Keep the existing Back, Escape and discard behavior. Add EN/ES labels in `i18n/strings.ts`.

## Verify and hand off

- Start test-first with a real click on the missing name trigger in `till-table-order-screen.table-menu.test.ts`.
  Check both menus, absence of an empty ⋮, switch refusal and busy state, and Finish at A1265’s
  390×844 and 1280×900 sizes. Check scrolling at shorter heights. Preserve the bill-state assertions.
- Run `pnpm --filter @waitron/till exec vitest run` with these `src/` tests and every changed test file.
  Include `till-app-parties`, `till-app-split-table`, `till-app-split-table.reads`,
  `till-app-split-table.snapshot`, `till-app-handheld-pay` and `till-app-allergy`. Under `screens/`,
  include `till-table-order-screen` and its `.table-menu`, `.actions-unsaved`, `.bill-controls.a11y`
  (both themes), `.bill-switcher`, `.parties`, `.split-table`, `.split-table.unsaved`, `.panel-footer`
  and `.loading` tests. Retarget moved locators while keeping their assertions.
- Update both `apps/server/src/guide/*/table-service.md` pages, `docs/developers/design-system.md`
  and the remaining backlog scope. Estimate 150 changed production lines and 250 test lines.
  After clearance, capture before and after at phone and till widths in both orientations,
  themes and languages. Send paths outside Git to the watcher. Land after the owner’s picture OK
  and green CI on the current head.
