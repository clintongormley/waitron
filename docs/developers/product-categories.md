# Product categories

To find products and keep each sale counted once, organise products into categories on the Products
screen at `/manage/catalogue`. Each category is a reporting category with one internal name, shown
on the Products screen as a row of its tree. It has no translations or image, and it may have a
colour, which every product under it takes unless the product has one of its own or a coloured
category nearer to it ([products.md](products.md), _Colour_). A product belongs to at most one category; one
in none sits directly under **All products**. Labels and the separate Categories screen are retired.

The screen is one tree. Its first row, **All products**, holds every category and every product
filed in none; each category opens in place, with its subcategories above its products. A click or
Enter on a category's row opens or closes it, and the categories a person opens are remembered in
that browser. Search finds products by name, variant name or category path and opens every category
on the way to a match; clearing it restores what was open. Status and ordering filters affect
products; categories stay. The address names the category last opened, as
`/manage/catalogue/category/<id>`; closing that category, or one above it, names the closed
category's parent.

A category has at most one parent, stored in `category_details.parent_id`. A save that would make
it its own ancestor is refused with `category.parent_cycle`. A category's name must differ,
ignoring case and surrounding spaces, from every other category with the same parent; a save that
breaks this is refused with `category.name_taken`. A category moving into a parent, including the
children a delete moves up, is checked against the categories already there, and two categories
that share a name are refused when they move in together. Categories that already share a name
are not refused when a save leaves them as they are. A product's category is
`products.category_id`. When this is null, the product is Uncategorised, which is not a category
row you can rename or delete.

A category is named in the tree itself: Add category and a row's Rename open a box in place, which
Enter or leaving the box saves, and Esc or a blank name cancels. A colour square sits after each
category's name and count, an empty outline when it has no colour, and another inside the open box,
at its end. Either square opens a small chooser (`apps/dashboard/src/widgets/category-color-form.ts`)
holding the shared swatches, No colour and Custom. Choosing a swatch or No colour is the answer and
closes it; Custom answers once the colour picker settles on a colour; Cancel and Esc change nothing.
From a row's square the choice is saved at once, as the colour alone, never the name or the parent,
so a rename or a move made while the chooser is open is kept; a refused colour stays in the chooser,
under it. From the box's square nothing is saved: the box takes the colour, the cursor goes back to
the box with its text as it was, and Enter saves the name with the colour, sending the colour only
when one was chosen in that box and it differs from the category's current one. Esc or a blank name
drops the chosen colour with the box. The box's square is not a Tab stop, so Tab still leaves the
box and saves it; from the keyboard a category's colour is set from its row's square.

A red asterisk beside a category means the route the Made at column shows for it reaches no
active station, so it reads No replacement or Nowhere. That route is the category's baseline:
Made at leaves out exceptions limited to one service zone or one product, so some of a marked
category's dishes can still be made in a zone, or for a product, that such an exception covers. A
rule naming a disabled station ends in No replacement unless that station's chain of fallbacks
reaches a station that is active; the default station does not stand in for it. A category no
rule covers is made at the default station while that station is active, and reads Nowhere
when it is disabled or none is set. A route to No preparation carries no asterisk. The
asterisk's tooltip explains the warning. To clear it, set a claim, or an exception that covers the
category in every service zone, on Prep Stations; or enable the station its rule names or one in
that station's chain of fallbacks; or, for a category no rule covers, enable the default station,
or use Make default on Prep Stations when none is set.

