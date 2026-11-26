# Lane K · Published customer menu data

**Resets venues.** Use this on the PR’s first line. The watcher assigned Delivery 3’s first
slice on 26 November at 16:50 in Lane K `questions.md`. Structure #4420 and published
allergens #4416 are on the base. [Customer menu design](../specs/2026-11-24-customer-menu-design.md#delivery)

Staff can give a course a customer name in each content language, export those names with the
venue configuration, and see customer title and course name changes in Preview before publishing
or scheduling. The published version holds fixed copies of the names for the future customer app.

1. **Edit and export.** Add optional `customer_name` to `packages/db/src/schema/kitchen-courses.ts`.
   Extend the existing GET and PATCH through `apps/server/src/{kitchen,management-courses-routes}.ts`
   and `apps/dashboard/src/api/kitchen-api.ts`. In `courses-screen.ts` and the shared `course-list.ts`,
   add a **Customer names** row action on Courses. Use the existing multilingual text fields and
   a draft-scoped Save and Cancel dialog. A blank clears that language. Use the same validation
   and permission as the existing Courses editor. The `kitchen_courses` export in
   `packages/db/src/configuration-transfer.ts` carries the column.
2. **Freeze and show changes.** In `packages/menu/src/{menu-document,set-menus,set-menu-document}.ts`
   and the shared `menu-document-types.ts`, freeze the root’s `sections.names` as `MenuDocument.menuNames`.
   Add `PublishedSetMenu.courses`, keyed by the course IDs in its lines, with `{ name, names }` from
   the existing active-course read. Keep line order and both choices on shared lines. The frozen staff
   name supplies the fallback, so a staff rename also appears as a change in menus holding that course.
   Use `menu-document.ts` and `menu-navigation.ts` to list customer title changes and mark course names
   in the existing `set_menu_changed` row. Put English and Spanish wording in the dashboard Preview
   change widgets and `strings.ts`. Publish and Schedule take the new names. Patch live leaves them
   for the next publication. The till and kitchen keep their existing name paths.
3. **Test from the existing entry points.** Start with failing cases in `course-list.test.ts` for
   saving and clearing a translation while keeping the staff name, `management-api.test.ts` for GET
   and PATCH validation and existing permissions, and `configuration-transfer.floor-kitchen.test.ts`
   for export and import. In `set-menu-document.test.ts`, publish and schedule a menu holding a set
   menu with two courses on a line. Change the title and course names and check that Preview and the
   next publication update while the saved editions retain both old names and their staff fallback.
   Check name-only rows in `menu-change-navigation.test.ts` and wording in `menu-preview-tree.test.ts`.

Use the existing declaration paths and tests in `published-declarations.test.ts`, `menu-patch.test.ts`
and `menu-change-navigation.test.ts`. Bump menu format 6 to 7 and bundle version 60 to 61, checking
both after rebase. Rebuild with `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
Run the named tests, schema and trigger guards, fiscal immutability, guide checks and scoped types.
Update `docs/backlog.md` and both Products guides. Send local screenshots of Courses and Preview at
1440, 1280 and 390 px, in English and Spanish and both dashboard themes, to the watcher for owner
approval before landing. Estimate 200–320 product and 220–350 test lines plus format fixtures and the
generated baseline. Migration and document contract changes get two run-it reviews.

The next slice adds the signed-in customer app and Online preview, with the style and photo picture
matrix. Delivery 3 also needs Translate all for course headings, after a separate Cloud contract
decision. Print and public URLs follow in later deliveries.
