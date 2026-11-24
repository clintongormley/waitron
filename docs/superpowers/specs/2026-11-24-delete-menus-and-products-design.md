# Menus and products: Delete, not Archive

Status: approved by the owner, 2026-11-24 (interactive design session, quoted below).

## Why

Owner, 2026-11-24, after approving the [Menus and Set menus lists](2026-11-24-menus-list-tabs-design.md):
"i do wonder if we need archived or we should just call it "delete" and not let them come back, both
for menus and for products". Told what would change and what would be lost, and asked whether to go
ahead "with seasonal menus simply staying in the list": "y".

Archive is already permanent, already frees the name, and its own warning says "This can't be
undone". Printers, devices, stations, courses, tables, zones and departments already say Delete
(A435, owner, 2026-10-08).

This replaces, for products and variants, A435's Archive and its read-only Archived filter (and
A463's Show archived switch), and for menus Part 2 of the
[menus list usage and archive design](2026-11-23-menus-list-usage-and-archive.md): Archive, the
Archived filter, the read-only view, and copying an archived menu.

## Decision

### What a person sees

- Products, variants, menus and set menus say **Delete** (_Eliminar_), as the other kinds do, in row
  menus, bulk actions, dialogs, refusals, alerts, the activity words and the till. A variant that has
  not been saved keeps **Remove**; a saved variant marked in the editor reads **Deleted when saved**,
  with **Keep**.
- A deleted one is not listed anywhere, and nothing brings it back. Gone: Products' **Show
  archived**, its read-only details panel and the Archived value under Availability; the Menus
  list's **Archived** filter choice, its read-only view, and **Copy…** on an archived menu. Copy
  stays on every other menu.
- Menus' Status filter becomes All, Published and Requiring attention, starting on All. The Set
  menus page has no Status filter.
- Deleting a category says it **deletes** the products inside it, where it says "archives" today.
  With products and categories selected, the bulk action reads Delete in every case.
- The address of a deleted menu opens the Menus list, and a deleted product's the Products list, as an
  unknown menu's does today (**my call**).
- Anywhere else that shows an archived product today (the unit's delete dialog, the image library)
  no longer does.

### The checks before deleting stay

Every refusal and choice Archive makes today stays, reworded: a product on a live or scheduled menu,
a new main menu for a period, staff menus, the venue's default menu, the menus that lose an included
or set menu when next published, the extras lists a product comes off. The menu's window names the
menu and says how many products are on it, since a wrong delete means rebuilding it. "Archiving is
permanent." becomes "This can't be undone."

### Seasonal menus

A menu used for part of the year stays in the list, in no period, until it is used again. The list
already says "Not used by any period". Nothing is built for this. Its cost, which the owner was told:
a product on that menu cannot be deleted while the menu is published, so it comes off the menu and
the menu is published first.

### Underneath

- The record is kept, hidden (`active` false, as today), because past sales and reports point at it.
  Past sales do not change. A deleted record that nothing points at may be kept hidden too.
- **Units and photos are never deleted with a product.** Owner, 2026-11-24: "no need to delete unused
  photos or units, they can be deleted separately". The next two points make that separate delete
  work.
- **Units.** A deleted product does not stop a person deleting its unit on the Units screen. Today `productsUsingUnit` counts
  archived products, `deleteUnit` then refuses, and `reassignProductsToUnit` refuses to move an
  archived product (`packages/menu/src/units.ts`), so such a unit looks impossible to delete. That
  was read, not tried: write the failing test first.
- **Photos.** Likewise, a deleted product or variant does not stop a person deleting its photo in the
  image library (**my call**). A photo
  a published menu holds stays protected, as today.
- For both, the lane chooses how the deleted record lets go, after tracing every reader that still
  uses a deleted product: open orders, refunds, corrections, reprints, reports.
- **Configuration exports** leave out deleted products, variants, menus and set menus, as they leave
  out deleted stations and courses, together with the rows that would point at them. An export made
  before this change is not a concern (no venue is live).
- **Names in the code.** Error codes, activity kinds, routes, files and functions that say archive for
  these four kinds say delete instead, all copies together (**my call**: names can be changed freely
  only until a venue is live). The `active` column stays. Backups' archives are a different word and
  stay.

### Docs

`docs/developers/design-system.md` (Active and Available, the Filters panel, the bulk actions, the
Menus list), and the products guide in English and Spanish. In the guide, Delete needs a sentence,
not a section.

## Delivery

Lane D, **before** the Menus and Set menus pages, whose spec is adjusted to match. The lane splits it
if it is large; a split must not leave one screen saying both words. The configuration export is a
cross-package contract, so the whole takes the full review weight. Screenshots for the owner before
landing: the delete windows for a menu, a set menu, a product, a variant and a category, and the
Products and Menus lists with their filters open, at desktop and phone width, light and dark, English
and Spanish.
