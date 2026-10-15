# A647 Product Editor Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for the owner's already authorised native inline implementation. Follow the checkboxes task by task. The unattended runner authorises implementation, finish-branch and land-branch.

**Goal:** Implement all seven A647 points without changing product data semantics or other lanes' work.

**Architecture:** Keep `ProductEditorDraft` and existing save events unchanged. Add a shared single-choice segmented control, small opt-in disclosure extensions, and an editor-specific appearance widget composed from the existing image uploader and colour field. Keep unit localisation separate from the editor's content-language fields.

**Tech stack:** TypeScript, Lit, shared `wt-*` components and tokens; Vitest browser mode with Playwright Chromium; axe-core.

**Spec:** `docs/backlog/catalogue.md`, “A647 — tidy the product editor”, points 1–7. Text wins over mockups. Read all five boards in `docs/backlog/mockups/a647-product-editor/`:

| Board | Acceptance covered |
| --- | --- |
| `1-thumbnail-opens-image-and-colour.png` | One thumbnail, pencil badge, combined appearance panel, immediate colour preview. |
| `2-sections-one-style.png` | Bold titles, adjacent arrows, full-width lines, readable summaries, equal gaps. |
| `3-variants-section-and-unit-link.png` | Separate Variants fold; Price · Each ▾ link; existing unit dialog. |
| `4-whole-editor-selling-section.png` | Whole-editor order and opening states; warning-coloured Unavailable. |
| `5-selling-options-a-chosen.png` | Selling section, three visible choices and selected explanation; option A only. |

## Global constraints

- Work only in Lane G's `feat/a647-product-editor` worktree. Preserve every other branch and backlog entry. Shared files permit distinct entries/hunks only; inspect current changes before editing or staging, and never restore an entire shared file to resolve overlap.
- Spanish copy is **unresolved** in `/Users/clintongormley/waitron-campaign-g/questions.md`. Its proposal is not approval. Tasks 1, 2, 4 and structural/English work in Task 3 proceed independently; final Spanish copy, Spanish acceptance and landing wait for the owner's recorded answer.
- Read `CLAUDE.md` and the UI, design-system, products, testing, writing-claims and workflow topic files before execution. Read the TDD skill before writing any code or tests. Every behavioural cycle is failing test → observed expected failure → minimal implementation → passing test → focused regression checks.
- Preserve wire values `public`, `staff_only`, `not_sold_separately`, `available`, `active`, and `EACH_CHOICE = "__each__"` → `unitId: null`. Trace consumers before changing gating; availability never substitutes for archival state.
- Keep `draftScopeFor`, `saveActionState`, unchanged-save early return, error placement, nested draft ancestry, existing validation and variant inheritance. A request refusal alone never disables Save.
- Use declared `--wt-*` tokens for chrome; stored product colours remain data. Preserve semantic field names. Shared events carry `detail`, bubble and compose, and stop the triggering event before re-emitting.
- All future commits use `git commit -s`; stage only the task's intended paths/hunks. Never bypass hooks. Landing is already authorised by the runner; Spanish wording remains the unresolved acceptance gate.

## Review focus

- Editing a closed section must retain its draft, warn on leaving and reveal a refused field (Task 3).
- Opening the image library from the new panel must preserve nested unsaved work and return keyboard focus correctly (Task 2).
- Archived-only, newly added and pending-archive variants must retain existing row/action semantics when folded (Tasks 3–4).
- A Catalan-first venue with an English/Spanish dashboard must show correctly translated, alphabetised unit choices and a stable selected id (Task 4).
- Long translated labels, keyboard-only operation and warning text must remain usable at 390px in both themes (Tasks 1, 3 and 5).

## Files and existing interfaces

