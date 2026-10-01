# Product folders

To find products and keep each sale counted once, organise products into folders on the Products
screen at `/manage/catalogue`. Each folder is a reporting category with one internal name. It
has no translations, image or colour. A product belongs to at most one folder; an unfiled product
appears at the top level. Labels and the separate Categories screen are retired.

Open Drinks to see its direct subfolders and products. Use the breadcrumb to go back up. Choose
**All products** to see every product with its folder path, or search by product name, variant
name or folder path across the catalogue. Status and ordering filters affect products; folders
remain available for navigation. **New folder** creates a folder at the current level, and a
folder's row menu offers Rename and Delete.

A folder has at most one parent, stored in `category_details.parent_id`. A save that would make
it its own ancestor is refused with `category.parent_cycle`. A product's folder is
`products.category_id`. When this is null, the product is Uncategorised, which is not a folder
row you can rename or delete.

A variant reads its own reporting category when set, and its product's otherwise. You edit that
choice in the product editor. In the browser, variants sit under their product and move with it;
you cannot select or drag a variant on its own.

Reports can use the classification recorded with each sale, or today's catalogue classification.
Moving a product or renaming a folder does not rewrite recorded sale lines. See
[the two report modes](../superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md#5-the-two-report-modes).

Folders still use the existing kitchen routing in this slice: a route names a product's effective
category directly, not its ancestors. The separate prep-station slice changes that contract; see
[the approved design](../superpowers/specs/2026-09-30-catalogue-menus-routing-design.md).

## Categories are not sections

**Sections** are ordered lists of products and other sections that can be reused across menus and
nested (`sections` and `section_members`, written by `packages/catalogue/src/sections.ts`). Each
menu's structure is built from them, starting at the top-level list the menu owns
(`menu_details.root_section_id`). A section only arranges products. Adding a product
to a section, moving it, removing it or deleting the section changes neither the product's main
reporting category nor the kitchen route it follows (the sections case in
`apps/server/src/catalogue-api.full-manifest.test.ts`), and a product may sit in any number of
sections while it has exactly one main category. The design is the
[menus plan](../superpowers/plans/2026-09-25-menus-categories-home-layouts.md)'s decisions D1–D4.

### Section routes

`mountSectionRoutes` in `apps/server/src/catalogue-api.ts` serves them, behind the same manager
session and permission as the category routes below. A body of the wrong shape is refused with
`management.request_invalid`, naming the field, and an invalid id is refused. `LibrarySection` is
`{ id, internalName, names, image, color, members }`, and a member is
`{ id, position, ref }`, where `ref` is `{ kind: "product", productId }` or
`{ kind: "section", sectionId }`.

| Route | Body → success | Refusals |
| --- | --- | --- |
| `GET /management-api/sections` | → 200, `LibrarySection[]`: library sections only, by internal name | |
| `GET /management-api/sections/usages` | → 200, a map from each library section's id to the `{ menus, sections }` its `/:id/usages` answers; a menu's own lists are not keys | |
| `POST /management-api/sections` | `{ internalName, names?, image?, color? }` → 201, `LibrarySection` | `invalid`, `translation_required`, `content.language_invalid` |
| `GET /management-api/sections/:id` | → 200, `LibrarySection`; a menu's own list is readable too | `not_found` |
| `PATCH /management-api/sections/:id` | Any supplied fields from create → 200, `LibrarySection` | `not_found`, `not_library`, `invalid`, `translation_required`, `content.language_invalid` |
| `DELETE /management-api/sections/:id` | → 204; every list holding it loses it | `not_found`, `not_library` |
| `GET /management-api/sections/:id/members` | → 200, the members in order | `not_found` |
| `POST /management-api/sections/:id/members` | `{ ref, position? }` → 201, the new member | `not_found`, `not_library`, `invalid`, `membership_invalid`, `member_duplicate`, `member_cycle` |
| `POST /management-api/sections/:id/members/products` | `{ productIds }` → 200, `{ added }`; a product the list already holds is skipped | `not_found`, `not_library`, `membership_invalid` |
| `DELETE /management-api/sections/:id/members/:memberId` | → 204 | `not_found`, `not_library` |
| `PUT /management-api/sections/:id/members/:memberId/position` | `{ to }` → 200, the members in order | `not_found`, `not_library`, `invalid` |
| `POST /management-api/sections/:id/members/:memberId/replace` | `{ ref }` → 200, the member | `not_found`, `not_library`, `membership_invalid`, `member_duplicate`, `member_cycle` |
| `POST /management-api/sections/:id/duplicate` | `{ internalName, memberIds, replaceIn?: { sectionId, memberId } }` → 201, `LibrarySection` | `not_found`, `not_library`, `invalid`, `membership_invalid`, `member_cycle` |
| `GET /management-api/sections/:id/usages` | → 200, `{ menus, sections }` that a delete would touch | `not_found` |

A code without a prefix in the table is a `menu_section.*` code. Besides those, a malformed id
answers `shared.invalid_id` (400), a malformed body `management.request_invalid` (400), and a
`names` key that is not a language code `content.language_invalid` (400). `not_found` (404) is an
unknown section, member, or section named in `ref`. `not_library` (409) is a write to a menu's home layout, a `ref` naming a
section outside the library, and, for `PATCH`, `DELETE` and the source of `duplicate`, any section
outside the library. `invalid` (400) is a blank internal name, a
colour that is not lower-case `#rrggbb`, an image the library does not hold, or a `position` or
`to` that is not a whole number of zero or more. `translation_required` (400) is a non-empty
`names` with no text in the default content language. `membership_invalid` (400) is a `ref` or
`productIds` entry that is not a top-level product, a repeated `productIds` entry, or a `memberIds`
entry that is repeated or not a member of the source. `member_duplicate` (409) is a `ref` the list
already holds, and `member_cycle` (409) one that would make a section contain itself.

A menu's own structure is read with `GET /management-api/catalogues/:id/structure` → 200,
`{ rootSectionId, nodes }`, where each node is `{ memberId, ref }` and a section's node also carries
its `children`; an unknown menu is `catalogue.not_found` (404). The top level is written with the
member routes above on `rootSectionId`.

`PATCH /management-api/catalogues/:id/items/:itemId` → 204 sets the menu's settings for one
product its structure reaches: `grossPrice` (a price, or null for the product's own) and `active`,
the menu's own switch for the product (a boolean, else `management.request_invalid` naming
`active`). Either may be left out. An item whose product the structure no longer reaches is
`menu_item.not_found` (404). A menu's published version leaves out the products switched off when
it was published, so switching one off takes it off the till only once the menu is published again.

`GET /management-api/catalogues/:id/prices` lists the products the structure reaches, one row
each, for the dashboard's price list, sold-out ones and ones switched off on this menu included and
Inactive ones left out, or nothing while the menu is inactive: `{ menuItemId, productId, name,
categoryId, placements, productPrice, override, effectivePrice, active, variants }`.
`productPrice` is the product's own price, `override` the menu's (`grossPrice` above, null when it
sets none), and `effectivePrice` the menu's price for the product itself: `override`, or else
`productPrice`. A product with Active variants is sold only as one of them, and a variant with no
price on this menu and none of its own is charged `effectivePrice`. `categoryId` is the product's
reporting category, and each of `variants` is `{ variantId, price, offered }` as
`GET …/items/:itemId/variants` gives it. An unknown menu is `catalogue.not_found` (404).

`GET /management-api/catalogues/:id/status` → 200 gives a menu's publication state:
`{ state: "unpublished" }`, or `{ state, version, publishedAt, hash }` for its live version, where
`state` is `current` while the working menu hashes to that version's `hash` and `changed` once it
does not. `GET /management-api/catalogues/status` gives every menu's, as one object keyed by menu
id. `GET /management-api/catalogues/:id/preview` → 200, `{ hash, changes, warnings, status }`:
`hash` is the working menu's, `changes` what publishing it would change, `warnings` the home-layout
shortcuts publishing would leave out, and `status` the state above.
`POST /management-api/catalogues/:id/publish` (`{ expectedHash }`) → 200, `{ versionId, number }`,
makes the working menu the live version. It rebuilds the menu and refuses with
`menu.changed_since_preview` (409) when that hashes to anything but `expectedHash`; a menu that
already matches its live version answers that version and writes nothing. A missing or non-string
`expectedHash` is `management.request_invalid` (400). On the three routes that name a menu, an
unknown menu is `catalogue.not_found` (404) and a malformed id `shared.invalid_id` (400). Tills
sell from each menu's live version, and only while the menu is active (`zoneMenuIds`,
`packages/venue-service/src/operations.ts`); a deactivated menu is not served at all. Of what the
version holds, only availability, course and reporting category are read from the current rows
when it is served, and the VAT class is the one the version froze; the version holds no rate (`applyLiveFields`, `packages/catalogue/src/menu-document.ts`).

