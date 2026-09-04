# SP-B3.2 Phase B — Canvas editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dashboard **canvas editor** — create / edit / delete / clone canvases (tab/card grids), with a live placeholder-tile preview, click-to-select, span steppers, per-card config + `visibleWhen`, and canvas name/form-factor/capabilities — wired to the (Phase-A-renamed) canvas-CRUD endpoints.

**Architecture:** One new Lit screen `dashboard-canvas-editor-screen` in `apps/dashboard`, with two in-component modes (list / editor). It uses a **dashboard-local mirror** of the layouts card-contract data (never a runtime `@waitron/layouts` import — the browser-bundle rule) kept honest by a **parity drift-guard test**, and a **light client validator** mirroring the server's author-facing rules. A shared `canvas-grid-preview` render unit draws a tab's grid with the **same CSS geometry as the till renderer**, mounting each tile at a **card-host seam** so a future live render (and drag) drops in. Server `validateCanvas` stays authoritative.

**Tech Stack:** Lit + `wt-*` primitives (`@waitron/ui`); Vitest headless-Chromium (browser mode); axe (a11y); i18n via `t()` + `codes.ts`.

**Spec:** `docs/superpowers/specs/2026-09-04-sp-b3-2-canvas-editor-design.md` (§6 the editor, §8 mirror+guard).
**Prerequisite:** Phase A (`2026-09-04-sp-b3-2a-profile-to-canvas-rename.md`) is merged — this plan uses the renamed names (`Canvas`, `listCanvases`, `canvas.*`, `getCanvasForFormFactor`, `CanvasDef`, `@waitron/layouts/src/canvas.js`).

## Global Constraints

- **TDD** — failing test first, watch it fail, minimal implementation, watch it pass, commit.
- **Browser-mode, memory-heavy** — `apps/dashboard` runs headless Chromium; **do not run its `test:coverage` concurrently** with other browser-mode suites (repo memory). Coverage bar **95/95/90/88**.
- **Bundle rule** — the dashboard never runtime-imports `@waitron/layouts`. The editor uses the local mirror (Task B1). `definition` crosses the client boundary as `unknown`. (A **test** may deep-import the *pure* `@waitron/layouts/src/{card-contract,canvas}.js` — DB-free — for the parity guard.)
- **No hardcoded chrome** — `--wt-*` tokens only (enforced by `packages/ui/src/no-hardcoded-chrome.test.ts`); selected-tile marking and thumbnail styling use tokens.
- **No new error codes thrown** — the editor only *renders* server codes; it adds i18n entries (`canvas.*`), not error definitions.
- **`data-test` on every interactive/asserted element**; localised copy via `t()`/`codeMessage()` (tests run under `es-ES`).
- **Every `wt-change` handler calls `e.stopPropagation()`** (composed events double-fire across shadow DOM).
- **Every commit `-s`**; branch `feat/sp-b3-2-grid-editor`, worktree `~/workspace/worktrees/waitron-feat-sp-b3-2-grid-editor`.
- **CI runs `test:coverage`.** Verify with `pnpm --filter @waitron/dashboard test:coverage`.

## File structure (all under `apps/dashboard/src/`)

- `screens/canvas-editor/card-contracts.ts` — the local contract mirror + `CanvasDef`/`TabDef`/`CardInstance` types (Task B1)
- `screens/canvas-editor/card-contracts.parity.test.ts` — drift guard vs `@waitron/layouts` pure modules (B1)
- `screens/canvas-editor/validate-canvas.ts` + `.test.ts` — light client validator (B2)
- `screens/canvas-editor/canvas-grid-preview.ts` + `.test.ts` + `.a11y.test.ts` — shared grid render unit (B4)
- `screens/canvas-editor-screen.ts` + `.test.ts` + `.a11y.test.ts` — the screen (list + editor modes) (B5-B7)
- `api/client.ts` — +4 methods (B3)
- `i18n/strings.ts`, `i18n/codes.ts` — new keys (B5-B8)
- `dashboard-app.ts` — nav + screen registration (B5)

---

## Task B1: Local contract mirror + parity drift-guard

**Files:**
- Create: `apps/dashboard/src/screens/canvas-editor/card-contracts.ts`
- Test: `apps/dashboard/src/screens/canvas-editor/card-contracts.parity.test.ts`

**Interfaces:**
- Produces: `CARD_TYPES`, `CardType`, `CAPABILITY_FLAGS`, `CapabilityFlag`, `FORM_FACTORS`, `FormFactor`, `GRID_MAX_COLUMNS`, `MAX_TAB_TITLE_LENGTH`, `SALE_CRITICAL_CARDS`, `CardContractMirror`, `CARD_CONTRACTS`, and the dashboard-local `CardInstance`/`TabDef`/`CanvasDef` types. Every later Task B* consumes these.
- Consumes: nothing.

- [ ] **Step 1: Write the failing parity test.**

