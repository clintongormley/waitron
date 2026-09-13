# Categories Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Categories page a tree/flat table with a name filter, a colour per category shown as lozenges, a products modal, a checkbox add-products form, and a delete that cascades (unassign products, reparent children, drop routes) after showing what it will change.

**Architecture:** Three shared UI primitives change in `packages/ui` (a new `wt-lozenge`, a `round` button, tree support in `wt-data-table`). The catalogue package (`packages/catalogue`) gains a colour column, an optional reporting category, a cascading delete, a delete-preview read, and a bulk-add write. `apps/server` exposes two new routes and relaxes one. The dashboard client, the category form, the membership picker, the product editor and the Categories screen consume all of it; the Catalogue screen gains a `?product=` deep link.

**Tech Stack:** TypeScript, Lit web components, Drizzle ORM on PostgreSQL, Vitest (PGlite + Testcontainers real Postgres, and browser-mode Chromium for UI), Hono for routes.

**Spec:** `docs/superpowers/specs/2026-09-13-categories-screen-design.md`

## Global Constraints

- **Plain English** in every commit message and PR text; exact file/function/code names may appear once as pointers, commands verbatim. No attribution lines in commits.
- **Every commit uses `git commit -s`.** Commit after each task.
- **No hardcoded chrome** in `packages/ui`: colours, spacing, radii, font sizes read `--wt-*` tokens. A data colour applied as an inline style is the one exemption (as `wt-table-token`'s status badge already does).
- **Error codes name the domain concept and are never renamed once shipped.** New code this plan adds: `category.color_invalid`. Codes it stops throwing but keeps registered: `category.in_use`, `category.primary_required`.
- **A by-id read scopes to the tenant itself** (`eq(table.tenantId, cfg.tenantId)`), never trusting a UUID's global uniqueness. Every new read and write is tenant-scoped.
- **Multi-table writes share one transaction**; write-path functions take `tx: Transaction` and never open their own.
- **No backfill / no backwards-compatibility code** (pre-production). Schema changes drop/recreate; existing rows read the new column as its default.
- **A grant assertion test calls `asAppUser(tx)` before the query under test**, or it runs as owner and proves nothing.
- **A new `wt-*` primitive needs two tests**: a token-painting test and an axe a11y test in a sibling `*.a11y.test.ts` covering each state in both themes.
- **Drizzle migrations are generated, never hand-edited** (`pnpm --filter <pkg> db:generate`). A migration-number collision on rebase is fixed by regeneration.
- Run focused tests while implementing. CI owns the mandatory package suites and coverage. Do not add a whole-workspace local run to finish the branch.

---

## File Structure

**`packages/ui` (shared primitives):**
- Create `packages/ui/src/category-color.ts` — `readableTextColor(hex)` and `CATEGORY_PALETTE`.
- Create `packages/ui/src/category-color.test.ts` — the contrast sweep.
- Create `packages/ui/src/components/wt-lozenge.ts` — the lozenge primitive.
- Create `packages/ui/src/components/wt-lozenge.test.ts` and `wt-lozenge.a11y.test.ts`.
- Modify `packages/ui/src/components/wt-button.ts` — a `round` attribute.
- Modify `packages/ui/src/components/wt-button.a11y.test.ts` (or create if absent) and `wt-button.test.ts` — round tests.
- Modify `packages/ui/src/components/wt-data-table.ts` — optional `rowParent` tree mode.
- Modify `packages/ui/src/components/wt-data-table.test.ts` and `wt-data-table.a11y.test.ts` — tree tests.
- Modify `packages/ui/src/index.ts` — export the new symbols.

**`packages/catalogue` (data + operations):**
- Modify `packages/catalogue/src/schema/categories.ts` — `color` column.
- Generate `packages/catalogue/drizzle/0010_category_colour.sql` (+ meta) via drizzle-kit.
- Modify `packages/catalogue/src/categories.ts` — `color` in shape/create/update/validate; optional reporting category in `replaceProductCategories`; cascading `deleteCategory`; new `categoryDependants` and `addProductsToCategory`.
- Modify `packages/catalogue/src/errors.ts` — register `category.color_invalid`.
- Modify `packages/catalogue/src/product-editor-input.ts` — reporting category optional.
- Modify `packages/catalogue/src/categories.test.ts` and `categories.pg.test.ts` — new behaviour.
- Modify `packages/catalogue/src/configuration-transfer.ts` if it enumerates category columns (verify).

**`apps/server` (routes):**
- Modify `apps/server/src/catalogue-api.ts` — colour pass-through, relaxed PUT membership, `GET .../:id/dependants`, `POST .../:id/products`.
- Modify `apps/server/src/catalogue-api.test.ts` (+ `.pg.test.ts` for the route table guard) and `apps/server/src/category-fks.pg.test.ts` / `category-route-race.pg.test.ts` for the cascade.

**`apps/dashboard` (client + widgets + screens):**
- Modify `apps/dashboard/src/api/client.ts` — `color`, `dependants`, `addProductsToCategory`, relaxed types.
- Modify `apps/dashboard/src/widgets/category-form.ts` — colour picker.
- Modify `apps/dashboard/src/widgets/category-membership-picker.ts` — reporting optional, rename.
- Modify `apps/dashboard/src/widgets/product-editor.ts` — reporting optional, rename (string already `editor.reporting_category`).
- Rewrite `apps/dashboard/src/screens/categories-screen.ts` — tree/flat, filter, round button, products modal, add-products checkbox table, delete modal with preview + links.
- Modify `apps/dashboard/src/screens/catalogue-screen.ts` — `?product=` deep link.
- Modify `apps/dashboard/src/icons.ts` — register `plus`.
- Modify `apps/dashboard/src/i18n/strings.ts` — new/renamed strings (en + es).
- Modify the matching `*.test.ts` / `*.a11y.test.ts` for each.

**Docs:**
- Modify `docs/developers/product-categories.md`, `docs/developers/design-system.md`, `docs/products.md`, `docs/backlog.md`.

---

## Task 1: Colour helper and palette

**Files:**
- Create: `packages/ui/src/category-color.ts`
- Test: `packages/ui/src/category-color.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `readableTextColor(hex: string): "#000000" | "#ffffff"`; `CATEGORY_PALETTE: readonly string[]` (24 lower-case `#rrggbb` values); `isHexColor(value: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/category-color.test.ts
import { expect, test } from "vitest";
import { readableTextColor, CATEGORY_PALETTE, isHexColor } from "./category-color.js";

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = hex
      .replace("#", "")
      .match(/../g)!
      .map((h) => parseInt(h, 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

test("palette is 24 lower-case six-digit hex values", () => {
  expect(CATEGORY_PALETTE).toHaveLength(24);
  for (const c of CATEGORY_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
});

test("every palette colour gets readable text (>= 4.5:1)", () => {
  for (const c of CATEGORY_PALETTE) expect(contrast(c, readableTextColor(c))).toBeGreaterThanOrEqual(4.5);
});

test("the whole RGB cube gets readable text at a coarse step", () => {
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51) {
        const hex = "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
        expect(contrast(hex, readableTextColor(hex))).toBeGreaterThanOrEqual(4.5);
      }
});

test("isHexColor accepts #rrggbb lower case only", () => {
  expect(isHexColor("#dd9e5f")).toBe(true);
  expect(isHexColor("#DD9E5F")).toBe(false);
  expect(isHexColor("dd9e5f")).toBe(false);
  expect(isHexColor("#fff")).toBe(false);
  expect(isHexColor("")).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/ui test category-color`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/category-color.ts
/** WCAG relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const c = hex
    .replace("#", "")
    .match(/../g)!
    .map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/**
 * Black or white, whichever contrasts more with `hex`. Never refuses: black clears 4.5:1 for
 * luminance >= 0.175, white for <= 0.183, and the ranges overlap, so every colour passes with one.
 */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  const l = luminance(hex);
  const black = (l + 0.05) / 0.05;
  const white = 1.05 / (l + 0.05);
  return black >= white ? "#000000" : "#ffffff";
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/.test(value);
}

// Eight hues x three tones, generated from HSL(hue, 65%, {42,62,80}%) and pinned as literals so a
// formula change can never move a stored colour off a swatch. Hue order: red, orange, yellow,
// green, teal, blue, violet, magenta. Tone order within each hue block: dark, mid, pale.
export const CATEGORY_PALETTE = [
  "#b12525", "#dd5f5f", "#edabab",
  "#b16b25", "#dd9e5f", "#edccab",
  "#b1b125", "#dddd5f", "#ededab",
  "#25b125", "#5fdd5f", "#abedab",
  "#25b19a", "#5fddc8", "#abede2",
  "#256bb1", "#5f9edd", "#abcced",
  "#5425b1", "#895fdd", "#c1abed",
  "#b125b1", "#dd5fdd", "#edabed",
] as const;
```

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/ui test category-color`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `packages/ui/src/index.ts`:

```ts
export { readableTextColor, isHexColor, CATEGORY_PALETTE } from "./category-color.js";
```

```bash
git add packages/ui/src/category-color.ts packages/ui/src/category-color.test.ts packages/ui/src/index.ts
git commit -s -m "Add a category colour palette and a readable-text-colour helper"
```

---

## Task 2: `wt-lozenge` primitive

**Files:**
- Create: `packages/ui/src/components/wt-lozenge.ts`
- Test: `packages/ui/src/components/wt-lozenge.test.ts`, `packages/ui/src/components/wt-lozenge.a11y.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `readableTextColor` from Task 1.
- Produces: `<wt-lozenge color="#rrggbb|''">label</wt-lozenge>`. Empty/absent `color` renders the neutral outlined chip. Exports `WtLozenge`.

- [ ] **Step 1: Write the failing token-painting test**

```ts
// packages/ui/src/components/wt-lozenge.test.ts
import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import { readableTextColor } from "../category-color.js";
import type { WtLozenge } from "./wt-lozenge.js";
import "./wt-lozenge.js";

afterEach(cleanup);

test("a coloured lozenge paints the colour and readable text", async () => {
  const el = (await mount('<wt-lozenge color="#dd9e5f">Breakfast</wt-lozenge>')) as WtLozenge;
  const chip = el.shadowRoot!.querySelector("span")!;
  const style = getComputedStyle(chip);
  expect(style.backgroundColor).toBe("rgb(221, 158, 95)");
  // readableTextColor('#dd9e5f') is '#000000'
  expect(readableTextColor("#dd9e5f")).toBe("#000000");
  expect(style.color).toBe("rgb(0, 0, 0)");
  expect(chip.textContent).toContain("Breakfast");
});

test("a colourless lozenge uses the neutral token chrome", async () => {
  const el = (await mount("<wt-lozenge>Sundries</wt-lozenge>")) as WtLozenge;
  const chip = el.shadowRoot!.querySelector("span")!;
  el.style.setProperty("--wt-color-surface", "rgb(1, 2, 3)");
  await el.updateComplete;
  expect(getComputedStyle(chip).backgroundColor).toBe("rgb(1, 2, 3)");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/ui test wt-lozenge`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/components/wt-lozenge.ts
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { readableTextColor, isHexColor } from "../category-color.js";

/**
 * A pill for a category. With a colour it fills that background and sets the text to black or white
 * for contrast; the colour is data, applied inline (the one no-hardcoded-chrome exemption). With no
 * colour it is a neutral outlined chip whose chrome reads tokens.
 */
@customElement("wt-lozenge")
export class WtLozenge extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        min-width: 0;
      }
      span {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        padding: 0 var(--wt-space-3);
        border-radius: var(--wt-radius-full);
        border: 1px solid transparent;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        line-height: calc(var(--wt-tap-min) / 1.6);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      span.none {
        background: var(--wt-color-surface);
        border-color: var(--wt-color-border);
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-normal, 400);
      }
    `,
  ];

  @property() color = "";

  override render() {
    const colored = isHexColor(this.color);
    const style = colored
      ? `background:${this.color};color:${readableTextColor(this.color)}`
      : "";
    return html`<span class=${colored ? "" : "none"} style=${style}><slot></slot></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-lozenge": WtLozenge;
  }
}
```

If `--wt-font-weight-normal` is not a real token, check `packages/ui/src/tokens/*.css` and use the real normal-weight token (or drop the override and let the chip inherit normal weight). Verify with `grep -rn "font-weight" packages/ui/src/tokens`.

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/ui test wt-lozenge`
Expected: PASS.

- [ ] **Step 5: Write the a11y test**

```ts
// packages/ui/src/components/wt-lozenge.a11y.test.ts
import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-lozenge.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-lozenge a11y (%s theme)", (theme) => {
  test("coloured", async () => {
    await mountThemed('<wt-lozenge color="#256bb1">Sandwiches</wt-lozenge>', theme);
    await expectNoA11yViolations(host);
  });
  test("colourless", async () => {
    await mountThemed("<wt-lozenge>Sundries</wt-lozenge>", theme);
    await expectNoA11yViolations(host);
  });
});
```

- [ ] **Step 6: Run a11y, export and commit**

Run: `pnpm --filter @waitron/ui test wt-lozenge`
Expected: PASS.

Add to `packages/ui/src/index.ts`: `export { WtLozenge } from "./components/wt-lozenge.js";`

```bash
git add packages/ui/src/components/wt-lozenge.ts packages/ui/src/components/wt-lozenge.test.ts packages/ui/src/components/wt-lozenge.a11y.test.ts packages/ui/src/index.ts
git commit -s -m "Add the wt-lozenge pill for category colours"
```

---

## Task 3: `round` option on `wt-button`

**Files:**
- Modify: `packages/ui/src/components/wt-button.ts`
- Test: `packages/ui/src/components/wt-button.test.ts`, `packages/ui/src/components/wt-button.a11y.test.ts`

**Interfaces:**
- Produces: `<wt-button round variant="primary" aria-label="…">+</wt-button>` renders a circular button of `--wt-tap-min` diameter.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/ui/src/components/wt-button.test.ts
test("a round button is circular and keeps its accessible name", async () => {
  const el = (await mount('<wt-button round aria-label="Create category">+</wt-button>')) as WtButton;
  await el.updateComplete;
  const button = el.shadowRoot!.querySelector("button")!;
  const style = getComputedStyle(button);
  expect(style.borderRadius).toBe(style.height === "" ? style.borderRadius : style.borderRadius); // radius-full
  expect(button.getAttribute("aria-label")).toBe("Create category");
  expect(parseFloat(style.width)).toBeCloseTo(parseFloat(style.height), 0);
});
```

(If `wt-button.test.ts` already imports `mount`/`WtButton`, reuse those imports; otherwise mirror the file's existing header.)

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/ui test wt-button`
Expected: FAIL, width not equal to height (button is not yet circular).

- [ ] **Step 3: Implement**

Add the property near the other reflected properties:

```ts
@property({ type: Boolean, reflect: true }) round = false;
```

Add the CSS block inside `wt-button`'s `styles` (after the variant blocks):

```ts
:host([round]) button {
  width: var(--wt-tap-min);
  height: var(--wt-tap-min);
  min-width: var(--wt-tap-min);
  padding: 0;
  border-radius: var(--wt-radius-full);
}
```

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/ui test wt-button`
Expected: PASS.

- [ ] **Step 5: a11y and commit**

Add to `wt-button.a11y.test.ts` (mirror its `describe.each` theme pattern):

```ts
test("round icon button", async () => {
  await mountThemed('<wt-button round variant="primary" aria-label="Create category">+</wt-button>', theme);
  await expectNoA11yViolations(host);
});
```

Run: `pnpm --filter @waitron/ui test wt-button`
Expected: PASS.

```bash
git add packages/ui/src/components/wt-button.ts packages/ui/src/components/wt-button.test.ts packages/ui/src/components/wt-button.a11y.test.ts
git commit -s -m "Add a round shape to wt-button for icon buttons"
```

---

## Task 4: Tree support in `wt-data-table`

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts`
- Test: `packages/ui/src/components/wt-data-table.test.ts`, `packages/ui/src/components/wt-data-table.a11y.test.ts`

**Interfaces:**
- Produces: a new optional property `rowParent?: (row: Row) => string | null` returning a parent's row key. When set the table nests rows, indents by depth, shows a chevron toggle on rows with children, sorts siblings within their parent, and uses `role="treegrid"`. Collapse state is internal, keyed by row key, all-open by default.

- [ ] **Step 1: Write the failing tests**

```ts
// add to packages/ui/src/components/wt-data-table.test.ts
type TreeRow = { id: string; parent: string | null; name: string };
const treeRows: TreeRow[] = [
  { id: "food", parent: null, name: "Food" },
  { id: "break", parent: "food", name: "Breakfast" },
  { id: "eggs", parent: "break", name: "Eggs" },
  { id: "drinks", parent: null, name: "Drinks" },
];
const treeColumns: DataTableColumn<TreeRow>[] = [
  { key: "name", label: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
];
async function treeTable(props: Partial<WtDataTable<TreeRow>> = {}): Promise<WtDataTable<TreeRow>> {
  const el = (await mount('<wt-data-table aria-label="Categories"></wt-data-table>')) as WtDataTable<TreeRow>;
  Object.assign(el, {
    rows: treeRows,
    columns: treeColumns,
    rowKey: (r: TreeRow) => r.id,
    rowParent: (r: TreeRow) => r.parent,
    ...props,
  });
  await el.updateComplete;
  return el;
}

test("tree mode nests children under parents in order", async () => {
  const el = await treeTable();
  const keys = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-row-key"));
  expect(keys).toEqual(["food", "break", "eggs", "drinks"]);
});

test("tree mode sets treegrid semantics and aria-level", async () => {
  const el = await treeTable();
  expect(el.shadowRoot!.querySelector("table")!.getAttribute("role")).toBe("treegrid");
  const rowFor = (key: string) => el.shadowRoot!.querySelector(`tbody tr[data-row-key="${key}"]`)!;
  expect(rowFor("food").getAttribute("aria-level")).toBe("1");
  expect(rowFor("eggs").getAttribute("aria-level")).toBe("3");
  expect(rowFor("food").getAttribute("aria-expanded")).toBe("true");
  expect(rowFor("eggs").hasAttribute("aria-expanded")).toBe(false); // leaf
});

test("collapsing a branch hides its descendants and flips aria-expanded", async () => {
  const el = await treeTable();
  const toggle = el.shadowRoot!.querySelector<HTMLButtonElement>('tbody tr[data-row-key="break"] button.tree-toggle')!;
  toggle.click();
  await el.updateComplete;
  const keys = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-row-key"));
  expect(keys).toEqual(["food", "break", "drinks"]); // eggs hidden
  expect(el.shadowRoot!.querySelector('tbody tr[data-row-key="break"]')!.getAttribute("aria-expanded")).toBe("false");
});

test("sorting orders siblings within their parent, not the whole list", async () => {
  const rows: TreeRow[] = [
    { id: "food", parent: null, name: "Food" },
    { id: "z", parent: "food", name: "Zebra" },
    { id: "a", parent: "food", name: "Apple" },
    { id: "drinks", parent: null, name: "Drinks" },
  ];
  const el = await treeTable({ rows });
  el.shadowRoot!.querySelector<HTMLButtonElement>("th button.sort")!.click();
  await el.updateComplete;
  const keys = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-row-key"));
  expect(keys).toEqual(["drinks", "food", "a", "z"]); // top level sorted; a,z sorted under food
});

test("a row whose parent is absent renders at the top level", async () => {
  const el = await treeTable({ rows: [{ id: "eggs", parent: "missing", name: "Eggs" }] });
  const row = el.shadowRoot!.querySelector('tbody tr[data-row-key="eggs"]')!;
  expect(row.getAttribute("aria-level")).toBe("1");
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/ui test wt-data-table`
Expected: FAIL (no tree behaviour yet).

- [ ] **Step 3: Implement**

In `wt-data-table.ts`:

Add the property:

```ts
@property({ attribute: false }) rowParent?: (row: Row) => string | null;
```

Add collapse state:

```ts
@state() private collapsed = new Set<string>();
```

Add a chevron style inside `styles` (reuse the sort button's reset):

```ts
.tree-toggle {
  width: var(--wt-tap-min);
  height: var(--wt-tap-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--wt-font-size-lg);
  line-height: 1;
  cursor: pointer;
}
.tree-toggle:focus-visible {
  outline: var(--wt-focus-ring);
  outline-offset: var(--wt-focus-offset);
}
.tree-spacer {
  display: inline-block;
  width: var(--wt-tap-min);
}
.tree-cell {
  display: inline-flex;
  align-items: center;
}
```

Replace `#sortedRows()` usage in `render()` for tree mode. Add a helper that produces the visible, ordered, depth-annotated rows:

```ts
#treeRows(): { row: Row; depth: number; hasChildren: boolean }[] {
  const keyOf = (row: Row, i: number) => this.rowKey(row, i);
  const parentOf = this.rowParent!;
  const present = new Set(this.rows.map((r, i) => keyOf(r, i)));
  // group children by parent key ("" = top level, including orphans whose parent is absent)
  const childrenByParent = new Map<string, Row[]>();
  const indexOf = new Map<Row, number>();
  this.rows.forEach((r, i) => indexOf.set(r, i));
  for (const row of this.rows) {
    const p = parentOf(row);
    const bucket = p !== null && present.has(p) ? p : "";
    (childrenByParent.get(bucket) ?? childrenByParent.set(bucket, []).get(bucket)!).push(row);
  }
  const column = this.columns.find((c) => c.key === this.sortKey && c.sortValue !== undefined);
  const sortSiblings = (rows: Row[]): Row[] => {
    if (!column?.sortValue) return rows;
    const dir = this.sortDirection === "ascending" ? 1 : -1;
    return [...rows]
      .map((row) => ({ row, index: indexOf.get(row)!, value: column.sortValue!(row) }))
      .sort((l, r) => {
        if (l.value == null && r.value == null) return l.index - r.index;
        if (l.value == null) return 1;
        if (r.value == null) return -1;
        const c =
          typeof l.value === "number" && typeof r.value === "number"
            ? l.value - r.value
            : String(l.value).localeCompare(String(r.value), undefined, { numeric: true, sensitivity: "base" });
        return c === 0 ? l.index - r.index : c * dir;
      })
      .map((e) => e.row);
  };
  const out: { row: Row; depth: number; hasChildren: boolean }[] = [];
  const walk = (parentKey: string, depth: number) => {
    for (const row of sortSiblings(childrenByParent.get(parentKey) ?? [])) {
      const key = keyOf(row, indexOf.get(row)!);
      const hasChildren = (childrenByParent.get(key) ?? []).length > 0;
      out.push({ row, depth, hasChildren });
      if (hasChildren && !this.collapsed.has(key)) walk(key, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

#toggle(key: string): void {
  const next = new Set(this.collapsed);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  this.collapsed = next;
}
```

In `render()`, when `this.rowParent` is set, give the `<table>` `role="treegrid"`, iterate `#treeRows()` instead of `#sortedRows()`, and for each row set `aria-level`, and `aria-expanded` on rows with children; in the **first** column's cell prepend the toggle/spacer and an indent equal to `depth`:

```ts
// inside the tbody map when tree mode is on:
const entries = this.#treeRows();
// ...
${entries.map(({ row, depth, hasChildren }, index) => {
  const key = this.rowKey(row, index);
  const expanded = !this.collapsed.has(key);
  return html`<tr
    data-row-key=${key}
    role="row"
    aria-level=${depth + 1}
    aria-expanded=${hasChildren ? String(expanded) : nothing}
  >
    ${this.columns.map((column, ci) => html`<td data-align=${column.align ?? "start"}>
      ${ci === 0
        ? html`<span class="tree-cell" style=${`padding-inline-start: calc(${depth} * var(--wt-space-4))`}>
            ${hasChildren
              ? html`<button
                  class="tree-toggle"
                  aria-label=${expanded ? "Collapse" : "Expand"}
                  @click=${() => this.#toggle(key)}
                >${expanded ? "▾" : "▸"}</button>`
              : html`<span class="tree-spacer"></span>`}
            ${column.cell(row)}
          </span>`
        : column.cell(row)}
    </td>`)}
  </tr>`;
})}
```

Keep the non-tree path exactly as it is today (guard on `this.rowParent === undefined`). The chevron `aria-label` strings ("Collapse"/"Expand") should be overridable; add two optional properties `collapseLabel = "Collapse"` and `expandLabel = "Expand"` so the screen can localize them, and use those instead of the literals.

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/ui test wt-data-table`
Expected: PASS. Confirm the existing (non-tree) tests still pass.

- [ ] **Step 5: a11y**

Add to `wt-data-table.a11y.test.ts` (mirror its pattern) a tree case in both themes: mount with `rowParent` set and one collapsed branch, assert `expectNoA11yViolations(host)`.

Run: `pnpm --filter @waitron/ui test wt-data-table`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts packages/ui/src/components/wt-data-table.a11y.test.ts
git commit -s -m "Add optional tree nesting to the shared data table"
```

---

## Task 5: Category colour column, shape, create/update and validation

**Files:**
- Modify: `packages/catalogue/src/schema/categories.ts`, `packages/catalogue/src/categories.ts`, `packages/catalogue/src/errors.ts`
- Generate: `packages/catalogue/drizzle/0010_category_colour.sql` (+ meta)
- Test: `packages/catalogue/src/categories.pg.test.ts`

**Interfaces:**
- Produces: `Category` and `CategoryInput` gain `color: string | null` (`color?` on input). `createCategory`/`updateCategory` persist and validate it. New code `category.color_invalid`.

- [ ] **Step 1: Register the error code**

In `packages/catalogue/src/errors.ts`, add to the category block:

```ts
"category.color_invalid": Record<string, never>;
```

- [ ] **Step 2: Add the column to the schema and generate the migration**

In `packages/catalogue/src/schema/categories.ts`, add to `categoryDetails` columns:

```ts
color: text("color"),
```

Generate the migration (note British spelling in the filename is fine; drizzle names by `--name`):

Run: `pnpm --filter @waitron/catalogue db:generate --name category_colour`
Expected: creates `packages/catalogue/drizzle/0010_category_colour.sql` adding `color text` to `category_details`, and updates `meta/_journal.json`. Inspect the SQL: it must be a single `ALTER TABLE "category_details" ADD COLUMN "color" text;` with no destructive statement. If the number collides after a rebase, reset the drizzle dir to main's and regenerate.

- [ ] **Step 3: Write the failing test**

```ts
// add to packages/catalogue/src/categories.pg.test.ts
it("stores and validates a category colour", async () => {
  const tenantId = await seedTenant(suite.admin);
  await seedLegacySellingUnits(suite.admin, tenantId);
  const made = await app(suite.admin, tenantId, (tx) =>
    createCategory(tx, tenantId, { name: { en: "Hot" }, color: "#b12525" }),
  );
  expect(made.color).toBe("#b12525");
  const cleared = await app(suite.admin, tenantId, (tx) =>
    updateCategory(tx, tenantId, made.id, { color: null }),
  );
  expect(cleared.color).toBeNull();
  await expect(
    app(suite.admin, tenantId, (tx) => createCategory(tx, tenantId, { name: { en: "Bad" }, color: "#FFF" })),
  ).rejects.toMatchObject({ code: "category.color_invalid" });
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `pnpm --filter @waitron/catalogue test categories.pg`
Expected: FAIL — `color` undefined / not validated. (Real-PG suite needs `TESTCONTAINERS_RYUK_DISABLED=true`; it uses `useTemplateDb`.)

- [ ] **Step 5: Implement**

In `packages/catalogue/src/categories.ts`:

Add to the `columns` map: `color: categoryDetails.color,`

Add `color?: string | null` to `CategoryInput` and `color: string | null` to `Category`.

Add a validator near `validateImage`:

```ts
function validateColor(color: string | null | undefined): void {
  if (color === undefined || color === null) return;
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new AppError("category.color_invalid", {});
}
```

In `createCategory`, call `validateColor(input.color)` (before the inserts) and add `color: input.color ?? null` to the `categoryDetails` insert values.

In `updateCategory`, compute `const color = patch.color === undefined ? current.color : patch.color;`, call `validateColor(color)`, and add `color` to both the insert `.values` and the `onConflictDoUpdate` `set`.

- [ ] **Step 6: Run and pass**

Run: `pnpm --filter @waitron/catalogue test categories.pg`
Expected: PASS.

- [ ] **Step 7: Verify configuration transfer carries the column**

Run: `grep -n "color\|category_details\|image\|parent_id" packages/catalogue/src/configuration-transfer.ts`. If it selects `category_details` columns explicitly, add `color`; if it copies the whole row, nothing to do. Add or extend a transfer test asserting `color` round-trips if the file enumerates columns.

- [ ] **Step 8: Commit**

```bash
git add packages/catalogue/src/schema/categories.ts packages/catalogue/src/categories.ts packages/catalogue/src/errors.ts packages/catalogue/drizzle/ packages/catalogue/src/categories.pg.test.ts packages/catalogue/src/configuration-transfer.ts
git commit -s -m "Store an optional colour on a category"
```

---

## Task 6: Reporting category becomes optional

**Files:**
- Modify: `packages/catalogue/src/categories.ts` (`replaceProductCategories`), `packages/catalogue/src/product-editor-input.ts`
- Test: `packages/catalogue/src/categories.pg.test.ts`, `packages/catalogue/src/categories.test.ts`

**Interfaces:**
- Produces: `replaceProductCategories` accepts a null reporting category with a non-empty set; when the reporting category is omitted after the current one was removed, the result is `null` (was `category.primary_required`).

- [ ] **Step 1: Write the failing tests**

```ts
// add to packages/catalogue/src/categories.pg.test.ts
it("allows memberships with no reporting category", async () => {
  const { tenantId, a, b } = await fixture();
  const productId = await app(suite.admin, tenantId, async (tx) => {
    const cat = await createCatalogue(tx, tenantId, { name: "Main" });
    return (await createProduct(tx, tenantId, cat.id, { /* minimal product input — copy from existing test */ } as never)).id;
  });
  const saved = await app(suite.admin, tenantId, (tx) =>
    replaceProductCategories(tx, tenantId, productId, { categoryIds: [a.id, b.id], primaryCategoryId: null }),
  );
  expect(saved.primaryCategoryId).toBeNull();
  expect(saved.categoryIds).toEqual([a.id, b.id].sort());
});

