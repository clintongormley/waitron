# SP-B2.1 — Till tab shell + nav + card gating + light-screen wrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the till's `screen`-enum state machine with a **tab shell + drill-in stack** driven by the device's layout `ProfileDef`, render every tab through B1's `till-card-grid`, add the deferred **capability→absent / permission→locked** card gating plus big-card `visibleWhen`, and wrap the two self-contained bespoke screens (**expo**, **floor-plan**) as full-span cards — with the legacy `screen`-enum kept as a fallback for an unprofiled boot.

**Architecture:** A new presentational `till-tab-shell` renders the tab bar (from `profile.tabs`), the header chrome relocated off the counter screen, and slots for the active-tab body + an optional drill-in overlay. `till-app` owns all data/handlers: when `this.profile` is present it renders the shell (each tab's body is a `till-card-grid`, except the counter tab which stays `till-counter-screen` embedded); when absent it renders the legacy `screen`-enum unchanged. The bespoke screens gain an `embedded` prop that suppresses their own header/Back so they mount cleanly in a card host while the legacy path keeps its chrome. `till-card-grid` grows the three visibility axes and the `floor-plan`/`table-layout-editor`/`expo` card cases.

**Tech Stack:** TypeScript, Lit (custom elements, shadow DOM), Vitest browser-mode (`apps/till`, headless Chromium), `@waitron/ui` `--wt-*` tokens.

**Spec:** [`docs/superpowers/specs/2026-09-03-sp-b2-till-tab-shell-and-card-wrap-design.md`](../specs/2026-09-03-sp-b2-till-tab-shell-and-card-wrap-design.md) (SP-B2). Parent: [`2026-09-03-sp-b-grid-editor-and-rendering-design.md`](../specs/2026-09-03-sp-b-grid-editor-and-rendering-design.md). B1 plan: [`2026-09-03-sp-b1-grid-renderer-and-counter.md`](2026-09-03-sp-b1-grid-renderer-and-counter.md).

## Global Constraints

- **Bundle rule:** `apps/till` MUST NOT import `@waitron/layouts`. Profile types + the minimal card-contract data (required capability/permission per card type) are mirrored locally in `apps/till/src/layout.ts` (as `ProfileDef`/`LayoutDef` already are).
- **Sale path never blocked (fiscal §5, spec §9):** the counter must always render product-grid/basket/total/tender-pay; **`tender-pay` always renders regardless of `integrated-card-payment`** (it takes cash) — a hard carve-out, test-pinned. `SALE_CRITICAL_CARDS` stay server-mandatory (unchanged).
- **No flow lost:** every `screen`-enum transition maps onto a tab-switch or a drill-in push/pop; every wrapped screen's composed events keep firing. Keep each screen's existing behavioural assertions — re-point mounts, do not rewrite the assertions.
- **De-risk via fallback:** `this.profile` present → shell path; absent → legacy `screen`-enum (unchanged). Removal of the legacy path is B4, not here.
- **Not H2 / not fiscal:** no sale-recording, chain, migration, or DB-schema change. No `tenant_receipts` (B4).
- **No hardcoded chrome:** shell, tab bar, drill-in host, card hosts use `--wt-*` tokens only.
- **Error codes** name the domain concept; reuse `profile.*`/`device.*`; grep siblings before coining; every throwing file imports its registry.
- **Coverage thresholds:** `apps/till` is `95/95/90/88`. Run `pnpm --filter @waitron/till test:coverage`. Browser-mode is memory-heavy — do NOT run `apps/till`/`apps/ui`/`apps/dashboard` `test:coverage` concurrently.
- **Every commit `-s`.** TDD: failing test first, watch it fail, minimal implementation, watch it pass, commit.

---

## File Structure

- **Modify** `apps/till/src/layout.ts` — add local card-contract data: `CARD_REQUIRED_CAPABILITY: Partial<Record<CardType, CapabilityFlag>>` and `CARD_REQUIRED_PERMISSION: Partial<Record<CardType, string>>` mirroring `card-contract.ts` (bundle rule).
- **Modify** `apps/till/src/screens/till-expo-screen.ts` + test — add `embedded` prop suppressing header/Back.
- **Modify** `apps/till/src/screens/till-floor-screen.ts` + test — add `embedded` prop suppressing header/Back (keep view/edit toggles inside).
- **Modify** `apps/till/src/widgets/card-grid.ts` + tests — capability/permission gating props + logic; `visibleWhen` fail-open; the `floor-plan`/`table-layout-editor`/`expo` card cases + their data props.
- **Create** `apps/till/src/widgets/tab-shell.ts` + tests — the `till-tab-shell` presentational component.
- **Modify** `apps/till/src/screens/till-counter-screen.ts` + test — add `embedded` prop that suppresses its header (chrome moves to the shell); body unchanged.
- **Modify** `apps/till/src/till-app.ts` + test — render the shell when `profile` present (per-tab body + drill-in stack, mapping every nav event); legacy `screen`-enum fallback otherwise; handheld tab-set from `profile.tabs`.

---

## Task 1: `CARD_REQUIRED_CAPABILITY` / `CARD_REQUIRED_PERMISSION` local mirror

**Files:**
- Modify: `apps/till/src/layout.ts` (append after the `ProfileDef` mirror block, ~:105)
- Test: `apps/till/src/layout.test.ts` (add cases)

**Interfaces:**
- Consumes: `CardType`, `CapabilityFlag` (`./layout.js`).
- Produces: `CARD_REQUIRED_CAPABILITY: Partial<Record<CardType, CapabilityFlag>>`, `CARD_REQUIRED_PERMISSION: Partial<Record<CardType, string>>` exported from `../layout.js`. Values mirror `packages/layouts/src/card-contract.ts:36-124`: `tender-pay → "integrated-card-payment"`, `kds-board → "act-as-kds"`; `table-layout-editor → "till.configure"`. No other card carries either.

- [ ] **Step 1: Write the failing test**

Add to `apps/till/src/layout.test.ts`:

```ts
import { CARD_REQUIRED_CAPABILITY, CARD_REQUIRED_PERMISSION } from "./layout.js";

describe("card-contract mirror", () => {
  it("mirrors the required capability per card", () => {
    expect(CARD_REQUIRED_CAPABILITY["tender-pay"]).toBe("integrated-card-payment");
    expect(CARD_REQUIRED_CAPABILITY["kds-board"]).toBe("act-as-kds");
    expect(CARD_REQUIRED_CAPABILITY["product-grid"]).toBeUndefined();
  });
  it("mirrors the required permission per card", () => {
    expect(CARD_REQUIRED_PERMISSION["table-layout-editor"]).toBe("till.configure");
    expect(CARD_REQUIRED_PERMISSION["floor-plan"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/till test layout -t "card-contract mirror"`
Expected: FAIL — the two constants are not exported.

- [ ] **Step 3: Implement the mirror**

Append to `apps/till/src/layout.ts`:

```ts
// Minimal mirror of the per-card contract axes the till needs to GATE the view (SP-B2). The server
// validates every profile on write against `packages/layouts/src/card-contract.ts`; the client only
// needs the required-capability / required-permission per card to hide/lock a cell. Keep in sync with
// CARD_CONTRACTS if a card's contract changes. `tender-pay`'s capability is deliberately NOT enforced
// as an absence (it takes cash) — see the always-render carve-out in card-grid.ts.
export const CARD_REQUIRED_CAPABILITY: Partial<Record<CardType, CapabilityFlag>> = {
  "tender-pay": "integrated-card-payment",
  "kds-board": "act-as-kds",
};

export const CARD_REQUIRED_PERMISSION: Partial<Record<CardType, string>> = {
  "table-layout-editor": "till.configure",
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @waitron/till test layout -t "card-contract mirror"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/layout.ts apps/till/src/layout.test.ts
git commit -s -m "feat(till): mirror per-card capability/permission contract locally (SP-B2.1)"
```

---

## Task 2: `till-card-grid` — capability→ABSENT gating + tender-pay exception

**Files:**
- Modify: `apps/till/src/widgets/card-grid.ts` (prop ~:43-65; `render()` filter ~:67-73)
- Test: `apps/till/src/widgets/card-grid.test.ts`

**Interfaces:**
- Consumes: `CARD_REQUIRED_CAPABILITY` (Task 1); `CapabilityFlag` (`../layout.js`).
- Produces: `till-card-grid` gains `@property({attribute:false}) capabilities: CapabilityFlag[] = []`. A card whose `CARD_REQUIRED_CAPABILITY[type]` is set and NOT in `capabilities` is skipped (cell collapses), EXCEPT `tender-pay`, which always renders.

- [ ] **Step 1: Write the failing test**

Add to `card-grid.test.ts` (reuse `mountWidget`/`WorkingOrderStore` already imported):

```ts
const kdsTab: TabDef = {
  key: "x", title: "X", columns: 12,
  cards: [
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
    { type: "kds-board", colSpan: 12, rowSpan: 6, config: {} },
  ],
};

it("skips a capability-gated card when the capability is absent", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: kdsTab, store, capabilities: [] });
  expect(el.shadowRoot!.querySelector("till-station-screen")).toBeNull(); // kds-board absent
});

it("renders a capability-gated card when the capability is present", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: kdsTab, store, capabilities: ["act-as-kds"] });
  expect(el.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
});

it("ALWAYS renders tender-pay even without integrated-card-payment (cash path, sale-critical)", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: kdsTab, store, capabilities: [] });
  expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
});
```

> **Implementer note:** the `kds-board` case renders `till-station-screen`, added in Task 5. Until then, that element is `nothing`. Run these three tests AFTER Task 5 for the `kds-board` assertions; the `tender-pay` assertion passes from this task. Split: land the `tender-pay` always-render test here; move the two `kds-board` capability tests into Task 5's test block. (Keep them together in the file; only the ordering of "when it goes green" differs.)

- [ ] **Step 2: Run to verify the tender-pay test fails**

Run: `pnpm --filter @waitron/till test card-grid -t "ALWAYS renders tender-pay"`
Expected: FAIL only if gating is added incorrectly; today (no gating) it PASSES. So first write a **failing** guard: add a temporary `capabilities`-absent card that SHOULD be skipped. Simpler: assert the mechanism via a synthetic non-exception card. Replace the two `kds-board` tests above with a synthetic-card test that fails today:

```ts
it("skips a capability-gated card whose capability is absent (mechanism)", async () => {
  const store = new WorkingOrderStore();
  // held-orders has no required capability; kds-board requires act-as-kds and renders `nothing` until Task 5,
  // so gate the MECHANISM on prep-queue by temporarily... — instead assert tender-pay is the ONLY exception:
  const tab: TabDef = { key: "x", title: "X", columns: 12,
    cards: [{ type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} }] };
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab, store, capabilities: [] });
  expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
});
```

Because no B1-rendered card except `tender-pay` carries a required capability, the mechanism's first *observable* skip is `kds-board` (Task 5). This task therefore delivers: the `capabilities` prop, the skip logic in `#visible`/`#cell`, and the `tender-pay` carve-out — with the carve-out test here and the skip test in Task 5. Proceed to Step 3.

- [ ] **Step 3: Implement the capability gate**

In `card-grid.ts`: add the prop and import `CARD_REQUIRED_CAPABILITY` from `../layout.js`:

```ts
import { CARD_REQUIRED_CAPABILITY, CARD_REQUIRED_PERMISSION } from "../layout.js";
// ...
@property({ attribute: false }) capabilities: CapabilityFlag[] = [];
```

Add a capability check folded into the existing `render()` filter (`:67-73`) — extend the `#visible` filter, or add a sibling `#capable`:

```ts
/** Capability→ABSENT (spec §5.1). tender-pay is sale-critical + takes cash → ALWAYS rendered. */
#capable(card: CardInstance): boolean {
  if (card.type === "tender-pay") return true; // cash path — never gated absent
  const required = CARD_REQUIRED_CAPABILITY[card.type];
  return required === undefined || this.capabilities.includes(required);
}
```

Change the `render()` filter from `tab.cards.filter((card) => this.#visible(card))` to
`tab.cards.filter((card) => this.#capable(card) && this.#visible(card))`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/till test card-grid`
Expected: PASS (tender-pay carve-out; existing B1 tests unaffected — default `capabilities: []` and no B1 card except tender-pay is gated).

- [ ] **Step 5: Prove the gate by deletion**

Temporarily change `#capable` to `return true;`. Add a synthetic-card assertion using `kds-board` will only bite after Task 5 — instead, temporarily place a `tender-pay`-exception check removal: set `if (card.type === "tender-pay") return true;` to `return this.capabilities.includes("integrated-card-payment");` and confirm the tender-pay test FAILS (capabilities `[]`). Restore both lines. Confirm green.

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/widgets/card-grid.ts apps/till/src/widgets/card-grid.test.ts
git commit -s -m "feat(till): capability-absent card gating with tender-pay cash carve-out (SP-B2.1)"
```

---

## Task 3: `till-card-grid` — permission→LOCKED gating

**Files:**
- Modify: `apps/till/src/widgets/card-grid.ts`
- Test: `apps/till/src/widgets/card-grid.test.ts`

**Interfaces:**
- Consumes: `CARD_REQUIRED_PERMISSION` (Task 1).
- Produces: `till-card-grid` gains `@property({type: Boolean}) canConfigureTill = false`. A card whose `CARD_REQUIRED_PERMISSION[type]` is `"till.configure"` and `canConfigureTill` is false renders inside a locked overlay (`.cell.locked` with `aria-disabled` + `inert`), visible but non-interactive; unlocked otherwise. (`till.configure` is the ONLY permission in the catalogue — spec §3.4.)

- [ ] **Step 1: Write the failing test**

Add to `card-grid.test.ts` (uses `table-layout-editor`, whose element arrives in Task 5; assert the LOCK wrapper, which is element-agnostic):

```ts
const editorTab: TabDef = {
  key: "floor", title: "Floor", columns: 12,
  cards: [{ type: "table-layout-editor", colSpan: 12, rowSpan: 8, config: {} }],
};

it("locks a permission-gated card when the operator lacks the permission", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: editorTab, store, canConfigureTill: false });
  const cell = el.shadowRoot!.querySelector<HTMLElement>(".cell.locked")!;
  expect(cell).not.toBeNull();
  expect(cell.hasAttribute("inert")).toBe(true);
});