- `apps/dashboard/src/widgets/product-editor.ts`: owns `draft`, `change<K extends keyof ProductEditorDraft>(key, value)`, `currentValue`, section renderers, `imageOpen`, unit dialog and `returnUnitFocus()`. `willUpdate()` reseeds on value/open; `generation` keys section lifetimes.
- `product-editor-model.ts` in that directory: read existing `ProductEditorDraft`, `UnitChoice { id, name, abbreviation }` and `LocalizedText`; no data-model change planned.
- `variant-table.ts` there: retain `unitLabel`, `busy`, `focusUnit(): Promise<void>`, `[data-test=pricing-unit]`, and `wt-unit-click` with `{}`. Its visible rows exclude `archivedIds`; pending archives remain visible.
- `image-upload.ts` there: reuse `ImageUpload`/`ImageUploader`, `.api`, `.image`, `.inheritedImage`, `.draftParent`, `.disabled`, `.invalid`; events `image-changed { image }` and `image-picker-state { open }`. Keep its media picker and write/draft lifecycle intact.
- `color-field.ts` there: reuse `colorField(ColorFieldOptions)` and `colorFieldStyles`, including category/default inheritance, Custom and field error. Avoid rewriting the image library or generic colour control.
- `packages/ui/src/components/wt-disclosure.ts`: existing `heading`, `summary`, `summaryFields: readonly SummaryField[]`, `summaryRows`, `open`, `hasError`, `wt-toggle { open }`; preserve animation, inert/hidden and forced-open error behaviour.
- Shared support: `packages/ui/src/{index.ts,test-helpers.ts,a11y-helpers.ts}`, `packages/ui/demo/main.ts`; dashboard helpers at `apps/dashboard/src/widgets/test-helpers.ts`.
- Copy/consumers: `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/widgets/product-list.ts` and sibling tests. List cells and ordering filters already use the same `product.ordering*` keys.
- Documentation: change only relevant entries in `docs/developers/{design-system,products}.md` and the completed A647 entry in `docs/backlog/catalogue.md` after acceptance.

## Task 1: Shared segmented single-choice control and opt-in disclosure styling

**Create:** `packages/ui/src/components/wt-segmented-control.ts`, `.test.ts`, `.a11y.test.ts`.
**Modify:** `packages/ui/src/components/wt-disclosure.ts`, its `.test.ts`/`.a11y.test.ts`, `packages/ui/src/index.ts`, `packages/ui/demo/main.ts`.
**Interfaces:** Export `SegmentedOption { value: string; label: string }` and `WtSegmentedControl`; properties `name`, `label`, `value`, `options: readonly SegmentedOption[]`, `disabled`, `error`, `hint`. Emit `wt-change { value: string }` only for a changed selection. Add `WtDisclosure.ruled: boolean = false` (reflected) and an optional named `summary` slot with existing summary rendering as fallback; add `section`, `header`, `summary` parts for editor spacing.

- [ ] RED: Test a labelled radio group with one button per option, exactly one selected, primary fill, roving Tab focus, Arrow/Home/End selection, Space/Enter activation, disabled blocking and one composed event through `mountInShadowRoot`. Activation must not reach the editor's Enter-to-save handler. Test `error`/`hint` descriptions and semantic `name` on the control.
- [ ] RED: Test ruled disclosure open/closed/error states, full-width line below the title, normal summary line height and custom summary fallback. Retain an unruled fixture asserting its existing line-free presentation.
- [ ] RED: Add token-painting assertions using `mount`, live `host` token overrides and computed styles for primary fill/text, border and ruled line. Add axe cases using `mountThemed`/`expectNoA11yViolations(host)` for all three selections, disabled and error/hint states, plus ruled/slotted disclosure states, in light/dark.
- [ ] Run `pnpm --filter @waitron/ui test src/components/wt-segmented-control.test.ts src/components/wt-disclosure.test.ts` and their `.a11y.test.ts` siblings; record failures for missing behaviour rather than unrelated setup errors.
- [ ] GREEN: Implement the interfaces using `baseStyles`, focus delegation, shared field label/error support and token-sized hit targets. Keep the segmented buttons joined with the selected button filled primary. Make the disclosure additions opt-in; migrate only this editor.
- [ ] Run both focused files and their `.a11y.test.ts` siblings; expect counted passing tests and zero axe violations. Temporarily break the accessible group name, observe axe fail, then restore it.
- [ ] Export/register the primitive and add light/dark workbench examples. Commit only these changes with `git commit -s` after checks pass.

