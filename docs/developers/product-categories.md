# Product categories

You can organize a product under several categories without counting its sales twice. One assigned
category may be marked primary. When one is set, its name becomes the reporting label on new order
lines, and its existing preparation route remains the category route used by the kitchen — see
below for what a product with no primary records instead. Other memberships and parent categories
do not add destinations or inherit routes. Product and service-zone route precedence still applies.

You manage categories at `/manage/categories`. Open a category to see its directly assigned
products. A child's products do not count towards its parent. Create and edit forms let you translate
the name, choose an image from the shared library, and choose or clear a parent. You cannot choose
the category itself or any of its descendants.

A primary category is optional in the data model and on the write path every current UI flow uses:
a product may hold memberships with no reporting category at all.
`dashboard-category-membership-picker`'s reporting-category select offers an explicit "None" option,
and the product editor's category picker can be left on its default "Choose…" placeholder; both
submit with `primaryCategoryId: null` through `replaceProductCategories`, whose only remaining check
is that a primary, if set, must be one of the currently selected categories. Removing the last
membership clears primary.

One older write path is the exception, and the API is not uniform because of it. Sending
`categoryId: null` in a product patch (`updateProduct`, the `PATCH` product route) still refuses with
`category.primary_required` when the product has more than one membership, and when it is allowed it
clears every membership along with the reporting category. That is the coupling the picker no longer
has. It stays because nothing first-party sends `categoryId` in a product patch any more.

Deleting a category is confirmed and then goes ahead. It is no longer refused when something refers
to it. The delete removes the product memberships, clears the reporting category from any product
using it, moves direct children up to the deleted category's own parent, drops its preparation
routes, and then removes the category. Because it cascades instead of refusing, a delete can take
more with it than the category itself, so the confirmation dialog fetches the dependants preview
(`GET .../dependants`) and lists what will go — each affected product, child category and kitchen
route as a link to it, with the ones clearing a reporting category called out separately — before
Delete is enabled. Previously recorded labels on past orders stay readable and are untouched.

Opening a category's name shows its directly assigned products in a modal: a filterable table with
each product's reporting category and other memberships as coloured lozenges, an Edit action that
reopens the full membership picker, and a Remove action that pre-fills the picker with this category
taken out (so clearing a reporting category is still a confirmed choice, not an immediate write). Its
"Add products" view is a separate checkbox table over products not yet in the category, backed by the
bulk-add route in one write.

## API and Products integration

All routes require a manager session belonging to the configured tenant. Reads return arrays
directly, following the existing catalogue client convention. Create returns status 201; update
returns the canonical saved object; delete returns an empty 204.

| Route | Input or response |
| --- | --- |
| `GET /management-api/categories` | `Category[]` |
| `POST /management-api/categories` | `{ name, image?, color?, parentId? }` → `Category` |
| `GET /management-api/categories/:id` | `Category` |
| `PATCH /management-api/categories/:id` | Any supplied fields from create → `Category` |
| `DELETE /management-api/categories/:id` | Cascades, then 204 |
| `GET /management-api/categories/:id/dependants` | What the delete would touch → `CategoryDependants` |
| `GET /management-api/categories/:id/products` | Direct products with descriptions, active state and full membership |
| `POST /management-api/categories/:id/products` | `{ productIds }` adds them all in one write → 204 |
| `GET /management-api/products` | All tenant products, including inactive products, each once |
| `GET /management-api/products/:id/categories` | `{ categoryIds, primaryCategoryId }` |
| `PUT /management-api/products/:id/categories` | Complete `{ categoryIds, primaryCategoryId? }` → saved membership |

`Category` is
`{ id, name: Record<string, string>, image: string | null, color: string | null, parentId: string | null }`.
A colour is lower-case `#rrggbb` or null; anything else is refused as `category.color_invalid` (400).

`CategoryDependants` is `{ products, children, parentId, routes }`, where `products` carries
`{ id, name, reporting }` per direct member (`reporting` marks the ones this category is the
reporting category for), `children` carries `{ id, name }` per direct child, and `routes` carries
`{ id, station, zone }` per preparation route. `routes` is always empty when the venue-service
module is not installed, since that is the module owning the table.

