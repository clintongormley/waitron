# A668 — Allergen information in the editor, at publishing and on the till

Date: 2026-10-14. Status: approved by the owner, 2026-10-15. How the till opens the info window and
the line window was redrawn the same day by A738 (see `docs/backlog/till.md`, "A738"); where the two
differ on the till, the owner's answer recorded below decides.
Companion spec: [A669 — an allergy at the table](2026-10-14-a669-allergy-at-the-table-design.md).

## Why

A manager records a dish's allergens in the product editor's "Nutritional info" section. Today that
section cannot say "I checked, and this dish contains none of the 14": a dish with nothing ticked
stays "not reviewed" for ever, and the editor shows "not reviewed" and "reviewed, none" with the same
words. On the till, the only way to see a dish's allergens is a separate Allergens screen that, in the
owner's words, "nobody will use".

What exists today (read on `main` at c75800ed7, not run unless said):

- A product's published allergens (`products.allergens`, `packages/db/src/schema/catalogue.ts:92-102`)
  are `null` for "never reviewed", `{}` for "reviewed, contains none", or a map from allergen code to
  `{ presence: "contains" | "may_contain"; source?: string }` (`AllergenMap`, `catalogue.ts:10`;
  `validateAllergens`, `packages/catalogue/src/allergens.ts:39-55`). What staff declared is kept in
  `manualAllergens`; a parked recipe path (`recipeDerivation`, `derivation.ts:16-57`) can add to it.
  No dashboard screen reaches the recipe path any more: #345 removed its route.
- A new product starts with `allergens: null` (`apps/dashboard/src/widgets/product-editor.ts:211`;
  `saveProductEditor`, `packages/catalogue/src/product-editor.ts:185`).
- **A defect:** the picker sends one change event for allergens and diet together, and the editor
  rewrites `allergens` on every one (`product-editor.ts:1350-1365`). So on a product nobody has
  reviewed, ticking only a diet label records the dish as "reviewed, contains none". Read, not run;
  the first task proves it with a failing test.
- The closed and open section both show `null` and `{}` as "None specified"
  (`modifiers.none_specified`; `foldedValue`, `product-editor.ts:1069-1073`). On a variant's page an
  empty line reads "None specified" above a grey hint giving the parent's values (`nutritionHints`,
  `:1275-1304`). The picker (`apps/dashboard/src/widgets/allergen-dietary-picker.ts:121-184`)
  prints its own "Allergens: …" summary inside the section that already summarises it.
- The product editor cannot show or set "may contain"; a new tick is written as `contains`
  (`:1351-1356`). The editor's save drops `source` (`product-editor-input.ts:179-188`).
- Diet labels: vegan, vegetarian, halal, kosher, no meat, no fish. Vegan implies vegetarian, and
  vegetarian implies no meat and no fish (`expandDietaryDeclarations`,
  `packages/catalogue/src/dietary-declarations.ts:27-35`); the editor no longer shows the implied
  ones.
- The Products list shows Pending / None / Declared (`allergenState`,
  `apps/dashboard/src/i18n/domain.ts:196-199`) and leaves a variant's cell blank, because
  `ListedVariant` (`packages/catalogue/src/product-types.ts:75-81`) carries no allergens.
- Publishing a menu already has a warnings dialog (`MenuPreview.warnings`,
  `packages/catalogue/src/menu-document-types.ts:288-298`; the confirmation in
  `apps/dashboard/src/widgets/menu-preview.ts:852-881`). Scheduled publishing
  (`menu-publications.ts:796-800` → `queueMenuPublication`) shows no warnings at all.
- The till's Allergens screen (`apps/till/src/screens/till-allergen-screen.ts`) is a product ×
  allergen table with a detail window and a print button, opened from the tab bar
  (`widgets/tab-shell.ts:471`) and the counter screen's own header (`till-counter-screen.ts:389-395`).
- Product buttons (`#productButton`, `apps/till/src/widgets/menu-browser.ts:563-584`, the same
  component on till and handheld) show no allergen or diet information. The basket draws an
  "As served" chips row (`#allergenRow`, `apps/till/src/widgets/basket.ts:824-850`); sent lines on
  the table order screen show none. The kitchen screens show a "not reviewed" warning on a dish
  nobody has reviewed (`station-queue.ts:1150-1173`, `till-expo-screen.ts:1069-1090`).
- The till has no long-press handling; a shared recogniser exists (`Gestures`,
  `packages/ui/src/gestures.ts`, 500 ms), used only by the floor map.

## What the owner said (2026-10-14)

> "today we mark products as not reviewed if they have no nutritional items ticked, but there is
> nothing to say 'reviewed, nothing chosen'"

