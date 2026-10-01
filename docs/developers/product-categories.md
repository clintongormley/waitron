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

**Sections** arrange products for selling, independently of their reporting category and kitchen
route. Each section belongs to one menu. To share a set of products, include its menu in another
menu as a folder; you cannot attach another menu's individual section. Adding, moving or removing
products in a section does not change their category or preparation route
(`apps/server/src/catalogue-api.full-manifest.test.ts`).

### Section routes

You edit sections within their owning menu. `mountSectionRoutes` in
`apps/server/src/catalogue-api.ts` serves these routes behind the same manager session and
permission as the category routes below. A section answer is
`{ id, internalName, names, image, color, members }`. A member is `{ id, position, ref }`, where
`ref` is `{ kind: "product", productId }` or `{ kind: "section", sectionId }`.

| Route | Body and success |
| --- | --- |
| `POST /management-api/sections/:id/sections` | `{ internalName, names?, image?, color?, position? }` creates a section in this list and gives it the same owner; 201, `{ id }` |
| `GET /management-api/sections/:id` | 200, the section, root or layout |
| `PATCH /management-api/sections/:id` | Supplied presentation fields from create; 200, the saved section |
| `DELETE /management-api/sections/:id` | 204; deletes the section and its owned descendants, and preserves home tiles pointing at them as missing slots |
| `GET /management-api/sections/:id/members` | 200, the members in order |
| `POST /management-api/sections/:id/members` | `{ ref, position? }`; 201, the new member |
| `POST /management-api/sections/:id/members/products` | `{ productIds }`; 200, `{ added }`; skips products already held |
| `DELETE /management-api/sections/:id/members/:memberId` | 204 |
| `PUT /management-api/sections/:id/members/:memberId/position` | `{ to }`; 200, the members in their new order |
| `POST /management-api/sections/:id/members/:memberId/replace` | `{ ref }`; 200, the member, keeping its id and position |

The collection routes, usages routes and section duplication route have been removed. Create
nested sections with `/:id/sections`; add products or include a menu root with the member routes.
The generic readers give a partial view of Home: they omit missing members, and the structure
graph's `children` gives no Home members. Read Home through the layout routes below.

Malformed ids answer `shared.invalid_id` (400); a malformed body answers
`management.request_invalid` (400), naming its field. `menu_section.not_found` (404) names an
unknown section (`sectionId`) or a member not held by that list (`sectionId`, `memberId`).
`menu_section.wrong_role` (409, `sectionId`, `role`) refuses presentation edits or deletes of roots
and layouts, structure writes into a layout, and a member ref to anything other than a menu root.
It also refuses removing or replacing a member that references an owned section, naming that
section's id and `role: "section"`. Delete the section through `DELETE /management-api/sections/:id`, using the
owned section's id.
`menu_section.member_cycle` (409, `sectionId`, `childSectionId`) refuses a loop of inclusions,
including a menu containing itself. `menu_section.member_duplicate` (409, `sectionId`) refuses
an already-held target. `menu_section.membership_invalid` (400) refuses missing or variant product
ids and repeated ids in a product batch. `menu_section.invalid` (400, `field`) refuses a blank
internal name, an invalid colour or image, and a negative or non-integer position.
`menu_section.translation_required` (400, `field: "names"`, `language`) refuses a non-empty
customer-name map without text in the default language; invalid language keys answer
`content.language_invalid` (400).

### Menu structure, prices and publication

`GET /management-api/catalogues/:id/structure` gives
`{ rootSectionId, root, nodes, includable, includedBy }`. Section nodes carry presentation fields,
`ownerMenuId` and `children`; an included menu root also carries `includedMenuId`. `includable`
lists active menus that would make no cycle as `{ id, name, rootSectionId }`; `includedBy` lists
direct including menus as `{ id, name }`. Write the menu's top level through the member routes on
`rootSectionId`. An unknown menu answers `catalogue.not_found` (404).

`PATCH /management-api/catalogues/:id/items/:itemId` returns 204. Set `grossPrice` to a price or
null, and `offered` to true, false or null. Null clears this menu's decision so the combined menu
can supply it; omitting a field keeps its saved value. The retired `active` field is refused with
`management.request_invalid` (400, `field: "active"`), as is a non-boolean, non-null `offered`
(`field: "offered"`). An item no longer reached by this menu answers `menu_item.not_found` (404).
Publish again to change what the till sells.

`GET /management-api/catalogues/:id/prices` gives one row per active product reached by the
working structure, including sold-out products and products switched off for this menu. An inactive
menu gives no rows. Each row is
`{ menuItemId, productId, name, categoryId, placements, productPrice, override, effectivePrice, combined, offered, variants }`.
`productPrice` is the product's own price; `override` and `offered` are this menu's saved decisions,
which may be null. `combined` explains the resulting price and on/off setting, including each
variant. Each setting is either decided, with its `value`, `source` and `otherwise`, or a clash
with its `candidates`. A source identifies this menu's decision, the product, a parent, or an
included menu and that menu's source. The scalar `effectivePrice` does not explain a clash: read
`combined.price` before showing a price as decided.

A menu's own decision wins. Otherwise its own placements and its active included menus contribute
values; equal values agree, differing values or an unresolved included value clash. Sizes use
size-level price decisions first, then the combined product price when there are none. Their price
source records whether it was decided at the size or product level. For example, if Drinks sets beer
to €3.00 and Casa Delgado includes only Drinks' beer, Casa charges €3.00. If Casa also places that
beer in its own Specials at the product's €2.80, the two values clash. Setting Casa's own beer
price to €3.00 resolves it. `variants` keeps the menu's size settings as
`{ variantId, price, offered }`; `combined.variants` explains their result.