## Task 2: One thumbnail and appearance panel (point 1; board 1)

**Create:** `apps/dashboard/src/widgets/product-appearance.ts`, `.test.ts`, `.a11y.test.ts`.
**Modify:** `product-editor.ts`, `product-editor.test.ts`, `product-editor.a11y.test.ts`, `product-editor.unsaved.test.ts` in that directory.
**Interfaces:** `dashboard-product-appearance` accepts `api?: ImageUploader`, `draftParent?: object`, nullable-string `image`, `inheritedImage`, `color`, `categoryColor`, `inheritedFrom: "category" | "default"`, boolean `allowColor`/`disabled`, string `imageError`/`colorError`, and a default slot for Name. Pass `allowColor=false` on a variant page. Expose `focusImage(): Promise<void>` and `focusColor(): Promise<void>`. Forward uploader events once; emit `color-changed { color: string | null }` for editor `change("color", ...)`.

- [ ] RED: Assert one pencil-badged thumbnail beside Name; no standalone Colour group. Its panel orders image controls before category/default colour, swatches and Custom. Without an image, changing palette/Custom/category inheritance paints the square before Save; an image takes precedence. Retain inherited-photo and removal assertions on a variant, which offers no colour override.
- [ ] RED: Test keyboard open, Escape/outside close and focus return to the square; nested picker cancel/select returns into the panel and final panel close returns to the square. Opening either layer must not accidentally submit/close the product. Test busy blocking, image/colour error focus and the no-API fixture's usable colour choices.
- [ ] Run `pnpm --filter @waitron/dashboard test src/widgets/product-appearance.test.ts` and the new editor cases by test name; observe the expected failures.
- [ ] GREEN: Compose the existing non-thumbnail `dashboard-image-upload` and `colorField` inside an editor-owned anchored panel. Position before first paint, constrain it to the viewport, and consume Escape for the active layer. Keep panel edits in the product draft; pass the product as `draftParent` to the uploader. `imageOpen` tracks the nested picker, so opening the appearance panel does not disable its own controls. Route `focusField()` for image/product-color through the new methods and adapt `shownFields()`/field-error assessment to the nested controls, preserving `initialField="image"` and bottom-message ownership.
- [ ] Run the appearance tests, appearance/editor axe suites and `product-editor.unsaved.test.ts`. Use `mountWidget`, `cleanupWidgets`, `userEvent`, `dialogClosed`/`closeReportsDelivered`; adapt the existing “Product ancestry includes a nested image editor” traversal to open the panel first and retain its dirty-ancestry assertion. Verify real painted colour with the existing screenshot/pixel approach where computed native colour styles do not discriminate.
- [ ] Commit the verified appearance changes with `git commit -s`. Leave shared image-library files untouched unless a distinct, necessary hunk is agreed across lanes.

## Task 3: Selling and consistent collapsible sections (points 2–5; boards 2, 4, 5)

**Modify:** `apps/dashboard/src/widgets/product-editor.ts`, `product-editor.test.ts`, `product-editor.a11y.test.ts`, `product-editor.save-state.test.ts`, `product-editor.unsaved.test.ts`, `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/widgets/product-list.test.ts`.
**Interfaces:** Add `renderSelling()` using Task 1's control with `name="ordering"`; keep `change("ordering", value)` and `change("available", checked)`. Use ruled disclosures and the summary slot for the warning-coloured availability word. Initialise fold state once per editor generation, not on each draft update.

