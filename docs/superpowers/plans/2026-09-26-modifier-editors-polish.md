# The Extras and Options editors — owner review fixes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's Extras and Options editors say what they mean and lay out cleanly,
per the owner's review of 2026-09-26.

**Architecture:** Four pull requests, each one campaign lane A item (A64–A67), each leaving `main`
green and working on its own. Task 1 adds the shared pieces (a number stepper, two icons, a wider
standard modal, drag feedback). Task 2 changes the two list tables and their "Used by" popup, with
the server returning usage counts. Tasks 3 and 4 rework the Extras and Options editors; Task 4 also
makes the server always store a default option.

**Tech Stack:** Lit web components (`@waitron/ui`, `apps/dashboard`), Vitest browser mode (real
headless Chromium) for the dashboard and `packages/ui`, Vitest with `useVenueDb` for
`packages/catalogue`, Drizzle over `node:sqlite`.

**Spec:** [2026-09-26-modifier-editors-polish-design.md](../specs/2026-09-26-modifier-editors-polish-design.md)
— read it first; the decisions D1–D9 are referred to by number below.

## Global Constraints

- Every colour, spacing, radius and font reads a `--wt-*` token — no hex, no named colours, no
  `rem`/`em` in a component (guard: `packages/ui/src/no-hardcoded-chrome.test.ts`). A new size is a
  new token in `packages/ui-core/src/tokens/structure.css`.
- A new `wt-*` primitive has a token-painting test AND a sibling `*.a11y.test.ts` covering each
  distinct state in both themes (CLAUDE.md §3).
- Custom events are named `wt-*`, carry `detail`, are dispatched `bubbles: true, composed: true`,
  and the triggering event is stopped first (CLAUDE.md §3).
- Every new user-facing string has an English AND a Spanish entry in
  `apps/dashboard/src/i18n/strings.ts`.
- Forms follow design-system.md → Forms: a refusal is shown beside its field and in the summary; a
  field inside a collapsed `wt-disclosure` holding an error opens it via `has-error`.
- Queries on one transaction are awaited in turn, never `Promise.all` (CLAUDE.md §3).
- No migration is expected in any task. If one turns out to be needed, stop and say so.
- **Every visual change is looked at**: both themes, English and Spanish, at 1280px and 390px
  wide, set with `page.viewport(w, h)` and the width read back from `window.innerWidth`
  (testing-guide.md). Register the app's icon set in a widget harness before reading a control,
  or `wt-icon` renders an empty box (same section). State in the PR what was looked at.
- **Alignment is by baseline (D6) and is checked by screenshot**, not by reading CSS.
- Coverage bar 98/98/98/95 in every package touched; `packages/ui` and `ui-core` are also
  mutation-tested at 90 (weekly run), so each new behaviour needs an assertion that fails when it is
  deleted.

## Review Focus

1. **A list whose only available option is removed or switched off in the option editor** — the
   form must move the default to the next available option, or to none when nothing is available,
   never keep a default pointing at an unavailable or deleted option. Test in Task 4.
2. **A server refusal naming an option's field after the option editor has closed** (`labels.2.name`
   from a translation check) — it must show under that option's row and reappear beside the field
   when that option is opened. Test in Task 4.
3. **Typing into a stepper rather than pressing its buttons** — a typed `0` in Max quantity, a typed
   non-number, and a cleared Minimum must all reach the form's existing validation, not be silently
   clamped. Test in Task 1 (the stepper emits what was typed) and Task 3 (the form refuses it).
4. **A 390px-wide phone** — the Extras product table with a four-digit price and a long unit
   abbreviation must not scroll sideways further than today's table does. Measured before and after in
   Task 3.
5. **A pointer drag cancelled by the operating system** (`pointercancel`) — the dragged row's
   highlight must clear exactly as on release. Test in Task 1.


## Plan review corrections (2026-09-26, fresh-context review before A64)

A fresh-context reviewer read this plan against the spec and the code before Task 1 was built.
Its findings are folded in here; where a step below says otherwise, THIS section wins.

**Task 1 (A64).**
- The stepper test "+ and - step the value and emit it" expects `["3", "2"]` (the element keeps
  its own value, as `wt-price-input` does) — corrected in Step 1.
- `packages/ui/src/tap-target-and-focus.test.ts` pins the set of primitives that reflect `disabled`
  and requires each to hand focus to an inner control of at least the tap size. Add the file to
  Task 1, add `wt-number-stepper` to its list, give the stepper `delegatesFocus` like
  `wt-price-input`, and size `--wt-stepper-field-width` at or above the tap minimum.
- The D5 width change breaks `apps/dashboard/src/screens/printers-screen.test.ts`'s case pinning
  the Add agent/printer `wt-modal` at 768px on a 1280px page. That case is DELIBERATELY changed to
  1024px (64rem) — write that change first and watch it fail, so the new width is pinned.
- The drag rules go in `ReorderController.styles`, not `tableStyles`: `variant-table.ts` includes
  only `styles`, and the spec names the variants table.
- A `--wt-color-surface-raised` row background shows nothing inside a `wt-modal`, which is already
  painted that colour (`wt-dialog.ts`), and the extras, options and product editors all sit in one.
  Use an existing token that differs from the modal's surface in both themes, checked by
  screenshot; if none exists, add one to the ui-core tokens for both themes rather than a literal.
