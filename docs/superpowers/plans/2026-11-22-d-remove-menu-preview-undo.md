# Remove Menu Preview Undo

On 22 November 2026 at 19:16 the owner asked, “meh, i think let's remove undo altogether. better
than having it half done”. The watcher assigned REMOVE-MENU-UNDO in Lane D's queue. Menu Preview
will still show unpublished changes, their sources and the existing Edit links.

1. In `apps/dashboard/src/widgets/menu-preview.undo.test.ts`, add a case that renders a published
   menu with an unpublished rename, a shared-product edit and an included menu's price edit.
   Assert that the rename row has View and Hide but offers no Undo, and that the other rows still
   link to the product and the included menu's Price overrides. Run it first and watch the rename's
   Undo assertion fail. Keep the existing Edit-link cases in `menu-preview.test.ts`, including
   link order and click behavior, and retire assertions specific to Undo.
2. In `widgets/menu-preview.ts` keep the existing Edit link decisions for shared products,
   included menus, extras lists and set menus. Use the change's own fields to select the links.
   Remove Undo rendering, state, focus and announcement handling there, and remove the Undo-only
   sender, event, state and publish or schedule gates from `screens/menus-screen.ts` and
   `widgets/menu-publications.ts`. Delete `apps/dashboard/src/api/menu-undo.ts` and
   `packages/menu/src/menu-undo.ts` and their Undo-only tests, including
   `menus-screen.preview-undo.test.ts` and `apps/server/src/menu-undo-photo.test.ts`. Remove the
   Undo-only strings in both locales from `i18n/strings.ts`, dedicated a11y and scheduling cases,
   the one Undo assertion in `packages/menu/src/set-menu-document.test.ts`, and retired entries
   in the dashboard/server duration tables and browser-purity and English-only guards. Keep the
   existing menu writes, publication rules, price attribution and separate Price overrides toast.
3. Update both Products guides in `apps/server/src/guide/` at their existing section address, and
   correct the live contract in `docs/developers/design-system.md`. Remove A353 and A1377 from
   `docs/backlog.md` and `docs/backlog/menu.md`. Add a dated withdrawal note linking here at the
   top of `2026-11-06-a353-preview-undo.md`. Verify the parked
   `feat/d-a353-preview-undo-sections` checkout is clean and has no PR or remote branch, then
   remove that registered worktree and local branch.
4. Rerun the Preview, navigation, accessibility, scheduled publication and menus-screen browser
   files. Run `menu-publication.test.ts` and `set-menu-document.test.ts` in the menu package for
   attribution, and the guide-content, guide-link, browser-purity, English-only and duration
   checks. Inspect Preview in English and Spanish, light and dark, at phone and desktop widths.

Estimate production +25 to 60 / −850 to 1,050, tests +10 to 45 / −3,500 to 3,900, test support
and configuration +0 / −5 to 25, and documentation +15 to 25 / −45 to 75 plus this plan.
