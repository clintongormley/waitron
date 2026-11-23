# Row menus implementation plan

The dashboard, till and module menus use the approved start-aligned action rows and one
offline icon per verb. Use the [owner design](../specs/2026-11-23-row-menus-design.md).
Keep the current controls, action handlers, help badges, focus and placement.

1. **Shared appearance.** In `packages/ui/src/components/wt-row-actions.ts`, give list popups
   `--wt-space-1` padding and a viewport-clamped 12rem minimum using a structure token.
   Replace the inherited centring override with inherited row appearance values so slotted
   `wt-button`s and buttons in help rows and groups get the same skin. In
   `packages/ui-core/src/components/wt-button.ts`, read those values in base, variant,
   hover and disabled rules, and give the button an optional leading decorative `icon`.
   Use a shared style fragment for the corresponding native buttons and links. Scope grouped
   native rows to their existing hosts in `table-bill-controls.ts` and `till-shell.ts`.
   Keep group layout, bill metadata and the existing choice semantics. Only the bill and
   counter-zone pickers get the leading check column. The alerts bell retains its panel
   padding and button treatment. The standalone reader picker, floor List/Map toggle layout,
   language and theme controls, switch, group headings, status text, disclosure and branding
   retain their layouts. Leave shared `menuOptionStyles` alone.
2. **Call sites and assets.** Register namespaced, pinned Material Symbols outlined paths
   beside kebab in `packages/ui/src/components/wt-icon.ts`, and identify them in the existing
   notice in `deploy/third-party/README.md`. Inventory both tag names and their action builders
   in the apps and the adjustments, fiscal-verifactu, media, staffing and venue-service modules.
   Include Devices and Printers through the dashboard alias and Calendar's
   `ColumnMenuItem` icon from `staffing-grid.ts` through `paint-grid-parts.ts`. The lane's
   `receipts/row-menus/icon-choices.md` supplies the proposed additions while the owner
   considers them. Keep the icon mapping in the spec table and give New bill Add.
   Keep ordinary rows in order, then reversible Remove/Disable, then red Delete. Mark Delete
   explicitly and reserve the direct-bin marker for callers that already use it. Render
   one shared-style separator before the tail only if both sections have rows. Match the
   till's existing menu separators to those tokens. The menu skin removes button fills,
   keeps the disabled treatment, and gives Void the normal Remove appearance. Keep the two
   separate Disconnect presses and their accessible labels. Use the existing second-step
   wording as its armed cue, pending watcher confirmation. Trace which labels ask for more
   in a dialog and change EN/ES together, with choice-specific strings where copy is shared.
3. **Test first, then verify real menus.** Extend `wt-row-actions.test.ts` and
   `wt-row-actions.a11y.test.ts` for token paint, nested help rows, links, checked column,
   Delete/divider, disabled, focus and hover in both themes where applicable. Keep the
   direct-Delete and event assertions. Run `wt-menu-row.test.ts`, `tap-target-and-focus.test.ts`,
   the action-menu and token guards, and affected tests in every consuming package, including
   the dashboard alias and till shell look tests. List intentionally changed assertions in the
   PR. Inspect and attach screenshots of the six menus named in the design at desktop
   and phone widths in both themes, and check Spanish labels. Update every superseded
   row-menu description in `docs/developers/design-system.md` and `DESIGN.md`.
   This queued design has no matching open backlog entry, so check for stale references.

Estimate: +450–650 / −100–170 production lines and +130–195 / −45–90 test lines.
