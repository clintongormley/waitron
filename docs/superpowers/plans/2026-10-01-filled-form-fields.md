# Form fields in the "filled" style (A178) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every form field in the dashboard, setup and the till is drawn the owner-approved "filled"
way, by a shared primitive, and a root guard stops a screen drawing its own field again.

**Architecture:** One stylesheet fragment (`fieldStyles`, `packages/ui-core/src/field-styles.ts`)
draws the field box for `wt-input`, `wt-price-input`, `wt-number-stepper`, `wt-combobox` and a new
`wt-textarea`. `wt-combobox` becomes the one dropdown and replaces every native `<select>`. Screens
move onto the primitives in four batches; then a text guard and the clean-up land.

**Tech Stack:** Lit 3 web components, Vitest browser mode (real headless Chromium through
Playwright), axe-core, the root `typescript` (version 6) for the guard.

**Spec:** `docs/superpowers/specs/2026-10-01-filled-form-fields-design.md` — read it first; this
plan refers to its sections as "spec §N".

## Global Constraints

- **Six pull requests, in order, each leaving `main` green and working on its own:** A178a (Tasks
  1–7), A178b (Task 8), A178c (Task 9), A178d (Task 10), A178e (Task 11), A178f (Task 12). Branches:
  `feat/filled-fields-primitives`, `feat/filled-fields-dashboard-screens`,
  `feat/filled-fields-dashboard-widgets`, `feat/filled-fields-setup-till`,
  `feat/filled-fields-modules`, `feat/filled-fields-guard`.
- **Before each pull request starts:** `gh pr list` and each open branch's files. Lane E's
  `feat/menus-include-menus` (PF2b) changes many `apps/dashboard` screens and widgets; where a task
  must touch one of its files, whoever lands second rebases (owner's "don't wait" rule).
- **Coverage:** every package holds 98/98/98/95 (CLAUDE.md §2). `packages/ui` and
  `packages/ui-core` also hold a mutation floor of 90 in the weekly run: every new branch gets an
  assertion that fails when it is deleted.
- **No literal colour, `px` above 1, `rem` or `em` in a primitive's `static styles`** — the two
  `no-hardcoded-chrome.test.ts` suites. Every value reads a `--wt-*` token. Its keyword scan reads
  `white` inside `white-space` as a colour: write `text-wrap: nowrap` (as `wt-combobox.ts` does).
- **Every token read must be declared** (`scripts/style-token-names.test.ts`).
- **Every new or changed primitive state gets an axe case in both themes** in its sibling
  `*.a11y.test.ts`, and a token-painting test (CLAUDE.md §3; design-system.md → Adding a primitive).
- **Owner-approved test edits, and only these three kinds** (spec §11, §12 point 6): (1) LOOK — a
  test that pins today's look (a border all round, a label above the field, a 12px label at rest,
  a pill-shaped search box, the disabled opacity, a focus ring on a field's control,
  `selectStyles`) changes to the approved look; (2) DRIVING — a screen test that picks a native
  select's value by setting `select.value` and sending `change` calls `chooseOption` instead;
  (3) READING — a test that reads `<option>` elements or a screen-drawn error paragraph reads the
  primitive's `options` or `error` instead, expecting the same values (the one value allowed to
  change: an option count that included a required field's empty first `<option>`, now the
  placeholder). Every BEHAVIOURAL assertion stays. Each pull request lists every test it edited and which of the two
  kinds it is. Any other edited assertion is a STOP (`questions.md`, mark the item `blocked`).
- **The golden huella test and `inmutabilidad` are untouched** (nothing here comes near the fiscal
  core); no migration.
- **LOOK at every changed screen**: light and dark, English and Spanish, 1280 and 390 px wide; the
  till also at 1024×768 and a handheld size. Save the screenshots outside the worktree.
- **English and Spanish strings** for every new visible or accessible text.

## Review Focus

1. **A dropdown inside a `wt-dialog` or `wt-modal`:** Escape while its list is open closes the
   list only, and the dialog stays open; the list draws above the dialog. Test in Task 6.
2. **Enter in a form wired with `submitOnEnter`:** Enter on a closed dropdown opens it, and Enter
   in its search box picks a row — neither submits the form, including when no row is active.
   Test in Task 6.
3. **A dropdown or textarea a screen marks invalid** is where `focusFirstInvalid` puts focus on a
   failed submission. Test in Task 6 (dropdown) and Task 3 (textarea).
4. **A value that arrives without typing** — set from code after the field rendered (a form reset,
   a loaded record), or filled in by the browser's password manager — floats the label rather than
   drawing it over the value. Test in Task 2.
5. **A long label or a long chosen option at 390 px** is cut with an ellipsis on one line and never
   wraps over the value or under the chevron. Test in Task 2 (label) and Task 5 (chosen option).

---

## PR A178a — tokens and primitives (Tasks 1–7)

### Task 1: The field tokens

**Files:**
- Modify: `packages/ui-core/src/tokens/colors.css` (all four blocks)
- Modify: `packages/ui-core/src/tokens/structure.css`
- Test: `packages/ui-core/src/tokens/colors.test.ts`, `packages/ui-core/src/tokens/structure.test.ts`

**Interfaces:**
- Produces: `--wt-color-field-fill`, `--wt-color-field-line`, `--wt-color-field-label-focus`,
  `--wt-color-field-fill-disabled`, `--wt-color-field-value`, `--wt-field-height`,
  `--wt-field-label-rest-size`, `--wt-field-line-width`, `--wt-field-line-width-active`,
  `--wt-dropdown-row-height`.

- [ ] **Step 1: Write the failing tests.** In `colors.test.ts`, first move the `luminance` and
  `ratio` helpers out of the surface-lifted case (about lines 121–133) to the top of the file,
  unchanged, and call the moved `ratio` from both cases (it is written `contrastRatio` below — use
  whichever name the moved helper has). Then add:

```ts
const FIELD_TOKENS = [
  "--wt-color-field-fill",
  "--wt-color-field-line",
  "--wt-color-field-label-focus",
  "--wt-color-field-fill-disabled",
  "--wt-color-field-value",
] as const;

describe.each(["light", "dark"] as const)("field tokens (%s)", (theme) => {
  test("every field token is set", () => {
    const root = mountTokenRoot(theme);
    for (const name of FIELD_TOKENS) expect(token(root, name), name).not.toBe("");
  });

  test("the field's marks meet WCAG on the fill and around it", () => {
    const root = mountTokenRoot(theme);
    const fill = token(root, "--wt-color-field-fill");
    const ratio = (name: string, on = fill) => contrastRatio(token(root, name), on);
    // Non-text (1.4.11): the bottom line marks the field out, on the fill and on what surrounds it.
    expect(ratio("--wt-color-field-line")).toBeGreaterThanOrEqual(3);
    expect(ratio("--wt-color-field-line", token(root, "--wt-color-surface"))).toBeGreaterThanOrEqual(3);
    expect(ratio("--wt-color-field-line", token(root, "--wt-color-bg"))).toBeGreaterThanOrEqual(3);
    expect(ratio("--wt-color-primary")).toBeGreaterThanOrEqual(3);
    // Small text (1.4.3): label, hint, value, error.
    for (const name of [
      "--wt-color-field-label-focus",
      "--wt-color-text-muted",
      "--wt-color-text",
      "--wt-color-danger",
      "--wt-color-field-value",
    ]) expect(ratio(name), name).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(token(root, "--wt-color-text-muted"), token(root, "--wt-color-field-fill-disabled")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
```

  If the helper takes a different colour format than `token()` returns, convert with the parser
  the surface-lifted case already uses — do not write a second one. In `structure.test.ts`, add
  the five structure tokens to the non-empty list and pin `--wt-field-height` ≥ `--wt-tap-min`.

