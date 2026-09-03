# SP-B2.2 — Wrap the two heavy screens (station + table-order) + re-enable the handheld/kds shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish SP-B2 by wrapping the two **heavy** bespoke screens — **station** (`kds-board`, carrying the device-mode/enrol paths) and **table-order** (the largest prop + event surface) — as embedded full-span cards, so the two device classes B2.1 left on the legacy `screen`-enum (**waiter handhelds** and **kds displays**) render their primary card and can move onto the profile tab shell. Land the first **reachable** `kds-board` capability→ABSENT skip (un-skip the two `it.skip` tests in `card-grid.test.ts`) and prove it by deletion.

**Architecture (grounded on the post-B2.1 tree):** B2.1 built the whole machine — `till-tab-shell`, the drill-in stack, the three card-grid gating axes, the `embedded` chrome seam, and the `#shellActive()`/`#tabBody`/`#drillBody` plumbing — and wrapped the two *self-contained* screens (expo, floor-plan). It deliberately fenced handheld + kds off the shell (`#shellActive()` returns false for `handheldMode`/`deviceMode`) **only because their primary card rendered `nothing`**. B2.2 removes that fence by:

1. **Two more `embedded` seams** — `till-station-screen` and `till-table-order-screen` gain the same `embedded` boolean expo/floor already carry (suppress their own `<header class="head">` + Back, keep body-function toggles).
2. **Two more card-grid `#element` arms** — `kds-board` → `<till-station-screen embedded …>`, `table-order` → `<till-table-order-screen embedded …>`, with the device-mode / table-order props threaded through the grid (the same shape B2.1 used to thread expo/floor props). Only `notifications` stays `nothing` after this.
3. **Shell re-enabled for handheld + kds**, with the two owner-decided chrome shapes (2026-09-04):
   - **Handheld = full shell header** (operator name + Logout + language chooser) but **no** Station/Expo/Schedule affordances (a handheld can't reach those today — reachability preserved). Its `order` tab mounts `table-order` **as a card** (SP-B §5's second mount point); `open-table` from the floor tab **switches to the order tab**, not a drill-in.
   - **KDS = kiosk mode** — a new `kiosk` flag on the shell suppresses the *entire* operator header (tab bar + session chrome), rendering only the wrapped `kds-board` card body. Preserves today's bare kitchen-display chrome; the device-mode enrol view still shows inside the card.

The legacy `screen`-enum path stays a live fallback for an **unprofiled** boot (a fresh, un-enrolled device that `getTill` returns no profile for — including a fresh kds display reaching enrol). Removal of the legacy path is **B4**, not here.

**Tech Stack:** TypeScript, Lit (custom elements, shadow DOM), Vitest browser-mode (`apps/till`, headless Chromium), `@waitron/ui` `--wt-*` tokens.

