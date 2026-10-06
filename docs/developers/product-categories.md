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
Enter or leaving the box saves, and Esc or a blank name cancels. A colour square sits before each
category's name, an empty outline when it has no colour, and another inside the open box,
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
| `GET /management-api/sections/:id` | 200, the section, a menu root or a menu's Device Home Page section |
| `PATCH /management-api/sections/:id` | Supplied presentation fields from create; 200, the saved section |
| `DELETE /management-api/sections/:id` | 204; deletes the section and its owned descendants, and preserves Device Home Page shortcuts pointing at them as missing slots |
| `GET /management-api/sections/:id/members` | 200, the members in order |
| `POST /management-api/sections/:id/members` | `{ ref, position? }`; 201, the new member |
| `POST /management-api/sections/:id/members/products` | `{ productIds }`; 200, `{ added }`; skips products already held |
| `DELETE /management-api/sections/:id/members/:memberId` | 204 |
| `PUT /management-api/sections/:id/members/:memberId/position` | `{ to }`; 200, the members in their new order |
| `POST /management-api/sections/:id/members/:memberId/replace` | `{ ref }`; 200, the member, keeping its id and position |

The collection routes, usages routes and section duplication route have been removed. Create
nested sections with `/:id/sections`; add products or include a menu root with the member routes.
The generic readers give a partial view of a Device Home Page: they omit missing members, and the
structure graph's `children` gives none of its members. Read it through the Device Home Page routes
below.

Malformed ids answer `shared.invalid_id` (400); a malformed body answers
`management.request_invalid` (400), naming its field. `menu_section.not_found` (404) names an
unknown section (`sectionId`) or a member not held by that list (`sectionId`, `memberId`).
`menu_section.wrong_role` (409, `sectionId`, `role`) refuses presentation edits or deletes of roots
and Device Home Page sections, structure writes into a Device Home Page section, and a member ref to
anything other than a menu root.
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
structure and the Device Home Page as `home` (below); a shortcut whose target the document does not
hold keeps its place as a `{ kind: "empty" }` slot. Each such shortcut gives a warning
`{ kind: "shortcut_missing", name }`. Among the `changes`, a `home_shortcuts_changed` change says
the shortcuts differ from the live version's, and a `home_display_changed` change, naming its
`device`, that one device's display does. With no live version, the shortcuts count as changed when
there are any, and a display when it differs from the default.

`POST /management-api/catalogues/:id/publish`, with `{ expectedHash }`, gives
`{ versionId, number }` (200). It first refuses unresolved settings with
`menu.clashes_unresolved` (409, `menuId`, `count`), then refuses a changed working hash with
`menu.changed_since_preview` (409, `menuId`). An unchanged menu returns its existing live version
without writing another. Missing or non-string `expectedHash` answers `management.request_invalid`
(400). A malformed menu id answers `shared.invalid_id` (400), an unknown menu
`catalogue.not_found` (404).

Tills sell from live versions of active menus. Reading a live version outside document format 3 refuses
with `menu.reset_required`. Status reads check their requested menus; preview checks its own menu
and other menus when comparing shared changes; publishing checks its own menu; serving checks
the zone's assigned active menus. Reset the venue before using its
menus; republishing an old document is not an upgrade path (owner, 2026-10-06, A291).
Availability, course and reporting category are
applied from current rows when serving that version; its VAT class is frozen, and it holds no VAT
rate (`applyLiveFields`, `packages/catalogue/src/menu-document.ts`). Menu extras use product-level list attachments and settings, including their active filters;
there are no per-menu extras publications or overrides.

### Device Home Page routes

A menu has one Device Home Page: the shortcuts a handheld or a till shows under its search, beside
the menu's own structure, and how each of the two kinds of device lays them out. A menu never
inherits another menu's. A shortcut points at a product or a section and adds no product, price or
placement to the menu. The shortcut writer checks that the menu's working structure reaches the
target, including targets in included menus. Use the shortcut routes to write it: the generic
section writes refuse its section with `menu_section.wrong_role` (409).

`GET /management-api/catalogues/:id/home` gives `{ homeSectionId, shortcuts, handheld, till }`. A
shortcut is `{ memberId, position, ref, name, reachable, missingName }`. Its `ref` names a product, a
section, or a deleted target as `{ kind: "missing", name }`. `reachable` checks working membership;
`missingName` is null for a reachable target and otherwise records its name or section path.
Publishing keeps an empty slot for a target the document leaves out, so later shortcuts keep their
positions.

`handheld` and `till` are the two displays, each `{ columns, tiles, order }`. `columns` is a whole
number from 2 to 6 for a handheld and from 6 to 10 for a till. `tiles` is `colours` or `thumbnails`,
and `order` is `home_first` (the shortcuts, then the menu) or `menu_first`. A new menu starts with
3 columns on a handheld and 6 on a till, both `colours` and `home_first` (`HOME_DISPLAY_DEFAULTS`,
`packages/catalogue/src/device-home.ts`).

