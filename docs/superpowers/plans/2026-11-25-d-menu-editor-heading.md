# Menu editor heading and Patch action

Piece 1a of the [menu editor design](../specs/2026-11-24-menu-editor-redesign-design.md#delivery).

**Finish line.** On ordinary and set menus, the link back and menu name share a line at list-heading
height. On ordinary menus, the heading says what is live and offers review and publishing. Managers
patch live menus from their row in Menus. Piece 1b owns the Preview layout and piece 2 owns the single
draft, replacement table and removal of Price overrides.

1. **Heading.** Share a small template and token styles in `screens/menu-editor-heading.ts` between
   `menus-screen.ts` and `set-menus-screen.ts`. Keep one `h1`, the named link landmark, guarded Back,
   modified clicks and the Set menus link and help. On phones wrap the live words below the title.
   Use `statusWords` without brackets. A saved change to a live version shows the warning dot and
   Unpublished changes. A changed or never-published menu offers Review and publish, outlined while
   prices are dirty or saving. A current, loading or failed status offers neither cue nor button.
   Remove the Preview star and its EN/ES string. Keep the clash line and its Price overrides link.
   Start red in `menus-screen.heading.test.ts` and `set-menus-screen.test.ts` for equal list/editor
   height at desktop width, status and action states, and 390 px wrapping. Keep both-theme axe checks.
2. **Save and review.** `menu-prices-table.ts` reports pending or dirty prices and shares one awaited
   save between its Save button and the heading. Close the existing dialog pattern before sending
   so validation can focus the price field. Preview opens through the guarded tab address only once
   the wait ends with a clean draft in the same menu, view and table. Keep the existing leave rules
   for ordinary navigation and the field errors on partial refusal. Start red in
   `menus-screen.prices.unsaved.test.ts` for Keep editing, Save-then-Review, partial refusal and a
   draft edited during refresh. A late save must leave the manager on the screen they chose.
3. **Publish.** Put both existing actions in the heading on Preview. `widgets/menu-preview.ts`
   exports its same-preview live check and exposes its existing publish request, keeping the clash
   check, warning dialog and preview identity check. `widgets/menu-publications.ts` reports its own
   scheduling eligibility and exposes the current schedule form with the heading button as opener.
   Each button keeps its own eligibility and focus return. Keep the notes, schedule table and result
   bodies where they are. Start red at the screen for heading placement, clashes, absent actions and
   opening the schedule form. Keep dialog, preview hash and focus assertions in `menu-preview*.test.ts`,
   `menu-publications*.test.ts`, `menu-allergen-warnings.test.ts`, `menu-schedule-allergens.test.ts`
   and `dashboard-app.unsaved-changes.test.ts` using the widgets' public actions or the screen button.
4. **Patch.** In `menus-screen.ts`, open the existing patch dialog for the verified live row's id and
   name. Use an existing edit icon and `wt-menu-row` with guide link properties passed through to
   `wt-help-tooltip`. Refresh list statuses without clearing the filtered rows or losing focus on
   close. Start red in `menus-screen.test.ts` for live eligibility, filtered focus and the chosen
   menu; check EN/ES links there. In `wt-menu-row.test.ts`, click the badge and guide link with help
   on and assert the menu remains open. Keep the patch dialog's draft and nested-close tests.

Localize in `i18n/strings.ts`. Update both Products guides, the heading, Preview and help passages of
`docs/developers/design-system.md`, and `docs/backlog/menu.md`. Run the focused browser files, guide
checks and file-size guard. Capture before and after at 1440 and 390 px in both themes and languages,
including unsaved prices, unpublished changes, existing Select mode and a menu with no photos. Land
once the watcher relays the owner's screenshot decision and the required checks pass. Estimate
270–390 added product lines and 260–440 added test lines, plus docs. Keep every file under its cap.
