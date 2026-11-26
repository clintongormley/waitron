# Customer menu details implementation plan

In **Customer menu**, open a dish or set-menu card from the published Phone or Computer preview.
Read what it includes and use **Back to menu** to pick up where you left off.
[Delivery 3, section 3](../specs/2026-11-24-customer-menu-design.md#3-the-customers-page)
sets the scope. Each dish gets its shareable link when the public customer page can open it.
Filters, Online settings, styles and print follow in their own slices.

- [ ] **Prepare published details.** Extend the set-menu member in
  `packages/shared/src/menu-document/guest-menu.ts` with lines in `terms.lines` order. Each line
  carries its count, course names resolved with `resolveMenuText`, and matching frozen choices in
  menu order. Use `PublishedSetMenu.root`, `offers` and `courses`. Match by `countsAsCourseId` on the
  variant when there are variants, and on the dish otherwise. Show variant choices as
  “Dish (Variant)”. Use frozen `unitPrice` for the supplement, including an inherited supplement.
  Include dishes sold only in a set. Leave staff-only dishes out. Reuse the customer-name and
  separate declaration projection. Use the existing signed-in preview read. Start with a failing
  case in `guest-menu.test.ts` for a two-course line, a later line, variants in different courses,
  a dish sold only in a set, an excluded staff-only dish, zero and paid supplements and name
  fallback. Update exact payload expectations in `apps/server/src/menu-api.test.ts` where needed.
- [ ] **Open and return.** In `apps/dashboard/src/widgets/customer-menu-page.ts`, make the names
  buttons and show details in the same canvas. Keep the list and search state while details are
  open. Save the active scroll area’s position and the opening button, then focus the detail heading.
  **Back to menu** restores that position and focuses the opening button with `preventScroll`.
  In `menus-screen.customer-preview.test.ts`, use a scrolled search with repeated dish names and
  verify keyboard opening, the correct details and return to the same button in Phone and Computer.
- [ ] **Show the detail.** Move the variant and extra lists off the menu cards. In the page widget
  show the large dish photo when present, description, variant prices, option choices and extra
  prices. Write out the declared allergen and diet names for dishes, variants, extras and set-menu
  choices, including cereal and nut kinds. Keep declarations separate and make no allergen-free
  claim. Show the set-menu price per person and each line’s courses, choices and supplements.
  Join alternative courses with `Intl.ListFormat` in the content language. Add detail labels to
  `packages/shared/src/i18n/guest-menu.ts` in EN, ES, CA and GL. In the preview browser suite, check
  exact price and declaration text and run axe on both details in both customer palettes. Run each
  changed test file and record its failing and passing cases.

Update both Products guides, `docs/developers/{design-system,products}.md` and `docs/backlog.md`.
Check 360 px. Send 390, 1280 and 1440 px pictures in EN/ES, both dashboard themes and customer
palettes, with and without photos, to the watcher for the owner. Allow about 220–340 product lines
and 150–220 test lines. The preview payload change calls for two run-it reviews at finish-branch.
