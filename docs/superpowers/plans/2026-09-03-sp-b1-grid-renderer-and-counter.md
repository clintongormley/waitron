# SP-B1 — Grid renderer + counter renders from profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the till **counter** render its cards from the device's assigned layout **profile** (a fluid CSS grid), wiring the full server→client profile path, with graceful fallback to the legacy region model and every other screen untouched.

**Architecture:** The server's `GET /api/till` gains a form-factor fallback so any enrolled device resolves a `ProfileDef`; the till bundle mirrors the profile types locally (bundle rule) and narrows the boot payload; a new `till-card-grid` component lays cards on a fluid `repeat(columns, 1fr)` grid and threads the same shared `store` + app-owned data the counter screen threads today; the counter screen delegates its widget body to that grid when a counter tab is present.

**Tech Stack:** TypeScript, Lit (custom elements, shadow DOM), Hono (server), Drizzle, Vitest (browser-mode for `apps/till`, PGlite for `apps/server` boot tests), `@waitron/ui` `--wt-*` tokens.

**Spec:** [`docs/superpowers/specs/2026-09-03-sp-b-grid-editor-and-rendering-design.md`](../specs/2026-09-03-sp-b-grid-editor-and-rendering-design.md) (SP-B). Parent design: [`2026-09-02-layout-designer-and-device-profiles-design.md`](../specs/2026-09-02-layout-designer-and-device-profiles-design.md).

## Global Constraints

- **Bundle rule:** `apps/till` MUST NOT import `@waitron/layouts`. Profile types are mirrored locally in `apps/till/src/layout.ts` (exactly as `LayoutDef`/`ReceiptConfig` already are).
- **No hardcoded chrome:** cards and the grid use `--wt-*` tokens only (spacing/colour/radius/font). Enforced by `packages/ui/src/no-hardcoded-chrome.test.ts` for `@waitron/ui`; keep the till grid's own CSS token-only too.
- **Additive server change:** a `GET /api/till` request with **no device cookie** stays byte-for-byte unchanged (`profile` key absent). Only an *enrolled* device's resolution changes.
- **Sale path never blocked (fiscal §5, spec §10):** all placed counter-tab cards render in B1. Capability→absent and permission→locked are **deferred to B2** — the counter's only capability-bearing card (`tender-pay`) is sale-critical and must always render (it also takes cash).
- **Not H2 / not fiscal:** no sale-recording, chain, or migration changes. No new DB tables in B1 (`tenant_receipts` is B4).
- **Slice boundary (refines spec §4.1):** B1 does **not** build the tab shell or touch `till-app`'s `screen`-enum navigation. It renders the profile's **counter tab** in place of the counter's region body, with fallback. Tab shell + nav rewrite + wrapping bespoke screens = B2.
- **Coverage thresholds:** `apps/till` is `95/95/90/88`; `apps/server` is `98/98/98/95`. Run `pnpm --filter <pkg> test:coverage`.
- **Browser-mode RAM:** do not run `apps/till`/`apps/ui`/`apps/dashboard` `test:coverage` concurrently with each other.
- **Every commit `-s`.** TDD: failing test first, watch it fail, minimal implementation, watch it pass, commit.

---

## File Structure

- **Modify** `apps/server/src/till-api.ts` — add `deviceFormFactor()` helper; change the profile resolution at ~663-675 to fall back to the form-factor default for an enrolled device; simplify the wire spread at ~733 to a bare `ProfileDef`.
- **Modify** `apps/server/src/till-api.test.ts` — rewrite the null-`layoutProfileId` test (now expects the fallback profile) and add a no-cookie test (profile still absent) + `deviceFormFactor` unit tests + `handheld`/`kds_station` derivation tests.
- **Modify** `apps/till/src/layout.ts` — add the local `ProfileDef` mirror types (`FormFactor`, `CapabilityFlag`, `CardType`, `CardInstance`, `TabDef`, `ThemeOverride`, `ProfileDef`).
- **Create** `apps/till/src/layout.test.ts` — a shape test pinning the mirror against a literal (compile-checked; guards drift).
- **Modify** `apps/till/src/api/client.ts` — narrow `TillInfo.profile?: unknown` → `profile?: ProfileDef`.
- **Create** `apps/till/src/widgets/card-grid.ts` — the `till-card-grid` component (fluid grid, exhaustive card mapping, `visibleWhen`).
- **Create** `apps/till/src/widgets/card-grid.test.ts` — its tests.
- **Modify** `apps/till/src/screens/till-counter-screen.ts` — add a `counterTab?: TabDef` prop; render `till-card-grid` for the widget body when present, region model otherwise.
- **Modify** `apps/till/src/screens/till-counter-screen.test.ts` — add grid-path tests; keep the region-fallback assertions.
- **Modify** `apps/till/src/till-app.ts` — `#boot()` reads `till.profile`; add `profile?: ProfileDef` state + `#counterTab()` helper; thread `.counterTab` into the counter case.
- **Modify** `apps/till/src/till-app.test.ts` — assert the counter renders from the grid when the stub returns a profile.

