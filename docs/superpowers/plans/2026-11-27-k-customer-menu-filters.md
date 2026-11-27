# Customer menu filters implementation plan

Staff can try **Allergies and diets** on the published Phone and Computer previews. Delivery 3
lists the customer app before the Online sub-tab. Finish this preview on the details from #4455,
then take Online settings separately. [Customer menu design §3](../specs/2026-11-24-customer-menu-design.md#3-the-customers-page)
sets the rules. The watcher wrote in Lane K's `questions.md` at 04:16 on 27 November:

> Write the one-page plan for the next Delivery 3 slice after the details (filters or Online settings, in the spec's order), Claude read, PLAN FOR APPROVAL; build on #4455's branch until it lands.

- [ ] **Carry published defaults.** Project the frozen `preselected` flag for extras in
  `packages/shared/src/menu-document/guest-menu.ts` alongside their existing declarations. Use the
  existing signed-in read. Fail first in the sibling `guest-menu.test.ts` for both flag values.
  In `apps/server/src/menu-api.test.ts`, check that the preview keeps a published extra's default
  and declarations after a draft edit. Only the preview response gains a field.
- [ ] **Filter the list.** Add `apps/dashboard/src/widgets/customer-menu-filters.ts` and its sibling
  test. Match one chosen diet against the dish's published labels. When excluding whole allergen
  groups, hide an unreviewed dish (`null`, distinct from reviewed `{}`) and a plain dish that
  declares a selected group. A dish with variants needs one reviewed variant whose declaration is
  clear of every selected group. Hide either kind if an extra served by default declares a selected
  group. Count menu entries hidden by allergens after search and diet, including repeated placements.
  Count an entry as unreviewed if it would appear once its unknown dish or variant declarations
  were recorded as empty. Test parent `null` with reviewed variants, mixed and crossed
  variants, reviewed versus unknown extras, exact diet labels and both counts before implementing.
- [ ] **Show choices and scope.** In `apps/dashboard/src/widgets/customer-menu-page.ts`, put the
  filter button by search as in mock 18. Use `wt-button`, `wt-dialog` and `wt-combobox` with Clear
  and Close. Keep selections in memory. Remove empty sections and their links. With an allergen
  filter active, mark retained variants and extras that declare a selected allergen or lack review.
  On their dish card point to those choices. Reuse declaration names and icons, including written
  cereal and nut kinds. Beside the counts say to ask staff. Set-menu cards and details tell readers
  to ask about their choices while filters are active. Search still matches set menus. When all
  individual dishes are filtered out, say so even if set menus remain. Preserve the search-only
  empty message, key and return from details. Add EN/ES/CA/GL words in
  `packages/shared/src/i18n/guest-menu.ts`. Fail first in `menus-screen.customer-preview.test.ts`
  on keyboard selection and focus, search plus filters, counts, marks, set menus, return and clearing.
  Run axe in both menu palettes on open, active, empty and marked-detail states.

Run each changed test file. Update `apps/server/src/guide/{en,es}/products.md` at `{#customer-menu}`,
`docs/developers/{design-system,products}.md` and `docs/backlog.md`. Check 360 px. Send EN/ES captures
at 390, 1280 and 1440 px in both dashboard themes and menu palettes, with and without photos, for
Lane P and the owner. Allow 170–250 production lines and 150–220 test lines. The preview response
change calls for two run-it reviews. Online settings, styles, print, customer access, dish links
and uploaded fonts follow.

**Scope for the watcher to clear.** Set menus show all published choices. Diet matches the dish's
own declaration, and missing extra reviews get a mark. Required groups can need several portions,
as `apps/till/src/menu-filter.ts` accounts for. Checking whether a full order can be put together
would need that capacity rule and the extras of set-menu choices. This slice follows the published
menu rules in §3 and describes them as a filter on declarations.
