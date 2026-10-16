# A668 slice 2: Product allergen editor implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, task by task, with TDD. The approved spec and campaign authorize execution; do not request another design approval or dispatch per-task agents. This document's author only writes this plan.

**Goal:** Let managers explicitly review allergens, choose cereal/nut kinds and inspect variant inheritance without a diet edit changing allergen review status.

**Architecture:** First pin and fix the diet-only save defect through the existing picker. Then replace only the product editor's picker with a dedicated app widget, using separate allergen and dietary change events. Keep unfinished allergen choices in the editor draft, and use the disclosure's existing summary slot for mixed normal/italic text.

**Tech stack:** TypeScript, Lit, existing `wt-*` controls and registered nutrition icons; Vitest browser mode with real Playwright Chromium and axe.

**Spec:** `docs/superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md`, approved 2026-10-15, slice 2 only. Read it in full with `CLAUDE.md` before execution.

## Global constraints

- Work in `/Users/clintongormley/workspace/worktrees/waitron-feat-a668-2-allergen-editor`. Product scope excludes fiscal changes, guard changes, migrations or compatibility conversion.
- Slice 1's `{ kinds?: Kind[] }` shape and A668-4's `NUTRITION_ICONS` already exist here. Consume them; do not duplicate SVG paths or introduce a new shared primitive.
- `null` remains unreviewed on a product and inherited on a variant; `{}` remains explicitly reviewed with none. An untouched field keeps its exact own value, including dietary `null` versus `[]`.
- “Contains none of the 14” explicitly writes `{}`. Choosing an allergen replaces None; choosing None clears all codes/kinds. Removing the final allergen without choosing None returns to `null`.
- Gluten kinds: `wheat`, `rye`, `barley`, `oats`, `spelt`, `kamut`. Nuts: `almonds`, `hazelnuts`, `walnuts`, `cashews`, `pecans`, `brazil_nuts`, `pistachios`, `macadamia`. Never preselect a kind.
- Each own variant allergen list replaces the parent's list; never merge codes or kinds with the inherited preview. “Same as {parent}” writes `null`.
- Keep `draftScopeFor`, `saveActionState`, the unchanged-save early return, exact submitted-snapshot commits and existing unsaved protections. Request refusals alone never disable retry.
- All chrome reads declared `--wt-*` tokens. Use semantic control names, visible tick states, accessible names, native keyboard activation and stopped source events before redispatch.
- Lane F owns Products list states/variant cells and publishing warnings. Do not edit their functions/strings, `product-list.ts`, publishing widgets, catalogue list readers or `i18n/domain.ts`; reuse existing name helpers read-only.
- Spanish wording for every new/changed string requires the owner's answer before landing. The inventory below is a proposal, not approval; do not silently promote an earlier machine translation to owner wording.
- Run focused behavior checks locally. The later branch finisher runs one Claude whole-branch run-it review after its initial rebase, the normal hook and current-head CI. No per-task reviews or duplicated whole-workspace suite.

## Read map and consumer boundary

- UI contract: `docs/developers/conventions-ui.md:10-100,583-643,887-977`; forms/save state in `design-system.md:1956-2025,2130-2180`; inheritance/folds/picker in `:2652-2875`; Chromium/axe in `:3384-3458`.
- Product contract: `docs/developers/products.md:11-81,484-534,707-761,785-861`; testing: `testing-guide.md:1055-1088,1117-1154,1163-1184,1213-1244,1294-1330,1727-1734`; claims: `writing-claims.md`.
- Current bug path: `product-editor.ts:1393-1422` receives both arrays and rewrites both fields; `allergen-choices.ts:20-42` flattens `null` to `[]` and rebuilds `[]` as `{}`. This is read evidence; Task 1 must reproduce it.
- `allergen-dietary-picker.ts` has one production consumer, `product-editor.ts`. Preserve its default `{ allergens: string[]; dietary: DietaryLabel[] }` value and `wt-change.detail.value` payload and all existing standalone tests.
- `ingredient-form.ts:319-332` uses `dietary-origin-picker.ts` and `allergen-picker.ts`, not the combined widget. Its `wt-allergens-change`, explicit Reviewed switch, add/remove/search dialog and origin semantics stay unchanged.
- `allergen-choices.ts` also serves the ingredient picker and ingredient draft comparison (`ingredient-form.ts:180-181`). Leave its exports/behavior unchanged; editor-only incomplete choices must bypass its lossy rebuild.
- `extra-list-form.ts` chooses products and portions; `option-list-form.ts` owns `option-label-form.ts`. None currently imports either allergen picker. Preserve their request shapes, four-label modifier suitability contract and save/unsaved behavior; do not add product review chips there.
- Before changing integration, repeat `rg -n 'allergen-dietary-picker|dashboard-allergen-picker|allergenChoices\(|allergensFromChoices\(|allergensForComparison' apps packages --glob '!*.test.ts'`. Read any new consumer; do not assume this inventory survives concurrent work.