---

## Task 1: Server — device→form-factor fallback in `GET /api/till`

**Files:**
- Modify: `apps/server/src/till-api.ts` (add `deviceFormFactor`; resolution ~663-675; wire spread ~733)
- Test: `apps/server/src/till-api.test.ts` (rewrite ~939-962; add cases; enrol helper ~277-296)

**Interfaces:**
- Consumes: `getProfile(tx, tenantId, id) => Promise<{id,name,definition: ProfileDef}|undefined>` and `getProfileForFormFactor(tx, tenantId, formFactor) => Promise<ProfileDef>` (`@waitron/layouts`); `DeviceBinding.{kind, layoutProfileId}` from `tryReadDevice`; `DeviceKind = "kds_station"|"handheld"|"till"` (`./device.js`); `FormFactor` (`@waitron/layouts`).
- Produces: exported `deviceFormFactor(kind: DeviceKind): FormFactor`; `GET /api/till` now returns `profile: ProfileDef` for any enrolled device, absent for a cookieless request.

- [ ] **Step 1: Write the failing unit test for `deviceFormFactor`**

Add to `apps/server/src/till-api.test.ts` (top-level `describe`):

```ts
import { deviceFormFactor } from "./till-api.js";

describe("deviceFormFactor", () => {
  it("maps each device kind to a form factor", () => {
    expect(deviceFormFactor("till")).toBe("till");
    expect(deviceFormFactor("kds_station")).toBe("kds");
    expect(deviceFormFactor("handheld")).toBe("phone-portrait");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/server test till-api -t "deviceFormFactor"`
Expected: FAIL — `deviceFormFactor` is not exported / not defined.

- [ ] **Step 3: Implement `deviceFormFactor`**

In `apps/till`... no — in `apps/server/src/till-api.ts`, add near the top (after imports). Add `FormFactor` to the existing `@waitron/layouts` import and `DeviceKind` to the `./device.js` import:

```ts
import type { FormFactor } from "@waitron/layouts";
import type { DeviceKind } from "./device.js";

/**
 * Derive a layout FORM FACTOR from a device KIND for the profile fallback (SP-B1). A device row
 * carries only `kind` (`packages/db/src/schema/devices.ts`), never a form factor, so the mapping is
 * fixed here. `handheld` → `phone-portrait`: the codebase treats a handheld as a phone (the phone
 * shell in `till-app`, and `device-session.ts`'s own doc pairs a handheld with the phone-portrait
 * default). `tablet-landscape` is not reachable via device kind today.
 */
export function deviceFormFactor(kind: DeviceKind): FormFactor {
  switch (kind) {
    case "till":
      return "till";
    case "kds_station":
      return "kds";
    case "handheld":
      return "phone-portrait";
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @waitron/server test till-api -t "deviceFormFactor"`
Expected: PASS.

- [ ] **Step 5: Write the failing boot tests (fallback + no-cookie)**

In `apps/server/src/till-api.test.ts`, **replace** the existing null-`layoutProfileId` test (~939-962, the one asserting `not.toHaveProperty("profile")`) with a fallback test, and **add** a no-cookie test. The existing enrol helper `enrolTillDeviceCookie(db, layoutProfileId)` (~277-296) mints a real `till` cookie.

```ts
it("falls back to the form-factor default profile for an enrolled device with no assigned profile", async () => {
  const cookie = await enrolTillDeviceCookie(suite.db, null);
  const app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  try {
    const res = await app.request("/api/till", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: unknown; layout: LayoutDef; receipt: ReceiptConfig };
    // No stored profile of this form factor → the built-in default for a till device.
    expect(body.profile).toEqual(DEFAULT_PROFILES.till);
    expect(body.layout).toEqual(DEFAULT_LAYOUT);
    expect(body.receipt).toEqual(DEFAULT_RECEIPT);
  } finally {
    await suite.db.execute(sql`delete from devices where tenant_id = ${cfg.tenantId}`);
  }
});

it("omits the profile entirely when the request carries no device cookie", async () => {
  const app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  const res = await app.request("/api/till"); // no cookie header
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).not.toHaveProperty("profile");
});
```

