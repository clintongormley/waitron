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

## Allergens only

`extraNutrition` also draws an extra's dietary badges (Vegan, Vegetarian…) when `suitableFor` is
set. The owner's words name declared allergens only ("declared-allergen labels beside each
extra"), so the picker passes `{ addAllergens: item.addAllergens }` and draws no diet badge. Tofu,
vegan with no allergens, shows nothing beside it.

The data reaches the picker on every path (traced in the plan read): the zone offers read
(`apps/till/src/api/client.ts:2918`), `menuOfferToTillProduct`/`sellableModifiers`
(`client.ts:442-494`), `till-app.ts:1821`, and `offeredListsOf(this.product)`
(`modifier-picker.ts:418`); the basket's and sent-order editor's copies keep the same fields
(`basket.ts:572-600`, `till-table-order-screen.ts:2791-2829`); the server sends them
(`apps/server/src/till-api.sell-published.test.ts:1025-1041`). Every opener and mode (inline,
line details, variant dishes, which use the parent's lists) draws rows through `#renderPick` and
`#renderStepper`, so the one change covers them all.

## Task 1 — the labels (one implementer, test first)

Files: `apps/till/src/widgets/modifier-picker.ts`, `modifier-picker.test.ts`,
`modifier-picker.a11y.test.ts`.

- In `#renderPick` and `#renderStepper`, draw `extraNutrition({ addAllergens: item.addAllergens },
  \`pick-${list.id}-${item.productId}-allergens\`, \`pick-${list.id}-${item.productId}-diet\`)`
  inside the row, after the name, so on the tick-box row it sits inside the `<label>` (tapping it
  ticks the box, and the checkbox's accessible name includes the allergen).
- Styles (watcher 00:11, change 1): the chip and row rules (`.allergen-chip`, `.extra-nutrition`,
  `.extra-allergens`) go in the extras window's own `static styles`, design tokens only (no `em`
  or `999px` fallbacks); no shared export, and the basket, station queue and pass board are
  untouched. Keep `.option-name` holding only the name (style tests read it,
  `modifier-picker.test.ts:867-935`); put the name and the chips in a new wrapper
  (`.option-label`, a flex column taking `flex: 1`) so price and stepper stay on the right.
- Tests, failing first (`modifier-picker.test.ts`):
  1. a tick-box extra declaring `{ milk: {} }` shows one chip reading "Milk" inside its label,
     before it is ticked, and the checkbox's accessible name contains "Milk";
  2. a stepper extra declaring `{ nuts: {}, milk: {} }` shows both chips (sorted, as
     `extraNutrition` sorts);
  3. an extra with `addAllergens: null` shows nothing new: one check that the row's text is
     exactly its name and price (watcher 00:11, change 2) — the no-warning rule;
  4. an extra declaring `{ milk: {} }` with `suitableFor: ["vegan"]` shows the Milk chip and no
     "Vegan" badge;
  5. width (watcher 00:11, change 4): its own case, not a state in the A738 note loop — an extra
     declaring sulphites, in Spanish (longest name, "Dióxido de azufre y sulfitos"), at 390 px, in
     light and dark, with the same edge checks the A738 case in
     `modifier-picker.note.test.ts:98-128` uses; it restores the screen language after itself
     (CLAUDE.md §4).
  Spanish wording is owned by `allergen-names.test.ts`, so no picker case checks "Leche"
  (change 2). `diet-badges.test.ts` gains an `addAllergens: {}` case drawing nothing, if it has
  none. No label check in `basket.line-details.test.ts` (change 3: it repeats case 2).
  Deletion controls: remove the call from `#renderPick` (case 1 fails) and, separately, from
  `#renderStepper` (case 2 fails); restore each.
- `modifier-picker.a11y.test.ts`: add a state where both extras declare allergens, checked by
  axe in light and dark, as the file's other states are.
- Run: `pnpm --filter @waitron/till exec vitest run src/widgets/modifier-picker` (all its files),
  and `src/widgets/diet-badges.test.ts`. Look at the
  window in both themes at phone width (CLAUDE.md §4): `till-counter-cleanup.look.test.ts:349-350`
  already captures it with a milk extra.

## Task 2 — words (same implementer)

- Guide, English `apps/server/src/guide/en/modifiers.md` `{#till}` and Spanish
  `apps/server/src/guide/es/modifiers.md` `{#till}`: split the sentence after "with a tick box
  each, or a stepper where you allowed more than one" and add: "Beside each entry are the
  allergens its product declares." (ES, which calls each entry "elemento": "Junto a cada elemento
  aparecen los alérgenos que declara su producto.") Run `apps/server/src/guide-content.test.ts`
  and `scripts/guide-links.test.ts`.
- `docs/backlog/catalogue.md` A1517: delete point 4 and correct the count of follow-ups left
  (line 1157); `docs/backlog.md` A1517 line: drop "label extras before selection". `docs/developers/design-system.md`: only if it describes the picker's
  rows (grep "modifier picker"); otherwise untouched.

## Size and path

About 20 production lines, 80 test lines. No risk trigger: light path (no per-task reviewer);
`/finish-branch` as usual.
