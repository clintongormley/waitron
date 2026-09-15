# Modifier nutrition redesign — design

Status: draft for owner review
Owner decisions captured: 2026-09-15
Branch: `modifier-nutrition-rework`

## What this is

The dashboard "Modifiers" area lets staff describe an add-on or choice (an "extra
cheese", a "choose your bread") and attach allergen and dietary information to each
choice. This redesign simplifies that information and changes how it reaches the
waiter and kitchen screens, plus tidies the modifiers list screen to match the
categories screen.

A "modifier" is not its own table. It is one `option_groups` row (the group, e.g.
"Sauces") plus its `option_group_items` rows (the choices, e.g. "Ketchup",
"Mayonnaise"). The allergen and dietary information lives per choice, on each
`option_group_items` row. UI vocabulary ("modifier", "choice") renames the database
vocabulary ("option group", "option group item").

## The problem being fixed

Today a choice carries a tangle of nutritional fields:

- Four modifier types — `text`, `extras`, `options`, `yes-no` — where `yes-no` is
  redundant (it is an extra/option with a single entry).
- Two separate allergen lists per choice: allergens the choice **adds** and allergens
  it **removes** (`add_allergens`, `remove_allergens`), plus two more unused origin
  lists (`add_origins`, `remove_origins`).
- A dietary control labelled "No longer suitable for" that stores a **negative** claim
  (`dietary_effect = { invalidates: DietaryLabel[] }`) over six labels
  (`vegan, vegetarian, halal, kosher, no_meat, no_fish`).
- Live computation that **folds** a dish and its chosen extras into one "as-served"
  result: the waiter basket and the kitchen/expo screens recompute "vegan salad +
  bacon = no longer vegan" and "now contains milk". This is real set algebra, not
  display-only.

The owner wants each product and each extra to simply state **its own** allergens and
dietary suitability, shown independently — the diner reads the burger's allergens,
then reads the sauce's allergens — rather than the app computing a combined figure.

## Owner decisions (2026-09-15)

1. **Drop the `yes-no` modifier type.** Keep `text`, `extras`, `options`.
2. **Allergens become one "contains" list per choice.** Drop the separate "removes"
   list (and the unused origin add/remove lists). A choice states the allergens it
   contains; it can no longer strip an allergen from a base dish.
3. **Dietary preferences become a positive four-item list:** `vegan`, `vegetarian`,
   `halal`, `kosher`, meaning "this is suitable for these". Drop `no_meat`/`no_fish`
   from the manual set, and drop the free-from labels (Dairy-free / Gluten-free /
   Nut-free) because the allergen list already covers milk / gluten / nuts.
4. **Stop computing the union.** Remove the fold that combines a dish with its extras.
   Each product and each extra shows its own allergens and diet. The product keeps its
   existing recipe-based derivation as "its own list"; only the mixing-in of extras is
   removed.
5. **Section renames:** "Allergens and dietary effects" → "Nutritional information";
   "No longer suitable for" → "Dietary preferences".
6. **Icons:** show allergens and diets as compact icons, adopting Material Design Icons
   as bundled SVG path data — deferred to pass 2 (see sequencing).
7. **Dropped:** the "Calorie count" field (owner, 2026-09-15).
8. **Not renamed:** "Tree nuts". The allergen's code is already `nuts` and its label is
   already "Nuts" (ES "Frutos de cáscara"); nothing to change.

### Sequencing (owner: "Data + editor first")

- **Pass 1 (this spec's implementation):** the data model, the dashboard editor, and
  removing the combining. On the waiter/kitchen screens each item shows its own list as
  **text** (reusing today's pill styling).
- **Pass 2 (separate spec, later):** replace the text pills with Material Design icons
  and a compact layout across the dashboard, waiter basket, and kitchen/expo screens.

Pass 2 is out of scope here beyond leaving the door open for it.

## Non-goals

- No change to the product recipe-derivation system that computes a product's own diet
  and allergens (`deriveDietProfile`/`overlayDietProfile`, `republish`). It stays and
  keeps producing "the product's own list".
- No icons in pass 1.
- No calorie field.
- No backwards-compatibility or data migration. Waitron is pre-production, so schema
  changes drop and recreate (repo rule §3). The affected columns hold only development
  data.

## Design — pass 1

### A. Modifier type: remove `yes-no`

- **Union** `type: "text" | "extras" | "options"` — update the canonical type in
  `packages/shared/src/modifiers.ts` (`ModifierInput`, `Modifier`), the browser mirror
  in `apps/dashboard/src/api/client.ts`, and both `TYPES` tuples
  (`apps/dashboard/src/widgets/modifier-form.ts`, and the list filter in
  `apps/dashboard/src/screens/modifiers-screen.ts`).
- **Contract** `parseModifierInput` in `packages/catalogue/src/modifier-contract.ts`
  loses its `yes-no` arm; `isModifierOffered` in `packages/shared/src/modifiers.ts`
  (which only `yes-no` used to toggle a whole modifier off) is removed or reduced to
  the trivial always-offered case — trace its consumers before deleting.
- **Schema** `packages/db/src/schema/catalogue.ts`: remove `yes-no` from the `type`
  CHECK constraint and drop the `defaultValue` column (used only by `yes-no`).
  `defaultChoiceId` (used by `options`) stays.
- **Persistence/projection**: `packages/catalogue/src/modifiers.ts` (`groupValues`,
  the projection in `modifier-projection.ts`) drop the `yes-no` handling.

### B. Allergens: one "contains" list per choice

- **Schema**: keep `add_allergens` (this becomes "the choice's allergens"); drop
  `remove_allergens`, `add_origins`, `remove_origins` from `option_group_items`.
- **Types**: `ModifierEffects` in `packages/shared/src/modifiers.ts` and its browser
  mirror collapse to a single allergen list (plus the dietary list from section C). The
  `{ presence: "contains" }` wrapper that the picker adds today is simplified to a plain
  code list — decide during planning whether to keep the wrapper shape for forward
  room or flatten it; flatten unless a consumer needs the wrapper.
- **Contract**: `effects()` in `modifier-contract.ts` drops
  `validateRemoveAllergens`/`assertAllergenOverlayDisjoint` and keeps a single
  `validateAllergens` pass over the one list. Remove the now-dead validators in
  `packages/catalogue/src/allergens.ts` if nothing else uses them (grep first).
- **Editor UI**: `apps/dashboard/src/widgets/allergen-dietary-picker.ts` collapses from
  three comboboxes (add allergens / remove allergens / invalidates-dietary) to one
  allergen multi-select plus the dietary checklist (section C). The plain
  `allergen-picker.ts` already renders a single allergen list and may be reusable.

### C. Dietary preferences: positive four-item list per choice

- **Vocabulary**: the manual per-choice dietary set becomes `vegan`, `vegetarian`,
  `halal`, `kosher` with **positive** meaning ("suitable for"). This matches the
  existing derived-profile label set (`DIET_LABEL_FIELDS` in
  `packages/catalogue/src/dietary.ts`). Drop `no_meat`/`no_fish` from the manual
  declaration set (`DIETARY_LABELS` in `packages/catalogue/src/dietary-declarations.ts`)
  and the browser mirror (`DIETARY_LABELS` in `apps/dashboard/src/api/client.ts`).
- **Storage**: replace the `dietary_effect` column's shape from
  `{ invalidates: DietaryLabel[] }` (negative) with a positive list of the four labels
  the choice is suitable for. Name the stored field for what it now means (e.g.
  `dietarySuitability` / `suitableFor`) rather than reusing `invalidates`.
- **Contract**: `parseModifierInput`/`effects()` validate the positive list against the
  four allowed labels; the null-means-withhold-all rule and the vegan→vegetarian→
  no_meat/no_fish expansion in `dietary-declarations.ts` are no longer needed on the
  modifier path (they may still serve the product path — see D; trace before deleting).
- **Editor UI**: the checklist of four labels under the renamed "Dietary preferences"
  heading. `apps/dashboard/src/widgets/choice-form.ts` and `product-editor.ts` update
  their dietary rows; `editor.diet.*` strings in
  `apps/dashboard/src/i18n/strings.ts` lose `no_meat`/`no_fish`.

### D. Stop combining — each item shows its own

Remove the modifier-combining computation and its two consumers:

- **Shared combiners** on the modifier path: `applyDietaryEffects`
  (`dietary-declarations.ts`), `deriveAsServedAllergens` (`derivation.ts`), and
  `deriveAsServedDiet` (`dietary.ts`, the origin overlay). Keep the **product-level**
  functions these files also hold — `republish`, `deriveDietProfile`,
  `overlayDietProfile`, `expandDietaryDeclarations` where the product path still needs
  it. Trace each function's callers and remove only the modifier-fold ones.
- **Till client**: `apps/till/src/state/as-served.ts` — remove `asServedDiet`,
  `asServedDietaryDeclarations`, `asServedAllergens`, `selectedItems`'s fold. The basket
  line now shows the **product's own** diet/allergens (from the product's own profile)
  and lists **each selected extra's own** diet/allergens separately.
- **Server KDS/expo**: `apps/server/src/working-order.ts` — remove the effect-column
  reads and the `deriveAsServedAllergens`/`applyDietaryEffects` fold
  (around lines 3972–4017) and the `asServedByParent` projection. The station-queue and
  expo wire items carry the product's own profile plus each extra's own, not a combined
  figure.
- **Display (text, pass 1)**: `apps/till/src/widgets/basket.ts`,
  `apps/till/src/widgets/diet-badges.ts`, `apps/till/src/widgets/station-queue.ts`,
  `apps/till/src/screens/till-expo-screen.ts` render the product's own list and each
  extra's own list as text pills. Exact layout is a planning detail; keep colour never
  the only signal (text is the accessible name).

The as-served result is display-only today and is never written back to the database
(confirmed in the working-order projection comments), so removing it has no fiscal,
receipt, or stored-data impact — only what the waiter and kitchen screens show.

### E. Modifiers list screen — match categories

- **Row click → "products that use this modifier" modal.** Today the row opens a
  read-only details modal (`#openDetails` in
  `apps/dashboard/src/screens/modifiers-screen.ts`). Change it to open a products list
  like `apps/dashboard/src/screens/categories-screen.ts` (products modal at ~697–795).
  The data already exists: `modifierDependants` in
  `packages/catalogue/src/modifiers.ts` returns the products and menus that use a
  modifier, exposed at `GET /management-api/modifiers/:id/dependants`.
- **Delete → products table, styled like categories.** The modifiers delete flow
  already lists affected products (`#renderDependants`, backed by
  `getModifierDependants`). Restyle it to match the categories delete dialog
  (`categories-screen.ts` ~810–841). Behaviour is unchanged; this is presentation.

## What stays the same

- Product recipe-derivation of the product's own diet/allergens.
- Error codes: keep shipped codes; add new domain-concept codes only where the positive
  dietary validation needs one (repo rule: codes name the domain concept and are never
  renamed once shipped). Remove codes only if their sole trigger — the `yes-no` arm or
  the removes-allergen path — is gone and nothing references them.
- Allergen codes and labels (already "Nuts"). The drift guard
  `scripts/allergen-names-drift.test.ts` keeps the two label maps equal; no label change
  is planned, so this guard should stay green untouched.

## Migration

Pre-production, so drop-and-recreate (repo rule §3, "No backwards-compatibility"). The
drizzle migration is **generated**, never hand-edited; on any rebase number collision,
reset the migrations dir to main's state and regenerate, then verify by running the
grant assertions and the immutability checks. Changed columns: drop `defaultValue`,
`remove_allergens`, `add_origins`, `remove_origins`; reshape `dietary_effect`; adjust
the `type` CHECK.

## Testing impact

Behavioural assertions to preserve where still meaningful; rewrite setup/mocks, do not
rewrite a test to match the new code and lose the regression it caught (repo rule).

- **Contract**: `packages/catalogue/src/modifier-contract.test.ts` — the `yes-no` arm,
  the removes-allergen disjointness, and the negative-dietary cases go; add positive
  dietary validation cases and single-allergen-list cases.
- **Combining**: the as-served tests in `apps/till` and the working-order KDS/expo tests
  in `apps/server` — the combined-result assertions are removed; add per-item
  assertions (product's own, each extra's own).
- **Editor**: `modifier-form.test.ts`, `choice-form.test.ts`, `modifiers-screen.test.ts`
  — type list loses `yes-no`; the picker loses two comboboxes; the row-click opens the
  products modal; the section headings rename.
- **PG suites**: `modifiers.pg.test.ts`, `modifier-dependants.pg.test.ts`,
  `modifier-delete-cascade.pg.test.ts` — update column expectations.
- **Rendered pages**: open the modifiers screen and a modifier editor in the browser in
  both themes and at phone width — a page asserted only as a string or through its API
  has nothing checking it renders (repo rule §4).

Coverage: `catalogue` sits at the 98/98/98/95 bar; `apps/*` at the 90/90/85/85 floor.
Run focused behavioural tests while implementing; CI runs the mandatory package suites
and coverage.

## Risk triggers present

This touches a **cross-package contract** (the modifier type union and effects shape
across shared / catalogue / db / dashboard / till / server) and a **schema migration** —
both risk triggers, so the branch takes the full finish-branch review wave.

## Open questions for the owner

1. Storage field name for the positive dietary list (`suitableFor` vs `dietary` vs
   `dietarySuitability`) — a naming call, defaulting to `suitableFor`.
2. Pass 1 basket/KDS layout when an item has many allergens as text — acceptable to be
   verbose in pass 1 since icons compact it in pass 2? (Assumed yes.)