- [ ] **Step 2: Run, see them fail.**
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts src/tokens/structure.test.ts`
  Expected: the new cases fail on empty tokens.

- [ ] **Step 3: Add the tokens.** Light values in the light base block AND `[data-theme="light"]`;
  dark values in the `prefers-color-scheme: dark` block AND `[data-theme="dark"]` (spec §6 table).
  In `structure.css`:

```css
  --wt-field-height: 56px;
  --wt-field-label-rest-size: 16px;
  --wt-field-line-width: 1px;
  --wt-field-line-width-active: 2px;
  --wt-dropdown-row-height: 48px;
```

(2026-10-02: `--wt-field-label-rest-size` was removed; a resting label now takes the value's size —
A184.)

- [ ] **Step 4: Run, see them pass.** Same command. Then prove the contrast case by mutation: set
  the light `--wt-color-field-line` to `#d6d9e0` (today's border colour, 1.32:1), see it fail,
  restore.
- [ ] **Step 5: Commit** `git commit -s -m "Field tokens for the filled form fields, with their contrast checked in both themes (A178)"`.

### Task 2: `fieldStyles` and `wt-input` in the filled style

**Files:**
- Create: `packages/ui-core/src/field-styles.ts`
- Modify: `packages/ui-core/src/components/wt-input.ts`, `packages/ui-core/src/index.ts` (export
  `fieldStyles`, `fieldLabelState`)
- Test: `packages/ui-core/src/components/wt-input.test.ts`, `wt-input.a11y.test.ts`

**Interfaces:**
- Produces: `fieldStyles: CSSResult`; `fieldLabelState(opts: { value: string; hint: string;
  placeholder: string; type?: string }): "rest" | "float"`; the field-box markup contract (spec §5):
  `.field[part=field]` with `data-label`, `data-invalid`, `data-disabled`, `data-compact`,
  `data-open`; `.field-label`; `.field-control`. `wt-input` gains `hideLabel` (attribute
  `hide-label`).

- [ ] **Step 1: Write the failing tests** in `wt-input.test.ts` (new cases; keep every behavioural
  case):
  - a labelled empty field with no hint: `.field` is `--wt-field-height` tall (set the token on
    `host` to `70px`, assert 70); `data-label="rest"`; the label's computed `font-size` follows
    `--wt-field-label-rest-size`;
  - with `value="x"`, with `hint="h"`, with `placeholder="p"`, and with each of `type` `date`,
    `time`, `datetime-local`, `month`, `week`: `data-label="float"` and the label's `font-size`
    follows `--wt-font-size-sm`;
  - focusing an empty resting field floats the label (computed `font-size` changes) and paints the
    bottom line from `--wt-color-primary` at `--wt-field-line-width-active`, and the label from
    `--wt-color-field-label-focus`;
  - **Review Focus 4:** mount empty, then set `el.value = "Ana"` from code and await
    `updateComplete`: `data-label="float"`. And `fieldStyles.cssText` contains a `:autofill` rule
    that floats the label (this checks the rule is there, not that a browser fills it — say so in
    the test's name);
  - `invalid`: line `--wt-color-danger` at the active width, label `--wt-color-danger`;
  - `disabled`: fill `--wt-color-field-fill-disabled`, `border-bottom-style: dashed`, value
    `--wt-color-text-muted`, and computed `opacity` is `1`;
  - the value paints `--wt-color-field-value`; a hint shows italic `--wt-color-text-muted`;
  - `hide-label`: no visible label, the input's accessible name is `label` (`aria-label`), the
    field is `--wt-tap-min` tall, `data-compact` set; a `wt-input` with no `label` at all is
    compact too;
  - **focused AND invalid** (what `focusFirstInvalid` produces after a failed submission): the line
    and the label stay `--wt-color-danger`;
  - the `end` slot: with a button assigned, the button shows inside the field box at its trailing
    end and the control's end padding leaves room for it (the existing end-slot cases keep
    passing);
  - the `help` slot's assigned element sits outside `.field` and to its trailing side
    (`getBoundingClientRect().left` ≥ the field's `right`);
  - **Review Focus 5:** at a 390 px host with a 120-character label, the floated label is one line
    (`scrollHeight` equals its line height) with `text-overflow: ellipsis`.

  Edit, as owner-approved LOOK changes, and name each in the commit message: the "14px value and
  12px label" case (about lines 13–17; it now holds for a floated label only — mount it with a
  `value`); the help-slot placement case (about 132; the slot now sits beside the field box); the
  cases querying `.control` (about 140–160; the wrapper is now `.field`); the disabled-opacity case
  (about 242; disabled now paints its own fill and keeps opacity 1); and any case asserting a border
  all round, `--wt-color-border` or the danger BORDER (about 235–240; now the danger line). Re-read
  the file before editing — line numbers drift.
  In `wt-input.a11y.test.ts`, add states in both themes: resting, floated with value, focused,
  `hide-label`, disabled with a value, invalid with an error, with a `help` tooltip.

- [ ] **Step 2: Run, see them fail.**
  `pnpm --filter @waitron/ui-core exec vitest run src/components/wt-input.test.ts src/components/wt-input.a11y.test.ts`

- [ ] **Step 3: Implement.** `field-styles.ts`:

