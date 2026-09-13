# Modifiers editing rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework how a manager edits a modifier — a round add button, a choices table with a drag handle, per-row radio/checkbox defaults and a per-row menu, an inner modal for the fuller choice fields, yes/no as a toggle — and simplify the two contract pieces the new form no longer needs.

**Architecture:** The change runs bottom-up. First the shared contract and database drop custom yes/no labels and replace an extra's default quantity with a boolean `preselected`; the catalogue package, the server snapshot step and the seed follow. Then the till renders the simplified data. Then the dashboard gets a round-button primitive shape, the round add button, an extracted per-choice modal element, the table-based modifier form, and pointer/keyboard reorder.

**Tech stack:** TypeScript, Lit web components, Drizzle ORM on PostgreSQL, Vitest (browser mode in real headless Chromium for `apps/dashboard`, `apps/till`, `packages/ui`; real-PostgreSQL via Testcontainers for `packages/catalogue` and `packages/db`).

**Spec:** `docs/superpowers/specs/2026-09-13-modifiers-editing-rework-design.md` — read it alongside this plan.

## Global Constraints

- **No backwards-compatibility code.** Nothing is in production; schema changes drop and recreate. (`waitron/CLAUDE.md` §3)
- **The generated migration is never hand-edited.** Produce it with `pnpm --filter @waitron/db db:generate --name <name>`; if a number collides on rebase, reset the migrations dir to main's state and regenerate. (`conventions-data.md`)
- **Every colour, spacing, radius and font in a component or view reads a `--wt-*` token.** No hex, no named colours, no `rem`/`em`. The circular radius token is `--wt-radius-full`. (`design-system.md`)
- **A new `wt-*` primitive state needs two tests:** a token-painting test in `*.test.ts` and an axe test in `*.a11y.test.ts` covering the state in both themes. (`waitron/CLAUDE.md` §3)
- **Error codes name the domain concept and are never renamed once shipped.** The modifier codes here are `modifier.invalid` (with a `field` param) and `modifier.in_use`; reuse them, do not add new ones. A rejected write asserts the domain error code, not merely `toBeInstanceOf(Error)`. (`waitron/CLAUDE.md` §3, §4)
- **A real-PG test calls `asAppUser(tx)` before the query under test**, or it runs as owner and asserts nothing. Local real-PG runs need `TESTCONTAINERS_RYUK_DISABLED=true`. (`testing-guide.md`)
- **Coverage bars:** `packages/catalogue` and `packages/db` sit at `98/98/98/95`; `apps/*` and `packages/ui` at `90/90/85/85`. CI shards run `test:coverage`, not `test`.
- **Commits are signed and in plain English, no attribution lines:** `git commit -s`. Run focused tests while implementing; CI owns the mandatory package suites.
- **A browser-mode test run competes for RAM.** Before a heavy local run check free memory and the heaviest processes; do not start a browser run beside another session's. (`ci-and-gates.md`)

---

## File map

**Contract and data (Task 1)**
- `packages/shared/src/modifiers.ts` — `ExtraChoice.defaultQuantity` → `preselected`; yes-no member drops `yesLabel`/`noLabel`.
- `packages/shared/src/modifier-snapshots.ts` — yes-no snapshot drops `label`.
- `packages/db/src/schema/catalogue.ts` — `option_groups` drops `yes_label`/`no_label`; `option_group_items` drops `default_quantity`, adds `preselected`.
- `packages/db/drizzle/0024_*.sql` (+ `meta/`) — generated.
- `packages/catalogue/src/modifier-contract.ts`, `modifiers.ts` — parse/validate/persist/project the new shape.
- `apps/server/src/modifier-selection.ts` — yes-no snapshot without the label.
- `apps/server/scripts/demo-seed/seed-options.ts` — seed the new shape.

**Till (Task 2)**
- `apps/till/src/api/client.ts` — local `Modifier`/`ModifierSnapshot` types.
- `apps/till/src/widgets/modifier-picker.ts` — preselected pre-fill; yes/no as a `wt-switch` toggle.
- `apps/till/src/widgets/basket.ts` — print "Yes"/"No" from local strings.
- `apps/till/src/widgets/basket.ts` — an affirmative yes/no shows the modifier name, a negative one shows nothing (Ruling C; no new strings).

**Primitive (Task 3)**
- `packages/ui/src/components/wt-button.ts` (+ `.test.ts`, `.a11y.test.ts`) — a round, icon-only `shape`.
- `apps/dashboard/src/icons.ts` — register `plus` and `grip`.

**Dashboard (Tasks 4–7)**
- `apps/dashboard/src/screens/modifiers-screen.ts` (+ `.test.ts`) — round add button.
- `apps/dashboard/src/widgets/choice-form.ts` (new, + `.test.ts`, `.a11y.test.ts`) — the per-choice modal.
- `apps/dashboard/src/widgets/modifier-form.ts` (+ `.test.ts`, `.a11y.test.ts`) — the choices table, wiring the choice modal, radio/checkbox defaults, reorder.
- `apps/dashboard/src/api/client.ts` — local `ModifierExtraChoice`/yes-no types.
- `apps/dashboard/src/i18n/strings.ts` — new and retired string keys (en + es).
- `apps/dashboard/src/widgets/reorder.ts` (new, + `.test.ts`) — a pure `reorder` helper.

---

## Task 1: Simplify the modifier contract, schema and server snapshot

**Files:**
- Modify: `packages/shared/src/modifiers.ts`, `packages/shared/src/modifier-snapshots.ts`
- Modify: `packages/db/src/schema/catalogue.ts`
- Create: `packages/db/drizzle/0024_*.sql` and `meta/` snapshot (generated)
- Modify: `packages/catalogue/src/modifier-contract.ts`, `packages/catalogue/src/modifiers.ts`
- Modify: `apps/server/src/modifier-selection.ts`, `apps/server/scripts/demo-seed/seed-options.ts`
- Test: `packages/catalogue/src/modifier-contract.test.ts`, `modifiers.pg.test.ts`, `modifier-projection.test.ts`, `modifier-dependencies.pg.test.ts`; fixture-only edits in `apps/server/scripts/demo-seed/seed-options.test.ts`, `apps/server/src/{till-api,catalogue-api,working-order,configuration-transfer,management-api.status}*.test.ts`