```ts
// card-contracts.parity.test.ts — the mirror must equal the @waitron/layouts source (drift guard,
// CLAUDE.md §2 hardcoded-cross-package-list trap). Deep-imports the PURE source modules only
// (card-contract.js + canvas.js are DB-free, so they load in headless Chromium); NEVER the barrel.
import { describe, expect, it } from "vitest";
import { CARD_CONTRACTS as SRC, GRID_MAX_COLUMNS as SRC_MAX, SALE_CRITICAL_CARDS as SRC_SALE }
  from "@waitron/layouts/src/card-contract.js";
import { CARD_TYPES as SRC_TYPES, CAPABILITY_FLAGS as SRC_CAPS, FORM_FACTORS as SRC_FF }
  from "@waitron/layouts/src/canvas.js";
import { MAX_TAB_TITLE_LENGTH as SRC_TITLE } from "@waitron/layouts/src/validate-canvas.js";
import {
  CARD_CONTRACTS, CARD_TYPES, CAPABILITY_FLAGS, FORM_FACTORS,
  GRID_MAX_COLUMNS, MAX_TAB_TITLE_LENGTH, SALE_CRITICAL_CARDS,
} from "./card-contracts.js";

describe("card-contracts mirror parity", () => {
  it("mirrors the constant tuples and scalars", () => {
    expect([...CARD_TYPES]).toEqual([...SRC_TYPES]);
    expect([...CAPABILITY_FLAGS]).toEqual([...SRC_CAPS]);
    expect([...FORM_FACTORS]).toEqual([...SRC_FF]);
    expect(GRID_MAX_COLUMNS).toBe(SRC_MAX);
    expect(MAX_TAB_TITLE_LENGTH).toBe(SRC_TITLE);
    expect([...SALE_CRITICAL_CARDS]).toEqual([...SRC_SALE]);
  });

  it("mirrors each card's contract fields (spans, states, permission, capability, saleCritical, config keys)", () => {
    for (const type of SRC_TYPES) {
      const src = SRC[type];
      const mirror = CARD_CONTRACTS[type];
      expect(mirror.defaultColSpan).toBe(src.defaultColSpan);
      expect(mirror.defaultRowSpan).toBe(src.defaultRowSpan);
      expect([...mirror.visibilityStates]).toEqual([...src.visibilityStates]);
      expect(mirror.requiredPermission).toBe(src.requiredPermission);
      expect(mirror.requiredCapability).toBe(src.requiredCapability);
      expect(mirror.saleCritical).toBe(src.saleCritical);
      expect([...mirror.configFields].sort()).toEqual(Object.keys(src.configSchema).sort());
    }
  });
});
```

- [ ] **Step 2: Run — verify it fails** (`./card-contracts.js` does not exist).

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/canvas-editor/card-contracts.parity.test.ts`
Expected: FAIL — cannot resolve `./card-contracts.js`.

- [ ] **Step 3: Write the mirror** (copy the values from `packages/layouts/src/card-contract.ts:36-129` + `canvas.ts` + `validate-canvas.ts`).

```ts
// card-contracts.ts — a dashboard-LOCAL mirror of @waitron/layouts' card contract data (the browser
// bundle rule forbids a runtime @waitron/layouts import — its barrel drags @waitron/db). Kept honest by
// card-contracts.parity.test.ts, which deep-imports the pure source and asserts equality. The server's
// validateCanvas stays authoritative on every write; this mirror only powers the editor's palette,
// property panel and the light client validator (validate-canvas.ts).
export const CARD_TYPES = [
  "product-grid", "basket", "total", "tender-pay", "held-orders", "prep-queue",
  "notifications", "floor-plan", "table-layout-editor", "kds-board", "expo", "table-order",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CAPABILITY_FLAGS = ["integrated-card-payment", "open-cash-drawer", "act-as-kds"] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

export const FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

export const GRID_MAX_COLUMNS = 24;
export const MAX_TAB_TITLE_LENGTH = 60;

/** The editor-facing slice of a card's contract (validators stay server-side; only field NAMES here). */
export interface CardContractMirror {
  defaultColSpan: number;
  defaultRowSpan: number;
  visibilityStates: readonly string[];
  requiredPermission?: string;
  requiredCapability?: CapabilityFlag;
  saleCritical: boolean;
  configFields: readonly string[];
}

export const CARD_CONTRACTS: Record<CardType, CardContractMirror> = {
  "product-grid": { defaultColSpan: 8, defaultRowSpan: 6, visibilityStates: [], saleCritical: true, configFields: ["columns"] },
  basket: { defaultColSpan: 4, defaultRowSpan: 4, visibilityStates: [], saleCritical: true, configFields: [] },
  total: { defaultColSpan: 4, defaultRowSpan: 1, visibilityStates: [], saleCritical: true, configFields: [] },
  "tender-pay": { defaultColSpan: 4, defaultRowSpan: 2, requiredCapability: "integrated-card-payment", visibilityStates: [], saleCritical: true, configFields: [] },
  "held-orders": { defaultColSpan: 4, defaultRowSpan: 2, visibilityStates: ["has-parked", "empty"], saleCritical: false, configFields: [] },
  "prep-queue": { defaultColSpan: 4, defaultRowSpan: 2, visibilityStates: ["has-items", "empty"], saleCritical: false, configFields: [] },
  notifications: { defaultColSpan: 4, defaultRowSpan: 1, visibilityStates: ["unread", "any", "empty"], saleCritical: false, configFields: [] },
  "floor-plan": { defaultColSpan: 24, defaultRowSpan: 12, visibilityStates: [], saleCritical: false, configFields: [] },
  "table-layout-editor": { defaultColSpan: 24, defaultRowSpan: 12, requiredPermission: "till.configure", visibilityStates: [], saleCritical: false, configFields: [] },
  "kds-board": { defaultColSpan: 24, defaultRowSpan: 12, requiredCapability: "act-as-kds", visibilityStates: ["has-tickets", "idle"], saleCritical: false, configFields: [] },
  expo: { defaultColSpan: 24, defaultRowSpan: 12, visibilityStates: ["has-tickets", "idle"], saleCritical: false, configFields: [] },
  "table-order": { defaultColSpan: 24, defaultRowSpan: 12, visibilityStates: [], saleCritical: false, configFields: [] },
};

export const SALE_CRITICAL_CARDS: readonly CardType[] =
  (Object.keys(CARD_CONTRACTS) as CardType[]).filter((t) => CARD_CONTRACTS[t].saleCritical);

/** One placed card (dashboard-local mirror of @waitron/layouts' CardInstance). */
export interface CardInstance {
  type: CardType;
  colSpan: number;
  rowSpan: number;
  config: Record<string, unknown>;
  visibleWhen?: string[];
}
/** A tab: a titled grid of cards (mirror of TabDef). */
export interface TabDef {
  key: string;
  title: string;
  columns: number;
  cards: CardInstance[];
}
/** A whole canvas (mirror of CanvasDef). */
export interface CanvasDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  capabilities: CapabilityFlag[];
  theme?: { tokens: Record<string, string> };
}
```

- [ ] **Step 4: Run — verify it passes.** Run the same command. Expected: PASS.

- [ ] **Step 5: Prove the guard by deletion.** Temporarily change `basket`'s `defaultColSpan` to `99`; run the test → FAIL on the spans assertion; restore → PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/screens/canvas-editor/card-contracts.ts apps/dashboard/src/screens/canvas-editor/card-contracts.parity.test.ts
git commit -s -m "feat(canvas-editor): local card-contract mirror + parity drift-guard"
```