`DEFAULT_PROFILES` is imported from `@waitron/layouts` (the test file already imports `DEFAULT_LAYOUT`/`DEFAULT_RECEIPT` from there — add `DEFAULT_PROFILES`).

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm --filter @waitron/server test till-api -t "form-factor default"`
Expected: FAIL — today an enrolled device with `layoutProfileId === null` gets `profile` absent, so `body.profile` is `undefined`, not `DEFAULT_PROFILES.till`.
(The no-cookie test should already PASS — it is a guard that Step 7 must not break.)

- [ ] **Step 7: Implement the fallback resolution**

In `apps/server/src/till-api.ts`, replace the resolution at ~663-666:

```ts
const profile =
  device?.layoutProfileId != null
    ? await getProfile(tx, deps.cfg.tenantId, device.layoutProfileId)
    : undefined;
```

with (note: normalise to a bare `ProfileDef` here, so the wire spread simplifies):

```ts
// SP-B1: an enrolled device always resolves a ProfileDef — its explicitly assigned profile if the
// id resolves, else the built-in/default profile for its form factor. A request with NO device
// (cookieless) stays `undefined` so the payload is byte-for-byte unchanged (see the no-cookie test).
let profile: ProfileDef | undefined;
if (device != null) {
  if (device.layoutProfileId != null) {
    profile = (await getProfile(tx, deps.cfg.tenantId, device.layoutProfileId))?.definition;
  }
  profile ??= await getProfileForFormFactor(tx, deps.cfg.tenantId, deviceFormFactor(device.kind));
}
```

Add `getProfileForFormFactor` to the `@waitron/layouts` import (alongside `getProfile`) and import the `ProfileDef` type from `@waitron/layouts`. The `boot` return object at ~667-675 keeps `profile` (now a `ProfileDef | undefined`). Then simplify the wire spread at ~733 from `{ profile: boot.profile.definition }` to:

```ts
...(boot.profile !== undefined ? { profile: boot.profile } : {}),
```

- [ ] **Step 8: Run the affected tests**

Run: `pnpm --filter @waitron/server test till-api`
Expected: PASS — the fallback test, the no-cookie test, the existing explicit-profile test (~904-937, id resolves → `DEFAULT_PROFILES.till`), and `deviceFormFactor` all green.

- [ ] **Step 9: Full server suite + coverage**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS at threshold.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.test.ts
git commit -s -m "feat(till-api): resolve a layout profile for every enrolled device (SP-B1)"
```

---

## Task 2: Till-local `ProfileDef` mirror types + boot-payload narrowing

**Files:**
- Modify: `apps/till/src/layout.ts` (add mirror types)
- Create: `apps/till/src/layout.test.ts` (shape guard)
- Modify: `apps/till/src/api/client.ts` (narrow `TillInfo.profile`)

**Interfaces:**
- Produces: `FormFactor`, `CapabilityFlag`, `CardType`, `CardInstance`, `TabDef`, `ThemeOverride`, `ProfileDef` exported from `../layout.js`; `TillInfo.profile?: ProfileDef`.
- Consumes: nothing (pure types mirroring `packages/layouts/src/profile.ts:9-77`).

- [ ] **Step 1: Write the failing shape test**

Create `apps/till/src/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ProfileDef } from "./layout.js";

describe("ProfileDef mirror", () => {
  it("accepts a profile literal shaped like the layouts package", () => {
    const profile: ProfileDef = {
      formFactor: "till",
      capabilities: ["integrated-card-payment", "open-cash-drawer"],
      tabs: [
        {
          key: "counter",
          title: "Counter",
          columns: 12,
          cards: [
            { type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } },
            { type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] },
          ],
        },
      ],
    };
    expect(profile.tabs[0]!.cards[0]!.type).toBe("product-grid");
    expect(profile.tabs[0]!.cards[1]!.visibleWhen).toEqual(["has-parked"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test layout`
Expected: FAIL — `ProfileDef` is not exported from `./layout.js` (typecheck/import error).

- [ ] **Step 3: Add the mirror types**

Append to `apps/till/src/layout.ts` (after the existing `LAYOUT_A`), keeping the file's "plain data, no Lit" invariant:

```ts
// ---------------------------------------------------------------------------
// SP-B profile model — a LOCAL mirror of `@waitron/layouts` (`packages/layouts/src/profile.ts`),
// bundle-decoupled exactly like `LayoutDef`/`ReceiptConfig` above — deliberately NOT imported from
// `@waitron/layouts` (the bundle rule). The server validates every profile on write; the client
// trusts the shape it receives. Keep in sync with profile.ts if that model changes.
// ---------------------------------------------------------------------------

export type FormFactor = "till" | "phone-portrait" | "tablet-landscape" | "kds";

export type CapabilityFlag = "integrated-card-payment" | "open-cash-drawer" | "act-as-kds";

export type CardType =
  | "product-grid"
  | "basket"
  | "total"
  | "tender-pay"
  | "held-orders"
  | "prep-queue"
  | "notifications"
  | "floor-plan"
  | "table-layout-editor"
  | "kds-board"
  | "expo"
  | "table-order";

export interface CardInstance {
  type: CardType;
  colSpan: number;
  rowSpan: number;
  config: Record<string, unknown>;
  visibleWhen?: string[];
}

export interface TabDef {
  key: string;
  title: string;
  columns: number;
  cards: CardInstance[];
}

export interface ThemeOverride {
  tokens: Record<string, string>;
}

export interface ProfileDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  capabilities: CapabilityFlag[];
  theme?: ThemeOverride;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test layout`
Expected: PASS.

- [ ] **Step 5: Narrow the boot payload**

In `apps/till/src/api/client.ts`, add `ProfileDef` to the existing layout-type import (`client.ts:22`):

```ts
import type { LayoutDef, ProfileDef, ReceiptConfig } from "../layout.js";
```

Replace `profile?: unknown;` (`client.ts:98`) with `profile?: ProfileDef;` and update the doc comment above it: drop the "Left `unknown` … before then" sentence and note "Consumed by SP-B1: the counter renders from this profile's counter tab."

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @waitron/till typecheck`
Expected: PASS (no consumer uses `profile` un-narrowed yet).

- [ ] **Step 7: Commit**

```bash
git add apps/till/src/layout.ts apps/till/src/layout.test.ts apps/till/src/api/client.ts
git commit -s -m "feat(till): mirror the ProfileDef model locally and narrow the boot payload (SP-B1)"
```

---

## Task 3: `till-card-grid` component

**Files:**
- Create: `apps/till/src/widgets/card-grid.ts`
- Test: `apps/till/src/widgets/card-grid.test.ts`

**Interfaces:**
- Consumes: `TabDef`, `CardInstance`, `CardType` (`../layout.js`); `WorkingOrderStore`; widget elements `till-product-grid`/`till-basket`/`till-total`/`till-tender-pay`/`till-held-orders`/`till-station-queue`; the data types `TillProduct`, `HeldOrderSummary`, `StationQueueGroup`, `OrderFlow`, `CardProvider`, `CardOutcome` (from the same modules the counter screen imports them).
- Produces: `<till-card-grid>` custom element with properties `tab?: TabDef`, `store: WorkingOrderStore`, `products: TillProduct[]`, `heldOrders: HeldOrderSummary[]`, `stationQueue: StationQueueGroup[]`, `defaultStationId?: string`, `busy: boolean`, `orderFlow: OrderFlow`, `stage: "order"|"collect"`, `cardProvider: CardProvider`, `tipsEnabled: boolean`, `cardOutcome?: CardOutcome`. Renders each card in a cell spanning `colSpan`×`rowSpan` on a fluid `repeat(columns,1fr)` grid; card events bubble unchanged.

- [ ] **Step 1: Write the failing test — renders cards with spans and shared store**

Create `apps/till/src/widgets/card-grid.test.ts`. Model the mount/assert style on `held-orders.test.ts` and `till-counter-screen.test.ts` (assign object props via `mountWidget`, read child props, assert `composed` events):

```ts
import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TabDef } from "../layout.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { TillCardGrid } from "./card-grid.js";

afterEach(cleanupWidgets);

const counterTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
    { type: "total", colSpan: 4, rowSpan: 1, config: {} },
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
  ],
};

it("renders each card element in a spanning cell on a fluid grid", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: counterTab, store });
  const grid = el.shadowRoot!.querySelector<HTMLElement>(".grid")!;
  expect(grid.style.gridTemplateColumns).toBe("repeat(12, 1fr)");
  expect(el.shadowRoot!.querySelector("till-product-grid")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
  const productCell = el.shadowRoot!.querySelector<HTMLElement>(".cell:has(till-product-grid)")!;
  expect(productCell.style.gridColumn).toBe("span 8");
  expect(productCell.style.gridRow).toBe("span 6");
});