| Route | Body and success | Refusals |
| --- | --- | --- |
| `GET /management-api/catalogues/:id/home` | 200, the Device Home Page, shortcuts in order, missing ones included | `catalogue.not_found` |
| `PATCH /management-api/catalogues/:id/home-display` | `{ device, columns?, tiles?, order? }`, `device` being `handheld` or `till`; 204, changing only the fields given | `catalogue.not_found`, `management.request_invalid`, `menu.home_display_invalid` |
| `POST /management-api/catalogues/:id/home/shortcuts` | `{ ref, position? }`; 201, `{ id, position, ref }` | `catalogue.not_found`, `menu_section.not_found`, `menu_section.wrong_role`, `menu_section.membership_invalid`, `menu_section.member_duplicate`, `menu_section.invalid`, `menu.shortcut_unreachable` |
| `POST /management-api/catalogues/:id/home/shortcuts/:memberId/replace` | `{ ref }`; 200, the member, keeping its id and position | `catalogue.not_found`, `menu_section.not_found`, `menu_section.wrong_role`, `menu_section.membership_invalid`, `menu_section.member_duplicate`, `menu.shortcut_unreachable` |
| `DELETE /management-api/catalogues/:id/home/shortcuts/:memberId` | 204 | `catalogue.not_found`, `menu_section.not_found` |
| `PUT /management-api/catalogues/:id/home/shortcuts/:memberId/position` | `{ to }`; 200, the shortcuts as members `{ id, position, ref }` in their new order, missing slots included | `catalogue.not_found`, `menu_section.not_found`, `menu_section.invalid` |

Malformed ids answer `shared.invalid_id` (400) and malformed bodies `management.request_invalid`
(400); on the display route that includes a `device` other than `handheld` or `till`
(`field: "device"`). An unknown menu answers `catalogue.not_found` (404).
`menu.home_display_invalid` (400, `device`, `field`) refuses a value that device cannot take,
`field` being `columns`, `tiles` or `order`; with more than one wrong it names the first in that
order. `menu.shortcut_unreachable` (409, `ref`) refuses a target outside the working structure,
including the menu's own root. Disabled products are structurally accepted, but publish as empty
slots. `menu_section.wrong_role` (409, `sectionId`, `role`) refuses a Device Home Page section,
this menu's or another's, as a target. `menu_section.not_found` names a missing section, or a
member the menu's Device Home Page does not hold; a product target must be a stored top-level
product or it answers `menu_section.membership_invalid` (400). A repeated target answers
`menu_section.member_duplicate` (409), and a negative or fractional position answers
`menu_section.invalid` (400, `field`). The dashboard adds, removes and moves shortcuts from the
menu's Structure tab and edits the displays on its Home page tab; it does not call the replace
route.

No device profile chooses anything here. A device uses `handheld` when its profile's form factor is
a phone or a tablet (`kindOfFormFactor`, `apps/till/src/layout.ts`) and `till` otherwise.

**Storage.** The shortcuts are the members of the `home_layout` section that
`menu_details.default_home_layout_id` names (the column keeps its old name; the TypeScript property
is `homeSectionId`). The displays are six columns on `menu_details`: `handheld_columns`,
`handheld_tiles`, `handheld_order`, `till_columns`, `till_tiles` and `till_order`, each required and
with a default. None has a CHECK, because adding one makes drizzle rebuild the table, so the
database stores any value: `homeDisplayProblem` (`packages/catalogue/src/device-home.ts`) is the
whole of the range check. A save runs it, and so does a configuration import, which refuses a bad
value with `setup.request_invalid` (`field` such as `menu_details.till_columns`).