- The spec's `grabbing` cursor is on the PAGE: set it on `document.body` while a pointer drag is in
  progress and restore it on release and on `pointercancel`, with a test for each.
- The stepper also takes `hint` and `required`, drawn as `wt-input` draws them (Task 3 puts the
  "0 makes the list optional" / "Blank means no limit" text in hints, and today's max-quantity
  field is required).
- `allow-blank` is dropped: the sketch gave it no behaviour, so both blank-value tests pass without
  it. A blank value is simply a value; Task 3 marks "no limit" with the placeholder alone.
- The stepper's grid uses `align-items: baseline`, so the host's baseline is the input text's
  baseline (a probe without it measured the − button's baseline, 1.5px off). Pin that with a test
  in Task 1 that fails without it.
- Assert error rendering, `placeholder`, `hide-label`, `disabled` (both buttons and the input) and
  the label-to-input association directly — axe alone does not meet the 90 mutation floor.
- The `hostUpdated` re-mark is not needed: every host renders its rows with keyed `repeat`, so a
  moved row keeps its attribute. Keep the "keeps the mark after it moves" test as a guard, and say
  in the test that it passes without a re-mark for that reason.
- The `action.decrease`/`action.increase` strings move to Task 3, where they are first used. Update
  the header comment in `apps/dashboard/src/icons.ts` that names which primitives need icons
  registered, adding the stepper's `minus` and `plus`.

**Task 2 (A65).** Also deliberately changed: `apps/server/src/catalogue-api.test.ts`'s options
dependants `toEqual({ products: [], menus: [] })`; `apps/dashboard/src/api/live-queries.test.ts`'s
pinned dependency lists for `listOptionLists` and `listExtraLists`; and in
`packages/catalogue/src/options.test.ts` the `toEqual` with `menus: []` and the whole
"the menus a list's delete preview names" block. The Spanish singular is "{count} menú". The menu
count is a count of menu ENTRIES carrying the list, so label it for what it counts (one menu
carrying the list on two dishes must not read "2 menus").

**Task 3 (A66).** `wt-price-input` has no `hide-label`; adding one is a `packages/ui` change with
its own tests, so add it to the file list. Its unit is a focusable button emitting
`wt-unit-click`, which nothing handles in an extras row — show the unit without a dead control. The
price box needs a named width token; there is none to reuse (the variants table's container query
is a literal `30rem`). `extra-list-form.test.ts`'s "shows a whole price, not a truncated one, at
phone width" case must still pass unedited. Add the Task 1 strings here.

**Task 4 (A67).** Also deliberately changed: `option-contract.test.ts`'s `labels[0]` `toEqual`,
which gains an `id`. Tighten `writeLabels`'s types so the `label.id ?? randomUUID()` and
`label.id === undefined` branches (`packages/catalogue/src/options.ts`) do not become unreachable
code. Run every `createOptionList` caller's suite (e.g. `apps/server/src/catalogue-api.test.ts`,
`configuration-transfer.test.ts`), not only catalogue and the demo seed. Pick one naming scheme for
the option editor's fields and error keys. Say whether opening a list whose stored default is null
applies the keep-a-default rule.

---

## Task 1 (lane A item A64): shared pieces

**Files:**
- Create: `packages/ui/src/components/wt-number-stepper.ts`
- Create: `packages/ui/src/components/wt-number-stepper.test.ts`
- Create: `packages/ui/src/components/wt-number-stepper.a11y.test.ts`
- Modify: `packages/ui/src/index.ts` (export it, beside `WtPriceInput`)
- Modify: `packages/ui-core/src/tokens/structure.css` (`--wt-modal-max-width` 48rem → 64rem;
  `--wt-dialog-max-width` gets its own `min(90vw, 48rem)`; a new `--wt-stepper-field-width`)
- Modify: `packages/ui-core/src/tokens/structure.test.ts` (the new token is declared)
- Modify: `apps/dashboard/src/icons.ts` (add `minus` and `bin`)
- Modify: `apps/dashboard/src/widgets/reorder-table.ts` and `reorder-table.test.ts`
- Modify: `docs/developers/design-system.md` (the `wt-modal` width sentence near "Use `wt-modal` for
  an add or edit form", the `--wt-dialog-max-width` paragraph, and a `wt-number-stepper` row in the
  component table)

**Interfaces:**
- Produces: `<wt-number-stepper>` with properties `value: string` (default `""`), `label: string`,
  `name: string`, `min: number` (default 0), `max: number | null` (default null), `allowBlank:
  boolean` (attribute `allow-blank`), `placeholder: string`, `error: string`, `invalid: boolean`,
  `disabled: boolean`, `hideLabel: boolean` (attribute `hide-label`, as `wt-switch` has). Event
  `wt-change`, `detail: { value: string }` — the RAW text, never a clamped number.
- Produces: icon names `minus`, `bin` (16×16 path data, registered through `registerIcons`).
- Produces: `ReorderController` marks the dragged row with the attribute `data-dragging` while a
  pointer drag is in progress; `ReorderController.tableStyles` styles `tr[data-dragging]`.

- [ ] **Step 1: Write the stepper's behaviour tests** in `wt-number-stepper.test.ts`, in the style
  of `wt-price-input.test.ts` (`mount`, `host`, `cleanup` from `../test-helpers.js`):