```ts
import { css } from "lit";

const ALWAYS_FLOAT = new Set(["date", "time", "datetime-local", "month", "week"]);

/** Whether a field's label rests large in the box or floats small at the top (spec §5.1). Focus
 * is CSS's job (`:focus-within`), so it is not an input here. */
export function fieldLabelState(opts: {
  value: string;
  hint: string;
  placeholder: string;
  type?: string;
}): "rest" | "float" {
  if (opts.value !== "" || opts.hint !== "" || opts.placeholder !== "") return "float";
  return ALWAYS_FLOAT.has(opts.type ?? "") ? "float" : "rest";
}

export const fieldStyles = css`
  .field {
    position: relative;
    display: flex;
    align-items: flex-end;
    min-height: var(--wt-field-height);
    background: var(--wt-color-field-fill);
    border-start-start-radius: var(--wt-radius-md);
    border-start-end-radius: var(--wt-radius-md);
    box-shadow: inset 0 calc(-1 * var(--wt-field-line-width)) 0 var(--wt-color-field-line);
  }
  .field-label {
    position: absolute;
    inset-inline: var(--wt-space-3);
    top: var(--wt-space-2);
    font-size: var(--wt-font-size-sm);
    color: var(--wt-color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .field[data-label="rest"]:not(:focus-within):not(:has(:autofill)) .field-label {
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--wt-field-label-rest-size);
  }
  .field-control {
    width: 100%;
    min-width: var(--wt-tap-min);
    min-height: var(--wt-field-height);
    padding: calc(var(--wt-space-3) + var(--wt-font-size-sm)) var(--wt-space-3) var(--wt-space-2);
    border: 0;
    background: transparent;
    color: var(--wt-color-field-value);
    font: inherit;
    text-overflow: ellipsis;
  }
  .field-control::placeholder {
    color: var(--wt-color-text-muted);
    font-style: italic;
  }
  .field:focus-within:not([data-open]) {
    box-shadow: inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-primary);
  }
  .field:focus-within:not([data-open]) .field-label {
    color: var(--wt-color-field-label-focus);
  }
  .field[data-invalid],
  .field[data-invalid]:focus-within {
    box-shadow: inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-danger);
  }
  .field[data-invalid] .field-label,
  .field[data-invalid]:focus-within .field-label {
    color: var(--wt-color-danger);
  }
  .field[data-disabled] {
    background: var(--wt-color-field-fill-disabled);
    box-shadow: none;
    border-bottom: var(--wt-field-line-width) dashed var(--wt-color-field-line);
    cursor: not-allowed;
  }
  .field[data-disabled] .field-control {
    color: var(--wt-color-text-muted);
    cursor: not-allowed;
  }
  .field[data-compact] {
    min-height: var(--wt-tap-min);
  }
  .field[data-compact] .field-control {
    min-height: var(--wt-tap-min);
    padding-block: var(--wt-space-2);
  }
  .field-control:focus-visible {
    outline: none;
  }
`;
```

  The label moves without an animation (no motion to switch off under reduced motion). The
  focused field's 2px line replaces the focus ring on the control (hence `outline: none` on the
  control only); confirm axe's focus checks still pass in the a11y suite. If the
  `no-hardcoded-chrome` scan rejects `-1` in `calc`, write `calc(0px - var(...))` and check the
  `px` rule allows 0 — run the suite to see.

  In `wt-input.ts`: put `fieldStyles` after `baseStyles`; delete the `.label-row`, the old `label`
  and `input` border rules; render:

```ts
    const labelState = fieldLabelState({
      value: this.value,
      hint: this.hint,
      placeholder: this.placeholder,
      type: this.type,
    });
    const showLabel = this.label !== "" && !this.hideLabel;
    return html`
      <div class="row">
        <div
          class=${this.hasEnd ? "field has-end" : "field"}
          part="field"
          data-label=${labelState}
          ?data-invalid=${this.invalid || hasError}
          ?data-disabled=${this.disabled}
          ?data-compact=${!showLabel}
        >
          ${showLabel
            ? html`<label class="field-label" for=${inputId}
                >${this.label}${this.required
                  ? html`<span class="required" data-required aria-hidden="true">*</span>`
                  : nothing}</label
              >`
            : nothing}
          <input
            class="field-control"
            id=${inputId}
            name=${this.name || nothing}
            .value=${this.value}
            type=${this.type}
            autocomplete=${this.autocomplete || nothing}
            placeholder=${this.placeholder || this.hint}
            maxlength=${this.maxlength ?? nothing}
            aria-label=${this.hideLabel && this.label ? this.label : nothing}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-invalid=${this.invalid || hasError}
            aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
            @input=${this.onInput}
          />
          <slot class="end" name="end" @slotchange=${this.onEndSlotChange}></slot>
        </div>
        <slot name="help"></slot>
      </div>
      ${hasHint ? html`<p id=${this.hintId} class="hint" data-hint>${this.hint}</p>` : nothing}
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
```

  with `.row { display: flex; align-items: center; gap: var(--wt-space-2); }` and
  `.row > .field { flex: 1; min-width: 0; }`, and add
  `@property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;`. Keep all three
  end-slot rules, moved onto the new wrapper: the end padding on `.field.has-end .field-control`,
  `.end { display: none; position: absolute; inset-block: 0; inset-inline-end: var(--wt-space-1);
  align-items: center; }` and `.field.has-end .end { display: flex; }` — without the last, the
  password reveal button disappears.

- [ ] **Step 4: Run, see them pass**, plus `src/tap-target-and-focus.test.ts` and
  `src/no-hardcoded-chrome.test.ts` in ui-core, and
  `pnpm --filter @waitron/ui exec vitest run src/tap-target-and-focus.test.ts src/no-hardcoded-chrome.test.ts`.
  Prove two cases by deletion: remove the `:autofill`/value float (set `fieldLabelState` to ignore
  `value`) and see Review Focus 4's case fail; remove `?data-compact` and see the `hide-label`
  height case fail. Restore.
- [ ] **Step 5: Commit** `git commit -s -m "wt-input draws the filled field: label inside, floating when there is a value, a hint or focus (A178)"`.

### Task 3: `wt-textarea`

**Files:**
- Create: `packages/ui-core/src/components/wt-textarea.ts`, `wt-textarea.test.ts`,
  `wt-textarea.a11y.test.ts`; `packages/ui/src/components/wt-textarea.ts` (one-line re-export, as
  `packages/ui/src/components/wt-input.ts` does)
- Modify: `packages/ui-core/src/index.ts`, `packages/ui-core/package.json` (subpath export, beside
  `wt-input`'s), `packages/ui/src/index.ts`, `packages/ui-core/src/tap-target-and-focus.test.ts`
  (the reflected-`disabled` pin gains `"wt-textarea"` — a whole-shape list gaining one name; name
  it in the PR), `packages/ui/src/tap-target-and-focus.test.ts` (same, if its glob reaches the
  re-export), the workbench (`packages/ui/demo/`)

**Interfaces:**
- Consumes: `fieldStyles`, `fieldLabelState` (Task 2).
- Produces: `<wt-textarea>` with `value`, `label`, `name`, `rows` (Number, default 3),
  `maxlength`, `placeholder`, `hint`, `required`, `disabled`, `invalid` (reflected), `error`,
  `hideLabel` (`hide-label`), `spellcheck` (default true; declared
  `@property({ converter: { fromAttribute: (v) => v !== "false" } }) override spellcheck = true;`,
  because HTML reads the attribute `spellcheck="false"` as false and a plain Lit Boolean would read
  it as true), `autocapitalize`; `help` slot;
  `part="control"` on the `<textarea>`; event `wt-change` `{ value: string }` on every `input`.

- [ ] **Step 1: Write the failing tests**, mirroring `wt-input.test.ts`: label association (click
  the label focuses the textarea), the states of Task 2 (rest, float, focused, invalid, disabled,
  compact), `rows` sets the native `rows`, the field box is at least `--wt-field-height` tall and
  grows with `rows`, `hint` is placeholder and description, `maxlength` passes through,
  both `spellcheck="false"` (attribute) and `.spellcheck=${false}` (property) reach the textarea as false, `wt-change` fires once per `input` with `bubbles` and
  `composed` and the native `input` is stopped, `--wt-field-max-width` caps the width, focusing the
  host focuses the textarea. **Review Focus 3:** a form holding an invalid `wt-textarea` —
  `focusFirstInvalid(form)` focuses its `<textarea>`. Axe: every state, both themes.
- [ ] **Step 2: Run, see them fail.**
  `pnpm --filter @waitron/ui-core exec vitest run src/components/wt-textarea`
- [ ] **Step 3: Implement**, following `wt-input.ts` line for line where it applies (same ids from
  `uniqueId("wt-textarea")`, same `dispatchWtChange`, `delegatesFocusShadowRootOptions`), with
  `<textarea class="field-control" part="control" rows=${this.rows} …>` and
  `.field-control { resize: vertical; }`.
- [ ] **Step 4: Run, see them pass**, plus both packages' tap-target and no-hardcoded-chrome suites.
  Break the label association (drop `for`) and see the axe case fail; restore.
- [ ] **Step 5: Commit** `git commit -s -m "wt-textarea: a multi-line field in the filled style (A178)"`.

### Task 4: `wt-price-input` and `wt-number-stepper` in the filled style

**Files:**
- Modify: `packages/ui/src/components/wt-price-input.ts`, `wt-number-stepper.ts`
- Test: their `*.test.ts` and `*.a11y.test.ts`

**Interfaces:**
- Consumes: `fieldStyles`, `fieldLabelState`.
- Produces: `wt-price-input` gains `invalid` (Boolean, reflected), drawn and announced like
  `wt-input`'s.

- [ ] **Step 1: Write the failing tests:** each draws `.field` with the Task 2 states; the price
  field's unit button and currency sign sit inside the field box; the stepper's − and + buttons sit
  either side of the box, outside it, each still `--wt-tap-min` square; the stepper's number keeps its
  baseline (its existing baseline case stays); `wt-price-input invalid` sets `aria-invalid="true"`
  and the danger line with no `error`. Edit, as LOOK changes, the cases pinning the shared border
  seam between amount and unit and the stepper's inline borders; name them. Axe: the new states,
  both themes.
- [ ] **Step 2: Run, see them fail.**
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-price-input src/components/wt-number-stepper`
- [ ] **Step 3: Implement** with the Task 2 structure. Keep every documented part
  (`amount`, `unit`, `currency`) and the `--wt-price-field-width` / `--wt-stepper-field-width`
  rules, which now size the control inside the box. `hide-label` sets `data-compact`. The
  stepper's − and + buttons sit OUTSIDE the field box, one each side, each a `--wt-tap-min` square
  vertically centred on it (spec §5.5); the box between them is an ordinary field whose floated
  label is cut with an ellipsis when longer than the box. Add a case for that: a stepper labelled
  with 40 characters keeps its box at `--wt-stepper-field-width` and its label on one line.
  (2026-10-02: superseded by A178g — the box now widens to its label, and this case was replaced.)
