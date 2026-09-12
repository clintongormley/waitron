# Products

Read the [shared design](2026-09-12-products-overhaul-design.md) first. This section owns the
product editor and the final integration of Units, Categories and Modifiers.

You build a product from a name, unit, price and tax choice, then add the detail it needs. You can
choose existing categories/modifiers/units or create them without leaving the product draft. The
list and editor are product-library screens; menus continue to decide which products are offered
and at what selling prices.

## Product list and editor

Products has its own navigation entry at `/manage/products`. Replace the old combined catalogue
screen with a searchable product table showing image/name, price per unit (or variant price range),
categories and availability. Filters include category and available/unavailable/all. No category
means uncategorized; products do not require a menu offer before you can manage them.

Create/Edit opens a modal, with related fields grouped into cards. Keep required fields visible;
optional sections can be collapsed. A product save is one transaction, including variants,
memberships and modifier attachments. It never makes a temporary product just to attach children.

| Field               | Behavior                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Name                | Required in the default content language, optional translations in enabled languages.      |
| Image               | Optional reference selected/uploaded through the shared media library.                     |
| Description         | Optional translated longer text; separate from the product name.                           |
| Kitchen name        | Optional single-language text; kitchen falls back to the product name when blank.          |
| Unit                | Required, defaults to the existing each unit; picker plus Add unit.                        |
| Price per unit      | Required nonnegative gross decimal amount; retains the existing currency/money rules.      |
| Available           | Defaults to true; false prevents new sale selection.                                       |
| Tax/VAT             | Configured tax choice or explicit None; labels include the effective percentage.           |
| Variants            | Ordered list, each with translated name, absolute price per unit and availability.         |
| Modifiers           | Ordered selection of zero or more reusable definitions; picker plus Add modifier.          |
| Categories          | Zero or more memberships, with one marked Primary if any; picker plus Add category.        |
| Allergens           | Selected-item picker, with contains/may contain and review status; no origin/source input. |
| Dietary suitability | Selected-item picker; no long grid of auto/yes/no or origin controls.                      |

Preserve existing product-specific station/course configuration in its appropriate advanced section
or existing Venue operations workflow. This request does not authorize losing routing, coursing,
images or menu publication. Product deletion is not requested; unavailable remains the removal
path for products with recorded sales.

Public product fields are `name: LocalizedText`, `description: LocalizedText | null`,
`kitchenName: string | null`, `unitId`, `unitPrice`, `available`, the explicit tax choice,
`variants`, `modifierIds`, `categoryIds`, `primaryCategoryId`, allergen declaration and dietary
declarations. The old `descriptions` field currently means name: audit every consumer, including
media names, reporting, seeds, recipes and receipt language validation, before changing that meaning.
Historical sale-line `descriptions` still carries the recorded sale label; do not repurpose it as
marketing description or rewrite old records.

## Nested creation and concurrent updates

Use the reusable forms delivered by the other branches. Suspend the parent Save and Enter action
while a child is open. Closing or cancelling a child restores focus to its Add control; successful
creation closes it, adds the returned object to the choices and selects it without reseeding other
fields. A child save is durable even if you later cancel the product. Explain that beside its save
action if the distinction is otherwise unclear.

A failed child write retains that child's draft. A successful child write followed by refresh
failure still returns the saved object and closes the child, with a load error outside the form.
Guard late responses by the product-editor generation so an old create/read cannot attach itself
to another product. Background query snapshots update lookup data, never overwrite a dirty product
draft. Duplicate submissions are blocked while a write is in flight.

## Variants and menu prices

A variant belongs to exactly one product and has a stable ID, translated name, `unitPrice`,
`available` and ordering. If a product has variants, adding it to an order requires one available
variant; do not silently use the base product. A variant's price replaces the base price, and extras
then add to it. All variants share the product unit, tax choice, modifiers, categories, image and
allergen/dietary declarations. No combinations of several variant axes in this version.

Example: Coffee has Small 2.00 and Large 3.00. Large with a +1.00 extra at quantity 2 totals 8.00.
Persist the variant identity and translated product/variant names on the order snapshot, show both
to the kitchen and customer, and retain them through park/resume, split, payment, correction and
reprint. Different variants cannot collapse into one basket line. Unavailable products or variants
cannot enter new orders, but existing locked lines remain payable from their recorded facts.

Product prices are defaults for authoring menu offers. Existing `menu_items.grossPrice` remains the
explicit selling price for a product without variants. For variants, each published menu offer
records its available variant IDs and an explicit selling price per variant, initially copied from
the product's variants. Menu editors can change those prices; the base offer price is not added to
them. Product price/availability edits do not silently overwrite menu price overrides. A newly
created variant requires publication on an existing offer before it can be sold there.

