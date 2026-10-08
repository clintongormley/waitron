# W93 — One Device Home Page per menu, shown two ways (design)

Status: design, 2026-10-05. Written from `main` 5597e0692, which holds W88 (#1209, the Structure
tree) and W92 (#1250, product colours), the two items W93 builds on. The code is one pull request,
branch `feat/device-home-page`. It changes storage, so lane B starts it only when no pull request of
its own is parked (RUNNER H1).

## The owner's item

> W93. Replace named home layouts with one Device Home Page and two device presentations.
> - Put one fixed, special "Device Home Page" section in each menu's Structure tree (W88). Edit its
>   product and menu-section shortcuts there with the normal add, remove and reorder interactions.
>   It is not part of the ordinary full-menu tree shown after the shortcut block and does not create
>   offers or prices; its targets must remain reachable from the menu, including through an included
>   menu. Handheld and Till share this one ordered shortcut list.
> - The Home page tab edits display settings and shows a draft preview, not a separate shortcuts
>   editor. It selects Handheld or Till. Each device type has its own column slider: Handheld 2–6
>   with default 3, Till 6–10 with default 6, respecting a minimum usable tile width on smaller
>   viewports. Each has a Colours/Thumbnails choice; when a selected thumbnail is absent, use the
>   effective product colour from W92 or the section colour, with a neutral fallback. Product and
>   section tiles remain distinguishable without relying on colour alone.
> - Each device type also sets which whole block follows search: "Device Home Page first" or "Menu
>   first". This switch swaps the shared shortcut block with the rest-of-menu block. It never sorts
>   products against sections or changes the hand-arranged order inside either block. Put a subtle,
>   labelled divider between the two blocks on the device and in the preview; omit it when either
>   block is empty. Keep navigation into included menus and sections and the existing full-menu
>   search. Show the selected device presentation in a responsive preview below the controls, using
>   draft content and the same rendering rules as the device for this menu. The preview has no
>   device or service-zone assignment, so its search shows this menu only and clearly says that a
>   live device may show results from other menus available to it (W94); never invent those results.
> - Remove arbitrary named layout create/duplicate/rename/delete/default UI and the device profile's
>   per-menu layout picker. The device's form factor selects Handheld or Till settings
>   automatically; trace profile, server, published document, till refresh and fallback consumers
>   before changing the layout fields or sentinel values. Publish the shared shortcuts and both
>   display settings with the menu snapshot; do not let a draft setting alter a live device. Follow
>   the pre-production reset rule if storage changes require it.
> - Test-first for the shared order on both device types, independent display settings, both block
>   orders, thumbnail fallback, column limits and narrow-width clamping, missing shortcut targets,
>   included-menu links, publication/preview boundaries and profile/form-factor selection. Visually
>   inspect both themes at handheld and till widths. Write a concise spec and plan before code
>   because this replaces storage and published interfaces across dashboard, catalogue, profile and
>   till. Update the older home-layout design with a dated superseding pointer, plus
>   `docs/developers/design-system.md` and `docs/backlog.md` in the PR. Own PR after W88 and W92.

## What exists today

A "home layout" is not a table of its own. It is a `sections` row with `role = 'home_layout'`
(`packages/catalogue/src/schema/sections.ts:19-23`), and its tiles are ordinary `section_members`
rows of that section, each naming a product, a section, or — once its target section was deleted —
a `missing_name` (`sections.ts:213-225` in `packages/catalogue/src/`). Every menu is created with one
such section called "Home" (`createMenuShell`, `packages/catalogue/src/menu-structure.ts:26-46`),
and `menu_details.default_home_layout_id` points at the menu's default
(`packages/catalogue/src/schema/menu.ts:40-66`). More layouts can be created, duplicated, renamed
and deleted (`packages/catalogue/src/home-layouts.ts`), and a device profile picks one per menu in
`device_profile_home_layouts` (`packages/catalogue/src/schema/home-layouts.ts:5-30`), no row meaning
the default.

A publish copies every layout into the menu's document as `homeLayouts` and `defaultHomeLayoutId`
(`packages/catalogue/src/menu-document-types.ts:68-92`); a tile whose target the menu does not
reach becomes `{ kind: "empty" }` and a `shortcut_missing` warning. The server resolves each
device's choice against the live version (`resolveDeviceHomeLayouts`,
`packages/catalogue/src/home-layouts.ts:393-441`, called by `listZoneOffers`,
`packages/venue-service/src/operations.ts:818-861`), and the till draws search, then a "Shortcuts"
grid, then a "Full menu" grid (`apps/till/src/widgets/menu-browser.ts`, `#home`), at a fixed 3
columns on a handheld and 6 on a till (`packages/catalogue/src/home-layout-columns.ts:7-8`). A
device's kind is derived from its profile's form factor (`kindOfFormFactor`,
`packages/layouts/src/canvas.ts:3-16`; the till's copy is `apps/till/src/layout.ts:15-30`);
nothing stores "handheld" or "till".

## Decisions

1. **The Device Home Page is the menu's existing home section.** Each menu keeps exactly the one
   `home_layout` section `createMenuShell` makes, and `menu_details.default_home_layout_id` keeps
   pointing at it. The TypeScript property becomes `homeSectionId`; the SQL column keeps its name,
   because a renamed column is a migration that changes nothing a reader can see. The role value
   `home_layout` also stays: changing it changes the CHECK on `sections`, which makes drizzle
   rebuild that table, and a rebuild with foreign keys on deletes or refuses its cascading children
   (CLAUDE.md §3; `section_members` cascades from `sections`). Its members keep today's rules: a
   product or a section the menu reaches, through an included menu too (`checkRef`,
   `packages/catalogue/src/section-members.ts:71-89`, and `structuralReach`,
   `packages/catalogue/src/home-layouts.ts:84-93`); no target twice; a deleted
   target section leaves a missing slot. It creates no offers or prices, as a layout does not today
   (`section-graph.ts`'s `children()` returns nothing for it).
2. **No named layouts.** `createHomeLayout`, `duplicateHomeLayout`, `renameHomeLayout`,
   `deleteHomeLayout`, `setDefaultHomeLayout` and `listHomeLayouts` go, with their routes, client
   methods, live query, screen code and strings. The shortcut writes (`addShortcut`,
   `replaceShortcut`, `removeShortcut`, `moveShortcut`) stay, addressed by menu rather than by layout
   id. Error codes `menu.layout_not_found` and `menu.default_layout_required` are deleted (the
   pre-live rule, CLAUDE.md §3); `menu.shortcut_unreachable` stays and drops its `layoutId` param.
   A development venue that made extra layouts keeps their rows, unread; a reset clears them.
3. **No per-profile choice.** `device_profile_home_layouts` is dropped, with
   `setDeviceHomeLayout`, `deviceHomeLayouts`, `resolveDeviceHomeLayouts`, the
   `LayoutFallback`/`DeviceHomeLayout` types and their `Zone*` twins in `packages/module`, the two
   device-profile routes and the profile screen's "Home page layouts" section, and the till's
   removed-layout notices (`apps/till/src/state/home-layout-notices.ts` and its wiring and strings).
   A device's kind — handheld or till, from its profile's form factor as today — picks which of
   the two display settings it uses. A kitchen screen shows no menu.
> **2026-10-07, A339 supersedes Decision 4’s ranges:** Handheld offers 2–3 columns (default 3); Till offers 4–10 (default 6). Values outside those ranges are refused. Reset a pre-live venue holding an older handheld value above 3.

4. **Two display settings per menu, stored with the draft.** `menu_details` gains six columns, each
   `NOT NULL` with a default and no CHECK (a CHECK makes drizzle rebuild the table; the values are
   validated in code, as a colour is): `handheld_columns` (default 3, 2–6), `handheld_tiles`
   (`colours` or `thumbnails`, default `colours`), `handheld_order` (`home_first` or `menu_first`,
   default `home_first`), and the same three for `till_` (default 6, 6–10). The plan's first task
   runs `drizzle-kit generate` and reads the SQL: it must be the drop and six `ADD` statements and
   no rebuild; if it is not, the build stops there. A save that breaks the range or names another
   value is refused `menu.home_display_invalid` with the `field`.
> **2026-10-06, A291 supersedes Decision 5's old-format path below:** only format 3 live menu
> documents are read. Older formats refuse with `menu.reset_required`; reset the venue instead of
> previewing and republishing them. See [the current menu contract](../../developers/product-categories.md).

5. **The published document carries one `home` block.** `MENU_DOCUMENT_FORMAT` goes from 2 to 3,
   and `homeLayouts` and `defaultHomeLayoutId` are replaced by
   `home: { shortcuts: DocumentTile[]; handheld: HomeDisplay; till: HomeDisplay }`, with
   `HomeDisplay = { columns: number; tiles: "colours" | "thumbnails"; order: "home_first" |
   "menu_first" }`. The document hash covers the whole document (`menuDocumentHash`,
   `packages/catalogue/src/menu-document.ts`), so a changed shortcut or setting marks the menu
   changed, and only Publish puts it on a device; a device reads the live version, never the draft.
   The change list's `layout_changed` and `default_layout_changed` become `home_shortcuts_changed`
   and `home_display_changed` (naming the device kind); the `shortcut_missing` warning loses its
   layout name. A version written in format 2 is left out as not live by the rule that already
   exists for serving (`readLiveDocuments`, `packages/catalogue/src/menu-publication.ts:159`), so
   after the upgrade no device is served a menu until it is published again, or the venue is reset.
   The preview reads the live version without that check (`liveVersions(tx, [menuId], true)`,
   `menu-publication.ts:242`) and would read `home` off a document that has none, which would stop
   such a menu from being previewed, and so from being published (a publish needs the preview's
   hash). So the preview treats a live version in another format as no live version, for its own
   menu and for the other menus it compares; a test previews and publishes a menu whose live
   version is format 2. The status still says `changed` for such a menu, as it does today
   (`menu-publication.test.ts:443-487`).
6. **The served menu carries the live `home` block whole**, and the device chooses its half. The
   zone-offer reads no longer take a device profile for layouts; the plan traces whether
   `listZoneOffers` needs the profile for anything else before removing the parameter.
7. **One set of presentation rules, used by the till and by the preview.** A new browser-safe
   module, `packages/catalogue/src/device-home.ts`, holds the types, defaults and ranges (the
   constants in `home-layout-columns.ts` move into it), the block order with its
   divider (the divider only when both blocks have something to show), and the tile fill: in
   Colours mode a product's frozen effective colour (W92) or a section's own colour, else neutral;
   in Thumbnails mode the product's or section's image, else that colour, else neutral. Both apps
   import it by path, as they import the column constants today. The column count is the setting's,
   and the existing grid rule keeps every tile at least the minimum width, showing fewer columns
   when the screen is narrower (`menu-browser.ts`'s `.grid`); the preview uses the same rule. A
   canvas card on the till (`apps/till/src/widgets/card-grid.ts`) that sets no column count of its
   own follows the menu's setting for the device, so the till counter follows the Till slider; a
   card's own count still wins. The preview's product tile shows what the till's does, the price
   with its unit included.
8. **On the device:** search stays at the top. Below it come the two blocks in the menu's order for
   this device kind. The block that comes first has no visible heading (its region keeps an
   accessible name); the divider before the second block names it — "Full menu" or "Shortcuts", the
   till's existing words. A section tile keeps its "Section" word, so a section and a product
   differ without colour, in both modes; a thumbnail tile keeps the name. A missing or unreachable
   shortcut stays an empty slot, as today. Tapping a section, or an included menu's section, opens
   it behind the breadcrumb as today.
9. **Structure tab:** the tree gets a fixed first row, "Device Home Page", above the menu itself. It
   cannot be renamed, moved or deleted. Its row menu adds a product shortcut or a section shortcut,
   each from a picker of what the menu reaches (the choices the Home tab builds today,
   `apps/dashboard/src/screens/menus-screen.ts:618-707`). Its children are the shortcuts, in order;
   each can be removed and moved by drag or keyboard within that list, as other members move. A
   missing shortcut shows its name marked missing, with Remove only. The shortcut rows do not
   expand into their targets.
> **2026-10-07, A339 supersedes Decision 10’s column clamping:** You can choose two or three handheld columns, and 360px and 390px phones show that choice. The home grid and dashboard preview use a smaller handheld tile minimum while keeping the till minimum. The historical 2026-10-06 measurement below describes the previous layout.

10. **Home page tab:** a Handheld/Till choice, then that device's three controls — a column slider,
    Colours/Thumbnails, and "Device Home Page first"/"Menu first" — each saved as it changes, and
    below them a preview of that device's presentation of the draft. The preview draws the document
    the Preview tab's read already returns (`MenuPreview.document`), at a phone width for Handheld
    and a till width for Till, narrowing to the space the screen has. Because a tile keeps its
    minimum width, a phone shows at most three columns whatever the Handheld slider says (104 px
    tiles and 12 px gaps: three fit in 390 px — arithmetic from the grid rule, not a measurement);
    a line under the slider says narrow screens show fewer columns, and a tablet handheld shows
    more. (2026-10-06: measured on the till at 390 px, the grid is about 310 px wide and shows two columns.)
    Sections open inside it behind
    a breadcrumb; products do nothing. Its search finds this menu's products only, with a line
    saying a device may also show results from other menus available to it.
11. **A shared slider.** No `wt-*` primitive draws a range (`packages/ui/src/components/` has none),
    and a screen may not draw its own field (CLAUDE.md §3), so the item adds `wt-slider`: a labelled
    range showing its value, with the token-painting test and the both-themes accessibility test a
    new primitive needs.

## What a development venue needs

A reset (`wa-wt reset demo <name>`), or republishing every menu: format-2 versions stop counting as
live (decision 5). The migration drops a table and adds columns with defaults; the plan's first
task runs `scripts/migration-upgrade.test.ts` over it before anything builds on it.

## Questions for the owner (none blocks the build; each has a default)

1. **Guards under `scripts/` that change because the table goes.** `scripts/schema-constraints.test.ts`
   lists the dropped table's two foreign keys; `scripts/id-columns-are-references.test.ts` uses its
   `layout_id` as one of two proof-by-deletion cases; `scripts/catalogue-engine-neutral.test.ts`
   names the files this item renames or deletes. Default: remove the two key rows and the one
   case (the other case, `option_lists.default_label_id`, stays), and point the file list at the
   new files.
2. **Which block gets the visible label.** Default as decision 8: only the divider names the second
   block, and the first has none.
3. **The Handheld slider above three columns changes nothing on a phone** (decision 10). Default: a
   line under the slider says so, and the preview stays at phone width. Say if the preview should
   offer a tablet width as well.
4. **FYI: a display setting on a menu that another menu includes marks that other menu changed
   too**, because an included menu's whole document is in the including menu's hash
   (`includedMenuHashes`, `packages/catalogue/src/menu-document.ts:236-240`). Home layouts already
   do this today. Default: leave it.

## Out of scope

Cross-menu search (W94), the Preview tab redesign (W95), profile scope and switching (W97).
