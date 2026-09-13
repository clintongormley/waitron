# Build Products and integrate the overhaul

Branch: `products-editor`. Read the [spec](../specs/2026-09-12-product-editor-design.md),
[shared contract](../specs/2026-09-12-products-overhaul-design.md) and the three supporting specs.
Implementation is in progress. The independent model, editor widget and supporting tests are in
this worktree; the replacement screen and selling paths are not connected yet. Completing the build
needs real sibling implementations, not only test doubles. See the
[execution checkpoint](2026-09-13-product-editor-checkpoint.md) before continuing.

## 1. Trace field meanings and write failing tests

Read data, UI, design-system, testing and workflow conventions. Trace `descriptions`, `active`,
`vatClass`, `manualAllergens`, `recipeDerivation`, `dietDerivation`, `dietOverride`, `source`,
`addOrigins` and `removeOrigins` across all repository paths, including prose. Separate current
product data from historical order/sale snapshots before changing any meaning.

Start at `apps/dashboard/src/widgets/product-form.ts`, `product-list.ts`, `allergen-picker.ts`,
`screens/catalogue-screen.ts`, catalogue operations/pricing, media image names,
`apps/server/src/working-order.ts` and the menu editor in `packages/venue-service/src/dashboard/`.
Inspect existing recipe registration/routes before choosing the withdrawal points.

Write failing tests for independent name/description, kitchen-name fallback, variants, canonical
product round-trip, compact picker behavior and retained nested drafts. Fixtures must use different
product, variant and menu prices so precedence mistakes are visible. Record the expected failure.

## 2. Product model and operations

Implement distinct product content fields and stable product-variant records. Put new domain tables
in catalogue; alter core-owned fields only when required and generate migrations in the owning set.
Avoid a core-to-catalogue foreign key. Add grants, classification/change sources, provisioning,
configuration transfer and variant-name language-gap validation. Optional descriptions do not
become a required language-gap entry. Update media names and other live name consumers.

Implement transaction-taking product save operations and server request validation. Unit/category/
modifier references follow the shared contract; use section-owned operations for each association.
Until those branches are integrated, use typed test doubles at the test seam and keep dependent
production work explicitly incomplete. Do not create competing production implementations.

Test unavailable products/variants, invalid references, cross-tenant manager and IDs, duplicate
variants, price limits and rollback of a partially valid aggregate. Use real PostgreSQL for actual
role privileges and dependent delete races.

## 3. Build the list, editor and nested flows

Add Products navigation and the replacement screen. Implement the form cards and fields with the
shared design-system contract. Begin nested-flow tests with contract-faithful form doubles, then
replace them with actual Units/Modifiers/Categories forms as the branches become available.

Test a dirty parent through child open, failed child write, successful child write, cancelled child,
failed refresh and cancelled product. Test late child responses after switching product, duplicate
submission, parent Enter while a child is open, focus return and passive refresh. All required
fields must participate in the localized error summary. Cover empty/filtered lists and accessibility
in both themes. Preserve station/course access rather than dropping those controls incidentally.

## 4. Replace pickers and withdraw recipe authoring

Write failing browser tests that selected allergens/diets are the only displayed rows, the picker
adds/removes entries and no origin/source input remains. Keep explicit review-state behavior.
Write server tests that live create/update no longer needs or authors origin/source data, including
modifier overlays, and that saved historical snapshots remain unchanged.

Introduce direct dietary declarations and shared as-served effects in coordination with Modifiers.
Keep old behavioral assertions while changing fixtures/representation; test uncertain extra effects,
bacon invalidating vegan, inferred labels and independent halal/kosher declarations. Trace all till
diet filters and allergen displays to ensure the new authoring reaches their real data paths.

Remove the recipe navigation entry, block its direct authoring route and stop recipe derivation
from controlling the supported product declaration writes. Test direct navigation/API access and
a product carrying stale derivation data. Do not delete purchasing or historical snapshots. Update
current docs and add dated pointers to historical recipe/dietary designs.

## 5. Variants, menus and selling