it("unlocks a permission-gated card when the operator has the permission", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: editorTab, store, canConfigureTill: true });
  expect(el.shadowRoot!.querySelector(".cell.locked")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test card-grid -t "permission-gated"`
Expected: FAIL — no `.cell.locked` wrapper; `canConfigureTill` is not a property.

- [ ] **Step 3: Implement the lock**

In `card-grid.ts` add the prop and a `#locked` check; apply it in `#cell`:

```ts
@property({ type: Boolean }) canConfigureTill = false;

/** Permission→LOCKED (spec §5.2). Only `till.configure` exists in the catalogue. */
#locked(card: CardInstance): boolean {
  return CARD_REQUIRED_PERMISSION[card.type] === "till.configure" && !this.canConfigureTill;
}
```

In `#cell(card)` (`:75-84`), when `#locked(card)` add `locked` to the class list and `inert` + `aria-disabled="true"` to the cell:

```ts
#cell(card: CardInstance): TemplateResult {
  const element = this.#element(card);
  if (element === nothing) return html``;
  const locked = this.#locked(card);
  return html`<div
    class="cell ${locked ? "locked" : ""}"
    ?inert=${locked}
    aria-disabled=${locked ? "true" : nothing}
    style="grid-column: span ${card.colSpan}; grid-row: span ${card.rowSpan}"
  >${element}</div>`;
}
```

Add a `.cell.locked` style using tokens only (dim + a lock affordance), e.g. `opacity: var(--wt-disabled-opacity, 0.5)`; check `tokens/*` for an existing disabled/overlay token before inventing.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/till test card-grid`
Expected: PASS.

- [ ] **Step 5: Prove by deletion**

Change `#locked` to `return false;`; confirm the lock test FAILS; restore; green.

- [ ] **Step 6: a11y + commit**

Run: `pnpm --filter @waitron/till test card-grid.a11y` → PASS (locked cell must stay violation-free).

```bash
git add apps/till/src/widgets/card-grid.ts apps/till/src/widgets/card-grid.test.ts
git commit -s -m "feat(till): permission-locked card overlay for till.configure (SP-B2.1)"
```

---

## Task 4: `till-card-grid` — `visibleWhen` fails OPEN for uncomputable state (follow-up d)

**Files:**
- Modify: `apps/till/src/widgets/card-grid.ts` (`#visible` ~:140-145)
- Test: `apps/till/src/widgets/card-grid.test.ts`

**Interfaces:**
- Produces: a card with a `visibleWhen` gate whose `#currentState(type)` is `undefined` (the host cannot compute it — e.g. a self-fetching big card) now renders (fail OPEN) instead of being hidden. Cards the host CAN compute (`held-orders`, `prep-queue`) keep their B1 behaviour.

- [ ] **Step 1: Write the failing test**

Add to `card-grid.test.ts`:

```ts
const gatedBigCard: TabDef = {
  key: "expo", title: "Expo", columns: 12,
  cards: [{ type: "expo", colSpan: 12, rowSpan: 8, config: {}, visibleWhen: ["has-tickets"] }],
};

it("shows a big card with a visibleWhen gate the host cannot evaluate (fail open, follow-up d)", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: gatedBigCard, store });
  // expo renders `till-expo-screen` after Task 5; here assert the CELL is present (not filtered out).
  expect(el.shadowRoot!.querySelectorAll(".cell").length).toBe(1);
});
```

> **Implementer note:** before Task 5, `expo` renders `nothing`, so `.cell` count is 0 even when un-filtered. Gate this test's assertion on the FILTER, not the element: temporarily use a `held-orders` card with an UNKNOWN state name to prove fail-open independent of Task 5 — `{ type: "held-orders", …, visibleWhen: ["never-a-real-state"] }` with `heldOrders: []` computes state `"empty"`, which is NOT in the list, so it stays HIDDEN (correct — host CAN compute). The fail-OPEN path is specifically the `#currentState → undefined` branch. Assert it with a card type the host cannot compute; run this test's element assertion after Task 5.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test card-grid -t "fail open"`
Expected: FAIL — B1's `#visible` returns `false` when `#currentState` is `undefined` and a `visibleWhen` list is present, so the cell is filtered out.

- [ ] **Step 3: Implement fail-open**

In `card-grid.ts` change `#visible` (`:140-145`):

```ts
#visible(card: CardInstance): boolean {
  const states = card.visibleWhen;
  if (states === undefined || states.length === 0) return true;
  const current = this.#currentState(card.type);
  // Fail OPEN when the host cannot compute this card's state (e.g. a self-fetching big card): a card
  // the host can't evaluate must not silently vanish (SP-B2.1 follow-up d). Cards the host CAN compute
  // (held-orders, prep-queue) still hide when their state is out of the list.
  if (current === undefined) return true;
  return states.includes(current);
}
```

- [ ] **Step 4: Run to verify pass + regression**

Run: `pnpm --filter @waitron/till test card-grid`
Expected: PASS — the fail-open test, and B1's `held-orders` show/hide tests (those compute a defined state, unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/widgets/card-grid.ts apps/till/src/widgets/card-grid.test.ts
git commit -s -m "feat(till): visibleWhen fails open for uncomputable card state (SP-B2.1)"
```

---

## Task 5: `embedded` chrome seam + `till-card-grid` renders floor-plan / table-layout-editor / expo

**Files:**
- Modify: `apps/till/src/screens/till-expo-screen.ts` (render ~:503-511) + test
- Modify: `apps/till/src/screens/till-floor-screen.ts` (render ~:522-555) + test
- Modify: `apps/till/src/widgets/card-grid.ts` (`#element` ~:91-137; props)
- Test: `apps/till/src/widgets/card-grid.test.ts`

**Interfaces:**
- Consumes: `TillApi`, `FireControlMode`, `FloorZone`, `TableState` (from the same modules the counter/app import them — copy import paths verbatim).
- Produces:
  - `till-expo-screen` + `till-floor-screen` gain `@property({type: Boolean}) embedded = false`; when true they render WITHOUT their `<header class="head">` + `.back` button (floor keeps its `view-toggle`/`edit-toggle` inside).
  - `till-card-grid` gains `@property({attribute:false}) api?: TillApi`, `fireControl?: FireControlMode`, `zones: FloorZone[] = []`, `tables: TableState[] = []`. `#element()` renders `floor-plan`→`<till-floor-screen embedded>`, `table-layout-editor`→`<till-floor-screen embedded canEdit>`, `expo`→`<till-expo-screen embedded>`. `kds-board`/`table-order`/`notifications` still `nothing` (B2.2/later).

- [ ] **Step 1: Write the failing test — expo `embedded`**

Add to `apps/till/src/screens/till-expo-screen.test.ts` (mirror its existing mount helper):

```ts
it("suppresses its own header + back button when embedded", async () => {
  const { el } = await mount({ embedded: true }); // follow the file's mount(over) helper
  expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
  expect(el.shadowRoot!.querySelector(".back")).toBeNull();
});
it("renders its header + back button when standalone (default)", async () => {
  const { el } = await mount({});
  expect(el.shadowRoot!.querySelector("header.head")).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test till-expo-screen -t "embedded"`
Expected: FAIL — `embedded` is not a property; header always renders.

- [ ] **Step 3: Implement `embedded` on expo**

In `till-expo-screen.ts` add `@property({ type: Boolean }) embedded = false;` and wrap the header in `${this.embedded ? nothing : html`<header class="head">…</header>`}` (render ~:503-511). Keep the queue body unchanged.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/till test till-expo-screen`
Expected: PASS (embedded + standalone; all existing expo tests still green — default `embedded=false`).

- [ ] **Step 5: Repeat for floor (`embedded`)**

Add to `till-floor-screen.test.ts`:

```ts
it("suppresses its own header + back when embedded, keeping view/edit toggles", async () => {
  const { el } = await mount({ embedded: true, canEdit: true }); // follow floor's mount helper
  expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
  expect(el.shadowRoot!.querySelector(".back")).toBeNull();
  expect(el.shadowRoot!.querySelector(".edit-toggle")).not.toBeNull(); // functional chrome stays
});
```

Run to fail, then in `till-floor-screen.ts` add `@property({ type: Boolean }) embedded = false;`. In render (`:522-555`) suppress the `<header class="head">` when embedded — BUT move the `view-toggle`/`edit-toggle` OUT of the suppressed header into an always-rendered `.actions` bar (they are floor body function, not shell chrome). The `.back` (gated on `canExitToCounter`) is only inside the header, so it disappears when embedded. Run to pass; all standalone floor tests stay green.

> **Implementer note:** if the toggles currently live inside `header.head`, extract them into a sibling `<div class="actions">` rendered in both modes; only the `<h1 class="title">` + `.back` are header-only.

- [ ] **Step 6: Write the failing test — card-grid renders the three cards**

Add to `card-grid.test.ts`:

```ts
const floorTab: TabDef = { key: "floor", title: "Floor", columns: 12,
  cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }] };