```ts
import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-number-stepper.js";

afterEach(cleanup);

function parts(el: Element) {
  const root = el.shadowRoot!;
  return {
    input: root.querySelector("input")!,
    minus: root.querySelector<HTMLButtonElement>('button[data-step="-1"]')!,
    plus: root.querySelector<HTMLButtonElement>('button[data-step="1"]')!,
  };
}

function changes(el: Element): string[] {
  const seen: string[] = [];
  el.addEventListener("wt-change", (e) => seen.push((e as CustomEvent<{ value: string }>).detail.value));
  return seen;
}

test("+ and - step the value and emit it", async () => {
  const el = await mount('<wt-number-stepper label="Max" value="2" min="1"></wt-number-stepper>');
  const seen = changes(el);
  parts(el).plus.click();
  parts(el).minus.click();
  expect(seen).toEqual(["3", "2"]);
});

test("- is disabled at min and + at max", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1" min="1" max="1"></wt-number-stepper>');
  expect(parts(el).minus.disabled).toBe(true);
  expect(parts(el).plus.disabled).toBe(true);
});

test("+ on a blank value gives min, or 1 when min is 0", async () => {
  const zero = await mount('<wt-number-stepper label="Max" allow-blank></wt-number-stepper>');
  const seenZero = changes(zero);
  parts(zero).plus.click();
  expect(seenZero).toEqual(["1"]);
  const three = await mount('<wt-number-stepper label="Min" allow-blank min="3"></wt-number-stepper>');
  const seenThree = changes(three);
  parts(three).plus.click();
  expect(seenThree).toEqual(["3"]);
});

test("- on a blank value does nothing, so only clearing the box reaches blank", async () => {
  const el = await mount('<wt-number-stepper label="Max" allow-blank></wt-number-stepper>');
  const seen = changes(el);
  expect(parts(el).minus.disabled).toBe(true);
  parts(el).minus.click();
  expect(seen).toEqual([]);
});

test("typing emits the raw text, unclamped, so the form's own validation sees it", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1" min="1"></wt-number-stepper>');
  const seen = changes(el);
  const { input } = parts(el);
  for (const typed of ["0", "abc", ""]) {
    input.value = typed;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  expect(seen).toEqual(["0", "abc", ""]);
});

test("the buttons are named after the field", async () => {
  const el = await mount('<wt-number-stepper label="Maximum quantity"></wt-number-stepper>');
  expect(parts(el).minus.getAttribute("aria-label")).toBe("Decrease Maximum quantity");
  expect(parts(el).plus.getAttribute("aria-label")).toBe("Increase Maximum quantity");
});

test("wt-change crosses shadow boundaries", async () => {
  const el = await mountInShadowRoot('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  let received: CustomEvent<{ value: string }> | undefined;
  document.addEventListener("wt-change", (e) => (received = e as CustomEvent<{ value: string }>), { once: true });
  parts(el).plus.click();
  expect(received?.detail.value).toBe("2");
});

test("paints its buttons and field width from tokens", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-stepper-field-width", "77px");
  expect(getComputedStyle(parts(el).plus).borderTopColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(parts(el).input).width).toBe("77px");
});
```

  The button names ("Decrease {label}", "Increase {label}") are English inside the primitive; add
  `decreaseLabel`/`increaseLabel` properties defaulting to those, which the dashboard sets from
  `t("action.decrease")`/`t("action.increase")` (new EN/ES strings: "Decrease {label}" / "Reducir
  {label}", "Increase {label}" / "Aumentar {label}").

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-number-stepper.test.ts`
  Expected: FAIL — the element is not defined.

- [ ] **Step 3: Write `wt-number-stepper.ts`.** Model it on `wt-price-input.ts` (label wiring,
  `error`/`invalid`, `disabled`, event dispatch). The shape:

```ts
@customElement("wt-number-stepper")
export class WtNumberStepper extends LitElement {
  @property() value = "";
  @property() label = "";
  @property() name = "";
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max: number | null = null;
  @property({ type: Boolean, attribute: "allow-blank" }) allowBlank = false;
  @property() placeholder = "";
  @property() error = "";
  @property({ type: Boolean, reflect: true }) invalid = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;
  @property() decreaseLabel = "Decrease {label}";
  @property() increaseLabel = "Increase {label}";

  #current(): number | null {
    const n = Number(this.value);
    return this.value.trim() === "" || !Number.isInteger(n) ? null : n;
  }
  #step(delta: -1 | 1, event: Event): void {
    event.stopPropagation();
    const current = this.#current();
    const next =
      current === null
        ? delta === 1 ? Math.max(this.min, 1) : null
        : Math.min(Math.max(current + delta, this.min), this.max ?? Number.POSITIVE_INFINITY);
    if (next === null || String(next) === this.value) return;
    this.#emit(String(next));
  }
  #emit(value: string): void {
    this.value = value;
    this.dispatchEvent(new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }));
  }
  // render: <label for=name> (visually hidden when hideLabel), then a row:
  //   <button type="button" data-step="-1" aria-label=… ?disabled=${disabled || current === null || current <= min}>
  //     <wt-icon name="minus"></wt-icon></button>
  //   <input id=name inputmode="numeric" .value=${value} placeholder=… aria-invalid=… @input=${e => { e.stopPropagation(); this.#emit(input.value) }}>
  //   <button type="button" data-step="1" aria-label=… ?disabled=${disabled || (max !== null && current !== null && current >= max)}>
  //     <wt-icon name="plus"></wt-icon></button>
  // then the error line, exactly as wt-price-input draws it.
}
```

  Buttons are at least `--wt-tap-min` on both axes; the input's width is `--wt-stepper-field-width`
  (add it to `structure.css` sized for four digits and add it to the list in `structure.test.ts`).
  Its `display` is `inline-grid` so the element's baseline is the input text's baseline — Task 3
  relies on that.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Write `wt-number-stepper.a11y.test.ts`** by copying `wt-price-input.a11y.test.ts`
  and covering: empty, with a value, at min (− disabled), at max (+ disabled), invalid with an
  error, disabled, `hide-label` — each in both themes. Run it:
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-number-stepper.a11y.test.ts`.
  Expected: PASS. Then prove it by deletion: remove the `aria-label` from the + button, watch a case
  fail, restore.

