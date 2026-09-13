# wt-combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `wt-combobox`, a new `packages/ui` design-system primitive providing a searchable
single-select and multi-select dropdown, with an optional "add new option" row.

**Architecture:** One Lit custom element (`WtCombobox`), toggled between single- and multi-select
behaviour by its `multiple` boolean attribute — mirroring native `<select multiple>` — rather than
two separate elements. It reuses two already-proven patterns from this codebase instead of inventing
new ones: `wt-input`'s labelled-field/required/error/disabled shell, and `wt-row-actions`' native
Popover API disclosure (open/close, Escape handling, viewport-clamped positioning).

**Tech Stack:** Lit (TypeScript), native browser Popover API, `@vitest/browser` + Playwright
(real Chromium) for tests, `axe-core` for accessibility tests. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-13-wt-combobox-design.md`

## Global Constraints

Copied verbatim from the spec and the design-system conventions it builds on — every task below
implicitly must satisfy all of these:

- No literal hex/rgb/named colours and no literal px (beyond a 1px hairline) / rem / em sizing
  anywhere in `static styles` — everything reads a `--wt-*` token. Enforced by
  `packages/ui/src/no-hardcoded-chrome.test.ts`, which discovers `src/components/*.ts`
  automatically; nothing needs registering there.
- Every new interactive primitive gets `static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true }` and gives its real hit-target element (not just `:host`) `min-width`/`min-height: var(--wt-tap-min)`.
- Custom events are named `wt-*`, carry data in `detail`, are dispatched with `bubbles: true, composed: true`, and the native event that triggered them is `stopPropagation()`-ed first — use the existing `dispatchWtChange` helper from `packages/ui/src/interactive.ts` for `wt-change`, exactly as `wt-input`/`wt-switch` do.
- Every text property visible to an operator (`countLabel`, `noResultsLabel`, `searchPlaceholder`, `addLabel`) ships a plain-English default so nothing renders blank unconfigured, but the primitive never assumes that default is correct for a real deployment — matches the verified `wt-data-table` precedent (`emptyMessage`/`loadingMessage`), not an invented stricter rule.
- `options` is the consumer's full list — no async search, no per-option `disabled` (spec's stated v1 non-goals).
- No native `ElementInternals` form association — `wt-change` plus consumer-side wiring only, per `docs/developers/design-system.md` § Forms.
- A new primitive needs, in `packages/ui/src/components/`: the file itself, a token-painting test, and a `<name>.a11y.test.ts` covering every meaningfully distinct accessibility-relevant state in both light and dark themes — and it must be added to the workbench (`packages/ui/demo/main.ts`) and the Primitives table in `docs/developers/design-system.md`.
- Component tests run in real Chromium via `@vitest/browser` (`pnpm --filter @waitron/ui test` /
  `test:coverage`), never jsdom.

---

## File Structure

- **Create** `packages/ui/src/components/wt-combobox.ts` — the component. Exports `WtCombobox` and
  the `ComboboxOption` interface.
- **Create** `packages/ui/src/components/wt-combobox.test.ts` — behavioural tests (real Chromium).
- **Create** `packages/ui/src/components/wt-combobox.a11y.test.ts` — axe accessibility tests.
- **Modify** `packages/ui/src/index.ts` — export `WtCombobox` and `ComboboxOption`.
- **Modify** `packages/ui/demo/main.ts` — register the `chevron-down` icon (not yet used by any
  workbench primitive) and add a `wt-combobox` example to each theme panel.
- **Modify** `docs/developers/design-system.md` — add `wt-combobox` to the Primitives table.

No other package is touched. Wiring this primitive into a real screen (e.g. replacing
`apps/dashboard/src/widgets/allergen-picker.ts`) is out of scope — this plan ships the primitive
only, per the spec.

## Interfaces

```ts
export interface ComboboxOption {
  value: string;
  label: string;
}
```

`WtCombobox` public properties (all on the class built up across the tasks below):

```ts
options: ComboboxOption[]              // default []
multiple: boolean                      // reflected, default false
value: string                          // default "" — meaningful when !multiple
values: string[]                       // default [] — meaningful when multiple
allowAdd: boolean                      // reflected as allow-add, default false
label: string                          // default ""
name: string                           // default ""
placeholder: string                    // default ""
error: string                          // default ""
required: boolean                      // reflected, default false
disabled: boolean                      // reflected, default false
invalid: boolean                       // reflected, default false
countLabel: (count: number) => string  // default (count) => `${count} selected`
noResultsLabel: string                 // default "No results"
searchPlaceholder: string              // default "Search"
addLabel: (text: string) => string     // default (text) => `Add '${text}'`
```

Events: `wt-change` (`detail: { value: string }` when `!multiple`, `detail: { values: string[] }`
when `multiple`), `wt-combobox-add` (`detail: { text: string }`).

---

### Task 1: Scaffold, trigger, and popover open/close

**Files:**
- Create: `packages/ui/src/components/wt-combobox.ts`
- Create: `packages/ui/src/components/wt-combobox.test.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/demo/main.ts`

**Interfaces:**
- Produces: `WtCombobox` (custom element `wt-combobox`), `ComboboxOption`. Public properties for
  this task: `label`, `disabled`. Internal: `@state() private expanded`; `@query(".trigger")
  trigger`, `@query("[popover]") popup`.

This task ships the empty shell: a labelled trigger button that opens/closes an (empty-for-now)
popover panel, positioned and dismissed exactly like `wt-row-actions`. Later tasks fill the panel.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/components/wt-combobox.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-combobox.js";
import type { WtCombobox } from "./wt-combobox.js";

afterEach(cleanup);

async function mountCombobox(html = '<wt-combobox label="Dietary tags"></wt-combobox>') {
  const el = (await mount(html)) as WtCombobox;
  const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
  const popup = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  return { el, trigger, popup };
}

test("renders its label", async () => {
  const { el } = await mountCombobox();
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Dietary tags");
});

test("opens the panel on trigger click and reflects aria-expanded", async () => {
  const { trigger, popup } = await mountCombobox();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  expect(popup.matches(":popover-open")).toBe(true);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
});

test("closes on Escape and returns focus to the trigger", async () => {
  const { el, trigger, popup } = await mountCombobox();
  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("positions the popup against the trigger before the first painted frame", async () => {
  const { trigger, popup } = await mountCombobox();
  const firstFrame = new Promise<DOMRect>((resolve) => {
    trigger.addEventListener(
      "click",
      () => requestAnimationFrame(() => resolve(popup.getBoundingClientRect())),
      { once: true },
    );
  });
  await userEvent.click(trigger);
  const bounds = await firstFrame;
  const anchor = trigger.getBoundingClientRect();
  expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
  expect(bounds.left).toBeCloseTo(anchor.left, 0);
});

test("does not open when disabled", async () => {
  const { trigger, popup } = await mountCombobox(
    '<wt-combobox label="Dietary tags" disabled></wt-combobox>',
  );
  await userEvent.click(trigger, { force: true });
  expect(popup.matches(":popover-open")).toBe(false);
});

test("meets the tap target and paints from the theme tokens", async () => {
  const { trigger } = await mountCombobox();
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(getComputedStyle(trigger).borderColor).toBe("rgb(1, 2, 3)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: FAIL — `wt-combobox.js` does not exist / module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/ui/src/components/wt-combobox.ts`:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";
import "./wt-icon.js";

export interface ComboboxOption {
  value: string;
  label: string;
}

@customElement("wt-combobox")
export class WtCombobox extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .label-row {
        display: flex;
        align-items: center;
        margin-bottom: var(--wt-space-1);
      }

      label {
        display: block;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      .trigger:disabled {
        ${disabledStyles}
      }

      .chevron {
        flex: none;
      }

      [popover] {
        position: fixed;
        margin: 0;
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
    `,
  ];

  @property() label = "";
  @property({ type: Boolean, reflect: true }) disabled = false;

  @state() private expanded = false;

  @query(".trigger") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;

  private readonly labelId = uniqueId("wt-combobox-label");

  private onTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.disabled) return;
    if (this.popup.matches(":popover-open")) {
      this.popup.hidePopover();
    } else {
      this.popup.showPopover();
      this.positionPopup();
    }
  }

  private positionPopup(): void {
    const anchor = this.trigger.getBoundingClientRect();
    const popup = this.popup.getBoundingClientRect();
    this.popup.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - popup.width - 8))}px`;
    this.popup.style.top = `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
    this.popup.style.width = `${anchor.width}px`;
  }

  private onToggle(event: ToggleEvent): void {
    this.expanded = event.newState === "open";
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || !this.popup.matches(":popover-open"))
      return;
    event.preventDefault();
    event.stopPropagation();
    this.popup.hidePopover();
    this.trigger.focus();
  }

  override render() {
    return html`
      ${
        this.label
          ? html`<div class="label-row"><label id=${this.labelId}>${this.label}</label></div>`
          : nothing
      }
      <button
        type="button"
        class="trigger"
        aria-haspopup="listbox"
        aria-expanded=${this.expanded}
        aria-labelledby=${this.label ? this.labelId : nothing}
        popovertarget="panel"
        ?disabled=${this.disabled}
        @click=${this.onTriggerClick}
        @keydown=${this.onKeydown}
      >
        <span class="value"></span>
        <wt-icon class="chevron" name="chevron-down"></wt-icon>
      </button>
      <div id="panel" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-combobox": WtCombobox;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire into the barrel export and the workbench**

Modify `packages/ui/src/index.ts` — add, after the `WtTabs` export line:

```ts
export { WtCombobox, type ComboboxOption } from "./components/wt-combobox.js";
```

Modify `packages/ui/demo/main.ts`:
- Add `import "../src/components/wt-combobox.js";` beside the other component imports.
- Add `"chevron-down"` to the `registerIcons` call (a simple down-pointing chevron path):

```ts
registerIcons({
  check: "M2 8 L6 12 L14 4",
  cart: "M1 2 h3 l2 8 h7 l2 -6 H5",
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
  "chevron-down": "M3 6 L8 11 L13 6",
});
```

- Add a combobox to each theme `panel(...)` template, inside the `<wt-card raised>` block, right
  after the `wt-switch` row:

```html
<div class="row" style="margin-top:16px">
  <wt-combobox label="Dietary tags" class="demo-combobox"></wt-combobox>
</div>
```

(The `demo-combobox` class and its `options`/`allowAdd` wiring are added in Task 8, once the
component can render a list.)

- [ ] **Step 6: Run the full package suite and the workbench**

Run: `pnpm --filter @waitron/ui exec vitest run`
Expected: PASS, including the pre-existing `no-hardcoded-chrome.test.ts` suite (it discovers
`WtCombobox` automatically).

Run: `pnpm --filter @waitron/ui dev` and open `http://localhost:5180` — confirm the "Dietary tags"
trigger renders in both panels, opens an empty panel below it, and closes on Escape or a second
click. Stop the dev server after checking.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/wt-combobox.ts packages/ui/src/components/wt-combobox.test.ts \
  packages/ui/src/index.ts packages/ui/demo/main.ts
git commit -s -m "Add wt-combobox scaffold: labelled trigger and popover open/close"
```

---

### Task 2: Options list, search filtering, and the no-results state

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts`
- Modify: `packages/ui/src/components/wt-combobox.test.ts`

**Interfaces:**
- Consumes: the Task 1 shell (`trigger`, `popup`, `onToggle`, `onKeydown`, `positionPopup`).
- Produces: `options: ComboboxOption[]`, `noResultsLabel: string`, `searchPlaceholder: string`;
  internal `@state() private search`; a `listboxId`; the private getter `filteredOptions`.

- [ ] **Step 1: Write the failing test**

Add to `wt-combobox.test.ts`:

```ts
const TAGS = [
  { value: "gluten-free", label: "Gluten-free" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
];

async function mountWithOptions() {
  const mounted = await mountCombobox();
  mounted.el.options = TAGS;
  await mounted.el.updateComplete;
  return mounted;
}

test("lists every option when the panel opens", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect([...rows].map((row) => row.textContent?.trim())).toEqual([
    "Gluten-free",
    "Vegan",
    "Vegetarian",
  ]);
});

test("filters the option list as the search box is typed into", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "veg");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect([...rows].map((row) => row.textContent?.trim())).toEqual(["Vegan", "Vegetarian"]);
});

test("filtering is case-insensitive", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "VEG");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(2);
});

test("shows noResultsLabel when nothing matches and allowAdd is off", async () => {
  const { el, trigger } = await mountWithOptions();
  el.noResultsLabel = "Nothing found";
  await el.updateComplete;
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "zzz");
  expect(el.shadowRoot!.querySelector(".empty")?.textContent).toBe("Nothing found");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(0);
});

test("focuses the search box on open, and Escape returns focus to the trigger from there", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(el.shadowRoot!.activeElement).toBe(search);
  await userEvent.type(search, "veg");
  await userEvent.keyboard("{Escape}");
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("resets the search box each time the panel is reopened", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "veg");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(trigger);
  expect(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!.value).toBe("");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: FAIL — no `.search` input and no `[role="option"]` elements exist yet.

- [ ] **Step 3: Write the minimal implementation**

Modify `packages/ui/src/components/wt-combobox.ts`:

Add to the imports: `state` is already imported. Add the new styles (append inside the existing
`css` template, after the `[popover]` rule):

```css
.search {
  width: 100%;
  min-height: var(--wt-tap-min);
  margin-bottom: var(--wt-space-2);
  padding: var(--wt-space-2) var(--wt-space-3);
  border: 1px solid var(--wt-color-border);
  border-radius: var(--wt-radius-full);
  background: var(--wt-color-bg);
  color: var(--wt-color-text);
  font: inherit;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(60vh, calc(var(--wt-tap-min) * 6));
  overflow-y: auto;
}

.option {
  display: flex;
  align-items: center;
  gap: var(--wt-space-2);
  min-height: var(--wt-tap-min);
  padding: var(--wt-space-2) var(--wt-space-3);
  border-radius: var(--wt-radius-md);
  cursor: pointer;
}

.empty {
  padding: var(--wt-space-2) var(--wt-space-3);
  color: var(--wt-color-text-muted);
}
```

Add new properties/state/id, and the `filteredOptions` getter (near the existing property
declarations):

```ts
@property({ attribute: false }) options: ComboboxOption[] = [];
@property() noResultsLabel = "No results";
@property() searchPlaceholder = "Search";

@state() private search = "";

@query(".search") private searchInput!: HTMLInputElement;

private readonly listboxId = uniqueId("wt-combobox-listbox");

private get filteredOptions(): ComboboxOption[] {
  const query = this.search.trim().toLowerCase();
  if (!query) return this.options;
  return this.options.filter((option) => option.label.toLowerCase().includes(query));
}

private onSearchInput(event: Event): void {
  this.search = (event.target as HTMLInputElement).value;
}
```

Reset `search` and refocus the search box on open — modify `onTriggerClick`'s `else` branch:

```ts
} else {
  this.search = "";
  this.popup.showPopover();
  this.positionPopup();
  this.searchInput.focus();
}
```

Replace the empty `<div id="panel" popover ...></div>` in `render()` with:

```ts
<div id="panel" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}>
  <input
    class="search"
    type="text"
    placeholder=${this.searchPlaceholder}
    aria-label=${this.label || this.searchPlaceholder}
    aria-controls=${this.listboxId}
    .value=${this.search}
    @input=${this.onSearchInput}
  />
  <ul id=${this.listboxId} class="list" role="listbox">
    ${this.filteredOptions.map(
      (option) => html`<li role="option" aria-selected="false">${option.label}</li>`,
    )}
    ${
      this.filteredOptions.length === 0
        ? html`<li class="empty" role="presentation">${this.noResultsLabel}</li>`
        : nothing
    }
  </ul>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-combobox.ts packages/ui/src/components/wt-combobox.test.ts
git commit -s -m "wt-combobox: render and filter the option list"
```

---

### Task 3: Keyboard navigation

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts`
- Modify: `packages/ui/src/components/wt-combobox.test.ts`

**Interfaces:**
- Consumes: `filteredOptions`, `listboxId`, `searchInput`.
- Produces: internal `@state() private activeIndex`; `onSearchKeydown`; option rows get stable
  `id="${listboxId}-${index}"` and an `.active` class; the search input carries `role="combobox"`,
  `aria-expanded`, `aria-activedescendant`.

- [ ] **Step 1: Write the failing test**

Add to `wt-combobox.test.ts`:

```ts
test("arrow keys move the active option, reflected in aria-activedescendant", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.focus();
  await userEvent.keyboard("{ArrowDown}");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect(search.getAttribute("aria-activedescendant")).toBe(rows[0].id);
  expect(rows[0].classList.contains("active")).toBe(true);
  await userEvent.keyboard("{ArrowDown}");
  expect(search.getAttribute("aria-activedescendant")).toBe(rows[1].id);
  await userEvent.keyboard("{ArrowUp}");
  expect(search.getAttribute("aria-activedescendant")).toBe(rows[0].id);
});

test("ArrowUp at the first row and ArrowDown at the last row do not wrap or go out of range", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.focus();
  await userEvent.keyboard("{ArrowUp}");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')[0].classList.contains("active")).toBe(
    true,
  );
  await userEvent.keyboard("{End}");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect(rows[rows.length - 1].classList.contains("active")).toBe(true);
  await userEvent.keyboard("{ArrowDown}");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')[rows.length - 1].classList).toContain(
    "active",
  );
});

test("Home and End jump to the first and last option", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.focus();
  await userEvent.keyboard("{End}");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect(rows[rows.length - 1].classList.contains("active")).toBe(true);
  await userEvent.keyboard("{Home}");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')[0].classList.contains("active")).toBe(
    true,
  );
});

test("typing resets the active row to the first match", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "veg");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')[0].classList.contains("active")).toBe(
    true,
  );
});

test("the search input carries combobox ARIA wiring", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(search.getAttribute("role")).toBe("combobox");
  expect(search.getAttribute("aria-expanded")).toBe("true");
  expect(search.getAttribute("aria-controls")).toBe(
    el.shadowRoot!.querySelector('[role="listbox"]')!.id,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: FAIL — no `role="combobox"`, no `.active` class, arrow keys do nothing.

- [ ] **Step 3: Write the minimal implementation**

Add styling for the active row (append to `.option` rule area):

```css
.option.active {
  outline: var(--wt-focus-ring);
  outline-offset: calc(-1 * var(--wt-focus-offset));
}
```

Add state and the keydown handler:

```ts
@state() private activeIndex = -1;

private get rowCount(): number {
  return this.filteredOptions.length;
}

private onSearchInput(event: Event): void {
  this.search = (event.target as HTMLInputElement).value;
  this.activeIndex = this.rowCount > 0 ? 0 : -1;
}

private onSearchKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, this.rowCount - 1);
      return;
    case "ArrowUp":
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
      return;
    case "Home":
      event.preventDefault();
      this.activeIndex = 0;
      return;
    case "End":
      event.preventDefault();
      this.activeIndex = this.rowCount - 1;
      return;
    default:
      return;
  }
}
```

Also reset `activeIndex` alongside `search` when the panel opens (in `onTriggerClick`):

```ts
} else {
  this.search = "";
  this.activeIndex = this.options.length > 0 ? 0 : -1;
  this.popup.showPopover();
  this.positionPopup();
  this.searchInput.focus();
}
```

Update the search `<input>` and the option `<li>` rendering in `render()`:

```ts
<input
  class="search"
  type="text"
  role="combobox"
  aria-expanded="true"
  placeholder=${this.searchPlaceholder}
  aria-label=${this.label || this.searchPlaceholder}
  aria-controls=${this.listboxId}
  aria-activedescendant=${
    this.activeIndex >= 0 ? `${this.listboxId}-${this.activeIndex}` : nothing
  }
  .value=${this.search}
  @input=${this.onSearchInput}
  @keydown=${this.onSearchKeydown}
/>
<ul id=${this.listboxId} class="list" role="listbox">
  ${this.filteredOptions.map(
    (option, index) => html`
      <li
        id=${`${this.listboxId}-${index}`}
        class=${index === this.activeIndex ? "option active" : "option"}
        role="option"
        aria-selected="false"
      >
        ${option.label}
      </li>
    `,
  )}
  ${
    this.filteredOptions.length === 0
      ? html`<li class="empty" role="presentation">${this.noResultsLabel}</li>`
      : nothing
  }
</ul>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-combobox.ts packages/ui/src/components/wt-combobox.test.ts
git commit -s -m "wt-combobox: keyboard navigation over the option list"
```

---

### Task 4: Selection — single and multiple

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts`
- Modify: `packages/ui/src/components/wt-combobox.test.ts`

**Interfaces:**
- Consumes: `filteredOptions`, `activeIndex`, `onSearchKeydown` (extended with `Enter`).
- Produces: `value: string`, `values: string[]`, `multiple: boolean`, `countLabel: (count: number)
  => string`; `wt-change` events; the closed-state trigger text; the multi-select checkbox visual.

- [ ] **Step 1: Write the failing test**

Add to `wt-combobox.test.ts`:

```ts
test("clicking an option selects it, closes the panel, and emits wt-change (single-select)", async () => {
  const { el, trigger, popup } = await mountWithOptions();
  let received: string | undefined;
  el.addEventListener("wt-change", (e) => {
    received = (e as CustomEvent<{ value: string }>).detail.value;
  });
  await userEvent.click(trigger);
  await userEvent.click(el.shadowRoot!.querySelectorAll('[role="option"]')[1]);
  expect(received).toBe("vegan");
  expect(el.value).toBe("vegan");
  expect(popup.matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("Vegan");
});

test("Enter on the active option selects it", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(el.value).toBe("gluten-free");
  void search;
});

test("shows the placeholder when nothing is selected", async () => {
  const { el } = await mountWithOptions();
  el.placeholder = "Choose a tag";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("Choose a tag");
});

test("multi-select: clicking an option toggles it, keeps the panel open, and emits values", async () => {
  const { el, trigger, popup } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  el.options = TAGS;
  await el.updateComplete;
  const received: string[][] = [];
  el.addEventListener("wt-change", (e) => {
    received.push((e as CustomEvent<{ values: string[] }>).detail.values);
  });
  await userEvent.click(trigger);
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  await userEvent.click(rows[0]);
  await userEvent.click(rows[1]);
  expect(el.values).toEqual(["gluten-free", "vegan"]);
  expect(received).toEqual([["gluten-free"], ["gluten-free", "vegan"]]);
  expect(popup.matches(":popover-open")).toBe(true);
  await userEvent.click(rows[0]);
  expect(el.values).toEqual(["vegan"]);
});

test("the listbox is aria-multiselectable only in multiple mode", async () => {
  const { el: single, trigger: singleTrigger } = await mountWithOptions();
  await userEvent.click(singleTrigger);
  expect(single.shadowRoot!.querySelector('[role="listbox"]')!.getAttribute(
    "aria-multiselectable",
  )).toBe("false");

  const { el: multi, trigger: multiTrigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  multi.options = TAGS;
  await multi.updateComplete;
  await userEvent.click(multiTrigger);
  expect(multi.shadowRoot!.querySelector('[role="listbox"]')!.getAttribute(
    "aria-multiselectable",
  )).toBe("true");
});

test("multi-select renders a checkbox per option reflecting its selected state", async () => {
  const { el, trigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  el.options = TAGS;
  el.values = ["vegan"];
  await el.updateComplete;
  await userEvent.click(trigger);
  const boxes = el.shadowRoot!.querySelectorAll<HTMLInputElement>('.option input[type="checkbox"]');
  expect([...boxes].map((box) => box.checked)).toEqual([false, true, false]);
});

test("multi-select shows the single label for one selection and countLabel for more than one", async () => {
  const { el } = await mountCombobox('<wt-combobox label="Dietary tags" multiple></wt-combobox>');
  el.options = TAGS;
  el.countLabel = (count) => `${count} tags`;
  el.values = ["vegan"];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("Vegan");
  el.values = ["vegan", "vegetarian"];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("2 tags");
});

test("wt-change bubbles and crosses shadow boundaries", async () => {
  const { mountInShadowRoot } = await import("../test-helpers.js");
  const el = (await mountInShadowRoot(
    '<wt-combobox label="Dietary tags"></wt-combobox>',
  )) as WtCombobox;
  el.options = TAGS;
  await el.updateComplete;
  let received: CustomEvent<{ value: string }> | undefined;
  document.addEventListener(
    "wt-change",
    (e) => {
      received = e as CustomEvent<{ value: string }>;
    },
    { once: true },
  );
  const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
  await userEvent.click(trigger);
  await userEvent.click(el.shadowRoot!.querySelectorAll('[role="option"]')[0]);
  expect(received?.detail.value).toBe("gluten-free");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: FAIL — clicking an option does nothing yet, `.value` is always empty.

- [ ] **Step 3: Write the minimal implementation**

Add styling for the checkbox and the value/placeholder text (append to the stylesheet):

```css
.value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value.placeholder {
  color: var(--wt-color-text-muted);
}

.option input[type="checkbox"] {
  pointer-events: none;
  accent-color: var(--wt-color-primary);
}
```

Add the new properties, the selection helpers, and `dispatchWtChange`:

```ts
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";
```

```ts
@property({ type: Boolean, reflect: true }) multiple = false;
@property() value = "";
@property({ attribute: false }) values: string[] = [];
@property() placeholder = "";
@property({ attribute: false }) countLabel: (count: number) => string = (count) =>
  `${count} selected`;

private isSelected(optionValue: string): boolean {
  return this.multiple ? this.values.includes(optionValue) : this.value === optionValue;
}

private get selectedText(): string {
  if (this.multiple) {
    if (this.values.length === 0) return "";
    if (this.values.length === 1) {
      return this.options.find((o) => o.value === this.values[0])?.label ?? "";
    }
    return this.countLabel(this.values.length);
  }
  return this.options.find((o) => o.value === this.value)?.label ?? "";
}

private commitSelection(optionValue: string, sourceEvent: Event): void {
  if (this.multiple) {
    this.values = this.values.includes(optionValue)
      ? this.values.filter((v) => v !== optionValue)
      : [...this.values, optionValue];
    dispatchWtChange(this, sourceEvent, { values: this.values });
  } else {
    this.value = optionValue;
    dispatchWtChange(this, sourceEvent, { value: this.value });
    this.closeAndReturnFocus();
  }
}

private closeAndReturnFocus(): void {
  if (this.popup.matches(":popover-open")) this.popup.hidePopover();
  this.trigger.focus();
}
```

Extend `onSearchKeydown` with `Enter`:

```ts
case "Enter":
  event.preventDefault();
  if (this.activeIndex >= 0 && this.activeIndex < this.filteredOptions.length) {
    this.commitSelection(this.filteredOptions[this.activeIndex].value, event);
  }
  return;
```

Update `render()`'s trigger value span, the listbox's `aria-multiselectable`, and the option rows:

```ts
<span class=${this.selectedText ? "value" : "value placeholder"}>
  ${this.selectedText || this.placeholder}
</span>
```

```ts
<ul id=${this.listboxId} class="list" role="listbox" aria-multiselectable=${this.multiple}>
```

(replaces the Task-3 `<ul id=${this.listboxId} class="list" role="listbox">` opening tag — same
element, one added attribute.)

```ts
<li
  id=${`${this.listboxId}-${index}`}
  class=${index === this.activeIndex ? "option active" : "option"}
  role="option"
  aria-selected=${this.isSelected(option.value)}
  @click=${(event: MouseEvent) => {
    this.activeIndex = index;
    this.commitSelection(option.value, event);
  }}
>
  ${
    this.multiple
      ? html`<input
          type="checkbox"
          tabindex="-1"
          aria-hidden="true"
          .checked=${this.isSelected(option.value)}
        />`
      : nothing
  }
  <span>${option.label}</span>
</li>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-combobox.ts packages/ui/src/components/wt-combobox.test.ts
git commit -s -m "wt-combobox: single and multiple selection, wt-change, closed-state display"
```

---

### Task 5: The add-new row

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts`
- Modify: `packages/ui/src/components/wt-combobox.test.ts`

**Interfaces:**
- Consumes: `search`, `commitSelection`'s closing rule, `onSearchKeydown`'s `Enter` case,
  `rowCount`/`activeIndex`.
- Produces: `allowAdd: boolean`, `addLabel: (text: string) => string`; the `wt-combobox-add` event.

- [ ] **Step 1: Write the failing test**

Add to `wt-combobox.test.ts`:

```ts
test("the add row is hidden unless allowAdd is set", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  expect(el.shadowRoot!.querySelector(".add")).toBeNull();
});

test("the add row appears for unmatched text once allowAdd is set, and not for an exact match", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  expect(el.shadowRoot!.querySelector(".add")?.textContent?.trim()).toBe("Add 'kosher'");
  await userEvent.clear(search);
  await userEvent.type(search, "Vegan");
  expect(el.shadowRoot!.querySelector(".add")).toBeNull();
});

test("the add row replaces noResultsLabel, never shows both", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  expect(el.shadowRoot!.querySelector(".empty")).toBeNull();
});

test("activating the add row emits wt-combobox-add with the typed text and never creates the option itself", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  let received: string | undefined;
  el.addEventListener("wt-combobox-add", (e) => {
    received = (e as CustomEvent<{ text: string }>).detail.text;
  });
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  await userEvent.click(el.shadowRoot!.querySelector(".add")!);
  expect(received).toBe("kosher");
  expect(el.options).toEqual(TAGS);
  expect(el.value).toBe("");
});

test("activating add closes a single-select panel but leaves a multi-select panel open", async () => {
  const single = await mountWithOptions();
  single.el.allowAdd = true;
  await single.el.updateComplete;
  await userEvent.click(single.trigger);
  await userEvent.type(single.el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
  await userEvent.click(single.el.shadowRoot!.querySelector(".add")!);
  expect(single.popup.matches(":popover-open")).toBe(false);

  const multi = await mountCombobox('<wt-combobox label="Dietary tags" multiple></wt-combobox>');
  multi.el.options = TAGS;
  multi.el.allowAdd = true;
  await multi.el.updateComplete;
  await userEvent.click(multi.trigger);
  await userEvent.type(multi.el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
  await userEvent.click(multi.el.shadowRoot!.querySelector(".add")!);
  expect(multi.popup.matches(":popover-open")).toBe(true);
});

test("Enter on the active add row also activates it", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  let received: string | undefined;
  el.addEventListener("wt-combobox-add", (e) => {
    received = (e as CustomEvent<{ text: string }>).detail.text;
  });
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  await userEvent.keyboard("{End}{Enter}");
  expect(received).toBe("kosher");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: FAIL — no `.add` row exists, `wt-combobox-add` never fires.

- [ ] **Step 3: Write the minimal implementation**

Add styling (append):

```css
.add {
  padding: var(--wt-space-2) var(--wt-space-3);
  font-weight: var(--wt-font-weight-bold);
}
```

Add the new properties and the `showAddRow`/`rowCount`/`addNew` logic:

```ts
@property({ type: Boolean, reflect: true, attribute: "allow-add" }) allowAdd = false;
@property({ attribute: false }) addLabel: (text: string) => string = (text) => `Add '${text}'`;

private get trimmedSearch(): string {
  return this.search.trim();
}

private get showAddRow(): boolean {
  if (!this.allowAdd || !this.trimmedSearch) return false;
  const query = this.trimmedSearch.toLowerCase();
  return !this.options.some((option) => option.label.toLowerCase() === query);
}

private get rowCount(): number {
  return this.filteredOptions.length + (this.showAddRow ? 1 : 0);
}

private addNew(sourceEvent: Event): void {
  sourceEvent.stopPropagation();
  this.dispatchEvent(
    new CustomEvent("wt-combobox-add", {
      detail: { text: this.trimmedSearch },
      bubbles: true,
      composed: true,
    }),
  );
  if (!this.multiple) this.closeAndReturnFocus();
}
```

Update the `Enter` case in `onSearchKeydown` to cover the add row (index `filteredOptions.length`):

```ts
case "Enter": {
  event.preventDefault();
  const options = this.filteredOptions;
  if (this.activeIndex >= 0 && this.activeIndex < options.length) {
    this.commitSelection(options[this.activeIndex].value, event);
  } else if (this.activeIndex === options.length && this.showAddRow) {
    this.addNew(event);
  }
  return;
}
```

Update `ArrowDown`/`End` bounds to use `rowCount` instead of `filteredOptions.length` (they already
read `this.rowCount` from Task 3 if that getter's body is redefined here — replace the Task-3
`rowCount` getter, which returned `this.filteredOptions.length`, with the version above).

Update `render()`'s list to add the row after the mapped options and before the empty state:

```ts
${
  this.showAddRow
    ? html`
        <li
          id=${`${this.listboxId}-${this.filteredOptions.length}`}
          class=${
            this.filteredOptions.length === this.activeIndex ? "option add active" : "option add"
          }
          role="option"
          aria-selected="false"
          @click=${(event: MouseEvent) => {
            this.activeIndex = this.filteredOptions.length;
            this.addNew(event);
          }}
        >
          ${this.addLabel(this.trimmedSearch)}
        </li>
      `
    : nothing
}
${
  this.filteredOptions.length === 0 && !this.showAddRow
    ? html`<li class="empty" role="presentation">${this.noResultsLabel}</li>`
    : nothing
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-combobox.ts packages/ui/src/components/wt-combobox.test.ts
git commit -s -m "wt-combobox: the allowAdd row and wt-combobox-add event"
```

---

### Task 6: Forms contract — required, error, invalid, name

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts`
- Modify: `packages/ui/src/components/wt-combobox.test.ts`

**Interfaces:**
- Produces: `name: string`, `required: boolean`, `invalid: boolean`, `error: string`, matching
  `wt-input`'s contract (visible asterisk, `aria-invalid`, linked error text via
  `aria-describedby`). `aria-invalid`/`aria-describedby`/`aria-haspopup` are ARIA global states —
  valid on the trigger `<button>` regardless of its role. `aria-required` is not global (it's only
  defined for roles like `combobox`/`listbox`/`textbox`), so it goes on the `.search` input (which
  already carries `role="combobox"` from Task 3), never on the button.

- [ ] **Step 1: Write the failing test**

Add to `wt-combobox.test.ts`:

```ts
test("marks a required field with a visible asterisk and the search box's aria-required", async () => {
  const { el, trigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" required></wt-combobox>',
  );
  expect(el.shadowRoot!.querySelector("[data-required]")?.textContent).toBe("*");
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(search.getAttribute("aria-required")).toBe("true");
});

test("links explanatory error text to the trigger and sets aria-invalid", async () => {
  const { el } = await mountCombobox(
    '<wt-combobox label="Dietary tags" error="Choose at least one tag"></wt-combobox>',
  );
  const trigger = el.shadowRoot!.querySelector(".trigger")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(trigger.getAttribute("aria-invalid")).toBe("true");
  expect(trigger.getAttribute("aria-describedby")).toBe(error.id);
  expect(error.textContent).toBe("Choose at least one tag");
});

test("wires the invalid property to aria-invalid independently of error text", async () => {
  const el = await mount("<wt-combobox invalid></wt-combobox>");
  expect(el.shadowRoot!.querySelector(".trigger")!.getAttribute("aria-invalid")).toBe("true");
});

test("invalid state paints the trigger border from the danger token", async () => {
  const el = await mount("<wt-combobox invalid></wt-combobox>");
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  const trigger = el.shadowRoot!.querySelector(".trigger")!;
  expect(getComputedStyle(trigger).borderColor).toBe("rgb(13, 14, 15)");
});

test("disabled trigger dims via the disabled-opacity token", async () => {
  const el = await mount("<wt-combobox disabled></wt-combobox>");
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(el.shadowRoot!.querySelector(".trigger")!).opacity).toBe("0.3");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: FAIL — no `required`/`invalid`/`error` properties or ARIA wiring exist yet.

- [ ] **Step 3: Write the minimal implementation**

Add styling (append):

```css
.trigger[aria-invalid="true"] {
  border-color: var(--wt-color-danger);
}

.required,
.error {
  color: var(--wt-color-danger);
}

.required {
  margin-inline-start: var(--wt-space-1);
}

.error {
  margin: var(--wt-space-1) 0 0;
  font-size: var(--wt-font-size-sm);
}
```

Add the new properties and the error id:

```ts
@property() name = "";
@property() error = "";
@property({ type: Boolean, reflect: true }) required = false;
@property({ type: Boolean, reflect: true }) invalid = false;

private readonly errorId = uniqueId("wt-combobox-error");
```

Update `render()`: the label row gains the asterisk, and the trigger gains the new `aria-*`
attributes and the error paragraph is appended after the panel:

```ts
${
  this.label
    ? html`<div class="label-row">
        <label id=${this.labelId}
          >${this.label}${
            this.required
              ? html`<span class="required" data-required aria-hidden="true">*</span>`
              : nothing
          }</label
        >
      </div>`
    : nothing
}
```

```ts
<button
  type="button"
  class="trigger"
  aria-haspopup="listbox"
  aria-expanded=${this.expanded}
  aria-labelledby=${this.label ? this.labelId : nothing}
  aria-invalid=${this.invalid || this.error !== ""}
  aria-describedby=${this.error !== "" ? this.errorId : nothing}
  popovertarget="panel"
  ?disabled=${this.disabled}
  @click=${this.onTriggerClick}
  @keydown=${this.onKeydown}
>
```

Also update the `.search` input (from Task 3) to carry `aria-required`:

```ts
<input
  class="search"
  type="text"
  role="combobox"
  aria-expanded="true"
  aria-required=${this.required}
  placeholder=${this.searchPlaceholder}
  aria-label=${this.label || this.searchPlaceholder}
  aria-controls=${this.listboxId}
  aria-activedescendant=${
    this.activeIndex >= 0 ? `${this.listboxId}-${this.activeIndex}` : nothing
  }
  .value=${this.search}
  @input=${this.onSearchInput}
  @keydown=${this.onSearchKeydown}
/>
```

```ts
    </div>
    ${
      this.error !== ""
        ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>`
        : nothing
    }
  `;
}
```

(`name` has no rendering effect yet — it exists on the class for API/contract parity and for a
future consumer to read via `el.name` when wiring up form-error-summary style validation, exactly
as documented in the spec; it needs no DOM attachment since the component has no native form
association, matching every other `packages/ui` primitive.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-combobox.ts packages/ui/src/components/wt-combobox.test.ts
git commit -s -m "wt-combobox: required, invalid and error, matching the wt-input Forms contract"
```

---

### Task 7: Accessibility test suite

**Files:**
- Create: `packages/ui/src/components/wt-combobox.a11y.test.ts`

No changes to `wt-combobox.ts` are expected in this task unless a real violation turns up — if one
does, fix it here and note the fix in the commit message, the same way `wt-dialog`'s missing
`role="dialog"` was caught and fixed while writing its a11y suite (see `docs/developers/design-system.md`
§ Testing).

- [ ] **Step 1: Write the test file**

Create `packages/ui/src/components/wt-combobox.a11y.test.ts`:

```ts
import { afterEach, describe, test } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-combobox.js";
import type { WtCombobox } from "./wt-combobox.js";

afterEach(cleanup);

const TAGS = [
  { value: "gluten-free", label: "Gluten-free" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
];

describe.each(["light", "dark"] as const)("wt-combobox a11y (%s theme)", (theme) => {
  test("closed, empty", async () => {
    await mountThemed('<wt-combobox label="Dietary tags"></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("open with results", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await expectNoA11yViolations(host);
  });

  test("open with the add row showing", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags" allow-add></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
    await expectNoA11yViolations(host);
  });

  test("open with no matches and allowAdd off", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
    await expectNoA11yViolations(host);
  });

  test("multiple, with a selection", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    el.values = ["vegan"];
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await expectNoA11yViolations(host);
  });

  test("invalid, with an error message", async () => {
    await mountThemed(
      '<wt-combobox label="Dietary tags" invalid error="Choose at least one tag"></wt-combobox>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed('<wt-combobox label="Dietary tags" disabled></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("required", async () => {
    await mountThemed('<wt-combobox label="Dietary tags" required></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });
});
```

- [ ] **Step 2: Run the suite and confirm it passes**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.a11y.test.ts`
Expected: PASS, for all states in both themes.

- [ ] **Step 3: Prove the suite is not vacuously green**

Temporarily remove `aria-labelledby` from the trigger `<button>` in `wt-combobox.ts` and re-run the
"closed, empty" test above.
Expected: FAIL, with an axe `button-name`-family violation (the trigger button has no accessible
name once the label association is gone).
Restore the `aria-labelledby` attribute and re-run to confirm it goes back to green. Do not commit
the temporary removal — this step is a manual proof, matching how `wt-dialog`'s and
`wt-row-actions`' a11y suites were validated (design-system.md § Testing), not a test that stays in
the file.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/wt-combobox.a11y.test.ts
git commit -s -m "wt-combobox: accessibility test suite"
```

---

### Task 8: Documentation and the finished workbench example

**Files:**
- Modify: `packages/ui/demo/main.ts`
- Modify: `docs/developers/design-system.md`

**Interfaces:** none — this task wires already-finished behaviour into the workbench and the docs
table; no component code changes are expected.

- [ ] **Step 1: Finish the workbench example**

Modify `packages/ui/demo/main.ts` — replace the placeholder combobox added in Task 1 with a
populated pair (single- and multi-select), and wire the `.demo-combobox`/`.demo-multi-combobox`
elements' `options` after `applyTokens`:

```html
<div class="row" style="margin-top:16px">
  <wt-combobox
    label="Favourite tag"
    placeholder="Choose a tag"
    class="demo-combobox"
    allow-add
    search-placeholder="Search or add new"
  ></wt-combobox>
  <wt-combobox
    label="Dietary tags"
    placeholder="Choose tags"
    class="demo-multi-combobox"
    multiple
    allow-add
    search-placeholder="Search or add new"
  ></wt-combobox>
</div>
```

In the `for (const el of app.querySelectorAll<HTMLElement>(".panel"))` loop, after the existing
`table.columns = [...]` block, add:

```ts
const DEMO_TAGS = [
  { value: "dairy-free", label: "Dairy-free" },
  { value: "gluten-free", label: "Gluten-free" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
  { value: "nut-free", label: "Nut-free" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
];
const single = el.querySelector<HTMLElementTagNameMap["wt-combobox"]>(".demo-combobox")!;
single.options = DEMO_TAGS;
single.addEventListener("wt-combobox-add", ((e: CustomEvent<{ text: string }>) => {
  const option = { value: e.detail.text.toLowerCase(), label: e.detail.text };
  single.options = [...single.options, option];
  single.value = option.value;
}) as EventListener);

const multi = el.querySelector<HTMLElementTagNameMap["wt-combobox"]>(".demo-multi-combobox")!;
multi.options = DEMO_TAGS;
multi.addEventListener("wt-combobox-add", ((e: CustomEvent<{ text: string }>) => {
  const option = { value: e.detail.text.toLowerCase(), label: e.detail.text };
  multi.options = [...multi.options, option];
  multi.values = [...multi.values, option.value];
}) as EventListener);
```

- [ ] **Step 2: Check the workbench by hand**

Run: `pnpm --filter @waitron/ui dev`, open `http://localhost:5180`.

In both the light and dark panels: open "Favourite tag", confirm the seven dietary options list and
filter as you type, click one and confirm the trigger shows its label and the panel closes; open it
again, type an unmatched word (e.g. "Foo"), confirm "Add 'Foo'" appears, click it, and confirm the
new tag is selected and shown on the trigger. Repeat for "Dietary tags" (multiple): confirm picking
several keeps the panel open, the trigger switches from one label to "N selected" once a second tag
is picked, and typing an unmatched word then clicking Add adds and selects it without closing the
panel. Stop the dev server when done.

- [ ] **Step 3: Update the design-system documentation**

Modify `docs/developers/design-system.md` — add a row to the Primitives table (after the
`wt-data-table` row, around line 152):

```markdown
| `wt-combobox` | `options` (`{value,label}[]`), `multiple`, `value`, `values`, `allowAdd`, `label`, `name`, `placeholder`, `required`, `disabled`, `invalid`, `error`, `countLabel`, `noResultsLabel`, `searchPlaceholder`, `addLabel` | `wt-change` — `detail: { value: string }` or `detail: { values: string[] }`; `wt-combobox-add` — `detail: { text: string }` |
```

- [ ] **Step 4: Run the full package suite one more time**

Run: `pnpm --filter @waitron/ui exec vitest run`
Expected: PASS — every `wt-combobox*.test.ts` file, plus the pre-existing suites
(`no-hardcoded-chrome.test.ts`, `tokens/*.test.ts`, every other component's tests) unaffected.

Run: `pnpm --filter @waitron/ui typecheck` (or the package's equivalent script — check
`packages/ui/package.json`'s `scripts` if the name differs) and `pnpm format:check` for the files
touched in this plan.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/demo/main.ts docs/developers/design-system.md
git commit -s -m "wt-combobox: finish the workbench example and document the primitive"
```

---

## After this plan

This ships the primitive only. Follow-up work, each its own future task/PR:

- Wire `wt-combobox` into a real screen (e.g. replacing `apps/dashboard/src/widgets/allergen-picker.ts`
  or `dietary-origin-picker.ts`), including `apps/dashboard/src/icons.ts` already having
  `chevron-down` registered (confirmed during research for this plan) and localizing every
  `*Label`/`*Placeholder` property with `t(...)`, matching how every `wt-data-table` consumer
  already overrides `emptyMessage`/`loadingMessage`.
- Anything from the spec's explicit non-goals list (async search, per-option `disabled`, chip-style
  closed display) — only if a real consumer needs it.
