# A1517-3: every kitchen ticket prints each dish's allergens

**Outcome.** A cook working from paper sees what a dish declares without a guest first being
flagged. A sent burger that declares milk prints `Contains: Milk` beneath it on its station ticket,
and a selected white sauce that declares milk prints its own allergens beside the extra. Guest
allergy blocks stay as they are and stay the only thing that raises the ticket's allergy heading.

**Decision this builds.** Owner, 2026-11-11 22:01, "As recommended", decision 3 in
[the A1517 decision record](../specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11):
"Print each dish's live allergen declarations on every kitchen ticket, with selected extras
separately and guest instructions prominent. Keep the October decision against 'Not reviewed'
labels." Decision 6 keeps kitchen tickets on CURRENT declarations.

**Branch / worktree.** `feat/a1517-3-kitchen-ticket-allergens`,
`~/workspace/worktrees/waitron-feat-a1517-3-kitchen-ticket-allergens`.

## What the code does today (read, with sites)

- Every kitchen paper item is built by `buildTicketItems` (`apps/server/src/kitchen-print.ts:187`),
  used by station tickets, reprints and correction slips (callers at `:608`, `:1149`, `:1442`,
  `:1548`, `:2001`). It sets `item.allergy` only from the frozen guest block
  (`allergies.get(ticketItemId)?.originalBlock`, `:351`). Extras without their own ticket record
  become `modifiers` strings (`:316`); extras with one become `crossRefs` (`:298`).
- The formatter is `apps/server/src/kitchen-ticket.ts` (pure). `emitItem` (`:251`) prints the dish
  line, `+ modifier`, `> cross-ref`, `* note`, then the guest block (`emitAllergy`, `:206`).
  `emitAllergyHeading` (`:231`) prints `!!! ALLERGY ON THIS TICKET !!!` when any item has a guest
  block. `entryKey` (`:97`) decides which entries merge under `combined` grouping.
- The live, effective (variant-inherited) declaration of a line is `readLineNutrition`
  (`apps/server/src/line-nutrition.ts:16`); it returns NO entry for a product with no reviewed
  allergens (`allergens === null`) or an empty declaration, which is how "Not reviewed" stays off.
- The station screen draws the dish's own allergens as `Contains` + names
  (`apps/till/src/widgets/kitchen-board-parts.ts:250`) and each extra's own beside the extra
  (`extraNutrition`, `:270`).
- Paper allergen names come from `kitchenAllergenLabel` (`apps/server/src/i18n/kitchen-allergy.ts:56`),
  which adds kinds (`Nuts (Walnuts)`); the guest block already uses it.

## Choices (the most conservative reading of the decision)

1. **Dish line.** Beneath the dish, after its `+`, `>` and `*` lines and before the guest block:
   `  Contains: <labels>` (es `  Contiene: <labels>`), labels from `kitchenAllergenLabel` in the
   ticket's language, sorted by code as `canonicalAllergens` does, normal case (the guest block keeps
   its upper case and `***` markers, so it stays the louder of the two). A wrapped continuation lines
   up under the first allergen name (indent = the printed length of `  Contains: `).
2. **Extras.** A modifier extra with declarations prints `  + White sauce - contains Milk`
   (es `- contiene`), its own allergens only, never folded into the dish's line. Options
   (`optionSnapshotLabels`) carry no declaration and are unchanged. A cross-referenced extra made at
   another station prints its own `Contains` line on ITS station's ticket (it is an item there); the
   `> with ...` line on the dish's ticket is unchanged.
3. **Nothing for unknown or empty.** No line when `readLineNutrition` has no entry. No "Not
   reviewed", no "No allergens".
4. **Allergens only.** Dietary declarations (vegan and so on) are not printed: the decision names
   allergens.
5. **Live at print.** Read at build time with `readLineNutrition`, one query for the dishes and
   their extras together (never per line). A reprint and a correction slip read again, so they show
   the declaration as it is when printed (decision 6). The guest block keeps its frozen copy.
6. **Heading unchanged.** `!!! ALLERGY ON THIS TICKET !!!` still appears only for a guest block.
7. **Merging.** Entries that differ only in their declaration do not merge: the new field goes in
   `entryKey`.
8. **Where it shows.** Every place `buildTicketItems` feeds (plan read 2026-11-11 found no other
   builder of `KitchenTicketItem`): station and shared-printer tickets, reprints, HOLD/FIRE
   (`:608`), kitchen-note change slips (`:1149`), the folding of kitchen-screen notices (`:1442`;
   the merge key change applies there too), correction slips including VOID, RECALLED, TO STATION
   and EXTRA CANCELLED (`:1548`), and moved slips (`:2001`). The `Also on this order` list
   (`OtherStationItem`) is unchanged. The extra read runs whenever items are built, printer or not:
   one query.
9. **Cross-station extras.** The station screen also shows no allergens on a cross-reference line
   (`queue-crossrefs.ts`); paper matches it. The PR says so plainly so the owner can decide whether
   decision 3's "selected extras separately" should cover it.

## Task 1 — the formatter prints declarations (pure, `kitchen-ticket.ts`)