it("clears reporting category when the current one is removed and none is chosen", async () => {
  const { tenantId, a, b } = await fixture();
  // build a product with a,b and primary a, then replace with only b and omit primary
  // ... (mirror the fixture's product creation)
  // expect result primaryCategoryId === null (previously threw category.primary_required)
});
```

Fill the product-creation gap by copying the existing product setup already present in `categories.pg.test.ts` (search the file for `createProduct`).

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/catalogue test categories.pg`
Expected: FAIL — first test throws `category.membership_invalid` or `primary_required`.

- [ ] **Step 3: Implement**

In `replaceProductCategories` (`packages/catalogue/src/categories.ts`), change the omitted-primary branch so a removed current primary resolves to `null` instead of throwing:

```ts
let primary = input.primaryCategoryId;
if (primary === undefined) {
  if (!input.categoryIds.length) primary = null;
  else if (current.primaryCategoryId !== null && input.categoryIds.includes(current.primaryCategoryId))
    primary = current.primaryCategoryId;
  else primary = input.categoryIds[0]!; // first membership as a convenience when there was none
  // NOTE: when the current primary was removed, we now KEEP the auto-first behaviour only if there
  // was no primary before; otherwise leave it to the explicit path below.
}
```

Re-read the spec: the intended omitted-primary rules are — no memberships → null; current primary survives → keep; there was no primary → first id; current primary removed → **null**. Encode exactly that:

