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
   open Details and put focus in that field. Pinned in Task 2.
2. **A variant's page.**
   - Ordering absent; Variants and Modifiers absent; Available visible under Name.
   - The Details summary shows inherited course, description and allergens as placeholders
     (italic).
   - Pinned in Tasks 2 and 3.
3. **A venue with neither a dine-in rate nor takeaway VAT.** The VAT group, label included, is
   absent rather than an empty heading. Pinned in Task 2.
4. **Creating, then editing.**
   - A new product opens with Details open.
   - Closing the editor and opening an existing product starts Details closed. The starting state
     is recomputed whenever `value` or `open` changes, as Pricing's is today.
   - Pinned in Task 2.
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

### Task 2: Regroup the editor: Available under Name, one Details section

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`:
  - `SECTION_FIELDS` 113-121
  - starting states 428-430 and 505-509
  - `focusField` allergens branch 569-580
  - styles 240-320
  - `renderKitchen` 1084
  - `renderDescriptors` 1261
  - `renderNutrition` 1324
  - `renderSelling` 1383
  - `renderPrice` 1562
  - `render` 1959-1962
- Modify: `apps/dashboard/src/i18n/strings.ts` (English and Spanish blocks)
- Test: `apps/dashboard/src/widgets/product-editor.test.ts`, `product-editor.a11y.test.ts`,
  `product-editor.nutrition.test.ts`, `product-editor.variant-focus.test.ts`,
  `product-editor.save-state.test.ts`, `apps/dashboard/src/screens/products-screen.test.ts`

**Interfaces:**
- Consumes: `SummaryField.warning` (Task 1).
- Produces:
  - `renderDetails()`, a `<wt-disclosure ruled data-section="details">` whose `.summaryFields` is
    `this.detailsSummary()`.
  - Private `kitchenSummary()`, `descriptorsSummary()`, `nutritionSummary()`, `vatSummary()` and
    `orderingSummary()`, each returning `SummaryField[]` with today's content. `detailsSummary()`
    concatenates them in that order. Task 3 changes what each returns.
  - The groups inside Details are `<div class="group" data-group="kitchen|menu|nutrition|vat|ordering">`,
    each starting with `<div class="group-label">`.
  - The always-visible switch sits in `<div class="group" data-section="available">`.

- [ ] **Step 1: Write the failing tests** in `product-editor.test.ts`:
  - "renders the sections in the designed order…" expects `.form > [data-section]` to be
    `["categories", "name", "available", "details", "price", "variants", "modifiers"]`. It expects
    Details' groups to be `["kitchen", "menu", "nutrition", "vat", "ordering"]`, with labels
    `t("editor.section_kitchen")`, `t("editor.group_menu")`, `t("editor.group_nutrition")`,
    `t("product.vat")` and `t("editor.ordered_on_own_group")`. It expects `[data-test=dine-in-vat]`
    inside the `vat` group, and Pricing to contain `[name=unit-price]` and no `wt-combobox`. Rename
    it "…with VAT in Details".
  - "opens Kitchen while Descriptors and Nutritional info start collapsed" becomes "Details starts
    closed on an existing product and open on a new one". It mounts with `value: product`, expects
    `section(el, "details").open` false, then sets `value = null`, awaits, and expects it true.
  - New "Details closes again when the editor reopens on an existing product after creating one",
    for Review Focus 4.
  - New "a refusal inside closed Details opens it and focuses the field", for Review Focus 1. It is
    parameterised over `takeaway-tax`, `ordering`, `customer-name-en`, `kitchen-name` and
    `allergens`. Set `fieldErrors` and expect Details open and the named field focused (for
    `allergens`, the picker's first control).
  - New "a variant's page has no Ordering group and keeps Available under Name", for Review Focus
    2.
  - New "with neither a dine-in rate nor takeaway VAT, Details has no VAT group", for Review
    Focus 3.
  - Every existing case that calls `openSection(el, "kitchen" | "descriptors" | "nutrition" |
    "selling")` opens `"details"` instead.
  - Every case reading `folded(el, "kitchen").summaryFields`,
    `folded(el, "descriptors").summaryRows` or `[data-test="nutrition-summary"]` reads the matching
    entries of `folded(el, "details").summaryFields` instead, with the same values. Descriptors'
    rows become fields with no `lines`. Allergens "Not yet reviewed" carries `warning: true`, and
    inherited values keep `placeholder: true`.

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
    `editor.section_descriptors` and `editor.section_nutrition` once grep shows them unused.
  - **`render`:** order categories, name, available, `renderDetails()`, price, then variants and
    modifiers (both absent on a variant).
  - **`renderDetails`:** holds the five groups in spec order.
    - **VAT group:** drawn only when `dineInVatRate` or `takeawayVat` is set. It holds
      `renderTax()`'s output, removed from `renderPrice`.
    - **Ordering group:** absent on a variant (`this.inherited !== null`).
  - **Starting states:** `#detailsStartOpen = this.value === null`, set beside the other starting
    states at 505-509. Keep the Pricing, Variants and Modifiers rules exactly.
  - **`SECTION_FIELDS`:** `details` takes `kitchen-name`, `product-course`, `allergens`,
    `customer-name-`, `description-`, `takeaway-tax` and `ordering`; `price` takes `unit` and
    `unit-price`; `selling`, `kitchen`, `descriptors` and `nutrition` are deleted.
  - **`focusField`:** waits on `[data-section="details"]` instead of `nutrition`.
  - **Styles:**
    - delete `.selling-summary`, `.nutrition-summary` and its children
    - delete `.badge`, `.notice`, `.chips` and `wt-button.link`, if grep confirms each is unused
    - keep `.group-label`
    - give the Details groups `gap: var(--wt-space-5)` between them
    - `.form`'s gap becomes `var(--wt-space-5)` (spec decision 7). The order test also sets
      `--wt-space-5: 24px` on the host and expects the computed `rowGap` of `.form` to be `"24px"`.