const expoTab: TabDef = { key: "expo", title: "Expo", columns: 12,
  cards: [{ type: "expo", colSpan: 12, rowSpan: 8, config: {} }] };

it("renders an embedded floor screen for a floor-plan card", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: floorTab, store, zones: [], tables: [] });
  const floor = el.shadowRoot!.querySelector<HTMLElement & { embedded?: boolean }>("till-floor-screen")!;
  expect(floor).not.toBeNull();
  expect(floor.embedded).toBe(true);
});
it("renders an embedded expo screen for an expo card", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: expoTab, store });
  const expo = el.shadowRoot!.querySelector<HTMLElement & { embedded?: boolean }>("till-expo-screen")!;
  expect(expo?.embedded).toBe(true);
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm --filter @waitron/till test card-grid -t "embedded floor|embedded expo"`
Expected: FAIL — `floor-plan`/`expo` return `nothing` today.

- [ ] **Step 8: Implement the three card cases**

In `card-grid.ts`: add the side-effect imports `import "../screens/till-floor-screen.js";` and `import "../screens/till-expo-screen.js";`; add the data props (`api`, `fireControl`, `zones`, `tables`) copying the exact types from `till-app.ts`'s imports. Replace the `nothing` arms for `floor-plan`/`table-layout-editor`/`expo`:

```ts
case "floor-plan":
  return html`<till-floor-screen embedded .zones=${this.zones} .tables=${this.tables}
    .api=${this.api} .canExitToCounter=${false}></till-floor-screen>`;
