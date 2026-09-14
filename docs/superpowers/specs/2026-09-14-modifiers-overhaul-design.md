# Modifiers overhaul — design

Status: draft for review
Date: 2026-09-14
Branch: modifiers-overhaul

## What this changes and why

The modifiers management screen predates the categories screen and does not follow its patterns. The
owner wants the modifiers screen brought onto the categories design, the modifier and choice editing
forms simplified, and the choice editor's allergen/dietary controls replaced with the same kind of
multi-select the rest of the dashboard uses.

The concrete requests, verbatim from the owner:

- The "Add modifier" action moves to the header, on the right, as a labelled button — not a round `+`.
- A full-width search bar with table filters.
- The table's sort and filter default to the last used, stored in session storage; first-ever visit
  sorts alphabetically by Name.
- Clicking a modifier's name opens a modal showing its details, with Edit and Close buttons.
- When adding options (choices), use the multi-choice combobox for allergens and dietary preferences.
- Remove the "contains" vs "may contain" selector.
- For allergens and dietary preferences, remove the "reviewed" toggle; show this information only if
  any options are selected.
- Remove the modifier-level Available toggle; keep the one at the option level (and the yes/no level).
- Deleting a modifier copies the pattern used for Categories.
- Follow the design used for categories.

The screen is `apps/dashboard/src/screens/modifiers-screen.ts`; the categories screen it should
resemble is `apps/dashboard/src/screens/categories-screen.ts`.

## Decisions taken during the brainstorm

These were settled with the owner before writing this spec. Where a decision changed a premise from
the conversation, that is called out so the reviewer can veto it.

1. **Availability after the modifier-level toggle goes.** Extras and options carry availability only
   per choice. A yes/no modifier keeps a single Available switch (its "option level"). A text
   modifier has no switch — to stop offering it, detach it from the product. This matches the owner's
   answer: "Yes/no keeps a toggle; text has none."

2. **Dietary "reviewed" removed; empty means no effect.** Dropping the switch changes what the till
   claims. Today an *unreviewed* choice (a `null` dietary effect), once selected, makes the till
   withhold every dietary claim for the dish ("we don't know"). After this change a choice with no
   dietary labels selected means "no effect" and leaves the dish's claims untouched. The owner chose
   this ("Empty means no effect"). The "unknown/withhold" state for modifier choices goes away.

