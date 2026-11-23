# A quieter product editor — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's Edit product dialog quieter:
- the Available switch under Name
- one Details section in place of Selling, Prep station, Descriptors and Nutritional info, with VAT
  moved into it
- summaries that show only what is set
- smaller, lighter section arrows and normal-weight names in summaries, in the shared section
  header

**Architecture:**
- The shared `wt-disclosure` changes first (summary styling, arrow, a warning value).
- The editor's render then regroups its existing field renderers under one new Details disclosure,
  using plain group labels. Each old section's summary becomes a private method that returns
  `SummaryField[]`, and Details concatenates them.
- A third task applies the "only what is set" rule to every summary.
- A fourth updates the guides and developer docs.

**Tech Stack:** Lit web components, Vitest browser mode (headless Chromium), TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-23-product-editor-quieter-design.md`

**Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-product-editor-quieter`, branch
`product-editor-quieter`.

## Global Constraints

- Every colour, size and space reads a `--wt-*` token. No hex, `rem` or `em` in component styles.
- Every commit is `git commit -s`. Commit messages are plain English (the owner reads them).
- Test commands:
  - one file: `pnpm --filter @waitron/<pkg> exec vitest run <path>`
  - a name filter: `pnpm --filter @waitron/<pkg> exec vitest run <path> -t "<name>"`. Never use
    `pnpm test <file> -t`, which drops the `-t` and runs the whole file.
  - Read the printed `Tests` count. A run with no count proved nothing.
- Before a browser test run, check `memory_pressure | grep free`. Run beside another session only
  above 15% free.
- Every task ends with:
  - `pnpm exec prettier --check <changed files>`
  - `pnpm --filter <pkg> lint`
  - `pnpm --filter <pkg> typecheck`
- A test whose assertion encodes an owner decision this plan reverses is changed to the new
  decision, never deleted. Name each such test in the task's commit message. The decisions are:
  #1177's 18px arrow, A200's bold summary names, A647's section order and starting states, A219's
  price-before-VAT for this editor, and the "every field, filled or not" summary rule.
- New strings go in `apps/dashboard/src/i18n/strings.ts` in BOTH the English block and the Spanish
  block. Remove a key only after grepping that nothing else uses it.
- English only in code, tests and comments (Spanish only inside the Spanish strings block and
  `apps/server/src/guide/es/`).

## Review Focus

1. **A refusal hidden in closed Details.** A server refusal for `takeaway-tax`, `ordering`,
   `customer-name-es`, `description-en`, `kitchen-name`, `product-course` or `allergens-*` must
   open Details and put focus in that field. Pinned in Task 2b.
2. **A variant's page.**
   - Ordering absent; Variants and Modifiers absent; Available visible under Name.
   - The Details summary shows inherited course, description and allergens as placeholders
     (italic).
   - Pinned in Tasks 2b and 3.
3. **A venue with neither a dine-in rate nor takeaway VAT.** The VAT group, label included, is
   absent rather than an empty heading. Pinned in Task 2b.
4. **Creating, then editing.**
   - A new product opens with Details open.
   - Closing the editor and opening an existing product starts Details closed. The starting state
     is recomputed whenever `value` or `open` changes, as Pricing's is today.
   - Pinned in Task 2b, by reset tests in both directions.
5. **A long Details summary at phone width.** It is cut after two lines and never widens the dialog.
   Pinned in Task 3.

---

### Task 1: Quieter section headers in `wt-disclosure`

**Files:**
- Modify: `packages/ui/src/components/wt-disclosure.ts` (`SummaryField` lines 8-18, styles 89-158)
- Test: `packages/ui/src/components/wt-disclosure.test.ts`,
  `packages/ui/src/components/wt-disclosure.a11y.test.ts`,
  `apps/dashboard/src/widgets/extra-list-form.test.ts:1028-1041`

**Interfaces:**
- Produces: `SummaryField` gains `warning?: boolean`. When true, the value is drawn in a
  `<span class="summary-warning">` coloured `--wt-color-warning`. `placeholder` and `warning` may
  both be set, giving italic and warning colour.

