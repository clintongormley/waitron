# A1515 set-menu demo scope

At lunch in Casa Delgado, staff can add a €14 Menú del día or a €20 Menú
especial, order their dishes, fire held courses, and pay and print the bill.
The Products guide explains how to give drinks, bread and coffee a course.
Use Tasks 2a–6 of the [piece 5 plan](2026-11-18-a1515-set-menu-demo.md) for the
menu contents, translations, €73 worked example and demo checks. Task 1
landed at `542f8b070e`, and payments and receipts landed at `5614b7efc5`.

1. **Demo data.** In `packages/country/src/demo.ts` and
   `packages/country-es/src/demo/{menu,casa-delgado-es,casa-delgado-ca,casa-delgado-gl,casa-delgado-valencia}.ts`,
   give restaurant dishes courses and describe both menus. Use
   `packages/country-es/src/demo/data.test.ts` to check regional courses,
   dish membership, accepted courses, portion units and the prices, surcharge
   and coffee variants. Keep the five lunch dishes as products and keep the
   existing Drinks folder and €9 Negroni offer.
2. **Seed.** In `apps/server/scripts/demo-seed/`, use `seed-courses.ts` and
   `seed-set-menus.ts` from `seed.ts` and `seed-menus.ts`, with the data
   carried through `data-set.ts`. Use the existing course and menu operations in
   the seeding transaction. Add Coffee, Drinks and Bread in the starter-course
   language before the deli copies the default department settings. Turn on Fire
   now for Drinks and Bread. Publish the lunch holder through the existing path.
   Apply these Spanish additions only at Spanish venues: the existing English
   fallback test seeds Casa Delgado into a UK venue whose starter list lacks
   Sharing plates (`packages/country-gb/src/united-kingdom.ts`). Keep that
   fallback's ordinary lunch and extend its existing assertion in `seed.test.ts`.
   Begin with failing data and seed tests. `seed-courses.test.ts` checks both
   seed languages, both departments and representative products.
   `seed-set-menus.test.ts` checks the published lunch and dinner reads, dish
   questions and course overrides, and the €73 example through existing placement
   and fit logic. Update assertions about the old lunch menu in
   `seed{,-menus,-floor,.regional}.test.ts`.
3. **Madrid comparison and guides.** Extend `testing/madrid-{shared-offers,semantics}.ts`
   where required, with focused controls in their sibling tests. Declare the
   exact course and menu changes in `seed.madrid-baseline.test.ts` and verify
   both locales with the frozen capture intact. Run the demo-seed tests and
   the practice-sales golden check without changing golden data. Update
   `docs/developers/testing-guide.md`, `docs/backlog/menu.md` and
   `apps/server/src/guide/{en,es}/products.md`. Run `guide-content.test.ts`
   and `scripts/guide-links.test.ts`. In Lane D's disposable demo, verify the
   normal and no-place orders, firing, seated bar and counter, and payment and
   receipt. Capture English and Spanish, both themes, and phone width. Send
   the screenshots to the watcher and wait for the owner's OK before landing.

One PR. Expected additions are about 350 lines of data and seed code and
650 lines of tests and baseline support, plus the guide edits. The fiscal
writer, migrations, starter courses for real venues, historical seed sales
and till behavior are outside this demo change.
