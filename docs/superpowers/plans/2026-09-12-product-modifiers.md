# Build Modifiers

Branch: `products-modifiers`. Read the [spec](../specs/2026-09-12-product-modifiers-design.md) and
[shared contract](../specs/2026-09-12-products-overhaul-design.md). Implementation is not started.

## 1. Preserve the current behavioral contract

Read data, UI and testing conventions and the existing ordering-modifier, modifier-allergen and
dietary designs. Trace `optionGroups`, `optionGroupItems`, `productOptionGroups`, `SelectedOption`,
`minSelect`, `maxSelect`, `maxQuantity`, `addOrigins` and `removeOrigins` across the whole repository.
Inspect menu publication in `packages/catalogue/src/schema/menu.ts` and server selection validation
in `apps/server/src/working-order.ts`. Keep anti-overcharge, menu isolation, allergen and stored
snapshot tests. Document the deliberate replacement of the current skip-empty-required-group rule.

Write failing tests for the discriminated union, default validity, unlimited total cap and all four
selection payloads before implementation. Include repeated extras with an invalid negative entry,
explicit false and a required available modifier with no usable choices.

## 2. Definitions, validation and routes

Evolve the current group/item storage and add section-owned operations. Prefer a small
`modifiers.ts` rather than extending every branch's changes through one giant operations file.
Generate affected core/catalogue migrations with their package scripts; add required grants,
classification, transfer and language-gap support. Do not rename shipped error codes; add domain
codes for new failures and test their localized messages.

Save a definition, its choices, defaults and availability in one transaction. Validate type-specific
fields and tenant ownership. Serialize deletion/type changes with attachment/publication writes;
exercise those races on real PostgreSQL. Add routes at `/management-api/modifiers` with request/
response tests, including manager-tenant mismatch, unavailable choice/default handling and rollback
when one choice fails. Update existing API consumers before retiring old endpoints.

## 3. Management screen and form

Create `modifiers-screen.ts` and `modifier-form.ts`, browser-local API methods, translations and
passive live dependencies. Add only the Modifiers shell entry. Leave removal of the old combined
manager to Products integration. The form supplies the shared event contract for nested creation.

Use tests first for switching type on an unused definition, add/remove/reorder choices, price and
quantity validation, translated labels, default controls, availability and failed saves. Cover focus,
keyboard behavior and axe in both themes. Do not create a new generic primitive unless existing
ones cannot express the required controls; any new primitive needs token and accessibility tests.

## 4. Till selection, pricing and snapshots

Build the four input modes in `apps/till/src/widgets/modifier-picker.ts`. Extend its browser-local
wire types, order request parsing, shared server order resolver and menu projections. Separate
selection validation from Units' quantity validator, replacing the current each-only gate without
losing either branch's checks. Unit defaults are not modifier defaults.

Store nonprice selections as structured snapshots; extend working context and completed sale
presentation so receipt/reprint and kitchen read saved facts. Keep extras on the existing decimal
pricer and preserve option VAT override/inheritance in menu configurations. Test each path through
actual route serialization, not only a pure picker or a fake pricer. Cover walk-up, table rounds,
park/resume, quantity editing, split/correction where snapshots are copied, receipt and kitchen.

Coordinate dietary effect types with Products; initially keep current effects working, then consume
its source-free pickers. Do not ship a temporary origin-based editor as the completed overhaul.

## 5. Verify and hand off

Run focused definition/pricing tests, PostgreSQL grants/races, actual server order tests and till/
dashboard browser tests. Coordinate browser execution with other sessions. Run changed-area root
guards, including live subscriptions and schema classification/graph/journal checks. CI owns required
package-wide coverage after the normal push hook.

Supply canonical types, form properties, API examples and migration changes to Products. Update
operator docs and add dated pointers to superseded behavior in historical modifier designs. Record
test commands/results and announce readiness for `finish-branch`. Do not merge autonomously.
