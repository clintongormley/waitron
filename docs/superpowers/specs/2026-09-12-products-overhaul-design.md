# Products overhaul: shared design and parallel build contract

Status: section implementation brief; confirmed decisions and remaining assumptions are separated below.
Requested by the owner on 2026-09-12. This change prepares specifications and worktrees; it does
not implement the features or authorize merging their branches.

You manage your product library through four separate navigation entries: Products, Categories,
Modifiers and Units. You can create the reusable objects while editing a product, without losing
your draft. Recipes are outside the supported product workflow for this version.

## Sections

| Section    | Specification                                         | Plan                                                           | Branch                |
| ---------- | ----------------------------------------------------- | -------------------------------------------------------------- | --------------------- |
| Units      | [Units](2026-09-12-product-units-design.md)           | [Build](../plans/2026-09-12-product-units.md)                  | `products-units`      |
| Modifiers  | [Modifiers](2026-09-12-product-modifiers-design.md)   | [Build](../plans/2026-09-12-product-modifiers.md)              | `products-modifiers`  |
| Categories | [Categories](2026-09-12-product-categories-design.md) | [Build](../plans/2026-09-12-product-categories.md)             | `products-categories` |
| Products   | [Products](2026-09-12-product-editor-design.md)       | [Build and integration](../plans/2026-09-12-product-editor.md) | `products-editor`     |

Read this shared contract and your section's spec and plan before implementation. These documents
describe the intended result. Existing behavior cited below was inspected, not exercised in this
planning session; each implementation starts with failing behavioral tests.

## Confirmed decisions and working assumptions

The owner confirmed extras, variants and no tax on 2026-09-12, and deferred multi-destination
category routing to the backlog. The category-versus-label model is being discussed; the working
proposal below keeps the original multiple categories and no separate labels. Any later answer
supersedes the proposal and must be copied into the affected specs before coding.

- Confirmed: extras have an optional total quantity cap, counting repeated extras as well as distinct ones.
  Blank means unlimited. Each extra defaults to a maximum of one and a preselected quantity of zero.
- Confirmed: a product with variants requires a variant selection. Its variant price replaces its base price;
  units, taxes, allergens, dietary declarations and modifiers are shared by all variants.
- Assumption: unit precision is an integer from zero through three in this version. Defaults are each (0),
  g (0), kg (3), mg (0), ml (0) and l (3). This is a proposed product limit, not a universal limit
  on measurement: existing order and sale quantities use scale 3.
- Proposal: categories have one optional parent. Deletion is refused while a category has children, product
  memberships or preparation routes. Products can have many categories, with one explicitly marked
  primary for the existing single reporting bucket. The first selected category becomes primary;
  you can change it. Keep existing single-category routing as an interim behavior; extra memberships
  and parentage do not introduce new destinations or inherited routing. Multiple-destination routing
  is explicitly deferred, not settled by choosing a reporting category.
- Assumption: options select exactly one choice, with an optional default. Yes/no selects one of two translated
  labels and defaults to No. Text is optional, limited to 500 characters, and has no price.
- Confirmed: “No tax” means no VAT/tax applies. It can appear as an applicable entry in the tax
  selector rather than a separate checkbox. It is an explicit choice, not missing configuration;
  use an existing tax treatment only if its meaning matches. The Products plan requires checking
  the actual backend mapping instead of assuming that no tax and every 0% treatment are identical.

## Existing seams and their consequences

These are source references at planning base `f1139e12`, not claims of runtime verification.

| Existing seam                                                                                                   | Source receipt                                                                         | Consequence for the build                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Products use `descriptions` as their translated name; categories have one string name and products one category | `packages/db/src/schema/catalogue.ts:53`, `:75`                                        | Introduce distinct product name and description fields; audit every old consumer.                                           |
| Quantity storage has three decimal places                                                                       | `packages/db/src/schema/orders.ts:171`, `packages/db/src/schema/sales.ts:220`          | Enforce precision before persistence; never rely on PostgreSQL rounding.                                                    |
| Menus own selling prices                                                                                        | `packages/catalogue/src/schema/menu.ts:86`                                             | Specify how product base and variant prices reach menu offers; editing a product must not silently reprice an offer.        |
| Modifier quantities and constraints are checked on the server, currently gated by `pricingUnit === "each"`      | `apps/server/src/working-order.ts:305`                                                 | Replace the gate deliberately; custom units must not bypass modifier validation.                                            |
| A category drives routing and one frozen reporting label                                                        | `packages/venue-service/src/operations.ts:1080`, `packages/db/src/schema/sales.ts:227` | Multiple membership must not duplicate sales or arbitrarily choose a kitchen.                                               |
| Content-language changes scan product/section/option names                                                      | `packages/catalogue/src/content-languages.ts:37`                                       | Add units, categories and variants to the gap checks; optional descriptions must not prevent changing the default language. |
| Media usage checks currently read products                                                                      | `packages/media/src/images.ts:131`, `:342`                                             | Category images must participate in usage counts, deletion prevention and transfer ordering.                                |
| VAT pricing uses a fixed class-to-rate resolver                                                                 | `packages/catalogue/src/pricing.ts:60`                                                 | Read selector percentages from the same authority as pricing; do not hardcode the example 23%.                              |

## Common behavior

Names require nonblank text in the venue's default content language. Other enabled content
languages are optional and fall back to that default through `resolveContentText`. Preserve stored
translations when a language is disabled; do not confuse content language with interface language
or receipt language. Extend the default-language gap checks in the same transaction/lock discipline
as the current implementation. Optional descriptions may be empty in every language.