- [ ] **Step 1: Write the failing tests.** In `wt-disclosure.test.ts`:
  - Change "the section chevron is large enough to read beside its heading" to "the section
    chevron is small and muted beside its heading". It sets `--wt-font-size-sm` to `12px` on the
    host and expects:
    - the chevron's width to be `12`
    - `getComputedStyle(chevron).color` to equal the computed colour of a probe styled
      `color: var(--wt-color-text-muted)`
  - Change "summary fields put each value after its bold name…" to "…after its name…". With
    `--wt-font-weight-bold: 800` set, expect each `.summary-label`'s `fontWeight` to equal the
    summary's own weight. Keep its text and middot assertions. Make the same change in every other
    case at lines 640-780 that expects a bold `.summary-label`. Do the same in
    `extra-list-form.test.ts`'s "draws each language's code in bold…", renamed "…in the line's
    own weight…".
  - New "a summary the page slots in is drawn small and muted like the component's own". Mount
    `<wt-disclosure heading="H"><span slot="summary">x</span><p>body</p></wt-disclosure>`, set
    `--wt-font-size-sm: 11px`, and expect the slotted span's computed `fontSize` to be `"11px"` and
    its colour to equal the muted probe's.
  - New "a warning value is drawn in the warning colour". Set `summaryFields` to
    `[{ label: "Allergens", value: "Not yet reviewed", warning: true }]` and expect the
    `.summary-warning` text to be "Not yet reviewed", coloured like a `--wt-color-warning` probe.
  - In `wt-disclosure.a11y.test.ts`, add a warning summary field to the closed-state scan, in both
    themes.

- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-disclosure.test.ts src/components/wt-disclosure.a11y.test.ts`.
  Expected: the five changed or new cases fail.

- [ ] **Step 3: Implement.** In `wt-disclosure.ts`:
  - `.summary-slot` gets `color: var(--wt-color-text-muted); font-size: var(--wt-font-size-sm);`.
    Slotted text inherits from its slot's parent.
  - `.summary-label` loses its bold rule.
  - `.chevron` becomes `--wt-font-size-sm` square, with `color: var(--wt-color-text-muted)`.
  - Add `.summary-warning { color: var(--wt-color-warning); }`.
  - `summaryPart` wraps the value in `summary-warning` when `warning` is set (inside the placeholder
    span when both are set).
  - Delete any comment these changes make false.

- [ ] **Step 4: Run the tests and watch them pass.** Same command as Step 2. Then run every suite
  that renders a `wt-disclosure`, and read each `Tests` count:
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/extra-list-form.test.ts src/widgets/theme-advanced.test.ts`,
  plus the prep-stations, export-guides and fiscal-filing suites in `packages/venue-service` and
  `packages/fiscal-verifactu`.

