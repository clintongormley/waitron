# A1517-5: show an extra's allergens before it is added

**Ask (owner, 2026-11-11, "As recommended").** Show an extra's declared allergens before it is
added, without adding missing-information warnings. Source:
[decision 5](../specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11) and the
proposal's point 4 ("declared-allergen labels beside each extra, using existing wording").

**What a person can do when it lands.** A server taps a burger at the till; the window that asks
for its extras shows "Milk" beside White sauce, on the tick-box row and on a stepper row alike,
before anything is ticked. An extra whose allergens nobody entered, or that declares none, shows
nothing extra, as today.

**Out of scope.** Filtering extras by an allergen exclusion (decision 2, A1517-2); options lists
(an option declares no allergens: `apps/server/src/guide/en/modifiers.md:119-121`); variants;
any "Not reviewed" text (October decision 6, and decision 5's own words).

## Facts the plan rests on

- Each offered extra already carries its own effective declaration, `addAllergens`
  (`packages/shared/src/menu-document/menu-types.ts:153-178`, filled from the extra product's
  `allergens` at `packages/catalogue/src/offered-modifiers.ts:154`). The picker receives it and
  draws nothing from it (`apps/till/src/widgets/modifier-picker.ts:981-1040`).
- The basket draws a picked extra's allergens with `extraNutrition`
  (`apps/till/src/widgets/diet-badges.ts:23-58`), reading the same `OfferedExtraItem` fields
  (`apps/till/src/widgets/basket.ts:779-794`, `:1049`). It prints allergen names as chips through
  `allergenName` and shows nothing when `addAllergens` is `null` or `{}`: no missing-information
  state exists in it. Reusing it gives "existing wording" with nothing new to translate.

## Decision for the watcher (one)

`extraNutrition` also draws an extra's dietary badges (Vegan, Vegetarian…) when `suitableFor` is
set. The ask names allergens only. **Recommended: allergens only** — pass
`{ addAllergens: item.addAllergens }` so no diet badge appears in the picker. Alternative: pass the
item whole, so the picker shows exactly the row the basket will show once added (diet badges
included). Worked example: Tofu, vegan, no allergens — recommended shows nothing beside it; the
alternative shows "Vegan".

## Task 1 — the labels (one implementer, test first)

Files: `apps/till/src/widgets/modifier-picker.ts`, `modifier-picker.test.ts`,
`modifier-picker.a11y.test.ts`.

- In `#renderPick` and `#renderStepper`, draw `extraNutrition({ addAllergens: item.addAllergens },
  \`pick-${list.id}-${item.productId}-allergens\`, \`pick-${list.id}-${item.productId}-diet\`)`
  inside the row, after the name, so on the tick-box row it sits inside the `<label>` (tapping it
  ticks the box, and the checkbox's accessible name includes the allergen).
- Styles: the picker's `static styles` gains the chip and row look the basket uses
  (`basket.ts:414-441`: `.allergen-chip`, `.extra-nutrition`, `.extra-allergens`), without the
  basket's indent. The name and its chips stack in one flex column (wrap the name and chips in
  one `.option-name` span) so the price and stepper stay aligned on the right. Tokens only.
- Tests, failing first (`modifier-picker.test.ts`):
  1. a tick-box extra declaring `{ milk: {} }` shows one chip reading "Milk" inside its label,
     before it is ticked, and the checkbox's accessible name contains "Milk";
  2. a stepper extra declaring `{ nuts: {}, milk: {} }` shows both chips (sorted, as
     `extraNutrition` sorts);
  3. an extra with `addAllergens: null` and one with `{}` show no chip and no text beyond today's
     (assert the row's text is exactly its name and price) — the no-warning rule;
  4. in Spanish (`es`), the milk chip reads "Leche";
  5. an extra declaring nothing but `suitableFor: ["vegan"]` shows no diet badge (only if the
     watcher picks "allergens only"; with the alternative, assert the badge instead).
  Deletion control: remove the call from `#renderPick`; cases 1 and 4 fail; restore.
- `modifier-picker.a11y.test.ts`: add a state where both extras declare allergens, checked by
  axe in light and dark, as the file's other states are.
- Run: `pnpm --filter @waitron/till exec vitest run src/widgets/modifier-picker` (all its files)
  and `src/widgets/diet-badges.test.ts`. Look at the window in both themes at phone width
  (CLAUDE.md §4) on the dev stack or a test screenshot.

## Task 2 — words (same implementer)

- Guide, English `apps/server/src/guide/en/modifiers.md` `{#till}` and Spanish
  `apps/server/src/guide/es/modifiers.md` `{#till}`: after "with a tick box each, or a stepper
  where you allowed more than one", one sentence: "Beside each entry are the allergens its product
  declares." (ES: "Junto a cada entrada aparecen los alérgenos que declara su producto.") Run
  `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.
- `docs/backlog/catalogue.md` A1517: delete point 4; `docs/backlog.md` A1517 line: drop "label
  extras before selection". `docs/developers/design-system.md`: only if it describes the picker's
  rows (grep "modifier picker"); otherwise untouched.

## Size and path

About 20 production lines, 80 test lines. No risk trigger: light path (no per-task reviewer);
`/finish-branch` as usual.