it("threads the SAME store into every store-backed card", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: counterTab, store });
  const grid = el.shadowRoot!.querySelector<HTMLElement & { store: unknown }>("till-product-grid")!;
  const basket = el.shadowRoot!.querySelector<HTMLElement & { store: unknown }>("till-basket")!;
  const pay = el.shadowRoot!.querySelector<HTMLElement & { store: unknown }>("till-tender-pay")!;
  expect(grid.store).toBe(store);
  expect(basket.store).toBe(store);
  expect(pay.store).toBe(store);
});

it("threads the product-grid columns config", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: counterTab, store });
  const grid = el.shadowRoot!.querySelector<HTMLElement & { columns?: number }>("till-product-grid")!;
  expect(grid.columns).toBe(4);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test card-grid`
Expected: FAIL — `card-grid.js` / `till-card-grid` does not exist.

- [ ] **Step 3: Implement `till-card-grid`**

Create `apps/till/src/widgets/card-grid.ts`. Reuse the EXACT per-card bindings the counter screen uses in `#widget()` (`till-counter-screen.ts:267-307`). Import the widget elements by side-effect and the data types from the same modules the counter screen imports them from (check `till-counter-screen.ts` imports for the precise paths of `TillProduct`, `HeldOrderSummary`, `StationQueueGroup`, `OrderFlow`, `CardProvider`, `CardOutcome`, `WorkingOrderStore`).