> "This page on the till is useless. nobody will use it. instead an inspector can look at it on the
> printed or online menu." … "delete completely"

> "the till / handheld product buttons can have a single icon which represents nutritional info.
> double clicking or long pressing can open an info modal with the details … icons can appear after
> the product name in the order list, double clicking or long pressing there should also open the
> info modal"

> "unspecified allergens should be warned about before publishing a menu, not on the menu itself"

## Decisions (owner, 2026-10-14)

1. **"Contains none of the 14" is an explicit choice** in the allergen picker. Ticking it clears
   the allergens; ticking an allergen clears it. A dish stays "not reviewed" until one or the other
   is chosen.
2. **"May contain" goes.** Each allergen is one tick; ticked means contains. (The EU leaves
   precautionary "may contain" wording voluntary: see _Sources_.)
3. **Gluten and nuts say which.** Ticking Gluten asks which cereals (wheat, rye, barley, oats,
   spelt, kamut); ticking Nuts asks which nuts (almonds, hazelnuts, walnuts, cashews, pecans,
   Brazil nuts, pistachios, macadamia). Shown as "Gluten (wheat, barley)".
4. **Unreviewed dishes are warned about when a menu is published**, now or scheduled, and the
   publish still goes ahead (warn, never block). Each dish named in the warning links to its
   product page.
5. **The till's Allergens screen is deleted**, with its button, its print path and its strings.
6. **Product buttons carry one "i" icon**, only when the dish has at least one allergen or diet
   label ticked (not for "contains none", not for an unreviewed dish). **A long press** opens an
   info window; no double tap, because a tap adds the dish.
7. **The order list shows allergen icons after the dish name**, on unsent and sent lines; a long
   press opens the same window.
8. **The kitchen screens' "not reviewed" warning goes.**
9. **Icons are Erudus's** (MIT), with the gaps filled as set out under _Icons_.
10. **Accepted from my proposals without change:** one wording for each state; a variant using its
    parent's values shows them in italic; the open section has no second summary; implied diets
    are shown; the Products list shows a variant's allergens.

## Mockups

In [docs/backlog/mockups/a668-allergen-icons/](../../backlog/mockups/a668-allergen-icons/):
1 and 2 compare the candidate icon sets at full size and at 16 px; 3 shows the editor, the closed
line's states, the product buttons, the info window, the order list, the publish warning, the
Products list, and the cereal/nut choice (option B chosen). Where a board and this text differ, this
text wins.

## Words

- **Not reviewed** — `allergens === null`. Editor: "Not yet reviewed", in the warning colour.
  Products list badge and filter: "Not reviewed" (today "Pending").
- **None** — `allergens` is `{}`: someone ticked "Contains none of the 14".
- **Same as the parent** — a variant whose own allergens are `null`.
- **Kinds** — the specific cereals of Gluten and the specific nuts of Nuts.

Spanish strings for every new or changed English string need the owner's wording.

## What it stores

`AllergenMap` becomes a map from allergen code to `{ kinds?: Kind[] }`:

- `presence` and `source` are removed from the type, the validator, the database JSON, the
  derivation merge and every reader (the till types, `working_line_contexts.allergens`,
  `ZoneMenuOffer.allergens`, the frozen menu documents, the demo scripts and fixtures). Before
  go-live venues are reset, so no stored value is converted (CLAUDE.md §3).
- `kinds` is required and non-empty for `gluten` and `nuts`, and refused for every other code.
  The validator refuses a missing or empty list with a new code, `allergen.kinds_required`, naming
  the allergen, and an unknown kind or a kind on another code with `allergen.invalid_kind`. Both
  join `packages/catalogue/src/errors.ts` and the dashboard shows them beside the picker.
- The parked recipe derivation unions codes and, for gluten and nuts, unions kinds. The ingredient
  form keeps compiling against the new shape; its contains/may-contain control goes. Nothing more
  is done to the parked recipe screens.
- The meaning of `null` and `{}` is unchanged. **The editor writes `allergens` only when the
  manager changes an allergen** — never because a diet label changed.

## The product editor

The section keeps its name, "Nutritional info", and its place (A647 restyles every section; see
_Order of work_).

- **Open:** the picker shows its choices directly, with no summary line of its own. First the
  dashed "Contains none of the 14" chip, then the 14 allergen chips with their icons. A ticked
  Gluten or Nuts shows its kinds beneath it as a row of chips, indented; until one is ticked the
  field shows the form's error beside it ("Choose which cereals", "Choose which nuts") and Save is
  refused, following the shared form contract in `design-system.md` → Forms. Below, the diet
  chips; a label implied by another is drawn ticked in the quiet style with "· from Vegan" and
  cannot be unticked on its own.