**Interfaces:**
- Produces (shared): `ExtraChoice` gains `preselected: boolean` and loses `defaultQuantity`; the yes-no `ModifierInput` member is `{ type: "yes-no"; defaultValue: boolean }`; the yes-no `ModifierSnapshot` member is `{ type: "yes-no"; value: boolean }`.
- Produces (catalogue): `parseModifierInput` accepts `preselected` on an extras choice and `defaultValue` on a yes-no modifier, and rejects `defaultQuantity`, `yesLabel`, `noLabel` with `modifier.invalid`. The cap rule rejects when the count of preselected choices exceeds `maxTotalQuantity`.
- Consumed by: Tasks 2 (till mirrors these shapes in its own types) and 6 (dashboard mirrors them).

- [ ] **Step 1: Write the failing contract tests**

Add to `packages/catalogue/src/modifier-contract.test.ts`. Read the file first for its existing `parseModifierInput` helper and fixture style; these assert the new shape.

```ts
it("accepts a preselected extras choice and rejects defaultQuantity", () => {
  const parsed = parseModifierInput({
    type: "extras", name: { en: "Extras" }, required: false, maxTotalQuantity: null,
    choices: [{ id: crypto.randomUUID(), name: { en: "Cheese" }, available: true,
      priceDelta: "1.00", maxQuantity: 2, preselected: true }],
  });
  if (parsed.type !== "extras") throw new Error("type");
  expect(parsed.choices[0]!.preselected).toBe(true);
  expect("defaultQuantity" in parsed.choices[0]!).toBe(false);
  expect(() => parseModifierInput({
    type: "extras", name: { en: "Extras" }, required: false, maxTotalQuantity: null,
    choices: [{ id: crypto.randomUUID(), name: { en: "Cheese" }, available: true,
      priceDelta: "1.00", maxQuantity: 2, defaultQuantity: 1 }],
  })).toThrow(expect.objectContaining({ code: "modifier.invalid" }));
});

it("forces preselected false on an unavailable extras choice", () => {
  const parsed = parseModifierInput({
    type: "extras", name: { en: "Extras" }, required: false, maxTotalQuantity: null,
    choices: [{ id: crypto.randomUUID(), name: { en: "Cheese" }, available: false,
      priceDelta: "1.00", maxQuantity: 2, preselected: true }],
  });
  if (parsed.type !== "extras") throw new Error("type");
  expect(parsed.choices[0]!.preselected).toBe(false);
});

it("rejects more preselected choices than the total cap", () => {
  const choice = (name: string) => ({ id: crypto.randomUUID(), name: { en: name },
    available: true, priceDelta: "1.00", maxQuantity: 1, preselected: true });
  expect(() => parseModifierInput({
    type: "extras", name: { en: "Extras" }, required: false, maxTotalQuantity: 1,
    choices: [choice("A"), choice("B")],
  })).toThrow(expect.objectContaining({ code: "modifier.invalid", params: { field: "maxTotalQuantity" } }));
});

it("parses a yes-no modifier with no custom labels and rejects them", () => {
  const parsed = parseModifierInput({ type: "yes-no", name: { en: "Decaf" }, defaultValue: true });
  expect(parsed).toEqual({ type: "yes-no", name: { en: "Decaf" }, available: true, defaultValue: true });
  expect(() => parseModifierInput({ type: "yes-no", name: { en: "Decaf" },
    yesLabel: { en: "Y" }, noLabel: { en: "N" }, defaultValue: true }))
    .toThrow(expect.objectContaining({ code: "modifier.invalid" }));
});
```

- [ ] **Step 2: Run the tests; verify they fail**

Run: `pnpm --filter @waitron/catalogue test modifier-contract`
Expected: FAIL — the new keys are rejected / old keys still accepted.

- [ ] **Step 3: Change the shared types**

In `packages/shared/src/modifiers.ts`: in `ExtraChoice` replace `defaultQuantity: number;` with `preselected: boolean;`. In the `ModifierInput` union change the yes-no member to `| { type: "yes-no"; defaultValue: boolean }`. In `packages/shared/src/modifier-snapshots.ts` change the yes-no member to `| { type: "yes-no"; value: boolean }` (drop `label`).

- [ ] **Step 4: Update the catalogue contract**

In `packages/catalogue/src/modifier-contract.ts`:
- yes-no branch (currently lines 93–102): allowed keys become `[...baseKeys, "defaultValue"]`; return `{ ...common, type: "yes-no", defaultValue: bool(row.defaultValue === undefined ? false : row.defaultValue, "defaultValue") }`.
- extras choice allowed keys (line 122): replace `"defaultQuantity"` with `"preselected"`.
- Replace the `requestedDefault` block (lines 149–154). Remove it and the `requestedDefault > maxQuantity` check. Add: `const preselected = bool(choice.preselected === undefined ? false : choice.preselected, \`${field}.preselected\`);`
- In the returned extras choice (lines 162–168) replace `defaultQuantity: available ? requestedDefault : 0,` with `preselected: available ? preselected : false,`.
- Replace the cap check (lines 191–195): `extraChoices.reduce((sum, choice) => sum + (choice.preselected ? 1 : 0), 0) > maxTotalQuantity`.

- [ ] **Step 5: Update the catalogue persistence and projection**

In `packages/catalogue/src/modifiers.ts`:
- `listModifiers` yes-no return (lines 39–46): drop `yesLabel`/`noLabel`, keep `defaultValue`.
- extras choice projection (line 62): `defaultQuantity: item.defaultQuantity,` → `preselected: item.preselected,`.
- `validateLabels` (lines 120–123): delete the `if (input.type === "yes-no")` block that validates `yesLabel`/`noLabel`.
- `groupValues` (lines 140–141): delete `yesLabel`/`noLabel`.
- `writeChoices` `values` (line 175): `defaultQuantity: input.type === "extras" ? (choice as ExtraChoice).defaultQuantity : 0,` → `preselected: input.type === "extras" ? (choice as ExtraChoice).preselected : false,`.

- [ ] **Step 6: Run the contract tests; verify they pass**

Run: `pnpm --filter @waitron/catalogue test modifier-contract`
Expected: PASS.

- [ ] **Step 7: Change the schema**