- `KitchenTicketItem` gains `contains?: string[]` (already-worded labels; absent or empty prints
  nothing). Modifiers stay `string[]`: Task 2 words an extra's suffix into its string.
- `KITCHEN_ALLERGY_WORDS` (`apps/server/src/i18n/kitchen-allergy.ts`) gains `contains`
  (`"Contains: {allergens}"` / `"Contiene: {allergens}"`) and `extraContains`
  (`"{extra} - contains {allergens}"` / `"{extra} - contiene {allergens}"`), plus an exported helper
  `extraWithAllergens(extra, labels, language)` Task 2 calls.
- `emitItem` prints the `contains` line after the note, before `emitAllergy`. `entryKey` includes
  `contains`.
- Tests first, in `apps/server/src/kitchen-ticket.allergy.test.ts` (existing file, its helpers).
  Failing first: EN and ES line text and position (after note, before the guest block); a label
  with kinds (`Nuts (Walnuts)`); a long list wraps with its continuation under the first name; two
  otherwise-identical entries with different `contains` do not merge under `combined`; the extra
  helper's EN/ES text. Guards (they pass before the change; say so in the case name or a one-line
  comment): absent and `[]` print no line; `contains` with no guest block prints NO allergy
  heading; identical entries still merge.
- Run: `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.allergy.test.ts
  src/kitchen-ticket.test.ts src/kitchen-ticket.paper.test.ts src/kitchen-ticket.language.test.ts`.

## Task 2a — tickets read the live declarations (`kitchen-print.ts`)

- In `buildTicketItems`, after the child rows are read, one `readLineNutrition(tx, [...lineIds,
  ...childIds])`. Dish item: `contains` = labels of its own entry. Modifier extra: its label passed
  through `extraWithAllergens` when the extra has an entry. Cross-ref extras: unchanged on the
  dish's ticket.
- Tests first, in `apps/server/src/kitchen-print.allergy.test.ts` (existing file and fixtures;
  search `src/testing/` before adding any helper), through the real send path and the queued print
  job's text:
  1. a dish declaring milk sent with NO guest allergy prints `Contains: Milk` and no allergy heading
     (fails today — the A1517 R2 finding);
  2. a dish with `allergens: null` prints no `Contains` line and no "Not reviewed";
  3. a modifier extra declaring milk on a dish declaring gluten prints the extra's suffix and the
     dish's own line names gluten only;
  4. a variant inheriting its parent's declaration prints the parent's allergens;
  5. edit the product's allergens after sending, reprint: the reprint shows the new declaration
     (live), while a guest block on the same dish keeps its original text;
  6. Spanish kitchen language prints `Contiene:` with Spanish names;
  7. the line also prints on a shared-printer ticket, on an ALLERGY CHANGED slip and on a moved
     slip (one case each, reusing those suites' setup);
  8. a dish checked and found free of allergens but labelled vegan (`allergens: {}`,
     `dietaryDeclarations: ["vegan"]`) prints no `Contains` line (the reader returns an entry for it;
     the printer must not print an empty line). Test 2 is a guard that passes before the change;
     mark it so.
- Run: `pnpm --filter @waitron/server exec vitest run src/kitchen-print.allergy.test.ts
  src/kitchen-print.test.ts src/kitchen-print.language.test.ts src/kitchen-print.shared-printers.test.ts
  src/kitchen-allergy` and report every failure in other files you meet; do not fix those here.

## Task 2b — existing ticket-text checks, guides, backlog

- Existing tests that pin whole ticket text for a product that declares allergens will now show the
  new line, and not only in the kitchen-print files (the plan read named `working-order.test.ts`,
  `tabs.test.ts`, `pass-release.test.ts`, `till-api.test.ts`, `party-table-actions.test.ts` among
  others). Run the whole `apps/server` suite once (`pnpm --filter @waitron/server test`), change each
  failing check that pins ticket text to expect the new line (spec-changed, owner rule 2026-10-05),
  and list every one, `file:line` before and after, for the PR's "Changed test checks". A failure
  that is not ticket text gaining the line is a STOP: report it, do not change it.
- Guides: `apps/server/src/guide/en/kitchen-service.md` and `es/` under `{#allergy-copies}`: one
  sentence that every dish on a printed ticket lists the allergens it declares, and each extra its
  own; and that no `Contains` line never means the dish is safe (fold it into the existing "Missing
  nutritional information..." sentence at `:39-40`, which already says check with the waiter).
  Rewrite `:43-44` ("Later guest or catalogue edits do not silently replace the original block"): the
  guest block keeps the copy the kitchen first received, while a dish's `Contains` line shows the
  dish as it is when the paper prints, a reprint included. Same in Spanish.
- Backlog: in `docs/backlog/catalogue.md` A1517 entry, delete point 2 (paper tickets) and renumber;
  keep the decision line. If `docs/backlog.md`'s A1517 line lists paper tickets as open, drop that
  phrase.
- Run: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the root,
  `pnpm exec vitest run scripts/guide-links.test.ts`; the RUNNER's fiscal gates
  (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`)
  unedited.

## Not in this item

Showing allergens on the `Also on this order` list or on cross-reference lines; dietary
declarations on paper; anything on screens (A1517-1, -2, -5, -6 are other items).