**Spec:** [`docs/superpowers/specs/2026-09-03-sp-b2-till-tab-shell-and-card-wrap-design.md`](../specs/2026-09-03-sp-b2-till-tab-shell-and-card-wrap-design.md) (SP-B2 — §7 is B2.2). Parent: [`2026-09-03-sp-b-grid-editor-and-rendering-design.md`](../specs/2026-09-03-sp-b-grid-editor-and-rendering-design.md). B2.1 plan (landed #206): [`2026-09-03-sp-b2-1-tab-shell-and-light-card-wrap.md`](2026-09-03-sp-b2-1-tab-shell-and-light-card-wrap.md).

## Global Constraints

- **Bundle rule:** `apps/till` MUST NOT import `@waitron/layouts`. The local `ProfileDef`/`TabDef`/`CardInstance`/`CardType`/`CapabilityFlag` mirror (`apps/till/src/layout.ts`) is the only model. `CARD_REQUIRED_CAPABILITY` already carries `kds-board → "act-as-kds"` (B2.1 Task 1) — no mirror change needed.
- **Sale path never blocked (fiscal §5, spec §9):** unchanged from B2.1 — the counter always renders product-grid/basket/total/tender-pay; `tender-pay` always renders. B2.2 touches neither the counter tab nor `tender-pay`. **`table-order` embeds an internal `tender-pay`** for tab settlement; its `canSettle` seam and the `pay-tab` → app path are unchanged. No sale-recording / chain / migration / DB change (not H2 / not fiscal).
- **No flow lost:** every legacy `screen` transition keeps a shell/tab/drill equivalent. **Keep every existing behavioural assertion** on both wrapped screens — re-point mounts, do not rewrite assertions (CLAUDE.md §4). A handheld reaches only what it reaches today (floor + table-order); a kds display shows only its board.
- **Two mount points per heavy screen (SP-B §5), and `embedded` is the only difference:**
  - `kds-board`: **card** in the kds `kitchen` tab → `embedded` (kiosk owns chrome). `station` reached as a **till affordance drill-in** stays **NON-embedded** (`#drillBody`, unchanged — the drill keeps its own Back).
  - `table-order`: **card** in a handheld `order` tab → `embedded` (tab bar owns chrome). `table-order` reached as a **till open-table drill-in** stays **NON-embedded** (`#drillBody`, unchanged).
- **No hardcoded chrome:** every new style uses `--wt-*` tokens only.
- **Error codes** name the domain concept; reuse `station.*`/`table.*`/`device.*`; grep siblings before coining; every throwing file imports its registry. (B2.2 coins none — it relocates chrome, adds no new throw.)
- **Coverage thresholds:** `apps/till` is `95/95/90/88`. Run `pnpm --filter @waitron/till test:coverage`. Browser-mode is memory-heavy — do NOT run `apps/till`/`apps/ui`/`apps/dashboard` `test:coverage` concurrently (memory note).
- **Every commit `-s`.** TDD: failing test first, watch it fail, minimal implementation, watch it pass, commit.

---

## File Structure

- **Modify** `apps/till/src/screens/till-station-screen.ts` + `.test.ts` — add `embedded` prop; suppress the `#renderQueueSurface` header (title + Back) and the `#renderEnrol` header when embedded, keeping the board/rail `view-toggle` in an always-present `.actions` bar (body function, like floor's toggles).
- **Modify** `apps/till/src/screens/till-table-order-screen.ts` + `.test.ts` — add `embedded` prop; suppress the `<header class="head">` (title + `.back`) when embedded, keeping the `.drawer-handle` (pending badge) in an always-present `.actions` bar (body function).
- **Modify** `apps/till/src/widgets/card-grid.ts` + `.test.ts` — render the `kds-board` and `table-order` arms; add the props each needs (`bumpMode`/`deviceMode`/`initialDeviceStation` for station; `menus`/`selectedMenuId`/`statuses`/`courses`/`tabLines`/`orderId` for table-order); un-skip + de-`nothing` the two capability tests; drop kds-board/table-order from the "still skips" test; decide `kds-board` `#currentState` (fail-open, mirroring expo).
- **Modify** `apps/till/src/widgets/tab-shell.ts` + `.test.ts` (+ `.a11y.test.ts`) — add a `kiosk` boolean that suppresses the whole `<header>` (tab bar + session chrome), rendering only the body slot.
- **Modify** `apps/till/src/till-app.ts` + `.test.ts` — thread the station + table-order props through `#tabBody`; drop the `!deviceMode && !handheldMode` fence in `#shellActive()`; return `[]` from `#affordances()` for a handheld (and recompute `#affordanceList` on `handheldMode` change); pass `.kiosk=${this.deviceMode}` to the shell; route `open-table`/`back-to-floor` to the handheld `order`/`floor` tabs when the profile authors a `table-order` tab; land a handheld/kds on its profile's first tab.

**Guiding grep before you start:** re-read the B2.1 `#tabBody`/`#drillBody`/`#shellActive`/`#affordances`/`#onOpenTable`/`#onBackToFloor` (`till-app.ts:2086-2244`, `:1553-1611`, `:1954-1980`) — every arm you extend already exists; B2.2 fills the two `nothing` gaps and unfences two device classes, it does not rebuild the machine.

---

## Task 1: `till-station-screen` — `embedded` chrome seam

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (`#renderQueueSurface` `:482-526`; `#renderEnrol` `:530-560`; styles `:55-125`)
- Test: `apps/till/src/screens/till-station-screen.test.ts`

**Interfaces:**
- Produces: `till-station-screen` gains `@property({ type: Boolean }) embedded = false`. When `true`: the `#renderQueueSurface` `<header class="head">` (title + Back) is dropped and the board/rail **`view-toggle` moves into an always-present `.actions` bar** (it is body function — the kitchen still needs to flip lens inside a card, mirroring floor's `view-toggle`/`edit-toggle` extraction, `till-floor-screen.ts:549-570`); the `#renderEnrol` `<header class="head">` is dropped too (spec §7). Default `false` keeps the standalone screen byte-identical — every existing station test stays green.

- [ ] **Step 1: Write the failing test — embedded suppresses header + Back, keeps the view-toggle**

Add to `till-station-screen.test.ts` (reuse `stubApi`/`mountWidget`/`flush`):

```ts
it("suppresses its own header + Back when embedded, keeping the view toggle", async () => {
  const api = stubApi();
  const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api, embedded: true });
  await flush(el);
  expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-back]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-view-toggle]")).not.toBeNull(); // body function stays
});
it("renders its header when standalone (default)", async () => {
  const api = stubApi();
  const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
  await flush(el);
  expect(el.shadowRoot!.querySelector("header.head")).not.toBeNull();
});
it("suppresses the enrol header when embedded (device 401 → enrol view)", async () => {
  // deviceMode + a rejecting getDeviceStation drives #loadDevice to the enrol view.
  const api = stubApi({ getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }) });
  const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
    api, deviceMode: true, embedded: true,
  });
  await flush(el);
  expect(el.shadowRoot!.querySelector("[data-enrol-submit]")).not.toBeNull(); // enrol view shown
  expect(el.shadowRoot!.querySelector("header.head")).toBeNull();             // its header suppressed
});
```

- [ ] **Step 2: Run to verify it fails**

`pnpm --filter @waitron/till test till-station-screen -t "embedded"` → FAIL (`embedded` not a property; header always renders).

- [ ] **Step 3: Implement `embedded`**

Add `@property({ type: Boolean }) embedded = false;` beside the other props (`:145`). In `#renderQueueSurface` (`:482`):
- Wrap the `<header class="head">…</header>` in `${this.embedded ? nothing : html`<header …>…</header>`}`.
- **Extract the `.actions` block (the `view-toggle` + the `showBack`-gated Back) out of the header.** When embedded, render the `view-toggle` in a standalone `<div class="actions">…</div>` **before** `${opts.body}` (mirror floor's `.actions` sibling). The Back button is only meaningful with its header, and `showBack` is already `false` on every embedded mount (the kds card + kiosk own nav), so it need not survive embedding — keep Back inside the suppressed header. Simplest shape: keep the `.actions` bar rendered in BOTH modes (containing the view-toggle always, and the Back only when `!embedded && showBack`), and drop the `<h1 class="title">` when embedded.

In `#renderEnrol` (`:530`): wrap its `<header class="head"><h1>…</h1></header>` in `${this.embedded ? nothing : html`…`}`.

> **Implementer note (chrome location):** grep `till-floor-screen.ts:105-108` + `:533-570` for the exact "toggles live in `.actions`, header only holds title + Back" pattern and copy it. Keep the a11y `aria-label` on the `<section>` unchanged (it is not header chrome). Token-only styles.

- [ ] **Step 4: Run to verify pass + regression**

`pnpm --filter @waitron/till test till-station-screen` → PASS (embedded + standalone + enrol; every existing station test green — default `embedded=false`).

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/screens/till-station-screen.ts apps/till/src/screens/till-station-screen.test.ts
git commit -s -m "feat(till): embedded chrome seam on the station screen (SP-B2.2)"
```

---

## Task 2: `till-table-order-screen` — `embedded` chrome seam

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (`render` header `:905-926`; styles)
- Test: `apps/till/src/screens/till-table-order-screen.test.ts`

**Interfaces:**
- Produces: `till-table-order-screen` gains `@property({ type: Boolean }) embedded = false`. When `true`: the `<header class="head">` (`<h1 class="title">` + `.back`) is dropped and the **`.drawer-handle`** (with its pending `.badge`) moves into an always-present `.actions`/`.head-actions` bar (it is body function — the waiter still needs the pending-round drawer inside a card, spec §7 "its `.drawer-handle` stays inside the card"). Default `false` keeps every existing table-order test green.

- [ ] **Step 1: Write the failing test**

Add to `till-table-order-screen.test.ts` (reuse `mount`):

```ts
it("suppresses its own header + Back when embedded, keeping the drawer handle", async () => {
  const { el } = await mount({ embedded: true });
  expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-back]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-open-drawer]")).not.toBeNull(); // body function stays
});
it("renders its header + Back when standalone (default)", async () => {
  const { el } = await mount({});
  expect(el.shadowRoot!.querySelector("header.head")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-back]")).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

`pnpm --filter @waitron/till test till-table-order-screen -t "embedded"` → FAIL.

- [ ] **Step 3: Implement `embedded`**

Add `@property({ type: Boolean }) embedded = false;` beside `canSettle` (`:364`). In `render` (`:905`): drop the `<header class="head">` when embedded, but keep the `.drawer-handle` (+ pending badge) in an always-present actions bar. Concretely: render `<div class="head-actions">` (already the wrapper of drawer-handle + back) in BOTH modes, dropping the `<h1 class="title">` and the `.back` `<wt-button>` when embedded. Verify the badge (`data-pending-badge`) still renders (it lives inside the drawer-handle). Token-only styles for any relocated actions bar.

- [ ] **Step 4: Run to verify pass + regression**

`pnpm --filter @waitron/till test till-table-order-screen` → PASS (embedded + standalone; every existing table-order test green).

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/screens/till-table-order-screen.ts apps/till/src/screens/till-table-order-screen.test.ts
git commit -s -m "feat(till): embedded chrome seam on the table-order screen (SP-B2.2)"
```

---

## Task 3: `till-card-grid` — render the `kds-board` card + un-skip its capability tests

**Files:**
- Modify: `apps/till/src/widgets/card-grid.ts` (props `:88-98`; `#element` `kds-board` arm `:222-224`; `#currentState` `:241-250`; imports `:6-29`)
- Test: `apps/till/src/widgets/card-grid.test.ts` (un-skip `:397-434`; drop kds-board from `:244-263`)

**Interfaces:**
- Consumes: `BumpMode`, `FireControlMode` (`../widgets/station-queue.js`), `DeviceStation` (`../api/client.js`) — copy import paths verbatim from `till-station-screen.ts`/`till-app.ts`.
- Produces: `till-card-grid` gains `@property() bumpMode: BumpMode = "line"`, `@property() deviceMode = false`, `@property({ attribute: false }) initialDeviceStation?: DeviceStation`. `#element`'s `kds-board` arm returns `<till-station-screen embedded .api=${this.api} .bumpMode=${this.bumpMode} .fireControl=${this.fireControl} .deviceMode=${this.deviceMode} .initialDeviceStation=${this.initialDeviceStation}></till-station-screen>` (side-effect import `../screens/till-station-screen.js`). `#currentState("kds-board")` stays `undefined` (fail-OPEN) — see the decision note.

- [ ] **Step 1: Write the failing tests**

Un-skip the two `it.skip` capability tests (`card-grid.test.ts:397` and `:417`) — remove `.skip` and the two "lands in B2.2" comments above them. They already assert `till-station-screen` present (capable) / absent (not). Also update the "still skips notifications, kds-board and table-order" test (`:244`): remove the `kds-board` card from `bigTab.cards`, keep `notifications` + `table-order` (table-order lands in Task 4), and re-word the title + comment to "still skips notifications and table-order". Leave `.cell` count assertions consistent (basket still the only rendered cell there until Task 4).

Add a **prove-by-deletion** control (spec §10, CLAUDE.md "prove a guard by deletion"):

```ts
it("proves the capability skip by deletion: kds-board absent without act-as-kds, present with it", async () => {
  const store = new WorkingOrderStore();
  const tab: TabDef = { key: "k", title: "K", columns: 12,
    cards: [{ type: "kds-board", colSpan: 12, rowSpan: 6, config: {} }] };
  const absent = await mountWidget<TillCardGrid>("till-card-grid", { tab, store, capabilities: [] });
  expect(absent.el.shadowRoot!.querySelector("till-station-screen")).toBeNull();
  const present = await mountWidget<TillCardGrid>("till-card-grid", { tab, store, capabilities: ["act-as-kds"] });
  expect(present.el.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

`pnpm --filter @waitron/till test card-grid -t "capability-gated card|capability skip by deletion"` → FAIL (kds-board renders `nothing`, so `till-station-screen` is absent in BOTH capability states → the "present" assertion fails).

- [ ] **Step 3: Implement the `kds-board` arm**

In `card-grid.ts`: add `import "../screens/till-station-screen.js";` beside the other screen side-effect imports (`:14-15`); import the `BumpMode`/`FireControlMode` type (already have `FireControlMode`) and `DeviceStation`. Add the three props. Replace the `kds-board` `nothing` arm (`:222`) with the `<till-station-screen embedded …>` above. Leave `notifications`/`table-order` as `nothing` (table-order lands in Task 4).

- [ ] **Step 4: Decide `#currentState("kds-board")` — fail OPEN, mirroring expo (document it)**

Leave `#currentState`'s `default` arm returning `undefined` for `kds-board` (do NOT add a case). **Add a comment** at `#currentState` recording the decision: kds-board (like expo) is a **self-fetching** screen — the grid host holds no authoritative queue for the operator's *picked* station (`stationQueue` is only the *default* station, KDS-1), so the host cannot compute `has-tickets`/`idle`; a `visibleWhen` gate on a kds-board card therefore **fails OPEN** via `#visible` (B2.1 follow-up d), exactly as expo does. This matches the landed B2.1 treatment of expo (whose identical `has-tickets`/`idle` states are also host-uncomputable) — the two big self-fetching screens are handled the same way, not one host-computed and one not.

- [ ] **Step 5: Run to verify pass**

`pnpm --filter @waitron/till test card-grid` → PASS (the two un-skipped capability tests; the prove-by-deletion control; the reworded "still skips" test; every B2.1 test green — the `tender-pay` carve-out and the "never widens access" advisory-gate test are unaffected).

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/widgets/card-grid.ts apps/till/src/widgets/card-grid.test.ts
git commit -s -m "feat(till): card-grid renders the kds-board card; un-skip capability gating (SP-B2.2)"
```

---

## Task 4: `till-card-grid` — render the `table-order` card

**Files:**
- Modify: `apps/till/src/widgets/card-grid.ts` (props; `#element` `table-order` arm `:223`; imports)
- Test: `apps/till/src/widgets/card-grid.test.ts`

**Interfaces:**
- Consumes: `MenuSummary`/`CatalogueSummary`, `TableServiceStatus`, `Course`, `TabLine` (or whatever `till-table-order-screen`'s `menus`/`statuses`/`courses`/`lines` props are typed — **copy the exact types from `till-table-order-screen.ts`'s `@property` declarations and `till-app.ts`'s fields**).
- Produces: `till-card-grid` gains the table-order props not already present: `menus`, `selectedMenuId`, `statuses`, `courses`, `tabLines`, `orderId` (`products`, `tables`, `busy`, `fireControl` already exist on the grid). `#element`'s `table-order` arm returns `<till-table-order-screen embedded .lines=${this.tabLines} .products=${this.products} .menus=${this.menus} .selectedMenuId=${this.selectedMenuId} .statuses=${this.statuses} .courses=${this.courses} .fireControl=${this.fireControl} .tables=${this.tables} .orderId=${this.orderId} .busy=${this.busy}></till-table-order-screen>` (side-effect import `../screens/till-table-order-screen.js`). Its `canSettle` is left DEFAULT `true` (the screen's own default — a card-mounted tab on a handheld settles like the standalone screen; do not pass `false`). Now **only `notifications` returns `nothing`**.

- [ ] **Step 1: Write the failing test**

Add to `card-grid.test.ts` a `table-order` tab and assert the embedded screen mounts:

```ts
const orderTab: TabDef = { key: "order", title: "Order", columns: 12,
  cards: [{ type: "table-order", colSpan: 12, rowSpan: 12, config: {} }] };

it("renders an embedded table-order screen for a table-order card", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: orderTab, store });
  const to = el.shadowRoot!.querySelector<HTMLElement & { embedded?: boolean }>("till-table-order-screen")!;
  expect(to).not.toBeNull();
  expect(to.embedded).toBe(true);
});
```

Also update the "still skips" test from Task 3 to drop `table-order` too — leaving **only** `notifications` as the skipped type, and reword its title/comment to "still skips notifications (later), rendering no cell for it".

- [ ] **Step 2: Run to verify it fails**

`pnpm --filter @waitron/till test card-grid -t "embedded table-order"` → FAIL (`table-order` renders `nothing`).

- [ ] **Step 3: Implement the `table-order` arm**

Add the side-effect import + the new props + the `<till-table-order-screen embedded …>` arm. Copy prop types verbatim from `till-table-order-screen.ts`.

- [ ] **Step 4: Run to verify pass + coverage**

`pnpm --filter @waitron/till test card-grid` → PASS. Then `pnpm --filter @waitron/till test:coverage` → PASS at `95/95/90/88` (the grid's new arms + props are exercised by the new tests + Task 6's app tests).

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/widgets/card-grid.ts apps/till/src/widgets/card-grid.test.ts
git commit -s -m "feat(till): card-grid renders the table-order card (SP-B2.2)"
```

---

## Task 5: `till-tab-shell` — kiosk mode (kds header suppression)

**Files:**
- Modify: `apps/till/src/widgets/tab-shell.ts` (render `:~`; styles)
- Test: `apps/till/src/widgets/tab-shell.test.ts`, `apps/till/src/widgets/tab-shell.a11y.test.ts`

**Interfaces:**
- Produces: `till-tab-shell` gains `@property({ type: Boolean }) kiosk = false`. When `true` the **entire operator `<header>`** (the tab bar AND the session chrome — operator name, Logout, language chooser, affordances) is not rendered; only the body slot (and the `drill` slot machinery) render. Owner decision 2026-09-04: a kds display shows just its board. Default `false` keeps the B2.1 shell byte-identical.

- [ ] **Step 1: Write the failing test**

Add to `tab-shell.test.ts`:

```ts
it("suppresses the whole operator header in kiosk mode, rendering only the body", async () => {
  const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
    tabs: [{ key: "kitchen", title: "Kitchen", columns: 24, cards: [] }],
    activeTabKey: "kitchen", operatorName: "Ana", affordances: [], kiosk: true,
  });
  expect(el.shadowRoot!.querySelector(".tab")).toBeNull();       // no tab bar
  expect(el.shadowRoot!.querySelector(".logout")).toBeNull();    // no session chrome
  expect(el.shadowRoot!.querySelector("header")).toBeNull();     // header gone entirely
  expect(el.shadowRoot!.querySelector("slot:not([name])")).not.toBeNull(); // body slot stays
});
it("renders the full header when not in kiosk mode (default)", async () => {
  const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
    tabs: [{ key: "counter", title: "Counter", columns: 12, cards: [] }], activeTabKey: "counter",
  });
  expect(el.shadowRoot!.querySelector("header")).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

`pnpm --filter @waitron/till test tab-shell -t "kiosk"` → FAIL (`kiosk` not a property; header always renders).

- [ ] **Step 3: Implement `kiosk`**

Add `@property({ type: Boolean }) kiosk = false;`. Wrap the `<header …>…</header>` block in `${this.kiosk ? nothing : html`<header …>…</header>`}`. Leave the `<main class="body">` + `drill` slot exactly as-is (a kds card still uses the body slot; it never opens a drill, but the machinery is inert when no drill is slotted). Confirm the `slotchange`/`?inert` drill logic is untouched.

- [ ] **Step 4: Run to verify pass + a11y**

`pnpm --filter @waitron/till test tab-shell` → PASS. Add a kiosk case to `tab-shell.a11y.test.ts` (mount with `kiosk: true`) and run `pnpm --filter @waitron/till test tab-shell.a11y` → PASS (a header-less body must stay violation-free).

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/widgets/tab-shell.ts apps/till/src/widgets/tab-shell.test.ts apps/till/src/widgets/tab-shell.a11y.test.ts
git commit -s -m "feat(till): tab-shell kiosk mode suppresses the operator header (SP-B2.2)"
```

---

## Task 6: `till-app` — thread heavy-screen props + re-enable the handheld/kds shell

**Files:**
- Modify: `apps/till/src/till-app.ts` (`#tabBody` `:2148-2167`; `#shellActive` `:2086-2096`; `#affordances` `:2115-2118`; `willUpdate` `:568-572`; shell render `.kiosk` `:2332-2344`)
- Test: `apps/till/src/till-app.test.ts`

**Interfaces:**
- Produces:
  - `#tabBody`'s `till-card-grid` (the non-counter arm) gains the station + table-order props: `.bumpMode=${this.bumpMode} .deviceMode=${this.deviceMode} .initialDeviceStation=${this.initialDeviceStation} .menus=${this.menus} .selectedMenuId=${this.selectedCatalogueId} .statuses=${this.statuses} .courses=${this.courses} .tabLines=${this.tabLines} .orderId=${this.activeTabId}` (copy the exact field names — see `#drillBody`'s `table-order`/`station` arms `:2190-2227` for the verbatim source).
  - `#shellActive()` drops `!this.deviceMode && !this.handheldMode` (keep `screen !== "lock"`, `!handheldEnrolling`, `!tillEnrolling`). Update its doc comment: handheld + kds are now shell devices (their cards render); the fence is removed.
  - `#affordances()` returns `[]` when `this.handheldMode` (a handheld reaches no Station/Expo/Schedule — reachability preserved); otherwise the B2.1 `{station,expo,schedule} − tabs`. (Kiosk suppresses affordances at the shell anyway, so deviceMode needs no branch here — but the memoised recompute must still fire; see next.)
  - `willUpdate` recomputes `#affordanceList` when `profile` **or** `handheldMode` changes (a handheld's `handheldMode` is set in `#boot` — the memo must see it).
  - The shell `<till-tab-shell>` gains `.kiosk=${this.deviceMode}`.

- [ ] **Step 1: Write the failing test — a handheld renders the shell (full header, no affordances)**

In `till-app.test.ts` (reuse the boot/login harness; there are existing handheld tests — grep `handheldMode`/`getDeviceIdentity` for the stub shape). Stub `getDeviceIdentity` → `{ kind: "handheld" }` and `getTill` → a `TillInfo` whose `profile` is the PHONE profile (floor + order tabs, `capabilities: []`). Drive boot + PIN login, then:

```ts
it("renders the tab shell for a handheld with a full header and no affordances", async () => {
  // ... boot as handheld, login ...
  const shell = el.shadowRoot!.querySelector<HTMLElement & { kiosk?: boolean; affordances?: unknown[] }>("till-tab-shell")!;
  expect(shell).not.toBeNull();
  expect(shell.kiosk).toBe(false);            // handheld = full header
  expect(shell.affordances).toEqual([]);      // no Station/Expo/Schedule on a handheld
  expect(el.shadowRoot!.querySelector("till-tab-shell")!.shadowRoot!.querySelector(".logout")).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

`pnpm --filter @waitron/till test till-app -t "handheld with a full header"` → FAIL — `#shellActive()` still returns false for `handheldMode`, so the legacy floor screen renders, not the shell.

- [ ] **Step 3: Implement — unfence + affordances + willUpdate + kiosk + tabBody props**

Apply the five changes above. For `willUpdate`: `if (changed.has("profile") || changed.has("handheldMode")) this.#affordanceList = this.#affordances();`.

- [ ] **Step 4: Write the failing test — a kds display renders the shell in kiosk mode**

Stub `getDeviceIdentity` → `{ kind: "kds_station" }`, `getDeviceStation` → a bound station + queue, and `getTill` → a `TillInfo` whose `profile` is the KDS profile (kitchen tab, `capabilities: ["act-as-kds"]`). Drive boot (no login — a kds display never logs in). Assert:

```ts
it("renders the tab shell in kiosk mode for a kds display, mounting the kds-board card", async () => {
  // ... boot as kds_station ...
  const shell = el.shadowRoot!.querySelector<HTMLElement & { kiosk?: boolean }>("till-tab-shell")!;
  expect(shell).not.toBeNull();
  expect(shell.kiosk).toBe(true);
  // The kitchen tab's kds-board card mounts the embedded station screen through the grid.
  expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
});
```

> **Implementer note (verify getTill returns a kds profile):** the boot calls `getTill()` BEFORE the device probe (`till-app.ts:591-634`); confirm the test's `getTill` stub returns the KDS `profile` so `this.profile` is set and `#shellActive()` sees it. If an existing kds boot test stubs `getTill` returning no profile, add the profile to the stub (the server DOES resolve a KDS profile for an enrolled kds device — `till-api.ts:662-691`, `deviceFormFactor("kds_station") → "kds"` → `DEFAULT_PROFILES.kds`). A FRESH (un-enrolled) kds display gets NO profile from getTill and correctly stays on the legacy enrol path — do not try to shell that; it is the fallback (test it stays legacy if a boot test already covers the fresh-enrol path).

- [ ] **Step 5: Run to verify pass + legacy-fallback regression**

`pnpm --filter @waitron/till test till-app` → PASS — handheld + kds shell; and every legacy-path test (stubs returning no `profile`, or the fresh-enrol kds/handheld paths) still renders `#renderScreen`. Confirm no existing handheld/kds test regressed (they may now assert the shell — re-point mounts, keep assertions per CLAUDE.md §4; where an old test asserted the legacy floor/station screen for an ENROLLED profiled device, that behaviour genuinely changed to the shell — update the mount, keep the *intent* assertion, e.g. "the handheld lands on the floor surface" now = "the floor tab is active").

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/till-app.ts apps/till/src/till-app.test.ts
git commit -s -m "feat(till): re-enable the profile shell for handheld + kds devices (SP-B2.2)"
```

---

## Task 7: `till-app` — handheld table-order mount duality + landing

**Files:**
- Modify: `apps/till/src/till-app.ts` (`#onOpenTable` `:1590-1611`; `#onBackToFloor` `:1972-1980`; `#onLoggedIn` landing `:729-759`; add `#tableOrderTabKey`/`#floorTabKey` helpers)
- Test: `apps/till/src/till-app.test.ts`

**Interfaces:**
- Produces: on the shell surface, when the profile **authors a tab whose cards include a `table-order` card** (a handheld/tablet `order` tab), `open-table` **switches to that tab** (card mount, SP-B §5) instead of pushing a `table-order` drill-in; `back-to-floor` **switches to the floor tab** (the tab whose cards include a `floor-plan` card) instead of popping a drill. A **till** profile (no `table-order` tab) keeps B2.1's drill-in push/pop exactly. Two private helpers resolve the keys: `#tableOrderTabKey()` / `#floorTabKey()` (a tab whose `cards.some(c => c.type === "table-order" | "floor-plan")`).

- [ ] **Step 1: Write the failing test — a handheld opens a table into its Order tab (not a drill)**

In `till-app.test.ts`, boot as handheld (PHONE profile), login (lands on floor tab), stub `openTab`/`getTabLines`, then fire `open-table` from the floor tab:

```ts
it("switches a handheld to the Order tab (card mount) when a table is opened, not a drill-in", async () => {
  // ... handheld booted + logged in, activeTabKey "floor" ...
  el.shadowRoot!.querySelector("till-tab-shell")!.dispatchEvent(
    new CustomEvent("open-table", { detail: { tableId: "t1", hasOpenTab: false }, bubbles: true, composed: true }));
  await /* the async tab-line load */ el.updateComplete;
  const shell = el.shadowRoot!.querySelector<HTMLElement & { activeTabKey?: string }>("till-tab-shell")!;
  expect(shell.activeTabKey).toBe("order");                                  // switched to the Order tab
  expect(el.shadowRoot!.querySelector('[slot="drill"]')).toBeNull();          // NOT a drill-in
  expect(el.shadowRoot!.querySelector("till-table-order-screen")).not.toBeNull(); // card-mounted
});
it("returns a handheld to the Floor tab on back-to-floor", async () => {
  // ... after the open above ...
  el.shadowRoot!.querySelector("till-table-order-screen")!.dispatchEvent(
    new CustomEvent("back-to-floor", { bubbles: true, composed: true }));
  await el.updateComplete;
  const shell = el.shadowRoot!.querySelector<HTMLElement & { activeTabKey?: string }>("till-tab-shell")!;
  expect(shell.activeTabKey).toBe("floor");
});
```

Keep the B2.1 **till** open-table drill test green (a till profile with no `order` tab still pushes/pops the drill).

- [ ] **Step 2: Run to verify it fails**

`pnpm --filter @waitron/till test till-app -t "Order tab"` → FAIL — `#onOpenTable` pushes a drill unconditionally on the shell surface.

- [ ] **Step 3: Implement the mount duality**

Add:

```ts
/** The key of the tab whose cards mount a table-order card (a handheld/tablet `order` tab), or
 * undefined when the profile authors none (a till reaches table-order as an open-table drill-in). */
#tableOrderTabKey(): string | undefined {
  return this.profile?.tabs.find((t) => t.cards.some((c) => c.type === "table-order"))?.key;
}
/** The key of the tab whose cards mount a floor-plan card (the shell's Floor tab), or undefined. */
#floorTabKey(): string | undefined {
  return this.profile?.tabs.find((t) => t.cards.some((c) => c.type === "floor-plan"))?.key;
}
```

In `#onOpenTable` (`:1607-1610`), replace the shell branch:

```ts
if (this.#inShell()) {
  const orderTabKey = this.#tableOrderTabKey();
  if (orderTabKey !== undefined) this.activeTabKey = orderTabKey; // card mount (handheld/tablet)
  else this.#pushDrill({ kind: "table-order" });                 // drill mount (till)
} else this.#setScreen("table-order");
```

In `#onBackToFloor` (`:1972-1980`), replace the shell branch: if a drill is open, keep B2.1's `#popDrill()`; else (a handheld whose table-order is a tab) `this.activeTabKey = this.#floorTabKey() ?? this.activeTabKey`. Keep the `void this.#refreshFloor()` on the shell path (the tables read-model is stale after openTab/rounds — SP-B2.1 review reasoning applies to the tab switch identically).

> **Implementer note (landing):** confirm `#onLoggedIn` already lands a handheld on its first tab. It sets `this.activeTabKey = this.profile?.tabs[0]?.key` (`:713`) and, for `landingFace === "floor"`, calls `#onShowFloor()` which loads floor data and sets `screen = "floor"` (non-lock) so `#shellActive()` turns true. With the Task 6 unfence, the handheld now renders the SHELL on that first (floor) tab. Verify the floor tab's `floor-plan` card has its data (the `#onShowFloor` load populates `.zones`/`.tables`). If a handheld's first authored tab is NOT floor, `#onShowFloor` still loads floor data harmlessly; the active tab is `tabs[0].key`. No change needed unless a test shows the handheld stranded — then set `activeTabKey` to `#floorTabKey()` on the handheld login path.

- [ ] **Step 4: Run to verify pass**

`pnpm --filter @waitron/till test till-app` → PASS — handheld order/floor tab duality; till drill push/pop unchanged; legacy path unchanged.

- [ ] **Step 5: Full till coverage + commit**

`pnpm --filter @waitron/till test:coverage` → PASS at `95/95/90/88`.

```bash
git add apps/till/src/till-app.ts apps/till/src/till-app.test.ts
git commit -s -m "feat(till): handheld table-order mounts as the Order tab card (SP-B2.2)"
```

---

## Task 8: Final verification (before PR)

- [ ] **Whole-workspace gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] **Scoped coverage:** `pnpm --filter @waitron/till test:coverage` (95/95/90/88).
- [ ] **Cheap fiscal guard (non-fiscal slice, no schema change):** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` stays green.
- [ ] **Un-skipped tests:** grep `card-grid.test.ts` for `it.skip` — the two kds-board capability tests must be un-skipped and green; the "still skips" test now names **only** `notifications`.
- [ ] **No-flow-lost audit:** the `station`/`table-order` legacy `#renderScreen` arms + the `#drillBody` station/table-order drill arms still render (till affordance drill for station; till open-table drill for table-order) — B2.2 changed neither. Every wrapped screen's composed events (station advances/enrol; table-order send-round/serve-line/pay-tab/set-status/back-to-floor/…) still bubble to the app handlers on both mount points.
- [ ] **`#element` exhaustiveness:** only `notifications` returns `nothing` now (B4/later); adding any card type is still a compile error without a case.
- [ ] **Manual smoke (optional):** `pnpm dev:setup && pnpm dev`; (a) the counter/floor till shell is unchanged (B2.1); (b) enrol a handheld → its Floor/Order tab shell with a full header (operator + Logout), no Station/Expo/Schedule; tap a table → the Order tab shows the table-order card; Back → Floor tab; (c) enrol a kds display → kiosk board, no operator header, view-toggle flips board/rail.

---

## Self-Review notes (author)

- **Spec coverage (§7):** station `embedded` (Task 1), table-order `embedded` (Task 2), kds-board card + first reachable capability→absent skip (Task 3), table-order card + mount duality (Tasks 4, 7), kiosk chrome (Task 5), shell re-enabled for handheld+kds (Task 6). The `has-tickets`/`idle` `visibleWhen` for kds-board is handled by fail-OPEN (Task 3 Step 4), the same as the landed expo treatment — documented, not silently divergent.
- **Owner decisions (2026-09-04):** handheld = full shell header, no affordances (Task 6); kds = kiosk, no operator header (Tasks 5–6). Both recorded in the backlog note this PR updates.
- **Two mount points, `embedded` the only difference:** card mounts (kds kitchen tab, handheld order tab) are `embedded`; the till affordance/open-table **drill-ins keep their own chrome** (`#drillBody`, unchanged) so the operator always has a Back. This is why Tasks 3/4 mount `embedded` in the GRID but `#drillBody` is not touched.
- **Sale path:** untouched — B2.2 does not change the counter tab or the counter's `tender-pay`; table-order's embedded `tender-pay` + `canSettle`/`pay-tab` are unchanged (default `canSettle` on the card mount). Not H2 / not fiscal / no schema change; the inmutabilidad guard is a cheap belt-and-braces.
- **De-risk via fallback:** the legacy `screen`-enum path stays live for every unprofiled boot (fresh un-enrolled device, incl. the kds enrol path). A bug in the shell path cannot break an unprofiled boot.
- **Known implementer lookups (flagged inline):** exact prop TYPES for the table-order card (copy from `till-table-order-screen.ts`); `BumpMode`/`DeviceStation` import paths (copy from `till-station-screen.ts`/`till-app.ts`); the kds/handheld boot stub shapes (grep existing `getDeviceIdentity` tests in `till-app.test.ts`); the floor `.actions`-extraction pattern for Task 1 (`till-floor-screen.ts:105-108,533-570`).
- **Risk note:** Task 6 (unfence) + Task 7 (handheld duality) are the risk. Both keep the legacy path as a live fallback; each new transition is individually test-pinned; every existing behavioural assertion on the two wrapped screens is preserved (re-point mounts, keep assertions).