The bulk add assigns a whole selection to one category in a single write. A product that has no
reporting category yet takes this one; a product that already has one keeps it. Resubmitting a
product that is already a member is safe: it never fails and it does not add the membership twice.
It is not, however, entirely without effect — the reporting category is decided from what the
product currently has, not from whether the membership is new, so an existing member with no
reporting category is given this one. Only an existing member that already has a reporting category
comes out unchanged. An empty list is accepted and does nothing. The whole selection is checked before anything is written: an unknown,
foreign or repeated id rejects the entire request with `category.membership_invalid`, and nothing
is added.

Names require nonblank text in your default content language. Keep disabled translations in your
edit payload: the form preserves them, and changing enabled languages does not delete them.
Category names participate in the default-language translation-gap check.

For example, send the complete membership set when you add Breakfast to a Sandwiches product:

```json
{
  "categoryIds": [
    "22222222-2222-4222-8222-222222222222",
    "11111111-1111-4111-8111-111111111111"
  ],
  "primaryCategoryId": "11111111-1111-4111-8111-111111111111"
}
```

The response returns IDs in stable UUID order. That order has no routing meaning. Omit primary
when adding the first membership to select the first submitted ID, or when retaining an existing
primary that remains in the set. If you omit it and the previous primary is no longer in the set,
the product is left with no reporting category rather than the save being refused. Sending
`primaryCategoryId: null` alongside a non-empty set does the same thing explicitly. Duplicate IDs,
missing or foreign IDs, and primary IDs outside the set are rejected, as is a primary sent with an
empty set. The complete replacement runs in the caller's single transaction through
`replaceProductCategories`.

Products can compose `dashboard-category-form` from `apps/dashboard/src/widgets/category-form.ts`.
Pass `open`, `busy`, `locales` (default first), `value` (category or null), `fieldErrors`, `categories`
(for parent choices), and `api` (the image library request). The form emits `wt-submit` with
`{ value: CategoryInput }` and `wt-cancel` with `{}`. The host owns the API write, closes on success,
and selects the returned identity in its product draft. Field-error keys are `name-<language>`,
`parent`, `image`, or `save` for an error that does not belong to one field. Creating a category is a durable independent
write; cancelling the product afterwards leaves that category available.

`dashboard-category-membership-picker` receives `categories`, `locales`, `busy` and
`value: { categoryIds, primaryCategoryId }`. It emits the same submit/cancel contract. It renders
membership checkboxes and an explicit primary selector. Products integrates this real picker; the
Categories screen already uses it for category-side assignment and removal. The old combined
catalogue page remains until Products integration. Its single selector can add/select a primary;
it refuses to clear a product with multiple memberships, because it writes through the legacy
`updateProduct` path described above rather than through `replaceProductCategories`.

## Storage and migration

`categories.name` is the only stored category name and now holds JSON translations. Existing core
category IDs, station references and `products.category_id` remain. The latter means primary only;
category writes in product operations call the shared membership replacement operation.
`category_details` owns parent and image references, and `product_categories` owns membership.
Both new tables belong to catalogue, have tenant-consistent foreign keys and state classification.

Hierarchy edits, membership replacements and category deletion take the same transaction lock per
tenant. Deletion also locks the core category row against a concurrent preparation-route insert.
The media migration adds the image foreign key; attaching an image locks its row against deletion.
Configuration transfer places media rows before category image references and preserves membership
and primary choice. Category parent references target existing core identities, so metadata rows can
be restored in any order after those identities.

The generated migrations are core `0020_category_names`, catalogue `0004_category_memberships`
and `0005_category_grants`, and media `0003_category_images`. The core migration drops and recreates
the name column; it does not translate or backfill existing text. Follow the existing preproduction
reset workflow for a populated database. Do not apply it to a populated shared development database
as an incidental part of running tests. No shared development database was reset for this build.