3. **Contains vs may-contain: modifiers now, everything else later.** A choice that adds an allergen
   always adds it as `contains`. Removing the distinction from products, ingredients, derivation and
   the till's allergen screen is a **separate** project with its own spec. The owner's steer: build a
   shared allergen/dietary widget here that products can adopt later ("we can reuse the same
   allergy/dietary module for products too, but those can be updated later"). This spec builds the
   widget and uses it in the modifier choice form only.

4. **Delete cascades products and menus; refuses on open orders.** The delete dialog copies the
   categories pattern: a dependants preview, a red warning, Delete disabled until the preview loads.
   Confirming detaches the modifier from products and menus and deletes it. If any open working order
   uses it, the dialog says so and Delete stays disabled, because a draft order line still points at
   the choice.

5. **The menu foreign key is changed to cascade.** Deleting a modifier already cascades cleanly from
   products (`product_option_groups.group_fk` is `ON DELETE CASCADE`), but the menu link
   `menu_item_option_groups.group_fk` is `ON DELETE RESTRICT` — a deliberate safety choice
   (`packages/catalogue/src/schema/menu.ts`). The owner chose to flip it to cascade so the database
   detaches published menus automatically, accepting that a delete now silently removes the modifier
   from any published menu that used it. See the migration section for the second RESTRICT this
   interacts with.

## Change from the brainstorm to flag at review

**The dietary-effect column stays nullable — no column migration for it.** The brainstorm said the
`option_group_items.dietary_effect` column would become `NOT NULL DEFAULT '{"invalidates":[]}'`. On
reflection that migration would fail on any existing row holding `null` (the exact
"migrations fail on rows already in the shared dev database" trap in the project CLAUDE.md §6), for
almost no benefit: the products' *ingredient-derived* dietary path in
`packages/catalogue/src/dietary-declarations.ts` keeps producing and consuming `null`, so the
null-handling branch there does not go away regardless.

Instead: keep the column nullable, and make the **contract** normalise a modifier choice's dietary
effect so `null`, absent, and empty all read and write back as `{ invalidates: [] }` ("no effect").
The read path (`listModifiers`) coerces a stored `null` to `{ invalidates: [] }`, and the till's
`as-served.ts` modifier branch stops mapping a choice's `null` to "withhold". Net user-facing result
is identical to decision 2; the storage layer just isn't forced through a risky migration. Reviewer:
say if you would rather pay for the `NOT NULL` migration.

## Architecture

The work divides into four layers, from the shared contract outward. Each is a task boundary.

### Layer 1 — the shared contract (`packages/shared`, `packages/catalogue`)

The stored/read `Modifier` type keeps `available` on **every** variant, because the till reads
`modifier.available` in four places (`apps/till/src/widgets/product-grid.ts`, `modifier-picker.ts`
two reads, `tender-pay.ts`) and both projections in `packages/catalogue/src/modifier-projection.ts`
filter on it. Only the **authoring** input stops accepting it for the three types that no longer show
the switch.

Precise shape:

- `Modifier` (read/stored) is unchanged structurally: `available: boolean` present on all variants.
  For text/extras/options it is always `true`; for yes/no it is the authored value.
- `ModifierInput` (authoring) — the contract's `keys()` allowlist drops `available` from the base key
  set and permits it **only** for the yes/no branch. For text/extras/options, a client that sends an
  `available` key is rejected with `modifier.invalid` (same mechanism that rejects any stray key
  today), and the contract sets `available: true` internally. The TypeScript type may keep
  `available` structurally on the output so `Modifier = ModifierInput & { id }` need not fork; the
  gate is the runtime `keys()` allowlist, not the type.

`parseModifierInput` (`packages/catalogue/src/modifier-contract.ts`):

- `baseKeys` becomes `["type", "name"]`.
- yes/no: allowed keys `[...baseKeys, "available", "defaultValue"]`; `available` defaults to `true`
  when absent (unchanged default), read from input.
- text: allowed keys `baseKeys`; `available` set to `true`.
- extras / options: allowed keys unchanged except `available` is no longer among them;
  `available` set to `true`.

`groupValues` in `packages/catalogue/src/modifiers.ts` already computes `active` from
`input.available`; it now receives `true` for the three types and the authored value for yes/no, so
it needs no change beyond reading the (always-present) `input.available`.

**Choice effects — the write shape the widget emits and the contract accepts:**

- A choice's added allergens arrive from the form as a plain list of codes. The dashboard adapter
  turns each into `{ [code]: { presence: "contains" } }` before it reaches the contract. This is the
  single line the follow-up allergen spec will delete; mark it with a comment pointing at that spec.
  `validateAllergens` and the stored `AllergenMap` shape are untouched here.
- `removeAllergens` stays a list of codes, as today.
- `dietaryEffect`: the contract accepts absent, `null`, or `{ invalidates: string[] }` and normalises
  to `{ invalidates: [...] }` (empty list allowed). It never returns `null` for a modifier choice.

`validateModifierSelections` reads `definition.available` on the stored `Modifier` (always present) —
no change. Its per-type "required selection" logic is unchanged.

A small helper keeps the "is this modifier offered at all" test in one place instead of four bare
`modifier.available` reads: `isModifierOffered(modifier)` = `modifier.type !== "yes-no" ||
modifier.available`. This is a refactor of existing reads, not new behaviour; the till projections and
`validateModifierSelections` call it. Since non-yes/no availability is always `true`, behaviour is
identical — the helper documents intent and gives the follow-up work one seam.

### Layer 2 — server delete and dependants (`packages/catalogue`, `apps/server`)

**Migration (catalogue set): flip the menu FK(s) to cascade.**

- `menu_item_option_groups.group_fk` (references `option_groups`) → `ON DELETE CASCADE`.
- The cascade then interacts with `menu_item_options.option_fk` (references `option_group_items`,
  currently `ON DELETE RESTRICT`). Because PostgreSQL checks `RESTRICT` immediately rather than
  deferring it, whether the `menu_item_options` rows are removed (via their cascade from
  `menu_item_option_groups`) before the `option_group_items` deletion checks that RESTRICT is **not
  reasoned about here — it is decided by running it**. The migration task must, in a real-PostgreSQL
  test, delete a modifier that a menu publishes with priced options and confirm the delete succeeds;
  if it fails on `menu_item_options_option_fk`, flip that FK to `ON DELETE CASCADE` too. A negative
  control (the same delete against the un-flipped FK) must be shown to fail, so the test proves the
  flip is what fixed it (project CLAUDE.md §1: a measurement where both answers look alike measures
  nothing).
- The migration is generated with drizzle (`generate`), never hand-edited, and verified by running
  the grant/immutability assertions per project CLAUDE.md §3.

**`deleteModifier` (`packages/catalogue/src/modifiers.ts`):** today it calls `assertUnused` with
`retainedOrders: true`, which throws `modifier.in_use` for a product, menu, order, or choice
dependency. It changes to:

- Refuse with `modifier.in_use` **only** for the `order` dependency (params
  `{ modifierId, dependency: "order" }`). The `order` probe is the existing SQL over
  `working_order_lines` (both the `modifier_snapshots @>` match and the `option_group_item_id in
  (...)` match).
- Otherwise delete the `option_groups` row and let the (now cascading) product and menu FKs detach it.

The `updateModifier` type-change guard (`assertUnused(..., false)`, which does not consider orders)
is unchanged.

**Dependants read.** A new function `modifierDependants(tx, tenantId, id)` mirrors
`categoryDependants` (`packages/catalogue/src/categories.ts`): 404 a foreign/absent id via
`getModifier`, then return

```
interface ModifierDependants {
  products: { id: string; name: Record<string, string> }[];
  menus: { id: string; name: Record<string, string> }[];
  orders: number;
}
```

- `products`: library products attached via `product_option_groups`, resolved to
  `{ id, descriptions }` and returned as `{ id, name }`.
- `menus`: menu items publishing the modifier via `menu_item_option_groups`, resolved to their names.
  (Confirm the menu-item name column and table during implementation; `packages/catalogue/src/schema/menu.ts`.)
- `orders`: the count of open working orders whose lines reference the modifier or any of its choices
  — the same predicate `assertUnused`'s `order` branch uses, as `count(*)` rather than `limit 1`.

**Route (`apps/server/src/catalogue-api.ts`):** `GET /management-api/modifiers/:id/dependants`
returning `{ dependants: ModifierDependants }`, tenant-scoped exactly as the categories dependants
route at `catalogue-api.ts:747`, including the manager authorization and the tenant comparison the
project CLAUDE.md §3 requires for a configuration route.

### Layer 3 — the shared allergen/dietary widget (`apps/dashboard/src/widgets`)

A new `dashboard-allergen-dietary-picker` (a `wt-*`-styled Lit element, tokens only). It replaces the
`<details>` "effects" block and the `#dietaryEffect()` block in
`apps/dashboard/src/widgets/choice-form.ts`.

- Input property: `{ addAllergens: string[]; removeAllergens: string[]; dietary: DietaryLabel[] }`.
- Three `wt-combobox` fields with `multiple`:
  - *Adds allergens* — options are the 14 EU codes (`ALLERGEN_CODES`), labels via `allergenName`.
  - *Removes allergens from dish* — same options.
  - *No longer suitable for* — options are `DIETARY_LABELS`, labels via `editor.diet.*`.
- No presence dropdown, no "reviewed" switch, no free-text source field (source is not authored in the
  modifier choice form today either).
- Client-side disjointness: a code chosen under "adds" is removed from "removes" and vice versa,
  matching `assertAllergenOverlayDisjoint`, which still enforces it server-side.
- Emits `wt-change` with the same `{ addAllergens, removeAllergens, dietary }` shape;
  `bubbles: true, composed: true`, and the originating combobox event is stopped before re-emitting
  (project CLAUDE.md UI conventions).
- The widget is written so a product editor can adopt it later; it knows nothing about modifiers.

`choice-form.ts` maps this to `ChoiceDraft`: `addAllergens` list → (adapter, layer 1)
`{ code: { presence: "contains" } }`; `removeAllergens` unchanged; `dietary` → `{ invalidates:
dietary }` (empty list when none). The choice form no longer renders presence selects or the reviewed
switch.

`modifier-form.ts`: the modifier-level Available switch renders **only** for yes/no. The choices
table, drag-reorder, per-choice available switch, preselect/default controls, and the `#save` builder
are unchanged except that `common` includes `available` only for yes/no (the server defaults the rest
to `true`).

### Layer 4 — the modifiers screen (`apps/dashboard/src/screens/modifiers-screen.ts`)

Rebuilt on the categories screen's structure.

- **Header:** `<h1>` on the left, a primary **Add modifier** text button on the right
  (`data-test="create-modifier"`), replacing the round `+` icon button.
- **One `wt-data-table`** with `searchable` (full-width search bar), `viewKey`
  `"waitron.modifiers.table"` (session-storage memory of sort + filters), `sortKey="name"`
  `sortDirection="ascending"` (alphabetical on first visit). The table already provides the filter
  dropdowns and the session-storage persistence — no new persistence code.
- **Columns:**
  - *Name* — a ghost `wt-button` opening the details modal; `searchValue` and `sortValue` on the
    translated name. Styled via `part=`/`::part()` if any cell chrome is needed, never a CSS class
    (project CLAUDE.md UI convention; the categories screen documents why).
  - *Type* — `t("modifiers.<type>")`, with a `filter` dropdown over the four types.
  - *Choices* — the choice count for extras/options; blank for text/yes-no.
  - *Actions* — a `wt-row-actions` menu with Edit and Delete.
  - The old *Available* column is removed.
- **Details modal** (`wt-modal`, `data-test="details-modal"`): opened by the name button. Shows the
  name in each enabled content language, the type, and per type: text → the help line; yes/no →
  default value and availability; extras → required, total-quantity cap, and a read-only table of
  choices; options → default choice and the read-only choices table (no price/tax columns). The
  choice table shows name, and for extras price and tax; then available, preselected/default, and the
  allergen/dietary summary — allergen-added, allergen-removed and dietary-withdrawn shown **only when
  non-empty** (owner: "show this info only if any options are selected"). Footer: **Edit** (closes the
  details modal, opens the editor form) and **Close**.
- **Delete dialog** (`wt-modal`, copying categories): heading "Delete `<name>`"; a spinner until the
  dependants read resolves; then a red warning naming the counts, with the affected products and menus
  as lists; Delete disabled until the preview loads. When `orders > 0`, Delete stays disabled and an
  explanatory line says an open order uses it. A failed dependants read shows its own error state
  rather than an empty preview (categories rule: silence reads as "nothing to lose"). Generation-
  guarded against a reopened dialog exactly as `#loadDependants` is in categories.
- **Deep link** `?modifier=<id>` opens the editor and then clears the param, mirroring the categories
  `?category=<id>` behaviour. (Cheap symmetry; reviewer may drop it.)
- Content-language handling, passive query controller usage, and the create/edit/save/reload flow copy
  the categories and current-modifiers-screen patterns (a successful write closes the editor, then a
  separate reload; a failed reload is a load failure, not a failed save — project CLAUDE.md UI rule).

## Data flow

Create/edit: form → `ModifierInput` (available only on yes/no) → contract normalises effects → catalogue
writes `option_groups` (`active` from availability) and `option_group_items` (allergens as `contains`,
`dietary_effect` never null) → reload.

Read for the screen: `listModifiers` → each `Modifier` carries `available` (true for non-yes/no) and
normalised `dietaryEffect`.

Delete: screen opens dialog → `GET .../dependants` → preview → confirm → `DELETE .../modifiers/:id` →
refuses on open orders, else deletes and cascades product/menu links.

Till: unchanged. Projections filter on `available` (now always true for non-yes/no, so a no-op there);
the till's four `modifier.available` reads see the same shape.

## Error handling

- `modifier.in_use` keeps its shipped name and `{ modifierId, dependency }` params (never renamed —
  project CLAUDE.md §3). Only `dependency: "order"` is thrown by delete now. The screen's message map
  keeps `modifiers.in_use.order`; `modifiers.in_use.product` / `.menu` are no longer reached by
  delete (they remain reachable from the type-change guard in `updateModifier`, which still calls
  `assertUnused`), so they stay.
- The delete-confirm string and the "in use" strings change from "make it unavailable" to
  "detach it" / "remove it from the menu" wording for the types that no longer have a modifier-level
  switch. New strings for the details modal and the dependants preview go in both `en` and `es`
  blocks of `apps/dashboard/src/i18n/strings.ts`.
- A failed dependants read has its own dialog state, distinct from "loaded, nothing depends".

## Testing

TDD throughout — a failing test first for each behaviour, watched fail, then the minimal code.

**Contract (`packages/catalogue/src/modifier-contract.test.ts`):**
- `available` rejected as an input key for text/extras/options; accepted for yes/no; the parsed output
  has `available: true` for the three types.
- `dietaryEffect` absent / `null` / `{ invalidates: [] }` / `{ invalidates: [...] }` all normalise to a
  non-null `{ invalidates }`.
- `isModifierOffered` over each type.

**Catalogue (`packages/catalogue/src/modifiers.pg.test.ts` / new `modifier-dependants.pg.test.ts`):**
- `modifierDependants`: tenant-scoped; products via `product_option_groups`, menus via
  `menu_item_option_groups`, `orders` count over open working orders; a foreign id 404s.
- Delete cascades product and menu links (real Postgres: create modifier, attach to a product and
  publish to a menu with a priced option, delete, assert the link rows are gone and the group is
  gone). This is the test that also decides the second FK flip, with a negative control against the
  un-flipped FK.
- Delete refused with `modifier.in_use` (`dependency: "order"`) when an open working order references
  the modifier or one of its choices.

**Server (`apps/server/src/catalogue-api.test.ts` and/or a pg test):**
- `GET /management-api/modifiers/:id/dependants` returns the wire shape, is manager-authorized, and
  compares the session tenant with the configured one (project CLAUDE.md §3 route rule).

**Widget (`dashboard-allergen-dietary-picker`):**
- A token-painting test and an `*.a11y.test.ts` covering each state in both themes (project CLAUDE.md
  "a new `wt-*` primitive needs two specific tests"). Note: it is a dashboard widget, not a
  `packages/ui` primitive, so the `no-hardcoded-chrome` guard does not scan it — the token rule still
  applies and the reviewer checks it.
- Adds/removes disjointness; `wt-change` payload shape; empty selections emit empty lists.

**Choice form / modifier form:**
- Choice form writes an added allergen as `{ presence: "contains" }` and never emits a `null` dietary
  effect; no presence select and no reviewed switch are rendered.
- Modifier form renders the Available switch only for yes/no.

**Screen (browser tests, `modifiers-screen.test.ts` + `.a11y.test.ts`):**
- Header Add-modifier button with an accessible name.
- Table remembers sort and filter across a remount via session storage; first mount sorts by Name
  ascending.
- Name button opens the details modal; Edit hands off to the editor; Close dismisses.
- Delete dialog states: loading spinner, loaded-with-dependants (products + menus listed), orders
  block (Delete disabled + explanatory line), loaded-empty (Delete enabled), read-failed (error
  state). Deletion failure stays in the dialog; success closes and reloads.
- The existing screen tests that still apply (passive reload not replacing an open draft; enabled
  content-translation display; structured server field errors) are preserved, updated for the new
  layout rather than rewritten to match the code (project CLAUDE.md: preserve behavioural assertions).

**Look at it.** Both the details modal and the rebuilt screen are opened in light and dark themes at
phone width before the branch is called done (project CLAUDE.md §4 — a string/API assertion does not
prove a page renders). Browser-mode packages have the harness.

## Review weight

Risk triggers present: a cross-package contract change and a migration (the menu FK flip). This is the
**full** ceremony — per-task reviews plus the finish-branch wave with the simplify lenses, the
fresh-context plan-vs-spec read, and the Codex run-it seat.

## Out of scope (explicitly deferred)

- Removing contains/may-contain and the free-text source from products, ingredients, derivation and
  the till allergen screen — a separate spec, building on the shared widget this spec introduces.
- Any change to the till, product editor, or menu-publishing UI beyond what the contract shape forces
  (which is nothing — the till shape is preserved).
- The `option_group_items.dietary_effect` `NOT NULL` migration (see "Change from the brainstorm").