### Home layout routes

A home layout is a list its menu owns, holding the shortcuts ("tiles") a till or handheld shows on
its home page. Every menu has one default layout, named Home when the menu is created, and may have
more. A tile is a member of the layout's list, but it is written only through the tile routes below:
the section member routes above refuse every write into a layout with `menu_section.not_library`.
A tile adds nothing to the menu: no offer, no price and no place in its structure, and removing one
removes only the tile. `mountHomeLayoutRoutes` in `apps/server/src/catalogue-api.ts` serves the
first table, behind the same manager session and permission as the section routes, and
`packages/catalogue/src/home-layouts.ts` does the work. A layout is
`{ id, name, isDefault, tiles }`, and a tile is `{ memberId, position, ref, name, reachable }`,
where `name` is the product's staff name or the section's internal name, and `reachable` is false
once the menu's working structure no longer reaches the tile's target (the dashboard shows it as
not on this menu).

| Route | Body → success | Refusals |
| --- | --- | --- |
| `GET /management-api/catalogues/:id/home-layouts` | → 200, the menu's layouts, the default first and the others by name, each with its tiles in order | `catalogue.not_found` |
| `POST /management-api/catalogues/:id/home-layouts` | `{ name }` → 201, `{ id }` | `catalogue.not_found`, `menu_section.invalid` |
| `PUT /management-api/catalogues/:id/default-home-layout` | `{ layoutId }` → 204 | `catalogue.not_found`, `menu.layout_not_found` |
| `POST /management-api/home-layouts/:layoutId/duplicate` | `{ name }` → 201, `{ id }`; the copy holds the same tiles in the same order | `menu.layout_not_found`, `menu_section.invalid` |
| `PATCH /management-api/home-layouts/:layoutId` | `{ name }` → 204 | `menu.layout_not_found`, `menu_section.invalid` |
| `DELETE /management-api/home-layouts/:layoutId` | → 204; its tiles go with it | `menu.layout_not_found`, `menu.default_layout_required` |
| `POST /management-api/home-layouts/:layoutId/tiles` | `{ ref, position? }` → 201, the new member `{ id, position, ref }` | `menu.layout_not_found`, `menu_section.not_found`, `menu_section.not_library`, `menu_section.membership_invalid`, `menu_section.member_duplicate`, `menu_section.invalid`, `menu.shortcut_unreachable` |
| `DELETE /management-api/home-layouts/:layoutId/tiles/:memberId` | → 204 | `menu.layout_not_found`, `menu_section.not_found` |
| `PUT /management-api/home-layouts/:layoutId/tiles/:memberId/position` | `{ to }` → 200, the tiles in their new order | `menu.layout_not_found`, `menu_section.not_found`, `menu_section.invalid` |