```ts
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import "./product-grid.js";
import "./basket.js";
import "./total.js";
import "./tender-pay.js";
import "./held-orders.js";
import "./station-queue.js";
import type { CardInstance, CardType, TabDef } from "../layout.js";
import type { HeldOrderSummary, OrderFlow, StationQueueGroup, TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { CardOutcome, CardProvider } from "./tender-pay.js";

/**
 * SP-B1 renderer: lays a layout-profile TAB's cards on a fluid grid (`repeat(columns, 1fr)`), each
 * card spanning colSpan×rowSpan. Every card is handed the SAME `store` (or an app-owned list), exactly
 * as the counter screen threads them today; card events bubble past this host to `till-app` unchanged.
 * Capability→absent and permission→locked are B2. `visibleWhen` (data-condition) is honoured here.
 */
@customElement("till-card-grid")
export class TillCardGrid extends LitElement {
  static styles = css`
    .grid {
      display: grid;
      gap: var(--wt-space-3);
      height: 100%;
      grid-auto-rows: minmax(0, 1fr);
    }
    .cell {
      min-width: 0;
      min-height: 0;
    }
  `;

  @property({ attribute: false }) tab?: TabDef;
  @property({ attribute: false }) store!: WorkingOrderStore;
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) heldOrders: HeldOrderSummary[] = [];
  @property({ attribute: false }) stationQueue: StationQueueGroup[] = [];
  @property({ attribute: false }) defaultStationId?: string;
  @property({ type: Boolean }) busy = false;
  @property() orderFlow: OrderFlow = "prepay";
  @property() stage: "order" | "collect" = "order";
  @property() cardProvider: CardProvider = "none";
  @property({ type: Boolean }) tipsEnabled = false;
  @property() cardOutcome?: CardOutcome;

  render(): TemplateResult | typeof nothing {
    const tab = this.tab;
    if (tab === undefined) return nothing;
    return html`<div class="grid" style="grid-template-columns: repeat(${tab.columns}, 1fr)">
      ${tab.cards.filter((card) => this.#visible(card)).map((card) => this.#cell(card))}
    </div>`;
  }

  #cell(card: CardInstance): TemplateResult {
    const element = this.#element(card);
    if (element === nothing) return html``;
    return html`<div
      class="cell"
      style="grid-column: span ${card.colSpan}; grid-row: span ${card.rowSpan}"
    >
      ${element}
    </div>`;
  }

  #element(card: CardInstance): TemplateResult | typeof nothing {
    switch (card.type) {
      case "product-grid": {
        const columns = card.config.columns;
        return html`<till-product-grid
          .products=${this.products}
          .store=${this.store}
          .columns=${typeof columns === "number" ? columns : undefined}
        ></till-product-grid>`;
      }
      case "basket":
        return html`<till-basket .store=${this.store}></till-basket>`;
      case "total":
        return html`<till-total .store=${this.store}></till-total>`;
      case "tender-pay":
        return html`<till-tender-pay
          .store=${this.store}
          .busy=${this.busy}
          .mode=${this.orderFlow}
          .stage=${this.stage}
          .cardProvider=${this.cardProvider}
          .tipsEnabled=${this.tipsEnabled}
          .cardOutcome=${this.cardOutcome}
        ></till-tender-pay>`;
      case "held-orders":
        return html`<till-held-orders .orders=${this.heldOrders}></till-held-orders>`;
      case "prep-queue":
        return html`<till-station-queue
          .groups=${this.stationQueue}
          .view=${"rail"}
          .stationId=${this.defaultStationId}
        ></till-station-queue>`;
      // Big cards (floor-plan, table-layout-editor, kds-board, expo, table-order) and `notifications`
      // are not rendered on the counter tab in B1 — they arrive in B2. Skip them defensively.
      case "notifications":
      case "floor-plan":
      case "table-layout-editor":
      case "kds-board":
      case "expo":
      case "table-order":
        return nothing;
    }
  }

  #visible(card: CardInstance): boolean {
    const states = card.visibleWhen;
    if (states === undefined || states.length === 0) return true;
    const current = this.#currentState(card.type);
    return current !== undefined && states.includes(current);
  }

  /** Each card's data-condition state, computed from data the host already holds (spec §7). */
  #currentState(type: CardType): string | undefined {
    switch (type) {
      case "held-orders":
        return this.heldOrders.length > 0 ? "has-parked" : "empty";
      case "prep-queue":
        return this.stationQueue.length > 0 ? "has-items" : "empty";
      default:
        return undefined;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-card-grid": TillCardGrid;
  }
}
```

> **Implementer note:** resolve the four `../???` import paths by copying them verbatim from `till-counter-screen.ts`'s import block. Confirm `till-total`'s tag/import path (`./total.js`) and `station-queue`'s exported `CardProvider`/`CardOutcome` actually live in `tender-pay.js` (they do — `tender-pay.ts:49,56`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test card-grid`
Expected: PASS.

- [ ] **Step 5: Write the failing test — `visibleWhen` show/hide**

Add to `card-grid.test.ts`:

```ts
const heldTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [{ type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] }],
};

it("hides a held-orders card gated on has-parked when there are none", async () => {
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: heldTab, store, heldOrders: [] });
  expect(el.shadowRoot!.querySelector("till-held-orders")).toBeNull();
});

it("shows a held-orders card gated on has-parked when some exist", async () => {
  const store = new WorkingOrderStore();
  const held = [{ id: "wo-1", label: "Mesa 1", total: 100, lineCount: 1 }]; // match HeldOrderSummary
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: heldTab, store, heldOrders: held });
  expect(el.shadowRoot!.querySelector("till-held-orders")).not.toBeNull();
});
```

> **Implementer note:** copy a valid `HeldOrderSummary` fixture from `held-orders.test.ts` (`mesa`/`barra`, ~8-24) rather than the inline sketch above.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @waitron/till test card-grid`
Expected: PASS (both `visibleWhen` cases; implementation already handles them).

- [ ] **Step 7: Write the failing test — card events bubble**

Add to `card-grid.test.ts` (proves the host does not swallow a composed card event):

```ts
it("lets a held-orders retrieve event bubble through the grid host", async () => {
  const store = new WorkingOrderStore();
  const held = [{ id: "wo-2", label: "Barra", total: 200, lineCount: 2 }]; // match HeldOrderSummary
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: heldTab, store, heldOrders: held });
  let captured: CustomEvent<{ id: string }> | undefined;
  el.addEventListener("retrieve-order", (e) => (captured = e as CustomEvent<{ id: string }>));
  el.shadowRoot!
    .querySelector("till-held-orders")!
    .shadowRoot!.querySelector<HTMLElement>("wt-button.retrieve")!
    .click();
  expect(captured?.composed).toBe(true);
  expect(captured?.detail).toEqual({ id: "wo-2" });
});
```

- [ ] **Step 8: Run to verify pass**

Run: `pnpm --filter @waitron/till test card-grid`
Expected: PASS (events are composed+bubbling by construction; no host code needed).

- [ ] **Step 9: Add an a11y test (match the widget siblings)**

Create `apps/till/src/widgets/card-grid.a11y.test.ts` mirroring an existing `*.a11y.test.ts` (uses `expectNoA11yViolations` from `./test-helpers.js`), mounting `till-card-grid` with `counterTab` + a `WorkingOrderStore` and asserting no violations. Run: `pnpm --filter @waitron/till test card-grid.a11y` → PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/till/src/widgets/card-grid.ts apps/till/src/widgets/card-grid.test.ts apps/till/src/widgets/card-grid.a11y.test.ts
git commit -s -m "feat(till): add till-card-grid profile renderer (SP-B1)"
```

