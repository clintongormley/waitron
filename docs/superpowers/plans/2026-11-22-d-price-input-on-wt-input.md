# Reuse the shared text field for prices

Staff still enter and correct prices and choose units as before. The price field inherits the
native input, decimal editing, label, help slot, hint and error from `WtInput`. It keeps its
currency sign, sizing, override marker and fixed or clickable unit. The unit sits in the shared
`end` slot as fallback content. [Open work](../../backlog/menu.md#smaller-things-379-surfaced-and-did-not-take)

- [ ] In `packages/ui/src/components/wt-price-input.test.ts`, assert that the price field is a
  `WtInput`, has one native text input with `inputmode="decimal"`, and renders the unit button in
  `slot[name=end]`. Observe the new test fail on the old field. Keep both EN/ES caret cases
  byte for byte in each suite.
- [ ] In `packages/ui-core/src/components/wt-input.ts`, route every decimal decision through the
  protected `inputLocale` getter, including password eligibility, native type, input mode, the
  live value binding and requests for a redraw. Keep generated IDs prefixed with the element's
  own tag. Use a protected `fieldDecoration` getter for the input part, displayed placeholder,
  extra description IDs, field style and end-slot fallback. A protected `renderFieldContents`
  arranges the shared label, input and slot. Give the price slot a class outside the default
  overlay rules and use `display: contents` so the unit can sit beside or wrap below the amount.
- [ ] In `packages/ui/src/components/wt-price-input.ts`, extend `WtInput` and remove duplicate
  properties and the input handler. Use `decimalLocale || locale || "en"` for editing and the
  displayed placeholder. Keep the amount wrapper for currency measurement. The existing shadow
  root keeps ID references and parts working and lets `menu-prices-table.ts` measure the native
  input. Keep `focusUnit()`, the unit event and native focus order. Price callers still configure
  units with `unit` and `fixed-unit`. A consumer-supplied `end` element replaces fallback as on
  `wt-input`. No current price caller supplies one. The other inherited options remain available
  through `WtInput`. Style the override marker from the price field's reflected `overriding`
  attribute. Update the read-only guidance in `docs/developers/design-system.md` and keep
  its existing disabled fixed-unit advice for prices. Leave parsing and screens alone.
- [ ] Re-run the new case, both fields' browser and axe files, dashboard `extra-list-form.test.ts`,
  `product-editor.test.ts`, `menu-prices-table.test.ts`, `form-fields.test.ts`,
  `purchase-form.test.ts`, and till `invoice-correction-dialog.test.ts`. Give the shared seam one
  small test subclass in `wt-input.test.ts` to exercise fallback and extra descriptions without a
  dependency on `ui`. Once the whole price suite passes, remove price cases that only duplicate a
  shared-input assertion. Keep price-specific behavior and the EN/ES caret cases. Run both UI typechecks and targeted mutation checks. The 90 floor applies
  to each package's merged score. Look at English and Spanish in both themes at phone and desktop widths.
- [ ] Remove the price-input detail in `docs/backlog.md` and `docs/backlog/menu.md`, keeping the
  modifier-rules work. Sign off the implementation commit.

Expect 65–90 production lines added and 90–115 removed, plus about 35 test lines added.
