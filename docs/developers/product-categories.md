# Product categories and labels

A sales report has to add every sale up exactly once. If a product could sit in several reporting
categories, a report by category would either count its sales twice or have to pick one of them by
some rule nobody can see. So Waitron gives each product two separate ways to be classified:

- **One main reporting category**, in a strict tree. The category reports will add sales up by it;
  no report reads it yet.
- **Any number of labels**, which are flat tags such as "Alcoholic" or "Happy hour drinks". A label
  can cut across categories and overlap other labels.

The two are independent. A label never implies a category, and a category never implies a label.
The design is in
[the sales classification spec](../superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md)
§2.

You manage categories at `/manage/categories`.

## The reporting tree

A category has at most one parent, stored in `category_details.parent_id`. A category cannot become
its own ancestor: a save that would make one is refused with `category.parent_cycle`, however deep
the loop would be.

A product's main reporting category is `products.category_id`. It may name any category in the
tree, at any depth, and no other link between the product and the category is needed. When it is
null the product is **Uncategorised**. Uncategorised is not a category row, so nobody can rename,
move or delete it.

A variant's main category is its own when it has one, and its parent's otherwise. That is the same
fallback a variant uses for its other inherited fields (`effectiveProductColumns` in
`packages/catalogue/src/variant-fallback.ts`).

The main category is also what a new order line records as its category name, and the category
whose preparation route and station the kitchen uses. A category's parent is never consulted for
routing: for a product in "Cocktails" under "Drinks", a route set on Drinks does not apply.

## Labels

A label is a name, and nothing else. Names are staff-facing plain text and are not translated. Two
labels cannot share a name; the check is on the exact name after trimming the spaces around it, so
"Alcoholic" and "alcoholic" are two different labels.

A variant carries no labels of its own. It reads its parent's, and an attempt to give it some is
refused with `product.variant_invalid` naming the field `labelIds`.

## Categories are not sections

**Sections** are ordered lists of products and other sections that can be reused across menus and
nested (`sections` and `section_members`, written by `packages/catalogue/src/sections.ts`). The
menus plan's Task 3 builds each menu's structure from them; until it lands, menus keep their own
`menu_sections` headings. A section only arranges products. Adding a product
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

## Moving and deleting

Moving a category to a new parent, or a product to a new main category, is always allowed. Sale
lines already recorded keep the category name they were written with.

Deleting a category never strands a product or a subcategory, so the delete asks where they go:

- `productsTo` receives every product whose own main category is the deleted one, variants
  included.
- `childrenTo` becomes the parent of each of its direct subcategories.

Leave either out and it defaults to the deleted category's parent. For a top-level category that
default is none: its subcategories move to the top level, and each product that named it has its
main category cleared. The same happens when you send `productsTo: null`. A cleared top-level
product is Uncategorised. A cleared variant follows its parent's main category, as any variant with
none of its own does. The delete also drops the category's preparation routes.

A target that is the deleted category itself is refused with `category.reassign_invalid`, and so is
a `childrenTo` that sits anywhere below it, because the subcategories would then hang from one of
their own descendants. A target that does not exist is `category.not_found`. Every check runs
before anything is written, so a refused delete changes nothing.

## API