Besides those, a malformed id answers `shared.invalid_id` (400) and a malformed body
`management.request_invalid` (400). `menu.layout_not_found` (404) is an id that names no home
layout, or, where the route also names a menu, none of that menu's. `menu.default_layout_required`
(409) is a delete of the menu's default layout: make another the default first.
`menu.shortcut_unreachable` (409) is a tile for a product or library section the menu's working
structure does not reach. Reach is by membership alone, so a product the menu has switched off, an
inactive product, and any product on an inactive menu are accepted; publishing leaves such a tile
out of the version and the preview names it in `warnings`. `menu_section.not_library` (409) is a
tile naming a list a menu owns: any menu's top level or home layout. `menu_section.not_found`
(404) is a section named in `ref` that does not exist, or a member the layout does not hold;
`menu_section.membership_invalid` (400) a `ref` that is not a top-level product;
`menu_section.member_duplicate` (409) a target the layout already holds; and
`menu_section.invalid` (400) a blank name or a `position` or `to` that is not a whole number of
zero or more.

A device profile chooses one layout per menu; with no choice it shows the menu's default. The two
routes are in `apps/server/src/management-api.ts`, behind the `layout.configure` permission like
the other device-profile routes, and the choices are stored in `device_profile_home_layouts`.

| Route | Body → success | Refusals |
| --- | --- | --- |
| `GET /management-api/device-profiles/:id/home-layouts` | → 200, an array with every menu by name, each `{ menuId, menuName, layouts, selectedLayoutId, selectedRemoved }`, where `layouts` is `{ id, name, isDefault }[]` with the default first | `device_profile.not_found` |
| `PUT /management-api/device-profiles/:id/home-layouts/:menuId` | `{ layoutId }`, a layout id or null for the default → 204 | `device_profile.not_found`, `catalogue.not_found`, `menu.layout_not_found`, `management.request_invalid` |

