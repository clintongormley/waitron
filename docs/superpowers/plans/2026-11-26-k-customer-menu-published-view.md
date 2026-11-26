# Lane K · Published customer menu data

**Resets venues.** Put this on the PR’s first line. The 26 November 16:50 watcher assignment in Lane K
`questions.md` says “Take piece 3's first slice, the published customer view, as the spec's Delivery 3
says (it resets venues; you split it).” Structure #4420, published allergens #4416 and the shared
`tilePrice` function are on the base. [Design, Delivery 3 and §§3, 8](../specs/2026-11-24-customer-menu-design.md#delivery)

Staff can set customer names in Menu details and Courses, review course suggestions from Translate
all, export the names with their configuration, and publish or schedule the full menu from Preview.
Saving a name edits the working menu. Publishing or scheduling makes a fixed copy. Till and kitchen
labels keep their existing sources.

- **Freeze names.** In `packages/menu/src/{menu-document,set-menus,set-menu-document}.ts` and
  `packages/shared/src/menu-document/menu-document-types.ts`, copy the menu root’s `sections.names`
  beside `menuName`. Use the existing batched course read to freeze the staff name and translations
  for every course used by a set menu’s lines, including both choices on a shared line. Keep their
  order and the set-menu title in `terms.names`. A name-only edit appears in Preview and can be
  published. Resolve customer text from the frozen translations and staff fallback with
  `resolveMenuText`.
- **Edit and translate courses.** Add optional `customer_name` in `packages/db/src/schema/kitchen-courses.ts`.
  Reuse `apps/server/src/{kitchen,management-courses-routes}.ts` and dashboard `api/kitchen-api.ts`
  and `widgets/course-list.ts`, including the Products course picker’s shared editor. Reuse
  `optionalTextFields` and the language validation. Add `course` to shared `content-translation-{kinds,report-types}.ts`
  and menu `content-translation-{candidates,types,baseline,writes}.ts`. Label it in both dashboard
  languages and keep the existing permissions for course settings and name translation. In
  `content-suggestion-collect.ts`, send course headings as `section` in job items and
  examples. Cloud’s local `job-body.ts` parser at `ad191ac58` accepts this with opaque `course:<id>`
  references for replies and refuses `kind: course`.
- **Test the saved publication.** In `packages/menu/src/set-menu-document.test.ts`, add “freezes
  customer titles and course names until republishing.” Cover a name-only edit, a scheduled copy and
  blank names falling back to staff. Add “publishes and patches allergens and diets on a set-menu-only
  dish and variant.” Read `menu_versions` after `publishMenu`, product edits and `patchLiveMenu`.
  `buildMenuDocuments` calls `freezeOffer` then `freezeSetMenu`, which spreads both dishes and
  variants. `menu-patch.ts` already visits set menus. Change declarations code only for a gap the
  test exposes.
- **Test the staff paths.** In dashboard `widgets/course-list.test.ts` and server `management-api.test.ts`,
  check “saves and clears a customer name without renaming the course.” In menu `content-suggestion-store.test.ts`,
  check “offers a course and saves the reviewed translation by course ID.” In server
  `configuration-transfer.floor-kitchen.test.ts`, check “round-trips course customer names” through
  the registered `kitchen_courses` export in `packages/db/src/configuration-transfer.ts`.

Start with failing feature tests. Advance document format 6 to 7 in the builder and shared type,
and bundle version 60 to 61 in `packages/provisioning/src/configuration-transfer.ts`. Recheck both
after rebase. Run `pnpm --filter @waitron/server migration-baseline rebuild --set core` and the
schema, trigger, starting migration, fiscal immutability and guide guards. Typecheck document
consumers. Review the new baseline, backup format refusal, translation contract and publish/patch
boundaries. Claude reviews the plan before watcher clearance. After rebasing, the built branch
gets two run-it reviews and a fresh read of any fixes.

Update `apps/server/src/guide/{en,es}/{products,content-and-images}.md` and note the slice in
`docs/backlog.md`. Before landing, give the
watcher local screenshots for the owner of Courses and the translation editor at 1440, 1280 and
390 px, in English and Spanish and both dashboard themes. Estimate 200–300 product lines and
220–350 test lines, excluding generated files. The next independent slice adds the customer app and
signed-in Online preview in one built-in style, with phone/computer, light/dark and photo
combinations. Print and public URLs follow in later deliveries.
