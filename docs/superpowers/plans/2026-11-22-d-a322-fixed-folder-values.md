# Keep fixed values when an included folder is saved again

A manager can edit one folder field and save it without losing a saved name, photo or colour
that currently matches the included menu. The saved value still applies after the included menu
changes. This covers the fixed-values point in [A322](../../backlog/menu.md#an-included-menu-can-show-its-sections-directly-a322-1372-left-open).
Photo display on the till and shortcut placement stay outside this slice.

The folder editor snapshots the included menu and stored folder when it opens.
`packages/menu/src/include-folder-presentation.ts` already receives both in `folderOverridesFrom`.
Keep a value if the draft differs from the included menu or if the stored fixed value equals
both. Compare names per enabled language with the existing trimming. A stored null photo or
colour is explicit. An absent value follows the menu. Keep the current behavior when a manager
changes a previously different value back to the included menu's value, or clears a name.
Preserve the existing disabled-language handling and the form's save and draft behavior.
The current save route and stored fixed flags already support these values.

- [ ] Add a failing case in `packages/menu/src/include-folder-presentation.test.ts` with a
  saved English name equal to the menu's, an equal photo and an explicit null colour equal to
  the menu's. Change the Spanish name and assert that the submission retains all three saved
  values. Test the same rule with an equal explicit null photo and a matching non-null colour.
  Retain the existing cases for following values and setting a previously different value back.
- [ ] In `apps/dashboard/src/widgets/include-folder-form.test.ts`, open a folder with matching
  fixed values, edit the other language's name and assert the actual Save payload. Run both
  files before the fix. The new cases should fail with the matching fixed values missing.
- [ ] Update the existing helper and run both files again. Run `include-folder.db.test.ts`
  to check that the existing writer and reader still distinguish fixed values from following.
  Run only those focused suites and the related form save and draft tests.
- [ ] Remove the fixed-values point from `docs/backlog.md` and `docs/backlog/menu.md`. Add a
  short English and Spanish note under `#menus` in the staff `products.md` guides explaining
  how folder edits relate to later edits to the included menu. Run the guide checks.

Expected size is 10–25 production lines, 35–65 test lines and 8–15 guide and backlog lines.
