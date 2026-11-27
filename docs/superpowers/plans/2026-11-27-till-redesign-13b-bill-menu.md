# Till redesign 13b. Open bill actions in a sheet

Tap ⋮ beside the current bill to open a sheet headed with its name and balance or status. Staff
can print it, fill in Full invoice before paying, or reach the existing bill actions for that bill.
Choose **+ New bill** in the bill picker.

The [design](../specs/2026-11-26-till-handheld-redesign-design.md) at `46a29becbb` gives the menu
split in §6. On 26 November at 20:32 the watcher gave the approval record for this redesign: “The
record is the spec's Status line on main at 46a29becbb”. The
[pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md) assigns this entry point to 13b.
Claude reviewed the plan. The watcher cleared it at 09:56 on 27 November with Print first.
Picture `i`, frame 3, supplies the sheet. Its HTML gives a 40% scrim, 16 px upper corners, 52 px
rows and 16 px labels. §14.4 and `j` frame B supply the outlined 44 px ⋮. Reuse 13a’s sheet and rows.
Use today’s action forms and document handlers. The redesigned action panels belong to 14c–d and
the later invoice form to PR 17.

## Build and check

- In `apps/till/src/screens/table-bill-controls.ts`, render `billActions` using the existing
  `wt-row-actions` bottom menu sheet. Put `data-table-menu` on its host for focus return. Use
  `billLabel` and `owes` for the accessible sheet heading and the localized **Bill actions** name
  for the trigger. Style its part as a 44 px outlined square using `--wt-tap-min`.
- Render the action rows there as native buttons with `wt-menu-row`, leaving the conditions and
  callbacks in `till-table-order-screen.ts`. Keep the existing test hooks, including
  `data-table-menu-bill`. Disable Print for `busy || billPrintPending` and keep the other disabled
  states. Use chevrons for choices that open a form or picker. Print and Receipt copy act at once.
  Frame `i` 3 puts the name and amount in the heading and shows no row values. Use its labels in
  `apps/till/src/i18n/strings.ts` for menu-only keys and keep the shared Print and Full invoice keys.
- In the screen, render ⋮ immediately after the picker, ahead of the dining control, only for a
  current bill. Generalize `#placePartyMenu` and its sheet CSS so both sheets use the order column’s
  left edge on wide tills and fill the width on phones.
- Frame `i` 3 lists Print the bill, Full invoice, Move dishes, Merge bills, Move this bill, Name
  this bill, Comp the bill, Record unpaid departure. That puts the one-tap Print action ahead of
  Full invoice. Say in the PR and with the pictures that printing fixes the invoice type and
  Waitron offers no correction to a full invoice there yet. Keep the guide’s instruction to
  set Full invoice before Print. Remove the old row-order comment in `#billDocumentItems`.
  Receipt copy goes with Print, and Nothing was served and Reopen bill follow the ordinary rows.
- Start with a real click test in `till-table-order-screen.table-menu.test.ts`. Check the open
  sheet's heading, order and bottom placement at 390 px, and its order-column edge at till width.
  Check a real Print tap emits exactly one request for the shown bill.
  Keep the open, paid and presented bill assertions and the Full invoice Save and Cancel focus
  tests. Retarget tag and text selectors to the real buttons. Run the till's affected browser
  tests (find menu consumers with `rg -l 'data-table-menu|data-record-departure' apps/till/src`)
  and every changed test file. Run till typecheck, the root `action-menu-styles` and
  `product-file-size` checks, and the server’s `guide-content` test.
- Update `docs/developers/design-system.md` and both `apps/server/src/guide/*/table-service.md`
  guides. A1290's panel work stays open. Capture the screens at phone and till widths in portrait
  and landscape, light and dark, EN and ES. Compare 390 px against `i` frame 3 next to it and show
  any differences, including the existing picker from `j`. Send the pictures to the watcher for
  Lane P's finish review and the owner's recorded OK before landing with green CI.

Allow about three hours to open the PR, with around 125 production lines added and 100 removed,
and 100 test lines added and 65 removed, plus guides.
