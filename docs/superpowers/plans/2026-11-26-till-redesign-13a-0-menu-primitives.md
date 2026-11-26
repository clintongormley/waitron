# Lane D · 13a-0 shared menu primitives implementation plan

Ship the bottom sheet and menu row in `packages/ui` so 13a and Lane F’s waiting ☰ follow-up can compose them.
The owner approved the design on 26 November, as recorded in Status. The watcher directed the shared-only split
in Lane D’s `questions.md` at 21:58, confirmed in `queue.md` at 22:01. The campaign driver arranges the Claude
read and watcher clearance before building. [Design Status, §§9.9 and 14–14.4](../specs/2026-11-26-till-handheld-redesign-design.md).

- [ ] **Sheet.** In `packages/ui/src/components/wt-row-actions.ts`, let a nonempty `sheet-heading` opt
  `bottom-sheet` into a region named by its visible heading. Expose `sheet`, `sheet-handle` and
  `sheet-heading` parts and style slotted `data-sheet-heading` subheadings for ☰. Reuse the popover,
  fallback, scrolling, safe-area and keyboard insets. `packages/ui/src/components/wt-sheet.ts` serves
  the dashboard’s inline floor editor.
  Match `i` 2–3 and `aj` 1 at 390×844 under §14.2. Use surface paint, 40% scrim, 16px upper corners, a
  0 −8px 24px black shadow at 20%, a decorative 40×5 sunken handle and 12px (`sm`) muted bold capitals.
- [ ] **Row.** Add `packages/ui/src/components/wt-menu-row.ts` and export `WtMenuRow` from `packages/ui/src/index.ts`.
  Use a native `button type="button"` with visible `label`, optional `value` text (including counts),
  `chevron`, `disabled` and `divider`. Register decorative `chevron-right` in `packages/ui/src/components/wt-icon.ts`.
  Use `i`’s 52px minimum and the shared tap floor, 20px/16px logical insets, one 1px divider between rows and
  6px before the 18px chevron. Map the 16px label to regular `lg` and the muted value to `md` (14px per
  §14.2 and `aj`, measured 15px in `i`). Expose `row`, `label`, `value` and `chevron` parts. For a setting,
  `control` mode renders a plain label beside the named `trailing-control` slot for a labelled `wt-switch`,
  with no row button.
  Reuse existing tokens and declare exact menu-only defaults in `packages/ui-core/src/tokens/structure.css`.
- [ ] **Browser checks.** Run each new case red, then green in Chromium. In `packages/ui/src/components/wt-menu-row.test.ts`,
  “paints row tokens and draws one divider” checks computed overrides, value placement and the registered icon.
  In `packages/ui/src/components/wt-row-actions.test.ts`, “paints the opt-in sheet from tokens” checks computed
  overrides and heading/handle geometry. “Tabs into the sheet and closes on a composed row click” checks ordinary
  Tab order, Enter/Space and real pointer activation, one action, and focus return before the handler or on
  Escape/scrim dismissal. Let the native click reach the existing slot handlers. “Keeps disabled rows and switches
  from dismissing the sheet” checks disabled rows are skipped and inert, and switch activation leaves the sheet
  open until the caller closes it. Scope any focus or dismissal fix to the opt-in. Preserve the bill switcher’s placement,
  checked-item focus, arrow navigation and selection.
- [ ] **Accessibility.** In `packages/ui/src/components/wt-menu-row.a11y.test.ts`, axe-check plain action, value,
  count with chevron, disabled, switch off and switch on separately in each theme. In
  `packages/ui/src/components/wt-row-actions.a11y.test.ts`, check “named sheet closed and open” in both themes.
  Remove the plain action’s label once, confirm axe flags the unnamed button and restore it. Check “shows the
  row divider and keyboard focus” in `packages/ui/src/components/wt-menu-row.forced-colors.test.ts` and “outlines
  the open sheet” in `packages/ui/src/components/wt-row-actions.forced-colors.test.ts`.

**Finish line.** Document both APIs in `docs/developers/design-system.md`, demonstrate them in `packages/ui/demo/main.ts`
and compare at 390px in light and dark with `html/i-{light,dark}.html` and `html/aj-{light,dark}.html` from §12.
Run the named UI suites, the bottom-sheet case in `packages/ui/src/popover-fallback.test.ts`,
`packages/ui/src/no-hardcoded-chrome.test.ts`, UI typecheck and the bottom-list and keyboard cases in
`apps/till/src/screens/till-table-order-screen.bill-switcher.test.ts`. Keep the redesign entry in `docs/backlog.md` open.
Screen composition, Finish table, the active trigger and the Bill requested switch styling belong to 13a with
the watcher’s 21:39 fixes. Estimate **150–210 production lines** and **190–260 test lines**.
