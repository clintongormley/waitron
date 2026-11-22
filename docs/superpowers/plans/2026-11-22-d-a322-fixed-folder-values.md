# Keep fixed values when an included folder is saved again

A manager can edit one folder field and save it without losing a saved name, photo or colour
that currently matches the included menu. The saved value still applies after the included menu
changes. This covers the fixed-values point in [A322](../../backlog/menu.md#an-included-menu-can-show-its-sections-directly-a322-1372-left-open).
The queue says “parent menu”. The backlog detail identifies the source as the included menu.
Photo display on the till and shortcut placement stay outside this slice.

The folder editor snapshots the included menu and stored folder when it opens.
`packages/menu/src/include-folder-presentation.ts` already receives both in `folderOverridesFrom`.
Keep a value if the draft differs from the included menu or if the stored fixed value equals
both. Compare names per enabled language with the existing trimming. Check whether the stored
value is defined. A null photo or colour stays fixed and an absent key follows the menu.
Changing a different value back to the menu's value or clearing a name keeps the existing
behavior. For a fixed photo or colour that already matches, the editor offers no explicit way
to switch to following. A manager can save a different value and then save the menu's value.
Preserve disabled-language handling and the existing form draft. Reuse the current writer.

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
  Run the form's `include-folder-form.save-state.test.ts` and `include-folder-form.unsaved.test.ts`.
- [ ] Update the A322 summary in `docs/backlog.md` and its detail in `docs/backlog/menu.md`.
  Replace the resolved point with the absence of a direct reset for a matching fixed photo
  or colour. Add a dated note beside decision 3 in
  `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md`.

Expected size is 10–25 production lines, 35–65 test lines and 5–12 documentation lines.
