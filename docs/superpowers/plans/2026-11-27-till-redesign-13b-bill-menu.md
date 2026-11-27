# Till redesign 13b. Open bill actions in a sheet

Tap ⋮ beside the current bill to open a sheet headed with its name and balance or status. Staff
can print it, fill in Full invoice before paying, or reach the existing bill actions for that bill.
Choose **+ New bill** in the bill picker.

The [approved design](../specs/2026-11-26-till-handheld-redesign-design.md) at `46a29becbb`
records the owner's approval in Status and the menu split in §6. The
[pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md) assigns this entry point to 13b.
Picture `i`, frame 3, supplies the sheet and action order. §14.4 and `j` frame B supply the 44 px
outlined ⋮ beside the picker. The `i` HTML gives a 40% scrim, 16 px upper corners, 52 px rows and
16 px row labels. Reuse the shared sheet and rows that 13a uses. The action panels belong to 14c–d
and the later invoice form to PR 17. This slice uses the existing operations and forms, including
the existing receipt and correction choices. Receipt and invoice issuing and filing stay as they are.

## Build and check

- In `apps/till/src/screens/table-bill-controls.ts`, build `billActions` with the existing
  `wt-row-actions` bottom menu-sheet variant and `wt-menu-row`. Reuse `billLabel` and `owes` for
  the heading, without the picker's position or unsent marker. Use the sheet's accessible heading
  and keep the localized **Bill actions** trigger name. Dock full width on a phone and share the
  table menu's order-column placement on a wide till. In `till-table-order-screen.ts`, keep the
  trigger alongside the picker and omit it when there is no current bill.
- Order the rows as in `i` frame 3: Print the bill, Full invoice, Move dishes, Merge bills, Move
  this bill, Name this bill, Comp the bill, Record unpaid departure. Keep existing conditions,
  busy states, targets and event listeners. Keep Receipt copy, Nothing was served and Reopen bill
  where currently offered. Use a trailing chevron for choices that open a form or picker. Print and
  Receipt copy act at once. Reuse current EN/ES wording, with menu labels matching the frame in
  `apps/till/src/i18n/strings.ts` where wording changes. Keep the table and bill picker's own actions.
- Start with a real click test in `till-table-order-screen.table-menu.test.ts`. Check the open
  sheet's heading, order and bottom placement at 390 px, and its order-column edge at till width.
  Check Escape returns to ⋮ and a real Print tap emits exactly one request for the shown bill.
  Keep the existing open, paid and presented bill cases, with updated labels and row order. Run
  `pnpm --filter @waitron/till exec vitest run` on that file, `.bill-controls.a11y`, `.bill-switcher`,
  `.actions-unsaved`, `.panel-footer`, `.parties`, `till-app-bill-payments.test.ts` and any other
  changed test file. Keep the existing Full invoice from ⋮ real-click cases for Save, Cancel and
  focus return. Check typecheck and run the shared UI suites only if the shared component changes.
- Update `docs/developers/design-system.md` and both `apps/server/src/guide/*/table-service.md`
  guides. A1290's panel work stays open. Capture the screens at phone and till widths in portrait
  and landscape, light and dark, EN and ES. Compare 390 px against `i` frame 3 next to it and show
  any differences, including the existing picker from `j`. Send the pictures to the watcher for
  Lane P's finish review and the owner's recorded OK before landing with green CI.

Allow about three hours to open the PR, with around 110 production lines added and 90 removed,
and 65 test lines added and 30 removed, plus guides.