`selectedLayoutId` is null when the profile uses the default. Deleting a layout leaves a profile's
choice of it in place, and `selectedRemoved` is then true, so the screen can show the choice as
removed and offer to reset it (the plan's decision D14). `menu.layout_not_found` (404) here is a
layout of another menu or an id that is no home layout; `layoutId` must be present, and anything
but a well-formed id or null is `management.request_invalid` (400). A malformed profile id answers
`device_profile.not_found` and a malformed menu id `catalogue.not_found`, both 404. Deleting a
device profile deletes its choices, and a venue's configuration export carries them, remapped on
import to the new menu and layout ids.

A till reads the structure and the layouts from each menu's live version, not from the working
state: both offers routes give each menu its `structure`, `homeLayouts` and `defaultHomeLayoutId`,
and they and `GET /api/menu-state` give each menu the device's `homeLayoutId` and a `layoutFallback`
(`resolveDeviceHomeLayouts`, `packages/catalogue/src/home-layouts.ts`). The profile's choice counts
while the live version holds that layout, so a layout deleted or renamed since the last publish
keeps showing, under its published name, until the menu is published again. Otherwise the till gets
the live default, with `layoutFallback` `layout_unpublished` when the menu still has the chosen
layout but has not published it, and `layout_removed` when it no longer has it; a request from no
enrolled device, or from a device whose profile has no choice for that menu, gets the default and
`null`. The till warns about `layout_removed` once for each removed layout of a menu while its page
stays loaded (a removal it cannot name, only if nothing has been said about that menu yet), and
switches silently otherwise (`apps/till/src/till-app.ts`).

## Moving and deleting

Use **Select**, tick products and folders, and choose **Move to…**. Pick a destination folder or
**All products (top level)**. A selected folder and its descendants are excluded as destinations,
and the server also refuses such a move with `category.parent_cycle`. On a pointer device you
can drag a product, folder or selection onto a folder or breadcrumb. Touch and keyboard users use
the same selection actions.

Navigating, searching or changing a filter clears the selection, so actions do not reach items you
have hidden. **Cancel** clears it and restores the ordinary toolbar. A Delete you already
requested keeps its captured selection, including while the folder summary is being read.

**Delete** makes selected products Inactive. Their rows and previous sales remain, and you can
restore the products later. Before deleting a non-empty folder, choose what happens to its contents:

- **Move it up to the parent folder** keeps the products active and moves the folder's direct
  products and subfolders to its parent. For a top-level folder they move to the top level.
- **Delete it too** removes the subtree and makes its products Inactive. The summary shows the
  numbers of subfolders, products and kitchen routes affected.

An empty folder is deleted without confirmation. A folder's row-menu Delete uses the same path.
If the summary cannot be read, deletion waits for a successful new attempt rather than asking you
to approve unknown contents. A refused action keeps its dialog open with a message at the bottom.
Deleting a folder removes the preparation routes naming it. A variant whose own category is
cleared falls back to its product's category.

## API

These routes require a management session with `person.manage`, the catalogue write permission
in `apps/server/src/catalogue-api.ts`. A category is `{ id, name, parentId }`, where `name` is a
trimmed plain string and `parentId` is an ID or null. A blank name is `category.invalid` (400);
a non-string name is `management.request_invalid` (400).

| Route | Body or response |
| --- | --- |
| `GET /management-api/categories` | 200, category array |
| `POST /management-api/categories` | `{ name, parentId? }`; 201, saved category |
| `GET /management-api/categories/:id` | 200, category |
| `PATCH /management-api/categories/:id` | supplied name or parent fields; 200, saved category |
| `POST /management-api/folders/move` | `{ productIds, categoryIds, to }`; 204 |
| `POST /management-api/folders/delete` | `{ productIds, categoryIds, contents }`; 204 |
| `GET /management-api/folders/summary?id=<id>&id=<id>` | 200, `{ id, folders, products, routes }[]` |

Both ID arrays are required and contain distinct UUIDs. `to` is a folder ID or null. `contents`
is `move_up` or `delete`. For example, once you have created Cocktails and your products, use their
returned IDs to move two products and a folder together:

```http
POST /management-api/folders/move
Content-Type: application/json

{
  "productIds": ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  "categoryIds": ["33333333-3333-4333-8333-333333333333"],
  "to": "4a9d2c1e-6f3b-4c8a-9e21-7b5d0f3c8a12"
}
```

The successful response is `204 No Content`. A missing product or variant ID is `product.not_found`
(404); a missing folder is `category.not_found` (404); a folder move into itself or its descendants
is `category.parent_cycle` (409). Malformed arrays or repeated IDs are `management.request_invalid`
(400), and a malformed UUID is `shared.invalid_id` (400). Folder-summary counts cover each complete
subtree; the browser counts selected roots when ancestors and descendants are selected together.

The former per-category delete, dependants and product-membership routes are retired. Use the
folder selection operations above. The product editor still saves `primaryCategoryId`; a body
sending the removed `categoryIds` or `labelIds` is refused with `product.invalid`.

## Storage and development reset

`categories` in core holds the name; `category_details` in catalogue holds the parent. The label
tables and category image/colour columns are dropped by the folder migrations. Catalogue drops
media's category-image triggers before dropping the column, and media drops them again after its
baseline on a fresh database. The section-image triggers remain part of media's own migration set.

Before opening a development venue on this branch, run `wa-wt reset demo <worktree-name>`.
The folder migration does not convert old JSON names or preserve the removed fields. A venue
opened without that reset can display a name as JSON text. Do not add a data backfill for this
preproduction change.

The folder move/delete tests in `packages/catalogue/src/catalogue-items.test.ts` check mixed
selections, cycles, overlapping subtrees and rollback. `scripts/migration-upgrade.test.ts` checks
the migration sequence, and the schema and trigger guards check the resulting constraints. These
are separate checks: a successful fresh migration does not substitute for exercising an upgrade.
