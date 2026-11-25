# Menu editor heading and Patch action

Piece 1a of the [menu editor design](../specs/2026-11-24-menu-editor-redesign-design.md#delivery).

**Finish line.** A manager opens an ordinary or set menu and sees its name beside the link back at
list-heading height. On an ordinary menu, the heading says what is live and gives a way to review
and publish. A published menu can be patched from its row in Menus. Piece 1b owns the Preview body
redesign. Piece 2 owns the single draft, the replacement table and removal of Price overrides.

1. **Heading.** Share a small template and token styles in `screens/menu-editor-heading.ts` between
   `menus-screen.ts` and `set-menus-screen.ts`. Keep the named link landmark, one `h1`, guarded
   Back and ordinary browser handling of modified clicks. Wrap the live words below the title on
   phones. Use `statusWords` without brackets. Show the warning dot and Unpublished changes only
   for a saved change to a live version. Offer Review and publish for that change or a first publish,
   and outline it for a price draft, including a draft on an otherwise current menu. Remove the
   Preview star. Keep the clash line and its Price overrides destination. Start red in
   `menus-screen.heading.test.ts` and `set-menus-screen.test.ts` with the inline heading, status and
   action states. Adapt the existing phone, navigation and both-theme heading axe assertions.
2. **Review and publish.** In `menu-prices-table.ts`, report changes to the existing price draft
   and let the screen await the same save as the Save button. Use the existing dialog and buttons
   for Save and review / Keep editing. Switch via the tab's guarded address write only after the
   price save clears its draft and the same menu and tab still own it. Keep the draft and field
   errors on refusal. On Preview put Publish later (return to Structure) and Publish now in the
   heading when there is a version to publish. Reuse the publish eligibility and request logic from
   `widgets/menu-preview.ts` in `widgets/menu-publish-actions.ts`, with the existing warning
   confirmation and its preview identity check, then the screen's existing publish handler. Leave
   scheduling, notes and result bodies in Preview and keep the scheduling focus return in
   `widgets/menu-publications.ts` working with the moved button. Start red in
   `menus-screen.prices.unsaved.test.ts` for keep, refusal and save before review, and in
   `menus-screen.heading.test.ts` for fresh preview, clash gating and Publish later. Keep the
   existing Preview warning, hash and scheduling assertions against the controls after they move.
3. **Patch.** In `menus-screen.ts`, reuse `dashboard-menu-patch-dialog` on the Menus list with the
   selected row's id and name. Show the action only on a row with a verified live version. Put its
   existing help-mode badge and guide link beside it inside the row menu, using `data-keep-open`
   on the badge so users can open it. Refresh the list's status after a patch and preserve dialog
   close, nested-dialog, draft and focus behavior. Start red in the existing Patch cases in
   `menus-screen.test.ts` for eligible versus unpublished and failed rows, the right menu opening,
   help in EN and ES, and the row's live version refreshing on completion. Run the patch dialog's
   existing unsaved and axe tests against its unchanged behavior.

Localize heading actions in `i18n/strings.ts`. Update both `apps/server/src/guide/*/products.md`
versions, `docs/developers/design-system.md` and `docs/backlog/menu.md` as the slice lands. Run the
focused dashboard browser files, changed guide checks and file-size guard. Capture before and after
for the owner at 1440 and 390 px in both themes and languages, including unsaved prices, unpublished
changes, the existing Structure Select mode and a menu without photos. Landing waits for the
watcher to relay the owner's screenshot decision. Estimated additions are 270–390 product lines
and 200–320 test lines, plus guides. Keep the new templates in their own files under the cap.