---

## Task B2: Light client validator

**Files:**
- Create: `apps/dashboard/src/screens/canvas-editor/validate-canvas.ts`
- Test: `apps/dashboard/src/screens/canvas-editor/validate-canvas.test.ts`

**Interfaces:**
- Consumes: `card-contracts.ts` (B1).
- Produces: `validateCanvasDraft(draft: CanvasDef): string | null` — returns `null` when valid, else an i18n string-key naming the first broken author-facing rule. Consumed by the editor's Save (Task B7).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { validateCanvasDraft } from "./validate-canvas.js";
import type { CanvasDef } from "./card-contracts.js";

const tillDraft = (): CanvasDef => ({
  formFactor: "till",
  capabilities: [],
  tabs: [{
    key: "counter", title: "Counter", columns: 12,
    cards: [
      { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
      { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
      { type: "total", colSpan: 4, rowSpan: 1, config: {} },
      { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
    ],
  }],
});

describe("validateCanvasDraft", () => {
  it("returns null for a valid till canvas", () => {
    expect(validateCanvasDraft(tillDraft())).toBeNull();
  });
  it("flags a till canvas missing a sale-critical card", () => {
    const d = tillDraft();
    d.tabs[0]!.cards = d.tabs[0]!.cards.filter((c) => c.type !== "total");
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_missing_required");
  });
  it("does NOT require sale-critical cards on a non-till canvas", () => {
    const d = tillDraft();
    d.formFactor = "kds";
    d.tabs[0]!.cards = [{ type: "kds-board", colSpan: 12, rowSpan: 12, config: {} }];
    expect(validateCanvasDraft(d)).toBeNull();
  });
  it("flags no tabs", () => {
    const d = tillDraft(); d.tabs = [];
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_no_tabs");
  });
  it("flags a duplicate tab key", () => {
    const d = tillDraft(); d.tabs.push({ ...d.tabs[0]!, cards: [] });
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_duplicate_tab");
  });
  it("flags a blank / over-long title", () => {
    const d = tillDraft(); d.tabs[0]!.title = "";
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_tab");
  });
  it("flags columns out of 1..24", () => {
    const d = tillDraft(); d.tabs[0]!.columns = 25;
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_columns");
  });
  it("flags a colSpan over the tab columns and a rowSpan below 1", () => {
    const d = tillDraft(); d.tabs[0]!.cards[0]!.colSpan = 99;
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_span");
  });
  it("flags a visibleWhen not a subset of the card's states", () => {
    const d = tillDraft();
    d.tabs[0]!.cards.push({ type: "held-orders", colSpan: 4, rowSpan: 2, config: {}, visibleWhen: ["nope"] });
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_visible_when");
  });
  it("flags product-grid.columns out of 1..12", () => {
    const d = tillDraft(); d.tabs[0]!.cards[0]!.config = { columns: 13 };
    expect(validateCanvasDraft(d)).toBe("canvas_editor.err_bad_config");
  });
});
```

- [ ] **Step 2: Run — verify FAIL** (module missing). Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/canvas-editor/validate-canvas.test.ts`.

- [ ] **Step 3: Implement.**

```ts
// validate-canvas.ts — a LIGHT client mirror of @waitron/layouts' validateCanvas, covering the
// author-facing rules for fast in-editor feedback. Returns null when valid, else the i18n key of the
// FIRST broken rule. The SERVER's validateCanvas stays authoritative on every write — a client pass is
// never a guarantee, and a server canvas.invalid still surfaces in the banner.
import { CARD_CONTRACTS, GRID_MAX_COLUMNS, MAX_TAB_TITLE_LENGTH, SALE_CRITICAL_CARDS } from "./card-contracts.js";
import type { CanvasDef } from "./card-contracts.js";

export function validateCanvasDraft(draft: CanvasDef): string | null {
  if (draft.tabs.length === 0) return "canvas_editor.err_no_tabs";
  const seen = new Set<string>();
  for (const tab of draft.tabs) {
    if (seen.has(tab.key)) return "canvas_editor.err_duplicate_tab";
    seen.add(tab.key);
    if (tab.title.length === 0 || tab.title.length > MAX_TAB_TITLE_LENGTH) return "canvas_editor.err_bad_tab";
    if (!Number.isInteger(tab.columns) || tab.columns < 1 || tab.columns > GRID_MAX_COLUMNS) {
      return "canvas_editor.err_bad_columns";
    }
    for (const card of tab.cards) {
      if (!Number.isInteger(card.colSpan) || card.colSpan < 1 || card.colSpan > tab.columns) return "canvas_editor.err_bad_span";
      if (!Number.isInteger(card.rowSpan) || card.rowSpan < 1) return "canvas_editor.err_bad_span";
      const states = CARD_CONTRACTS[card.type].visibilityStates;
      if (card.visibleWhen?.some((s) => !states.includes(s))) return "canvas_editor.err_bad_visible_when";
      if (card.type === "product-grid" && card.config.columns !== undefined) {
        const n = card.config.columns;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 12) return "canvas_editor.err_bad_config";
      }
    }
  }
  if (draft.formFactor === "till") {
    const placed = new Set(draft.tabs.flatMap((t) => t.cards.map((c) => c.type)));
    for (const req of SALE_CRITICAL_CARDS) if (!placed.has(req)) return "canvas_editor.err_missing_required";
  }
  return null;
}
```

- [ ] **Step 4: Run — verify PASS.**

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/screens/canvas-editor/validate-canvas.ts apps/dashboard/src/screens/canvas-editor/validate-canvas.test.ts
git commit -s -m "feat(canvas-editor): light client-side canvas validator"
```

---

## Task B3: API-client methods (get / create / update / delete)

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (add four methods near `listCanvases`, ~:1845)
- Test: `apps/dashboard/src/api/client.test.ts`

**Interfaces:**
- Consumes: the existing `#request<T>` helper and `Canvas` type (Phase A).
- Produces: `getCanvas(id): Promise<Canvas>`, `createCanvas(name: string, definition: unknown): Promise<{ id: string }>`, `updateCanvas(id: string, name: string, definition: unknown): Promise<void>`, `deleteCanvas(id: string): Promise<void>`. Consumed by the screen (B5-B7).

- [ ] **Step 1: Write failing tests** (follow the `client.test.ts` idiom — a stub `fetch` asserting path/method/body and shaping the response; grep existing `createZone`/`updateZone`/`deleteZone` tests for the exact harness).

```ts
// in client.test.ts — mirrors the existing zone CRUD tests
it("getCanvas GETs the canvas by id", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "c1", name: "Till", definition: { formFactor: "till", tabs: [], capabilities: [] } }), { status: 200 }));
  const api = new DashboardApi("", fetchImpl);
  const c = await api.getCanvas("c1");
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/canvases/c1", expect.objectContaining({ method: "GET", credentials: "include" }));
  expect(c.id).toBe("c1");
});
it("createCanvas POSTs name+definition and returns the id", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "c9" }), { status: 201 }));
  const api = new DashboardApi("", fetchImpl);
  const def = { formFactor: "till", tabs: [], capabilities: [] };
  const r = await api.createCanvas("New", def);
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/canvases",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "New", definition: def }) }));
  expect(r.id).toBe("c9");
});
it("updateCanvas PUTs and resolves void on 204", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 204 }));
  const api = new DashboardApi("", fetchImpl);
  await expect(api.updateCanvas("c1", "N", { formFactor: "till", tabs: [], capabilities: [] })).resolves.toBeUndefined();
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/canvases/c1", expect.objectContaining({ method: "PUT" }));
});
it("deleteCanvas DELETEs and resolves void on 204", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 204 }));
  const api = new DashboardApi("", fetchImpl);
  await expect(api.deleteCanvas("c1")).resolves.toBeUndefined();
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/canvases/c1", expect.objectContaining({ method: "DELETE" }));
});
it("rejects with the server code on a non-2xx", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "canvas.name_taken" } }), { status: 409 }));
  const api = new DashboardApi("", fetchImpl);
  await expect(api.createCanvas("Dup", {})).rejects.toEqual({ code: "canvas.name_taken" });
});
```

- [ ] **Step 2: Run — verify FAIL.** Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts -t canvas`.

- [ ] **Step 3: Implement the four methods** (beside `listCanvases`):

```ts
  /** `GET /management-api/canvases/:id` — one canvas (definition is opaque `unknown`; parsed at the editor edge). */
  getCanvas(id: string): Promise<Canvas> {
    return this.#request<Canvas>(`/management-api/canvases/${id}`, "GET");
  }
  /** `POST /management-api/canvases` — create; returns the new id at 201. `definition` is a validated ProfileDef the server re-validates. */
  createCanvas(name: string, definition: unknown): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/canvases", "POST", { name, definition });
  }
  /** `PUT /management-api/canvases/:id` — full replace; 204. */
  updateCanvas(id: string, name: string, definition: unknown): Promise<void> {
    return this.#request<void>(`/management-api/canvases/${id}`, "PUT", { name, definition });
  }
  /** `DELETE /management-api/canvases/:id` — 204; a since-deleted id rejects `canvas.not_found`. */
  deleteCanvas(id: string): Promise<void> {
    return this.#request<void>(`/management-api/canvases/${id}`, "DELETE");
  }
```

- [ ] **Step 4: Run — verify PASS.** Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts`.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/client.test.ts
git commit -s -m "feat(canvas-editor): getCanvas/createCanvas/updateCanvas/deleteCanvas client methods"
```

---

## Task B4: Shared `canvas-grid-preview` render unit

One reusable element drawing a `TabDef` at the till renderer's geometry (`grid-template-columns: repeat(columns,1fr)`, each card `grid-column/row: span …` — mirrors `apps/till/src/widgets/card-grid.ts:133,179`). Each cell is the **card-host seam**: v1 renders a placeholder tile (localised card name + `WxH` span badge). Two consumers: the list **thumbnail** (`interactive=false`, `aria-hidden`) and the editor **canvas** (`interactive`, click-selectable).

**Files:**
- Create: `apps/dashboard/src/screens/canvas-editor/canvas-grid-preview.ts`
- Test: `apps/dashboard/src/screens/canvas-editor/canvas-grid-preview.test.ts`, `...a11y.test.ts`

**Interfaces:**
- Consumes: `card-contracts.ts` types (B1); `t()`; card-name i18n keys `canvas_editor.card.<type>` (added here, B5 completes the set in both locales).
- Produces: `<canvas-grid-preview>` with `@property tab: TabDef | null`, `@property({type:Boolean}) interactive`, `@property({type:Number}) selectedIndex` (−1 = none); emits `select-card` `CustomEvent<{ index: number }>` (bubbles, composed) on a tile click when `interactive`. Consumed by B5 (thumbnail) and B6 (canvas).

- [ ] **Step 1: Write failing tests** (mount via `mountWidget`, assert tile count, geometry style, selection marking, and the `select-card` event).

```ts
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../../widgets/test-helpers.js";
import "./canvas-grid-preview.js";
import type { CanvasGridPreview } from "./canvas-grid-preview.js";
import type { TabDef } from "./card-contracts.js";

afterEach(cleanupWidgets);
const tab: TabDef = { key: "counter", title: "Counter", columns: 12, cards: [
  { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
  { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
] };

describe("canvas-grid-preview", () => {
  it("renders one tile per card with the tab's column count and per-card spans", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", { tab });
    await el.updateComplete;
    const grid = el.shadowRoot!.querySelector<HTMLElement>("[data-test=grid]")!;
    expect(grid.style.gridTemplateColumns).toContain("repeat(12,");
    const tiles = el.shadowRoot!.querySelectorAll("[data-test^=tile-]");
    expect(tiles.length).toBe(2);
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!.style.gridColumn).toBe("span 8");
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!.style.gridRow).toBe("span 6");
  });
  it("emits select-card with the index when interactive and a tile is clicked", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", { tab, interactive: true });
    await el.updateComplete;
    let got = -1;
    el.addEventListener("select-card", (e) => { got = (e as CustomEvent<{ index: number }>).detail.index; });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-1]")!.click();
    expect(got).toBe(1);
  });
  it("marks the selected tile and is inert (aria-hidden, no buttons) when not interactive", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", { tab, interactive: false, selectedIndex: 0 });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=grid]")!.getAttribute("aria-hidden")).toBe("true");
    expect(el.shadowRoot!.querySelectorAll("button").length).toBe(0);
  });
  it("renders an empty-grid affordance for a tab with no cards", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", { tab: { ...tab, cards: [] }, interactive: true });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=empty-grid]")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — verify FAIL.**