case "table-layout-editor":
  return html`<till-floor-screen embedded canEdit .zones=${this.zones} .tables=${this.tables}
    .api=${this.api} .canExitToCounter=${false}></till-floor-screen>`;
case "expo":
  return html`<till-expo-screen embedded .api=${this.api} .fireControl=${this.fireControl}></till-expo-screen>`;
```

Leave `kds-board`, `table-order`, `notifications` returning `nothing` (B2.2/later).

- [ ] **Step 9: Run to verify pass — incl. the deferred gating tests**

Run: `pnpm --filter @waitron/till test card-grid`
Expected: PASS — the two card-render tests; the Task 2 `kds-board` capability tests still assert against `till-station-screen` which is `nothing` (kds-board absent both ways) — so keep those `kds-board` capability tests as **synthetic** using `expo` instead (expo has no required capability; to test capability-absent visibly, keep the Task 2 mechanism test as the `tender-pay` carve-out only, and add a capability test in B2.2 when `kds-board` renders). Confirm the Task 4 fail-open element assertion now sees `.cell` count 1 for the gated `expo` tab.

> **Implementer note:** revisit the Task 2 note — since no B2.1-rendered card carries a required capability except the always-render `tender-pay`, the capability-SKIP is first observable in B2.2 (`kds-board`). B2.1 ships and unit-tests the mechanism (the `#capable` filter + carve-out) and proves it by deletion (Task 2 Step 5); the visible skip test lands with `kds-board` in B2.2. Update the Task 2 `kds-board` tests to `it.skip(... "covered in B2.2")` or remove them, keeping the `tender-pay` carve-out test.

- [ ] **Step 10: Full till suite + coverage + commit**

Run: `pnpm --filter @waitron/till test:coverage` → PASS at `95/95/90/88`.