Add publication/price records for menu variants and update menu authoring. Test independent variant
prices/availability per menu, explicit publication of newly added variants, and preserved overrides
after product-price edits. Update menu snapshots and till variant selection.

Thread chosen variant identity/name/price through the actual request parser and shared server order
resolver. Store presentation facts for kitchen, receipts and reprints. Preserve the shared decimal
arithmetic. Run real route tests for walk-up, held orders, table rounds, quantity changes, splits,
payment and corrections where line snapshots are copied. Assert distinct variants cannot collapse
into one line. Edit live names/prices after parking and assert resumed totals and printed facts.

## 6. Tax labels and No tax

Tax labels can be built now from the existing authoritative resolver. Test with different rates,
including a fractional rate in a controlled fixture, and assert the percentage shown equals the
percentage used by pricing. Do not infer the venue's rate from the example 23%.

The owner confirmed that No tax means no VAT/tax, and may be an applicable selector entry. Trace the tax
choice through `packages/catalogue/src/pricing.ts`, order locks, reporting, `packages/fiscal` and
the enabled backend. Write failing tests for explicit None, zero rate, missing input and invalid
choice. Reuse an existing treatment only if it matches that meaning, and run the real backend record validation; do not settle
for testing that a dropdown contains the word None. Any external tax-rule claim needs a current
primary-source receipt with its wording and scope.

## 7. Integrate all four sections

Use the shared landing order: Units, Categories, Modifiers, Products, with owner-authorized landings.
Independent implementation does not require waiting for those landings, but final Products checks
must run against their combined real code. Do not merge sibling feature branches casually into a
PR whose base lacks them. Once prerequisites land, rebase/update this branch and consume their
canonical APIs/forms. If the owner wants combined verification before landing, use a disposable
integration checkout; keep candidate branch histories separate.

Preserve every sibling's additions to central client types, shell navigation, language-gap scans,
live query registration and migration configuration. Resolve generated migration collisions by
regeneration against the new base and run actual migrations/grant assertions/immutability tests.
Remove the old combined category/modifier management blocks and obsolete APIs only after auditing
all consumers. Product-related recipe withdrawal belongs here. Do not leave duplicate UI paths.

Run this combined journey using actual routes and a real browser, with a database fixture:

1. Configure two content languages. Create a custom precision-2 unit from a dirty product draft.
2. Create a translated parent/child category, select an image, assign the product to two categories
   and choose its Reporting Category. Verify image-only category references prevent library deletion.
3. Create and attach text, extras, options and yes/no modifiers from the product form. Set repeated
   extra limits, a total cap, defaults and an unavailable choice. The original draft must survive.
4. Add translated name/description, kitchen name, image, tax choice, two differently priced variants,
   allergens and dietary suitability through pickers. Save once and reopen; assert the entire model.
5. Publish on a menu with deliberately different variant/extra prices. Sell a chosen variant and
   assert quantity, extras, tax, kitchen label and receipt. Reject excessive precision/caps and
   unpublished/unavailable choices through crafted server requests as well as UI.
6. Park an order, edit live names/prices/units/defaults, resume and pay. Reprint and compare the saved
   facts; reporting and kitchen still count one product despite multiple categories.
7. Visit all four navigation destinations directly, Back/Forward and refresh. Check theme/accessibility,
   validation, failed-save and successful-save/failed-refresh states. Verify recipes are not authorable.

Coordinate one browser-testing turn at a time and one shared `wa-wt` target; do not reset another
session's development data. Use real-PG fixtures for isolation, migration and race tests.

## 8. Finish the branch work

Run focused suites for all changed behavior and consumers, plus affected root guards. CI supplies
required current-head package coverage after the normal push hook. Do not run a whole-workspace
suite just for finishing, and do not claim completion based on mocks or missing selected packages.

Update the backlog, operator guide and dated design pointers. Record commands/results for the
combined journey and any pending manual observations. Announce readiness for `finish-branch` only
when the real integration and the approved tax behavior are complete. Finishing/landing still
requires the owner's corresponding instruction.