---

## Task 4: Counter screen renders from the profile's counter tab

**Files:**
- Modify: `apps/till/src/screens/till-counter-screen.ts`
- Test: `apps/till/src/screens/till-counter-screen.test.ts`

**Interfaces:**
- Consumes: `TabDef` (`../layout.js`); `<till-card-grid>` (Task 3).
- Produces: counter screen accepts `counterTab?: TabDef`; when set, its widget body is a `till-card-grid`; when unset, the existing region model renders (fallback).

- [ ] **Step 1: Write the failing test — grid path**

Add to `till-counter-screen.test.ts` (the file already has a `mount(over)` helper and `WorkingOrderStore`):

```ts
import type { TabDef } from "../layout.js";

const counterTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
    { type: "total", colSpan: 4, rowSpan: 1, config: {} },
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
  ],
};

it("renders the grid renderer when a counter tab is supplied", async () => {
  const { el } = await mount({ counterTab });
  expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull();
  // legacy region containers are gone in the grid path
  expect(el.shadowRoot!.querySelector(".region-aside")).toBeNull();
});

it("falls back to the region model when no counter tab is supplied", async () => {
  const { el } = await mount({});
  expect(el.shadowRoot!.querySelector("till-card-grid")).toBeNull();
  expect(el.shadowRoot!.querySelector(".region-main")).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test till-counter-screen`
Expected: FAIL — no `till-card-grid`; `counterTab` is not a property.

- [ ] **Step 3: Implement the grid path**

In `till-counter-screen.ts`:
- Add the side-effect import `import "../widgets/card-grid.js";` and `import type { TabDef } from "../layout.js";`.
- Add the property (near `layout`, ~190): `@property({ attribute: false }) counterTab?: TabDef;`.
- In `render()`'s body (`:309-377`), replace the two `.region-*` containers (the `inRegion(...).map(this.#widget)` blocks) with a branch: when `this.counterTab !== undefined`, render the menu-switcher + diet-filter (unchanged) followed by `<till-card-grid>` threading the same data the region `#widget` bindings used; otherwise keep the existing region markup. Keep the header chrome unchanged for both.