- [ ] **Step 6: Commit** — `git add packages/ui packages/ui-core && git commit -s -m "Add a number
  stepper to the shared UI kit"` (message body in plain English, CLAUDE.md global rules).

- [ ] **Step 7: Icons.** Add `minus` (a horizontal bar, the `plus` path without its vertical
  stroke) and `bin` (a 16×16 dustbin outline) to `apps/dashboard/src/icons.ts`. If that file has a
  test that lists icon names, extend it; otherwise the Task 3 row test that reads the bin button's
  icon covers it. Commit.

- [ ] **Step 8: Write the failing drag-feedback tests** in `reorder-table.test.ts`, next to its
  existing pointer-drag cases (reuse its host fixture and its pointer helpers):

```ts
it("marks the row being dragged, and clears it on release", async () => {
  const { host, handle } = await mountRows(["a", "b", "c"]);
  handle("a").dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true, composed: true }));
  await host.updateComplete;
  expect(row(host, "a").hasAttribute("data-dragging")).toBe(true);
  expect(row(host, "b").hasAttribute("data-dragging")).toBe(false);
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  await host.updateComplete;
  expect(row(host, "a").hasAttribute("data-dragging")).toBe(false);
});

it("clears the mark when the system cancels the pointer", async () => {
  const { host, handle } = await mountRows(["a", "b"]);
  handle("a").dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true, composed: true }));
  document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
  await host.updateComplete;
  expect(row(host, "a").hasAttribute("data-dragging")).toBe(false);
});

it("keeps the mark on the dragged row after it moves past another", async () => {
  // drag "a" over "b" with the file's existing pointermove helper, then:
  expect(row(host, "a").hasAttribute("data-dragging")).toBe(true);
});
```

  (`mountRows`, `handle` and `row` stand for whatever the file already uses to mount a table and
  find a row by id; name them after the file's own helpers.) Run:
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/reorder-table.test.ts` — expected
  FAIL, no attribute.

- [ ] **Step 9: Implement.** The dragged id is already held in `#drag`. The controller sets the
  mark itself, so no host changes: on drag start, and again in `hostUpdated()` while `#drag` is set
  (a move re-renders the rows), find the handle by `[data-test="drag-${id}"]` as the refocus code
  does and set `data-dragging` on its `closest("tr")`; in `#endDrag()` remove it from every row that
  has it. In `tableStyles`:

```css
tr[data-dragging] {
  background: var(--wt-color-surface-raised);
  box-shadow: var(--wt-shadow-2);
  cursor: grabbing;
}
tr[data-dragging] .handle {
  cursor: grabbing;
}
```

  Run the tests again — expected PASS. Then open the product editor's variants table, the
  member-list editor and the extras form with a real drag at 1280px in both themes and LOOK: the
  dragged row must read as lifted in dark mode too (`--wt-color-surface-raised` differs from
  `--wt-color-surface` only in dark mode; if light mode shows no lift beyond the shadow, say so in
  the PR and propose a token rather than a hex).

- [ ] **Step 10: Commit** the drag feedback.

- [ ] **Step 11: Widen the standard modal (D5).** In `structure.css` set `--wt-modal-max-width:
  64rem` and change `--wt-dialog-max-width` to `min(90vw, 48rem)` so dialogs and help tooltips keep
  today's width. Update the two design-system.md sentences that state `48rem` and the "overriding
  `--wt-modal-max-width` also resizes every `wt-dialog`" paragraph, which is no longer true. Run
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens` and the product editor's phone-width
  cases (`pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts`),
  which must pass unedited.

- [ ] **Step 12: Look at every modal.** `grep -rln "<wt-modal" apps packages --include='*.ts' |
  grep -v test` lists the screens. Open each distinct modal at 1280px (the dev stack:
  `wa-wt demo <worktree>`) and confirm nothing inside depended on the narrower width — a table
  stretching oddly, a form row running too long to read. List what was looked at in the PR. Commit.

- [ ] **Step 13: Update `docs/backlog.md`** — mark A64's part of the "Extras and Options editors —
  owner review" entry done. Then `/finish-branch`.

---

## Task 2 (lane A item A65): the list tables and the "Used by" popup

**Files:**
- Modify: `packages/catalogue/src/modifier-list-types.ts`, `packages/catalogue/src/extras.ts`,
  `packages/catalogue/src/options.ts`, and their tests `extras.test.ts`, `options.test.ts`
- Modify: `apps/dashboard/src/api/live-queries.ts`, `apps/dashboard/src/api/client.ts`
- Modify: `apps/dashboard/src/screens/modifiers-screen.ts`, `modifiers-screen.test.ts`,
  `modifiers-screen.a11y.test.ts`, `apps/dashboard/src/api/modifier-lists.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`

**Interfaces:**
- Produces (catalogue): `export interface ExtraListRow extends ExtraList { usage: { products:
  number; menus: number } }` and `export interface OptionListRow extends OptionList { usage: {
  products: number } }`, returned by `listExtraLists(tx)` and `listOptionLists(tx)` only;
  `getExtraList`/`getOptionList`/`readExtraListsByIds`/`readOptionListsByIds` are unchanged.
- Produces: `ExtraListDependants.menus` entries become `{ id: string; name: string; menuName: string }`.
  `OptionListDependants` becomes `{ products: { id: string; name: string }[] }` — no `menus` (D3).
- Consumes: `wt-number-stepper` is NOT used here.

**Tests this task deliberately changes, and why (so a lane runner does not read them as a STOP):**
`options.test.ts` "names the products carrying the list, and the menu offers of those dishes" loses
its `menus` assertion and its menu setup — D3, owner decision 2026-09-26: an options list is carried
by products only. Any dashboard test asserting "In use" / "Not in use" or the options popup's "Menu
item" rows changes with D2 and D3. Name each such test in the PR.

- [ ] **Step 1: Failing server tests for the counts.** In `extras.test.ts` (use the file's existing
  setup that creates a catalogue, products and a menu offer, as the dependants cases do):

```ts
it("lists each extras list with how many products and menu offers carry it", async () => {
  // Two products carry list A through product_modifiers; one menu offer carries A through
  // menu_item_extra_lists; list B is carried by nothing.
  const rows = await run((tx) => listExtraLists(tx));
  expect(rows.find((r) => r.id === a.id)!.usage).toEqual({ products: 2, menus: 1 });
  expect(rows.find((r) => r.id === b.id)!.usage).toEqual({ products: 0, menus: 0 });
});
```

  And in `options.test.ts` the same shape with `{ products: 2 }` / `{ products: 0 }`, where one of
  the carrying products is ALSO on a menu (so a count that joined menus would read differently).
  Run `pnpm --filter @waitron/catalogue exec vitest run src/extras.test.ts src/options.test.ts` —
  expected FAIL, `usage` undefined.

- [ ] **Step 2: Implement the counts** — one grouped query per table, after the lists are read,
  awaited in turn:

```ts
const productCounts = await tx
  .select({ listId: productModifiers.extraListId, count: sql<number>`count(distinct ${productModifiers.productId})` })
  .from(productModifiers)
  .where(isNotNull(productModifiers.extraListId))
  .groupBy(productModifiers.extraListId);
const menuCounts = await tx
  .select({ listId: menuItemExtraLists.listId, count: sql<number>`count(*)` })
  .from(menuItemExtraLists)
  .groupBy(menuItemExtraLists.listId);
```

  then map them onto the lists (0 where absent). Options: the first query only, on
  `productModifiers.optionListId`. Check with `.toSQL()` that each emits one statement. Run the
  tests — PASS.

- [ ] **Step 3: Failing server tests for the popup shapes.** `extraListDependants` returns a menu
  row's `menuName` (the menu is a `catalogues` row: `menuItems.menuId` → `catalogues.id`, name in
  `catalogues.name`); give the fixture's menu a name different from every product's. Change the
  options case per the note above so it asserts `toEqual({ products: [...] })` with no `menus` key.
  Run — FAIL.

- [ ] **Step 4: Implement** — join `catalogues` in the extras menus query and select
  `menuName: catalogues.name`; in `optionListDependants`, drop the `menuItems` left join and the
  `menus` array entirely. Update both interfaces in `modifier-list-types.ts`. Run — PASS. Run
  `pnpm --filter @waitron/catalogue exec tsc --noEmit` and fix every caller the type change breaks
  (expected: only the dashboard).

- [ ] **Step 5: Live-query dependencies.** In `apps/dashboard/src/api/live-queries.ts`:
  `listOptionLists: ["option_lists", "option_labels", "product_modifiers"]` and
  `listExtraLists: ["extra_lists", "extra_list_items", "product_modifiers", "menu_item_extra_lists"]`,
  and correct the comment above them, which says neither joins those tables. Run
  `pnpm vitest run scripts/live-subscriptions.test.ts` (root project). Then prove the dependency by
  test: in `modifiers-screen.test.ts`, a live update naming only `product_modifiers` must refresh the
  Used-by count (use the file's `LiveData` fixture the existing live cases use).

- [ ] **Step 6: Failing screen tests.** In `modifiers-screen.test.ts` (fixtures gain `usage`):
  - the Status cell reads `t("extras.active")` = "Active" / `t("extras.inactive")` = "Inactive",
    and the filter offers the same two words;
  - the Used-by cell reads "2 products · 1 menu" for extras and "2 products" for options, and
    "Not used" at zero; sorting by it orders by the total;
  - the name cell is text (no `open-extra-…` button); the count is a button
    (`data-test="used-by-e1"`) that opens the popup, titled `Used by Breads`;
  - the extras popup's menu row reads "White bread — Lunch" with the Type filter kept;
  - the options popup shows products only and has no Type column;
  - the options delete warning never mentions menu items.
  Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/modifiers-screen.test.ts` —
  FAIL.

- [ ] **Step 7: Implement in `modifiers-screen.ts`.** Strings (EN / ES):
  `extras.active` "Active" / "Activa", new `extras.inactive` "Inactive" / "Inactiva", the same for
  `options.*`; retire `*.not_in_use`. New: `modifiers.used_by` "Used by" / "Usado en",
  `modifiers.used_by_named` "Used by {name}" / "Usado en {name}", `modifiers.not_used` "Not used" /
  "Sin usar", `modifiers.count_products` "{count} products" / "{count} productos" (and a singular
  pair), `modifiers.count_menus` "{count} menu" / "{count} menús" (and plural). The popup's heading
  becomes `used_by_named`; `#renderUsage` builds rows per kind (options: products only, one-column
  table via `#nameColumn`; extras: product rows plus menu rows labelled `${name} — ${menuName}`).
  The count button uses `wt-button variant="ghost"` styled as a link through its `part` (design
  system: cell markup is styled with `::part()`, never a class — CLAUDE.md §3). The delete warning
  for options drops the menus sentence.
  Run the tests — PASS. Run `modifiers-screen.a11y.test.ts` — PASS.

- [ ] **Step 8: Look.** Both tabs and both popups, light and dark, EN and ES, 1280 and 390. Commit.

- [ ] **Step 9: Backlog** — mark A65's part done. `/finish-branch`.

---

## Task 3 (lane A item A66): the Extras editor

**Files:**
- Modify: `apps/dashboard/src/widgets/extra-list-form.ts`, `extra-list-form.test.ts`,
  `extra-list-form.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`

**Interfaces:**
- Consumes: `wt-number-stepper` (Task 1: `value`, `min`, `allow-blank`, `hide-label`,
  `decreaseLabel`, `increaseLabel`, `wt-change` with `{ value }`); icon `bin` (Task 1);
  `wt-price-input` (existing: `value`, `label`, `unit`, `placeholder`, `error`); `wt-disclosure`
  (existing: `heading`, `summary`, `open`, `has-error`).
- Produces: nothing new for other tasks. The wire body the form emits (`ExtraListInput`) is
  UNCHANGED — every existing submit test must pass unedited.

- [ ] **Step 1: Measure today's phone width first.** In a scratch test (not committed), mount the
  form at `page.viewport(390, 844)` with two items, one priced `9999.99`, read `window.innerWidth`,
  and record `table.scrollWidth - tableWrap.clientWidth`. Keep the number for Step 9.

- [ ] **Step 2: Failing tests** in `extra-list-form.test.ts`:
  - the customer-name inputs and the kitchen-name input are inside a `wt-disclosure`
    (`data-test="names-section"`) that starts closed, with a summary counting filled names ("2 of 3
    filled in"); a server refusal on `customerName` or `kitchenName` sets its `has-error`;
  - `min-picks` and `max-picks` are `wt-number-stepper`s in one row container
    (`data-test="picks-row"`); max has `allow-blank` and the "No limit" placeholder; pressing + on
    min sends `minPicks: 1` on save;
  - each item's max quantity is a `wt-number-stepper` with `min` 1; a TYPED `0` still produces
    `t("extras.quantity_invalid")` on save (Review Focus 3);
  - each item's price is a `wt-price-input` whose `unit` is the product's unit abbreviation in the
    first content language, falling back to the unit's name (the rule `product-editor.ts` uses);
    blank still saves `price: null` and shows the inherited price as the placeholder;
  - the remove control is an icon-only button with `wt-icon name="bin"` and the same accessible
    name as today (`${t("extras.remove_item")}: ${name}`);
  - the header's Price cell has `colspan="2"` and there is no separate remove header.
  Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/extra-list-form.test.ts` — FAIL.

- [ ] **Step 3: Implement.** Move `optionalTextFields(... customer-name ...)` and the kitchen-name
  input into `<wt-disclosure heading=${t("extras.names_section")} summary=${…}
  .hasError=${hasNameError}>`. Replace the two picks inputs with steppers inside
  `<div class="picks-row">` (CSS grid, two equal columns; it drops to one column in the same
  narrow-width case the variants table already handles, "a table 30rem wide or less" in
  design-system.md — reuse that rule's mechanism and token rather than adding a new breakpoint). Shorten `extras.min_picks` to "Minimum choices" / "Selecciones mínimas" and
  `extras.max_picks` to "Maximum choices" / "Selecciones máximas", and put "0 makes the list
  optional" / "Blank means no limit" in each stepper's hint line (EN/ES). In `#itemRow` use the
  stepper and `wt-price-input`, `hide-label` on both (the column header names them), and the
  bin button (`wt-button variant="ghost"` with `<wt-icon name="bin">`, `aria-label` unchanged).
  Replace `.cell-field`'s name-width floor on the price with the price input's own width. Run the
  tests — PASS; the existing submit tests must pass UNEDITED.

- [ ] **Step 4: Failing baseline test (D6).** In `extra-list-form.test.ts`, at 1280 wide with two
  items:

```ts
it("lines up the text baselines across a product row", async () => {
  const form = await openWithTwoItems();
  const row = form.shadowRoot!.querySelector('tr[data-item="i1"]')!;
  const name = row.querySelector('[data-test="item-0-product"]')!.getBoundingClientRect();
  const qty = baselineOf(row.querySelector("wt-number-stepper")!);
  const price = baselineOf(row.querySelector("wt-price-input")!);
  // name's baseline: bottom of its text line box
  const nameBaseline = textBaseline(row.querySelector('[data-test="item-0-product"]')!);
  expect(Math.abs(qty - nameBaseline)).toBeLessThanOrEqual(1);
  expect(Math.abs(price - nameBaseline)).toBeLessThanOrEqual(1);
});
```

  where `baselineOf` / `textBaseline` insert a zero-size inline-block probe with
  `vertical-align: baseline` beside the measured text (inside the inner input's line for the
  controls, reached through their shadow roots) and read its `top`. Write the helper once in the
  test file. Run — FAIL on today's `vertical-align: top`.

- [ ] **Step 5: Implement the alignment.** In the form's styles, `td { vertical-align: baseline; }`
  for the item rows (the handle cell keeps `middle`), and make sure the stepper, the price input and
  the switch expose their text baseline (Task 1 gave the stepper `inline-grid`; check
  `wt-price-input` and `wt-switch` and fix them in `packages/ui` if they do not — each such fix gets
  its own case in that component's test). Run — PASS.

- [ ] **Step 6: Screenshot it.** Take screenshots of the open form with three items at 1280 and
  390, light and dark, EN and ES (`page.screenshot` in a throwaway test, or the dev stack). LOOK at
  the rows: the product name, the quantity digits, the Preselected label and the price digits sit on
  one line. If the test passes and the screenshot still looks ragged, the test is measuring the
  wrong thing — fix the test first.

- [ ] **Step 7: Failing a11y cases** in `extra-list-form.a11y.test.ts`: the form with the names
  section closed, opened, and holding an error, each in both themes. Run — expected to pass or to
  name a real problem; fix any.

- [ ] **Step 8: Commit.**

- [ ] **Step 9: Phone width.** Repeat Step 1's measurement on the new form. The overflow must be no
  larger than Step 1's number. If it is, fix the layout (the variants table's approach — moving a
  column under the name below `30rem` — is the precedent in design-system.md) before continuing.
  Record both numbers and the measured `window.innerWidth` in the PR.

- [ ] **Step 10: Backlog** — mark A66's part done. Commit. `/finish-branch`.

---

## Task 4 (lane A item A67): the Options editor, and always a default

**Files:**
- Modify: `packages/catalogue/src/option-contract.ts`, `option-contract.test.ts`, `options.test.ts`
- Create: `apps/dashboard/src/widgets/option-label-form.ts`, `option-label-form.test.ts`,
  `option-label-form.a11y.test.ts`
- Modify: `apps/dashboard/src/widgets/option-list-form.ts`, `option-list-form.test.ts`,
  `option-list-form.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`

**Interfaces:**
- Consumes: `wt-disclosure`, `wt-row-actions`, `wt-lozenge`, `wt-modal` (existing).
- Produces: `<dashboard-option-label-form>` with properties `open: boolean`, `value: DraftLabel |
  null` (null = add), `languages: ContentLanguages`, `errors: Record<string, string>` (keys `name`,
  `customer-name-<lang>`, `kitchen-name`), `busy: boolean`; events `wt-submit` with
  `detail: { value: DraftLabel }` and `wt-cancel`. `DraftLabel` moves out of `option-list-form.ts`
  into `option-label-form.ts` and is exported: `{ id: string; name: string; customerName:
  Record<string, string>; kitchenName: string; available: boolean }`.
- Produces (server): `parseOptionListInput` returns every label WITH an id, and a `defaultLabelId`
  that is the first available label's id whenever the list has an available label.

**Tests this task deliberately changes, and why:** in `option-contract.test.ts`, "normalises an
absent customer name and a blank kitchen name to null" stops asserting `defaultLabelId` is null (it
becomes the only label's minted id), and "normalises a defaultLabelId naming an unavailable label to
null" becomes "moves a default naming an unavailable label to the first available one" — D8, owner
decision 2026-09-26. The dashboard's "Clear default" and "Add label" tests go with D8 and the
rename. Name each in the PR.

- [ ] **Step 1: Failing contract tests** in `option-contract.test.ts`:

```ts
it("gives a label without an id one of its own", () => {
  const parsed = parseOptionListInput({ ...cooked, defaultLabelId: null, labels: [{ ...mediumRare, id: undefined }] });
  expect(parsed.labels[0]!.id).toMatch(UUID);
});

it("makes the first available label the default when none is named", () => {
  const parsed = parseOptionListInput({ ...cooked, defaultLabelId: null, labels: [{ ...mediumRare, available: false }, wellDone] });
  expect(parsed.defaultLabelId).toBe(wellDone.id);
});

it("moves a default naming an unavailable label to the first available one", () => {
  const parsed = parseOptionListInput({ ...cooked, labels: [{ ...mediumRare, available: false }, wellDone] });
  expect(parsed.defaultLabelId).toBe(wellDone.id);
});

it("keeps a default that names an available label", () => {
  const parsed = parseOptionListInput({ ...cooked, defaultLabelId: wellDone.id, labels: [mediumRare, wellDone] });
  expect(parsed.defaultLabelId).toBe(wellDone.id);
});

it("has no default when no label is available (an inactive list)", () => {
  const parsed = parseOptionListInput({ ...cooked, active: false, defaultLabelId: null, labels: [{ ...mediumRare, available: false }] });
  expect(parsed.defaultLabelId).toBeNull();
});
```

  (Use the file's own `cooked`, `mediumRare`, `wellDone` fixtures and a `UUID` regex.) And in
  `options.test.ts`, a create with `defaultLabelId: null` and two available labels reads back with
  the first label's STORED id as the default — through `getOptionList`, so the minted id and the
  written id are proven to be the same. Run
  `pnpm --filter @waitron/catalogue exec vitest run src/option-contract.test.ts src/options.test.ts`
  — FAIL.

- [ ] **Step 2: Implement.** In `parseOptionListInput`, give each label without an id
  `globalThis.crypto.randomUUID()` (this file is imported by browser code, so not `node:crypto`),
  add it to `seen`, then:

```ts
const firstAvailable = labels.find((label) => label.available)?.id ?? null;
const named = labels.some((label) => label.id === defaultLabelId && label.available) ? defaultLabelId : null;
return { ...list, defaultLabelId: named ?? firstAvailable, labels };
```

  Replace the comment above it with one line on the rule (D8). Check `writeLabels` in `options.ts`
  still inserts the supplied id (`label.id ?? randomUUID()`, it does today). Run — PASS. Then run the
  demo seed's and the menus fixture's suites that create option lists:
  `pnpm --filter @waitron/catalogue test` and the `apps/server` demo-seed tests
  (`grep -rln seed-option-lists apps/server`) — they must pass unedited.

- [ ] **Step 3: Commit** the server rule.

- [ ] **Step 4: Failing tests for the option editor** in `option-label-form.test.ts`: opens with a
  value and shows name, a closed names disclosure (translated names + kitchen name) and an Available
  switch; Save with a blank name shows `t("options.label_name_required")` beside the name and does
  not emit; a valid Save emits `wt-submit` with the edited draft (id kept); Cancel emits
  `wt-cancel`; an `errors` entry for `customer-name-en` opens the disclosure via `has-error`.
  Run — FAIL.

- [ ] **Step 5: Implement `option-label-form.ts`** — a `wt-modal` (the standard one, D9) holding
  the fields that `#labelRow` holds today, moved as they are (same `name` attributes:
  `label-name`, `label-customer-name-<lang>`, `label-kitchen-name`, `label-available`), with
  `wt-form-actions`. Heading: `t("options.edit_option")` "Edit option" / "Editar opción" or
  `t("options.add_option")` "Add option" / "Añadir opción". Run — PASS. Write its a11y test (closed,
  open, error; both themes). Commit.

- [ ] **Step 6: Failing tests for the list form** in `option-list-form.test.ts`:
  - list-level customer names and kitchen name are inside a closed `wt-disclosure`, as in Task 3;
  - each option row shows the name as TEXT (no `wt-input` in the row), a Default radio, an
    `Unavailable` lozenge only for an unavailable option, and a `wt-row-actions` with Edit and
    Delete;
  - "Add option" (`data-test="add-option"`, text `t("options.add_option")`) opens the option editor
    empty; its Save appends the option;
  - Edit opens it with that option; its Save replaces the row; the list is not sent until the list's
    own Save;
  - there is no Clear default button;
  - a new list's first option becomes the default; removing the default option moves the default
    to the next available one; making the default unavailable in the option editor does the same;
    removing the last available option leaves none (Review Focus 1);
  - a `fieldErrors` entry `labels.1.name` shows under row 1 and in the summary, and opening row 1's
    editor shows it beside the name (Review Focus 2); moving the row first carries the message with
    it (the existing id-keyed mapping).
  Run — FAIL.

- [ ] **Step 7: Implement in `option-list-form.ts`.** Replace `#labelRow`'s inputs with text, the
  radio (unchanged markup), a `wt-lozenge` and `wt-row-actions`. Hold `@state() editingLabel:
  DraftLabel | null | "new"` and render `<dashboard-option-label-form>` after the list's modal. On
  its `wt-submit`, replace or append the draft, then re-apply the default rule:

```ts
#keepDefault(): void {
  const pickable = this.#pickable(this.defaultLabelId);
  this.defaultLabelId = pickable ?? this.labels.find((label) => label.available)?.id ?? null;
}
```

  call it wherever `#pickable` is applied today (`#editLabel`, `#removeLabel`) and after an add.
  Delete the Clear default button and its string. Rename `options.add_label` to
  `options.add_option` ("Add option" / "Añadir opción"). Error keys for a label (`label-N-name`
  and siblings) render under the row as a `<p class="error">` and are passed to the option editor as
  its `errors` when that row is opened. Run — PASS. Run the catalogue screen's suite too
  (`src/screens/catalogue-screen.test.ts`), which opens the same form — it must pass, with only
  tests that drive the removed per-row inputs changed, each named in the PR.

- [ ] **Step 8: Stacked modals.** Open the list form, then an option's editor, and confirm Escape
  closes only the option editor, focus returns to that row's actions button, and the list form's
  `?inert=${busy}` wrapper does not trap the option editor (it is rendered outside it). Test each.

- [ ] **Step 9: Look.** Light/dark, EN/ES, 1280/390: the list form with four options (one
  unavailable, one default), and the option editor over it. Update the a11y test for the new row
  states. Commit.

- [ ] **Step 10: Backlog** — mark A67 and the whole entry done. `/finish-branch`.