## File map and interfaces

- Modify `apps/dashboard/src/widgets/product-editor.ts`: field-specific updates, local validation/focus, dedicated picker integration and closed summary. No server body/type changes.
- Create `apps/dashboard/src/widgets/product-nutrition.ts` with these editor-only interfaces; import `AllergenDeclaration` from `../api/client.js`, `DietaryLabel` from catalogue and `InheritedValues` from catalogue product types.
  - `NutritionValue = Pick<ProductEditorDraft, "allergens" | "dietaryDeclarations">`.
  - `NutritionChange = { field: "allergens"; value: AllergenDeclaration } | { field: "dietaryDeclarations"; value: DietaryLabel[] | null }`.
  - `applyNutritionChange(draft: ProductEditorDraft, change: NutritionChange): ProductEditorDraft`: return a copied draft changing only the named field; clone nested arrays, never copy parent values.
  - `nutritionAllergensForComparison(value: AllergenDeclaration): AllergenDeclaration`: copy and sort kind memberships without dropping codes with missing/empty kinds; preserve `null`, `{}` and invalid drafts distinctly.
  - `nutritionErrors(value: AllergenDeclaration): Record<string, string>`: validate each own entry through `validateAllergens`; map missing kinds to `allergens-gluten`/`allergens-nuts`, other invalid data to `allergens`, using existing localized refusal text. Return all missing-kind errors, not only the first.
  - `nutritionAllergenLabel(code: string, entry?: { kinds?: readonly string[] }): string`: use editor-owned “Gluten” for `gluten`, existing `allergenName` otherwise, and append localized kind names in parentheses. Do not rename the shared “Cereals containing gluten” label in `domain.ts`.
  - `dietaryPresentation(own: DietaryLabel[] | null, parent: readonly DietaryLabel[]): { chosen: DietaryLabel[]; implied: { label: DietaryLabel; from: DietaryLabel }[]; inherited: boolean }`: expand with `expandDietaryDeclarations`; preserve explicit choices; list extra implied labels in canonical order with Vegan as the transitive source where applicable.
- Create `apps/dashboard/src/widgets/product-nutrition-picker.ts`, tag `dashboard-product-nutrition-picker`, app-owned Lit widget.
  - Properties: `value: NutritionValue`, `inherited: InheritedValues | null`, `busy: boolean`, `errors: Record<string,string>`; no hidden second draft or scope. Parent passes updated values after each event.
  - Event: `wt-nutrition-change`, `detail: NutritionChange`, bubbling/composed, exactly once per edit. Allergen handlers never emit dietary values and vice versa; busy/inherited/implied read-only controls emit nothing.
  - `focusField(field: string): void` delegates to the named first offending chip (`allergens`, `allergens-gluten`, `allergens-nuts`); associate error text with the actual focusable control/group.
- Create `product-nutrition.test.ts`, `product-nutrition-picker.test.ts`, `product-nutrition-picker.a11y.test.ts` beside those files. Modify existing `product-editor{,.save-state,.unsaved,.a11y}.test.ts` only as inventoried below.
- Modify only editor-owned entries of `apps/dashboard/src/i18n/strings.ts`. Reuse `allergenName`, `allergenKindName` and `allergenRefusalText` without editing their modules.
- Later documentation edits are restricted to editor paragraphs in `docs/developers/design-system.md` and `docs/developers/products.md`, plus the stale nutrition-refusal paragraph in `conventions-ui.md:84-87`. Preserve the historical receipts and all till/list/publishing paragraphs.