- [ ] **Step 4: Run, see them pass**, plus `src/tap-target-and-focus.test.ts` and
  `src/no-hardcoded-chrome.test.ts`. Then run the consumers that lay these fields out by their
  parts: `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen` and
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/purchase-form src/widgets/extra-list-form`
  (the purchase form's VAT line wraps its money fields; the extras form uses a price field). A
  failing layout assertion there is a STOP unless it pins the LOOK only.
- [ ] **Step 5: Commit** `git commit -s -m "wt-price-input and wt-number-stepper draw the filled field (A178)"`.

### Task 5: `wt-combobox` — the filled trigger, the list panel, and what native selects need

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts`
- Test: `wt-combobox.test.ts`, `wt-combobox.a11y.test.ts`

**Interfaces:**
- Consumes: `fieldStyles`, `fieldLabelState` (trigger: `value` = the chosen label, `placeholder`,
  `hint`).
- Produces:

```ts
export interface ComboboxOption {
  value: string;
  label: string;
  /** A registered wt-icon name, drawn before the label. */
  icon?: string;
  /** Consecutive options with the same group render under one heading. */
  group?: string;
  /** A row that sends `wt-combobox-action` and never becomes the value. */
  action?: true;
}
export const SEARCH_THRESHOLD = 7;
// new properties: search: "always" | "auto" | "never" = "always" (today's behaviour, so existing
// comboboxes and their tests are unchanged); hint = ""; hideLabel (hide-label).
// allow-add shows the search box whatever `search` says; multiple works without one.
// new slot: help
// new event: wt-combobox-action — detail: { value: string }, bubbles, composed
```

