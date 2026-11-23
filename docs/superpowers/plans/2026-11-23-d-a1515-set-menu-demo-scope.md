# A1515 set-menu demo scope

At lunch in Casa Delgado, staff can add a €14 Menú del día or a €20 Menú
especial, order their dishes, fire held courses, and pay and print the bill.
The Products guide explains how to give drinks, bread and coffee a course.
Use the [piece 5 plan](2026-11-18-a1515-set-menu-demo.md) for Tasks 2a–6, menu
contents, translations and the €73 worked example, with the changes below.
Task 1 landed at `542f8b070e` and payments and receipts at `5614b7efc5`.

1. **Demo data.** In `packages/country/src/demo.ts` and
   `packages/country-es/src/demo/{menu,casa-delgado-es,casa-delgado-ca,casa-delgado-gl,casa-delgado-valencia}.ts`,
   give restaurant dishes courses and describe both menus. Start with failing
   `data.test.ts` cases for regional courses, dish membership, accepted courses,
   portion units, prices, the surcharge and coffee variants. Keep the five
   lunch dishes as products and keep the Drinks folder and €9 Negroni offer.
2. **Seed.** In `apps/server/scripts/demo-seed/`, use `seed-courses.ts` and
   `seed-set-menus.ts` from `seed.ts` and `seed-menus.ts`, with the data carried
   through `data-set.ts`. Use the existing course and menu operations in the
   seeding transaction. Name the new courses in the starter-course language.
   Add the Fire now rows for Drinks and Bread alongside the existing rows
   before the deli copies them. Add dishes with their exclusions and course
   overrides before saving lines in the API's course display order. Publish
   the holder through the existing path. Use the same data-set ownership
   check as `demoLanguagesFor` to keep the fallback trial's existing lunch
   name, sections and course settings. Start with failing tests.
   `seed-courses.test.ts` checks both seed languages, both departments and
   representative products. `seed-set-menus.test.ts` checks the persisted and
   published menu terms, dishes, course overrides and questions, lunch and
   dinner availability, and the example through the existing placement and
   fit logic. Update the UK fallback, parking and menu expectations in
   `seed{,-menus,-floor,.regional,.integration}.test.ts`.
3. **Madrid comparison and guides.** Extend `testing/madrid-{shared-offers,semantics}.ts`
   with the new row identities, declared additions and removals, and allowance
   for the declared set-menu blocks and members in the published holder. Test
   those changes in the sibling tests. Declare the row changes in
   `seed.madrid-baseline.test.ts` and the holder rename in the two
   `plain-name-changes.*.json` files. The seed test checks menu facts and their
   published copies. Skip the older plan's duplicate `MadridSetMenuFacts`
   checker. Run both baseline locales, the affected demo-seed tests and the
   practice-sales golden check with captures intact. Update
   `docs/developers/testing-guide.md`, `docs/backlog/menu.md` and
   `apps/server/src/guide/{en,es}/products.md` and run both guide checks.
4. **Demo check.** Verify both €73 orders, service at the seated bar and eat-in
   counter, immediate drinks and bread, held mains and desserts at lunch and
   dinner, and eat-in payment and receipt. Verify and call out the existing
   takeaway payment refusal in the owner handoff. Capture both languages and
   themes at phone and desktop widths and wait for the owner's OK before landing.

One PR. Expect about 350 added lines of data and seed code and 650 of tests and
baseline support, plus guide edits. The fiscal writer, migrations, starter
courses for real venues, historical seed sales and till logic stay out of scope.