## Review focus

1. Diet-only edits from `null`, `{}` and a specific kind map must retain allergens; allergen-only edits must retain dietary `null`, `[]` and explicit choices (Tasks 1, 3).
2. An incomplete Gluten choice from saved `{}` must become dirty and remain visible through collapse/reopen, rather than comparing equal to `{}` (Tasks 2, 3).
3. A variant's own wheat/walnut set must not absorb its parent's barley/almond set; Same as must restore inherited display without storing it (Task 3).
4. Explicit vegetarian plus vegan must survive removing vegan, while labels only implied by vegan must disappear; display expansion must never author declarations (Task 4).
5. Refusal/retry, late completion, reset and reconnect must retain the correct own values and baseline; disabled chips must resist handler-level activation (Tasks 3, 5).

## Task 1: First reproduce the exact diet-only save defect

**Files:** `product-editor.test.ts`, then `product-editor.ts`; current compact picker stays intact.
**Interface:** Current `wt-change.detail.value: { allergens: string[]; dietary: DietaryLabel[] }` remains unchanged.

- [x] Add `it("keeps unreviewed allergens null when only a dietary label is saved")` as the first implementation action. Mount `{ ...product, id: "coffee", allergens: null, dietaryDeclarations: [] }` with units and tax choices; open Nutrition, click its dietary line, open the real combobox and click Vegan with `userEvent`; click Save and assert one `wt-submit`, `value.allergens === null` and `value.dietaryDeclarations` equals `["vegan"]`.
- [x] Run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-editor.test.ts -t 'keeps unreviewed allergens null when only a dietary label is saved' --reporter=dot`. Record the failing assertion: expected `null`, received `{}`. A startup error or no Tests count is not the required red result.
- [x] Make the minimal current-handler fix: compare each incoming field's memberships to that field's current picker projection; only convert/assign a field whose choices changed. Keep untouched own values, and dismiss an allergen refusal only after an allergen change. Do not change empty-variant behavior yet.
- [x] Run the same command to green. Add companion cases for allergens `{}` and `{ gluten: { kinds: ["wheat", "barley"] }, nuts: { kinds: ["walnuts"] } }`, plus allergen-only edits preserving variant dietary `null` and explicit diets. Reproduce any additional defect red before fixing it; keep already-passing companions as regression coverage.
- [x] Run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-editor.test.ts src/widgets/product-editor.save-state.test.ts src/widgets/product-editor.unsaved.test.ts --reporter=dot`; retain assertion results as the baseline for replacing the picker.

## Task 2: Build the editor-only chip widget and retain incomplete drafts

**Files:** New `product-nutrition.ts`, `product-nutrition-picker.ts` and their behavioral tests.
**Interfaces:** Produce the model/widget interfaces above; leave the current compact picker and shared converters unchanged.