- [ ] **Step 1: Write the failing tests:**
  - the trigger is a field box (Task 2 states; `data-label="float"` once a value is chosen, and
    while `hint` or `placeholder` is set), its chevron sits inside the box with at least
    `--wt-space-3` between it and the box's trailing edge (this is A173's check, on the new
    control);
  - opening sets `data-open` on the field box and the focused line and label return to their
    resting colours (computed `box-shadow` colour is `--wt-color-field-line`);
  - rows are `--wt-dropdown-row-height` tall; a hovered row's background is `--wt-color-bg`; the
    chosen row's label is `--wt-font-weight-bold` with a `wt-icon name="check"` at its trailing end;
  - the search box: background `--wt-color-surface`, border `--wt-field-line-width` solid
    `--wt-color-primary`, radius `--wt-radius-md`, and the search area carries `--wt-shadow-1`;
  - no `search` attribute with 2 options → a search box (today's behaviour); `search="auto"`: 7
    options → no search box, 8 → a search box; `"never"` with 20 → none; `"never"` with
    `allow-add` → a search box; `"never"` with `multiple` → none, and Space on the active row
    toggles it (Task 6 covers the keys);
  - `icon`: the row draws `wt-icon[name=…]` with `aria-hidden="true"` before its label;
  - `group`: two groups render two `role="group"` elements, each `aria-labelledby` a heading
    holding the group name; the heading is not a `role="option"`;
  - `action`: clicking an action row sends `wt-combobox-action` `{ value }` (bubbles, composed),
    leaves `value` unchanged and sends no `wt-change`;
  - `hint`: the trigger's `aria-describedby` names a hidden paragraph holding the hint, before the
    error; the hint shows as the trigger's placeholder text while nothing is chosen;
  - `hide-label`: the trigger is named by `label` and the box is compact;
  - `help` slot: as Task 2;
  - **Review Focus 5:** at 390 px, a 120-character chosen label is one line with an ellipsis and
    ends before the chevron.
  Edit, as LOOK changes: the trigger border case (`:97-103` today), the pill-shaped search-box
  case, the hover case if it pins the old row height; name them. Axe, both themes: closed resting,
  closed with a value, open with icons, open with groups, open with an action row, compact, with a
  hint — beside every state the suite already has.
- [ ] **Step 2: Run, see them fail.**
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox`
- [ ] **Step 3: Implement.** Render groups by walking `filteredOptions` and opening a new
  `<li role="presentation"><div role="group" aria-labelledby=…><div id=… class="group-heading">`
  …`</div><ul role="none">`…rows…`</ul></div></li>` whenever `group` changes — then run axe: if
  `aria-required-children` fires on that nesting, use the flat form axe accepts (a `role="group"`
  `<ul>` directly inside the listbox, holding the rows) and record which one passed in the commit.
  The keyboard's row list (Task 6) skips headings: keep `activeIndex` an index into the selectable
  rows, not into the rendered children.
- [ ] **Step 4: Run, see them pass**, plus ui's tap-target and no-hardcoded-chrome suites, and the
  dashboard's existing combobox users:
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/catalogue-screen src/widgets/product-editor src/widgets/allergen-dietary-picker`.
- [ ] **Step 5: Commit** `git commit -s -m "wt-combobox draws the filled field and the approved list, with icons, groups, action rows, a hint and a help slot (A178)"`.

### Task 6: `wt-combobox` — keyboard and screen-reader behaviour of a select

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts`
- Test: `wt-combobox.test.ts`, `wt-combobox.a11y.test.ts`

**Interfaces:**
- Consumes: Task 5's rows and `search` mode.
- Produces: the key table of spec §7.2.

- [ ] **Step 1: Write the failing tests,** one per row of spec §7.2, with `userEvent.keyboard`:
  ArrowDown / ArrowUp / Alt+ArrowDown / Enter / Space on the closed trigger open the list with the
  chosen row (else the first) active, and the list is still open after the key is released (the
  handler prevents the key's default, or the button's own click would close it again); a printable key on a closed searchable trigger opens it with
  that character in the search box; on a closed non-searchable trigger, typing `p` then `a` within
  500 ms makes the first option starting "pa" the value, sends `wt-change` once per change, and
  does not open the list (use fake timers only around the 500 ms reset, then restore real timers —
  CLAUDE.md §4's animation-frame rule); open, ArrowDown on the last row wraps to the first and
  ArrowUp on the first wraps to the last; without a search box, focus is on the
  `<ul role="listbox" tabindex="-1">` and its `aria-activedescendant` names the active row;
  Tab and Shift+Tab close the list without changing the value and focus moves on; arrows skip group
  headings; Enter on an action row sends `wt-combobox-action`.
  **Review Focus 1:** a combobox inside an open `wt-dialog`: Escape with the list open closes the
  list, the dialog's `open` stays true and it sends no `wt-close`; a second Escape closes the
  dialog. The list's `getBoundingClientRect()` is inside the viewport and `matches(":popover-open")`.
  **Review Focus 2:** a `<form>` whose keydown calls `submitOnEnter(event, button)`: Enter on the
  closed trigger opens the list and the button's click handler is not called; with the list open
  and NO active row (search typed that matches nothing), Enter in the search box does not call it
  either.
  **Review Focus 3:** a combobox with `error` inside a form — `focusFirstInvalid(form)` focuses the
  trigger.
  Edit, as LOOK changes only: none expected; the existing "ArrowDown clamps at the end" case, if one
  pins clamping, is a BEHAVIOUR change the owner's §12 point 8 approves — name it.
- [ ] **Step 2: Run, see them fail.** Same command as Task 5.
- [ ] **Step 3: Implement** a `keydown` handler on the trigger, a `keydown` handler on the listbox
  for the no-search mode, `focusout` on the panel that closes it when focus leaves both panel and
  trigger, and wrap-around in the existing search-box handler. Call `preventDefault()` on Enter in
  the search box whether or not a row is active.
- [ ] **Step 4: Run, see them pass.** Prove two by deletion: remove the Enter `preventDefault` when
  no row is active and see Review Focus 2 fail; remove the Escape `stopPropagation` and run Review
  Focus 1 — if it still passes, the open popover's own Escape handling is what keeps the dialog
  open; say so in the commit message and keep the case. Restore.
- [ ] **Step 5: Commit** `git commit -s -m "wt-combobox works from the keyboard like a select: opens on arrows, type-ahead, wrapping, Tab closes (A178)"`.

### Task 7: The contract, the test helper and the icons

**Files:**
- Modify: `packages/ui/src/test-helpers.ts` (add `chooseOption`), `docs/developers/design-system.md`,
  `apps/dashboard/src/icons.ts` (add `check`), `apps/till/src/till-app.ts` (register `chevron-down`,
  `check`), `apps/setup/src/` entry point (register both; find it with
  `grep -rn "customElement\|import \"@waitron/ui\"" apps/setup/src/main.ts apps/setup/src/*.ts | head`),
  `docs/backlog.md`
- Test: `packages/ui/src/harness.test.ts` or a new `test-helpers.test.ts` case for `chooseOption`

**Interfaces:**
- Produces:

```ts
/** Picks `value` on a wt-combobox the way a click on its row does: sets `value` and sends
 * `wt-change` (bubbling, composed). For screen tests that used to set a native select's value. */
export async function chooseOption(el: Element, value: string): Promise<void> {
  const box = el as HTMLElement & { value: string; updateComplete?: Promise<unknown> };
  box.value = value;
  box.dispatchEvent(new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }));
  await box.updateComplete;
}
```

  Apps' tests import it as `@waitron/ui/src/test-helpers.js`, as
  `apps/dashboard/src/screens/sections-screen.test.ts` already imports `expectRowMenusOnScreen`
  from there; `packages/ui`'s coverage config leaves `test-helpers` out, so it adds nothing to
  measure.

- [ ] **Step 1: Write the failing test** for `chooseOption`: on a mounted `wt-combobox` with two
  options, a `wt-change` listener on `document` receives `{ value }` and the trigger shows the
  option's label. Run it, see it fail.
- [ ] **Step 2: Implement, run, see it pass.**
- [ ] **Step 3: Update `design-system.md`:** Forms (the field box, resting and floated label,
  focus, invalid, disabled, compact, the help slot's place — spec §5); the primitives table rows
  for `wt-input` (`hide-label`), `wt-price-input` (`invalid`), `wt-combobox` (spec §7's additions
  and its keyboard), and a new `wt-textarea` row; Tokens → Colour and Structure (spec §6, with the
  ratios and that the line, not the fill, meets 1.4.11); the axe paragraph's list of verified
  states (name the suites run and the date); "Adding a primitive" step 6 (a form field also uses
  `fieldStyles`). Do NOT yet remove the `selectStyles` paragraphs or add the standing rule — A178f
  does, when they become true.
- [ ] **Step 4: LOOK.** Start the dev stack from the worktree (`wa-wt demo <worktree-name>`) and
  open screens built only on the primitives: the dashboard's login, a user's edit dialog, the
  product editor (prices, steppers, comboboxes), the till's enrolment and tender screen, setup's
  first screen. Light and dark, EN and ES, 1280 and 390; till also 1024×768. The native selects
  still look old here; that is expected until A178b–e.
- [ ] **Step 5: Backlog.** Mark A178a done in the A178 entry with the PR number; say which tests
  changed for the look.
- [ ] **Step 6: Commit** `git commit -s -m "Filled fields: the contract in design-system.md, the chooseOption test helper, the dropdown icons (A178)"`,
  then `finish-branch` (full wave: it changes the UI contract).

---

## The move recipe (used by Tasks 8–11)

For each field in the task's table (spec §9), in this order:

1. **Find it**: `grep -n '<select\|<textarea\|<input' <file>`. Read the template, its `@change` /
   `@input` handler, its error and `aria-invalid` wiring, and every test that touches it
   (`grep -rn '<name or selector>' <file's directory> --include='*.test.ts'`).
   Also find every listener on an ANCESTOR that heard this field's native `input` or `change`
   (`grep -n '@input\|@change\|addEventListener("input"\|addEventListener("change"' <file>`): the
   primitives stop the native event, so each such listener moves to `wt-change` (spec §7.3;
   `venue-operations-screen.ts` has one, about line 1127). And find any `updated()` that re-applies
   a select's value after render (`devices-screen.ts`, `printing-rules-screen.ts`) — it goes once
   the field binds `.value`.