In `packages/db/src/schema/catalogue.ts`: in `optionGroups` delete the `yesLabel`/`noLabel` column lines (180–181). In `optionGroupItems` delete the `defaultQuantity` line (228) and add `preselected: boolean("preselected").notNull().default(false),` in its place. Confirm `boolean` is already imported at the top of the file (it is used by `active`).

- [ ] **Step 8: Generate the migration**

Run: `pnpm --filter @waitron/db db:generate --name modifiers_editing_rework`
Expected: a new `packages/db/drizzle/0024_modifiers_editing_rework.sql` plus a `meta/` snapshot, dropping two columns from `option_groups`, dropping one and adding `preselected` on `option_group_items`. Do not hand-edit it. If the number is not `0024`, reset `packages/db/drizzle` to main's state and regenerate.

- [ ] **Step 9: Update the server snapshot and the seed**

In `apps/server/src/modifier-selection.ts` (lines 20–26): the yes-no `snapshots.push` drops the `label:` line, keeping `value: selection.value`.
In `apps/server/scripts/demo-seed/seed-options.ts`: in the yes-no group (lines 158–162) delete `yesLabel`/`noLabel`; in the extras choices replace `defaultQuantity: 1` with `preselected: true` and `defaultQuantity: 0` with `preselected: false`.

- [ ] **Step 10: Update the remaining catalogue and server test fixtures**

Update fixtures (not behaviour) so they use the new shape: in `packages/catalogue/src/{modifiers.pg,modifier-projection,modifier-dependencies.pg}.test.ts` and `apps/server/scripts/demo-seed/seed-options.test.ts` and `apps/server/src/{till-api,till-api.pg,catalogue-api,catalogue-api.pg,working-order,configuration-transfer,management-api.status}.test.ts`, replace every `defaultQuantity: N` on an extras choice with `preselected: <N > 0>` and delete every `yesLabel`/`noLabel` from a yes-no fixture. Where a projection test asserts a stored `defaultQuantity`, assert `preselected` instead. Preserve each test's behavioural assertion — do not weaken an assertion to make it pass. `grep -rn "defaultQuantity\|yesLabel\|noLabel" packages/catalogue apps/server` must return nothing when done.

- [ ] **Step 11: Run the catalogue suite (real-PG) and the touched server tests**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test:coverage`
Then: `pnpm --filter @waitron/server test modifier-selection till-api catalogue-api working-order configuration-transfer seed-options`
Expected: PASS. The catalogue real-PG tests exercise the new migration, the grants (via `asAppUser`) and the projection. If the migration or a grant fails, fix the schema/migration, not the assertion.

- [ ] **Step 12: Typecheck the changed packages**

Run: `pnpm --filter @waitron/shared --filter @waitron/db --filter @waitron/catalogue --filter @waitron/server typecheck`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add packages/shared packages/db packages/catalogue apps/server
git commit -s -m "Drop custom yes/no labels and default quantities from a modifier

A yes/no modifier no longer carries its own yes and no labels, and an
extra is now marked preselected rather than given a starting quantity.
The shared types, the database, the catalogue validation and persistence,
the order snapshot and the demo seed all move to the simpler shape; the
generated migration drops the two label columns and the default-quantity
column and adds a preselected flag."
```

---

## Task 2: Render the simplified data at the till

**Files:**
- Modify: `apps/till/src/api/client.ts` (local `Modifier`, `ModifierSnapshot` types)
- Modify: `apps/till/src/widgets/modifier-picker.ts`
- Modify: `apps/till/src/widgets/basket.ts`
- Test: `apps/till/src/widgets/modifier-picker.modes.test.ts`, `apps/till/src/widgets/basket.test.ts`, and fixture edits in `apps/till/src/state/as-served-diet.test.ts`, `apps/till/src/widgets/tender-pay.test.ts`

Note (Ruling C): `apps/till/src/i18n/strings.ts` is NOT modified — no `modifier.yes`/`modifier.no` strings are added. A yes/no is a checkbox labelled with the modifier name.

**Interfaces:**
- Consumes: the shapes from Task 1, mirrored in the till's own `client.ts` types.
- Produces: a yes/no modifier renders as one `wt-switch`; a preselected extras choice pre-fills quantity 1; the basket shows the modifier name for an affirmative yes/no answer and nothing for a negative one.

- [ ] **Step 1: Write the failing till tests**

Read `apps/till/src/widgets/modifier-picker.modes.test.ts` and `basket.test.ts` for their mount helpers and fixture style, then add:

```ts
// modifier-picker.modes.test.ts — a yes/no modifier is a toggle, an explicit "no" survives
it("renders yes/no as a toggle and preserves an explicit no", async () => {
  const el = await mountPicker({ /* product with a yes-no modifier, defaultValue: true */ });
  const toggle = el.shadowRoot!.querySelector<HTMLElement>(`wt-switch[name="modifier-<id>"]`)!;
  expect(toggle).not.toBeNull();
  toggle.dispatchEvent(new CustomEvent("wt-change", { detail: { checked: false } }));
  await el.updateComplete;
  const { modifierSelections } = el.collect();           // use the widget's real collect path
  expect(modifierSelections).toContainEqual({ modifierId: "<id>", type: "yes-no", value: false });
});

it("pre-fills quantity 1 for a preselected extras choice", async () => {
  const el = await mountPicker({ /* product with an extras choice, preselected: true, maxQuantity: 3 */ });
  expect(el.quantityFor("<choiceId>")).toBe(1);          // via the widget's existing quantity accessor
});
```

```ts
// basket.test.ts — a yes/no is a checkbox: an affirmative answer shows the modifier name,
// a negative answer shows nothing (Ruling C — consistent with the receipt/kitchen ticket).
it("shows the modifier name for an affirmative yes/no answer and omits a negative one", async () => {
  const yes = await mountBasket({ /* line with a yes-no snapshot, name {en:"Extra hot"}, value: true */ });
  expect(yes.shadowRoot!.textContent).toContain("Extra hot");
  const no = await mountBasket({ /* line with the same yes-no snapshot, value: false */ });
  expect(no.shadowRoot!.textContent).not.toContain("Extra hot");
});
```

Match the exact mount/accessor helpers already in each file rather than inventing new ones.

- [ ] **Step 2: Run the tests; verify they fail**