- [ ] RED: Assert order after category/Name: Selling, Kitchen, Descriptors, Nutritional info, Pricing, Variants, Modifiers. All sections share bold title/adjacent arrow/full-width line, readable summary spacing and equal section gaps. Close a section, edit another field and assert it stays closed; reopening/reseeding resets defaults.
- [ ] RED: Assert defaults: Kitchen open; Pricing open without variants, closed with variants; Variants open with variants and closed without; Modifiers open only with attachments; Selling/Descriptors/Nutritional info closed. Use the table's visible-row rule for variant presence, including pending archives but excluding rows archived before opening; test available=false separately. A variant page has open Pricing, no Variants/Modifiers/ordering choice, and Selling contains only Available.
- [ ] RED: Open empty Variants and assert only Add variant beneath its title; close it and assert “None”. Keep Pricing's “Base price: €11.00 each · VAT: Reduced (10%)” form. Test attached modifiers' names in the closed summary and their unchanged attach/reorder/remove payloads.
- [ ] RED: Assert English “Selling”, “Ordered on its own by”, “Anyone / Staff only / Nobody”; all three choices are visible, exactly the chosen existing hint appears underneath, and selecting each sends the original wire value. Closed summary reads “Available · Ordered on its own by: Anyone”; off uses “Unavailable” painted from `--wt-color-warning`. Test list column/filter labels and filter behaviour using the same values.
- [ ] Run the new editor/list cases with `pnpm --filter @waitron/dashboard test src/widgets/product-editor.test.ts src/widgets/product-list.test.ts -t '<new case names>'`; observe failures before implementing each behaviour.
- [ ] GREEN: Replace the ordering dropdown and loose Available row with Selling. Always render Pricing/Variants/Modifiers as disclosures; remove the editor's negative-margin and special-gap rules. Add section error ownership for ordering, unit-price, variants and modifiers, preserving server-field mapping, first-invalid focus, row errors and bottom message. Use generation-keyed defaults without remounting draft controls on every change.
- [ ] Changed-test notes: deliberately replace old section-order/all-capitals assertions, “three optional sections collapsed”, dropdown-only/no-hint cases, conditional/non-disclosure Pricing, unsaved-product Pricing exception, “Variants always open”, and unequal spacing assertions. Make toggle helpers open only when closed. Retain submission assertions, independent product names, archive/Keep/Remove, inheritance, reordering, unit usage and error-focus behaviours; do not weaken them to match markup.
- [ ] Extend existing unsaved/save-state suites: edit availability, ordering, colour, variant and modifier values, close their sections, then exercise Keep/Discard, reconnect and unchanged/reverted Save. Merely toggling sections stays clean. A folded refused field opens and remains correctable. Run complete editor, save-state, unsaved and axe files, plus list ordering cases; expect counted passes.
- [ ] Apply only owner-confirmed Spanish strings when the answer arrives; add literal EN/ES assertions so tests that merely call `t()` cannot hide wrong wording. Until then retain existing Spanish copy, label Spanish acceptance pending and do not claim A647 complete. Commit verified independent work with `git commit -s`.

## Task 4: Compact unit link and dashboard-language unit choices (points 6–7; board 3)

**Modify:** `apps/dashboard/src/widgets/variant-table.ts`, `variant-table.test.ts`, `variant-table.a11y.test.ts`, `product-editor.ts`, `product-editor.test.ts`, `product-editor.variant-focus.test.ts`.
**Interfaces:** Preserve Task 1–3 interfaces and the existing unit chooser. Add editor-only `unitText(value: LocalizedText): string` using `resolveContentText(value, currentLocale(), this.language)`; use it for unit names/abbreviations and `unitShortLabel`. Sort a copied unit list by resolved name with `Intl.Collator(currentLocale())`, id as tie-breaker. Do not change `text()` or `locales[0]` for customer names/descriptions.

