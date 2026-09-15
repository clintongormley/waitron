# Modifier nutrition redesign — pass 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each modifier choice its own simple allergen and dietary information, stop the app combining a dish with its chosen extras, and tidy the modifiers list screen — leaving Material Design icons for a later pass.

**Architecture:** A "modifier" is one `option_groups` row plus its `option_group_items` choices; allergen/diet data lives per choice. We remove the `yes-no` type, collapse allergens to one "contains" list, replace the negative dietary control (`dietary_effect = { invalidates }`) with a positive four-label list (`suitableFor`), and delete the dish+extras "as-served" fold on the waiter basket and kitchen/expo screens so each item shows its own list as text. The product's own recipe-based diet/allergen derivation is untouched.

**Tech Stack:** TypeScript, pnpm monorepo, Drizzle ORM (PostgreSQL), Lit web components, Vitest (PGlite + Testcontainers, browser-mode for dashboard/till).

**Spec:** `docs/superpowers/specs/2026-09-15-modifier-nutrition-redesign-design.md` — read it before starting. This plan implements pass 1 only (the spec's pass 2, the icon display, is out of scope here).

## Global Constraints

- **Pre-production: no backwards-compatibility or data-migration code.** Schema changes drop and recreate; the affected columns hold only development data (repo CLAUDE.md §3).
- **Drizzle migrations are generated, never hand-edited.** On a number collision after rebase, reset the migrations dir to main's state and regenerate. Verify by running the grant assertions and the `inmutabilidad` checks (repo CLAUDE.md §3).
- **Error codes name the domain concept and are never renamed once shipped.** Reuse existing `modifier.*` and `diet.*` codes; remove a code only when its sole trigger is deleted (repo CLAUDE.md §3).
- **Every commit uses `git commit -s`.** Commit messages are plain English: say what changed and why in words, with exact file/function/error-code names appearing once as pointers (repo CLAUDE.md; owner rule).
- **Coverage bars:** `@waitron/catalogue` 98/98/98/95; `apps/*` (dashboard, till, server) 90/90/85/85. Run focused tests while implementing; CI runs the mandatory package suites and coverage. Do not add a whole-workspace local run to finish the branch.
- **Keep each task's end state green:** the build typechecks and the touched package's focused tests pass before you commit. A cross-cutting type change is split across tasks precisely so no commit leaves the tree red.
- **A rendered page has nothing checking it renders unless you open it.** For dashboard/till (browser-mode) the harness renders; for `apps/server` string pages there is none. Open changed screens in both themes and at phone width (repo CLAUDE.md §4).
- Work happens in the worktree `/Users/clintongormley/workspace/worktrees/waitron-modifier-nutrition-rework` on branch `modifier-nutrition-rework`.

---

## Scope by symbol, not by file list (read before every task)

The per-task **Files** lists below are a FLOOR, not a ceiling — an earlier fresh-context review found them under-scoped by roughly half. Each of these changes threads through many files, one of them a cross-package contract. So before you commit any task:

1. Run the task's grep (below) and update **every** non-test hit. A missed hit is a compile break that violates the task's green-boundary promise.
2. Re-grep the **tests** for the same symbol (`git grep -n "<symbol>" -- '**/*.test.ts'`) and update those too — including `*.a11y.test.ts`, `*.pg.test.ts`, and the drift/guard suites.
3. Only then run the focused suites + typechecks named in the task.

### Authoritative consumer inventory (grep-verified 2026-09-15, branch head)

- **`yes-no`** (Task 1) — non-test: `packages/shared/src/modifiers.ts`, `packages/shared/src/modifier-snapshots.ts`, `packages/catalogue/src/modifier-contract.ts`, `packages/catalogue/src/modifier-projection.ts`, `packages/catalogue/src/modifiers.ts`, `packages/db/src/schema/catalogue.ts`, `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/i18n/strings.ts` (86, 1339), `apps/dashboard/src/screens/modifiers-screen.ts` (372, 439), `apps/dashboard/src/widgets/modifier-form.ts` (39, 178, 367, 382-383, 580, 594), `apps/server/src/modifier-selection.ts` (20, 23, 59, 60), `apps/server/src/modifier-snapshot-labels.ts` (15), `apps/server/scripts/demo-seed/seed-options.ts` (158), `apps/till/src/api/client.ts` (360, 369, 378), `apps/till/src/widgets/modifier-picker.ts` (158, 473-476), `apps/till/src/widgets/modifier-snapshot.ts` (13).
- **`isModifierOffered`** (Task 1) — `packages/shared/src/modifiers.ts` (def), `packages/catalogue/src/modifier-contract.ts` (1, 2, 209, 258), `packages/catalogue/src/modifier-projection.ts` (3, 40, 72). Removing it: the two `.filter(isModifierOffered)` calls become identity — delete the filter; the two contract guards drop the `isModifierOffered(...)` term (every modifier is offered).
- **`removeAllergens` / `addOrigins` / `removeOrigins`** (Task 3) — non-test: `packages/shared/src/modifiers.ts`, `packages/db/src/schema/catalogue.ts`, `packages/catalogue/src/modifier-contract.ts`, `packages/catalogue/src/modifiers.ts`, **`packages/module/src/module.ts` (158-160, the cross-package module contract — a risk trigger)**, `apps/dashboard/src/api/client.ts` (431-437 AND 487, 538, 559), `apps/dashboard/src/screens/modifiers-screen.ts`, `apps/dashboard/src/widgets/allergen-dietary-picker.ts`, `apps/dashboard/src/widgets/choice-form.ts`, `apps/dashboard/src/widgets/modifier-form.ts` (374-375), `apps/dashboard/src/widgets/option-group-manager.ts` (352, 363, 500-539), `apps/server/src/catalogue-api.ts` (1245-1354), `apps/server/src/working-order.ts` (the 239-242 picker feed AND the 3900-4019 fold removed in Task 2), `apps/till/src/api/client.ts` (296-315, 353, 526-528), `apps/till/src/state/as-served.ts` (removed in Task 2), `apps/till/src/widgets/modifier-picker.ts` (230-232). **KEEP** `packages/catalogue/src/operations.ts` — its `removeAllergens`/`addOrigins`/`removeOrigins` are the PRODUCT manual overlay, a different feature.
- **`dietaryEffect`** (Task 4) — non-test: `packages/shared/src/modifiers.ts`, `packages/db/src/schema/catalogue.ts`, `packages/catalogue/src/modifier-contract.ts`, `packages/catalogue/src/modifiers.ts`, `packages/module/src/module.ts` (161), `apps/dashboard/src/api/client.ts` (all four shapes), `apps/dashboard/src/screens/modifiers-screen.ts`, `apps/dashboard/src/widgets/choice-form.ts`, `apps/dashboard/src/widgets/modifier-form.ts`, `apps/server/src/working-order.ts` (242 + the fold), `apps/server/scripts/demo-seed/seed-options.ts` (105, 114, 123, 142, 148), `apps/till/src/api/client.ts` (315, 528), `apps/till/src/state/as-served.ts` (removed in Task 2). In `operations.ts`, verify each hit is a product-path/comment reference before touching it.

### KEEP list (do NOT delete — live product-path or product-editor consumers)

- `validateRemoveAllergens`, `assertAllergenOverlayDisjoint`, `validateOrigins` — used by `packages/catalogue/src/operations.ts` (1976, 1982, 2003). Tasks only remove the now-dead IMPORT of these from `modifier-contract.ts`; the functions and their tests stay.
- `expandDietaryDeclarations` — used by `apps/dashboard/src/widgets/product-editor.ts:731` and the product path in `working-order.ts`. Keep it.
- `deriveDietProfile`, `overlayDietProfile`, `republish`, `mergeAllergenMaps`, `DIETARY_LABELS` (6), `validateDietaryDeclarations` — the product's own derivation. Keep all.

### Historical snapshot path — decision

A modifier SELECTION is also stored as a frozen `modifier_snapshots` value (`packages/shared/src/modifier-snapshots.ts`, `apps/till/src/api/client.ts`, `apps/server/src/modifier-selection.ts`, `apps/server/src/modifier-snapshot-labels.ts`, `apps/till/src/widgets/modifier-snapshot.ts`). Because Waitron is pre-production (no data to preserve, §3), **drop the `{ type: "yes-no"; value: boolean }` arm from the snapshot unions and every switch over them too**, in Task 1 — do not keep a dead branch for snapshots that can no longer be produced.

---

## Task 1: Remove the `yes-no` modifier type

Removes the redundant fourth type end-to-end. Self-contained: every layer still compiles because dropping a union arm only deletes branches.

**Files:**
- Modify: `packages/shared/src/modifiers.ts` (union at 21-33, `isModifierOffered` 35-39)
- Modify: `packages/catalogue/src/modifier-contract.ts` (parse 92-100, selections 219-221, 257-266; import/re-export of `isModifierOffered` 1-2, 209, 258)
- Modify: `packages/catalogue/src/modifiers.ts` (`groupValues` 148, `listModifiers` 51/54-59)
- Modify: `packages/db/src/schema/catalogue.ts` (type `$type` 175, CHECK 188, `defaultValue` column 180)
- Modify: `apps/dashboard/src/api/client.ts` (union 450-464)
- Modify: `apps/dashboard/src/widgets/modifier-form.ts` (`TYPES` 39, and every `yes-no` branch — read the file; there is a type `<select>`, a `defaultValue` switch, and render branches)
- Create migration: `packages/db/src/migrations/*` (generated)
- Test: `packages/catalogue/src/modifier-contract.test.ts`, `packages/catalogue/src/modifiers.pg.test.ts`, `apps/dashboard/src/widgets/modifier-form.test.ts`

**Interfaces:**
- Produces: `ModifierInput` / `Modifier` unions without the `{ type: "yes-no" }` arm; `ModifierSelection` without `{ type: "yes-no" }`. `isModifierOffered` removed (all modifiers are always offered).

- [ ] **Step 1: Write the failing contract test**

In `modifier-contract.test.ts`, add:

```ts
it("rejects the removed yes-no type", () => {
  expect(() => parseModifierInput({ type: "yes-no", name: { en: "Gift wrap" }, defaultValue: true }))
    .toThrow(expect.objectContaining({ code: "modifier.invalid", params: { field: "type" } }));
});
```

- [ ] **Step 2: Run it, expect it to FAIL** (today `yes-no` parses successfully)

Run: `pnpm --filter @waitron/catalogue test -- modifier-contract`
Expected: FAIL — no throw.

- [ ] **Step 3: Remove `yes-no` from the shared types**

In `packages/shared/src/modifiers.ts`: delete the `| { type: "yes-no"; defaultValue: boolean }` arm from `ModifierInput` (line 26) and the `| { modifierId: string; type: "yes-no"; value: boolean }` arm from `ModifierSelection` (line 33). Delete `isModifierOffered` (35-39) — every modifier is now always offered.

- [ ] **Step 4: Update the contract**

In `packages/catalogue/src/modifier-contract.ts`:
- Remove the `import { … isModifierOffered }` (line 1) and the `export { isModifierOffered } …` (line 2).
- Delete the `if (row.type === "yes-no") { … }` block (92-100).
- In `validateModifierSelections`, delete the `case "yes-no":` (219-221); replace the `if (!definition || !isModifierOffered(definition) || row.type !== definition.type)` guard (209) with `if (!definition || row.type !== definition.type)`; in the required-selection loop remove `!isModifierOffered(definition) continue` (258) and drop `definition.type === "yes-no" ||` (261).

- [ ] **Step 5: Update persistence + projection**

In `packages/catalogue/src/modifiers.ts`:
- `groupValues` (137-150): delete the `defaultValue: input.type === "yes-no" ? … : false` line (148).
- `listModifiers` (44-91): set `available: true` unconditionally (51 — drop the `group.type === "yes-no" ? … :` ternary and its comment 45-47); delete the `if (group.type === "yes-no") return { … }` block (54-59).

- [ ] **Step 6: Update the schema + regenerate migration**

In `packages/db/src/schema/catalogue.ts`: change the `type` `$type` to `<"text" | "extras" | "options">` (175); change the CHECK to `sql\`${t.type} in ('text','extras','options')\`` (188); delete the `defaultValue` column (180).

Run: `pnpm --filter @waitron/db generate` (regenerate the drizzle migration; do not hand-edit snapshots).
Then verify the generated SQL drops `default_value` and updates the check.

- [ ] **Step 7: Update the dashboard type mirror + form**

In `apps/dashboard/src/api/client.ts`: delete the `| { type: "yes-no"; defaultValue: boolean }` arm (460-463).
In `apps/dashboard/src/widgets/modifier-form.ts`: change `TYPES` to `["text", "extras", "options"] as const` (39); read the file and remove every `yes-no` branch (the type `<select>` option, the `defaultValue` state + switch, and any render/save branch keyed on `"yes-no"`).

- [ ] **Step 8: Update tests to drop yes-no cases**

In `modifier-form.test.ts` and `modifiers.pg.test.ts`: remove assertions that create/read a `yes-no` modifier; keep everything else.

- [ ] **Step 9: Run focused tests + typecheck, expect PASS**

Run: `pnpm --filter @waitron/catalogue test -- modifier && pnpm --filter @waitron/dashboard test -- modifier-form && pnpm --filter @waitron/catalogue typecheck && pnpm --filter @waitron/dashboard typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -s -m "Remove the redundant yes/no modifier type

A yes/no modifier is just an extra or option with a single choice, so the
fourth type earned nothing. Drops it from the modifier union, the parser,
the selection validator, the option_groups type check and its default_value
column, and the dashboard form."
```

---

## Task 2: Stop combining a dish with its extras — show the dish's own diet/allergens

Removes the "as-served" fold on the waiter basket and the kitchen/expo projection. After this the line shows the dish's OWN allergens and OWN diet (recipe-derived, no modifier overlay). Per-extra display is added in Task 4. This must land before Task 3 drops the columns the fold reads.

**Files:**
- Modify: `apps/till/src/state/as-served.ts` (whole file — remove the modifier fold)
- Modify: `apps/till/src/widgets/basket.ts` (`#allergenRow` 466-499, `#dietRow` 414-425)
- Modify: `apps/server/src/working-order.ts` (the parent/child effect accumulation and `asServedByParent` fold, ~3900-4019)
- Modify: `packages/catalogue/src/derivation.ts` (remove `deriveAsServedAllergens`, `OptionAllergenOverlay`, `AsServedAllergens` — 45-89; KEEP `mergeAllergenMaps`, `republish`, `RecipeDerivation`)
- Modify: `packages/catalogue/src/dietary.ts` (remove `deriveAsServedDiet` + `OptionOriginOverlay`; KEEP `deriveDietProfile`, `overlayDietProfile`, `DietProfile` — verify line numbers by reading)
- Modify: `packages/catalogue/src/dietary-declarations.ts` (remove `applyDietaryEffects` and — only if grep shows no remaining consumer — `expandDietaryDeclarations`; KEEP `DIETARY_LABELS`, `validateDietaryDeclarations` for the product path)
- Test: `apps/till/src/state/as-served-diet.test.ts` (the real filename; also any `as-served*` allergen test), `apps/till/src/widgets/basket.test.ts`, `apps/server/src/working-order.test.ts`, `packages/catalogue/src/derivation.test.ts`, `packages/catalogue/src/dietary-declarations.test.ts`

**Interfaces:**
- Produces: `asServedDiet(line)` and `asServedAllergens(line)` (kept names) now return the PRODUCT's own profile with no modifier contribution. The server projection `asServedByParent` carries the parent product's own `{ allergens, pending }` and `asServedDiet`, no fold.

- [ ] **Step 1: Write the failing behaviour test (client fold gone)**

In the as-served test file, add a test that a selected extra which used to add an allergen NO LONGER changes the line's allergens:

```ts
it("shows the dish's own allergens, ignoring selected extras", () => {
  const line = lineWith({
    product: { allergens: { gluten: { presence: "contains" } } },
    // an extra that (under the old model) added milk
    extras: [{ addAllergens: { milk: { presence: "contains" } } }],
  });
  expect(Object.keys(asServedAllergens(line).allergens).sort()).toEqual(["gluten"]);
});
```

(Adapt `lineWith`/`extras` to the file's existing test helpers.)

- [ ] **Step 2: Run it, expect FAIL** (today milk is folded in)

Run: `pnpm --filter @waitron/till test -- as-served`
Expected: FAIL — result includes `milk`.

- [ ] **Step 3: Reduce the client helpers to product-own**

In `apps/till/src/state/as-served.ts`: delete `selectedItems`, `asServedDietaryDeclarations`, and the overlay construction. Reimplement:
- `asServedAllergens(line)` → return the dish's own published allergens as an `AsServedAllergens`-shaped value, i.e. `{ allergens: line.product.allergens ?? {}, pending: line.product.allergens == null, removed: [] }` (inline a small local type — `AsServedAllergens` is being removed from catalogue).
- `asServedDiet(line)` → the product's own `DietProfile`. The `dietaryDeclarations` branch currently (line 62) calls `asServedDietaryDeclarations(line)`, which this step DELETES — so rewire that branch to `expandDietaryDeclarations(line.product.dietaryDeclarations as DietaryLabel[])` (the dish's own declarations, no modifier effects), keeping the same "vegan/vegetarian ⇒ badge" mapping at 63-70. For the derived branch, call the product-level derivation with NO overlays (`deriveDietProfile` then `overlayDietProfile`); do NOT use `deriveAsServedDiet` — this task removes it. `expandDietaryDeclarations` is KEPT (see the KEEP list).

Remove the now-unused imports (`deriveAsServedAllergens`, `deriveAsServedDiet`, `applyDietaryEffects`, `expandDietaryDeclarations`, overlay types).

- [ ] **Step 4: Update the basket rows**

In `apps/till/src/widgets/basket.ts`: `#allergenRow` and `#dietRow` keep calling `asServedAllergens`/`asServedDiet` but those now return product-own values — no code change needed beyond confirming the render still compiles. Confirm the `data-test` hooks stay.

- [ ] **Step 5: Reduce the server projection**

In `apps/server/src/working-order.ts` (~3900-4019): delete the child `addAllergens`/`removeAllergens`/`dietaryEffect` selects and `overlaysByParent`/`dietaryEffectsByParent` accumulation (3906-3942, 3961-3995); compute each parent's own profile: `asServed` = `{ allergens: p.allergens ?? {}, pending: p.allergens == null }`, and `asServedDiet` from `p.dietaryDeclarations` alone via `expandDietaryDeclarations` (KEPT) feeding the `expanded.includes(...)` mapping (drop `applyDietaryEffects`).

Because the "removes" direction is gone, the fold's `removed` output is permanently empty. **Drop `removed` from `asServedByParent` and the wire, and delete the expo "NO &lt;allergen&gt;" removed-callout it fed** (`apps/till/src/screens/till-expo-screen.ts` ~665-687) — a permanently-empty branch is dead code and a stale receipt (§1). Update any wire-body `toEqual`/`toMatchObject` assertion that pinned `removed` (re-grep). This is the one deliberate shape change to `asServedByParent`; every other field stays.

- [ ] **Step 6: Remove the dead shared combiners**

Grep first: `git grep -n "deriveAsServedAllergens\|deriveAsServedDiet\|applyDietaryEffects\|expandDietaryDeclarations"`. Remove each function and its types **only** where no consumer remains. `mergeAllergenMaps`, `republish`, `deriveDietProfile`, `overlayDietProfile`, `DIETARY_LABELS`, `validateDietaryDeclarations` stay (product path). Delete the corresponding unit tests for the removed functions; keep the product-path tests.

- [ ] **Step 7: Update server + till display tests**

In `working-order.test.ts` and `basket.test.ts`: replace "extra changes the as-served allergens/diet" assertions with "line shows the dish's own allergens/diet regardless of extras". Preserve the product-own assertions (a recipe-pending dish still shows "not reviewed").

- [ ] **Step 8: Run focused tests + typechecks, expect PASS**

Run: `pnpm --filter @waitron/catalogue test -- derivation dietary && pnpm --filter @waitron/till test -- as-served basket && pnpm --filter @waitron/server test -- working-order && pnpm --filter @waitron/catalogue typecheck && pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/server typecheck`
Expected: PASS.

- [ ] **Step 9: Open the till basket in the browser (both themes, phone width)** — add an extra to a dish; confirm the dish's own allergen/diet rows render and the extra no longer changes them.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -s -m "Stop folding a dish's extras into its diet and allergens

The waiter basket and the kitchen/expo screens no longer compute a combined
'as-served' figure for a dish plus its chosen extras; each dish shows its own
recipe-derived allergens and diet. Removes the modifier fold from as-served.ts,
the working-order projection, and the shared deriveAsServed* combiners. Each
extra's own list is shown separately in a later commit."
```

---

## Task 3: Collapse allergens to one "contains" list per choice

Removes the separate "removes" allergen list and the two unused origin lists. Safe now that the fold (their only other reader) is gone. The kept field is `addAllergens` (the choice's allergens); its internal name is unchanged to limit blast radius, only the UI label changes (Task 5).

**Files:**
- Modify: `packages/shared/src/modifiers.ts` (`ModifierEffects` 2-8)
- Modify: `packages/catalogue/src/modifier-contract.ts` (`effects` 64-81, `effectKeys` 64; imports 3-7)
- Modify: `packages/catalogue/src/allergens.ts` (remove `validateRemoveAllergens`, `assertAllergenOverlayDisjoint` if now unused — grep first)
- Modify: `packages/catalogue/src/modifiers.ts` (`writeChoices` values 183-187, `listModifiers` projection 67-69)
- Modify: `packages/db/src/schema/catalogue.ts` (drop `removeAllergens` 230, `addOrigins` 231, `removeOrigins` 232 + the 228-229 comment)
- Modify: `apps/dashboard/src/api/client.ts` (`ModifierEffects` 431-437)
- Modify: `apps/dashboard/src/widgets/choice-form.ts` (`willUpdate` effects 84-94, `#pickerValue` 149-155, `#onPicker` 156-170)
- Create migration: generated
- Test: `modifier-contract.test.ts`, `modifiers.pg.test.ts`, `choice-form.test.ts`

**Interfaces:**
- Produces: `ModifierEffects = { addAllergens?: …|null; suitableFor?: …|null }` (the `suitableFor` reshape lands in Task 4; in THIS task the type is `{ addAllergens?; dietaryEffect? }` still — only the remove/origin fields are dropped).

- [ ] **Step 1: Write the failing contract test**

```ts
it("rejects removeAllergens on a choice", () => {
  const bad = { type: "extras", name: { en: "X" }, required: false, maxTotalQuantity: null,
    choices: [{ id: UUID, name: { en: "c" }, removeAllergens: ["gluten"] }] };
  expect(() => parseModifierInput(bad)).toThrow(expect.objectContaining({ code: "modifier.invalid" }));
});
```

- [ ] **Step 2: Run it, expect FAIL** (today `removeAllergens` is an allowed key)

Run: `pnpm --filter @waitron/catalogue test -- modifier-contract`

- [ ] **Step 3: Reshape the shared type**

`packages/shared/src/modifiers.ts` `ModifierEffects`: delete `removeAllergens`, `addOrigins`, `removeOrigins` (lines 4-6). Keep `addAllergens` and `dietaryEffect` (dietary reshaped in Task 4).

- [ ] **Step 4: Update the contract**

`modifier-contract.ts`: `effectKeys = ["addAllergens", "dietaryEffect"]` (64 — drop `removeAllergens`); in `effects()` delete the `removeAllergens` block (69-71) and the `assertAllergenOverlayDisjoint` call (72); remove the now-unused IMPORTS (`assertAllergenOverlayDisjoint`, `validateRemoveAllergens`) from this file only. **Do NOT delete those functions from `allergens.ts`** — `packages/catalogue/src/operations.ts` (1976, 1982, 2003) uses `validateRemoveAllergens`, `assertAllergenOverlayDisjoint` and `validateOrigins` for the product manual overlay (the KEEP list). They and their tests stay.

Cover the rest of the inventory in this task: drop the three fields from `packages/module/src/module.ts` (158-160, the cross-package contract), `apps/dashboard/src/widgets/option-group-manager.ts` (its add/remove-allergen + origin comboboxes — read the file), `apps/server/src/catalogue-api.ts` (1245-1354 option route bodies), `apps/server/src/working-order.ts:239-242` (the picker feed — separate from the fold removed in Task 2), the till wire (`apps/till/src/api/client.ts`, `apps/till/src/widgets/modifier-picker.ts`), and the extra `ModifierEffects`-shaped declarations in `client.ts` (487, 538, 559) and `modifier-form.ts:374-375`. Adjust the schema guard `packages/db/src/schema/catalogue.test.ts` (100-109) that asserts the `add_origins`/`remove_origins` columns exist.

- [ ] **Step 5: Update persistence + projection + schema**

`modifiers.ts` `writeChoices` values (183-187): keep `addAllergens: choice.addAllergens ?? null`; delete the `removeAllergens`/`addOrigins`/`removeOrigins` lines. `listModifiers` projection (67-69): delete those three spreads.
`schema/catalogue.ts`: delete columns `removeAllergens` (230), `addOrigins` (231), `removeOrigins` (232) and the 228-229 comment. Run `pnpm --filter @waitron/db generate`.

- [ ] **Step 6: Update the dashboard mirror + choice form**

`client.ts` `ModifierEffects` (431-437): delete `removeAllergens`, `addOrigins`, `removeOrigins`.
`choice-form.ts`: in `willUpdate` (84-94) drop the `removeAllergens`/`addOrigins`/`removeOrigins` spreads; in `#pickerValue` (149-155) drop `removeAllergens`; in `#onPicker` (156-170) drop the `removeAllergens` write. (The picker itself is simplified in Task 5.)

- [ ] **Step 7: Update tests**

Remove remove-allergen / origin cases from `modifier-contract.test.ts`, `modifiers.pg.test.ts`, `choice-form.test.ts`; keep the single-allergen-list assertions.

- [ ] **Step 8: Run focused tests + typechecks, expect PASS**

Run: `pnpm --filter @waitron/catalogue test -- modifier && pnpm --filter @waitron/dashboard test -- choice-form && pnpm --filter @waitron/catalogue typecheck && pnpm --filter @waitron/dashboard typecheck`

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -s -m "Collapse a choice's allergens to a single contains list

A choice now states only the allergens it contains; the separate removes list
and the two unused origin lists are gone. Drops remove_allergens, add_origins
and remove_origins from option_group_items and their validation, persistence
and editor plumbing."
```

---

## Task 4: Replace the negative dietary control with a positive four-label list, and show each extra's own diet/allergens

Reshapes `dietary_effect = { invalidates: 6-labels }` into a positive `suitableFor` list over `vegan, vegetarian, halal, kosher`, and adds each selected extra's OWN allergens/diet to the waiter basket and kitchen/expo displays.

**Files:**
- Modify: `packages/catalogue/src/dietary-declarations.ts` (add the positive vocabulary + validator)
- Modify: `packages/shared/src/modifiers.ts` (`ModifierEffects.dietaryEffect` → `suitableFor`)
- Modify: `packages/catalogue/src/modifier-contract.ts` (`effects` dietary block 73-79, `effectKeys` 64)
- Modify: `packages/catalogue/src/modifiers.ts` (`writeChoices` 187, `listModifiers` 70)
- Modify: `packages/db/src/schema/catalogue.ts` (`dietaryEffect` column 233 → `dietarySuitability`)
- Modify: `apps/dashboard/src/api/client.ts` (`ModifierEffects` dietary field; a `DIETARY_SUITABILITY` const/type for the editor)
- Modify: `apps/dashboard/src/widgets/choice-form.ts` (`#pickerValue`, `#onPicker`, the save default at 131-133)
- Modify: `apps/till/src/widgets/basket.ts` + `apps/till/src/api/client.ts` (per-extra own diet/allergen display; the option/choice wire type must carry `addAllergens` + `suitableFor`)
- Modify: `apps/server/src/working-order.ts` + station-queue/expo wire (attach each child extra's own `addAllergens` + `suitableFor`)
- Modify: `apps/till/src/widgets/station-queue.ts` (802), `apps/till/src/screens/till-expo-screen.ts` (628-631)
- Create migration: generated
- Test: `modifier-contract.test.ts`, `modifiers.pg.test.ts`, `choice-form.test.ts`, `basket.test.ts`, `working-order.test.ts`, station-queue/expo tests

**Interfaces:**
- Produces: `DIETARY_SUITABILITY = ["vegan","vegetarian","halal","kosher"] as const`; `type DietarySuitability`; `validateDietarySuitability(value): DietarySuitability[]`. `ModifierEffects.suitableFor?: DietarySuitability[] | null`. DB column `dietary_suitability jsonb $type<DietarySuitability[]>`.

- [ ] **Step 1: Write the failing validator test**

In `dietary-declarations.test.ts`:

```ts
it("accepts the four positive suitability labels and rejects the retired ones", () => {
  expect(validateDietarySuitability(["vegan", "halal"])).toEqual(["vegan", "halal"]);
  expect(() => validateDietarySuitability(["no_meat"])).toThrow(
    expect.objectContaining({ code: "diet.declaration_invalid" }),
  );
});
```

- [ ] **Step 2: Run it, expect FAIL** (function does not exist)

Run: `pnpm --filter @waitron/catalogue test -- dietary-declarations`

- [ ] **Step 3: Add the positive vocabulary**

In `dietary-declarations.ts` add:

```ts
export const DIETARY_SUITABILITY = ["vegan", "vegetarian", "halal", "kosher"] as const;
export type DietarySuitability = (typeof DIETARY_SUITABILITY)[number];
const SUITABILITY = new Set<string>(DIETARY_SUITABILITY);
export function validateDietarySuitability(value: unknown): DietarySuitability[] {
  if (
    !Array.isArray(value) ||
    value.some((l) => typeof l !== "string" || !SUITABILITY.has(l)) ||
    new Set(value).size !== value.length
  ) {
    throw new AppError("diet.declaration_invalid", {});
  }
  return [...value] as DietarySuitability[];
}
```

Keep `DIETARY_LABELS` (6) and `validateDietaryDeclarations` for the product path.

- [ ] **Step 4: Reshape the type + contract**

`packages/shared/src/modifiers.ts`: `ModifierEffects.dietaryEffect` → `suitableFor?: string[] | null`.
`modifier-contract.ts`: `effectKeys = ["addAllergens", "suitableFor"]`; replace the dietary block (73-79) with `out.suitableFor = row.suitableFor == null ? [] : validateDietarySuitability(row.suitableFor);` and import `validateDietarySuitability`.

- [ ] **Step 5: Persistence + schema**

`modifiers.ts`: `writeChoices` value `dietarySuitability: choice.suitableFor ?? []` (replace 187); `listModifiers` projection `suitableFor: item.dietarySuitability ?? []` (replace 70).
`schema/catalogue.ts`: replace the `dietaryEffect` column (233) with `dietarySuitability: jsonb("dietary_suitability").$type<string[]>()`. Run `pnpm --filter @waitron/db generate`.

Cover the rest of the `dietaryEffect` inventory: `packages/module/src/module.ts:161` (the cross-package contract — replace the `dietaryEffect?: { invalidates }` field with `suitableFor?: readonly string[] | null`), `apps/server/src/catalogue-api.ts`, `apps/server/src/working-order.ts:242` (picker feed), the till wire (`apps/till/src/api/client.ts` 315, 528), and the dashboard `modifiers-screen.ts` read-back. **Rewrite the demo seed** `apps/server/scripts/demo-seed/seed-options.ts`: replace each `dietaryEffect: { invalidates: [...] }` (105, 114, 123, 142, 148) with `suitableFor: [...]` using the four positive labels, and (already required by Task 1) drop its `type: "yes-no"` modifier — otherwise `createModifier`/`parseModifierInput` reject the seed and the `wa-wt demo` stack + `seed-options.test.ts` break.

- [ ] **Step 6: Dashboard mirror + choice form default**

`client.ts`: `ModifierEffects.suitableFor?: string[] | null`; export a `DIETARY_SUITABILITY`/`DietarySuitability` for the editor (browser-local copy, per the #70 bundle rule — do not import from catalogue).
`choice-form.ts`: `#pickerValue` reads `this.effects.suitableFor ?? []`; `#onPicker` writes `suitableFor: v.dietary`; the save block (131-133) sets `suitableFor: this.effects.suitableFor ?? []` (drop the `dietaryEffect` default + its comment).

- [ ] **Step 7: Write the failing per-extra display test**

In `basket.test.ts`, assert that a selected extra renders its OWN allergen/diet indicators (text), separate from the dish's:

```ts
it("shows each selected extra's own allergens", async () => {
  // dish with gluten, extra 'bacon' carrying its own addAllergens/suitableFor
  // expect a per-extra allergen node with the extra's codes, distinct from the dish row
  expect(el.querySelector('[data-test="option-allergens-0"]')?.textContent).toContain("…");
});
```

(Match the real test harness and data-test naming; pick `option-allergens-<i>` / `option-diet-<i>`.)

- [ ] **Step 8: Run it, expect FAIL**, then implement the per-extra display

- Extend the till option/choice wire type (`apps/till/src/api/client.ts`) so a selected option carries its own `addAllergens` and `suitableFor`.
- In `basket.ts` render loop (315-329, the `line.options` map) add, under each option's name row, that option's own allergen chips and diet badges as text (reuse `.allergen-chip` styling and a small diet-label row; do NOT reintroduce a fold). Guard so an option with no allergens/diet adds no chrome.
- On the server, attach each child extra's own `addAllergens`/`suitableFor` to the station-queue and expo wire items (`working-order.ts`), and render them per-extra in `station-queue.ts` (802) and `till-expo-screen.ts` (628-631).

- [ ] **Step 9: Update tests + run focused suites, expect PASS**

Run: `pnpm --filter @waitron/catalogue test -- dietary-declarations modifier && pnpm --filter @waitron/dashboard test -- choice-form && pnpm --filter @waitron/till test -- basket station-queue expo && pnpm --filter @waitron/server test -- working-order` plus the four typechecks.

- [ ] **Step 10: Open the till basket + a KDS/expo view (both themes, phone width)** — confirm each extra shows its own allergens/diet as text, and the dish shows its own.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -s -m "Make a choice's diet a positive suitable-for list, shown per item

Replaces the negative 'no longer suitable for' effect (dietary_effect =
{ invalidates } over six labels) with a positive suitableFor list over vegan,
vegetarian, halal and kosher, stored in dietary_suitability. The waiter basket
and the kitchen/expo screens now show each selected extra's own allergens and
diet beside the dish's own."
```

---

## Task 5: Dashboard editor — one allergen list, the four-label dietary checklist, and the section renames

Turns the three-combobox picker into one allergen multi-select plus a four-item dietary checkbox group, and renames the sections to "Nutritional information" and "Dietary preferences".

**Files:**
- Modify: `apps/dashboard/src/widgets/allergen-dietary-picker.ts` (whole — drop the removeAllergens combobox; dietary → checkbox group over `DIETARY_SUITABILITY`)
- Modify: `apps/dashboard/src/widgets/choice-form.ts` (`#effects` heading 171-173)
- Modify: `apps/dashboard/src/i18n/strings.ts` (EN + ES): rename `modifiers.effects` "Allergens and dietary effects" → "Nutritional information" (115 / ES ~2? — find the ES sibling); rename `modifiers.invalidates_dietary` "No longer suitable for" → "Dietary preferences" (120 / 1373); the allergen picker's single list needs a label key `modifiers.allergens` ("Allergens" / "Alérgenos"); drop the now-unused `modifiers.add_allergen` / `modifiers.remove_allergen` if nothing else references them (grep). Ensure `editor.diet.*` has only the four labels used (leave the string entries; unused `no_meat`/`no_fish` keys are harmless but remove if the picker was their only consumer — grep).
- Test: `apps/dashboard/src/widgets/allergen-dietary-picker.test.ts`, and the a11y suites this rewrite changes structure in — `allergen-dietary-picker.a11y.test.ts`, `choice-form.a11y.test.ts`, `modifier-form.a11y.test.ts` (a `wt-*` primitive needs an axe a11y test per distinct state in both themes; the checkbox group must pass axe with proper labels). Re-grep the widget tests before finishing.

**Interfaces:**
- Consumes: `DIETARY_SUITABILITY` (Task 4). Produces: `AllergenDietaryValue = { allergens: string[]; dietary: DietarySuitability[] }` (rename `addAllergens`→`allergens`, drop `removeAllergens`).

- [ ] **Step 1: Write the failing widget test** — the picker renders one allergen control and four dietary checkboxes, no "remove allergens" control:

```ts
it("renders one allergen list and four dietary checkboxes", async () => {
  const el = await fixture(html`<dashboard-allergen-dietary-picker></dashboard-allergen-dietary-picker>`);
  expect(el.shadowRoot!.querySelector('[data-test="remove-allergens"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="allergens"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelectorAll('[data-test="dietary"] input[type="checkbox"]').length).toBe(4);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @waitron/dashboard test -- allergen-dietary-picker`

- [ ] **Step 3: Rewrite the picker**

In `allergen-dietary-picker.ts`: change `AllergenDietaryValue` to `{ allergens: string[]; dietary: DietarySuitability[] }`; render one `wt-combobox` (`data-test="allergens"`, label `t("modifiers.allergens")`) and a dietary checkbox group (`data-test="dietary"`) — one labelled checkbox per `DIETARY_SUITABILITY` entry, each with a semantic `name`, toggling emits `wt-change` with the updated `dietary` array. Delete `#onRemove`, the remove combobox, and the disjoint logic. Use `--wt-*` tokens only (no hex/px). If no checkbox primitive exists in `packages/ui`, use native `<input type="checkbox">` with token-styled labels (this widget is in `apps/dashboard`, outside the `no-hardcoded-chrome` guard, but follow the token convention anyway).

- [ ] **Step 4: Rewire the choice form**

`choice-form.ts`: `#pickerValue` returns `{ allergens: Object.keys(this.effects.addAllergens ?? {}), dietary: this.effects.suitableFor ?? [] }`; `#onPicker` maps `v.allergens` back into `addAllergens` (`{ [code]: { presence: "contains" } }`) and `v.dietary` into `suitableFor`. `#effects` heading uses `t("modifiers.effects")` which now reads "Nutritional information".

- [ ] **Step 5: Rename the strings**

`strings.ts`: update `modifiers.effects`, `modifiers.invalidates_dietary`, add `modifiers.allergens`, in EN and ES. Grep for the ES siblings by key. Remove `modifiers.add_allergen`/`modifiers.remove_allergen` only if unused after this task.

- [ ] **Step 6: Run focused tests + typecheck, expect PASS**

Run: `pnpm --filter @waitron/dashboard test -- allergen-dietary-picker choice-form && pnpm --filter @waitron/dashboard typecheck`

- [ ] **Step 7: Open the modifier editor in the browser (both themes, phone width)** — confirm the Nutritional information section shows one Allergens list and a Dietary preferences checklist of four.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -s -m "Editor: one allergen list and a four-item dietary checklist

The choice editor's nutritional section now offers a single Allergens list and
a Dietary preferences checklist (Vegan, Vegetarian, Halal, Kosher), replacing
the add/remove allergen comboboxes and the 'No longer suitable for' control.
Renames the section headings to Nutritional information and Dietary preferences."
```

---

## Task 6: Modifiers list screen — row opens a products modal, delete matches categories

Independent of the nutrition model. Row click opens a "products that use this modifier" modal like categories; the delete flow (already listing products) is restyled to match the categories delete dialog.

**Files:**
- Modify: `apps/dashboard/src/screens/modifiers-screen.ts` (`#openDetails`/details modal 367-414 → products modal; delete `#renderDependants` 246-281 restyle; row-click wiring in the columns 416-475)
- Reference: `apps/dashboard/src/screens/categories-screen.ts` (products modal 697-795, member table 767-778, delete dialog 810-841, `#renderDependants` 587-636)
- Reuse: `api.getModifierDependants` (`apps/dashboard/src/api/client.ts:2117`) → `modifierDependants` server query (returns `products`, `menus`, `orders`)
- Test: `apps/dashboard/src/screens/modifiers-screen.test.ts`

**Interfaces:**
- Consumes: `modifierDependants` (`{ products, menus, orders }`), already wired.

- [ ] **Step 1: Write the failing test** — clicking a modifier row opens a modal listing the products that use it:

```ts
it("opens a products modal when a modifier row is clicked", async () => {
  // render the screen with a modifier used by product 'Burger'; click the row
  // expect a modal with data-test="modifier-products" listing 'Burger'
  expect(el.shadowRoot!.querySelector('[data-test="modifier-products"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run it, expect FAIL** (today the row opens a read-only details modal)

Run: `pnpm --filter @waitron/dashboard test -- modifiers-screen`

- [ ] **Step 3: Replace the details modal with a products modal**

In `modifiers-screen.ts`: change the row click to load `getModifierDependants(id)` and open a modal (`data-test="modifier-products"`) rendering a `wt-data-table` of the products (and menus) that use it, mirroring the categories products modal (697-795). Remove the old `#openDetails`/`#detailsBody` read-only details modal (367-414) and its `#choiceSummary` if it becomes unused (grep).

- [ ] **Step 4: Restyle the delete dependants table**

Align `#renderDependants` (246-281) with the categories delete dialog's products table (`categories-screen.ts` 587-636 / 810-841): same `wt-data-table` markup and columns. Behaviour (refuse on open orders) is unchanged.

- [ ] **Step 5: Update tests + run, expect PASS**

Run: `pnpm --filter @waitron/dashboard test -- modifiers-screen && pnpm --filter @waitron/dashboard typecheck`

- [ ] **Step 6: Open the modifiers screen (both themes, phone width)** — click a row (products modal), open delete (products table).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -s -m "Modifiers screen: row opens a products modal, delete matches categories

Clicking a modifier row now lists the products that use it, like the categories
screen, instead of a read-only details panel; the delete confirmation's product
table is restyled to match the categories delete dialog. Both reuse the existing
modifierDependants query."
```

---

## Self-review notes

- **Spec coverage:** yes-no removal (T1); stop combining (T2); single allergen list (T3); positive dietary + per-item display (T4); section renames + editor (T5); row modal + delete restyle (T6). Product derivation untouched (T2 keeps `deriveDietProfile`/`overlayDietProfile`/`republish`). Calorie dropped (absent). "Tree nuts" already "Nuts" (no task). Icons deferred (not in this plan).
- **Type consistency:** `ModifierEffects` evolves `{ addAllergens, removeAllergens, addOrigins, removeOrigins, dietaryEffect }` → (T3) `{ addAllergens, dietaryEffect }` → (T4) `{ addAllergens, suitableFor }`. `dietary_effect` column → `dietary_suitability`. `AllergenDietaryValue` `{ addAllergens, removeAllergens, dietary }` → (T5) `{ allergens, dietary }`. `DIETARY_SUITABILITY` = the four positive labels, defined in T4, consumed in T5.
- **Green boundaries:** the fold's readers (T2) are removed before the columns they read are dropped/reshaped (T3, T4). Each task ends with a compiling tree and passing focused tests.
- **Verify line numbers before editing** — they are from a read of the branch head and may drift as tasks land; re-grep the symbol if a range looks off.
