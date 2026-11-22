# Reuse the shared text field for prices

Staff still enter and correct prices and choose units as before. The price field gets its
native input, decimal editing, label, help slot, hint and error from `WtInput`. The price field
keeps its own currency sign, sizing, override marker and fixed or clickable unit. The unit
goes in the shared field's `end` slot as fallback content. The backlog entry is in
[Menus and the menu](../../backlog/menu.md#smaller-things-379-surfaced-and-did-not-take).

- [ ] In `packages/ui/src/components/wt-price-input.test.ts`, add a test that the price field is
  a `WtInput`, has one native input, and renders the unit button in `slot[name=end]`. Run it
  on the old field and observe it fail. Keep the EN/ES caret cases byte for byte in both suites.
- [ ] In `packages/ui-core/src/components/wt-input.ts`, use a protected `inputLocale` getter for
  decimal reading and display. Give the subclass a protected `fieldDecoration` getter for the
  native input part, displayed placeholder, extra description IDs, field styling and end-slot
  fallback. A protected `renderFieldContents` arranges the shared label, input and end slot.
  Keep plain `wt-input` and its password and end actions on their current paths.
- [ ] In `packages/ui/src/components/wt-price-input.ts`, extend `WtInput` like `WtModal` extends
  `WtDialog`. Keep the input, descriptions, label and parts in the existing shadow root so
  selectors, focus and accessible ID references still resolve. Keep the amount wrapper for
  currency measurement, and let the price unit take its current space in the layout through
  the end slot. Use `decimalLocale || locale || "en"`, including for the price placeholder.
  Keep `focusUnit()`, the unit event and native focus order. Leave parsing, prices and screens alone.
- [ ] Run the named regression again, then both fields' browser behavior and axe files, the
  dashboard's `extra-list-form.test.ts` and `product-editor.test.ts`, and the till's
  `invoice-correction-dialog.test.ts`. Check both UI packages' typechecks and the affected
  files' mutation results against the 90 floor. Inspect price fields in English and Spanish
  at phone and desktop widths in both themes.
- [ ] Remove the price-input line from the open work in `docs/backlog.md` and
  `docs/backlog/menu.md`, keeping the modifier-rules work. Sign off the implementation commit.

Expect about 65–90 production lines added and 90–115 removed, plus about 15 test lines added.