- [ ] **Step 5: Commit.** Message: "Section headers: a smaller, lighter arrow, plain field names in
  summaries, and slotted summaries drawn like the component's own". The body names the reversed
  tests and decisions (#1177, A200).

### Task 2a: Each old section's summary becomes a list of named values

This keeps today's four sections. Only how their summaries are built changes, so the commit stays
green before the regroup.

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`:
  - `renderKitchen` 1084
  - `renderDescriptors` 1261-1293
  - `renderNutrition` 1324-1362
  - `renderSelling` 1383-1395
  - `pricingSummary` 1540-1559
  - styles 249-252 and 315-325
- Test: `apps/dashboard/src/widgets/product-editor.test.ts`, `product-editor.nutrition.test.ts`

**Interfaces:**
- Consumes: `SummaryField.warning` (Task 1).
- Produces: private methods, each returning `SummaryField[]` with today's content:
  - `kitchenSummary()`: prep station name, course
  - `descriptorsSummary()`: customer-facing name, description
  - `nutritionSummary()`: allergens, dietary
  - `sellingSummary()`: Available or Unavailable, then the ordering on a product
  - `takeawayVatSummary()`: the takeaway VAT entry that `pricingSummary` builds today

  `pricingSummary` now concatenates the base price with `takeawayVatSummary()`, so its output is
  unchanged.
- The test helper `summaryOf(el, section)` returns the `summaryFields` of
  `wt-disclosure[data-section=section]`. Every summary-reading test uses it, so Task 2b changes
  only the section name it is given.

- [ ] **Step 1: Write the failing tests.**
  - Each `folded(el, "descriptors").summaryRows` assertion becomes
    `summaryOf(el, "descriptors")`, with the same values and no `lines`. The customer-name entry's
    label becomes `t("editor.customer_name")`, replacing the ambiguous `t("editor.name")`.
  - Each `[data-test="nutrition-summary"]` reading, and the `nutritionFields` helper, becomes
    `summaryOf(el, "nutrition")`:
    - allergens "Not yet reviewed" carries `warning: true`
    - inherited allergens or diets carry `placeholder: true`
  - **Implied diet labels lose their italic in the summary.** A `SummaryField` value is plain
    text. Change `product-editor.nutrition.test.ts:208-226` to expect the implied labels after the
    chosen ones, in the same value with no italic. The open picker still marks them. The PR tells
    the owner.
  - Selling's slotted line becomes `summaryOf(el, "selling")`:
    - `{ label: t("editor.available_label"), value: t("editor.available") }`, with value
      `t("product.unavailable_badge")` and `warning: true` when off
    - then the ordering entry, on a product
  - Add the key `editor.available_label`: "Sale" in English, "Venta" in Spanish. It is only used
    until Task 2b.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts src/widgets/product-editor.nutrition.test.ts`.
- [ ] **Step 3: Implement the five methods.**
  - Pass them as `.summaryFields`.
  - Delete the slotted `<span slot="summary">` blocks and the `.selling-summary` and
    `.nutrition-summary` styles, including the `.inherited`, `[data-implied]` and `.unreviewed`
    children.
  - Descriptors uses `summaryFields`, no longer `summaryRows`.
- [ ] **Step 4: Run and watch them pass.** Same command, plus `product-editor.a11y.test.ts`.
- [ ] **Step 5: Commit.** Message: "Product editor: each section's closed line is built as named
  values". The body notes that implied diets lose their italic on the closed line.

### Task 2b: Regroup the editor: Available under Name, one Details section

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`:
  - `SECTION_FIELDS` 113-121
  - starting states 428-430 and 505-509
  - `focusField` 569-580
  - styles 240-330
  - `renderPrice` 1562-1633
  - `render` 1959-1962, and the four section renderers
- Modify: `apps/dashboard/src/i18n/strings.ts` (English and Spanish)
- Test: `product-editor.test.ts`, `product-editor.a11y.test.ts`, `product-editor.nutrition.test.ts`,
  `product-editor.dine-in-vat.test.ts`, `product-editor.variant-focus.test.ts`,
  `product-editor.save-state.test.ts`, `product-editor.unsaved.test.ts`,
  `product-forms.unsaved.test.ts`, `apps/dashboard/src/screens/products-screen.test.ts`
  (1857, 2209), `apps/dashboard/src/i18n/t.test.ts`

**Interfaces:**
- Consumes: Task 2a's summary methods.
- Produces:
  - `renderDetails()`: `keyed(this.generation, html\`<wt-disclosure ruled data-section="details" ?open=${this.#detailsStartOpen} …>\`)`,
    with `.summaryFields=${this.detailsSummary()}`.
  - `detailsSummary()` = `[...kitchenSummary(), ...descriptorsSummary(), ...nutritionSummary(), ...takeawayVatSummary(), ...orderingSummary()]`.
    `orderingSummary()` is `sellingSummary()` without the Available entry, and is empty on a
    variant.
  - `pricingSummary` returns the base price only.
  - Groups inside Details are `<fieldset class="group" data-group="kitchen|menu|nutrition|vat|ordering"><legend class="group-label">…</legend>…</fieldset>`.
    This is the siblings' pattern (`extra-list-form.ts:1031`); `.group-label` and
    `fieldset.group > legend` styles already exist.
  - The always-visible switch is `<div class="group" data-section="available">`, drawn on products
    and variants.

- [ ] **Step 1: Write the failing tests** in `product-editor.test.ts`:
  - **The order test.** "renders the sections in the designed order…", renamed "…with VAT in
    Details":
    - `.form > [data-section]` is
      `["categories", "name", "available", "details", "price", "variants", "modifiers"]`.
    - Details' `fieldset[data-group]` list is `["kitchen", "menu", "nutrition", "vat", "ordering"]`.
      Each fieldset's accessible name (`legend` text) is `t("editor.section_kitchen")`,
      `t("editor.group_menu")`, `t("editor.group_nutrition")`, `t("product.vat")` and
      `t("editor.ordered_on_own_group")`.
    - `[data-test=dine-in-vat]` is inside the `vat` group, and Pricing holds `[name=unit-price]`
      and no `wt-combobox`.
    - With `--wt-space-5: 24px` set on the host, `.form`'s computed `rowGap` is `"24px"` (spec
      decision 7).
  - **The starting-state test.** "opens Kitchen while Descriptors and Nutritional info start
    collapsed" becomes "Details starts closed on an existing product and open on a new one".
  - **The reset tests, both directions, for Review Focus 4:**
    - "Details closes again when the editor moves to another existing product": open product A,
      open Details by its header, set `value` to product B, await, expect it closed.
    - "Details opens again for a second new product": `value = null`, close Details, set `open`
      false then true with `value` still null, expect it open.
  - **The refusal test, for Review Focus 1.** "a refusal inside closed Details opens it and focuses
    the field" is parameterised over `takeaway-tax` (mounted with `takeawayVat: true`), `ordering`,
    `customer-name-en`, `description-en`, `kitchen-name`, `product-course` and `allergens`. Set
    `fieldErrors` and expect Details open and the named field focused (for `allergens`, the
    picker's first control).
  - **The variant test, for Review Focus 2.** "a variant's page has no Ordering group and keeps
    Available under Name".
  - **The no-VAT test, for Review Focus 3.** "with neither a dine-in rate nor takeaway VAT, Details
    has no VAT group".
  - **The takeaway test.** "the takeaway VAT appears in Details' line, not Pricing's".
  - **Existing tests:**
    - Every `openSection(el, "kitchen" | "descriptors" | "nutrition" | "selling")` opens
      `"details"` instead.
    - Every `summaryOf(el, <old section>)` reads `summaryOf(el, "details")`, filtered to the
      entries that section contributed. The Available entry is gone: the switch is visible.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts`.
- [ ] **Step 3: Implement.**
  - **Strings:**

    | Key | English | Spanish |
    |---|---|---|
    | `editor.section_details` | "Details" | "Detalles" |
    | `editor.group_menu` | "On the menu" | "En la carta" |
    | `editor.group_nutrition` | "Allergens and diet" | "Alérgenos y dieta" |
    | `editor.ordered_on_own_group` | "Ordering" | "Pedidos" |

    The PR asks the owner to confirm the Spanish. Delete `editor.selling`,
    `editor.section_descriptors`, `editor.section_nutrition` and Task 2a's
    `editor.available_label` once grep shows them unused.
  - **`render`:** categories, name, available, `renderDetails()`, price, then variants and
    modifiers (both absent on a variant).
  - **VAT group:** drawn only when `dineInVatRate` or `takeawayVat` is set. It holds `renderTax()`,
    which moves out of `renderPrice`.
  - **Ordering group:** absent on a variant.
  - **Starting state:** `#detailsStartOpen = this.value === null`, set beside the others at
    505-509. The Pricing, Variants and Modifiers rules are unchanged.
  - **`SECTION_FIELDS`:**
    - `details` takes `kitchen-name`, `product-course`, `allergens`, `customer-name-`,
      `description-`, `takeaway-tax` and `ordering`
    - `price` takes `unit` and `unit-price`
    - delete `selling`, `kitchen`, `descriptors` and `nutrition`
  - **`focusField`:** waits on `[data-section="details"]`.
  - **Styles:**
    - `.form` gap becomes `var(--wt-space-5)`; the Details body's fieldsets also sit
      `var(--wt-space-5)` apart
    - delete `.badge`, `.notice`, `.chips` and `wt-button.link`, each only after grep confirms it
      is unused
- [ ] **Step 4: Run and watch them pass.** Same command, then every other test file listed under
  Files. Fix what each pins to the old sections the same way.
- [ ] **Step 5: Commit.** Message: "Product editor: Available sits under Name and one Details
  section holds the prep station, menu names, allergens, VAT and ordering". The body names the
  reversed decisions (A647 points 4 and 5, and A219 for this editor).

### Task 3: Summaries show only what is set

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`:
  - the summary methods
  - `foldedValue` 1078
  - `languagesLine` 1178
  - `renderVariants`' `summary` 1651-1657
  - `renderModifiers`' `summary` 1856
  - styles
- Modify: `packages/ui/src/components/wt-disclosure.ts`. Delete `summaryRows` (179-181, 301-311),
  its `.summary-row` and `.summary-rows` styles, and its tests in `wt-disclosure.test.ts` (638-763)
  and the a11y suite. No caller is left after Task 2a. Grep the whole repository first.
- Test: `product-editor.test.ts`, `product-editor.nutrition.test.ts`

- [ ] **Step 1: Write the failing tests.** Change every summary assertion that expects
  `t("modifiers.none_specified")`, `t("editor.none")` or `t("editor.nutrition.diet_none")` to
  expect that entry absent. Add these cases:
  - "a product with nothing set shows only the allergen warning in Details". Its Details line is
    exactly
    `[{ label: t("modifiers.allergens"), value: t("editor.allergens_unreviewed"), warning: true }]`.
  - "Details names only the languages that have text". `{ en: "Battered hake" }` with locales
    `en` and `es` gives `{ label: t("editor.customer_name"), value: "EN: Battered hake" }`.
  - "a reviewed product with no allergens says so". `{}` gives
    `{ label: t("modifiers.allergens"), value: t("editor.nutrition.allergens_none") }`.
  - "Ordering appears only when it is not Anyone". `"public"` gives no entry; `"staff_only"` gives
    `{ label: t("editor.ordered_on_own"), value: t("product.ordering_staff_only") }`.
  - "Variants and Modifiers show no summary line when empty". `summary` is `""`.
  - "a variant's Details line shows inherited values in italic", for Review Focus 2: the course,
    the description and the allergens, each with `placeholder: true`.
  - "a long Details line is cut after two lines at phone width", for Review Focus 5. At a 400px
    viewport, with long names in two languages and a long description:
    - set `line-height: 20px` on the host
    - expect the inner `.summary`'s rendered height to be ≤ `41`
    - expect the dialog's `scrollWidth` to be ≤ its `clientWidth`
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts src/widgets/product-editor.nutrition.test.ts`.
- [ ] **Step 3: Implement.**
  - **Each summary method** omits an entry with no value of its own, and on a variant includes an
    inherited value as `placeholder: true`. Delete `foldedValue`'s "None specified" branch.
  - **`languagesLine`** returns `""` when no language has text, and otherwise lists only those
    with text. Callers drop the entry on `""`.
  - **Dietary** is omitted with no labels.
  - **Ordering** appears only when `draft.ordering !== "public"`.
  - **Variants and Modifiers** drop the `|| t("editor.none")` fallback. Delete `editor.none` if
    unused.
  - **Two-line cut:** `wt-disclosure[data-section="details"]::part(summary)` gets
    `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere;`.
- [ ] **Step 4: Run and watch them pass.** Same command, plus
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-disclosure.test.ts src/components/wt-disclosure.a11y.test.ts`
  and `product-editor.a11y.test.ts`.
- [ ] **Step 5: Commit.** Message: "Product editor: a closed section's line shows only what is
  set". The body adds that `summaryRows` is removed from `wt-disclosure` because nothing uses it
  now.

### Task 4: Guides and developer docs

**Files:**
- Modify: `apps/server/src/guide/en/products.md`. Rewrite every passage found by
  `grep -n "Selling\|Prep station\|Descriptors\|Nutritional info\|Pricing\|above its VAT\|starts open\|starts folded\|starts closed\|summary line" apps/server/src/guide/en/products.md`.
- Modify: `apps/server/src/guide/es/products.md`. Rewrite every passage found by
  `grep -n "Venta\|Estación de preparación\|Descriptores\|Información nutricional\|Precios\|empieza abierta\|empieza cerrada\|empieza plegada\|plegad" apps/server/src/guide/es/products.md`.
  Keep every `{#id}`, and don't add or remove headings.
- Modify: `docs/developers/design-system.md`:
  - "Fold a long form into collapsible sections with summaries" (4069-4100): the new section
    list, the summary rule from spec decision 5, and no `summaryRows`
  - the `wt-disclosure` row near 910: plain-weight names, `warning`, no `summaryRows`
  - 4106-4108: language codes are no longer bold
  - 4124-4128: an empty Variants line shows nothing
  - the type table's Group label row (4824): `.group-label` is now really used, as a `legend`
- Modify: `docs/developers/products.md`, "The editor form" (897-915).
- Modify: `docs/backlog/menu.md`. Add a dated pointer under A647 and A219: "2026-11-23 (owner):
  superseded for the product editor by `docs/superpowers/specs/2026-11-23-product-editor-quieter-design.md`".

- [ ] **Step 1:** Make the edits. Each sentence describes what the code now does: read the render
  code, not this plan. Cut a guide sentence that explains a corner case the code handles by itself.
- [ ] **Step 2:** Run the guide guards:
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, and from the root,
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts`. Expect
  them to pass.
- [ ] **Step 3: Commit.** Message: "Guides and developer docs describe the quieter product editor".

## For the PR description

- Implied diet labels are no longer italic on the closed line.
- The closed line is still read out as part of the header button's name. That is deliberately
  left as is; Details' line is now the longest such name.
- The Spanish group labels need the owner's wording.
- The reversed decisions are named in the commits: #1177's arrow size, A200's bold names, A647
  points 4 and 5, A219 for this editor, and the "every field, filled or not" summary rule.
