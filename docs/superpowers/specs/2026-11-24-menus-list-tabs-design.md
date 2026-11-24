# Menus list: one tab for menus, one for set menus

Status: approved by the owner, 2026-11-24 (interactive design session, choices quoted below). Later the
same day the owner replaced Archive with Delete
([spec](2026-11-24-delete-menus-and-products-design.md)), which lands first; the filters below follow it.

## Why

The owner, with a screenshot of the Menus list: "normal menus and set menus are mixed in together
here, and it is not clear which is which. i wonder if we need to move the kind column, or sort by
kind then name, or add an icon or something".

A set menu has no publish status of its own and no periods, so in today's shared table its Status
always says the same thing and its Main menu and Staff menus cells are always empty. The Kind cell,
the only thing that tells the two apart, is the last column, and its text starts higher than the
rest of its row (the list is `top-aligned`, and the Kind cell lacks the padding the other cells
have). In Spanish the two kinds have different names, _Cartas_ and _Menús_, yet both are listed
under "Cartas".

## Decision

The owner chose between three mock-ups: A, two lists on one page; B, one list with the kind and
price under the name and set menus last; C, two tabs, as on Modifiers. Owner: "c". Asked whether
the look of both tabs on a desktop and a phone was right, with the behaviour below listed beside
the pictures: "y".

### The tabs

- The Menus screen's list has two tabs, **Menus** and **Set menus** (_Cartas_ and _Menús_), built as
  Modifiers' Extras and Options tabs are (`apps/dashboard/src/screens/modifiers-screen.ts`). Both
  always show, even when one is empty; an empty tab's table offers its own Add button. The page
  heading stays **Menus**.
- The address holds the tab, so reload, Back and bookmarks keep it. `/menus` alone opens Menus.
  `#checkAddress` in `menus-screen.ts` currently clears a `view` when no menu is open.
- The Add button sits in the tab row's actions slot and changes with the tab: **Add menu** or **Add
  set menu**. The window that asks "Menu or Set menu?" (`menu-kind-choice`) goes.
- An open set menu's trail link reads **Set menus** and returns to that tab, whether it was opened
  from the tab, a link or a bookmark.
- Each tab's table has its own remembered sort and column choices (`viewKey`), as Modifiers' have.
  Search covers the open tab only.

### The Menus tab

Name, Status, Main menu, Staff menus and the row menu, as today, with no Kind column and no set
menus. The Status filter offers All, Published and Requiring attention, starting on All.

### The Set menus tab

- Columns: **Name**, **Price**, **Offered on** and the row menu. No Status column, so "Goes live with
  the menus that offer it" goes from the list.
- **Offered on** lists every active full menu whose working copy holds the set menu, directly or
  through a menu inside it: the list the set menu's own page already shows (`heldBy`,
  `packages/menu/src/set-menus.ts`). Each name is a link that opens that menu. With none, it says
  **Not on any menu**, muted. The menus list read does not carry this today, so it needs adding there,
  in one read for the whole list rather than one per set menu, and it must refresh when a set menu is
  placed in, or taken off, a menu.
- There is no Status filter, so the Filters button in the picture goes: a deleted set menu is not
  listed, and nothing else is left to filter by.
- Sorting: by name and by price. A click on a link opens only that link.
- The row menu keeps today's actions for a set menu.

### On a phone

Each tab keeps one column beside the row menu. On Set menus, the price, then "Offered on" in the
small muted label Main menu uses, with the links under it, stack under the name; with none, "Not on
any menu" alone.

### The demo

The demo's ordinary menu called "Set menus" (`setMenuHolderName`,
`packages/country-es/src/demo/casa-delgado-es.ts`) becomes "Lunch menus" in English, with a matching
name in each of its other languages, so a menu is no longer named after the other tab. Suggested:
"Menús de mediodía" in Spanish; the lane checks each language's name. The guide's demo paragraphs
name it too.

### The guide

The Menus and Set menus sections of `apps/server/src/guide/{en,es}/products.md` change with the
screen, keeping to what the reader does: set menus are under their own tab, made with **Add set
menu**, and **Offered on** shows the menus that sell them. The sentence about where the filters show
set menus goes.

## Pictures

Not committed (the mock-ups rule). On the owner's machine, in the main checkout:
`.impeccable/shots/menus-list-tabs-desktop.png` and `.impeccable/shots/menus-list-tabs-phone.png`.
They are drawn, not screenshots: where they differ from a shared `wt-*` component, the component
wins. "Christmas lunch" is an invented row.

## Not in this work

The set menu editor's own page, and the set-menu rework's dashboard piece
([spec](2026-11-24-set-menus-automatic-grouping-design.md), piece 5), which edits the set menu's
page. Both are in lane D, one after the other.

## Delivery

One pull request, lane D. Nothing here touches fiscal code, migrations or permissions; the menus
list read gains a field both the server and the dashboard use. Update
`docs/developers/design-system.md`'s Menus list paragraphs in the same change. Screenshots for the
owner before landing: both tabs, desktop and phone width, light and dark, English and Spanish.