- [x] Add failing model cases named `preserves incomplete allergen codes in comparisons`, `updates only the changed nutrition field`, and `copies kind arrays`. Assert `null !== {}`, `{ gluten: {} } !== {}`, `{ gluten: { kinds: [] } } !== {}`, reversed valid kind order compares equal, and changing a returned array leaves the input intact.
- [x] Run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-nutrition.test.ts --reporter=dot`; observe the intended missing implementation failures, then implement those interfaces minimally and rerun to green.
- [x] Add failing widget cases for initially unreviewed, explicit None, one allergen, all 14 icon names, and both kind rows. Assert no None selection for `null`; None writes `{}`; Milk writes `{ milk: {} }`; selecting None clears Milk/kinds; unticking None or the last own allergen writes `null`.
- [x] Assert selecting Gluten initially emits `{ gluten: {} }`, displays an indented six-kind row with zero selected, then wheat/barley emits exactly those kinds. Nuts offers the eight exact kinds above. Turning a code off removes its kinds; turning it on again requires a fresh choice, with no default or inherited kind copied.
- [x] Assert a single `wt-nutrition-change` carrying only the edited field, no leaked source events, no summary line inside the open widget, and no mutation of input objects. Use app-owned native `<button type="button">` chips with `aria-pressed`, decorative `wt-icon` names `allergen-${code}`/`diet-${label}`, visible ticks and semantic names; use token CSS for dashed None, indentation and focus. `wt-button` does not forward `aria-pressed` to its inner button (`ui-core/src/components/wt-button.ts:138-168`); do not change that shared component for this slice.
- [x] Test native Enter/Space activation without an unintended Save; keep `submitOnEnter` unchanged, since it admits only single-line native inputs (`packages/ui-core/src/submit-on-enter.ts:20-36`). Expose inherited/implied values as read-only ticked content or disabled buttons with their names, not a host-only pressed state.
- [x] Run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-nutrition-picker.test.ts --reporter=dot` red, implement the controlled widget, rerun green. Busy gates both rendered controls and mutation handlers.

## Task 3: Integrate own/inherited values and form validation

**Files:** `product-editor.ts`, model/widget files, `product-editor.test.ts`, `product-editor.save-state.test.ts`.
**Interfaces:** Consume `NutritionChange`; call `applyNutritionChange` and notify the existing draft scope once. Replace the temporary Task 1 projection-difference handler.

- [x] Before integration, add failing editor cases for choosing None on a variant, Same as after an override, and a diet-only edit while allergens inherit. Give parent `{ gluten: { kinds: ["barley"] }, nuts: { kinds: ["almonds"] } }` and own `{ gluten: { kinds: ["wheat"] }, nuts: { kinds: ["walnuts"] } }`; saved own values must equal the latter exactly, never their union.
- [x] Test Same as with each parent value: `null`, `{}`, specific kinds. It is selected only for own `null`; inherited values/status appear italic and read-only. None saves `{}` even on a variant. An editable alternative starts a fresh own list, never copies the parent. Read-only inherited chips cannot emit or alter kinds; selecting None permits choosing an own version of an inherited code.
- [x] Add failing validation cases for missing Gluten and Nuts kinds simultaneously, unknown nut, and a kind on Milk. `nutritionErrors` must return the respective field keys and localized messages using slice 1's `allergen.kinds_required`/`allergen.invalid_kind`; do not invent a server `params.field`.
- [x] Assert first Save attempt on an incomplete draft submits nothing, opens Nutrition, marks both bad kind groups, focuses the first, and shows only `form.fix_fields` above the buttons. Save remains primary/disabled after that attempt until fixed; fixing both removes messages and enables it. Before the first attempt, keep the shared form's quiet-error policy.
- [x] Run the new cases with `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-editor.test.ts src/widgets/product-nutrition.test.ts -t 'nutrition|allergen|kinds|Same as' --reporter=dot` and record red before implementation.
- [x] Integrate `dashboard-product-nutrition-picker` with draft own values, `this.inherited`, suspension and field messages. Add all nutrition keys to `shownFields`/`SECTION_FIELDS` and route first-error focus through `focusField`. Merge `nutritionErrors` into `validate`; keep server-only refusal retry enabled and dismiss allergen errors only on allergen changes.
- [x] Use `nutritionAllergensForComparison` at every editor comparison site: `comparisonValue` and both sides of `renderVariants`' Open gate (`product-editor.ts:941,1662-1663`). Do not alter ingredient comparison. Assert incomplete Gluten from `{}` enables Save and blocks variant Open; reverting to the saved state restores quiet Save/Open. Reordered kind membership remains clean.
- [x] Migrate Task 1's test to real dietary chips, keeping its exact submitted-value assertions. Migrate existing editor synthetic picker edits to field-specific events; split an old event that edited both fields into two intentional edits. Assert allergen edits retain dietary inheritance, including own `[]`; diet edits retain every allergen state.
- [x] Rerun the full Task 1 command plus both new behavioral files to green. Retain existing screen tests for real server kind refusals in `screens/catalogue-screen.test.ts:3793` unchanged; they already map both codes to `allergens` through `#rejectedField`.

