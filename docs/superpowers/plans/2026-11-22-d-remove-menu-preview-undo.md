# Remove Menu Preview Undo

On 22 November 2026 at 19:16 the owner asked, “meh, i think let's remove undo altogether. better
than having it half done”. The watcher assigned the Menu Preview change list in Lane D's queue.
Managers will still see unpublished changes, which menu made a price change and links to edit it.

1. In `apps/dashboard/src/widgets/menu-preview.undo.test.ts`, render a published menu with an
   unpublished rename, a shared-product edit and an included menu's price edit. Assert that the
   rename row has View and Hide and that those are its only controls. Check both Edit destinations
   in the same render. Run it first and watch the extra Undo control fail the assertion.
2. Keep Edit link behavior in `widgets/menu-preview.ts`, using each change's existing source and
   fields. Rename the widget test to `menu-preview.edit-links.test.ts`. Keep link order, wrapping and
   normal and modified click cases. Bring over distinct destinations from `packages/menu/src/menu-undo.test.ts`
   and `menu-undo.db.test.ts` where they add coverage: deleted and removed products, extras items'
   unit, portion and maximum changes, included variants, an unnamed included menu, and section and
   product changes from an included menu. Keep the attribution assertions in the menu package.
3. Delete `packages/menu/src/menu-undo.ts`, `apps/dashboard/src/api/menu-undo.ts` and their retired
   tests, including `screens/menus-screen.preview-undo.test.ts` and server's `menu-undo-photo.test.ts`.
   Remove Undo rendering, state, focus and announcements in the widget, Undo-only event and state in
   `screens/menus-screen.ts`, and Undo gates on publishing and scheduling in it and
   `widgets/menu-publications.ts`. Drop Preview's `structure` input, its binding, Undo-only fixtures in
   `widgets/test-helpers.ts`, and unused English and Spanish strings in `i18n/strings.ts`. Remove
   Undo-only assertions in the Preview and publications accessibility suites, the publications widget
   test and menu's `set-menu-document.test.ts`. Update the dashboard/server duration tables and
   browser-purity and English-only guards. Keep the usual menu editing and publication paths and the
   separate Price overrides save message.
4. Update both Products guides at their existing section address and both affected sections of
   `docs/developers/design-system.md`. Remove A353 and A1377 from both backlog files. Date the
   withdrawal at the top of `2026-11-06-a353-preview-undo.md` and point to that note from the two
   landed slice plans. Verify `feat/d-a353-preview-undo-sections` is clean and unpushed before removal.
5. Rerun Preview, navigation, accessibility, scheduled publication and menus-screen browser files.
   Run `menu-publication.test.ts` and `set-menu-document.test.ts` for attribution and the guide-content,
   guide-link, browser-purity, English-only and duration checks. Inspect Preview in English and Spanish,
   light and dark, at phone and desktop widths.

Estimate production +25 to 60 / −850 to 1,050, tests +35 to 100 / −3,500 to 3,900, test support
and configuration +1 / −20 to 65, and documentation +15 to 30 / −45 to 75 plus this plan.
