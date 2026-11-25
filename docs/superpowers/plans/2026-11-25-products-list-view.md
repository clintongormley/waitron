# Products List and Tree views · Piece 7(b)

[Design §§1–6 and Delivery 7(b)](../specs/2026-11-24-products-list-redesign-design.md). Start from the finished 7(a) Tree. Keep the editor’s Change link until piece 5. Back and bulk availability have their own pieces.

## First PR · List, view switch and Add product

On 25 November the owner reviewed the List screenshots. Follow [the revised design](../specs/2026-11-24-products-list-redesign-design.md#4-finding-things) for product and variant search in List, and keep the toolbar and both Add buttons in empty List and Tree.

Staff can switch views and add or find dishes in List. Category is omitted from phone List rows until the second PR. Say so beside the 390 px pictures.

- In `apps/dashboard/src/widgets/product-list.ts`, reuse the table and cells. Omit root and category rows in List. Variants open under their dish. Put the Category column in `product-list-category.ts` using `category-form.ts`. Show a plain swatch and one path. Search by product or variant name and use Category to filter through descendants. Default to Name, Category, Price, Available and pinned ⋮. At 440 px or less of the Products browser’s own width, start with Category hidden and retain its filter.
- In `product-browser.ts`, move the toolbar to `product-list-toolbar.ts`. Use `wt-segmented-control` and remember the chosen view under `waitron.products.view`, initially List. A category address opens Tree without replacing the saved choice. Tree stays open when closing that category clears its address. Switching to List clears the address. Clear ticks, reset the reveal cache and keep search and common filters. Clear Category before leaving and after entering List. Reset its sort to Name on departure. Drag handles belong to Tree. Use the slot after Search. At 440 px or less, put the switch above the toolbar. Keep notices below the toolbar. Keep switch focus.
- Use “There are no products yet.” / “Todavía no hay productos.” Wire teal heading Add product and the forwarded `empty-action` to the existing create flow in `products-screen.ts`. Put the button and reason in `products-add-action.ts`. After the relevant reads, name a missing unit or language in English and Spanish. Both start without a category and return focus to the heading after the editor or placement closes. Tree ⋮ adds in place and restores its opener.
- Expose `no-matches-action` for a filter-only no-match result too. Test in the shared table suite and update the design system’s message section.
- In `product-list.test.ts`, test the starting columns, a nested-category filter and Category sort with open variants. Check default fit at 1180 px in both languages with a long nested category path. In `product-browser.test.ts`, test view switching and reload with ticks and filters, and keeping Tree after closing the linked category. In `products-screen.test.ts`, test a category link while List is open, focus after switching from empty List, the disabled Add reasons, and focus after both Add entry points close. Seed Tree in old fixtures. Check a save hidden by Category and a new top-level row.

## Second PR · Phone layout and row-height targets

Staff can read and use the default columns with no sideways scroll in either view, and tap a photo or swatch anywhere along its wrapped row.

- In `product-list-layout.ts`, outline the existing 44 px slotted search field and label it **Search** on phones. Stack Category, labels and Unavailable below Name, show Tree swatches and counts, and wrap price and unit. Enable table wrapping at all widths and constrain `#fitNames` to the Name cell so it leaves room for Price and Available. Keep Category in Customise. Move shared heading CSS to a sibling of `wt-data-table.ts` before adding one opt-in visually hidden heading label. Keep Available’s accessible name.
- Keep 36/30 px images lazy. Size the clickable photo and swatch against the whole Products row, including wrapped names, the All products row and a category being renamed. Use Products parts so Menu Structure keeps its own targets. Update both List suites’ phone expectations for swatches, counts and scrolling. Measure the default columns in both languages and click the top and bottom of a wrapped row's hit area. In `wt-data-table.test.ts`, check that the opt-in heading keeps its accessible name.

## Size and gates

Estimate PR 1 +320–420/−100–160 code and +230–330/−50–60 tests. PR 2 +380–460/−180–230 code and +270–340/−70–100 tests. Counts include moved lines. Update both Products guides and the design-system sections on adds, mobile media and toolbar order. Start new behavior with a failing test. Run the named suites, types, file-size guard and Lane H’s unchanged fiscal, Server published-menu and Till refresh suites. Show the owner both views at 1440, 1180 and 390 px in English and Spanish, light and dark, before each landing. Include expanded categories and variants, an unavailable dish, Filters, Select, no matches, empty List, failed load with Try again, and full-height targets once the second slice is built.