## Task 4: Show implied diets, closed summaries and exact copy

**Files:** Model/widget/editor files and tests; editor-owned `i18n/strings.ts` entries; editor documentation paragraphs.
**Interfaces:** `dietaryPresentation` supplies chosen/implied/inherited display only; stored `dietaryDeclarations` is never expanded for saving.

- [x] Add failing cases: Vegan displays Vegetarian, No meat and No fish ticked, quiet, noneditable, with `· from Vegan`; Vegetarian implies only No meat/No fish. Explicit choices stay editable even if another chosen label implies them; Vegan+Vegetarian followed by removing Vegan retains explicit Vegetarian and its implications. Removing the last own diet saves `[]` on a product and `null` on a variant, preserving existing behavior.
- [x] Assert opening an inheriting variant displays parent dietary values in italic without writing them; an actual diet action authors only its own chosen list. Allergen actions cannot change this. Assert read-only implied ticks in the rendered controls, not only host properties.
- [x] Add the four closed summary cases: `Allergens: Not yet reviewed · Dietary: None`; `Allergens: None · Dietary: None`; `Allergens: Gluten (Wheat), Eggs, Milk · Dietary: …`; inherited parent values in italic. Use existing localized kind names/case, not hand-built English lowercase labels. Show chosen diets first and extra implied diets in italic after them.
- [x] Run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-nutrition.test.ts src/widgets/product-nutrition-picker.test.ts src/widgets/product-editor.test.ts -t 'diet|nutrition|fold|allergen' --reporter=dot` red. Implement `dietaryPresentation`, render open diet chips and use `<span slot="summary">` within the nutrition disclosure for labels, warning-colored unreviewed status and italic spans. `SummaryField.value` is string-only (`wt-disclosure.ts:8-12`); do not widen that shared interface or use unsafe HTML.
- [x] Remove `nutritionHints()` and its CSS; remove `editor.allergens_none` and `editor.diet_none` only after `rg -n 'editor\.allergens_none|editor\.diet_none|allergens-hint|dietary-hint|modifiers\.none_specified' apps packages docs` inventories all readers. Retain `editor.allergens_unreviewed` and every unrelated `modifiers.none_specified` consumer.
- [x] Update only the editor contract in `design-system.md:2724-2740,2775-2790,2870-2875` and `products.md:787-800`; describe explicit None/Same as, direct chips, implied labels and summaries. Narrow `conventions-ui.md:84-87` to account for the existing kind-code mapping without asserting all nutrition refusals name a field. Keep older dated specs/plans historical.
- [x] Rerun Task 3's complete focused files to green. Record the assertion replacements using the ledger below; no unrelated assertion may be weakened to make the new widget pass.

## Copy inventory: owner Spanish wording pending

| Editor key / source | Exact English | Proposed Spanish, unapproved |
| --- | --- | --- |
| `editor.nutrition.contains_none` (new) | Contains none of the 14 | No contiene ninguno de los 14 |
| `editor.nutrition.same_as` (new) | Same as {parent} | Igual que {parent} |
| `editor.nutrition.dietary` (new summary/group label) | Dietary | Dietética |
| `editor.nutrition.from` (new suffix) | · from {label} | · por {label} |
| `editor.nutrition.allergens_none` (replaces retired key) | None | Ninguno |
| `editor.nutrition.diet_none` (replaces retired key) | None | Ninguna |
| `editor.nutrition.gluten` (editor-only short name) | Gluten | Gluten |
| `editor.allergens_unreviewed` (reuse) | Not yet reviewed | Sin revisar todavía (existing) |
| `CODE_MESSAGES[allergen.kinds_required]` (reuse) | Choose which cereals | Elige los cereales (existing) |
| `allergen.choose_nuts` (reuse) | Choose which nuts | Elige los frutos de cáscara (existing) |
| `CODE_MESSAGES[allergen.invalid_kind]` (reuse) | Choose a valid cereal or nut | Elige un cereal o fruto de cáscara válido (existing) |

Reuse `modifiers.allergens` (“Allergens” / “Alérgenos”), the other 13 existing allergen names, six existing diet names and all existing kind names verbatim through name helpers. “Gluten” is the approved editor short name, isolated above; `kamut` currently displays “Khorasan wheat” / “Trigo khorasan” in `domain.ts:66`. Interpolate parent names literally, including `$&` and markup characters. If implementation changes any inventory wording or helper-provided label, append its exact EN/proposed ES here and obtain owner wording before landing. Do not change Lane F's “Not reviewed” badge/filter or publish-warning copy.

## Existing-check change ledger (record actual test names and old/new assertions during execution)

- `product-editor.test.ts:419-436,2724-2827`: compact picker/dropdown/second-Escape assertions become direct-chip and native keyboard checks because the spec removes the nested picker. Keep selected values surviving unrelated edits, focus usability, no unintended submit/cancel and all six diet choices.
- `:4324-4368,4437-4506`: replace only nutrition hint assertions with selected Same as and italic read-only parent chips/status; preserve category/course/unit/photo and their exact values/contrast assertions. `product-editor.a11y.test.ts:362-365` must require the replacement inherited content before scanning, not simply delete its presence check.
- `:4561-4583`: replace the combined “empty allergens and diet both inherit” expectation with explicit allergen None saving `{}`, Same as saving `null`, and a separate last-diet removal saving `null`. This is the approved allergen behavior change; dietary behavior is retained.
- `:5790-5961`: replace nutrition-only None specified/open-summary equality with distinct null/None/declared/inherited summaries and mixed implied italics. Keep every Kitchen/Descriptors assertion and their placeholder/locale behavior unchanged.
- `:1270-1340,6153-6224` and save-state/unsaved synthetic events: adapt only the selector/event driver to the dedicated widget. Retain exact kinds, refusal recovery, value-order comparisons, unload protection, variant Open gating and saved-snapshot assertions.
- Keep `allergen-dietary-picker*.test.ts`, `allergen-picker*.test.ts`, `allergen-choices.test.ts`, ingredient, extras, options and modifier unsaved suites behaviorally unchanged. Log each actual deviation with spec clause and old/new expected values; do not mass-update snapshots or delete inconvenient checks.

## Task 5: Verify recovery, accessibility and visible layouts

**Files:** New widget axe tests, existing editor save-state/unsaved/axe tests; temporary LOOK evidence under ignored widget `__screenshots__/look/` only.
**Interface:** Existing `commitSaved`, `closeSaved`, busy/suspension and draft scopes remain the save/leave boundary.

- [x] Add cases for initial quiet Save, changed primary Save, retry after request refusal without another edit, reset/reopen, `commitSaved` followed by a later edit, disconnect/reconnect before and after an edit, and Keep/Discard/native Escape. Include incomplete kinds, explicit None and Same as; count exact submits and exact saved snapshots. Also commit an earlier submitted snapshot after a newer draft edit: the newer edit must remain dirty. A completion for an abandoned editor must not reset the reopened editor. Await `wt-close` where the outcome depends on it.
- [x] Add native keyboard cases using `userEvent`: Tab reaches own controls in order, Enter/Space toggle one choice without submitting the form, implied/inherited read-only choices cannot toggle, and Escape reaches the existing unsaved-close flow. Busy and nested-window suspension block all edits and Save, including events reaching handlers directly.
- [x] Run each new case red before any needed fix, then green. Add computed token/italic/quiet-tick/icon-path assertions and axe cases in both themes for null, None, populated kinds, missing kinds, Same as parent and busy; register `DASHBOARD_ICONS` before mounting. Preserve all other editor axe states.
- [x] Run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-nutrition.test.ts src/widgets/product-nutrition-picker.test.ts src/widgets/product-nutrition-picker.a11y.test.ts src/widgets/product-editor.test.ts src/widgets/product-editor.save-state.test.ts src/widgets/product-editor.unsaved.test.ts src/widgets/product-editor.a11y.test.ts src/screens/catalogue-screen.test.ts --reporter=dot`; require nonzero Tests counts and zero failures.
- [x] Run unchanged consumer suites with `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/allergen-dietary-picker.test.ts src/widgets/allergen-dietary-picker.a11y.test.ts src/widgets/allergen-picker.test.ts src/widgets/allergen-picker.compact.test.ts src/widgets/allergen-picker.a11y.test.ts src/widgets/allergen-choices.test.ts src/widgets/ingredient-form.test.ts src/widgets/ingredient-form.save-state.test.ts src/widgets/ingredient-form.a11y.test.ts src/widgets/extra-list-form.test.ts src/widgets/extra-list-form.save-state.test.ts src/widgets/option-list-form.test.ts src/widgets/option-list-form.save-state.test.ts src/widgets/modifier-forms.unsaved.test.ts --reporter=dot`, then `pnpm --filter @waitron/dashboard typecheck`. Inspect every exit status; do not pipe away evidence.
- [x] LOOK at the rendered editor in real Chromium for EN/ES × light/dark × 390/1280 widths, own and inherited states, both kind rows, errors, long parent names and implied diets. Use the widget browser harness with real app icons; `page.viewport` plus measured `window.innerWidth`, never only outer-page sizing. Save and inspect screenshots; check wrapping, focus/ticks, indentation, no clipping/horizontal overflow and no duplicate summary/hints.
- [x] Exercise save/retry/reopen against the worktree's demo stack through `wa-wt demo waitron-feat-a668-2-allergen-editor` if integration needs a server; inspect `wa-wt ls` first, do not reset a venue or displace another session. Record only processes started for this work and stop those before handoff. Do not leave a watch runner or dev server running.
- [x] Before declaring implementation ready, self-review the diff against the spec and ledger, inventory exact final EN/ES strings and report unapproved Spanish wording. Report focused test receipts and readiness for `finish-branch`; the authorized later branch finisher supplies the single Claude review, normal hook and required current-head CI. Landing is already authorized by the campaign and waits for the owner's Spanish wording.