```bash
git add apps/till/src/screens/till-expo-screen.ts apps/till/src/screens/till-expo-screen.test.ts \
  apps/till/src/screens/till-floor-screen.ts apps/till/src/screens/till-floor-screen.test.ts \
  apps/till/src/widgets/card-grid.ts apps/till/src/widgets/card-grid.test.ts
git commit -s -m "feat(till): embedded chrome seam + card-grid renders floor/expo cards (SP-B2.1)"
```

---

## Task 6: `till-tab-shell` presentational component

**Files:**
- Create: `apps/till/src/widgets/tab-shell.ts`
- Test: `apps/till/src/widgets/tab-shell.test.ts`, `apps/till/src/widgets/tab-shell.a11y.test.ts`

**Interfaces:**
- Consumes: `TabDef` (`../layout.js`); `till-language-chooser` (side-effect import; copy the path from `till-counter-screen.ts`).
- Produces: `<till-tab-shell>` with props `tabs: TabDef[] = []`, `activeTabKey?: string`, `operatorName = ""`, `affordances: ShellAffordance[] = []` (where `type ShellAffordance = "station" | "expo" | "schedule"`), `loadLocales?: () => Promise<string[]>`. Named slots: default (active-tab body) and `drill` (optional drill-in overlay that covers the body when populated). Emits composed events: `tab-select` `{key: string}`, `show-station`, `show-expo`, `show-schedule`, `open-allergens`, `logout`, and re-emits the chooser's `locale-selected`. Renders a tab bar (one button per `tabs` entry, `aria-selected` on the active), the header chrome (brand, affordance buttons, operator name, language chooser, logout), and the body slot; when the `drill` slot has assigned nodes, the body is `inert` and the drill overlay shows.

- [ ] **Step 1: Write the failing test — tab bar + selection event**

Create `apps/till/src/widgets/tab-shell.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import type { TabDef } from "../layout.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { TillTabShell } from "./tab-shell.js";

afterEach(cleanupWidgets);

const tabs: TabDef[] = [
  { key: "counter", title: "Counter", columns: 12, cards: [] },
  { key: "floor", title: "Floor", columns: 12, cards: [] },
];

it("renders one tab button per profile tab and marks the active one", async () => {
  const { el } = await mountWidget<TillTabShell>("till-tab-shell", { tabs, activeTabKey: "floor" });
  const buttons = el.shadowRoot!.querySelectorAll<HTMLElement>(".tab");
  expect(buttons.length).toBe(2);
  const active = el.shadowRoot!.querySelector<HTMLElement>('.tab[aria-selected="true"]')!;
  expect(active.textContent).toContain("Floor");
});

it("emits tab-select when a tab is tapped", async () => {
  const { el } = await mountWidget<TillTabShell>("till-tab-shell", { tabs, activeTabKey: "counter" });
  let key: string | undefined;
  el.addEventListener("tab-select", (e) => (key = (e as CustomEvent<{ key: string }>).detail.key));
  el.shadowRoot!.querySelectorAll<HTMLElement>(".tab")[1]!.click();
  expect(key).toBe("floor");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test tab-shell`
Expected: FAIL — `tab-shell.js` / `till-tab-shell` does not exist.

- [ ] **Step 3: Implement `till-tab-shell`**

Create `apps/till/src/widgets/tab-shell.ts` — a presentational shell (tokens only, no data logic):

```ts
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, queryAssignedElements } from "lit/decorators.js";
import "./language-chooser.js"; // copy the real path from till-counter-screen.ts
import type { TabDef } from "../layout.js";

export type ShellAffordance = "station" | "expo" | "schedule";

/**
 * SP-B2.1 tab shell: renders the tab bar (from profile.tabs), the operator header chrome relocated off
 * the counter screen, and slots for the active-tab body (default slot) + a drill-in overlay (`drill`).
 * Dumb + presentational — `till-app` owns data, active-tab state, and the drill-in stack; the shell
 * only emits intent. Tokens only.
 */
@customElement("till-tab-shell")
export class TillTabShell extends LitElement {
  static styles = css` /* tab bar + header + body; --wt-* tokens only */ `;

  @property({ attribute: false }) tabs: TabDef[] = [];
  @property() activeTabKey?: string;
  @property() operatorName = "";
  @property({ attribute: false }) affordances: ShellAffordance[] = [];
  @property({ attribute: false }) loadLocales?: () => Promise<string[]>;
  @queryAssignedElements({ slot: "drill" }) private drillNodes!: HTMLElement[];

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  render(): TemplateResult {
    const hasDrill = this.drillNodes?.length > 0;
    return html`
      <header class="shell-head">
        <nav class="tabs" role="tablist">
          ${this.tabs.map((t) => html`<button class="tab" role="tab"
            aria-selected=${t.key === this.activeTabKey ? "true" : "false"}
            @click=${() => this.#emit("tab-select", { key: t.key })}>${t.title}</button>`)}
        </nav>
        <div class="session">
          ${this.affordances.includes("station") ? html`<wt-button class="station" variant="secondary"
            @click=${() => this.#emit("show-station")}>Station</wt-button>` : nothing}
          ${this.affordances.includes("expo") ? html`<wt-button class="expo" variant="secondary"
            @click=${() => this.#emit("show-expo")}>Expo</wt-button>` : nothing}
          ${this.affordances.includes("schedule") ? html`<wt-button class="schedule" variant="secondary"
            @click=${() => this.#emit("show-schedule")}>Schedule</wt-button>` : nothing}
          <wt-button class="allergens" variant="secondary"
            @click=${() => this.#emit("open-allergens")}>Allergens</wt-button>
          <span class="operator">${this.operatorName}</span>
          <till-language-chooser .loadLocales=${this.loadLocales}
            @locale-selected=${(e: Event) => { e.stopPropagation(); this.#emit("locale-selected",
              (e as CustomEvent).detail); }}></till-language-chooser>
          <wt-button class="logout" variant="secondary"
            @click=${() => this.#emit("logout")}>Logout</wt-button>
        </div>
      </header>
      <main class="body" ?inert=${hasDrill}><slot @slotchange=${() => this.requestUpdate()}></slot></main>
      <div class="drill" ?hidden=${!hasDrill}>
        <slot name="drill" @slotchange=${() => this.requestUpdate()}></slot>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "till-tab-shell": TillTabShell; }
}
```

> **Implementer note:** use `t()` for the button copy (not literal "Station"/"Floor"), matching the counter screen's `t("floor")` etc. — reuse the SAME i18n keys the counter header used so no new copy is coined. Fill the `static styles` with tokenised tab-bar + header CSS (grep `till-counter-screen.ts`'s `.header`/`.session` styles and adapt). Add `wt-button` side-effect import (copy path from the counter screen).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/till test tab-shell`
Expected: PASS.