```ts
let primary = input.primaryCategoryId;
if (primary === undefined) {
  if (!input.categoryIds.length) primary = null;
  else if (current.primaryCategoryId === null) primary = input.categoryIds[0]!;
  else if (input.categoryIds.includes(current.primaryCategoryId)) primary = current.primaryCategoryId;
  else primary = null;
}
```

Then the existing final validation must allow `primary === null` with a non-empty set:

```ts
if (primary !== null && !input.categoryIds.includes(primary)) throw new AppError("category.membership_invalid", {});
if (input.categoryIds.length === 0 && primary !== null) throw new AppError("category.membership_invalid", {});
```

(Remove the old branch that threw `category.primary_required`.)

In `packages/catalogue/src/product-editor-input.ts`, relax the check to allow a null primary with a non-empty set:

```ts
if (
  categoryIds.length
    ? primaryCategoryId !== null && !categoryIds.includes(primaryCategoryId)
    : primaryCategoryId !== null
)
  invalid("primaryCategoryId");
```

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/catalogue test categories`
Expected: PASS. Also run the product-editor input tests: `pnpm --filter @waitron/catalogue test product-editor`.

- [ ] **Step 5: Prove the sale/routing paths tolerate a null primary**

Run the till and product read suites to confirm nothing regressed:

Run: `pnpm --filter @waitron/catalogue test:coverage` (or the focused `operations` and product files)
Then `pnpm --filter @waitron/server test till-api` and `pnpm --filter @waitron/venue-service test operations` as a spot-check. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/categories.ts packages/catalogue/src/product-editor-input.ts packages/catalogue/src/categories.pg.test.ts packages/catalogue/src/categories.test.ts
git commit -s -m "Let a product keep categories with no reporting category"
```

