# Customer menu details implementation plan

In **Customer menu**, open a dish or set-menu card from the published Phone or Computer preview.
Read what it includes and use **Back to menu** to pick up where you left off. Each dish has a
link within the signed-in preview. [Delivery 3, section 3](../specs/2026-11-24-customer-menu-design.md#3-the-customers-page)
sets the scope. Filters, Online settings, public addresses, styles and print follow in their own slices.

- [ ] **Prepare published details.** In `packages/shared/src/menu-document/guest-menu.ts`, add a
  detail key to products and set menus, using the kind and the frozen menu item or set-menu ID.
  Use the same key for repeated placements. Extend the set-menu member with lines in `terms.lines`
  order, each with its count, resolved course names and matching frozen choices in menu order.
  Use `PublishedSetMenu.root`, `offers` and `courses`. Match by `countsAsCourseId` on the variant
  when there are variants, and on the dish otherwise. Use the frozen `unitPrice` as the supplement.
  Reuse the existing customer-name and separate declaration projection. Use only the existing
  signed-in preview read. In `guest-menu.test.ts`, first exercise a two-course line, a later line,
  variants in different courses, a zero and a paid supplement, name fallback and duplicate names.
  Update exact preview payload expectations in `apps/server/src/menu-api.test.ts` where needed.
- [ ] **Open and return.** In `apps/dashboard/src/widgets/customer-menu-page.ts`, make the names
  links and show details in the same canvas. Reuse the existing scroller and keep the list and search
  state for the return. Focus the detail heading on entry and the opening link on return without a
  second scroll. In `menus-screen.ts` and `menu-online-preview.ts`, pass the accepted `detail` query
  key through the existing menu address controller and navigation guard. Resolve links against that
  preview’s published members only. Browser Back returns to the list after opening from it, and an
  externally opened detail offers a link straight to the list. Unknown keys show the menu list.
- [ ] **Show the detail.** Move the variant and extra lists off the summary cards. In the page
  widget show the large dish photo when present, description, variant prices, option choices, extra
  prices, and written allergen and diet names, including cereal and nut kinds. Keep each choice’s
  own declarations. Show the set-menu price per person and each line’s courses, choices and
  supplements. Join alternative courses with `Intl.ListFormat` in the content language. Add detail
  labels to `packages/shared/src/i18n/guest-menu.ts` in EN, ES, CA and GL. In
  `menus-screen.customer-preview.test.ts`, first check exact price and declaration text, direct and
  missing links, keyboard focus and return from a scrolled search in Phone and Computer. Run axe on
  both details in both customer palettes. Run each changed test file and record its failing and
  passing cases.

Update both Products guides, `docs/developers/{design-system,products}.md` and `docs/backlog.md`.
Check 360 px. Send 390, 1280 and 1440 px pictures in EN/ES, both dashboard themes and customer
palettes, with and without photos, to the watcher for the owner. Allow about 280–420 product lines
and 170–240 test lines. The preview payload change calls for two run-it reviews at finish-branch.