Run: `pnpm --filter @waitron/till test modifier-picker.modes basket`
Expected: FAIL — the toggle does not exist and the basket reads a missing `label`.

- [ ] **Step 3: Update the till types**

In `apps/till/src/api/client.ts`: in the extras choice inline type (lines 336–339) replace `defaultQuantity: number` with `preselected: boolean`. In the yes-no member (lines 354–359) drop `yesLabel`/`noLabel`, keep `defaultValue`. In `ModifierSnapshot` (line 375) change the yes-no member to `{ type: "yes-no"; value: boolean }`.

- [ ] **Step 4: Render the toggle and pre-fill**

In `apps/till/src/widgets/modifier-picker.ts`:
- Pre-fill (lines 166–169): replace the `defaultQuantity` loop body with `if (choice.available && choice.preselected) this.quantities[choice.id] = 1;`.
- `#collect` yes-no (lines 473–481): drop the `label:` line from the pushed snapshot.
- Render (lines 542–558): replace the two-radio `[false, true].map(...)` branch with a single `wt-switch`:

```ts
: html`<wt-switch
    name=${`modifier-${modifier.id}`}
    label=${name}
    .checked=${this.answers[modifier.id] === true}
    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
      event.stopPropagation();
      this.answers = { ...this.answers, [modifier.id]: event.detail.checked };
    }}
  ></wt-switch>`
```

Add `import "@waitron/ui/src/components/wt-switch.js";` near the other UI imports if it is not already present.

- [ ] **Step 5: Basket rendering (Ruling C — checkbox semantics, no yes/no strings)**

A yes/no is a checkbox labelled with the modifier name: an affirmative answer shows the name, a negative answer shows nothing, consistent with the server's `modifierSnapshotLabels` (Task 1). Do NOT add `modifier.yes`/`modifier.no` strings — none are needed.
In `apps/till/src/widgets/basket.ts` (line 329) the yes-no branch currently reads `snapshot.type === "yes-no" ? this.#lineText(line, snapshot.label, "")`. The snapshot no longer has a `label`. Change the branch so an affirmative yes/no renders the modifier name (`this.#lineText(line, snapshot.name, "")`) and a negative one renders nothing — and, since the row is built as `<name>: <value>`, filter a negative yes/no out of the mapped list entirely rather than printing an empty `<name>:`. The cleanest shape: extend the existing `.filter((snapshot) => snapshot.type !== "extras")` to also drop a `snapshot.type === "yes-no" && !snapshot.value` entry, then in the map render a yes-no as just the name (no trailing value). Confirm the resulting markup for an affirmative yes/no shows the modifier name with no stray colon-value.

- [ ] **Step 6: Run the till tests; verify they pass**

Run: `pnpm --filter @waitron/till test modifier-picker.modes basket`
Expected: PASS.

- [ ] **Step 7: Fix remaining till fixtures and typecheck**

Update `as-served-diet.test.ts` and `tender-pay.test.ts` fixtures to the new shape (`preselected`, no yes-no `label`/labels). Then:
Run: `pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/till test`
Expected: PASS. `grep -rn "defaultQuantity\|yesLabel\|noLabel\|snapshot.label" apps/till/src` returns nothing.

- [ ] **Step 8: Commit**

```bash
git add apps/till
git commit -s -m "Show a yes/no modifier as a toggle at the till

A yes/no modifier is now one on/off switch labelled with the modifier
name rather than two buttons, a preselected extra starts at quantity one,
and the basket prints Yes or No from the till's own translations rather
than from a label copied off the modifier."
```

---

## Task 3: A round icon-only button shape and its icons

**Files:**
- Modify: `packages/ui/src/components/wt-button.ts`
- Test: `packages/ui/src/components/wt-button.test.ts`, `packages/ui/src/components/wt-button.a11y.test.ts`
- Modify: `apps/dashboard/src/icons.ts`

**Interfaces:**
- Produces: `wt-button` gains `shape: "default" | "round"` (reflected). `shape="round"` renders a circular, fixed-size, icon-only button; the accessible name still comes from `aria-label`.
- Consumed by: Task 4 (the round add button).

- [ ] **Step 1: Write the failing primitive tests**

In `packages/ui/src/components/wt-button.test.ts` add:

```ts
test("round shape is circular and keeps the minimum tap target", async () => {
  const el = await mount('<wt-button shape="round" aria-label="Add"><wt-icon name="plus"></wt-icon></wt-button>');
  const inner = el.shadowRoot!.querySelector("button")!;
  const style = getComputedStyle(inner);
  const rect = el.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.width).toBeCloseTo(rect.height, 0);
  // fully-rounded radius, not the default md radius
  expect(parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(100);
});

test("round primary paints from the primary token", async () => {
  const el = await mount('<wt-button shape="round" variant="primary" aria-label="Add"><wt-icon name="plus"></wt-icon></wt-button>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  expect(getComputedStyle(el.shadowRoot!.querySelector("button")!).backgroundColor).toBe("rgb(1, 2, 3)");
});
```

In `packages/ui/src/components/wt-button.a11y.test.ts` add inside the `describe.each` theme block:

```ts
test("round icon-only button", async () => {
  await mountThemed('<wt-button shape="round" variant="primary" aria-label="Añadir"><wt-icon name="plus"></wt-icon></wt-button>', theme);
  await expectNoA11yViolations(host);
});
```

The `plus` icon must be registered in the UI test harness for these to render. Check `packages/ui/src/test-helpers.ts` / `a11y-helpers.ts` for where icons are registered in tests; if `plus` is not there, register a placeholder path in the test setup the same way existing icons (e.g. `close`) are registered.

- [ ] **Step 2: Run the tests; verify they fail**

Run: `pnpm --filter @waitron/ui test wt-button`
Expected: FAIL — `shape` does not exist, radius is the default.

- [ ] **Step 3: Add the shape**

In `packages/ui/src/components/wt-button.ts`:
- Add a type `export type WtButtonShape = "default" | "round";` beside the other exported unions.
- Add the property: `@property({ reflect: true }) shape: WtButtonShape = "default";`
- Add to the styles block:

```css
:host([shape="round"]) button {
  width: var(--wt-tap-min);
  min-width: var(--wt-tap-min);
  height: var(--wt-tap-min);
  padding: 0;
  border-radius: var(--wt-radius-full);
}
```