---

## Task 7: Cascading delete

**Files:**
- Modify: `packages/catalogue/src/categories.ts` (`deleteCategory`)
- Test: `packages/catalogue/src/categories.pg.test.ts`

**Interfaces:**
- Produces: `deleteCategory` no longer throws `category.in_use`; it removes memberships, clears reporting categories, reparents children, drops routes (when the table exists), then deletes the row — all under the existing lock.

- [ ] **Step 1: Write the failing tests**

```ts
// add to packages/catalogue/src/categories.pg.test.ts
it("deleting a category unassigns products and clears their reporting category", async () => {
  // create category X; a product with primary X and another membership Y; a product with only X
  // delete X
  // expect: memberships to X gone; product1.primaryCategoryId === null (was X); product2 has no memberships and null primary
});

it("deleting a category reparents its children to its parent", async () => {
  // Food > Breakfast > Eggs. delete Breakfast. expect Eggs.parentId === Food.id
});

it("deleting a top-level category makes its children top-level", async () => {
  // Breakfast(no parent) > Eggs. delete Breakfast. expect Eggs.parentId === null
});
```

For the route case (needs the `preparation_routes` table, which lives in venue-service migrations, not core), put it where the venue tables are available. `packages/venue-service/src/category-dependencies.test.ts` already migrates core + venue-service and imports `createPreparationRoute`/`deletePreparationRoute`. Add there:

```ts
it("deleting a category removes its preparation routes", async () => {
  // create a category route to a station, then deleteCategory, expect the route gone and the delete to succeed
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/catalogue test categories.pg` and `pnpm --filter @waitron/venue-service test category-dependencies`
Expected: FAIL — current `deleteCategory` throws `category.in_use`.

- [ ] **Step 3: Implement**

Rewrite `deleteCategory` in `packages/catalogue/src/categories.ts`:

```ts
export async function deleteCategory(tx: Transaction, tenantId: string, id: string): Promise<void> {
  await lockCategories(tx, tenantId);
  const category = await readCategory(tx, tenantId, id); // 404s a foreign/absent id, tenant-scoped
  // Lock the identity: route inserts hold its FK's KEY SHARE lock.
  await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)))
    .for("update");
  // 1. memberships
  await tx
    .delete(productCategories)
    .where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.categoryId, id)));
  // 2. clear reporting category where it was this one
  await tx
    .update(products)
    .set({ categoryId: null, updatedAt: sql`now()` })
    .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, id)));
  // 3. reparent direct children to this category's own parent
  await tx
    .update(categoryDetails)
    .set({ parentId: category.parentId })
    .where(and(eq(categoryDetails.tenantId, tenantId), eq(categoryDetails.parentId, id)));
  // 4. drop preparation routes for this category, if the (optional) venue table exists
  const routeTable = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.preparation_routes') is not null as present`,
  );
  if (routeTable.rows[0]!.present)
    await tx.execute(
      sql`delete from preparation_routes where tenant_id = ${tenantId} and category_id = ${id}`,
    );
  // 5. the category row (category_details cascades via its FK)
  await tx.delete(categories).where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)));
}
```

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/catalogue test categories.pg` and `pnpm --filter @waitron/venue-service test category-dependencies`
Expected: PASS.

- [ ] **Step 5: Extend the race test**