- **On a variant's page** a third choice leads the allergen chips: "Same as {parent}", selected
  while the variant's own value is `null`. The parent's values are then shown in italic in the
  chips (read-only). Ticking anything else gives the variant its own list, which replaces the
  parent's — it never adds to it. The grey hints under the section go.
- **Closed summary:** "Allergens: Not yet reviewed · Dietary: None", "Allergens: None · …",
  "Allergens: Gluten (wheat), Eggs, Milk · …", or the parent's values in italic. Implied diets are
  listed in italic after the chosen ones.
- `editor.allergens_none`, `editor.diet_none` and the variant hints are retired;
  `modifiers.none_specified` stays only where other screens use it (the plan greps for them).

## The Products list

- The badge and filter read Not reviewed / None / Declared.
- A variant row shows its effective allergens: its own, or its parent's in italic. `ListedVariant`
  gains the effective allergens (and whether they are the parent's) from the server read that
  builds the list (`listedVariantsOfProducts`, `packages/catalogue/src/operations.ts`).

## Publishing

- `MenuPreview.warnings` gains a kind, `allergens_unreviewed`, listing each offered product and
  each active variant whose effective allergens are `null`, with its id, its staff name and, for a
  variant, its parent's name. `previewMenu` builds it beside the two existing kinds.
- The Publish confirmation and the warnings section list those names; each name links to that
  product's page in the catalogue (the variant's own page for a variant). Publish stays enabled.
- **Scheduled publishing shows the same confirmation** before it queues a publication, using the
  same preview warnings. Its server route does not refuse on warnings, as the immediate one does not.

## The till

- **The Allergens screen goes:** `till-allergen-screen.ts` and its two test files, the
  `"allergens"` destination (`navigation.ts:15,18`), its drill handling in `till-app.ts`, the
  tab-bar button and `BarItem`/`LEAVE_ORDER` entries (`tab-shell.ts:30,39,471`), the counter
  screen's `showAllergens` and header button, and the strings only it uses (`allergens.open`,
  `title`, `notice`, `pending`, `may_contain`, `print`, `close`). The strings other screens still
  read stay. The developer and operator docs that describe the screen
  (`docs/developers/products.md`, `docs/developers/design-system.md`, `docs/products.md`) are
  updated in the same change; the plan lists the lines (the operator guide's "printed allergen
  sheet" at `docs/products.md:30` is one).
- **Product buttons:** `#productButton` draws the "i" in the top trailing corner when the dish's
  allergens hold at least one code or its diet holds at least one label. The name keeps room for
  it. A long press (the shared `Gestures` recogniser) opens the info window; a tap still adds the
  dish, and a long press never adds it.
- **Info window:** the dish's name; "Contains" with one row per allergen — icon and name, kinds in
  brackets; "Dietary" with the labels; for an unreviewed dish, "Allergens not yet reviewed" in the
  warning colour; one Close button. It opens for every dish, "i" or not, so a long press on an
  unreviewed dish tells staff rather than leaving them guessing (my addition, shown on board 3 and
  not objected to). It reads the till's product data; nothing new comes from the server.
- **Order list:** on the counter basket and on both the unsent and sent lines of the table order
  screen, the line's as-served allergens (the dish plus its extras, as `asServedAllergens` computes
  them today) are drawn as icons after the name, followed by its diet labels as icons. A long press
  on the line opens the same window. The "As served" row and `#dietRow` go. A line whose dish is
  unreviewed shows no icons.
- **Kitchen screens:** the "not reviewed" span in `station-queue.ts` and `till-expo-screen.ts`
  goes; their allergen chips are otherwise unchanged by this work.

## Icons

- **Allergens:** the Erudus set (github.com/Erudus/erudus-icons, MIT). Sulphites (`so2`) and lupin
  are redrawn, because at 16 px they do not read (board 2). The circled variants, `vegan`,
  `circle-vegan`, `circle-kosher` and `coeliac` are not used: they resemble registered marks.