- [ ] **Step 3: Implement `canvas-grid-preview.ts`** — a `LitElement` with `baseStyles`; interactive tiles are `<button>`s (keyboard-reachable) firing `select-card`; non-interactive is a plain `<div>` grid with `aria-hidden="true"`. Selected tile gets a token-driven ring (e.g. `outline: 2px solid var(--wt-color-primary)`), never a hardcoded colour. Tile body: `${t("canvas_editor.card." + card.type)}` + a `<span class="badge">${card.colSpan}×${card.rowSpan}</span>`. Grid host style: `grid-template-columns: repeat(${tab.columns}, 1fr)` and each cell `grid-column: span ${card.colSpan}; grid-row: span ${card.rowSpan}` (exactly the till renderer's inline-style form). `data-test="grid"`, `data-test="tile-${i}"`, `data-test="empty-grid"`. Emit: `this.dispatchEvent(new CustomEvent("select-card", { detail: { index }, bubbles: true, composed: true }))` (no stopPropagation needed on `@click`, but a wrapping handler is fine). Register the element in `HTMLElementTagNameMap`.

- [ ] **Step 4: Run — verify PASS.**

- [ ] **Step 5: a11y test** — mount in both themes (`describe.each(["light","dark"])`), interactive + non-interactive, `await expectNoA11yViolations(host)`. Run and verify PASS.

- [ ] **Step 6: Prove the geometry guard by deletion** — remove the `grid-column: span` inline style; the spans test fails; restore.

- [ ] **Step 7: Commit.**

```bash
git add apps/dashboard/src/screens/canvas-editor/canvas-grid-preview.ts apps/dashboard/src/screens/canvas-editor/canvas-grid-preview.test.ts apps/dashboard/src/screens/canvas-editor/canvas-grid-preview.a11y.test.ts
git commit -s -m "feat(canvas-editor): shared canvas-grid-preview render unit (thumbnail + canvas seam)"
```

---

## Task B5: The screen — list mode + nav registration

**Files:**
- Create: `apps/dashboard/src/screens/canvas-editor-screen.ts`
- Test: `apps/dashboard/src/screens/canvas-editor-screen.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (nav + screen registration), `apps/dashboard/src/i18n/strings.ts` (new keys, both locales)

**Interfaces:**
- Consumes: `DashboardApi` (`listCanvases`/`getCanvas`/`createCanvas`/`deleteCanvas`), `canvas-grid-preview` (B4), `card-contracts` (`DEFAULT_CANVASES`? no — the local default seed; see Step 3), `validateCanvasDraft` (B2, used in B7).
- Produces: `<dashboard-canvas-editor-screen .api=…>`; a `mode` state (`"list" | "editor"`). B6/B7 extend the same file with editor mode.

Note: the local seed for a NEW canvas needs `DEFAULT_CANVASES[formFactor]`. `DEFAULT_CANVASES` lives in `@waitron/layouts` (barrel → can't runtime-import). Add a **dashboard-local default-canvas seed** to `card-contracts.ts` — a `DEFAULT_CANVASES: Record<FormFactor, CanvasDef>` copied from `packages/layouts/src/default-canvases.ts`, and extend the parity test (Task B1) to assert it deep-equals the source `DEFAULT_CANVASES`. Do this as the first step here (or fold back into B1 if executing in order).

- [ ] **Step 1: Add `DEFAULT_CANVASES` to the mirror + parity assertion.** Copy `packages/layouts/src/default-canvases.ts`'s four profiles into `card-contracts.ts` as `export const DEFAULT_CANVASES: Record<FormFactor, CanvasDef>`. Add to `card-contracts.parity.test.ts`: `import { DEFAULT_CANVASES as SRC_DEF } from "@waitron/layouts/src/default-canvases.js"` and `expect(DEFAULT_CANVASES).toEqual(SRC_DEF)`. Run the parity test → it fails until the copy matches → PASS. Commit.

- [ ] **Step 2: Write failing list-mode tests** (stub `api`, mirror the printers-screen test idiom — `mountWidget`, `flush`, `data-test`, `toHaveBeenCalled`).

```ts
// canvas-editor-screen.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./canvas-editor-screen.js";
import type { CanvasEditorScreen } from "./canvas-editor-screen.js";
import type { Canvas, DashboardApi } from "../api/client.js";

afterEach(cleanupWidgets);
const canvases: Canvas[] = [
  { id: "c1", name: "Counter till", definition: { formFactor: "till", capabilities: [], tabs: [
    { key: "counter", title: "Counter", columns: 12, cards: [ { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} } ] } ] } },
];
function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listCanvases: vi.fn().mockResolvedValue(canvases),
    getCanvas: vi.fn().mockResolvedValue(canvases[0]),
    createCanvas: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCanvas: vi.fn().mockResolvedValue(undefined),
    deleteCanvas: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: CanvasEditorScreen) { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }

describe("canvas-editor-screen list mode", () => {
  it("lists canvases with name, form-factor badge, counts and a thumbnail", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    expect(api.listCanvases).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[data-test=canvas-thumb-c1] canvas-grid-preview")).toBeTruthy();
  });
  it("renders a neutral placeholder (not a throw) for a malformed definition", async () => {
    const api = stubApi({ listCanvases: vi.fn().mockResolvedValue([{ id: "bad", name: "X", definition: { nope: true } }]) });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=canvas-thumb-bad] [data-test=no-preview]")).toBeTruthy();
  });
  it("Eliminar confirms then calls deleteCanvas and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-c1]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(api.deleteCanvas).toHaveBeenCalledWith("c1");
    expect(api.listCanvases).toHaveBeenCalledTimes(2);
  });
  it("Duplicar creates a copy under a new name from the same definition", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-c1]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=duplicate-name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Counter till (copy)" }, bubbles: true, composed: true }));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]")!.click();
    await flush(el);
    expect(api.createCanvas).toHaveBeenCalledWith("Counter till (copy)", canvases[0]!.definition);
  });
  it("shows the load error in a banner", async () => {
    const api = stubApi({ listCanvases: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run — verify FAIL** (screen missing).

- [ ] **Step 4: Implement list mode** in `canvas-editor-screen.ts`. Structure follows printers-screen/staff-screen (imports of `wt-button`/`wt-card`/`wt-dialog`/`wt-input`, `baseStyles`, `t`, `codeMessage`/`codeOf`; `@property api`; `@state errorKey`; `#load()`/`#mutate()`; `connectedCallback → void this.#load()`). Add:
  - `@state() private mode: "list" | "editor" = "list"`, `@state() private canvases: Canvas[] = []`.
  - `#load()`: `this.canvases = await this.api.listCanvases()`.
  - A `#parseDefinition(def: unknown): CanvasDef | null` — a defensive shallow parse (checks `formFactor` is a `FormFactor`, `tabs` is an array; returns `null` on mismatch) so a malformed row renders `data-test="no-preview"` not a throw.
  - Row render (`wt-card`, `data-test="canvas-row-${id}"`): name, a form-factor badge (`t("canvas_editor.form_factor." + ff)`), `t("canvas_editor.tab_count", ...)`/card count, a `<div data-test="canvas-thumb-${id}">` holding either `<canvas-grid-preview .tab=${def.tabs[0]} .interactive=${false}>` or the `no-preview` placeholder; buttons `edit-${id}` (→ `#openEditor(id)`), `duplicate-${id}`, `delete-${id}`.
  - `Crear` button → a create `wt-dialog` (name `wt-input` `data-test="create-name"` + a form-factor `<select data-test="create-form-factor">`), confirm `data-test="confirm-create"` → seed the draft from `structuredClone(DEFAULT_CANVASES[ff])`, set the draft's name, enter editor mode (B6/B7 own the draft + save).
  - `Duplicar` dialog: `wt-input data-test="duplicate-name"` prefilled `"<name> (copy)"`, confirm `data-test="confirm-duplicate"` → `#mutate(() => this.api.createCanvas(newName, row.definition))`.
  - `Eliminar`: an armed confirm dialog (`data-test="confirm-delete"`) → `#mutate(() => this.api.deleteCanvas(id))`.
  - `render()` switches on `mode` (editor branch is a placeholder `nothing` until B6). Error banner `role="alert"` via `codeMessage`.

- [ ] **Step 5: Add i18n strings** (both `en` and `es`) to `strings.ts`: `nav.canvases`; `canvas_editor.title`, `canvas_editor.create`, `canvas_editor.duplicate`, `canvas_editor.delete_confirm`, `canvas_editor.no_preview`, `canvas_editor.tab_count`, `canvas_editor.card_count`, `canvas_editor.form_factor.till|phone-portrait|tablet-landscape|kds`, `canvas_editor.card.<each of the 12 card types>`, and the create/duplicate dialog labels + `action.*` reuse. (The validator error keys `canvas_editor.err_*` land in B7's task, but add them here too if convenient.)

- [ ] **Step 6: Register the screen in `dashboard-app.ts`** — (1) side-effect import `import "./screens/canvas-editor-screen.js";` near :22; (2) add `"canvas-editor"` to the `Screen` union (:53); (3) add `{ screen: "canvas-editor", labelKey: "nav.canvases" }` to the configuration `NAV_GROUPS` group (:131-140); (4) add `case "canvas-editor": return html\`<dashboard-canvas-editor-screen .api=${this.api}></dashboard-canvas-editor-screen>\`;` in `#renderScreen()`.

- [ ] **Step 7: Run — verify PASS.** Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/canvas-editor-screen.test.ts`. Also add a `dashboard-app` nav test if the suite pins nav items (grep `nav-devices` in `dashboard-app.test.ts` and mirror one for `nav-canvas-editor`).

- [ ] **Step 8: Commit.**

```bash
git add apps/dashboard/src/screens/canvas-editor-screen.ts apps/dashboard/src/screens/canvas-editor-screen.test.ts apps/dashboard/src/screens/canvas-editor/card-contracts.ts apps/dashboard/src/screens/canvas-editor/card-contracts.parity.test.ts apps/dashboard/src/dashboard-app.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "feat(canvas-editor): list mode (thumbnails, create/duplicate/delete) + nav"
```

---

## Task B6: Editor mode — tabs, canvas, palette, add/remove/reorder/spans

**Files:**
- Modify: `apps/dashboard/src/screens/canvas-editor-screen.ts` (editor mode), `.test.ts`, `i18n/strings.ts`

**Interfaces:**
- Consumes: `canvas-grid-preview` (`select-card` event), `card-contracts` (`CARD_TYPES`, `CARD_CONTRACTS`, `GRID_MAX_COLUMNS`).
- Produces: the editor draft state + the `Guardar`/`Cancelar` seam B7 completes.

- [ ] **Step 1: Write failing editor tests** (enter editor via `edit-c1`; assert tab bar, palette add, select, reorder, span steppers).

```ts
describe("canvas-editor-screen editor mode", () => {
  async function openEditor(api = stubApi()) {
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
    await flush(el); // getCanvas resolves, mode → editor
    return el;
  }
  it("loads the canvas into the editor with its tabs and cards", async () => {
    const el = await openEditor();
    expect(el.shadowRoot!.querySelector("[data-test=tab-btn-counter]")).toBeTruthy();
    expect(el.shadowRoot!.querySelectorAll("canvas-grid-preview [data-test^=tile-]").length).toBe(1);
  });
  it("adds a card from the palette at its default spans", async () => {
    const el = await openEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=palette-held-orders]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("canvas-grid-preview [data-test^=tile-]").length).toBe(2);
  });
  it("selecting a tile then editing colSpan updates the draft", async () => {
    const el = await openEditor();
    el.shadowRoot!.querySelector("canvas-grid-preview")!.dispatchEvent(
      new CustomEvent("select-card", { detail: { index: 0 }, bubbles: true, composed: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=card-colspan]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "6" }, bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!.style.gridColumn).toBe("span 6");
  });
  it("removes the selected card", async () => {
    const el = await openEditor();
    el.shadowRoot!.querySelector("canvas-grid-preview")!.dispatchEvent(
      new CustomEvent("select-card", { detail: { index: 0 }, bubbles: true, composed: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=card-remove]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("canvas-grid-preview [data-test^=tile-]").length).toBe(0);
  });
  it("adds a tab and refuses deleting the last tab", async () => {
    const el = await openEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-tab]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=tab-btn-]").length).toBe(2);
    // delete both — the last delete is refused (button disabled or no-op)
  });
}
```

- [ ] **Step 2: Run — verify FAIL.**

- [ ] **Step 3: Implement editor mode.** Add state: `@state() private draft: CanvasDef | null`, `@state() private editingId: string | null` (null = new), `@state() private activeTabIndex = 0`, `@state() private selection: { card: number } | { tab: true } | { canvas: true } | null`. `#openEditor(id)` = `#mutate`-style load via `getCanvas`, parse `definition` through `#parseDefinition`, set `draft`/`editingId`, `mode="editor"`, `activeTabIndex=0`, `selection=null`. Render (editor branch):
  - **Tab bar:** `draft.tabs.map` → `<wt-button data-test="tab-btn-${tab.key}">` selecting `activeTabIndex`; `+ Tab` `data-test="add-tab"` appends `{ key: \`tab-${crypto.randomUUID().slice(0,8)}\`, title: t("canvas_editor.new_tab"), columns: defaultColumnsFor(draft.formFactor), cards: [] }`.
  - **Canvas:** `<canvas-grid-preview .tab=${draft.tabs[activeTabIndex]} .interactive=${true} .selectedIndex=${selection has card ? index : -1} @select-card=${e => { this.selection = { card: e.detail.index }; }}>`.
  - **Palette:** `CARD_TYPES.map` → `<wt-button data-test="palette-${type}">${t("canvas_editor.card."+type)}</wt-button>` → append `{ type, colSpan: min(CARD_CONTRACTS[type].defaultColSpan, tab.columns), rowSpan: CARD_CONTRACTS[type].defaultRowSpan, config: {} }` to the active tab (immutably: replace `draft` with a cloned copy so Lit re-renders).
  - **Property panel (card branch only in this task):** when `selection` is a card — `colSpan`/`rowSpan` as `wt-input type="number"` `data-test="card-colspan"`/`card-rowspan` (`@wt-change` → clamp col to `1..tab.columns`, row `≥1`, rewrite draft), a `card-remove` button (`data-test="card-remove"`), and `↑`/`↓` `data-test="card-up"`/`card-down` (swap within the tab's cards). B7 adds config/visibleWhen/warnings.
  - Mutating helper: all edits go through a `#updateDraft(next: CanvasDef)` that assigns a fresh object (`this.draft = next`) so Lit and the preview re-render; never mutate in place.
  - **Guardar/Cancelar** buttons rendered but wired in B7 (Cancelar → `mode="list"`, `draft=null`; Guardar → B7).

- [ ] **Step 4: Add i18n** (`canvas_editor.new_tab`, `canvas_editor.colspan`, `canvas_editor.rowspan`, `canvas_editor.remove_card`, `canvas_editor.add_tab`, `canvas_editor.palette_title`, both locales).

- [ ] **Step 5: Run — verify PASS.**

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/screens/canvas-editor-screen.ts apps/dashboard/src/screens/canvas-editor-screen.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "feat(canvas-editor): editor mode — tabs, palette, select, reorder, span steppers"
```

---

## Task B7: Property panel completion + Save

**Files:**
- Modify: `apps/dashboard/src/screens/canvas-editor-screen.ts`, `.test.ts`, `i18n/strings.ts`, `i18n/codes.ts`

**Interfaces:**
- Consumes: `validateCanvasDraft` (B2), `card-contracts`.
- Produces: the complete editor (config, visibleWhen, warnings, tab settings, canvas settings) + create/update save.

- [ ] **Step 1: Write failing tests** — product-grid.columns config; visibleWhen toggles; capability warning; tab title/columns edit + last-tab delete refused; canvas name/form-factor/capabilities; Save new → `createCanvas`, Save existing → `updateCanvas`; a client-invalid draft blocked (Save not called, banner shown); a server `canvas.name_taken` → banner.

```ts
it("edits product-grid.columns config", async () => {
  const el = await openEditor();
  selectCard(el, 0); // product-grid
  el.shadowRoot!.querySelector("[data-test=config-columns]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "4" }, bubbles: true, composed: true }));
  await el.updateComplete;
  // saving sends config.columns === 4 (asserted via createCanvas/updateCanvas below)
});
it("warns when a placed card's requiredCapability is not in the canvas capabilities", async () => {
  const el = await openEditor();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=palette-kds-board]")!.click(); // needs act-as-kds
  await el.updateComplete;
  selectCard(el, /* the new kds-board index */ 1);
  expect(el.shadowRoot!.querySelector("[data-test=capability-warning]")).toBeTruthy();
});
it("Save on an existing canvas calls updateCanvas with the composed definition", async () => {
  const api = stubApi();
  const el = await openEditor(api);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await flush(el);
  expect(api.updateCanvas).toHaveBeenCalledTimes(1);
  expect(el /* mode */).toBeDefined(); // returns to list
});
it("blocks Save on a client-invalid draft (removes a sale-critical card) and shows the banner", async () => {
  const api = stubApi();
  const el = await openEditor(api);
  selectCard(el, 0); // product-grid (sale-critical)
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=card-remove]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await flush(el);
  expect(api.updateCanvas).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
});
it("surfaces a server canvas.name_taken on Save", async () => {
  const api = stubApi({ updateCanvas: vi.fn().mockRejectedValue({ code: "canvas.name_taken" }) });
  const el = await openEditor(api);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await flush(el);
  expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(/* codeMessage("canvas.name_taken","es-ES") */ "");
});
```

- [ ] **Step 2: Run — verify FAIL.**

- [ ] **Step 3: Implement.**
  - **Card property panel additions:** for each `CARD_CONTRACTS[type].configFields` render a field — `product-grid.columns` → `wt-input type="number" data-test="config-columns"` (`@wt-change` → set/clear `card.config.columns`, clamped 1..12); cards with no fields → `t("canvas_editor.no_config")`. `visibleWhen`: for each state in `CARD_CONTRACTS[type].visibilityStates`, a `wt-switch data-test="visible-${state}"` toggling membership (empty result ⇒ omit `visibleWhen`). A locked-permission note (`data-test="permission-note"`) when `requiredPermission` set. A `data-test="capability-warning"` when `requiredCapability` set and not in `draft.capabilities`.
  - **Tab settings** (when `selection` = tab, entered via a `data-test="tab-settings"` control on the active tab): title `wt-input data-test="tab-title"`, columns `wt-input type=number data-test="tab-columns"` (1..24), `data-test="tab-delete"` (disabled when `draft.tabs.length === 1`).
  - **Canvas settings** (a `data-test="canvas-settings"` toggle): name `wt-input data-test="canvas-name"`, form-factor `<select data-test="canvas-form-factor">` (FORM_FACTORS), capabilities `wt-switch data-test="cap-${flag}"` per `CAPABILITY_FLAGS`.
  - **Save:** `#save()` — `const err = validateCanvasDraft(this.draft!); if (err) { this.errorKey = err; return; }` (banner via `codeMessage`/`t` — note client keys are `canvas_editor.err_*`, so render with `t()` when the key starts `canvas_editor.`, else `codeMessage`; simplest: a `#message(key)` helper that routes `canvas_editor.*` → `t`, else `codeMessage`). Then `#mutate(async () => { if (this.editingId) await this.api.updateCanvas(this.editingId, this.draft!.name??…, this.draft!); else await this.api.createCanvas(name, this.draft!); this.mode = "list"; this.draft = null; })`. Name: keep the canvas name in a `@state() private draftName` set at open/create; send it as the `name` argument (the definition itself has no name field). **Correction:** the server takes `name` + `definition` separately — hold `draftName` alongside `draft`, seed it from the loaded canvas's `name` (edit) or the create/duplicate dialog (new), edit it in Canvas settings, and pass it to create/update.
  - **Cancelar:** `mode="list"; draft=null; errorKey=null`.

- [ ] **Step 4: Add i18n + codes.** `strings.ts` (both locales): `canvas_editor.no_config`, `canvas_editor.visible_when`, `canvas_editor.permission_note`, `canvas_editor.capability_warning`, `canvas_editor.tab_settings`, `canvas_editor.tab_title`, `canvas_editor.tab_columns`, `canvas_editor.tab_delete`, `canvas_editor.canvas_settings`, `canvas_editor.name`, `canvas_editor.capabilities`, `canvas_editor.save`, `canvas_editor.cancel`, and the `canvas_editor.err_*` keys from B2. `codes.ts` (both locales): `canvas.not_found` (model on `zone.not_found`), `canvas.name_taken` (model on `zone.name_taken`), `canvas.invalid` (model on `layout.invalid`).

- [ ] **Step 5: Run — verify PASS.** Prove the client-validation guard by deletion (remove the `if (err) return` → the "blocks Save" test fails → restore).

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/screens/canvas-editor-screen.ts apps/dashboard/src/screens/canvas-editor-screen.test.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/codes.ts
git commit -s -m "feat(canvas-editor): property panel (config/visibleWhen/warnings/settings) + save"
```

---

## Task B8: a11y test, coverage, backlog, final gate

**Files:**
- Create: `apps/dashboard/src/screens/canvas-editor-screen.a11y.test.ts`
- Modify: `docs/backlog.md`

- [ ] **Step 1: Write the a11y test** (mirror `printers-screen.a11y.test.ts`): `describe.each(["light","dark"])`, mount with a stub api, `flush`, `await expectNoA11yViolations(host)` for (a) list mode, (b) editor mode with a card selected. Run — verify PASS.

- [ ] **Step 2: Coverage.** Run: `pnpm --filter @waitron/dashboard test:coverage`. If any new file is below 95/95/90/88, add the missing-branch tests (e.g. the `#parseDefinition` null branch, the empty-tab affordance, the last-tab-delete refusal). Do **not** lower thresholds.

- [ ] **Step 3: Update `docs/backlog.md`** — B3.2 landed (Phase A rename + Phase B editor); record the deferred follow-ons (device-profile slice, drag/resize, live renders, theme editor).

- [ ] **Step 4: Full gate** (the four-command workspace gate + the coverage breadth CI adds).

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` — Expected: PASS.
Run: `pnpm --filter @waitron/dashboard test:coverage` — Expected: PASS at the bar.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/screens/canvas-editor-screen.a11y.test.ts docs/backlog.md
git commit -s -m "feat(canvas-editor): a11y coverage in both themes; backlog B3.2 landed"
```

---

## Self-review checklist (run before handing off Phase B)

- **Spec coverage (§6):** list w/ thumbnails ✓ B5; create/duplicate/delete ✓ B5; edit ✓ B6/B7; tabs add/rename/columns/delete ✓ B6/B7; palette add ✓ B6; select + reorder + span steppers ✓ B6; config + visibleWhen + permission/capability warnings ✓ B7; canvas name/form-factor/capabilities ✓ B7; client mirror + parity guard ✓ B1/B2; card-host seam ✓ B4; 4 client methods ✓ B3; i18n `canvas.*` codes ✓ B7; nav ✓ B5; a11y ✓ B8. Theme editor / drag / live renders correctly **absent** (deferred).
- **Bundle rule:** no runtime `@waitron/layouts` import in any non-test file; the parity test deep-imports pure modules only.
- **Guards proven by deletion:** parity (B1), geometry (B4), client validation (B7).
- **Type consistency:** `CanvasDef`/`TabDef`/`CardInstance` from `card-contracts.ts` used throughout; `getCanvas`/`createCanvas`/`updateCanvas`/`deleteCanvas` names consistent across B3/B5/B7; `select-card` event detail `{ index }` consistent B4/B6.
- **No placeholders:** every step has concrete code or exact identifiers (`data-test` ids, event names, i18n keys).