Prices are nonnegative decimal strings in the venue currency, with the existing money scale and
rounding rules. “Available” controls whether a new sale can select the object. Changing it, a name,
a price, a unit or a default must not rewrite an existing order or receipt snapshot.

Use the design system's tables, row action menus, modal forms, required markers, field errors,
localized error summary, semantic field names, Enter submission and tokens. Reuse the existing
image library. All four screens need loading, empty, populated, failed-load and failed-save states,
keyboard operation and accessibility checks in both themes. Background refreshes use passive
queries and must not reset drafts. A successful save closes its editor even if the refresh fails.

Every new route checks the manager's returned tenant against the configured tenant, and every
read/write includes its own tenant predicate. One logical save uses one `withTenant` transaction.
Use tenant-consistent foreign keys and real PostgreSQL tests for grants and races.

## Contracts between the branches

The names below are the agreed public contracts for these builds. They may be represented by
browser-local types, following the existing client boundary; do not import database barrels into
the browser. IDs are UUID strings and `LocalizedText` means `Record<string, string>`.

| Contract                                                                                                                                 | Owner      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `Unit { id, name: LocalizedText, precision }`; product `unitId`; selected unit snapshot                                                  | Units      |
| `Category { id, name: LocalizedText, image: string \| null, parentId: string \| null }`; product `categoryIds` and `primaryCategoryId`   | Categories |
| Modifier discriminated union, ordered product `modifierIds`, selection payloads and snapshots                                            | Modifiers  |
| Product `name`, optional `description`, `kitchenName`, `unitPrice`, `available`, tax choice, variants, allergen and dietary declarations | Products   |

Use `/management-api/units`, `/management-api/categories` and
`/management-api/modifiers` for section list/create, `/:id` for read/update/delete where supported.
Responses return canonical saved objects. The list response follows the existing client's envelope
convention, which each branch must pin with request/response tests. Existing option-group endpoints
can remain while their consumers are moved, but do not ship a second modifier model or an
unrequested compatibility layer. Retire obsolete endpoints when all consumers move.

Each supporting branch provides a reusable `dashboard-unit-form`, `dashboard-category-form` or
`dashboard-modifier-form` in its own widget file. Shared properties: `open`, `busy`, `locales`,
`value` (existing object or null), and field errors. Forms emit `wt-submit` with `{ value: input }`
and `wt-cancel` with `{}`; the composing screen owns API calls and close-on-success. Stop the
triggering event before re-emitting; events bubble and are composed. Section forms receive their
section-specific lookup data as properties. Product creation uses the same forms and API methods,
then selects the returned object. Child saves are independent durable writes; cancelling the
product afterwards leaves those reusable objects in their libraries.

## Parallel work and ownership

All four branches start at the same documentation commit. They can implement independently, but
their shared schema and selling paths require integration. This is not four conflict-free patches.

- Units owns unit tables/assignment, precision checks and quantity display through the till.
- Categories owns category metadata, memberships, primary-category behavior and image references.
- Modifiers owns modifier authoring, selection validation, till selection and option snapshots.
- Products owns the replacement product form, product/variant fields, dietary/allergen picker
  changes, recipe withdrawal and final composition of all four sections.

Put new catalogue-owned tables in `packages/catalogue/src/schema/` and its migration set; register
them in classification, change sources, transfer ordering and provisioning. Existing core-owned
tables may need column changes in the core migration set. Do not add a reverse core-to-catalogue
dependency: for example, store unit assignment in a catalogue-owned table referencing both units
and core products, rather than a core foreign key to a later migration set. Do not relocate all
existing catalogue tables as an incidental refactor. No compatibility/backfill code is requested;
follow the preproduction schema/reset convention and never reset a shared live dev database casually.

Each branch adds only its own API methods, translations and navigation entry (`/manage/units`,
`/manage/modifiers`, `/manage/categories`, `/manage/products`). Keep edits to central barrels,
`dashboard-app.ts`, `api/client.ts`, live query registration and schema files small and additive.
Products removes the old combined catalogue/category/modifier UI after integrating the new screens;
other branches must not independently rewrite that file. Each branch adds its own translation-gap
checks. Preserve all of them when combining changes.

Products can use test doubles matching these contracts while other branches build. Production
stubs, placeholder navigation, skipped checks and claims of completed integration are not acceptable.
The Products branch must consume the real sibling forms, routes and operations before completion.

Suggested landing order: Units, Categories, Modifiers, Products. Do not merge without the owner's
landing instruction. After a prerequisite lands, update later branches when their shared code needs
it. Resolve generated migration collisions by regeneration against the new base, never by editing
snapshots/journals. Run real migration/grant assertions and the relevant immutability tests after
regeneration. No branch writes inside another feature worktree.

Parallel coding does not authorize simultaneous browser suites on this machine. Coordinate one
browser-testing turn at a time, check memory and existing test processes, and use separate package
report directories when coverage could overlap. Do not start four `wa-wt` demo stacks: it switches
one shared development target. Run it only when taking the coordinated manual-testing turn.

## Completion

Each section uses failing tests first and records the command and expected failure before the fix.
Preserve behavioral assertions through refactors. Run focused checks locally and use the normal
push hook and current-head CI for the required package coverage. Update the backlog and affected
operator docs when implementation makes them stale; add dated pointers to historical designs.

Section implementation ends by announcing readiness for `finish-branch`. Do not run finishing or
landing simply because this planning session created the worktrees. The combined acceptance journey
is in the Products plan and is a prerequisite for declaring the overhaul complete.