- **Diet:** `halal` and plain `kosher` from Erudus; no meat and no fish from Pictogrammers'
  `meat-off` and `fish-off` (Apache-2.0); vegan and vegetarian drawn for Waitron, avoiding a V
  with a leaf (V-Label's registered mark).
- **The "i":** Material Symbols `info` (Apache-2.0), as the dashboard's other icons are.
- The SVG paths live once in `packages/ui`, registered through `registerIcons` by both apps, with a
  one-line source note at the module. Their notices join `deploy/third-party/README.md` (MIT
  copyright and permission notice for Erudus; Apache-2.0 for Pictogrammers), which ships to
  `/app/third-party/` (CLAUDE.md §3: a change adding third-party code carries its notices).
- If the icons are drawn by a new shared primitive (one `wt-allergen-icon` taking a code), it needs
  the two tests a new `wt-*` primitive needs: a token-painting test and an axe test in both themes.

## Menus customers read

Printed menus (A670) and the online menu (A509) show the same icons after each dish name, and a
key on the page naming each icon, because the regulation wants words, with symbols only in
addition (see _Sources_). Neither exists yet; this spec only records the requirement in their
backlog entries.

## Sources

- Regulation (EU) 1169/2011, Article 9(2): "The particulars … shall be indicated with words and
  numbers. Without prejudice to Article 35, they may additionally be expressed by means of
  pictograms or symbols." Annex II: "Cereals containing gluten, namely: wheat, rye, barley, oats,
  spelt, kamut …"; "Nuts, namely: almonds, hazelnuts, walnuts, cashews, pecan nuts, Brazil nuts,
  pistachio nuts, macadamia or Queensland nuts". Article 21(1): without an ingredients list, "the
  word 'contains' followed by the name of the substance or product as listed in Annex II".
  Fetched 2026-10-14 from legislation.gov.uk (the 2011 text).
- The EU's answer to Codex CCFL circular CL 2018/24, Annex 2 (supplied by the owner, 2026-10-14),
  p. 5: "mentioning the collective terms such as 'cereals containing gluten' or 'tree nuts' in an
  allergen declaration would not be an appropriate and efficient way to inform and protect
  hypersensitive consumers … their specific type in question (almonds, walnuts or wheat, oats) needs
  to be declared as an allergen." p. 7: information on unintentional presence ("may contain") "may
  be provided voluntarily by the food business operator."
- Real Decreto 126/2015, Article 6.5(a)(2.º): oral allergen information is allowed when "la
  información se registre de forma escrita o electrónica en el establecimiento … y sea fácilmente
  accesible tanto para el personal del establecimiento como para las autoridades de control y los
  consumidores que la soliciten." Fetched 2026-10-14 from boe.es. The owner's answer is the printed
  and online menu (A670, A509); until one exists Waitron produces no such written record, which
  does not matter before go-live.
- Icon licences, quoted and fetched 2026-10-14: Erudus `LICENSE` (MIT); Pictogrammers `LICENSE`
  (Apache-2.0); Material Symbols README (Apache-2.0); V-Label style guide (its trademark claim).
  URLs and quotes are in this session's research note, summarised on board 1.

## Order of work and collisions

A647 (tidy the product editor) restyles the same file, `product-editor.ts`. The editor part of this
work goes after A647 lands, or in the same lane straight after it. Suggested slices, each one
implementer's size:

1. The data shape: `kinds`, `presence`/`source` removed, the validator and its codes, the
   derivation, every reader and fixture.
2. The editor: the diet-edit defect (failing test first), the picker, the variant's "Same as"
   choice, the summaries, implied diets.
3. The Products list's wording and variant cells; the publish warning on both paths with links.
4. The icon set in `packages/ui` with its notices.
5. The till: delete the Allergens screen; the "i", the long press and the info window; the order
   list's icons; the kitchen screens' warning removed.

## Testing

- The diet-edit defect: a failing case first — a product with `allergens: null`, tick a diet
  label, save, and assert the saved allergens are still `null`.
- The validator: Gluten without kinds, Nuts with an unknown kind, Milk with a kind; each asserts its
  error code, not just that it threw.
- The editor: the four closed-line states; "Contains none" and an allergen exclude each other; a
  variant's "Same as" saves `null`; implied diets cannot be unticked. The editor's existing
  `*.unsaved.test.ts` keeps passing.
- Publishing: `allergens_unreviewed` lists an unreviewed product and an unreviewed active variant,
  and not a reviewed one; the scheduled path opens the same confirmation; each name links to its
  page.
- The till: the "i" appears for one allergen, for one diet label, and not for `{}` or `null`; a long
  press opens the window and adds nothing, a tap adds and opens nothing (tested with
  `userEvent`, which runs the gesture's timers as a real press does); the order list draws icons
  on sent and unsent lines. Deleting the screen leaves no route to `till-view=allergens`.
- Fixtures give a dish, a variant and an extra three different allergen sets, so a test passes only
  if the right one is read.

## Out of scope

- The online menu (A509) and printed menus (A670), beyond recording the requirement.
- Showing the kitchen screens' allergen chips as icons.
- The parked recipe and ingredient screens, beyond keeping them compiling.
- The allergy question at Send and the kitchen signal: A669.

## Open points

- The Spanish wording for every new string, and for "Not reviewed" on the Products list.
- Whether the order list's diet icons are wanted beside the allergen icons (assumed yes here).