All routes require a manager session holding the catalogue write permission
(`CATALOGUE_WRITE_PERMISSION` in `apps/server/src/catalogue-api.ts`, `person.manage` today). A read
of a list (categories, labels, a category's products) returns the array directly, following the
existing catalogue client convention. Create returns status
201, update returns the saved object, and delete returns an empty 204. A body of the wrong shape is
refused with `management.request_invalid`, naming the field.

| Route | Input or response |
| --- | --- |
| `GET /management-api/categories` | `Category[]` |
| `POST /management-api/categories` | `{ name, image?, color?, parentId? }` → `Category` |
| `GET /management-api/categories/:id` | `Category` |
| `PATCH /management-api/categories/:id` | Any supplied fields from create → `Category` |
| `DELETE /management-api/categories/:id` | Optional `{ productsTo?, childrenTo? }` → 204 |
| `GET /management-api/categories/:id/dependants` | What the delete would touch → `CategoryDependants` |
| `GET /management-api/categories/:id/products` | Products whose main category is this one; add `?descendants=1` to include the categories below it |
| `POST /management-api/categories/:id/products` | `{ productIds }` makes this the main category of each → 204 |
| `PUT /management-api/products/:id/categories` | `{ primaryCategoryId }` (an id or null) → `{ primaryCategoryId }` |
| `GET /management-api/labels` | Labels ordered by name, each `{ id, name, productCount }` |
| `POST /management-api/labels` | `{ name }` → `Label` |
| `PATCH /management-api/labels/:id` | `{ name }` → `Label` |
| `DELETE /management-api/labels/:id` | Removes it from every product → 204 |
| `GET /management-api/products/:id/labels` | `{ labelIds }` |
| `PUT /management-api/products/:id/labels` | `{ labelIds }` replaces the product's labels → `{ labelIds }` |

`Category` is
`{ id, name: Record<string, string>, image: string | null, color: string | null, parentId: string | null }`.
A colour is lower-case `#rrggbb` or null; anything else is refused as `category.color_invalid` (400).
Category names require text in your default content language, and they take part in the
translation-gap check. Keep disabled translations in an edit payload: changing the enabled languages
does not delete them.

`Label` is `{ id, name }`. A blank name is refused with `label.invalid` (400), a name another label
already has with `label.name_taken` (409), and an unknown label id with `label.not_found` (404).

`CategoryDependants` is `{ products, children, parentId, routes }`. `products` lists `{ id, name }`
for every product, variants included, whose own main category is this one; `name` is the plain
staff-facing product name. `children` lists `{ id, name }` for each direct subcategory, where `name`
is a language map. `routes` lists `{ id, station, zone }` per preparation route, and is always empty
when the venue-service module, which owns that table, is not installed.

The category product list returns `{ id, name, active, primaryCategoryId, labelIds }` for each
product. It lists top-level products only: a variant appears under its parent in the product list,
never on its own.

For example, to move three products into Cocktails in one write:

```json
POST /management-api/categories/4a9d2c1e-6f3b-4c8a-9e21-7b5d0f3c8a12/products
{
  "productIds": [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333"
  ]
}
```

Each listed product leaves whatever main category it had. The whole selection is checked before
anything is written: an unknown, repeated or variant's id refuses the entire request with
`category.membership_invalid`, and nothing moves. An empty list is accepted and does nothing.

A variant's id answers as an unknown product (`product.not_found`, 404) on the product category and
label routes. The product editor is where a variant's own main category is set, and where its
parent's labels are shown, under `inherited.labelIds`.

The product editor body carries `primaryCategoryId` and `labelIds` in place of the old membership
list. A body that still sends `categoryIds` is refused with `product.invalid` rather than having the
list silently ignored, so a caller still on the old contract finds out at once.

## Storage and migration

`categories` (core) holds the translated name. `category_details` (catalogue) holds the parent, image
and colour. `labels` holds each label, with the unique index `labels_name_uq` on its name, and
`product_labels` joins products to labels; both cascade when a product or a label is deleted. All
the catalogue tables are classified `state` and travel in the configuration transfer, `labels`
before `product_labels`.

The product-to-category membership table, `product_categories`, is gone. It was created by
`packages/catalogue/drizzle/0000_baseline.sql` and is dropped by
`packages/catalogue/drizzle/0006_drop_product_categories.sql`. The labels tables are created by the
generation before it, `0005_labels.sql`; the two are kept apart so that no single migration both
creates and drops. A product's extra memberships are not carried anywhere, because there is no data
migration before Waitron is in production (`CLAUDE.md` §3). Its main category was already
`products.category_id` and is kept.

Hierarchy edits, main-category changes and category deletion take no lock. `withTransaction`
(`packages/db/src/tenancy.ts`) runs its body inside the venue file's write queue, which admits one
write transaction on the file at a time (`packages/store/src/write-queue.ts`), so two of these paths
cannot overlap however they are started. `packages/catalogue/src/categories.ts` states this above
`listCategories` and again inside `deleteCategory`. The receipt is `racePair` in
`packages/catalogue/test/fixtures.ts`, which carries the measurement and a control, used by the
three `serializes …` cases in `packages/catalogue/src/categories.db.test.ts`.

The media set protects `category_details.image` with four triggers named
`category_details_media_image_fk_*`, created in `packages/media/drizzle/0001_image_references.sql`,
whose header explains why a real foreign key could not be used. The refusal arrives as errcode 1811,
not 787, and `pragma foreign_key_list('category_details')` does not list the rule. Attaching an image
does not lock the image's row: `validateImage` reads it through `mediaImageExists`, which relies on
there being no concurrent writer and says so at the read. A section's image is guarded the same way,
by the four `sections_media_image_fk_*` triggers of
`packages/media/drizzle/0002_section_image_references.sql`.

Schema changes drop and recreate, with no translation and no backfill (`CLAUDE.md` §3). Follow the
existing preproduction reset workflow for a populated database, and do not reset a populated shared
development database as an incidental part of running tests.