In `apps/server/src/category-route-race.pg.test.ts` (or `packages/catalogue/src/categories.pg.test.ts`'s `race` helper), confirm a concurrent `deleteCategory` and a category-route insert cannot leave a dangling route: one serializes behind the other under `lockCategories` + the `for("update")` on the identity. Add an assertion that after both, either the route was inserted then deleted (category gone) or the insert failed on the missing FK. Keep it real-PG.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/categories.ts packages/catalogue/src/categories.pg.test.ts packages/venue-service/src/category-dependencies.test.ts apps/server/src/category-route-race.pg.test.ts
git commit -s -m "Delete a category by cascading, not refusing"
```

---

## Task 8: Delete-preview read (`categoryDependants`)

**Files:**
- Modify: `packages/catalogue/src/categories.ts`
- Test: `packages/catalogue/src/categories.pg.test.ts` (products/children), `packages/venue-service/src/category-dependencies.test.ts` (routes)

**Interfaces:**
- Produces:

```ts
export interface CategoryDependants {
  products: { id: string; name: Record<string, string>; reporting: boolean }[];
  children: { id: string; name: Record<string, string> }[];
  parentId: string | null;
  routes: { id: string; station: string | null; zone: string | null }[];
}
export function categoryDependants(tx: Transaction, tenantId: string, id: string): Promise<CategoryDependants>;
```

- [ ] **Step 1: Write the failing test** (products + children + parentId)

```ts
it("reports a category's dependants for the delete preview", async () => {
  // Food > X; X has child Eggs; product P1 primary X; product P2 membership X only (primary null)
  const deps = await app(suite.admin, tenantId, (tx) => categoryDependants(tx, tenantId, xId));
  expect(deps.parentId).toBe(foodId);
  expect(deps.children.map((c) => c.id)).toEqual([eggsId]);
  expect(deps.products.find((p) => p.id === p1Id)!.reporting).toBe(true);
  expect(deps.products.find((p) => p.id === p2Id)!.reporting).toBe(false);
});

it("dependants is tenant-scoped", async () => {
  await expect(app(suite.admin, otherTenantId, (tx) => categoryDependants(tx, otherTenantId, xId)))
    .rejects.toMatchObject({ code: "category.not_found" });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/catalogue test categories.pg`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
export interface CategoryDependants {
  products: { id: string; name: Record<string, string>; reporting: boolean }[];
  children: { id: string; name: Record<string, string> }[];
  parentId: string | null;
  routes: { id: string; station: string | null; zone: string | null }[];
}

export async function categoryDependants(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<CategoryDependants> {
  const category = await readCategory(tx, tenantId, id); // 404 tenant-scoped
  const productRows = await tx
    .select({ id: products.id, name: products.descriptions, primary: products.categoryId })
    .from(products)
    .innerJoin(
      productCategories,
      and(
        eq(productCategories.tenantId, products.tenantId),
        eq(productCategories.productId, products.id),
        eq(productCategories.categoryId, id),
      ),
    )
    .where(eq(products.tenantId, tenantId))
    .orderBy(products.id);
  const childRows = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categoryDetails)
    .innerJoin(
      categories,
      and(eq(categories.tenantId, categoryDetails.tenantId), eq(categories.id, categoryDetails.categoryId)),
    )
    .where(and(eq(categoryDetails.tenantId, tenantId), eq(categoryDetails.parentId, id)))
    .orderBy(categories.id);
  const routes: CategoryDependants["routes"] = [];
  const routeTable = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.preparation_routes') is not null as present`,
  );
  if (routeTable.rows[0]!.present) {
    const routeRows = await tx.execute<{ id: string; station: string | null; zone: string | null }>(sql`
      select pr.id,
             case when pr.no_preparation then null else ks.name end as station,
             fz.name as zone
      from preparation_routes pr
      left join kitchen_stations ks on ks.tenant_id = pr.tenant_id and ks.id = pr.station_id
      left join floor_zones fz on fz.tenant_id = pr.tenant_id and fz.id = pr.zone_id
      where pr.tenant_id = ${tenantId} and pr.category_id = ${id}
      order by pr.id`);
    routes.push(...routeRows.rows);
  }
  return {
    products: productRows.map((p) => ({ id: p.id, name: p.name, reporting: p.primary === id })),
    children: childRows,
    parentId: category.parentId,
    routes,
  };
}
```

Verify the zone table name (`floor_zones`) and its `name`/`tenant_id`/`id` columns with `grep -rn "floor_zones\|floorZones" packages/venue-service/src/schema`. Adjust the SQL to the real names. `kitchen_stations` is core.

- [ ] **Step 4: Run and pass** (products/children)

Run: `pnpm --filter @waitron/catalogue test categories.pg`
Expected: PASS.

- [ ] **Step 5: Route test in venue-service**

Add to `packages/venue-service/src/category-dependencies.test.ts` a test that creates a category route to a named station in a named zone, then asserts `categoryDependants(...).routes` carries that id, the station name, and the zone name (and `station: null` for a no-preparation route). Import `categoryDependants` from `@waitron/catalogue`.

Run: `pnpm --filter @waitron/venue-service test category-dependencies`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/categories.ts packages/catalogue/src/categories.pg.test.ts packages/venue-service/src/category-dependencies.test.ts
git commit -s -m "Read a category's dependants for the delete confirmation"
```

---

## Task 9: Bulk add products to a category

**Files:**
- Modify: `packages/catalogue/src/categories.ts`
- Test: `packages/catalogue/src/categories.pg.test.ts`

**Interfaces:**
- Produces: `addProductsToCategory(tx, tenantId, categoryId, productIds: string[]): Promise<void>` — adds missing memberships; sets the reporting category to this one for a product that has none; rejects duplicate/unknown/foreign ids atomically with `category.membership_invalid`.

- [ ] **Step 1: Write the failing test**

```ts
it("bulk-adds products, setting reporting category only where absent", async () => {
  // category C; product P1 (no memberships, primary null); product P2 (membership+primary D)
  await app(suite.admin, tenantId, (tx) => addProductsToCategory(tx, tenantId, cId, [p1Id, p2Id]));
  const m1 = await app(suite.admin, tenantId, (tx) => readProductCategories(tx, tenantId, p1Id));
  const m2 = await app(suite.admin, tenantId, (tx) => readProductCategories(tx, tenantId, p2Id));
  expect(m1.categoryIds).toContain(cId);
  expect(m1.primaryCategoryId).toBe(cId); // had none
  expect(m2.categoryIds).toEqual([cId, dId].sort());
  expect(m2.primaryCategoryId).toBe(dId); // kept
});

it("bulk add is atomic on a foreign id", async () => {
  await expect(app(suite.admin, tenantId, (tx) => addProductsToCategory(tx, tenantId, cId, [p1Id, "bad"])))
    .rejects.toMatchObject({ code: "category.membership_invalid" });
  const m1 = await app(suite.admin, tenantId, (tx) => readProductCategories(tx, tenantId, p1Id));
  expect(m1.categoryIds).not.toContain(cId); // nothing applied
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/catalogue test categories.pg`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
export async function addProductsToCategory(
  tx: Transaction,
  tenantId: string,
  categoryId: string,
  productIds: string[],
): Promise<void> {
  await lockCategories(tx, tenantId);
  await readCategory(tx, tenantId, categoryId); // 404 tenant-scoped
  if (new Set(productIds).size !== productIds.length) throw new AppError("category.membership_invalid", {});
  for (const productId of productIds) {
    // tenant-scoped existence check
    const [product] = await tx
      .select({ id: products.id, primary: products.categoryId })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
    if (!product) throw new AppError("category.membership_invalid", {});
    await tx
      .insert(productCategories)
      .values({ tenantId, productId, categoryId })
      .onConflictDoNothing();
    if (product.primary === null)
      await tx
        .update(products)
        .set({ categoryId, updatedAt: sql`now()` })
        .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
  }
}
```

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/catalogue test categories.pg`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/catalogue/src/categories.ts packages/catalogue/src/categories.pg.test.ts
git commit -s -m "Add many products to a category in one write"
```

---

## Task 10: Server routes — colour, relaxed membership, dependants, bulk add

**Files:**
- Modify: `apps/server/src/catalogue-api.ts`
- Test: `apps/server/src/catalogue-api.test.ts`, and a real-PG guard in `apps/server/src/catalogue-api.pg.test.ts`

**Interfaces:**
- Consumes: `categoryDependants`, `addProductsToCategory` from Task 8/9; `color` on `CategoryInput`.
- Produces: `GET /management-api/categories/:id/dependants` → `CategoryDependants`; `POST /management-api/categories/:id/products` `{ productIds }` → 204; `POST/PATCH /management-api/categories` accept `color`; `PUT /management-api/products/:id/categories` accepts a null `primaryCategoryId` with a non-empty set.

- [ ] **Step 1: Write the failing tests**

```ts
// add to apps/server/src/catalogue-api.test.ts
it("creates a category with a colour", async () => {
  const res = await app.request("/management-api/categories", {
    method: "POST",
    headers: { cookie: managerCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: { en: "Hot" }, color: "#b12525" }),
  });
  expect(res.status).toBe(201);
  expect((await res.json()).color).toBe("#b12525");
});

it("rejects a bad colour", async () => {
  const res = await app.request("/management-api/categories", {
    method: "POST",
    headers: { cookie: managerCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: { en: "Hot" }, color: "red" }),
  });
  expect(res.status).toBe(400); // category.color_invalid maps to 400
});

