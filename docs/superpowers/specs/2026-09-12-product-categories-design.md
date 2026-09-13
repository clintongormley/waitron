# Categories

Read the [shared design](2026-09-12-products-overhaul-design.md) first.

You can place a product in several categories, such as Breakfast and Sandwiches, and organize
categories under parents such as Food. Categories describe your library. Menu sections still
describe where products appear on a particular menu.

## Your workflow

Categories has its own navigation entry and a searchable hierarchy/table showing image, resolved
name, parent and directly assigned product count. Create/Edit opens a modal with translated name,
optional image from the shared library and an optional parent picker. The name is required in the
default content language. The parent can be changed or cleared after creation.

The parent picker excludes the category itself and all descendants. It shows paths so identically
named categories under different parents are distinguishable. Server checks repeat this rule and
reject cross-tenant parents. No arbitrary depth limit is introduced; render long paths accessibly.

Opening a category shows its directly assigned products, with search and add/remove membership.
The same membership is visible and editable from Products. Adding one membership never removes
another. A product may have none. Child category membership does not automatically add the product
to the parent; counts and filters make direct membership explicit.

One category is marked Primary on a product when it has any categories. This preserves the existing
single reporting label and category-based kitchen route without counting a sale twice. The first
membership becomes primary. You may explicitly change primary to another assigned category.
Removing primary while other memberships remain requires choosing its replacement in the same
save; removing the last membership clears primary. Category-side removal uses the same rule.

The category editor opened from Products uses the same reusable form; the product draft remains
intact and receives the created category. Product membership editing is outside this nested form
to avoid trying to attach an unsaved product.

Deletion requires confirmation and is refused while children, memberships or preparation routes
refer to the category. Show those dependencies and let you resolve them first. Delete does not
silently remove products, reparent children or discard routing rules. A historical copied category
label does not prevent deletion and remains readable afterwards.

## Model and behavior

Public category shape: `Category { id, name: LocalizedText, image: string | null, parentId: string | null }`.
Products expose `categoryIds: string[]` and `primaryCategoryId: string | null`. Read order is stable;
membership order has no routing significance. Write the complete membership set and primary choice
atomically. Reject duplicates, missing IDs, a primary outside the set and cross-tenant references.
Expose a dedicated product-membership operation so both screens use the same implementation.

Keep existing core category identity and routing references. Catalogue-owned metadata can hold
translated names, image and parent, and catalogue owns a new product membership table. The existing
core `products.categoryId` may remain the internal primary-category column; give it one meaning and
one write path, not two independently mutable sources of truth. New catalogue tables reference
existing core identities in migration order. Do not add a reverse dependency to core.

Serialize hierarchy updates per tenant so simultaneous “A under B” and “B under A” cannot both
commit. Test with two real PostgreSQL connections. Membership/delete operations must similarly
avoid dangling associations and primary-category mismatches. Enforce tenant predicates on reads
as well as writes, including lookup paths inside parent traversal.

Resolve the primary category for reporting. Preserve the existing single-category routing path
and product/zone-specific precedence as interim behavior, including the current category reference;
additional memberships and parentage do not create extra tickets. The owner deferred the design of
routing one product/category to multiple destinations, potentially using its other categories, to
the backlog on 2026-09-12. A reporting primary must not become a permanent routing restriction.
Never rebuild historical labels from live translations.
Browsing all categories must not duplicate products in unfiltered lists, menu offers or sale totals.

Category images reuse media filenames/references, upload/pick/remove behavior and translated alt
text. Extend media usage lists/counts, deletion protection, locking and configuration transfer so
an image used only by a category is still “in use”. Removing a category image only removes that
reference, not the library image. Include category names in content-language gap validation.

## Acceptance

- You can translate, image, create, edit, reparent and delete an unused category.
- Direct and deep cycles, including a simultaneous opposing reparent, are rejected.
- A product appears in multiple category lists and once in an unfiltered product list.
- Both membership editors agree; primary replacement and final removal are atomic.
- Additional membership never doubles reporting or sends another kitchen ticket.
- Parent changes do not implicitly change product membership or kitchen routing.
- Referenced categories cannot be deleted, including dependencies not visible on the current page.
- An image used only by a category cannot be deleted; unreferencing it releases that dependency.
- Default-language changes include category names and preserve disabled translations.
- Another tenant's manager/IDs cannot read or alter hierarchy, images or membership.