**What a till is served.** A till reads the Device Home Page from each menu's live version, not
from the working state. Both offers routes (`GET /api/default-service-zone/offers` and
`GET /api/service-zones/:zoneId/offers`) give each menu its `structure` and its `home`, the live
document's `{ shortcuts, handheld, till }`, where a shortcut is `{ kind: "product", productId }`,
`{ kind: "section", sectionId }` or `{ kind: "empty" }`. `GET /api/menu-state` gives each menu
`{ menuId, versionId }` beside `unavailable`. The served `home` is the live document's, the same
whichever device asks; the till picks the display its form factor names. A shortcut or display changed since the last publish
reaches no device until the menu is published again (the case "a draft shortcut or display change
reaches no device until the menu is published" in `apps/server/src/till-api.sell-published.test.ts`).

## Moving and deleting

Use **Select**, tick products and categories, and choose **Move to…** in the action bar below Search.
The bar shows how many you selected. Pick a destination category or
**All products (top level)**. The destination list shows the categories as a tree after
**All products (top level)**, each category's children indented under it and each level sorted by
name the way the tables sort text (numbers by value, case ignored); a chosen destination, and each
match while searching, shows the full path ("Dinner › Mains"). A selected category and its
descendants are excluded as destinations, and the server also refuses such a move with `category.parent_cycle`. Anything
selected inside a selected category moves with that category rather than being filed beside it.

On a pointer device you can also drag rows, but only in **Select**, which shows each row's
grip; outside it nothing can be dragged. Drag a product or a category (dragging a selected row
carries every selected row with it) onto a category, onto a product (to file beside it) or onto **All products** (to file in no
category). The row stays in place, faded, while a copy follows the pointer; the target shows a bar
on its left edge and a dashed gap where the row will land in the current sort; a closed category
opens after `HOVER_OPEN_MS` (600 ms, `apps/dashboard/src/widgets/product-list.ts`) of hovering.
Esc, or a drop where the drag started, moves nothing. A mouse drags from anywhere on the row; a
finger drags only from the row's grip, so the rest of the row still scrolls. A keyboard does not
drag: keyboard users, and touch users who prefer it, use the same selection actions.

Searching or changing a filter clears the selection, so actions do not reach items you have hidden.
Opening or closing a category keeps it, so a selection can span categories; a selected row inside a
closed category is still selected. **Done** clears it, hides the grips and restores the ordinary
toolbar and returns focus to **Select**, and so does pressing **Select** again. It reads Done rather than Cancel because a
drag made in the mode is saved as soon as it is dropped. A Delete you already
requested keeps its captured selection, including while the category summary is being read.

With only products selected, the toolbar's action reads **Disable**: it switches them off (the
product's `active` flag), and its dialog asks "Disable N products?". Their rows and previous sales
remain, and you can enable the products again later, each from its row menu's **Enable**. When
every selected product is disabled already, the toolbar offers no **Disable**; a selection that
mixes active and disabled products still offers it, and the disabled ones stay disabled. Once a category is in the selection the action
reads **Delete**, because the category itself is deleted. Products you selected directly are still
only disabled. The products inside the category, its subcategories included, are disabled only if
you choose the dialog's "Also: …" answer; with the other answer they stay active.
Before deleting a category that holds active products or subcategories, the compact dialog asks
"What happens to what is inside?". Each answer names what it does, counting only active products
and leaving out anything that is zero. The place named is the shared parent's path, **No
category** for the top level, or "each category's parent" when the outermost selected categories
sit under different parents.

- "1 category and 3 products move to Drinks" keeps the products active and moves the category's
  direct products and subcategories to its parent. The counts include what sits inside those
  subcategories, which moves with them. Its subcategories that are not selected keep
  their routing rules.
- "Also: deletes 1 category and 2 kitchen routing rules and disables 3 products. They move to
  Drinks." removes the subtree and disables its products. The rules it lists are the category
  claims and exceptions naming a subcategory that is not itself selected. Every product in the subtree,
  disabled ones included, is moved to the parent of the outermost selected category that holds it.

When there are any, a paragraph below the question counts the routing rules naming a selected
category itself, which go whichever answer is chosen.

A category is deleted without confirmation only when it holds no products (disabled ones
included), no subcategories and no routing rules. When no selected category holds active products
or subcategories, the confirmation asks nothing about contents, because any disabled products
inside move up whichever answer is chosen; it says nothing about those products, and says how many
routing rules go with the categories, if any. A category's row-menu Delete uses the same path.
If the summary cannot be read, deletion waits for a successful new attempt rather than asking you
to approve unknown contents. The dialog lists each category being deleted by its full path, adding
"(2 of 3)" where several categories share a path. Pressing **Delete** in the dialog reads the counts
again; if the numbers of subcategories, active products or routing rules (in the subtree, or
naming the category itself) have changed, it deletes nothing, shows the new counts and asks you to
confirm again. A change in disabled products alone never stops that check, whether or not the dialog
asked about contents: the dialog neither counts those products nor asks about them. The delete
request carries the counts
the dashboard read before deleting, the number of all products, disabled ones included, among them,
and the server compares them again inside the delete itself: if
they no longer match, nothing is deleted and the dialog shows the new counts with the refusal's own
message. If a category with nothing in it at all, which is deleted without confirmation, has
gained subcategories, products (disabled ones included) or routing rules by then, the server
refuses and the dialog opens with that message, showing the new counts of subcategories, active
products and routing rules; when all it gained is disabled products, it shows the message but no
counts of contents, asks nothing about contents, and its **Delete** moves them up.
A refused action
keeps its dialog open with a message at the bottom.
Deleting a category removes its station claim and every exception naming it, because both tables
have a cascading foreign key to `categories`. The dialog counts the routing rules each answer
removes; it does not list products whose station would change. **Move to…** also has no routing preview. Check
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
is `move_up` or `delete`. `shown` is the counts the client read before deleting: one `{ id, folders, products, activeProducts, routes, ownRoutes }` per selected category,
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
ancestors and descendants are selected together, except that the routing-rule paragraph sums
`ownRoutes` over every selected category. The rules the "Also: …" answer lists are the outermost
categories' `routes` less that sum.

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