```ts
${this.counterTab !== undefined
  ? html`<till-card-grid
      .tab=${this.counterTab}
      .store=${this.store}
      .products=${this.#gridProducts()}
      .heldOrders=${this.heldOrders}
      .stationQueue=${this.stationQueue}
      .defaultStationId=${this.defaultStationId}
      .busy=${this.busy}
      .orderFlow=${this.orderFlow}
      .stage=${this.stage}
      .cardProvider=${this.cardProvider}
      .tipsEnabled=${this.tipsEnabled}
      .cardOutcome=${this.cardOutcome}
    ></till-card-grid>`
  : html`<!-- existing .region-main / .region-aside markup -->`}
```

> **Implementer note:** `#gridProducts()` (the diet-filtered products the counter computes) is passed as `products`, so `till-card-grid` stays dumb. Place the menu-switcher + diet-filter above the grid in the grid path. Keep the `#widget()` method and region markup intact for the fallback branch — do NOT delete them (that is B4).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test till-counter-screen`
Expected: PASS — both new tests, and all existing region-model tests (they mount without `counterTab`).

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/screens/till-counter-screen.ts apps/till/src/screens/till-counter-screen.test.ts
git commit -s -m "feat(till): counter renders from the profile counter tab, region fallback kept (SP-B1)"
```

---

## Task 5: Boot into the profile — `till-app` wiring

**Files:**
- Modify: `apps/till/src/till-app.ts`
- Test: `apps/till/src/till-app.test.ts`

**Interfaces:**
- Consumes: `TillInfo.profile?: ProfileDef` (Task 2); `ProfileDef`/`TabDef` (`./layout.js`); the counter screen's `counterTab` prop (Task 4).
- Produces: `till-app` reads `till.profile` at boot and threads the counter tab into the counter screen.

- [ ] **Step 1: Write the failing test — app boots the counter from a profile**

In `apps/till/src/till-app.test.ts` (uses a stub `TillApi`), add a test whose stub `getTill()` returns a `TillInfo` including a `profile` with a `counter` tab, drive boot + login to the counter screen, and assert the counter screen received a `counterTab`:

```ts
it("threads the profile's counter tab into the counter screen", async () => {
  // Build a stub TillApi whose getTill() resolves a TillInfo with a counter-tab profile,
  // and getDeviceIdentity() resolves a `till` identity. (Follow the existing stub pattern in
  // this file for the other TillInfo fields + login flow.)
  // After boot + reaching the "counter" screen:
  const counter = el.shadowRoot!.querySelector<HTMLElement & { counterTab?: unknown }>("till-counter-screen")!;
  expect(counter.counterTab).toMatchObject({ key: "counter", columns: 12 });
});
```

> **Implementer note:** copy this file's existing stub-`TillApi` construction and the boot/login sequence used by the current counter-screen test; only add `profile` to the `getTill()` return and the final `counterTab` assertion.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test till-app -t "counter tab"`
Expected: FAIL — `counterTab` is `undefined` (till-app doesn't read `till.profile` or thread it).

- [ ] **Step 3: Implement the wiring**

In `apps/till/src/till-app.ts`:
- Add the import: `import type { ProfileDef, TabDef } from "./layout.js";` (extend the existing `./layout.js` import).
- Add state near `receivedLayout` (~420): `@state() private profile?: ProfileDef;`.
- In `#boot()` after `this.receipt = till.receipt ?? {};` (~549): `this.profile = till.profile;`.
- Add a helper near `#layoutFor()` (~1793):

```ts
#counterTab(): TabDef | undefined {
  return this.profile?.tabs.find((tab) => tab.key === "counter");
}
```

- In the `case "counter"` block (~1896-1915), add `.counterTab=${this.#counterTab()}` to the `<till-counter-screen>` bindings.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test till-app -t "counter tab"`
Expected: PASS.

- [ ] **Step 5: Full till suite + coverage**

Run: `pnpm --filter @waitron/till test:coverage`
Expected: PASS at `95/95/90/88`.

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/till-app.ts apps/till/src/till-app.test.ts
git commit -s -m "feat(till): boot the counter into its layout profile (SP-B1)"
```

---

## Final verification (before PR)

- [ ] **Whole-workspace gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] **Scoped coverage:** `pnpm --filter @waitron/server test:coverage` and `pnpm --filter @waitron/till test:coverage`.
- [ ] **No fiscal regression (cheap guard even though B1 is non-fiscal):** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (no schema change, so it must stay green).
- [ ] **Manual smoke (optional):** `pnpm dev:setup && pnpm dev`, open the till (PIN 5555); the counter renders its cards from the seeded till profile.
- [ ] Confirm a cookieless `GET /api/till` still omits `profile` (Task 1 no-cookie test is the guard).

---

## Self-Review notes (author)

- **Spec coverage:** B1 items from spec §2/§4.1 — grid renderer (Task 3), boot into profile (Task 5), counter renders small cards (Task 4), form-factor fallback (Task 1), local mirror types (Task 2). Deliberately deferred to B2 and recorded in Global Constraints: the tab shell + nav rewrite, wrapping bespoke screens, capability→absent, permission→locked.
- **Sale-path invariant:** all placed counter cards render (no capability/permission gating in B1); tender-pay always present. Task 4 keeps the region fallback so an unprofiled boot is unaffected.
- **Type consistency:** `deviceFormFactor` (Task 1) and the mirror `FormFactor`/`ProfileDef`/`TabDef`/`CardInstance`/`CardType` (Task 2) are used unchanged in Tasks 3-5; `till-card-grid`'s prop names match the counter screen's `#widget` bindings verbatim.
- **Known implementer lookups (flagged inline):** exact import paths for `TillProduct`/`HeldOrderSummary`/`StationQueueGroup`/`OrderFlow`/`WorkingOrderStore` (copy from `till-counter-screen.ts`); a valid `HeldOrderSummary` fixture (copy from `held-orders.test.ts`); the stub-`TillApi` + login sequence in `till-app.test.ts`.
- **Row-height model:** fluid `grid-auto-rows: minmax(0, 1fr)` with `height: 100%` makes both axes proportional (matches the "fluid, no reflow" decision); a tuning point, not a correctness one — tests assert span styles, not pixels.
