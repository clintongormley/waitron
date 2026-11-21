# Floor map in Windows contrast themes

**Goal.** Staff can see the table edge, held table or drop target, keyboard focus, and overdue and
forgotten waits on the floor map with a Windows contrast theme active. Scope comes from the Lane D
queue item `CONTRAST-THEME-FLOOR` and [the design-system rule](../../developers/design-system.md#forced-colours-windows-contrast-themes).

- [ ] Write the failing Chromium tests. In `packages/ui/src/floor-ring.test.ts`, add forced-colour
  screenshot assertions to the existing `FloorRingProbe` for the inner and outer marks. In
  `packages/ui/src/components/wt-floor-map.forced-colors.test.ts`, test the existing plain edge as
  a control, selection on a held forgotten table, focus and selection on a held merge, and
  forgotten with overdue or clearing on the same shape. A small forgotten table without a caption
  must still have its mark with reduced motion. Use `emulateForcedColours`, `elementPixels` and
  `emulateColorScheme` to sample the lines and the gaps in both schemes. Check the new assertions
  fail for the missing marks or gaps before changing the component styles.
- [ ] In `packages/ui/src/floor-ring.ts`, use an inset system-colour border for `.ring`, keeping
  waiting at half the overdue width. Use a narrow system-colour outline for `.pulse` outside its
  box. Use a dotted forgotten line, a solid overdue line and a dashed fire line. Use `CanvasText`
  for the inner bands and the outer signals. Keep the clearing border's dashes on the shape.
  Add an opt-in to `renderFloorPulse` for the map's forgotten pulse when still. Reuse its span,
  without the animation class and hidden outside forced colours. Keep the normal pulse and its
  timing. Use system colours only inside the media rule and keep browser colour adjustment on.
  [CSS Color Adjustment](https://www.w3.org/TR/css-color-adjust-1/#forced-colors-properties)
- [ ] In `packages/ui/src/components/wt-floor-map.ts`, opt in for that steady forgotten pulse on
  real table shapes. Keep the existing table border. Under forced colours, place the pulse next
  to the shape, then the held or drop-target `Highlight` selection, then keyboard focus, with a
  gap between each band. Adjust the offsets in this mode only. Keep solid focus and make selection
  dashed so the marks differ even if the palette gives them the same colour. Verify alongside
  close neighbours and at the edge of the map. Table positions and gesture handling stay as they are.
- [ ] Run `pnpm --filter @waitron/ui exec vitest run src/floor-ring.test.ts src/components/wt-floor-map`.
  Keep the existing reduced-motion assertion about whether the ordinary pulse is painted. Inspect
  English and Spanish at phone and desktop widths in both themes, with forced colours active.
  Look at the shared ring on till cards, zone tabs and `wt-table-token` as well. This slice gives
  the map a steady forgotten mark. The separate reduced-motion tab fill is outside this scope.
- [ ] Replace the open-work note in `docs/developers/design-system.md` with the implemented rule.
  Remove the map and shared ring entry from `docs/backlog.md` and `docs/backlog/dashboard.md`.
  Save captures to campaign receipts, run `git diff --check` and commit with sign-off.

Estimate about 65 product lines, 110 test lines and a short design-system update. Reuse the current
ring renderer and Chromium helpers. The same states, words and staff steps apply in both modes.
