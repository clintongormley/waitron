# Lane D · 13a-0 shared till menu components

Give the table menu and Lane F’s ☰ menu a shared sheet and row in `packages/ui`.
The spec’s Status records the owner’s design approval on 26 November. The watcher
assigned this component slice in Lane D’s `questions.md` at 21:58. [Design §§9.9 and 14.2][design].

- [ ] **Sheet.** Extend `packages/ui/src/components/wt-row-actions.ts` with
  `sheet-variant="menu"` on `bottom-sheet`, independent of the optional visible
  `sheet-heading`. Name the sheet from its heading or the existing trigger label.
  Use the existing popover, dismiss, scrolling and inset paths. Scope new paint to
  the variant. In `i` frames 2–3 and `aj` frame 1, use a 40% scrim, 16px top
  corners, an upward 0 −8px 24px shadow at black 20%, a centered 40×5 sunken
  handle and 12px bold muted caps with `--wt-letter-spacing-caps`. Style direct slotted `data-sheet-heading` sections
  for ☰. Clear outer padding and borders while keeping safe-area insets. Today’s
  bill picker keeps its existing presentation and keyboard behavior.
- [ ] **Row.** Extend `packages/ui/src/components/wt-menu-row.ts` with an opt-in
  `action` that draws a native button with `label`, trailing `value` (text or
  count), and optional `chevron`, `disabled` and `divider`. Keep the default slot and
  the existing help badge beside the action. Use a 52px minimum and the tap target
  floor, 20px/16px inline insets, one 1px divider, regular `lg` label, muted `md`
  value and 6px before the decorative 18px icon. Register `chevron-right` once in
  `packages/ui/src/components/wt-icon.ts`. Use existing tokens first and add missing
  dimensions to `packages/ui-core/src/tokens/structure.css`.
- [ ] **Focus and action.** In the opt-in sheet, focus the first enabled control
  on open. Tab between controls and dismiss at either end, returning focus to
  the trigger. Keep the native composed click so the existing sheet handler
  sees it. Include only action-mode rows in the existing anchored sizing query,
  so `opens-below` can still show half the next row when more actions fit below.
- [ ] **Checks.** Run new Chromium cases red, then green. In `packages/ui/src/components/`,
  extend `wt-menu-row.test.ts` for token painting, value and icon, and help beside
  the action. Extend `wt-row-actions.test.ts` for sheet tokens, focus in and out,
  pointer and keyboard activation once, Escape and scrim dismissal, and anchored
  sizing. Extend both `.a11y.test.ts` files for named open and closed sheets, and
  plain, value, count with chevron, disabled and help rows, in both themes.
  Delete the action label once and verify axe fails. Add each
  `.forced-colors.test.ts` for visible borders and focus. Run the bottom-sheet case
  in `packages/ui/src/popover-fallback.test.ts`, the UI chrome and type checks, and
  the bottom-list and keyboard cases in
  `apps/till/src/screens/till-table-order-screen.bill-switcher.test.ts`.

**Finish line.** Document both APIs in `docs/developers/design-system.md` and add a
workbench example in `packages/ui/demo/main.ts`. Compare it with the approved
`i` and `aj` HTML at 390px in light and dark. Allow **150–210 production lines** and
**190–260 test lines**. Screen wiring, Finish table, the active trigger and
Bill requested stay in 13a. The redesign stays open in the backlog.

[design]: ../specs/2026-11-26-till-handheld-redesign-design.md