Offer availability and product/variant availability must all permit a new selection. An offer with
no available published variants is unavailable with a useful configuration explanation. Publishing
variants, prices and associated modifier selections is atomic. Extend menu editing and snapshots
in this branch, even though the user-facing entry is Products: otherwise the new variants would
exist only in administration.

Removing an unreferenced variant is allowed. If a live menu or actual retained order reference uses
it, show its dependencies and offer making it unavailable. Never cascade into order/sale records.

## Tax choice

Selector entries combine the translated tax label and percentage from the same resolver used to
price the sale, such as `Standard (23%)` only when the resolver actually returns 23. Show decimal
percentages without unnecessary trailing zeroes. Do not introduce editable tax rates, a country
rate catalogue or new rate values as part of this label change.

Owner decision, 2026-09-12: No tax means no VAT/tax applies. Offer it within the tax selector where
applicable, using an existing treatment if it has that meaning. This is not unset configuration.
Distinguish it from omitted input and an invalid ID; do not assume a configured 0% treatment is
semantically identical. Do not use JavaScript truthiness to choose a default or silently fall back
to the general rate.

Before implementing this part, record the tax classification carried into
pricing, stored sale facts, reporting and the enabled fiscal backend. The current four-class VAT
resolver alone does not establish a correct no-tax filing representation. For the no-tax choice,
reuse or extend tax treatment through the existing fiscal contract and verify its mapping with
the real record validator. Consult current primary sources for any external fiscal claims and
record their exact scope. Do not turn this into a guessed exemption reason or an automatic 0% alias.
This is part of Products implementation, not a reason to ask the owner the same meaning question again.

## Allergens, dietary suitability and recipes

The allergen section initially shows only selected allergens and an Add allergen control. Open a
searchable picker; already selected entries cannot be duplicated. Each selected entry retains
contains/may-contain choice and a Remove action. Remove origin/source inputs and stop creating
those fields in current product/modifier authoring payloads. Historical snapshots retain recorded
text. Trace all source consumers before removing live schema/type fields.

Keep an explicit reviewed state: unreviewed is not the same as reviewed with an empty selection.
Creating a product without reviewing allergens remains unreviewed; explicitly reviewing an empty
list means reviewed with none declared. Do not silently mark it reviewed merely because Save was
pressed. Existing contains/may-contain overlays for selected modifiers remain effective.

Dietary suitability uses a picker for Vegan, Vegetarian, Halal, Kosher, No meat and No fish,
presented as suitability labels rather than an ingredient-origin taxonomy. Selected labels are
positive declarations; absent labels are unknown, not positive or an explicit prohibition. Vegan
implies Vegetarian, No meat and No fish; Vegetarian implies No meat and No fish. Show derived badges
without persisting a second contradictory declaration. Halal and Kosher remain explicit declarations.
Do not infer any of these solely from an empty allergen list.

The product owns direct declarations for this supported recipe-free workflow. Modifier effects
must conservatively recompute the as-served declarations. Replace origin editing with direct
effects: a choice may declare which dietary labels it invalidates; any positive restoration needs
explicit evidence in configuration, never inference from removing a single ingredient. Preserve
the old behavioral tests for bacon invalidating vegan and uncertainty not becoming suitability;
add equivalents for the new direct representation. Unconfigured effects on a food-changing extra
make positive suitability unknown for that served item, rather than claiming it remains suitable.
Text and yes/no are neutral unless a configured choice effect says otherwise. Products and
Modifiers must agree these contracts before replacing their shared diet consumers.

Recipes and ingredient-origin authoring are removed from the supported product navigation and
product editor for now. Remove the recipe dashboard entry and prevent direct product-recipe
authoring routes from remaining a hidden supported path. Disable recipe-driven publication for
the new direct declaration workflow; demonstrate that stale recipe derivation cannot override a
saved direct declaration. Preserve recorded order/sale facts. A wholesale deletion of the recipes
package and purchasing is outside scope; retained dormant code is not permission to expose it as a
supported product feature. Add dated deferral pointers to recipe designs and update current docs.

## Acceptance

- Every requested field can be created, edited, cleared where optional and read back exactly.
- Default and optional translations, images and kitchen fallback reach the intended screens.
- You can create each supporting object inside a product without losing its draft or double saving.
- Product, variants and associations roll back together when one reference fails validation.
- Product/variant/menu price precedence is demonstrated with different prices, not equal fixtures.
- A real sale, kitchen ticket and receipt show variant, unit and modifier snapshots correctly.
- The allergen/dietary UI shows only selected items and pickers, with no origin/source fields.
- Unreviewed allergens and unknown dietary suitability retain their distinct meanings.
- Recipe navigation and direct authoring are unavailable; direct declarations control new products.
- Tax None/zero/configured/invalid behaviors follow the recorded decision and actual backend tests.
- Multiple categories do not duplicate menu rows, kitchen tickets or reporting totals.