- [ ] **Step 4: Run and watch them pass.** Same command as Step 2. Then run
  `product-editor.a11y.test.ts`, `product-editor.nutrition.test.ts`,
  `product-editor.variant-focus.test.ts`, `product-editor.save-state.test.ts`,
  `product-editor.unsaved.test.ts`, `product-forms.unsaved.test.ts`,
  `src/screens/products-screen.test.ts` and `src/i18n/t.test.ts`, fixing what they pin to the old
  sections the same way.
- [ ] **Step 5: Commit.** Message: "Product editor: Available sits under Name and one Details
  section holds the prep station, menu names, allergens, VAT and ordering". The body names the
  reversed decisions (A647 points 4 and 5, A219 for this editor).

### Task 3: Summaries show only what is set

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`:
  - the five summary methods (Task 2)
  - `languagesLine` 1178
  - `pricingSummary` 1540
  - `renderVariants`' `summary` 1651-1657
  - `renderModifiers`' `summary` 1856
  - styles
- Test: `apps/dashboard/src/widgets/product-editor.test.ts`, `product-editor.nutrition.test.ts`

- [ ] **Step 1: Write the failing tests.** Change every summary assertion that expects
  `t("modifiers.none_specified")`, `t("editor.none")` or `t("editor.nutrition.diet_none")` to
  expect that field absent. Add these cases:
  - "a product with nothing set shows only the allergen warning in Details". A fresh product
    (allergens `null`) gives exactly
    `[{ label: t("modifiers.allergens"), value: t("editor.allergens_unreviewed"), warning: true }]`.
  - "Details names only the languages that have text". Customer name `{ en: "Battered hake" }` with
    locales `en` and `es` gives `{ label: t("editor.customer_name"), value: "EN: Battered hake" }`.
  - "a reviewed product with no allergens says so". Allergens `{}` gives
    `{ label: t("modifiers.allergens"), value: t("editor.nutrition.allergens_none") }`. A reviewed
    "none" is a set value.
  - "Ordering appears only when it is not Anyone". `ordering: "public"` gives no entry;
    `"staff_only"` gives `{ label: t("editor.ordered_on_own"), value: t("product.ordering_staff_only") }`.
  - "the takeaway VAT appears in Details, not Pricing". Pricing's `summaryFields` holds only the
    base price.
  - "Variants and Modifiers show no summary line when empty". `summary` is `""` with no variants
    and no lists.
  - "a variant's Details summary shows inherited values in italic", for Review Focus 2. It covers
    the course, the description and the allergens, each with `placeholder: true`.
  - "a long Details summary is cut after two lines at phone width", for Review Focus 5. At a 400px
    wide viewport, with a long name in two languages and a long description, expect the summary
    part's height ≤ 2 × its computed line height + 1, and the dialog's scroll width ≤ its client
    width.

- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts src/widgets/product-editor.nutrition.test.ts`.

- [ ] **Step 3: Implement.**
  - **Each summary method** omits a field with no value of its own. On a variant, it includes an
    inherited value as `placeholder: true`. Delete `foldedValue`'s "None specified" branch.
  - **`languagesLine`** returns `""` when no language has text, and otherwise lists only the
    languages with text. Callers drop the field on `""`.
  - **Dietary** is omitted when there are no labels.
  - **Takeaway VAT** is included under the same condition `pricingSummary` uses today, and moves
    out of `pricingSummary`.
  - **Ordering** is included only when `draft.ordering !== "public"`.
  - **Variants and Modifiers** drop the `|| t("editor.none")` fallback. Delete `editor.none` if
    grep shows it unused.
  - **Two-line cut:** `wt-disclosure[data-section="details"]::part(summary)` gets
    `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;`.
- [ ] **Step 4: Run and watch them pass.** Same command as Step 2, plus `product-editor.a11y.test.ts`.
- [ ] **Step 5: Commit.** Message: "Product editor: a closed section's line shows only what is set".

### Task 4: Guides and developer docs

**Files:**
- Modify: `apps/server/src/guide/en/products.md` and `apps/server/src/guide/es/products.md`. Rewrite
  every passage that names Selling, Prep station, Descriptors or Nutritional info as a section, or
  says which sections start open: the lines found by `grep -n "Selling\|Descriptors\|Nutritional
  info\|starts open\|starts folded\|starts closed"`. Keep every `{#id}`, and don't add or remove
  headings.
- Modify: `docs/developers/design-system.md`:
  - "Fold a long form into collapsible sections with summaries" (4069-4100): the new section list,
    and the summary rule from spec decision 5.
  - The type table's Group label row (4824): `.group-label` is now really used.
- Modify: `docs/developers/products.md`, "The editor form" (897-915).
- Modify: `docs/backlog/menu.md`. Add a dated pointer under A647 and A219: "2026-11-23 (owner):
  superseded for the product editor by `docs/superpowers/specs/2026-11-23-product-editor-quieter-design.md`".
- Modify: help bubbles. Any `help.products.*` string, English or Spanish, that names a removed
  section by name.

- [ ] **Step 1:** Make the edits. Each sentence describes what the code now does: read the render
  code, not this plan. Cut a guide sentence that explains a corner case the code handles by itself.
- [ ] **Step 2:** Run the guide guards:
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, and
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts` from the
  root. Expect them to pass.
- [ ] **Step 3: Commit.** Message: "Guides and developer docs describe the quieter product editor".
