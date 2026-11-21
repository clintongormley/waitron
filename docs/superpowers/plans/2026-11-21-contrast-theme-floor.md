# Floor map in Windows contrast themes

**Goal.** Staff can see each table, the held table or drop target, and overdue and forgotten waits on
 the floor plan with a Windows contrast theme active. The Lane D queue item `CONTRAST-THEME-FLOOR`
 sets the scope. Follow [the design-system rule](../../developers/design-system.md#forced-colours-windows-contrast-themes).

## Test the painted map in Chromium

- [ ] Add `packages/ui/src/components/wt-floor-map.forced-colors.test.ts`. Mount a flat, spaced fixture
  with an ordinary table, an overdue table and a forgotten one. Use `emulateForcedColours` and
  `elementPixels` from `packages/ui/src/test-helpers.ts`. Compare marks with nearby surface pixels,
  checking the overdue band inside the shape and the forgotten band outside it. Check a held single
  table and a keyboard-focused held merge for separate, visible selection and focus marks. Include
  a forgotten table too small for a caption with reduced motion enabled. Run this file with
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.forced-colors.test.ts` and
  observe the missing marks before making the change.

## Repaint the marks with the contrast theme's own colours

- [ ] In `packages/ui/src/components/wt-floor-map.ts`, use system colours for the table edge and
  existing selection and focus outlines under `@media (forced-colors: active)`. Use a different line
  style for selection and focus. Preserve the held, drop-target and merge geometry, and their
  offset from the shape. Keep the clearing dashes and existing cue text.
- [ ] In `packages/ui/src/floor-ring.ts`, give the existing `.ring` a border inside its box and
  the existing `.pulse` a line outside it in forced colours. Make the forgotten line dashed and
  keep the overdue band solid. In the map, mark the shape only when its forgotten pulse is
  suppressed by reduced motion, and draw the same dashed line on its pseudo-element in forced
  colours. Keep the outside mark clear of selection and focus; check the case where the two wait
  states appear on the same shape. Keep system colours inside the media rule and keep browser
  colour adjustment enabled. The floor's urgency, motion preferences and gestures use their
  existing rules. [CSS Color Adjustment](https://www.w3.org/TR/css-color-adjust-1/#forced-colors-properties)
- [ ] Rerun the new file and the existing `wt-floor-map.test.ts`, `wt-floor-map.a11y.test.ts`,
  `wt-floor-map.keys.test.ts`, and `floor-ring.test.ts` files. Inspect the map and the till's list or
  tab ring with forced colours active in light and dark themes, at phone and desktop widths in
  English and Spanish. Keep captures in campaign receipts and run `git diff --check`.
- [ ] Replace the open-work note in `docs/developers/design-system.md` with the implemented rule.
  Remove the item from `docs/backlog.md` and `docs/backlog/dashboard.md`. The change covers paint
  and keeps the same staff steps and words. Commit with sign-off and follow Lane D's branch workflow.

Expected size is about 55 product lines, 95 test lines and a short design-system update. The files
above reuse the shared ring styles and browser helpers. There are no new settings, cues or interactions.
