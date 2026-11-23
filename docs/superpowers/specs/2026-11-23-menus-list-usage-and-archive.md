# Menus list: where each menu is used, and archiving a menu

Status: approved by the owner, 2026-11-23 (interactive design session, choices quoted below).
Part 2 corrected the same evening: no Restore (archive is for good, Copy brings a menu back).
Builds on PR #4158 (the menus list's Status cell, Changes column removed); start after it lands.

## Why

A 2026-11-23 design critique of the Menus list found the row does not say where or when a menu is
used, so an owner must remember which period starts on which menu. The owner then noticed there is
no way to get rid of an old menu.

## Part 1: two columns saying where a menu is used

Owner's words: "period names only, but maybe a second column showing what periods it is also
available for the staff", then "maybe with links to the periods".

- A column for the periods where this menu is the **starting menu** (`menu_periods.menu_id`), and a
  second column for the periods where staff **can also switch to it** (`menu_periods.staff_menu_ids`).
  Suggested headings: "Starts" and "Staff can switch" — the lane may propose better words in the PR
  screenshots.
- Each period name is a **link to that period** where it is edited.
- Period names only; the department is added only when two departments have a period of the same
  name ("Bar: Lunch").
- A menu no period uses says so in the first column ("Not used by any period"), muted.
- On a phone the two lists stack under the name with the Status cell, as Status already does.
- Set menus are not attached to periods directly; their cells stay empty.
- **Boundary:** periods live in the `venue-service` module, and the core menus screen must not import
  it (`scripts/module-seams.test.ts`). This needs a new seat in the dashboard contract
  (`packages/dashboard-kit/src/contract.ts`) or the server's menu summary, filled by venue-service.
  That is a cross-package contract change, so it takes the full review weight. The same seat serves
  Part 2's check of which periods use a menu.

## Part 2: archiving a menu

Owner's choices (2026-11-23): "Archive, like Products", "Pick a replacement", and, after weighing
restore against copy, "Copy under a new name". The owner also asked for filters like other lists
rather than a separate control, and decided against an extra "needs attention" filter because
sorting by Status already brings those menus first.

- **Archive is for good, like products** (A435, owner 2026-10-08: "Products are archived for good. No
  way back."). The row's ⋮ menu gets **Archive…**. There is no Restore.
- **Archiving frees the name.** `assertMenuNameFree` (`packages/menu/src/menu-names.ts`) counts
  archived menus today, so an archived menu would block a new menu of the same name; count active
  menus only, as products do.
- **Show archived** is a switch at the top of the list's **Filters** panel, as on Products
  (design-system.md, "Products: Active and Available are two different words"). Archived menus are
  listed read-only (View, no editing, no publishing), and their ⋮ offers **Copy…**, which already
  asks for a name no menu holds. The copy is a new menu, so it starts unpublished. This is how a
  seasonal menu comes back.
- **Underneath:** `deactivateMenu` (`packages/menu/src/operations.ts`) already sets `active` false
  and records `menu.archived` in the activity log; nothing calls it yet. A true delete is not
  possible once a menu has been sold from, because past orders and sales point at it.
- **A menu a period starts on:** the archive window lists each such period and asks which menu it
  should start on instead (active menus only). Archiving and the replacements are one change, in one
  transaction. Today the server refuses an inactive menu as a period's starting menu
  (`packages/venue-service/src/menu-timetable.ts`), so a period must never be left pointing at an
  archived menu.
- **A menu staff can switch to in a period:** it is removed from those periods' lists, and the
  window says which.
- **A menu other menus include, or a set menu placed in full menus:** the window lists those menus and
  says they lose it the next time they are published. If the lane finds a case that would leave a
  published menu or a till broken, bring it back as a question rather than choosing.
- **Archived products and a copy:** archiving a product is refused while it is on any published
  menu, and once allowed it is taken off every menu's working copy, archived menus included
  (`packages/menu/src/archive.ts`, `takeOffMenus`). A copy of an archived menu therefore holds no
  archived products; check that the copy is taken from the working copy, not a published version.
- Guide: the Menus guide section (`apps/server/src/guide/{en,es}/products.md`) gets a short
  sentence on archiving, Show archived and copying an archived menu, in both languages.

## Delivery

Two PRs: Part 1 first (it adds the seat), then Part 2. Each PR carries screenshots of the list and
the window at desktop and phone width, light and dark, for the owner to review there; a small
change the owner asks for comes back as a new lane item.