`GET /management-api/catalogues/:id/status` gives `{ state: "unpublished", clashes }`, or
`{ state, clashes, version, publishedAt, hash }`, with `state` current or changed relative to the
live version. `clashes` counts unresolved settings. `GET /management-api/catalogues/status` gives
all menus' statuses keyed by menu id. `GET /management-api/catalogues/:id/preview` gives
`{ hash, changes, warnings, status, clashes, document }`. `clashes` lists the products, sizes and
fields that need a decision. `document` is the proposed published document, with the combined
structure and Home layouts; missing targets occupy `{ kind: "empty" }` slots. Each warning is
`{ kind: "shortcut_missing", layoutName, name }`.

`POST /management-api/catalogues/:id/publish`, with `{ expectedHash }`, gives
`{ versionId, number }` (200). It first refuses unresolved settings with
`menu.clashes_unresolved` (409, `menuId`, `count`), then refuses a changed working hash with
`menu.changed_since_preview` (409, `menuId`). An unchanged menu returns its existing live version
without writing another. Missing or non-string `expectedHash` answers `management.request_invalid`
(400). A malformed menu id answers `shared.invalid_id` (400), an unknown menu
`catalogue.not_found` (404).

Tills sell from live versions of active menus. Availability, course and reporting category are
applied from current rows when serving that version; its VAT class is frozen, and it holds no VAT
rate (`applyLiveFields`, `packages/catalogue/src/menu-document.ts`). Menu extras use product-level list attachments and settings, including their active filters;
there are no per-menu extras publications or overrides.

### Home layout routes

A menu owns its Home layouts and never inherits another menu's layouts. Its default layout is
created as Home. A tile is a shortcut and adds no product, price or placement to the menu. The
layout writer checks that the working structure reaches its target, including targets in included
menus. Use the tile routes to write Home: generic section writes refuse it with
`menu_section.wrong_role` (409).

A layout is `{ id, name, isDefault, tiles }`. A tile is
`{ memberId, position, ref, name, reachable, missingName }`. Its `ref` names a product, a section,
or a deleted target as `{ kind: "missing", name }`. `reachable` checks working membership;
`missingName` is null for a reachable target and otherwise records its name or section path.
Publishing retains an empty slot for a target excluded from the document, so later tiles keep their
positions. The editor lets you remove or replace a missing tile; replacing keeps its member id and
position.

| Route | Body and success | Refusals |
| --- | --- | --- |
| `GET /management-api/catalogues/:id/home-layouts` | 200, layouts, default first then by name | `catalogue.not_found` |
| `POST /management-api/catalogues/:id/home-layouts` | `{ name }`; 201, `{ id }` | `catalogue.not_found`, `menu_section.invalid` |
| `PUT /management-api/catalogues/:id/default-home-layout` | `{ layoutId }`; 204 | `catalogue.not_found`, `menu.layout_not_found` |
| `POST /management-api/home-layouts/:layoutId/duplicate` | `{ name }`; 201, `{ id }`, with the same tiles in order, including missing slots | `menu.layout_not_found`, `menu_section.invalid` |
| `PATCH /management-api/home-layouts/:layoutId` | `{ name }`; 204 | `menu.layout_not_found`, `menu_section.invalid` |
| `DELETE /management-api/home-layouts/:layoutId` | 204, deleting its tiles too | `menu.layout_not_found`, `menu.default_layout_required` |
| `POST /management-api/home-layouts/:layoutId/tiles` | `{ ref, position? }`; 201, `{ id, position, ref }` | `menu.layout_not_found`, `menu_section.not_found`, `menu_section.wrong_role`, `menu_section.membership_invalid`, `menu_section.member_duplicate`, `menu_section.invalid`, `menu.shortcut_unreachable` |
| `POST /management-api/home-layouts/:layoutId/tiles/:memberId/replace` | `{ ref }`; 200, the member, keeping its id and position | `menu.layout_not_found`, `menu_section.not_found`, `menu_section.wrong_role`, `menu_section.membership_invalid`, `menu_section.member_duplicate`, `menu.shortcut_unreachable` |
| `DELETE /management-api/home-layouts/:layoutId/tiles/:memberId` | 204 | `menu.layout_not_found`, `menu_section.not_found` |
| `PUT /management-api/home-layouts/:layoutId/tiles/:memberId/position` | `{ to }`; 200, tiles in their new order, including missing slots | `menu.layout_not_found`, `menu_section.not_found`, `menu_section.invalid` |

Malformed ids answer `shared.invalid_id` (400) and malformed bodies `management.request_invalid`
(400). `menu.layout_not_found` (404, `layoutId`, and `menuId` when checking ownership) refuses an
absent layout or one belonging to another menu. `menu.default_layout_required` (409, `layoutId`)
refuses deletion of the default. `menu.shortcut_unreachable` (409, `layoutId`, `ref`) refuses a
target outside the working structure, including the menu's own root. Switched-off or inactive
products are structurally accepted, but publish as empty tiles. `menu_section.wrong_role` (409,
`sectionId`, `role`) refuses a layout as a target. `menu_section.not_found` names a missing section
or member; a product target must be a stored top-level product or it answers
`menu_section.membership_invalid` (400). A repeated target answers `menu_section.member_duplicate`
(409), and invalid names and positions answer `menu_section.invalid` (400, `field`).

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

The folder move/delete tests in `packages/catalogue/src/catalogue-items.db.test.ts` check mixed
selections, cycles, overlapping subtrees and rollback. `scripts/migration-upgrade.test.ts` checks
the migration sequence, and the schema and trigger guards check the resulting constraints. These
are separate checks: a successful fresh migration does not substitute for exercising an upgrade.