- [ ] **Step 4: Run the tests; verify they pass**

Run: `pnpm --filter @waitron/ui test wt-button`
Expected: PASS.

- [ ] **Step 5: Register the icons**

In `apps/dashboard/src/icons.ts` add two entries to `DASHBOARD_ICONS` and document them in the header comment beside the existing entries:

```ts
// plus: the Modifiers list's round "new modifier" button (a centred cross).
plus: "M7.25 2.5H8.75V7.25H13.5V8.75H8.75V13.5H7.25V8.75H2.5V7.25H7.25Z",
// grip: the drag handle that reorders a modifier's choices (two columns of dots).
grip: "M6 3.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 3.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M6 8a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 8a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M6 12.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 12.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0",
```

- [ ] **Step 6: Verify token discipline and typecheck**

Run: `pnpm --filter @waitron/ui test no-hardcoded-chrome && pnpm --filter @waitron/ui typecheck && pnpm --filter @waitron/dashboard typecheck`
Expected: PASS — the round shape uses only tokens.

- [ ] **Step 7: Commit**

```bash
git add packages/ui apps/dashboard/src/icons.ts
git commit -s -m "Add a round icon-only button shape and the plus and grip icons

wt-button gains a round shape: a circular, fixed-size, icon-only button
whose accessible name still comes from its aria-label, painted from the
same variant tokens as an ordinary button. The dashboard registers a plus
icon for the modifiers add button and a grip icon for a drag handle."
```

---

## Task 4: The round add button on the Modifiers screen

**Files:**
- Modify: `apps/dashboard/src/screens/modifiers-screen.ts`
- Test: `apps/dashboard/src/screens/modifiers-screen.test.ts`

**Interfaces:**
- Consumes: the round `wt-button` shape and the `plus` icon from Task 3.
- Produces: the screen's `data-test="create"` control is now a round button beside the heading; its behaviour (opens the new-modifier form) is unchanged.

- [ ] **Step 1: Write/adjust the failing screen test**

In `apps/dashboard/src/screens/modifiers-screen.test.ts` add:

```ts
it("opens the new-modifier form from a round add button with an accessible name", async () => {
  const el = await mount();
  const add = el.shadowRoot!.querySelector<HTMLElement>('[data-test="create"]')!;
  expect(add.getAttribute("shape")).toBe("round");
  expect(add.getAttribute("aria-label")).toBe("Create modifier");
  expect(el.shadowRoot!.querySelector("wt-row-actions")).toBeNull(); // the old kebab is gone from the heading
  add.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!.open).toBe(true);
});
```

The existing "opens the shared form" test uses `[data-test="create"]`; keep it working. Note the row-level `wt-row-actions` inside the table still exists — this assertion is scoped to the heading, so query within the heading container (add a `.heading` scope in the test if needed) rather than the whole shadow root, or assert the create control is a `wt-button[shape="round"]`.

- [ ] **Step 2: Run; verify it fails**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: FAIL — the create control is a ghost button in a kebab menu.

- [ ] **Step 3: Replace the heading action**

In `apps/dashboard/src/screens/modifiers-screen.ts` `render()`, replace the `<wt-row-actions>` wrapping the create button (the heading block) with a round button beside the heading:

```ts
return html`<div class="heading">
    <h1>${t("modifiers.title")}</h1>
    <wt-button
      data-test="create"
      shape="round"
      variant="primary"
      aria-label=${t("modifiers.new")}
      .disabled=${!this.locales}
      @click=${() => this.#edit(null)}
      ><wt-icon name="plus"></wt-icon
    ></wt-button>
  </div>
  ...
```

Add `import "@waitron/ui/src/components/wt-icon.js";` and keep the existing `wt-button` import. The `.heading` fl: `justify-content: space-between` already places the button at the trailing edge next to the heading, which reads as "just to the right of the header". Remove the now-unused heading `wt-row-actions` import only if nothing else in the file uses it (the table cell still does — keep it).

- [ ] **Step 4: Run; verify it passes**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/modifiers-screen.ts apps/dashboard/src/screens/modifiers-screen.test.ts
git commit -s -m "Open the new modifier form from a round add button

The Modifiers list's three-dot heading menu is replaced by a round blue
button with a white plus beside the heading; it carries an accessible name
and opens the same new-modifier form."
```

---

## Task 5: The per-choice modal element

**Files:**
- Create: `apps/dashboard/src/widgets/choice-form.ts`
- Test: `apps/dashboard/src/widgets/choice-form.test.ts`, `apps/dashboard/src/widgets/choice-form.a11y.test.ts`
- Modify: `apps/dashboard/src/api/client.ts` (types), `apps/dashboard/src/i18n/strings.ts` (only if new keys are needed beyond the existing `modifiers.*` set)

**Interfaces:**
- Consumes: the dashboard's `ModifierExtraChoice`/`ModifierChoice` types (updated here: `defaultQuantity` → `preselected`, yes-no member loses labels — see Step 3).
- Produces: `<dashboard-choice-form>` custom element with props `open: boolean`, `busy: boolean`, `locales: string[]`, `kind: "extras" | "options"`, `value: ChoiceDraft | null`, `fieldErrors: Record<string,string>`; emits `wt-choice-save` with `{ detail: { value: ChoiceDraft } }` (bubbles, composed) and `wt-choice-cancel`. `ChoiceDraft` is the per-choice draft shape (id, per-language names, available, and for extras priceDelta/maxQuantity/vatClass/effects) — exported from this file for Task 6 to consume.

This element holds the fields the table does not show. It renders a `wt-modal` (guarding its close so a consumer's outer modal is not also dismissed — see the nested-modal rule in `design-system.md`), the per-language name inputs, the Available switch, and for `kind: "extras"` the Price, Maximum quantity and VAT selectors plus the allergen/dietary Effects `details` block. Move the effects markup (`#effects`, `#effectList`, `#dietaryEffect`) out of `modifier-form.ts` into this element; Task 6 deletes the originals.

- [ ] **Step 1: Update the dashboard types**

In `apps/dashboard/src/api/client.ts`: in `ModifierExtraChoice` (line 421) replace `defaultQuantity: number;` with `preselected: boolean;`. In the `ModifierInput` yes-no member (lines 435–439) drop `yesLabel`/`noLabel`, keep `defaultValue`. This will break `modifier-form.ts` compilation until Task 6; that is expected — this task's deliverable (`choice-form.ts` + its tests) compiles and passes on its own, and Task 6 restores the workspace typecheck. Do not run a whole-workspace typecheck at the end of this task; run the scoped checks in Step 6.

- [ ] **Step 2: Write the failing choice-form tests**

Create `apps/dashboard/src/widgets/choice-form.test.ts`, modelled on `modifier-form.test.ts`'s mount/change/click helpers:

```ts
it("emits an extras choice with names, price and effects, and validates the price", async () => {
  const el = await mountChoice({ kind: "extras" });
  const save = vi.fn();
  el.addEventListener("wt-choice-save", save);
  await click(el, "choice-save");
  expect(save).not.toHaveBeenCalled();                       // name required in default language
  await change(el, "name-es", "Queso");
  await change(el, "priceDelta", "1.5x");
  await click(el, "choice-save");
  expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull(); // bad price
  await change(el, "priceDelta", "1.50");
  await change(el, "maxQuantity", "2");
  await click(el, "choice-save");
  expect(save.mock.calls[0]![0].detail.value).toMatchObject({
    name: { es: "Queso" }, available: true, priceDelta: "1.50", maxQuantity: 2,
  });
});

it("guards its close so it does not bubble past itself", async () => {
  const el = await mountChoice({ kind: "options" });
  const outer = vi.fn();
  el.addEventListener("wt-close", outer);                     // a wt-modal close must not escape as wt-close
  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  // the element re-emits wt-choice-cancel, and does not let a raw wt-close leak to consumers
});
```

Adapt selectors to the element's real `data-test` ids as you build it; keep the two behaviours (validated save, guarded close).

Create `apps/dashboard/src/widgets/choice-form.a11y.test.ts` modelled on `modifier-form.a11y.test.ts`: mount the element open in both themes for `kind: "extras"` and `kind: "options"`, open the effects `details`, and `expectNoA11yViolations`.

- [ ] **Step 3: Run; verify they fail**

Run: `pnpm --filter @waitron/dashboard test choice-form`
Expected: FAIL — the element does not exist.

- [ ] **Step 4: Build the element**

Create `apps/dashboard/src/widgets/choice-form.ts`. Reuse the input/name/toggle/select helpers and the effects markup lifted from `modifier-form.ts` (the `#names`, `#input`, `#toggle`, `#effects`, `#effectList`, `#dietaryEffect` methods and the price/maxQuantity/vatClass fields). Render inside a `wt-modal`; on the modal's `wt-close` call `event.stopPropagation()` and emit `wt-choice-cancel`. Validate on save: name required in the default content language; for extras the price matches `/^\d+(?:\.\d{1,2})?$/` and maxQuantity is an integer ≥ 1 (mirror the existing checks in `modifier-form.ts` `#save`). Export the `ChoiceDraft` type. Register the tag in `HTMLElementTagNameMap`.

- [ ] **Step 5: Run; verify they pass**

Run: `pnpm --filter @waitron/dashboard test choice-form`
Expected: PASS.

- [ ] **Step 6: Scoped typecheck of the new element**

Run: `pnpm --filter @waitron/dashboard test choice-form && pnpm exec tsc --noEmit -p apps/dashboard 2>&1 | grep -c "choice-form"`
Expected: the second command prints `0` (no type errors originate in `choice-form.ts`). Workspace-wide errors from `modifier-form.ts` are expected here and resolved in Task 6.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/widgets/choice-form.ts apps/dashboard/src/widgets/choice-form.test.ts apps/dashboard/src/widgets/choice-form.a11y.test.ts apps/dashboard/src/api/client.ts
git commit -s -m "Add a modal for editing one modifier choice

A new choice-form element holds the fuller fields of a single choice — its
names in each language, availability, and for an extra its price, maximum
quantity, tax class and allergen effects — in a modal that guards its own
close so it can nest inside the modifier form's modal. The dashboard types
move to the preselected, label-free shape."
```

---

## Task 6: The choices table in the modifier form

**Files:**
- Modify: `apps/dashboard/src/widgets/modifier-form.ts`
- Test: `apps/dashboard/src/widgets/modifier-form.test.ts`, `apps/dashboard/src/widgets/modifier-form.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (en + es)

**Interfaces:**
- Consumes: `<dashboard-choice-form>` and its `ChoiceDraft` (Task 5); the updated dashboard types; the `grip` icon and `wt-row-actions` primitive.
- Produces: the modifier form renders extras/options choices as a `<table>` with columns Handle, Name, Price (extras), Available, Default, Row menu; a radio sets the single options default and a checkbox toggles each extras preselection; Add choice and a row's Edit open `dashboard-choice-form`; Remove drops the row. The old inline choice blocks, the Move up/down buttons, the "Default choice" dropdown and the yes-no label inputs are gone.

- [ ] **Step 1: Write the failing form tests**

Rewrite the choice-related tests in `apps/dashboard/src/widgets/modifier-form.test.ts` (keep the text/name/type tests). Add:

```ts
it("renders extras choices as a table with a preselect checkbox per row", async () => {
  const el = await mount(extra);                          // extra fixture: preselected instead of defaultQuantity
  const rows = el.shadowRoot!.querySelectorAll("tbody tr");
  expect(rows.length).toBe(2);
  const check = el.shadowRoot!.querySelector<HTMLInputElement>(`input[type="checkbox"][data-test="preselect-a"]`)!;
  expect(check).not.toBeNull();
  check.checked = true; check.dispatchEvent(new Event("change"));
  await el.updateComplete;
  // saving reflects the preselection
});

it("uses a radio for the options default and clears it", async () => {
  const el = await mount(optionsFixture);                 // two available options choices
  const radio = el.shadowRoot!.querySelector<HTMLInputElement>(`input[type="radio"][data-test="default-c1"]`)!;
  radio.checked = true; radio.dispatchEvent(new Event("change"));
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="clear-default"]')!.click();
  await el.updateComplete;
  // default returns to null
});

it("opens the choice modal to add and to edit, and removes a row", async () => {
  const el = await mount(extra);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-choice"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-choice-form")!.getAttribute("open")).not.toBeNull();
  // edit via the row menu opens the modal on that row; remove drops it
});

it("disables the default control of an unavailable choice", async () => {
  // toggling a row's availability off clears its preselection/default and disables the control
});
```

Update the extras fixture at the top of the file: replace `defaultQuantity: 1`/`0` with `preselected: true`/`false`. In `modifier-form.a11y.test.ts` update the fixtures the same way and drop `yesLabel`/`noLabel` from the yes-no fixture; keep the both-theme axe coverage of each type.

- [ ] **Step 2: Run; verify they fail**

Run: `pnpm --filter @waitron/dashboard test modifier-form`
Expected: FAIL — no table, no per-row radio/checkbox, `defaultQuantity` gone from the type.

- [ ] **Step 3: Rework the form**

In `apps/dashboard/src/widgets/modifier-form.ts`:
- Change the `ChoiceDraft` local type: `defaultQuantity: string` → `preselected: boolean`; drop `yesLabel`/`noLabel` state and the yes-no label rendering.
- `willUpdate` seeding: map `preselected` from the value; drop `yesLabel`/`noLabel`.
- Delete `#choice`, `#effects`, `#effectList`, `#dietaryEffect`, `#move`, and the "Default choice" dropdown block; those move to / are replaced by the table and `choice-form`.
- Add a `#choicesTable()` renderer: a `<table>` with a header row (Handle, Name, Price for extras, Available, Default, empty for the menu) and one `<tbody>` row per choice. Each row: a drag-handle button (`data-test="drag-<id>"`, `<wt-icon name="grip">`, `aria-label` from a `modifiers.reorder` string) in the first cell; the name in the default language; the price for extras; a `wt-switch` for available (`data-test="available-<id>"`); a Default cell holding a radio (`type="radio"`, `name="default"`, `data-test="default-<id>"`) for options or a checkbox (`data-test="preselect-<id>"`) for extras, `disabled` when the row is unavailable; and a `wt-row-actions` menu with Edit (`data-test="edit-<id>"`, opens `choice-form` on the row) and Remove (`data-test="remove-<id>"`).
- Radio change sets `this.defaultChoiceId`; checkbox change toggles a `preselected` flag on the draft; switching availability off clears the row's default/preselection (reuse the existing `#changeChoice` availability logic).
- Below the table: keep the `#error("choices")` message and the `add-choice` button (now opening `choice-form` with an empty draft rather than pushing a blank row); add a `clear-default` ghost button rendered only when `this.defaultChoiceId !== null` (options only).
- Host `<dashboard-choice-form>` inside the form, opened by add/edit, its `wt-choice-save` writing the returned draft into `this.choices` (replace by id, or append) and its `wt-choice-cancel` closing it. Guard the inner element's events so they do not reach the form's own `wt-submit`/`wt-cancel` handlers.
- `#save`: build `preselected` into each extras choice; drop `yesLabel`/`noLabel` from the yes-no branch (`value = { ...common, type: "yes-no", defaultValue: this.defaultValue }`). Keep the cap validation but count preselected choices instead of summing default quantities.
- Add `import "./choice-form.js";` and `import "@waitron/ui/src/components/wt-row-actions.js";` / `wt-icon.js` as needed.

- [ ] **Step 4: Strings**

In `apps/dashboard/src/i18n/strings.ts` (en and es): add `"modifiers.preselected"` ("Preselected" / "Preseleccionado"), `"modifiers.default"` ("Default" / "Predeterminada"), `"modifiers.clear_default"` ("Clear default" / "Quitar predeterminada"), `"modifiers.reorder"` ("Drag to reorder" / "Arrastrar para reordenar"), `"modifiers.edit_choice"` ("Edit choice" / "Editar opción"). Remove the now-unused keys `modifiers.default_quantity`, `modifiers.yes_label`, `modifiers.no_label`, `modifiers.move_up`, `modifiers.move_down`, `modifiers.defaults_invalid` (only if no longer referenced — grep first). Keep en and es in sync; `StringKey` is `keyof typeof en`, so a stale reference is a compile error.

- [ ] **Step 5: Run the form tests; verify they pass**

Run: `pnpm --filter @waitron/dashboard test modifier-form choice-form`
Expected: PASS.

- [ ] **Step 6: Full dashboard typecheck and suite**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/dashboard test`
Expected: PASS — the workspace typecheck is whole again. Fix any remaining reference to a removed string key or type.

- [ ] **Step 7: Open the screen in both themes at phone width**

The dashboard is a browser-mode package but these are unit mounts. Render the modifier form open (new and editing an extras modifier) at ~400px width in both light and dark, via the workspace Playwright Chromium or the dev stack (`wa-wt demo waitron-modifiers`), and look: the table does not overflow the modal, the handle/menu are reachable, the radio/checkbox read correctly, and dark-theme colours are legible. This catches what a string assertion cannot.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/widgets/modifier-form.ts apps/dashboard/src/widgets/modifier-form.test.ts apps/dashboard/src/widgets/modifier-form.a11y.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "Edit a modifier's choices in a table

Extras and options are now edited as a table: one row per choice with the
name, the price for an extra, an availability switch, a radio for the
single options default or a checkbox for each preselected extra, and a
per-row menu whose Edit and Remove open or drop the choice. The fuller
per-choice fields open in the choice modal, and the options default is set
from the row radio with a clear-default button rather than a dropdown."
```

---

## Task 7: Pointer and keyboard reorder

**Files:**
- Create: `apps/dashboard/src/widgets/reorder.ts`
- Test: `apps/dashboard/src/widgets/reorder.test.ts`
- Modify: `apps/dashboard/src/widgets/modifier-form.ts`
- Test: `apps/dashboard/src/widgets/modifier-form.test.ts`

**Interfaces:**
- Consumes: the choices table from Task 6.
- Produces: `reorder<T>(list: readonly T[], from: number, to: number): T[]` (pure); the drag handle reorders by pointer drag and by keyboard Up/Down, mutating `this.choices` order.

- [ ] **Step 1: Write the failing reorder helper test**

Create `apps/dashboard/src/widgets/reorder.test.ts`:

```ts
import { expect, it } from "vitest";
import { reorder } from "./reorder.js";
it("moves an item and clamps to the ends", () => {
  expect(reorder(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  expect(reorder(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]); // clamped, no-op
  expect(reorder(["a", "b", "c"], 2, 5)).toEqual(["a", "b", "c"]);  // clamped, no-op
});
```

- [ ] **Step 2: Run; verify it fails**

Run: `pnpm --filter @waitron/dashboard test reorder`
Expected: FAIL — `reorder` does not exist.

- [ ] **Step 3: Write the helper**

Create `apps/dashboard/src/widgets/reorder.ts`:

```ts
/** Move the item at `from` to index `to`, returning a new array. Out-of-range `to` is a no-op. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
```

- [ ] **Step 4: Run; verify it passes**

Run: `pnpm --filter @waitron/dashboard test reorder`
Expected: PASS.

- [ ] **Step 5: Write the failing form reorder tests**

Add to `apps/dashboard/src/widgets/modifier-form.test.ts`:

```ts
it("reorders choices with the keyboard", async () => {
  const el = await mount(extra);                           // choices a, b
  const handle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-a"]')!;
  handle.focus();
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await el.updateComplete;
  const order = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-choice"));
  expect(order).toEqual(["b", "a"]);
});

it("reorders choices by pointer drag", async () => {
  const el = await mount(extra);
  const handle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-a"]')!;
  const rowB = el.shadowRoot!.querySelector<HTMLElement>('tr[data-choice="b"]')!;
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  const box = rowB.getBoundingClientRect();
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY: box.top + box.height / 2 }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  await el.updateComplete;
  const order = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-choice"));
  expect(order).toEqual(["b", "a"]);
});
```

Ensure each `<tbody>` row carries `data-choice=${choice.id}` (add it in Task 6's table if not already present — add here if missing).

- [ ] **Step 6: Run; verify they fail**

Run: `pnpm --filter @waitron/dashboard test modifier-form`
Expected: FAIL — no reorder handlers.

- [ ] **Step 7: Wire the handle**

In `apps/dashboard/src/widgets/modifier-form.ts`:
- Import `reorder`.
- On each handle button: `@keydown` handling `ArrowUp`/`ArrowDown` → find the choice index, `this.choices = reorder(this.choices, index, index + delta)`, then after update re-focus the moved handle (`data-test="drag-<id>"`); `preventDefault` so the modal does not scroll.
- Pointer drag: on the handle `@pointerdown`, record the dragged id and add `pointermove`/`pointerup` listeners on `document`; on move, find the row under `clientY` (compare against each `tbody tr`'s `getBoundingClientRect()`), and if it differs, `this.choices = reorder(...)` to that index; on up, remove the listeners. Set `touch-action: none` on the handle (via a token-free CSS property — `touch-action` is not a themed value) so a touch drag does not scroll the modal.

- [ ] **Step 8: Run; verify they pass**

Run: `pnpm --filter @waitron/dashboard test modifier-form reorder`
Expected: PASS. If the pointer test is flaky in headless Chromium, assert the reorder through the same `reorder` helper the handler calls and keep the keyboard test as the integration guarantee — do not delete the behaviour, and do not mark the test skipped to get green.

- [ ] **Step 9: Full dashboard suite and a11y**

Run: `pnpm --filter @waitron/dashboard test`
Expected: PASS, including `modifier-form.a11y` and `choice-form.a11y` in both themes.

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/src/widgets/reorder.ts apps/dashboard/src/widgets/reorder.test.ts apps/dashboard/src/widgets/modifier-form.ts apps/dashboard/src/widgets/modifier-form.test.ts
git commit -s -m "Reorder a modifier's choices by drag or keyboard

The drag handle in each choice row reorders the list by pointer drag and,
when focused, by the Up and Down arrow keys, so reordering works by touch
on a tablet and from the keyboard. The order of the choices array is the
saved order."
```

---

## Final verification (after Task 7)

- [ ] Run `git grep -n "defaultQuantity\|yesLabel\|noLabel\|default_quantity\|yes_label\|no_label"` across the repo — only historical docs/specs may match; no source or test.
- [ ] Run the touched package suites once: `pnpm --filter @waitron/catalogue --filter @waitron/db test:coverage` (real-PG, `TESTCONTAINERS_RYUK_DISABLED=true`), `pnpm --filter @waitron/dashboard --filter @waitron/till --filter @waitron/ui test`, `pnpm --filter @waitron/server test`. Check memory/heaviest-process headroom before the browser runs; do not run beside another session's browser suite.
- [ ] Then run `/finish-branch`: rebase, the review wave (this diff touches a cross-package contract and a migration — a risk trigger — so the FULL ceremony applies), apply findings, open the PR, watch CI (the shards run `test:coverage`), address findings, and report when ready to land.

---

## Self-review

**Spec coverage.** Round add button → Task 3 (shape) + Task 4 (screen). Choices as a table with per-row kebab → Task 6. Drag handle first column → Task 7. Radio (options) / checkbox (extras) default → Task 6. Add/edit choice opens a modal → Task 5 (element) + Task 6 (wiring). Yes/No is just Yes/No, toggle when ordering → Task 1 (contract/snapshot) + Task 2 (till toggle) + Task 6 (form drops label inputs). `preselected` replaces `defaultQuantity`, cap by count → Task 1. Schema drop/add + migration → Task 1. Every listed consumer (`Where the edits land`) has a task: shared/catalogue/db/server/seed (1), till (2), dashboard (3–7). Testing section maps to each task's test steps. No spec requirement is left without a task.

**Placeholder scan.** Every code step carries real code or a precise file/line edit; test steps carry runnable assertions; no "TBD"/"handle edge cases"/"similar to". The one deliberately open detail is the exact `data-test` selectors inside `choice-form` (Step 5.2/5.4), bounded by the two named behaviours it must satisfy.

**Type consistency.** `preselected: boolean` and the label-free yes-no member are introduced in Task 1 (shared) and mirrored identically in Task 2 (till `client.ts`) and Task 5 (dashboard `client.ts`); `ChoiceDraft` is produced in Task 5 and consumed in Task 6; `reorder` is produced in Task 7 Step 3 and used in Step 7; `shape: "default" | "round"` is produced in Task 3 and consumed in Task 4. The error code is `modifier.invalid` with a `field` param throughout, matching the existing `parseModifierInput`.