- [ ] RED: At desktop assert “Price · Each ▾” (or selected unit), link presentation without the old bordered button, compact header, accessible change-unit name and `aria-haspopup="dialog"`. Clicking/keyboard activation emits exactly one `wt-unit-click`; busy blocks it; chooser close returns through `focusUnit()`. Base-price field retains its own unit button. Preserve phone stacked-price/row-menu behaviour and reach the chooser through the price field when the heading is hidden.
- [ ] RED: Mount `locales: ["ca", "es", "en"]` and dashboard `en-GB`/`es-ES`; supply shuffled ids and names whose Catalan and dashboard orders differ. Assert Each first, remaining names alphabetical by dashboard language, translated abbreviations, missing/blank translation fallback to venue default, stable ids, null Each conversion and no mutation of input units. Restore global locale after each case.
- [ ] Run `pnpm --filter @waitron/dashboard test src/widgets/variant-table.test.ts src/widgets/product-editor.test.ts -t 'unit|chooser|pricing'`; observe the intended failures before each fix.
- [ ] GREEN: Style the existing heading action as a token-based link with middot/chevron, preserving its event, selector and focus API. Apply the unit-only resolver and sorted choices to the existing dialog; retain Add unit, selected value, missing-choice/error handling and stale-usage response protection.
- [ ] Run both full test files, `variant-table.a11y.test.ts` and `product-editor.variant-focus.test.ts`; update the old button-presentation assertion explicitly while retaining payload, accessible-name and focus assertions. Commit with `git commit -s`.

## Task 5: Acceptance, documentation and branch finishing

- [ ] Run focused browser regression files with `pnpm --filter @waitron/dashboard test src/widgets/product-appearance.test.ts src/widgets/product-appearance.a11y.test.ts src/widgets/product-editor.test.ts src/widgets/product-editor.a11y.test.ts src/widgets/product-editor.unsaved.test.ts src/widgets/product-editor.save-state.test.ts src/widgets/product-editor.vat-default.test.ts src/widgets/product-editor.variant-focus.test.ts src/widgets/variant-table.test.ts src/widgets/variant-table.a11y.test.ts src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts`. Also run `src/widgets/catalogue-browser.unsaved.test.ts` and `src/widgets/catalogue-forms.unsaved.test.ts` for nested catalogue creation. Read test counts, not exit status alone.
- [ ] Run `pnpm --filter @waitron/ui test src/components/wt-segmented-control.test.ts src/components/wt-segmented-control.a11y.test.ts src/components/wt-disclosure.test.ts src/components/wt-disclosure.a11y.test.ts src/no-hardcoded-chrome.test.ts` and `pnpm exec vitest run scripts/style-token-names.test.ts scripts/native-form-fields.test.ts`. Keep coverage bars `98/98/98/95` and mutation floor 90; no coverage exclusions to hide reachable new code.
- [ ] Inspect the running product UI, not only tests: start with `wa-wt demo waitron-feat-a647-product-editor`; open new/existing products with/without variants/modifiers and a variant page. Look at all five boards' states in EN/ES × light/dark × 390/1280, including appearance panel, every Selling choice, unavailable summary, folded/open sections, unit dialog, errors and footer. Capture and inspect screenshots for each combination; check clipping, line rhythm, header height, pointer/keyboard focus and long labels. Spanish final inspection waits for confirmed wording.
- [ ] Before browser work check `memory_pressure`/active runs; use available authorised Chromium execution and record any actual launch failure. Stop only recorded process ids started for this work; preserve other lanes' servers and test runs.
- [ ] Update only the product-editor passages and new primitive/API entries in `docs/developers/design-system.md` and `docs/developers/products.md`; audit old dropdown, fold/default, thumbnail and unit-language claims. Preserve unrelated nutritional-summary and 390px Descriptors backlog work. After all seven points are accepted, delete only A647 from `docs/backlog/catalogue.md`, retaining owner decisions in its area's Decisions section. Review shared hunks and commit with `git commit -s`.
- [ ] When code and local validation are ready, explicitly announce readiness for `finish-branch`. During that workflow, after its initial rebase, run **ONE Claude whole-branch run-it review** through `claude-seat.sh review-run` in a throwaway checkout containing the complete candidate tree and installed dependencies. Read completed findings, fix real defects with failing/passing focused cycles, and do not repeat the whole review solely for later rebases.
- [ ] Push through the normal pre-push hook once; do not duplicate it with an unnecessary whole-workspace local run. Verify required CI coverage/merge jobs and expected package selection against the exact current head SHA; resolve failures and review conversations. Record explicit changed-test notes in the PR. Landing remains gated on the Spanish answer. Once answered, use the already authorised land-branch workflow under the shared landing lock.
