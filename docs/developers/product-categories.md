# Product categories

You can organize a product under several categories without counting its sales twice. One assigned
category is primary. Its name becomes the reporting label on new order lines, and its existing
preparation route remains the category route used by the kitchen. Other memberships and parent
categories do not add destinations or inherit routes. Product and service-zone route precedence
still applies.

You manage categories at `/manage/categories`. Open a category to see its directly assigned
products. A child's products do not count towards its parent. Create and edit forms let you translate
the name, choose an image from the shared library, and choose or clear a parent. You cannot choose
the category itself or any of its descendants.

When you remove a product's primary membership and leave other memberships, choose its replacement
in the same save. Removing the last membership clears primary. Deleting a category requires a
confirmation and is refused while children, product memberships or preparation routes refer to it.
The refusal gives you a count for each kind of dependency. Previously recorded labels stay readable
and do not prevent deletion.

## API and Products integration

All routes require a manager session belonging to the configured tenant. Reads return arrays
directly, following the existing catalogue client convention. Create returns status 201; update
returns the canonical saved object; delete returns an empty 204.

| Route | Input or response |
| --- | --- |
| `GET /management-api/categories` | `Category[]` |
| `POST /management-api/categories` | `{ name, image?, parentId? }` → `Category` |
| `GET /management-api/categories/:id` | `Category` |
| `PATCH /management-api/categories/:id` | Any supplied fields from create → `Category` |
| `DELETE /management-api/categories/:id` | 409 `category.in_use` carries `children`, `products`, `routes` |
| `GET /management-api/categories/:id/products` | Direct products with descriptions, active state and full membership |
| `GET /management-api/products` | All tenant products, including inactive products, each once |
| `GET /management-api/products/:id/categories` | `{ categoryIds, primaryCategoryId }` |
| `PUT /management-api/products/:id/categories` | Complete `{ categoryIds, primaryCategoryId? }` → saved membership |

`Category` is `{ id, name: Record<string, string>, image: string | null, parentId: string | null }`.
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
primary that remains in the set. A removed primary with remaining memberships requires an explicit
replacement. Duplicate IDs, missing or foreign IDs, and primary IDs outside the set are rejected.
The complete replacement runs in the caller's single transaction through `replaceProductCategories`.

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
it refuses to clear a product with multiple memberships.

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