2. **Red test first**: in the screen's suite, a case asserting the moved field —
   `root.querySelector('wt-combobox[name="<name>"]')` exists, has the expected `options`, shows the
   stored value (`.value`), and `chooseOption(el, "<other>")` has the effect the old `change` had
   (the same request body, the same state). Run it: it fails because the element is a `<select>`.
3. **Move it.** A native select:

```ts
// before
html`<label>${t("printers.paper_width")}
  <select name="paper-width" @change=${(e: Event) => this.#setWidth((e.target as HTMLSelectElement).value)}>
    ${WIDTHS.map((w) => html`<option value=${w} .selected=${w === this.width}>${w} mm</option>`)}
  </select></label>`;
// after
html`<wt-combobox
  name="paper-width"
  label=${t("printers.paper_width")}
  .options=${WIDTHS.map((w) => ({ value: w, label: `${w} mm` }))}
  .value=${this.width}
  error=${this.widthError}
  @wt-change=${(e: CustomEvent<{ value: string }>) => this.#setWidth(e.detail.value)}
></wt-combobox>`;
```

   Every moved select sets `search="auto"`. A `required` select keeps `required`; an
   `aria-invalid` the screen set becomes `error` (with the sentence) or `invalid`; an
   aria-label-only select becomes `label=… hide-label`; a "Same as …" first option keeps its empty
   value and also becomes the `placeholder` (design-system.md → fallback fields, the single-choice
   combobox bullet). Any other empty first option ("Choose…") becomes the `placeholder`, and stays
   a row too only where the field is not required. **A select with no value bound and no empty
   option** started on its first option; bind `.value` to the first option's value so what is
   saved does not change (`venue-operations-screen.ts`'s `#select`, `canvas-editor-screen.ts`). A `<textarea>` becomes `<wt-textarea>` with
   the same `name`, `maxlength`, `placeholder` and handler on `wt-change`. A date, time or text
   `<input>` becomes `<wt-input type=…>`; note `wt-input` sends `wt-change` on every `input`, where
   a date field may have listened for `change` — check the handler copes with a partial value
   (a date input's `value` is `""` until the date is complete). A `type=number` whole-number input
   becomes `wt-number-stepper` with its `min`.
4. **Drive and read tests through the primitive**: every existing test that set `select.value` and
   sent `change` on this field now calls `chooseOption(root.querySelector('wt-combobox[name=…]'), v)`;
   one that read `<option>` elements reads the combobox's `options`; one that read a
   screen-drawn error paragraph reads the primitive's `error`. Only those lines change, with the
   same expected values (Global Constraints, the three kinds); if any other ASSERTION would have to
   change, STOP.
5. **Remove the file's `selectStyles` (or till `selectStyles`) import and its own `select` rules**
   once it has no select left.
6. **Run the file's suite and its a11y suite**: `pnpm --filter <pkg> exec vitest run <file stem>`.
7. **LOOK** at the screen (light and dark, EN and ES, 1280 and 390; till also 1024×768).

Each task ends: run every touched package's `test:coverage` once (the move deletes `select` CSS and
branches, and can drop a file below the bar), update `docs/backlog.md`'s A178 entry with the PR's
part, commit with `-s`, then `finish-branch`. The light path applies (no risk trigger), Codex
run-it seat.

## PR A178b — Task 8: dashboard screens

**Files:** every file in spec §9.1 except `login-screen.ts` (its hidden helpers stay):
`apps/dashboard/src/screens/{backup,units,floor,profile,printing-rules,roster,device-profiles,my-schedule,staff,dashboard-sales,recipe,printers,devices,receipt,canvas-editor,planned-actual,payments}-screen.ts`
and `apps/dashboard/src/dashboard-app.ts`, with their `*.test.ts`.

- [ ] **Step 1:** Apply the move recipe to every field in spec §9.1, one screen at a time, red test
  first each time. Specifics:
  - `backup-screen.ts`: the keep-count and keep-days template is one template used twice — move it
    once, onto `wt-number-stepper min=1`, keeping both names.
  - `staff-screen.ts`: the status filter's `wt-help-tooltip` goes in the combobox's `help` slot;
    the search becomes `wt-input type="search"` with its visible label.
  - `printers-screen.ts`: the three calibration selects sit inside the calibration wizard; check
    its suite's step-through cases still pass unedited.
  - `dashboard-app.ts`: the sidebar search becomes `wt-input type="search" hide-label` with
    `label=${t("nav.search")}` (or the key its `aria-label` uses today) and the same `placeholder`;
    its `.nav-search` rules go. The dashboard-app suite's sidebar-search cases drive it through
    `wt-change` instead of `input` — a driving change; check the assertions are untouched.
  - `printing-rules-screen.ts`, `devices-screen.ts`: their `updated()` fix-ups that re-apply each
    select's value go (spec §7.3); the existing cases that change a printer or reader and then see
    the stored value restored after a refusal must pass unedited.
  - `backup-screen.ts`: the pasted-key `wt-input` gets its own `label` (today the text sits in a
    `<label>` around it, which does not name the input inside the component); its suite's
    accessible-name or label assertions, if any, must pass unedited.
  - `canvas-editor-screen.ts`: the form-factor selects started on their first option (its comment
    says so, about 771–801) — bind `.value` to it.
- [ ] **Step 2:** `pnpm --filter @waitron/dashboard test:coverage`; LOOK; backlog; commit;
  `finish-branch`.

## PR A178c — Task 9: dashboard widgets

**Files:** every file in spec §9.2 except `autofill-username.ts`, with their tests.

- [ ] **Step 1:** Apply the move recipe. Specifics:
  - `member-list-editor.ts`: its `<optgroup>`s become options carrying `group` (products, then
    sections), with the same labels the optgroups had.
  - `variant-table.ts`: the pricing-unit select in the column heading becomes a `hide-label`
    combobox whose last option is `{ value: "__add__", label: t(…), action: true }`; the
    `wt-combobox-action` handler opens the unit form exactly as the old `__add__` branch did.
    Its test that chose `__add__` and saw the unit form open now fires the action (a driving
    change: `el.dispatchEvent(new CustomEvent("wt-combobox-action", { detail: { value: "__add__" }, bubbles: true, composed: true }))`).
  - `unit-form.ts`: the precision help text visible today becomes the combobox's `hint`. Check
    whether a test asserts that the help text is VISIBLE as a separate line; if so, that is a LOOK
    change named in the PR (the house rule since 2026-09-30 is that a hint is a placeholder).
  - `allergen-picker.ts`: each row's select becomes `hide-label` with `label` set to the allergen's
    name (today the span named it through `aria-labelledby`).
  - `product-editor.ts`: the description becomes `wt-textarea` per language, keeping the
    inherited-value placeholder and the language in the label; the station/course helper, VAT class
    and unit become comboboxes keeping their "Same as …" first options (design-system.md → fallback
    fields). Lane E's PF2b may be changing this file — check first (Global Constraints).
  - `add-content-language.ts`: hundreds of languages — `search="auto"` gives it a search box.
    (2026-10-01, C112: the dialog now puts the country's official languages first in an
    `<optgroup>`, so the combobox sets each option's `group`.)
- [ ] **Step 2:** `pnpm --filter @waitron/dashboard test:coverage`; LOOK; backlog; commit;
  `finish-branch`.

## PR A178d — Task 10: setup and the till

**Files:** spec §9.3 and §9.4; delete `apps/till/src/select-styles.ts`.

- [ ] **Step 1:** Apply the move recipe. Specifics:
  - Setup's fields are wrapped in `<label>`s holding a `wt-help-tooltip`; each tooltip goes in the
    primitive's `help` slot.
  - `restore-screen.ts`: the recovery key becomes `wt-input type="password"` with the reveal button
    in its `end` slot, exactly as `cert-screen.ts` does its passphrase (copy that code).
  - `restore-bucket-screen.ts`: the kit becomes `wt-textarea rows="6" .spellcheck=${false}
    autocapitalize="off"`, monospace through
    `wt-textarea::part(control) { font-family: var(--wt-font-family-mono); }` — check that token
    is declared in `packages/ui-core/src/tokens/structure.css` (read 2026-10-01).
  - `venue-screen.ts`: `venue-screen.test.ts` (about 128–160) reads the province `<option>`s and
    counts 53 including the empty first one; the province is required, so the empty row becomes the
    placeholder and the count becomes 52 — a READING edit whose one changed value is allowed
    (Global Constraints); name it.
  - `till-table-order-screen.ts`: the two course selects become `hide-label` comboboxes; check at
    1024×768 that a basket row still fits on one line, and that the compact box is at least
    `--wt-tap-min` (the ui-core minimum).
  - `line-extras-editor.ts`: the kitchen note becomes `wt-textarea maxlength="200"` with its
    placeholder; it is used by `basket.ts` and `modifier-picker.ts` — run both suites.
  - Delete `apps/till/src/select-styles.ts` once `grep -rn select-styles apps/till/src` is empty.
- [ ] **Step 2:** `pnpm --filter @waitron/setup test:coverage` and
  `pnpm --filter @waitron/till test:coverage` (check memory first — CLAUDE.md §2's browser-run
  rule); LOOK, including the till at 1024×768 and a handheld size; backlog; commit; `finish-branch`.

## PR A178e — Task 11: module screens and the two primitives

**Files:** spec §9.5 and §9.6 (`wt-data-table.ts`'s filter, `wt-floor-canvas.ts`'s zone name).

- [ ] **Step 1:** Apply the move recipe. Specifics:
  - `venue-operations-screen.ts`: its `#select` and `#input` helpers become helpers returning
    `wt-combobox` / `wt-input` / `wt-number-stepper`; the screen reads values with
    `renderRoot.querySelector('[name=…]').value` (about `:190`) — the hosts keep `name` and
    `value`, so the reader stays; prove it with a red test that saves a department through the
    form. `#select` given no value relied on the native first option: bind `.value` to it. The
    form's own `input`/`change` listener that re-checks errors (about `:1127`) moves to
    `wt-change` — red test: fix a field after a failed save and its error clears. Its tests that
    read `[data-field-error]` paragraphs (six) read the primitive's `error` instead (READING). The
    two settings with a hint linked from outside the label take the combobox's `hint`.
  - `wt-data-table.ts`: each column `filter` draws a `wt-combobox hide-label` with
    `label=${filter.label}` and the options `allLabel` + `filter.options`; `wt-filter-change` and
    the remembered-filter behaviour stay exactly as they are (its suite's filter cases must pass
    unedited except for driving and reading lines). The case reading
    `select[data-filter="status"]` and expecting a focus ring (about `:1226-1243`) becomes a LOOK
    edit: the filter's focus indicator is now the 2px primary line. Name it. Remove `selectStyles`
    from the table.
  - `wt-floor-canvas.ts`: the zone name becomes `wt-input`; its own `.zone input` rules go.
- [ ] **Step 2:** `test:coverage` for `@waitron/adjustments`, `@waitron/bookings`,
  `@waitron/media`, `@waitron/payments-sumup`, `@waitron/venue-service`, `@waitron/ui`; then the
  dashboard suites that use table filters (`grep -rln "filter:" apps/dashboard/src --include='*.ts' | grep -v test`)
  with `pnpm --filter @waitron/dashboard test:coverage`. LOOK; backlog; commit; `finish-branch`.

## PR A178f — Task 12: the guard, the clean-up, the rule

**Files:**
- Create: `scripts/native-form-fields.test.ts`
- Modify: `packages/ui/src/base-styles.ts` (delete `selectStyles`), `packages/ui/src/index.ts`,
  `packages/ui/src/base-styles.test.ts` (its `selectStyles` cases go with it — a LOOK pin of a
  deleted export; name it), `docs/developers/design-system.md`, `docs/developers/conventions-ui.md`,
  `CLAUDE.md`, `docs/backlog.md`

- [ ] **Step 1: Write the guard**, failing on today's tree only if a field was missed:

```ts
/**
 * A screen does not draw its own form field (docs/developers/design-system.md → Forms).
 *
 * Weaker than its name: it reads TEXT — the template and string literals of each non-test `.ts`
 * file under `apps/` and `packages/` — so a field built with `document.createElement`, inserted
 * with `unsafeHTML`, written in an `.html`, `.js` or `.mjs` file, or whose tag name is split across
 * a `${…}` boundary is invisible to it; and the files in EXEMPT_FILES are not read at all, so a
 * second field added inside one passes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ROOTS = ["apps", "packages"];
const NOT_TEXT = new Set(["checkbox", "radio", "file", "range", "color", "hidden", "button", "submit", "reset", "image"]);

/** The primitives whose job is to draw the native control. */
const EXEMPT_FILES = new Set([
  "packages/ui-core/src/components/wt-input.ts",
  "packages/ui-core/src/components/wt-textarea.ts",
  "packages/ui/src/components/wt-combobox.ts",
  "packages/ui/src/components/wt-price-input.ts",
  "packages/ui/src/components/wt-number-stepper.ts",
  "packages/ui/src/components/wt-data-table.ts",
]);

/** Fields that are not fields: the list shrinks; it does not grow. */
const ALLOWED: ReadonlyArray<{ file: string; reason: string }> = [
  { file: "apps/dashboard/src/screens/login-screen.ts", reason: "hidden username inputs for the browser's password manager" },
  { file: "apps/dashboard/src/widgets/autofill-username.ts", reason: "hidden username input for the browser's password manager" },
  { file: "apps/print-agent/src/setup-page.ts", reason: "a string-built page served by the print agent, which may import no other workspace package (CLAUDE.md §3)" },
];

/** Lines of `source` holding a hand-drawn field. Reads each template's raw source text with every
 * `${…}` blanked to spaces (newlines kept), so offsets map straight back to lines, an attribute
 * written after a binding is still seen, and a `>` inside a binding does not end the tag. A
 * template nested inside a binding is read again on its own, so lines are kept as a set. */
export function offendingFields(source: string): number[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  const scan = (node: ts.Node) => {
    const start = node.getStart();
    let text = node.getText();
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        const from = span.expression.getStart() - start;
        const to = span.expression.getEnd() - start;
        text = text.slice(0, from) + blank(text.slice(from, to)) + text.slice(to);
      }
    }
    for (const match of text.matchAll(/<(select|textarea|input)\b([^>]*)/gi)) {
      if (match[1]!.toLowerCase() === "input") {
        const type = /\btype\s*=\s*["']?([a-z-]+)/i.exec(match[2] ?? "")?.[1]?.toLowerCase();
        if (type !== undefined && NOT_TEXT.has(type)) continue;
      }
      lines.add(file.getLineAndCharacterOfPosition(start + match.index!).line + 1);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node) || ts.isTemplateExpression(node))
      scan(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...lines].sort((a, b) => a - b);
}
```

  (A bound type — `type=${t}` — is blanked, so it is reported: the guard cannot know what it will
  be. If that reports a field the move tasks should have made a primitive, fix the field, not the
  regex. The plan review ran an earlier version of this function over `main` at `b02c0e381` and it
  reported 98 places, including two checkbox and radio inputs whose `type` came after a binding —
  the reason for the blanking.) Then the walk, copied from
  `scripts/pinned-actions-column.test.ts`'s `sourceFilesIn` (non-test `.ts`, skipping
  `node_modules`, `dist`, dot-entries, and checking `isDirectory` first), and these cases:
  - `no screen draws its own form field`: every non-exempt, non-allowed file → `offendingFields`
    → `path:line` strings → `expect(offenders.sort()).toEqual([])`;
  - `every allowed file still draws one` (an entry that matches nothing fails);
  - `every exempt file exists`;
  - `reaches both roots` (at least one file read under each of `apps/` and `packages/`);
  - negative controls on strings: `` html`<select name="x">` `` → 1 offender;
    `` html`<input type="checkbox">` `` → 0; `` html`<input name="x">` `` → 1;
    `` html`<input type=${t}>` `` → 1; `` html`<textarea>` `` → 1; a `// <select>` comment → 0;
    `` html`<input type="date">` `` → 1; `` html`<input .checked=${x} type="radio">` `` → 0;
    `` html`<input @change=${(e) => f(e)} type="checkbox">` `` → 0; a `<select` at column 0 of a
    template's second line reports that second line.
- [ ] **Step 2: Run it**: `pnpm exec vitest run scripts/native-form-fields.test.ts`. Expected: all
  pass on the tree A178b–e left. If it reports a field none of Tasks 8–11 moved, move it in this
  pull request with the recipe (and say so in the PR) — never add it to `ALLOWED` to get green. Prove it by planting a `<select>` in a screen and seeing it fail
  with that file's line; remove the plant (keep the file's final newline — check with
  `git diff --stat`).
- [ ] **Step 3: Delete `selectStyles`** and its export; `grep -rn selectStyles apps packages` must
  be empty; drop its `base-styles.test.ts` cases (named in the PR).
- [ ] **Step 4: The rule and the prune.**
  - `design-system.md` → Forms: add "A screen does not draw its own form field" with the guard and
    its hedge in one line; remove every paragraph naming `selectStyles` (Structure's field-width
    notes, "Not covered by `selectStyles`" and the rest — `grep -n selectStyles` the file); merge
    the fallback subsection's `<select>` bullet into the single-choice `wt-combobox` bullet.
  - `conventions-ui.md` and CLAUDE.md §3: delete the "A Lit `<select>` whose `<option>`s come from
    a `${…}` expression marks the chosen option with `.selected`" rule and its receipt (superseded:
    no native select remains, and the guard stops a new one); add the one-line rule "A screen does
    not draw its own form field" with the guard named and its hedge (CLAUDE.md §7). Run
    `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
  - `docs/backlog.md`: A178 done; **A173 done (moot)** with the note "no native `<select>` remains
    — `scripts/native-form-fields.test.ts` passes, and the dropdown's chevron sits inside the field
    box's padding (Task 5's chevron case)"; **A175 narrowed** to `wt-data-table`'s own search box
    (spec §9.6).
- [ ] **Step 5:** `pnpm --filter @waitron/ui test:coverage`; commit; `finish-branch`.

---

## Self-review notes (for the reviewer of this plan)

- Spec §5 → Tasks 2–5; §6 → Task 1; §7 → Tasks 5–6; §8 → Task 3; §9 → Tasks 8–11; §10 → Task 12;
  §11 → Tasks 7 and 12.
- The field lists in Tasks 8–11 point at spec §9's tables rather than repeating them, because line
  numbers drift and the recipe re-finds each field by `grep` first.