- [ ] **Step 5: Write the failing test — affordance + drill-in behaviour**

Add:

```ts
it("emits show-station only when the station affordance is present", async () => {
  const { el } = await mountWidget<TillTabShell>("till-tab-shell", { tabs, activeTabKey: "counter", affordances: ["station"] });
  let fired = false;
  el.addEventListener("show-station", () => (fired = true));
  el.shadowRoot!.querySelector<HTMLElement>(".station")!.click();
  expect(fired).toBe(true);
});

it("makes the body inert while a drill-in is slotted", async () => {
  const { el } = await mountWidget<TillTabShell>("till-tab-shell", { tabs, activeTabKey: "counter" });
  const drill = document.createElement("div");
  drill.slot = "drill";
  el.appendChild(drill);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLElement>("main.body")!.hasAttribute("inert")).toBe(true);
});
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @waitron/till test tab-shell` → PASS (implement any small gaps — e.g. `slotchange` re-render — until green).

- [ ] **Step 7: a11y test**

Create `apps/till/src/widgets/tab-shell.a11y.test.ts` mirroring a sibling `*.a11y.test.ts` (`expectNoA11yViolations`), mounting `till-tab-shell` with `tabs` + `affordances`. Run: `pnpm --filter @waitron/till test tab-shell.a11y` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/till/src/widgets/tab-shell.ts apps/till/src/widgets/tab-shell.test.ts apps/till/src/widgets/tab-shell.a11y.test.ts
git commit -s -m "feat(till): add till-tab-shell chrome + tab bar component (SP-B2.1)"
```

---

## Task 7: `till-app` shell integration — render the shell when a profile is present

**Files:**
- Modify: `apps/till/src/screens/till-counter-screen.ts` (header ~:383-411) + test
- Modify: `apps/till/src/till-app.ts` (`render()` ~:1889-1902; `#renderScreen` ~:1908-1997; state ~:206) + test

**Interfaces:**
- Consumes: `<till-tab-shell>` (Task 6), `till-card-grid` gating/data props (Tasks 2-5), `till-counter-screen` `embedded` (below).
- Produces: `till-counter-screen` gains `@property({type: Boolean}) embedded = false` suppressing its header (chrome moved to the shell). `till-app` renders `<till-tab-shell>` when `this.profile !== undefined` (active tab body = the per-tab element; affordances derived from tabs), and the legacy `#renderScreen` switch otherwise. New state: `@state() private activeTabKey?: string`.

- [ ] **Step 1: Counter screen `embedded` — failing test**

Add to `till-counter-screen.test.ts`:

```ts
it("suppresses its own header when embedded (chrome lives in the shell)", async () => {
  const { el } = await mount({ embedded: true });
  expect(el.shadowRoot!.querySelector(".header")).toBeNull();
});
```

Run to fail; then in `till-counter-screen.ts` add `@property({ type: Boolean }) embedded = false;` and wrap the `<div class="header">` (`:383-411`) in `${this.embedded ? nothing : html`…`}`. Keep the body (menu controls + grid/region) unchanged. Run to pass; existing counter tests green (default `embedded=false`).

- [ ] **Step 2: Commit the counter change**

```bash
git add apps/till/src/screens/till-counter-screen.ts apps/till/src/screens/till-counter-screen.test.ts
git commit -s -m "feat(till): counter screen header suppressible when embedded in the shell (SP-B2.1)"
```

- [ ] **Step 3: Write the failing test — app renders the shell from a profile**