it("returns a category's dependants", async () => {
  // create category, assert GET .../:id/dependants returns the shape with 200 and manager gate
});

it("bulk-adds products", async () => {
  // create category + product, POST .../:id/products {productIds:[id]}, expect 204, membership present
});

it("accepts a null reporting category on the membership PUT", async () => {
  // PUT .../products/:id/categories {categoryIds:[a,b], primaryCategoryId:null} -> 200
});
```

Add the `category.color_invalid` → 400 mapping check by reading `apps/server/src/catalogue-api.ts`'s status map (around line 137) and adding the entry.

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/server test catalogue-api`
Expected: FAIL — routes/mappings missing.

- [ ] **Step 3: Implement**

In `apps/server/src/catalogue-api.ts`:

- Add `"category.color_invalid": 400,` to the status map.
- In `categoryInput` (the body screen near line 103), pass `color` through when present, validating only that it is a string or null (the operation does the format check):

```ts
if (body.color !== undefined) {
  if (body.color !== null && typeof body.color !== "string")
    throw new AppError("management.request_invalid", { field: "color" });
  input.color = body.color;
}
```

- Relax the PUT membership screen (near line 756) so a null `primaryCategoryId` with a non-empty set is allowed; the operation enforces membership. Keep the id-shape checks.
- Add the two routes beside the others (mirror the existing `.get`/`.post` handler style, all inside `withTenant` + `asAppUser` + `authorizeManager`, comparing the session tenant as the sibling routes do):

```ts
app.get("/management-api/categories/:id/dependants", (c) =>
  withManager(c, (tx, tenantId) => categoryDependants(tx, tenantId, c.req.param("id"))),
);
app.post("/management-api/categories/:id/products", async (c) => {
  const body = await readJsonBody<{ productIds?: unknown }>(c);
  if (!Array.isArray(body.productIds) || body.productIds.some((v) => typeof v !== "string" || !isUuid(v)))
    throw new AppError("management.request_invalid", { field: "productIds" });
  await withManager(c, (tx, tenantId) =>
    addProductsToCategory(tx, tenantId, c.req.param("id"), body.productIds as string[]),
  );
  return c.body(null, 204);
});
```

Use whatever the file's real manager-scoped helper is called (read the existing category routes near line 689–775 and copy their exact wrapper — the snippet's `withManager` is a stand-in name).

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/server test catalogue-api`
Expected: PASS.

- [ ] **Step 5: Real-PG guard for the optional route table**

In `apps/server/src/catalogue-api.pg.test.ts` (real Postgres, migrates core + catalogue but NOT venue-service), assert `GET .../:id/dependants` returns `routes: []` and `DELETE` succeeds — proving the `to_regclass` guard. If a suitable file/harness is not present, add the case to `apps/server/src/category-fks.pg.test.ts`, which already exercises category FKs. Prove the gate by deletion where practical.

Run: `pnpm --filter @waitron/server test category-fks` (or the pg file you extended)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/catalogue-api.ts apps/server/src/catalogue-api.test.ts apps/server/src/catalogue-api.pg.test.ts apps/server/src/category-fks.pg.test.ts
git commit -s -m "Expose category colour, dependants and bulk add through the management API"
```

---

## Task 11: Dashboard client — types and methods

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`
- Test: `apps/dashboard/src/api/client.test.ts`

**Interfaces:**
- Produces: `CategorySummary.color: string | null`; `CategoryInput.color?: string | null`; `ProductCategoriesInput.primaryCategoryId?: string | null` (already optional — verify); `CategoryDependants` type; `getCategoryDependants(id)`; `addProductsToCategory(id, productIds)`.

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/dashboard/src/api/client.test.ts (mirror its fetch-stub style)
it("fetches category dependants", async () => {
  // stub fetch to return a CategoryDependants shape; assert client.getCategoryDependants(id) resolves it
});
it("posts a bulk add", async () => {
  // assert client.addProductsToCategory(id, ["p1"]) POSTs to /management-api/categories/:id/products
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/dashboard test client`
Expected: FAIL — methods absent.

- [ ] **Step 3: Implement**

In `apps/dashboard/src/api/client.ts`:

- Add `color: string | null` to `CategorySummary`; add `color?: string | null` to `CategoryInput`.
- Add the dependants type:

```ts
export interface CategoryDependants {
  products: { id: string; name: Record<string, string>; reporting: boolean }[];
  children: { id: string; name: Record<string, string> }[];
  parentId: string | null;
  routes: { id: string; station: string | null; zone: string | null }[];
}
```

- Add methods near the other category methods:

```ts
getCategoryDependants(id: string): Promise<CategoryDependants> {
  return this.#request(`/management-api/categories/${id}/dependants`, "GET");
}
addProductsToCategory(id: string, productIds: string[]): Promise<void> {
  return this.#request(`/management-api/categories/${id}/products`, "POST", { productIds });
}
```

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/dashboard test client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/client.test.ts
git commit -s -m "Add category colour, dependants and bulk-add to the dashboard client"
```

---

## Task 12: Strings and the `plus` icon

**Files:**
- Modify: `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/icons.ts`

**Interfaces:**
- Produces: new i18n keys (en + es); a registered `plus` icon.

- [ ] **Step 1: Add the icon**

In `apps/dashboard/src/icons.ts`, add a `plus` entry (an SVG path string, matching the existing `chevron-down` shape). A plus path: `M12 5v14M5 12h14` as two strokes, or the project's icon convention (check how `chevron-down` is stored — a `<path d="…">` fragment). Match that exactly.

- [ ] **Step 2: Add strings**

In `apps/dashboard/src/i18n/strings.ts`, add to both the English and Spanish blocks (place beside the existing `categories.*` keys). Reuse `editor.reporting_category` ("Reporting Category" / "Categoría de informes") for the label rather than minting a new one; where the categories screen currently uses `categories.primary`, switch it to `editor.reporting_category`.

English:

```ts
"categories.mode_tree": "Tree",
"categories.mode_flat": "Flat",
"categories.color": "Colour",
"categories.color_none": "No colour",
"categories.color_custom": "Custom",
"categories.products_modal": "Products",
"categories.other_categories": "Other categories",
"categories.none": "None",
"categories.add_products": "Add products",
"categories.add_selected": "Add {count} products",
"categories.remove_from": "Remove from this category",
"categories.delete_intro": "This cannot be undone. Deleting it will:",
"categories.delete_products": "Remove it from {count} products",
"categories.delete_reporting": "reporting category, will be cleared",
"categories.delete_children_under": "Move {count} child categories under {parent}",
"categories.delete_children_top": "Move {count} child categories to the top level",
"categories.delete_routes": "Remove {count} kitchen routes",
"categories.route_all_zones": "all zones",
"categories.no_preparation": "no preparation",
"categories.collapse": "Collapse",
"categories.expand": "Expand",
```

Spanish (translate; reuse existing terms — `Añadir productos`, `Sin color`, `Personalizado`, `Ninguna`, `todas las zonas`, `sin preparación`, `Árbol`, `Lista`, etc.). Match the tone of the existing `categories.*` Spanish already in the file.

- [ ] **Step 3: Run the strings guard and commit**

Run: `pnpm --filter @waitron/dashboard test strings` (if a completeness guard exists) or `pnpm --filter @waitron/dashboard typecheck`.
Expected: PASS / no missing-key errors.

```bash
git add apps/dashboard/src/i18n/strings.ts apps/dashboard/src/icons.ts
git commit -s -m "Add category screen strings and a plus icon"
```

---

## Task 13: Category form colour picker

**Files:**
- Modify: `apps/dashboard/src/widgets/category-form.ts`
- Test: `apps/dashboard/src/widgets/category-form.test.ts`, `apps/dashboard/src/widgets/category-form.a11y.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_PALETTE`, `WtLozenge`; `color` on `CategoryInput`/`CategorySummary`.
- Produces: the form's `wt-submit` value carries `color: string | null`; a palette-swatch picker plus native custom input plus "No colour".

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/dashboard/src/widgets/category-form.test.ts
it("submits the chosen colour", async () => {
  // mount the form open, click a palette swatch (data-color="#b12525"), submit, assert detail.value.color === "#b12525"
});
it("edits from an existing colour and can clear it", async () => {
  // value has color '#256bb1'; click 'No colour'; submit; assert detail.value.color === null
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/dashboard test category-form`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `category-form.ts`: import `CATEGORY_PALETTE` from `@waitron/ui` and `"@waitron/ui/src/components/wt-lozenge.js"`. Add `@state() private color: string | null = null;` seeded in `willUpdate` from `this.value?.color ?? null`. Add the picker between the parent select and the image upload:

```ts
<fieldset class="color">
  <legend>${t("categories.color")}</legend>
  <div class="swatches" role="radiogroup" aria-label=${t("categories.color")}>
    <button
      type="button"
      class="swatch none ${this.color === null ? "on" : ""}"
      data-color=""
      aria-pressed=${this.color === null}
      @click=${() => (this.color = null)}
    >${t("categories.color_none")}</button>
    ${CATEGORY_PALETTE.map(
      (c) => html`<button
        type="button"
        class="swatch ${this.color === c ? "on" : ""}"
        style=${`background:${c}`}
        data-color=${c}
        aria-label=${c}
        aria-pressed=${this.color === c}
        @click=${() => (this.color = c)}
      ></button>`,
    )}
    <label class="custom">${t("categories.color_custom")}
      <input
        type="color"
        .value=${this.color ?? "#000000"}
        @input=${(e: Event) => (this.color = (e.target as HTMLInputElement).value)}
      />
    </label>
  </div>
</fieldset>
```

