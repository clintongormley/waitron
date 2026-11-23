# Row menus implementation plan

The dashboard, till and module menus use the approved start-aligned action rows and one
offline icon per verb. Use the [owner design](../specs/2026-11-23-row-menus-design.md) and
its mock-up. Keep the existing controls, headings, help badges, click handlers, placement and
keyboard behaviour. The alerts panel keeps its current layout. No new icon font or dependency.

1. **Shared appearance.** In `packages/ui/src/components/wt-row-actions.ts`, keep the popover
   logic, set the list popup's padding to `--wt-space-1` and clamp its 12rem minimum to the
   available viewport. Add a structure token in `packages/ui-core/src/tokens/structure.css`.
   Give the alerts bell an explicit panel layout so its current sizing and padding still apply.
   Give `wt-button` an opt-in `row-icon` attribute in
   `packages/ui-core/src/components/wt-button.ts`. It draws a decorative `wt-icon` and uses
   menu row styles for that control only, with normal label weight, a fixed icon column,
   neutral hover/press, the existing focus ring and disabled styles. Apply the same declarations
   to links and native controls in `wt-row-actions.ts`, `wt-menu-row.ts` and the grouped
   menu styles in `packages/ui/src/menu-popover.ts`. Native controls and links keep their original
   elements and get a decorative icon in the template. Checked choices use the existing check
   glyph in the same leading column. Keep the current grouping and secondary information in
   bill choices. Use a slotted divider and the Delete icon's name to style destructive rows;
   omit the divider when Delete is the only action so its bin shortcut still applies.
2. **Call sites and assets.** Register namespaced paths beside the kebab in
   `packages/ui/src/components/wt-icon.ts`, using the pinned upstream Material Symbols
   outlined paths scaled to its 16×16 view box. Cite the upstream source and existing shipped
   Apache notice in `deploy/third-party/README.md`. Use the menu inventory command in the
   review brief to cover direct tags, the dashboard alias in `apps/dashboard/src/widgets/row-actions.ts`,
   and their action builders in both apps and the adjustments, fiscal-verifactu, media,
   staffing and venue-service dashboards. Map by the action's intent in the template, with
   no lookup from translated text. Retain order among ordinary rows; put reversible Remove
   and Disable after the divider and Delete last. Trace dialog-opening labels and update
   English and Spanish together, using menu-specific strings where a shared label would
   change outside the menu. Route unmatched verbs through the watcher before assigning icons.
3. **Test first, then verify real menus.** Extend `wt-row-actions.test.ts` for list token
   painting (button, link, help row, checked column, divider, disabled, focus and hover),
   and `wt-row-actions.a11y.test.ts` for those states in light and dark. Replace only the
   assertions that pin the old look and list each before/after in the PR. Run those files,
   `wt-menu-row.test.ts`, the action-menu style and token guards, and the affected tests
   in every consuming package. Run the lane's CI checks on the reviewed head. Inspect the
   six menus named in the design on the isolated demo at desktop and phone widths in both
   themes, with the Spanish labels checked as well. Attach the screenshots to the PR from
   local receipts. Update the primitive contract in `docs/developers/design-system.md` and
   the Components section of `DESIGN.md`. Check the backlog for stale references to this
   design when finishing.

Estimate: 450–650 production lines added, 100–170 removed, including view and language
edits and icon paths, plus 110–160 test lines added and 35–75 removed. Update the design's
verb table only with the owner choices the watcher returns.
