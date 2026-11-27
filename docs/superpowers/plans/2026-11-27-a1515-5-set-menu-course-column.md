# A1515-5 Set-menu Course column

**Finish line.** Each dish uses its product’s course. Managers see course headings in Set menus → Dishes and change courses on the product. The owner’s 24 November “we don't reassign courses in the set menu” withdraws the 18 November “tapa as a starter” choice. The watcher assigned both PRs on 27 November at 16:09 and dropped the extra price check on 26 November at 20:12 in Lane D `questions.md`. [Owner’s decision](../specs/2026-11-24-set-menus-automatic-grouping-design.md#1-setting-up-a-set-menu-dashboard)

## PR 1 retires the saved choice end to end

- In `packages/menu/src/set-menus.ts`, resolve dishes from the active product course and variants from their active effective course. Keep automatic inclusion lines on add and every publication refusal, including missing or unaccepted courses. Remove the setter, override reads, the cleanup in `menu-structure.ts` and the override copy used by `menu-copy.ts`. In `set-menu-document.ts`, the shared document types and `menu-document.ts`, remove the frozen override, live lookup, digest input and sending-course substitution. Keep published `countsAsCourseId` and `variantCountsAs` for folder and bill grouping, live product/variant courses for sending, and recorded bill and order behavior.
- Drop `set_menu_dish_courses` from the schema, exports, DB/menu classifications, configuration import validation and transfer, course deletion and dashboard subscriptions (`live-queries.ts`). Remove its deletion-impact text. Remove the demo’s dish-level course from `CountryDemoSetMenu`, the Madrid data and `seed-set-menus.ts`. Let the Special menu’s flexible line accept Sharing so Bravas keeps its product course and the menu still has the same number of places.
- Remove `PUT …/set-menu/items/:itemId/course`, `saveSetMenuDishCourse` and its `dashboard-client-split.json` entry. In `set-menu-dishes.ts` keep Course as plain text from the existing `courseId`, with No course linking to the product. Remove the combobox, its state, copy, redundant `productCourseId` and `removedLines` handling in the editor and inclusion form. Keep the draft count when adding a dish creates a line. Point the EN/ES No course help to the product and broaden the existing product-course link under `{#set-menus}` in both guides. Run `guide-content.test.ts` and `guide-links.test.ts`.
- Rebuild core with `pnpm --filter @waitron/server migration-baseline rebuild --set core`. Start the PR description with **Resets venues**. Use the pre-live reset and remove the old wire and storage shapes. Run `scripts/{schema-constraints,append-only-triggers,behavioural-triggers,starting-migrations}.test.ts` and `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.

## PR 2 removes the display column

Remove Course from the table and column chooser. Keep course headings, the No course product link, surcharges, variant choices and row actions. In both guides, say where to find the course headings and verify the product link with `guide-content.test.ts` and `guide-links.test.ts`.

For each dashboard change, capture matching views before and after in English and Spanish, light and dark, phone and desktop. Send the views to the watcher for the owner’s approval before landing. Update A1515 in `docs/backlog/menu.md` as each PR ships.

## Checks and size

Run each changed behavior red, then green. Extend `set-menu-document.test.ts` and `zone-offers.set-menus.test.ts` to pin publication refusals, the frozen shape without the override field, variant courses and live sending versus published counts after a course edit. In `menu-api.set-menus.test.ts` send the former valid PUT and expect 404. Run affected copy, transfer, course-delete, bill/order, demo and subscription cases. Where a fixture needs two published courses for one dish, change the product course between publications and keep the assertions about recorded copies. In `set-menu-dishes.test.ts` pin read-only Course in PR 1 and its absence from headers and chooser in PR 2. Run the affected browser suites and typechecks.

Estimated additions/removals in PR 1 are 20/260 product, 85/650 tests, and 4/71 generated across core SQL, snapshot, journal and epoch. PR 2 is about 0/15 product and 10/5 tests.