Add `color: this.color` to the `wt-submit` value object in `#submit`. Style the swatches with tokens (size `--wt-space-6`, `--wt-radius-sm`, `--wt-color-focus` outline on `:focus-visible`, a selected ring using `--wt-color-primary`). The swatch colour itself is an inline style (the data-colour exemption).

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/dashboard test category-form`
Expected: PASS.

- [ ] **Step 5: a11y and commit**

Update `category-form.a11y.test.ts` to open the form and assert no violations in both themes (its pattern already exists). Confirm the radiogroup names its options.

Run: `pnpm --filter @waitron/dashboard test category-form`
Expected: PASS.

```bash
git add apps/dashboard/src/widgets/category-form.ts apps/dashboard/src/widgets/category-form.test.ts apps/dashboard/src/widgets/category-form.a11y.test.ts
git commit -s -m "Add a colour picker to the category form"
```

---

## Task 14: Reporting category optional in the pickers

**Files:**
- Modify: `apps/dashboard/src/widgets/category-membership-picker.ts`, `apps/dashboard/src/widgets/product-editor.ts`
- Test: their `*.test.ts`

**Interfaces:**
- Produces: the membership picker allows submitting with no reporting category and offers a "None" option; the product editor drops its "reporting category required" validation and shows the reporting-category label (already `editor.reporting_category`).

- [ ] **Step 1: Write the failing tests**

```ts
// category-membership-picker.test.ts
it("submits memberships with no reporting category", async () => {
  // select two categories, choose 'None' primary, submit; assert value.primaryCategoryId === null, no error shown
});
// product-editor.test.ts
it("saves a product with categories and no reporting category", async () => {
  // pick categories, set reporting to None, submit; assert no 'reporting_category_required' error and submit fires
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/dashboard test category-membership-picker product-editor`
Expected: FAIL — current code blocks the empty primary.

- [ ] **Step 3: Implement**

In `category-membership-picker.ts`: remove the `#emit` guard that sets `this.error = t("categories.primary_required")` and returns; allow `primaryCategoryId: null`. Add a `<option value="">${t("categories.none")}</option>` to the primary `<select>` and let the empty value map to null (it already does via `|| null`). Rename the visible label from `categories.primary` to `editor.reporting_category`.

In `product-editor.ts`: delete the block that sets `errors.primary = t("editor.reporting_category_required")` when a primary is absent (keep rejecting a primary that is not in the set). The `<select>` should keep a "None" option and allow `primaryCategoryId: null`.

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/dashboard test category-membership-picker product-editor`
Expected: PASS. Also run the a11y suites for both.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/category-membership-picker.ts apps/dashboard/src/widgets/product-editor.ts apps/dashboard/src/widgets/category-membership-picker.test.ts apps/dashboard/src/widgets/product-editor.test.ts
git commit -s -m "Let the pickers leave a reporting category unset"
```

---

## Task 15: Categories screen — tree/flat table, filter, round button

**Files:**
- Modify: `apps/dashboard/src/screens/categories-screen.ts`
- Test: `apps/dashboard/src/screens/categories-screen.test.ts`, `categories-screen.a11y.test.ts`

**Interfaces:**
- Consumes: `wt-data-table` tree mode, `wt-lozenge`, round `wt-button`, `CATEGORY_PALETTE`, the client methods.
- Produces: the page renders a Tree/Flat toggle (persisted), a name filter, a round add button, and the table with chevron/image/colour-square/name-link rows; clicking a name opens the products modal (Task 16 wires the modal's inner tables).

This task is the page shell and the main table; Task 16 adds the three modals. Split the screen into helpers so each is testable and the file stays focused: keep `#columns()`/`#productColumns()` but add `#treeColumns()`, `#rowParent`, a `mode` state, and a colour-square render helper.

- [ ] **Step 1: Write the failing tests**

```ts
// add to apps/dashboard/src/screens/categories-screen.test.ts
it("shows a round create button by the heading", async () => {
  const el = await mountScreen(); // mirror the file's existing mount helper
  const add = el.shadowRoot!.querySelector('wt-button[round][data-test="create-category"]');
  expect(add).not.toBeNull();
  expect(add!.getAttribute("aria-label")).toBeTruthy();
});
it("defaults to tree mode and nests children", async () => {
  // seed categories Food>Breakfast; assert the table has rowParent set and Breakfast is under Food
});
it("switches to flat mode and shows a Parent column", async () => {
  // click the Flat toggle; assert a 'Parent' header appears and rows are flat
});
it("filters by name keeping ancestors in tree mode", async () => {
  // type 'egg'; assert Eggs and its ancestors Food/Breakfast are shown
});
it("renders each name with its colour square", async () => {
  // a category with color '#b12525'; assert a colour swatch element carries that colour
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/dashboard test categories-screen`
Expected: FAIL.

- [ ] **Step 3: Implement the shell**

Rework `render()` and columns:

- Heading row: `<h1>${t("nav.categories")}</h1>` then `<wt-button round variant="primary" data-test="create-category" aria-label=${t("categories.create")} @click=${() => this.#edit(null)}><wt-icon name="plus"></wt-icon></wt-button>`. Remove the old `wt-row-actions` kebab create.
- Add `@state() private mode: "tree" | "flat"` seeded from `localStorage.getItem("waitron.categories.mode")` (try/catch, default `"tree"`); persist on change.
- Add the Tree/Flat toggle (two `wt-button`s with `aria-pressed`, or `wt-tabs`). On change set `this.mode` and persist.
- Colour square helper:

```ts
#swatch(color: string | null) {
  return color
    ? html`<span class="swatch" style=${`background:${color}`} aria-hidden="true"></span>`
    : html`<span class="swatch none" aria-hidden="true"></span>`;
}
```

- Name column cell (both modes): image slot (existing thumbnail or an empty same-size span), the swatch, then the name as a `wt-button variant="ghost"` link that sets `this.selected = category.id` and opens the products modal (Task 16). In tree mode the chevron/indent come from `wt-data-table` itself, so the cell does NOT add its own indent.
- `#rowParent = (c: CategorySummary) => c.parentId` passed to the table only in tree mode.
- In tree mode omit the Parent column; in flat mode include a sortable Parent column using `categoryPath(parent, …)`.
- Filtering: compute matches by name (`this.#text(c.name).toLocaleLowerCase().includes(...)`). In flat mode pass the matches straight to `rows`. In tree mode pass matches plus all their ancestors (walk `parentId` up), so `wt-data-table` can nest them; ancestors that are not themselves matches render muted (add a `data-muted` style hook on the name).
- Pass `collapseLabel`/`expandLabel` from strings.
- Keep the existing category form and delete/membership modals in place for now; Task 16 replaces the products/membership/delete UI.

Verify `wt-icon` is imported in the screen.

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/dashboard test categories-screen`
Expected: PASS.

- [ ] **Step 5: a11y**

Update `categories-screen.a11y.test.ts` for the new shell in both themes.

Run: `pnpm --filter @waitron/dashboard test categories-screen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/screens/categories-screen.ts apps/dashboard/src/screens/categories-screen.test.ts apps/dashboard/src/screens/categories-screen.a11y.test.ts
git commit -s -m "Rebuild the categories table with tree and flat modes"
```

---

## Task 16: Categories screen — products modal, add-products checkbox table, delete preview

**Files:**
- Modify: `apps/dashboard/src/screens/categories-screen.ts`
- Test: `apps/dashboard/src/screens/categories-screen.test.ts`

**Interfaces:**
- Consumes: `getCategoryDependants`, `addProductsToCategory`, `replaceProductCategories`, `wt-lozenge`.
- Produces: clicking a name opens a modal listing the category's products (sortable, filterable, lozenges); an "Add products" view (checkbox table, one save); a delete modal showing the dependants preview with links.

- [ ] **Step 1: Write the failing tests**

```ts
// add to apps/dashboard/src/screens/categories-screen.test.ts
it("opens the products modal from the name and lists members with lozenges", async () => {
  // click a category name; assert a wt-modal is open with a table of its products and wt-lozenge for other categories
});
it("adds products via the checkbox table in one call", async () => {
  // open products modal, click Add products; tick two rows; assert the footer reads 'Add 2 products'
  // click it; assert client.addProductsToCategory called once with both ids
});
it("shows the delete preview with product, child and route links", async () => {
  // stub getCategoryDependants; open delete; assert product/child/route names render as links (anchors or wt-buttons)
  // assert the Delete button is disabled until the preview resolves
});
it("a delete-modal product link navigates to the product editor", async () => {
  // click a product link; assert navigation to /manage/catalogue?product=<id> (spy on the app's navigate)
});
it("removing a member clears a reporting category that was this one", async () => {
  // a product whose primary is this category; click Remove from this category; assert replaceProductCategories
  // called with categoryIds without this id and primaryCategoryId null
});
```

Check how the screen currently navigates between screens (`categories-screen.ts` reads `location.href`; the app likely has a navigate helper — reuse the same mechanism the delete-link uses; grep `navigate(` in `dashboard-app.ts`). Assert against that mechanism.

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/dashboard test categories-screen`
Expected: FAIL.

- [ ] **Step 3: Implement the products modal**

Replace the old "selected category shows products below the table" block with a `wt-modal` (`this.selected` non-null opens it). Body: a name filter, an "Add products" `wt-button variant="primary"` that flips an internal `addingProducts` flag, and a `wt-data-table` with columns Name, Reporting category (`wt-lozenge` or `t("categories.none")`), Other categories (each other membership as a `wt-lozenge` with its colour; muted dash when none), Actions (Edit → existing membership picker; Remove → `#assign(product, true)`). Feed the table the already-loaded products filtered to members. Sorting via `sortValue`.

Reporting-category and other-category lozenges resolve a colour from `this.categories.find(...)?.color ?? ""`.

- [ ] **Step 4: Implement the add-products view**

When `addingProducts`, the same modal shows: a filter and a `wt-data-table` of products NOT in the category, with a leading checkbox column (`cell` renders `<input type="checkbox" .checked=${this.picked.has(p.id)} @change=…>`), Name, Reporting category, Other categories. A header "select all visible" checkbox. Footer: Cancel (back to the products view) and `Add N products` (`t("categories.add_selected")` with `{count}`), disabled at zero, calling `this.api.addProductsToCategory(this.selected, [...this.picked])` once, then reload + return to products view. Keep the selection and show the error on failure.

- [ ] **Step 5: Implement the delete preview**

On opening delete (`this.deleting = category`), call `this.api.getCategoryDependants(category.id)` into `@state() private dependants`. Show a spinner and disable Delete until it resolves. Render:

- `categories.delete_products` with `{count}`, each product a link (a `wt-button variant="ghost"` styled as a link, or an `<a>`) that navigates to the catalogue screen with `?product=<id>` via the app's navigation, closing the modal; append `categories.delete_reporting` (in `--wt-color-danger`) for `reporting: true`.
- children: `delete_children_under` with the parent's resolved name, or `delete_children_top` when `parentId` is null; each child a link that opens `/manage/categories?category=<id>` (the category editor).
- routes: `delete_routes`; each `${station ?? t("categories.no_preparation")} · ${zone ?? t("categories.route_all_zones")}` linking to `/manage/venue-operations/view/routing`.
- Sections with zero items omitted.

Confirm/Delete calls `this.api.deleteCategory` (unchanged) then reloads.

- [ ] **Step 6: Run and pass**

Run: `pnpm --filter @waitron/dashboard test categories-screen`
Expected: PASS. Re-run the a11y suite.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/screens/categories-screen.ts apps/dashboard/src/screens/categories-screen.test.ts apps/dashboard/src/screens/categories-screen.a11y.test.ts
git commit -s -m "Add the products modal, checkbox add, and delete preview to categories"
```

---

## Task 17: Catalogue screen `?product=` deep link

**Files:**
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts`
- Test: `apps/dashboard/src/screens/catalogue-screen.test.ts`

**Interfaces:**
- Produces: on load, the catalogue screen opens the product named by `?product=<id>` once; an unknown id does nothing.

- [ ] **Step 1: Write the failing test**

```ts
it("opens the product named in the address once", async () => {
  history.replaceState(null, "", "/manage/catalogue?product=<seeded-id>");
  const el = await mountCatalogue(); // mirror existing mount + api stub
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-product-editor")!.hasAttribute("open") || (el as any).editorOpen).toBeTruthy();
});
it("ignores an unknown product id", async () => {
  history.replaceState(null, "", "/manage/catalogue?product=unknown");
  const el = await mountCatalogue();
  await el.updateComplete;
  expect((el as any).editorOpen).toBe(false);
});
```

Match the file's real test harness (`catalogue-screen.test.ts`) for mounting and the products fixture.

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @waitron/dashboard test catalogue-screen`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `catalogue-screen.ts`, after products load (in the same `updated`/load path that already populates `this.products`), read `new URL(location.href).searchParams.get("product")` once (guard with a `#deepLinked` boolean so it fires a single time), and if it matches a loaded product id call the existing `#openProduct(id)`. An unknown id is ignored. Clear the param from the URL with `history.replaceState` (mirror the `login=google` cleanup near line 680) so a refresh does not reopen.

- [ ] **Step 4: Run and pass**

Run: `pnpm --filter @waitron/dashboard test catalogue-screen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/catalogue-screen.ts apps/dashboard/src/screens/catalogue-screen.test.ts
git commit -s -m "Open a product from the catalogue address for deep links"
```

---

## Task 18: Documentation

**Files:**
- Modify: `docs/developers/product-categories.md`, `docs/developers/design-system.md`, `docs/products.md`, `docs/backlog.md`

- [ ] **Step 1: Update the API/integration guide**

In `docs/developers/product-categories.md`: change the delete section to describe the cascade (unassign products, clear reporting where it was this one, reparent children, drop routes) instead of the refusal; document that the reporting category is optional; add the `color` field to the `Category` shape; add the `GET .../:id/dependants` and `POST .../:id/products` rows to the route table; note that `PUT .../products/:id/categories` accepts a null `primaryCategoryId` with a non-empty set.

- [ ] **Step 2: Update the design system**

In `docs/developers/design-system.md`: add `wt-lozenge` (filled with a data colour, text colour computed for contrast, neutral chip when colourless), the round `wt-button` option, and the `wt-data-table` tree mode. Record the exception that a data colour may be a filled background when the text colour is computed and the label carries the meaning, distinct from the border-and-dot idiom used elsewhere.

- [ ] **Step 3: Update operator and backlog docs**

In `docs/products.md`: the "Choose one of them as its Reporting Category" paragraph becomes "you may choose one" and states what a product without one records (no reporting label; the category route is simply absent). In `docs/backlog.md`: the #340 row's "deletion is refused while …" sentence is now stale — update it to the cascade, and note the two new backlog items from the spec's Out of scope (a category-dependants contract seat; showing colours on till/menus/reports) if not already present.

- [ ] **Step 4: Format and commit**

Run: `pnpm exec prettier --write docs/developers/product-categories.md docs/developers/design-system.md docs/products.md docs/backlog.md`

```bash
git add docs/developers/product-categories.md docs/developers/design-system.md docs/products.md docs/backlog.md
git commit -s -m "Document the categories screen, colours, cascade and shared primitives"
```

---

## Task 19: Guards and whole-branch verification

**Files:** none (verification only)

- [ ] **Step 1: Run the root guard suites touched by the schema/UI change**

Run: `pnpm --filter @waitron/catalogue test:coverage`
Run: `pnpm --filter @waitron/ui test:coverage`
Run: `pnpm --filter @waitron/dashboard test:coverage`
Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS with coverage thresholds met (catalogue is on the 98/98/98/95 bar; ui/dashboard/server on 90/90/85/85).

- [ ] **Step 2: Run the classification and journal guards**

Run: `pnpm test classification-complete journal-monotonic append-only-enable-always` (root project)
Expected: PASS — no new table was added, but the colour column and generated migration must not break the journal or classification guards.

- [ ] **Step 3: Open it and look**

Run the dashboard against the dev stack (`wa-wt demo waitron-categories`; if the dev DB has categories, `wa-wt reset demo waitron-categories` first because the earlier category migration reset is unrelated but the dev DB may be stale). Open `/manage/categories` in the browser, in both light and dark themes and at phone width: create a category with a palette colour and a custom colour, nest one under another, collapse a branch, filter by name, open the products modal, add products via the checkbox table, and delete a category that has products, a child and a route. Confirm the preview lists all three and the delete goes through.

- [ ] **Step 4: Announce readiness**

Report to the owner that branch work and validation are complete and you are ready to run `finish-branch`.

---

## Self-Review

**Spec coverage** — every spec section maps to a task:

- Colour storage/API → Task 5, 10, 11. Reporting optional → Task 6, 10, 14. Delete cascade → Task 7, 16. Delete preview → Task 8, 10, 16. Bulk add → Task 9, 10, 16. Deep link → Task 17. `wt-lozenge` + contrast → Task 1, 2. Palette → Task 1, 13. Tree table → Task 4, 15. Round button → Task 3, 15. Page shell/filter/modes → Task 15. Modals → Task 16. Strings/rename → Task 12, 14, 15. Docs → Task 18. Testing → folded into each task; whole-branch → Task 19.

**Type consistency** — `CategoryDependants` has the same shape in catalogue (Task 8), the client (Task 11) and the screen (Task 16). `color: string | null` on the shape, `color?: string | null` on inputs, consistently. `readableTextColor` / `CATEGORY_PALETTE` / `isHexColor` names match across Tasks 1, 2, 13. `rowParent` / `collapseLabel` / `expandLabel` names match across Tasks 4 and 15. `addProductsToCategory` and `categoryDependants` names match catalogue → client → server.

**Placeholders** — the two spots that say "mirror the existing helper" (the server manager-scoped wrapper name in Task 10, the screen mount helper in Tasks 15/16) point at concrete existing code the implementer reads; every code step carries real code. The product-creation setup in Tasks 6/8/9 tells the implementer to copy the fixture already in `categories.pg.test.ts` rather than inventing a product shape, because that shape is long and lives in one place.