## Author self-review and unresolved decisions

The tasks cover slice 2 only: first-red diet save, explicit None versus unreviewed, kinds/validation, independent inheritance, replacement sets, implied diets, closed summaries, hint retirement and existing draft protection. The shared/default pickers and Lane F functions/strings are outside the edit set. All five review risks have assigned tests. This planning pass runs no product tests and claims no reproduced bug or visual verification; those are execution steps. The only unresolved owner decision for this slice is the Spanish wording in the inventory; no fresh design approval is needed.

## Execution receipts, 2026-10-16

The driver completed the editor tasks inline. The first diet test's single-choice helper did not
select a multiple-choice value; it was replaced with a real pointer selection and an assertion on
the chosen diet. That corrected test failed on an independently installed detached checkout at
`3e713d3a780b8f65447ab203bc9a2f08f336f884` with `expected {} to be null`, then passed with the
field-specific fix. A second red case pinned an allergen-only edit retaining an explicit empty
variant diet. The installed measuring checkout was removed.

The model's six behavioral cases failed against the interface stub before implementation. The
chip widget's ten cases and the editor integration's ten cases were observed failing before their
implementation. Follow-up browser checks caught the busy opacity token and kind-row placement;
both failed before correction and passed afterwards. Existing English allergen names are reused
verbatim, including “Cereals containing gluten”.

Focused editor/catalogue checks: 644 passed; unchanged picker/ingredient/extras/options checks:
441 passed. The final nutrition recovery suite passed 35 cases, including submitted-snapshot and
reconnect/Keep/Discard cases. Type checking, focused lint and the dashboard build passed. The build
reported its large-chunk warning. Twenty-four settled layout captures were inspected across
English/Spanish, both themes and 390/1280 widths. The temporary capture suite was removed.

The campaign retains the command logs, exact changed-check inventory and images outside Git. The
existing compact picker remains unchanged; the editor uses the new controlled widget. No fixture
field, fiscal assertion, root guard, dependency or migration was changed. No venue reset is needed.
The only open owner decision is the proposed Spanish wording above. The campaign already
authorizes finish and landing; landing waits for that wording.
