# Products list visual fixes

On a phone, see List and Tree above one row of tools and read ordinary names, prices and availability
at a glance. On desktop, Price and Available stay put as you switch views or open a category.

The watcher assigned Lane P’s eight material fixes at 22:14 on 26 November and moved them to Lane I
at 23:55. Follow the [Products design](../specs/2026-11-24-products-list-redesign-design.md) §§1–3
and approved b2 List and Tree pictures. Keep the editor, minor polish and catalogue actions outside this change.

- [ ] **Toolbar.** In `product-list-toolbar.ts`, give the switch in `above-table` full width and
  `equal-width` segments. Use `::part(toolbar-search)` in `product-list-layout.ts` to fit Search
  beside Filter, Select and Customise in focus order. Let it wrap when the controls cannot fit.
- [ ] **Rows.** In `product-list.ts`, `product-list-layout.ts` and `product-list-row-parts.ts`,
  use a part to give product names normal weight. Keep bold category names and distinguish variants by
  indent and band. Use plain red Unavailable under phone names, beside the inline category when shown
  in List. Keep the outlined desktop label. Paint only the unavailable count red. Reduce unused leading
  space and phone Tree indentation while preserving photo and arrow targets.
  In `product-list-category.ts`, give the desktop List Category chip its own part for a roughly 14 px
  marker. Tree swatches and product photo placeholders keep their size.
- [ ] **Prices.** In the same row files, measure why the default columns shift before choosing their
  widths. Replace compact price stacking where the unit fits. Use space from the flexible columns
  for steady Price and Available positions and a separate desktop unit space. Expose the Price
  heading via `column-heading-price` in `wt-data-table.ts` and align its text to the amounts.
  Keep the sort indicator, VAT line, inherited cue and legitimate wrapping at tight widths. If the
  shared file reaches its cap, move existing heading rendering into `wt-data-table-heading.ts`.
- [ ] **Chromium checks.** Watch the named regressions fail before each fix. In `product-browser.test.ts`,
  measure the full-width switch and one tools row at 390 and 430 px in both languages. Retain Tab
  order and the 320 px fallback. In `product-list.test.ts`, measure Price heading and amount alignment
  and steady columns in List and open Tree at 1180 and 1440, including Spanish weight prices and no
  sideways scrolling in the 1180 dashboard’s narrower table. At 390 px in both languages, measure
  the one-line kg price, House, Single and Double coffee names, range and variant count. Check the
  plain label, red suffix and List swatch size. Update the old relative font-weight check to require
  normal weight for both names and keep the indent, joined band and long-name wrapping checks.
  Rerun both files, the dashboard typecheck and `wt-data-table.head-and-cells.test.ts` for the part.
- [ ] **Before landing.** Update the Products design-system notes and the EN and ES guides’ phone
  availability line. Compare 1440, 1180 and 390 px in both themes and languages with the b2 pictures
  outside Git. Include open categories and variants, unavailable items, filters, Select, empty,
  no matches and failed load. Run finish-branch, then land with green current-head CI, Lane P’s
  second review and the owner’s recorded picture approval.

One PR in about three hours. Expect 110–170 added product lines and 110–160 added test lines.