In `till-app.test.ts` (reuse the stub-`TillApi` + boot/login sequence from B1's counter-tab test), add a test whose profile has `counter` + `floor` tabs, drive boot + login, and assert the shell renders with the counter body:

```ts
it("renders the tab shell with the counter tab active when a profile is present", async () => {
  // stub getTill() → TillInfo with profile { formFactor:"till", capabilities:[],
  //   tabs:[{key:"counter",...},{key:"floor",...cards:[{type:"floor-plan",...}]}] }
  // after boot + login to the operator surface:
  const shell = el.shadowRoot!.querySelector<HTMLElement & { activeTabKey?: string }>("till-tab-shell")!;
  expect(shell).not.toBeNull();
  expect(shell.activeTabKey).toBe("counter");
  expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
});

it("switches the active tab body on tab-select", async () => {
  // ...same setup, then:
  el.shadowRoot!.querySelector("till-tab-shell")!
    .dispatchEvent(new CustomEvent("tab-select", { detail: { key: "floor" }, bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull(); // floor tab → card-grid (floor-plan)
  expect(el.shadowRoot!.querySelector("till-counter-screen")).toBeNull();
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @waitron/till test till-app -t "tab shell"`
Expected: FAIL — no `till-tab-shell`; app still renders the `screen`-enum.

- [ ] **Step 5: Implement the shell branch**

In `till-app.ts`:
- Add `import "./widgets/tab-shell.js";` and `import type { ShellAffordance } from "./widgets/tab-shell.js";`. `till-card-grid` is already imported transitively; add `import "./widgets/card-grid.js";` if not.
- Add state near `screen` (`:206`): `@state() private activeTabKey?: string;`.
- In `#boot()` after `this.profile = till.profile;` (`:562`) set the initial active tab: `this.activeTabKey = till.profile?.tabs[0]?.key;`.
- Add helpers:

```ts
#activeTab(): TabDef | undefined {
  return this.profile?.tabs.find((t) => t.key === this.activeTabKey) ?? this.profile?.tabs[0];
}
/** Affordances = surfaces reachable today that are NOT authored as a tab (spec §4.2/§4.3). */
#affordances(): ShellAffordance[] {
  const tabKeys = new Set(this.profile?.tabs.map((t) => t.key) ?? []);
  return (["station", "expo", "schedule"] as ShellAffordance[]).filter((a) => !tabKeys.has(a));
}
#tabBody(tab: TabDef): TemplateResult {
  if (tab.key === "counter") {
    return html`<till-counter-screen embedded .api=${this.api} .store=${this.store}
      .products=${this.products} .menus=${this.menus} .selectedMenuId=${this.selectedMenuId}
      .heldOrders=${this.heldOrders} .stationQueue=${this.stationQueue} .defaultStationId=${this.defaultStationId}
      .operatorName=${this.operatorName} .invoiceLocale=${this.invoiceLocale} .orderFlow=${this.orderFlow}
      .stage=${this.stage} .busy=${this.submitting || this.placing} .counterTab=${tab}
      .cardProvider=${this.cardProvider} .tipsEnabled=${this.tipsEnabled} .cardOutcome=${this.cardOutcome}
    ></till-counter-screen>`;
  }
  return html`<till-card-grid .tab=${tab} .store=${this.store} .capabilities=${this.profile?.capabilities ?? []}
    .canConfigureTill=${this.canEdit} .products=${this.products} .heldOrders=${this.heldOrders}
    .stationQueue=${this.stationQueue} .defaultStationId=${this.defaultStationId} .busy=${this.submitting}
    .orderFlow=${this.orderFlow} .stage=${this.stage} .cardProvider=${this.cardProvider}
    .tipsEnabled=${this.tipsEnabled} .cardOutcome=${this.cardOutcome}
    .api=${this.api} .fireControl=${this.fireControl} .zones=${this.zones} .tables=${this.tables}
  ></till-card-grid>`;
}
```

(Copy the exact counter-screen prop list from `#renderScreen`'s `counter` case, `:1918-1938`; confirm `this.zones`/`this.tables` field names against the `show-floor` loader.)

- In `render()`, before the `keyed(currentLocale(), this.#renderScreen())` line (`:1902`), branch: when `this.profile !== undefined` and the operator is past `lock` (not enrolling), render the shell instead of the screen switch:

```ts
${this.profile !== undefined && this.#shellActive()
  ? keyed(currentLocale(), html`<till-tab-shell
      .tabs=${this.profile.tabs} .activeTabKey=${this.activeTabKey}
      .operatorName=${this.operatorName} .affordances=${this.#affordances()}
      .loadLocales=${this.#loadLocales}
      @tab-select=${(e: CustomEvent<{ key: string }>) => { this.activeTabKey = e.detail.key; }}
    >${this.#activeTab() ? this.#tabBody(this.#activeTab()!) : nothing}
      ${this.#drillBody() /* Task 8 */}
    </till-tab-shell>`)
  : keyed(currentLocale(), this.#renderScreen())}
```

Add `#shellActive()` returning true only for the authenticated operator surface (mirror the screen states the shell replaces: not `lock`, not enrolling, not `kds_station` device-mode which stays on the station screen for now). Keep the enrol overlays + override dialog code paths (`:1877-1898`) exactly as-is, above this branch. `#drillBody()` returns `nothing` until Task 8. The affordance/tab events (`show-station`/`show-expo`/`show-schedule`/`logout`/`open-allergens`/`locale-selected`) are ALREADY wired on the outer `<div class="app">` (`:1826-1872`) — the shell's composed events bubble to those existing handlers unchanged. Verify each still lands (`show-station`→`#onShowStation`, etc.).

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @waitron/till test till-app`
Expected: PASS — the shell renders; tab-select switches the body; the legacy-path tests (stubs returning no `profile`) still render the `screen`-enum.

- [ ] **Step 7: Full till suite + coverage + commit**

Run: `pnpm --filter @waitron/till test:coverage` → PASS.

```bash
git add apps/till/src/till-app.ts apps/till/src/till-app.test.ts
git commit -s -m "feat(till): render the profile tab shell (legacy screen-enum fallback kept) (SP-B2.1)"
```

---

## Task 8: `till-app` drill-in stack + sale-path & reconciliation guards

**Files:**
- Modify: `apps/till/src/till-app.ts` (nav handlers ~:744-1740; render drill slot)
- Test: `apps/till/src/till-app.test.ts`

**Interfaces:**
- Produces: `@state() private drill?: { kind: "table-order" | "ticket" | "schedule" | "station" | "expo" }` (context fields as needed). `#drillBody()` renders the drill-in element (chrome-suppressed) into the shell's `drill` slot; nav events push/pop `drill` instead of `#setScreen` when the shell is active. Every legacy transition preserved.

- [ ] **Step 1: Write the failing test — open-table pushes a drill-in over the shell**

In `till-app.test.ts` (profile present, on the `floor` tab), fire `open-table` and assert the table-order drill-in mounts over the shell (still B2.1: table-order is not yet chrome-wrapped, so it mounts as the standalone screen in the `drill` slot — B2.2 wraps it):

```ts
it("pushes the table-order drill-in when a table is opened from the floor tab", async () => {
  // setup: profile present, activeTabKey "floor", stub loadTabLines etc. per existing open-table test
  el.shadowRoot!.querySelector("till-tab-shell")!.dispatchEvent(
    new CustomEvent("open-table", { detail: { tableId: "t1", hasOpenTab: false }, bubbles: true, composed: true }));
  await /* the app's async tab-line load */ el.updateComplete;
  const drill = el.shadowRoot!.querySelector('[slot="drill"]');
  expect(drill).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-table-order-screen")).not.toBeNull();
});

it("pops the drill-in back to the underlying tab on back-to-floor", async () => {
  // ...after the push above:
  el.shadowRoot!.querySelector("till-table-order-screen")!.dispatchEvent(
    new CustomEvent("back-to-floor", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[slot="drill"]')).toBeNull();
  expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull(); // back on the floor tab
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test till-app -t "drill-in"`
Expected: FAIL — `open-table` still calls `#setScreen("table-order")`; no `drill` slot content.

- [ ] **Step 3: Implement the drill-in stack**

In `till-app.ts`:
- Add `@state() private drill?: { kind: "table-order" | "ticket" | "schedule" | "station" | "expo" };`.
- Add `#pushDrill(kind)` / `#popDrill()` that set/clear `this.drill` AND record the `diag` nav trail (preserve today's `#setScreen` diagnostics).
- **Route each nav handler through the drill stack WHEN the shell is active** (`this.profile !== undefined`), else keep `#setScreen` (legacy path). Modify:
  - `#onOpenTable` (`:1414-1432`): after loading tab lines, `this.#pushDrill({ kind: "table-order" })` instead of `#setScreen("table-order")`.
  - `#onShowFloor` used as `back-to-floor` (`:1867`→`:1368`): when a drill is open, `#popDrill()` (return to the floor tab) rather than `#setScreen("floor")`; when reached as the Floor affordance/tab, set `activeTabKey`.
  - `#onBackToCounter` (`:1737-1740`): `#popDrill()` + `this.activeTabKey = "counter"`.
  - `#onShowSchedule` (`:1354-1357`): `#pushDrill({ kind: "schedule" })`.
  - `#onShowStation`/`#onShowExpo` (`:1025-1028`/`:1103-1106`): `#pushDrill({ kind: "station" | "expo" })`.
  - payment success (`#onConfirmPayment` `:744`, `#onCollectCard` `:810`, `#onCollectOrder` `:964`, `#onPayTab` `:1679`): `#pushDrill({ kind: "ticket" })` instead of `#setScreen("ticket")`.
  - `#onNewSale` (`:1343-1350`): `#popDrill()` + `this.activeTabKey = "counter"` + clear basket.
- Implement `#drillBody()`: `switch (this.drill?.kind)` mounting the SAME elements the `#renderScreen` arms mount, with `slot="drill"` and (for wrapped screens) `embedded`. Reuse the exact prop wiring from the matching `#renderScreen` case:

```ts
#drillBody(): TemplateResult | typeof nothing {
  switch (this.drill?.kind) {
    case "table-order": return html`<till-table-order-screen slot="drill" .lines=${this.#tabLines()} … .canSettle=${true}></till-table-order-screen>`;
    case "ticket": return html`<till-ticket-view slot="drill" .result=${this.result} .issuer=${this.issuer} .invoiceLocale=${this.invoiceLocale} .receipt=${this.receipt}></till-ticket-view>`;
    case "schedule": return html`<till-schedule-screen slot="drill" .api=${this.api} .staff=${this.staff} .operatorPersonId=${this.operatorPersonId}></till-schedule-screen>`;
    case "station": return html`<till-station-screen slot="drill" .api=${this.api} .bumpMode=${this.bumpMode} .fireControl=${this.fireControl}></till-station-screen>`;
    case "expo": return html`<till-expo-screen slot="drill" embedded .api=${this.api} .fireControl=${this.fireControl}></till-expo-screen>`;
    case undefined: return nothing;
  }
}
```

(Copy each case's exact prop list from the corresponding `#renderScreen` arm, §map §1b. `station`/`table-order` keep their own chrome in B2.1 — they are wrapped in B2.2 — so they mount WITHOUT `embedded` here; expo mounts `embedded` since Task 5 wrapped it. Their own `back-*` events already trigger the pop handlers above.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/till test till-app`
Expected: PASS — drill push/pop; legacy path tests (no profile) still use `#setScreen`.

- [ ] **Step 5: Write the failing test — sale path through the shell (follow-up b)**

Add an app-level sale test that drives the counter through the shell + grid: place items into the store, tender, and assert the ticket drill-in appears (proves the nav rewrite did not break the sale path):

```ts
it("completes a sale through the shell + grid and lands on the ticket drill-in (sale-path guard)", async () => {
  // profile present, counter tab active. Follow this file's existing prepay-sale test:
  // add product(s) to the store, trigger the tender-pay confirm-payment path, resolve the stub sale.
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-ticket-view")).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[slot="drill"]')).not.toBeNull();
});
```

> **Implementer note:** copy the existing counter-sale test body in this file (the one exercising `confirm-payment` → ticket); the only change is that the counter now renders inside `till-tab-shell` and the ticket appears as a drill-in rather than a `screen`. Keep the original (legacy-path) sale test too — it guards the fallback.

- [ ] **Step 6: Run + a reconciliation guard (follow-up c)**

Run to pass. Then add follow-up (c)'s reconciliation note as a test + comment: a card the client SHOWS but the server would refuse (capability mismatch on a fallback device) fails closed at the API. Since B2.1 has no server call newly reachable via a gated card, assert the direction with a comment at the gating seam in `card-grid.ts` (`#capable`) — "client gate is advisory; server `assertDeviceCapability` is authoritative (SP-B2.1 follow-up c)" — and a unit test that `#capable` never *widens* access (a card with a required capability absent is skipped; no path shows it). Prove by deletion (Task 2 Step 5 already does).

- [ ] **Step 7: Full till suite + coverage + commit**

Run: `pnpm --filter @waitron/till test:coverage` → PASS at `95/95/90/88`.

```bash
git add apps/till/src/till-app.ts apps/till/src/till-app.test.ts apps/till/src/widgets/card-grid.ts
git commit -s -m "feat(till): drill-in stack replaces screen-enum nav; sale-path guard (SP-B2.1)"
```

---

## Final verification (before PR)

- [ ] **Whole-workspace gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] **Scoped coverage:** `pnpm --filter @waitron/till test:coverage` (95/95/90/88).
- [ ] **Cheap fiscal guard (non-fiscal slice, no schema change):** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` stays green.
- [ ] **No-flow-lost audit:** every `screen`-enum transition (§map §1c) has a shell/drill equivalent test; the legacy `screen`-enum path still renders when no profile is present (fallback intact until B4).
- [ ] **Sale-path guard:** the shell+grid sale test (Task 8 Step 5) is green, and `tender-pay` renders with `capabilities: []` (Task 2).
- [ ] **Manual smoke (optional):** `pnpm dev:setup && pnpm dev`; open the till (PIN 5555): the counter renders inside the tab shell; the Floor tab shows the wrapped floor-plan; Station/Expo/Schedule affordances push drill-ins; a sale reaches the ticket.

---

## Self-Review notes (author)

- **Spec coverage:** §4.1 tab shell (Task 6+7), §4.2 chrome relocation (Task 6+7), §4.3 reachability via affordances (Task 7 `#affordances`), §4.4 drill-in stack + handheld faces from tabs (Task 8), §5.1 capability→absent + tender-pay carve-out (Task 2), §5.2 permission→locked (Task 3), §5.3 visibleWhen fail-open (Task 4), §6 wrap expo+floor (Task 5). Follow-ups: (a) Tasks 2-3, (b) Task 8 Step 5, (c) Task 8 Step 6, (d) Task 4.
- **Deferred to B2.2 (own plan):** wrapping `station` (kds-board) + `table-order` as embedded cards; the first *visible* capability-skip (`kds-board`); their `visibleWhen` states. B2.1 mounts them as drill-ins WITH their own chrome, so no flow is lost meanwhile.
- **Sale-path invariant:** `tender-pay` always renders (Task 2); the counter body is unchanged (B1 grid), only its header relocates (Task 7); Task 8's sale test guards the rewrite; the legacy `screen`-enum path stays as fallback.
- **Type consistency:** `embedded` (Tasks 5, 7) is one boolean prop across expo/floor/counter; `capabilities`/`canConfigureTill`/`api`/`fireControl`/`zones`/`tables` on `till-card-grid` (Tasks 2,3,5) are threaded unchanged in Task 7's `#tabBody`; `ShellAffordance` (Task 6) is used in Task 7's `#affordances`; `drill.kind` union (Task 8) matches the `#drillBody` switch.
- **Known implementer lookups (flagged inline):** exact import paths for `TillApi`/`FireControlMode`/`FloorZone`/`TableState`/`till-language-chooser`/`wt-button` (copy from `till-counter-screen.ts`/`till-app.ts`); the field names `this.zones`/`this.tables` (verify against `#onShowFloor`'s loader); the counter-screen prop list (copy from `#renderScreen`'s `counter` arm); the stub-`TillApi` + sale test body (copy from `till-app.test.ts`).
- **Risk note:** Task 7 (shell branch) and Task 8 (nav rewrite) are the schedule risk. Both keep the legacy path as a live fallback, so a bug in the shell path does not break an unprofiled boot; each `screen` transition is individually test-pinned to its drill/tab equivalent.