A variant is always in its product's reporting category. Its effective category
(`effectiveProductColumns.categoryId`, `packages/catalogue/src/variant-fallback.ts`), which
menus, sale classification and kitchen routing read, is the product's even where an
older variant row still stores one of its own, and the product editor offers a variant no category
choice. In the tree, variants sit under their product and move with
it; you cannot select or drag a variant on its own. The product editor shows a product's category as
its path, with a Change link that opens the category list as an indented tree
([Products](products.md#the-editor-form)).

Reports can use the classification recorded with each sale, or today's catalogue classification.
Moving a product or renaming a category does not rewrite recorded sale lines. See
[the two report modes](../superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md#5-the-two-report-modes).

The prep-station rules walk a product's category ancestors, using the nearest claimed category after
ordered exceptions. See
[the approved design](../superpowers/specs/2026-09-30-catalogue-menus-routing-design.md).

## Categories are not sections

**Sections** arrange products for selling, independently of their reporting category and kitchen
route. Each section belongs to one menu. To share a set of products, include its menu in another
menu as a folder; you cannot attach another menu's individual section. Adding, moving or removing
products in a section does not change their category or prep-station rules
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
null. Null clears this menu's price so the combined menu can supply it; omitting it keeps the saved
value. The retired `active` and `offered` fields are refused with `management.request_invalid`
(400, `field: "active"` or `field: "offered"`), whatever their value. An item no longer reached by
this menu answers `menu_item.not_found` (404). Publish again to change what the till sells.

`PATCH /management-api/catalogues/:id/items/:itemId/variants/:variantId` sets or clears this
menu's price for one size of the item's product, Active or Disabled, and leaves every other size's
price as it is. The body is `{ price }`, a price or null; it returns 204. A missing `price`, or one
that is neither a string nor null, answers `management.request_invalid` (400, `field: "price"`),
and any other key in the body answers the same code naming that key. A malformed price answers
`product.variant_invalid` (400, `field: "price"`); a size that is not one of the product's,
`product.variant_not_found` (404); an item of another menu, or one this menu no longer reaches,
`menu_item.not_found` (404).

`GET /management-api/catalogues/:id/prices` gives one row per product reached by the working
structure, Active or Disabled, including sold-out products. An inactive menu gives no rows. Each row is
`{ menuItemId, productId, name, categoryId, placements, override, effectivePrice, combined, active, variants }`,
with `active` the product's own Active state.
`override` is this menu's saved price, which may be null. `combined` explains the resulting price,
including each variant's. Each setting is either decided, with its `value`, `source` and
`otherwise`, or a clash with its `candidates`. A source
identifies this menu's decision, the product, a parent, or an included menu and that menu's source.
The scalar `effectivePrice` does not explain a clash: read `combined.price` before showing a price
as decided.

A menu's own decision wins. Otherwise its own placements and its active included menus contribute
values; equal values agree, differing values or an unresolved included value clash. Sizes use
size-level price decisions first, then the combined product price when there are none. Their price
source records whether it was decided at the size or product level. For example, if Drinks sets beer
to €3.00 and Casa Delgado includes only Drinks' beer, Casa charges €3.00. If Casa also places that
beer in its own Specials at the product's €2.80, the two values clash. Setting Casa's own beer
price to €3.00 resolves it. `variants` keeps the menu's size prices as
`{ variantId, price, active }`, one per size, disabled ones included, with `price` null where this
menu sets none and `active` the size's own Active state; `combined.variants` explains each one's
result.

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
target outside the working structure, including the menu's own root. Disabled products are
structurally accepted, but publish as empty tiles. `menu_section.wrong_role` (409, `sectionId`,
`role`) refuses a layout as a target. `menu_section.not_found` names a missing section or member; a
product target must be a stored top-level product or it answers `menu_section.membership_invalid`
(400). A repeated target answers `menu_section.member_duplicate` (409), and invalid names and
positions answer `menu_section.invalid` (400, `field`).

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
device profile no device holds deletes its choices; a profile retired because only disabled devices
hold it keeps them. A venue's configuration export carries the choices, remapped on import to the
new menu and layout ids.

A till reads the structure and the layouts from each menu's live version, not from the working
state: both offers routes give each menu its `structure`, `homeLayouts` and `defaultHomeLayoutId`,
and they and `GET /api/menu-state` give each menu the signed-in session's device's `homeLayoutId` and a `layoutFallback`
(`resolveDeviceHomeLayouts`, `packages/catalogue/src/home-layouts.ts`). The profile's choice counts
while the live version holds that layout, so a layout deleted or renamed since the last publish
keeps showing, under its published name, until the menu is published again. Otherwise the till gets
the live default, with `layoutFallback` `layout_unpublished` when the menu still has the chosen
layout but has not published it, and `layout_removed` when it no longer has it; a device whose
profile has no choice for that menu gets the default and `null`. The till warns about `layout_removed` once for each removed layout of a menu while its page
stays loaded (a removal it cannot name, only if nothing has been said about that menu yet), and
switches silently otherwise (`apps/till/src/till-app.ts`).

## Moving and deleting

Use **Select**, tick products and categories, and choose **Move to…**. Pick a destination category or
**All products (top level)**. The destination list shows the categories as a tree after
**All products (top level)**, each category's children indented under it and each level sorted by
name the way the tables sort text (numbers by value, case ignored); a chosen destination, and each
match while searching, shows the full path ("Dinner › Mains"). A selected category and its
descendants are excluded as destinations, and the server also refuses such a move with `category.parent_cycle`. Anything
selected inside a selected category moves with that category rather than being filed beside it.

On a pointer device you can drag a product, a category, or in Select mode every selected row,
onto a category, onto a product (to file beside it) or onto **All products** (to file in no
category). The row stays in place, faded, while a copy follows the pointer; the target shows a bar
on its left edge and a dashed gap where the row will land in the current sort; a closed category
opens after `HOVER_OPEN_MS` (600 ms, `apps/dashboard/src/widgets/product-list.ts`) of hovering.
Esc, or a drop where the drag started, moves nothing. A mouse drags from anywhere on the row; a
finger drags only from the row's grip, so the rest of the row still scrolls. A keyboard does not
drag: keyboard users, and touch users who prefer it, use the same selection actions.

Searching or changing a filter clears the selection, so actions do not reach items you have hidden.
Opening or closing a category keeps it, so a selection can span categories; a selected row inside a
closed category is still selected. **Cancel** clears it and restores the ordinary toolbar, and so
does pressing **Select** again. A Delete you already
requested keeps its captured selection, including while the category summary is being read.

With only products selected, the toolbar's action reads **Disable**: it switches them off (the
product's `active` flag), and its dialog asks "Disable N products?". Their rows and previous sales
remain, and you can enable the products again later. Once a category is in the selection the action
reads **Delete**, because the category itself is deleted. Products you selected directly are still
only disabled. The products inside the category, its subcategories included, are disabled only if
you choose **Delete it too**; with **Move it up to the parent category** they stay active. Before deleting a non-empty category, choose
what happens to its contents:

- **Move it up to the parent category** keeps the products active and moves the category's direct
  products and subcategories to its parent. For a top-level category they move to **All products**.
  Only the routing rules naming a selected category itself are removed; its subcategories that are
  not selected keep theirs. The dialog's routing-rule warning counts only the removed ones.
- **Delete it too** removes the subtree and disables its products. The summary shows the
  numbers of subcategories, active products and routing rules removed (category claims and
  exceptions, in the whole subtree). A product that is already disabled is not counted. Every product in the subtree,
  disabled ones included, is moved to the parent of the outermost selected category that holds it.

An empty category is deleted without confirmation. A category's row-menu Delete uses the same path.
If the summary cannot be read, deletion waits for a successful new attempt rather than asking you
to approve unknown contents. The dialog lists each category being deleted by its full path, adding
"(2 of 3)" where several categories share a path. Pressing **Delete** in the dialog reads the counts
again; if the numbers of subcategories, active products or routing rules (in the subtree, or
naming the category itself) have changed, it deletes nothing, shows the new counts and asks you to
confirm again. The delete request carries the counts
the dashboard read before deleting, and the server compares them again inside the delete itself: if
they no longer match, nothing is deleted and the dialog shows the new counts with the refusal's own
message. If an empty category, which is deleted without confirmation, has gained subcategories,
active products or routing rules by then, the dialog opens with its new counts. A refused action
keeps its dialog open with a message at the bottom.
Deleting a category removes its station claim and every exception naming it, because both tables
have a cascading foreign key to `categories`. The dialog's routing-rule warning counts the rules the
chosen option removes; it does not list products whose station would change. **Move to…** also has no routing preview. Check
Prep Stations' tester after changing the category tree. A variant is routed by its product's
category, and a variant still storing a deleted category has it cleared.

## API

These routes require a management session with `person.manage`, the catalogue write permission
in `apps/server/src/catalogue-api.ts`. A category is `{ id, name, parentId, color }`, where `name`
is a trimmed plain string, `parentId` is an ID or null, and `color` is a lowercase `#rrggbb` or
null. A blank name is `category.invalid` (400); a non-string name is `management.request_invalid`
(400). A `color` that is neither a string nor null is `management.request_invalid` with
`field: "color"`, and a string that is not lowercase `#rrggbb`, an empty one included, is
`category.invalid` with `field: "color"`. A create without `color` stores none; an update without
it keeps the current one; `null` clears it. A configuration import refuses a bundle holding a
category colour that is neither null nor lowercase `#rrggbb`, as `setup.request_invalid` with
`field: "category_details.color"`.

| Route | Body or response |
| --- | --- |
| `GET /management-api/categories` | 200, category array |
| `POST /management-api/categories` | `{ name, parentId?, color? }`; 201, saved category |
| `GET /management-api/categories/:id` | 200, category |
| `PATCH /management-api/categories/:id` | supplied name, parent or colour fields; 200, saved category |
| `POST /management-api/folders/move` | `{ productIds, categoryIds, to }`; 204 |
| `POST /management-api/folders/delete` | `{ productIds, categoryIds, contents, shown }`; 204 |
| `GET /management-api/folders/summary?id=<id>&id=<id>` | 200, `{ id, folders, products, activeProducts, routes, ownRoutes }[]`; `products` includes disabled products, `activeProducts` leaves them out; `routes` counts the rules naming the category or any category below it, `ownRoutes` those naming the category itself |

Both ID arrays are required and contain distinct UUIDs. `to` is a category ID or null. `contents`
is `move_up` or `delete`. `shown` is the counts the client read before deleting (the ones its
dialog showed, when it asked): one `{ id, folders, activeProducts, routes, ownRoutes }` per selected category,
exactly, with whole numbers of zero or more. It is required when `categoryIds` is not empty and
ignored when it is. For example, once you have created Cocktails and your products, use their
returned IDs to move two products and a category together:

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
(404); a missing category is `category.not_found` (404); a category move into itself or its descendants
is `category.parent_cycle` (409). A category name that would match a sibling's is
`category.name_taken` (409, `{ field, name }`), from the category create and update routes, from
`folders/move`, and from `folders/delete` when `contents` is `move_up`. A `folders/delete` whose
`shown` counts differ from the server's own for any selected category is `category.contents_changed`
(409, `{ categoryId }`, the first such category), and deletes nothing. Malformed arrays or
repeated IDs are `management.request_invalid` (400), and a malformed UUID is `shared.invalid_id`
(400); a missing or malformed `shown` is `management.request_invalid` with `field: "shown"`.
Category-summary counts cover each complete subtree, except `ownRoutes`, which counts only the
routing rules naming the category itself. The browser counts the outermost selected categories when
ancestors and descendants are selected together, except that under **Move it up to the parent
category** its routing-rule warning sums `ownRoutes` over every selected category. Under **Delete it
too** the warning's sentence says the rules name these categories "or ones inside them", because its
count reaches subcategories the dialog does not list.

The former per-category delete, dependants and product-membership routes are retired. Use the
category selection operations above. The product editor still saves `primaryCategoryId`, which
must be `null` on a variant; a variant body naming a category, or any body
sending the removed `categoryIds` or `labelIds`, is refused with `product.invalid`.

## Storage and development reset

`categories` in core holds the name; `category_details` in catalogue holds the parent and, since
W92, the colour (`category_details.color`, added by catalogue `0025_category_color.sql`). The label
tables and the category image and colour columns of the old schema were dropped by the folder
migrations. Catalogue drops
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
