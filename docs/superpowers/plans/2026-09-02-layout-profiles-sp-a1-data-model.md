# Layout profiles — SP-A.1: profile & card data model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the new **layout-profile** data model (form factors, a card catalogue with a per-card
contract, tabs-of-a-grid-of-cards, per-profile theme overrides), plus fail-closed validation and
built-in default profiles, to `@waitron/layouts` as pure package logic — the foundation every later
SP-A/SP-B slice builds on.

**Architecture:** New model added *alongside* the existing per-tenant till-layout code in the same
package (they coexist transitionally; a later SP-A slice removes the old widget model once rendering
swaps over — CLAUDE.md §5 forbids permanent back-compat, so the old path is deleted by SP-A's end, not
kept). This slice is **pure, hermetic package logic**: types, a card-contract registry, `validateProfile`
/ `validateThemeOverride`, and default profiles. **No DB schema, no migrations, no API, no rendering
changes** — those are SP-A's later slices. Tests are unit-only (no real Postgres needed).

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, `@waitron/shared` `AppError` + declaration-merged
error registry, `@waitron/identity` `Permission` type (type-only import; already a dependency).

**Spec:** `docs/superpowers/specs/2026-09-02-layout-designer-and-device-profiles-design.md` (§4 model,
§4.2 card contract, §5 abilities, §6 visibility, §9 theme, §13 invariants).

## Global Constraints

- **Error codes name the DOMAIN CONCEPT, never the package** — new families are `profile.*` and
  `theme.*` (grep siblings first; both families must be fresh). Codes are never renamed once shipped.
  Every file that throws imports its registry (`import "./errors.js"`).
- **Error params NAME the problem, never echo a user value** (CLAUDE.md §1, the house's dominant defect
  class). Identify a tab by its **numeric index** (`tabIndex`), never its author-supplied `key`/`title`
  string; `card` only ever carries a valid `CardType` enum value; `configKey`/`token` carry a NAME from
  a known set, never a value; `maxLength` is the policy cap, never the offending length.
- **Fail-closed validation** — reject any unknown field/key/type; own-property lookup (`Object.hasOwn`)
  when indexing a schema by an untrusted key, never a bare `schema[key]` (prototype-pollution safe), the
  pattern already proven in `validate.ts:69`.
- **No hardcoded chrome / CSS-injection safety** — a theme override may only set an **allowlisted**
  `--wt-*` token, to a bounded, charset-restricted value (theme values flow into CSS custom properties).
- **Coverage thresholds (this package): statements 98 / lines 98 / functions 98 / branches 95.** Prove
  every guard by deletion (remove the check → the test must fail → restore), and give each negative
  control a reason it fails.
- **Pure logic only** — do not add `@waitron/db`, real-Postgres, or API code in this slice. `@waitron/identity`
  is used **type-only** (`import type { Permission }`).

---

### Task 1: Error families `profile.invalid` and `theme.invalid`

**Files:**
- Modify: `packages/layouts/src/errors.ts`
- Test: `packages/layouts/src/errors.test.ts` (create if absent; else add cases)

**Interfaces:**
- Consumes: `@waitron/shared` `AppError`, `ErrorParams` (declaration merging).
- Produces: two new `ErrorParams` members — `"profile.invalid"` and `"theme.invalid"` — with the exact
  `reason` unions and param shapes below. Every later task throws these.

- [ ] **Step 1: Grep-receipt the fresh families (no collision)**

Run:
```bash
grep -rn '"profile\.\|"theme\.' packages/**/src/errors.ts apps/server/src/errors.ts
```
Expected: no match. Paste the (empty) result into the commit body as the collision receipt (mirrors the
receipt comment already in `errors.ts` for `layout.`/`receipt.`).

- [ ] **Step 2: Write the failing test**

```ts
// packages/layouts/src/errors.test.ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./errors.js";

describe("layout-profile error registry", () => {
  it("constructs profile.invalid with a reason and a numeric tabIndex", () => {
    const err = new AppError("profile.invalid", { reason: "bad_tab", tabIndex: 2 });
    expect(err.code).toBe("profile.invalid");
    expect(err.params).toEqual({ reason: "bad_tab", tabIndex: 2 });
  });

  it("constructs theme.invalid with a reason and a policy maxLength", () => {
    const err = new AppError("theme.invalid", { reason: "too_long", token: "--wt-color-primary", maxLength: 64 });
    expect(err.code).toBe("theme.invalid");
    expect(err.params.reason).toBe("too_long");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @waitron/layouts test errors`
Expected: FAIL — TypeScript rejects `"profile.invalid"` / `"theme.invalid"` (not in `ErrorParams`).

- [ ] **Step 4: Add the augmentation**

Append inside the existing `declare module "@waitron/shared" { interface ErrorParams { … } }` block in
`errors.ts` (keep the CLAUDE.md §1 param-rule comment style already in that file):

```ts
    // A ProfileDef failed validateProfile. `reason` says which rule:
    //   not_object      — input (or a tab/card) was not a plain object;
    //   bad_form_factor — `formFactor` was not a FormFactor;
    //   no_tabs         — `tabs` was not a non-empty array;
    //   bad_tab         — a tab was malformed (missing/blank key or title, over-long title);
    //   duplicate_tab   — two tabs shared a `key`;
    //   bad_columns     — a tab's `columns` was not an integer in 1..GRID_MAX_COLUMNS;
    //   unknown_card    — a card was not an object, or its `type` was not a CardType (NOT echoed);
    //   bad_span        — a card's colSpan/rowSpan was out of range for its tab;
    //   bad_config      — a card's config had a key outside its contract or a value it rejected;
    //   bad_visible_when— a card's visibleWhen was not a subset of the card's declared states;
    //   missing_required— a sale-critical card was absent from a selling profile.
    // `tabIndex` (numeric, never the author-supplied key) locates the tab; `card` names the card only
    // when it is a valid CardType; `configKey` names the offending config key.
    "profile.invalid": {
      reason:
        | "not_object"
        | "bad_form_factor"
        | "no_tabs"
        | "bad_tab"
        | "duplicate_tab"
        | "bad_columns"
        | "unknown_card"
        | "bad_span"
        | "bad_config"
        | "bad_visible_when"
        | "missing_required";
      tabIndex?: number;
      card?: CardType;
      configKey?: string;
    };
    // A ThemeOverride failed validateThemeOverride. `reason`:
    //   not_object    — input, or its `tokens`, was not a plain object;
    //   bad_tokens    — `tokens` was missing or not a plain object;
    //   unknown_token — a token name outside the THEMEABLE_TOKENS allowlist (the name is NOT echoed,
    //                   fail-closed: an un-allowlisted CSS property must never reach the stylesheet);
    //   bad_value     — an allowlisted token's value was not a string, or failed the charset guard;
    //   too_long      — a value exceeded `maxLength` chars (the length is NOT echoed).
    // `token` names the offending token ONLY when it is allowlisted (bad_value / too_long); `maxLength`
    // is the policy cap.
    "theme.invalid": {
      reason: "not_object" | "bad_tokens" | "unknown_token" | "bad_value" | "too_long";
      token?: string;
      maxLength?: number;
    };
```

Add the type import at the top of `errors.ts` (it already imports `WidgetType`):
```ts
import type { CardType } from "./profile.js";
```

> Note: `profile.js` is created in Task 2. If you implement strictly in order, add the `import type`
> line in Task 2 when `profile.ts` exists, and until then type `card?` as
> `card?: string` — but prefer implementing Task 2 first, then this import resolves cleanly. The plan
> lists Task 1 first only so the error codes exist for later throws; the two files are mutually
> referenced (errors imports the CardType type; validators import the codes), which TypeScript resolves
> fine across `.ts` modules.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/layouts test errors`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/layouts/src/errors.ts packages/layouts/src/errors.test.ts
git commit -s -m "feat(layouts): add profile.invalid + theme.invalid error families"
```

---

### Task 2: Catalogue tuples, capability flags & the profile types

**Files:**
- Create: `packages/layouts/src/profile.ts`
- Test: `packages/layouts/src/profile.test.ts`

**Interfaces:**
- Produces:
  - `FORM_FACTORS` (`readonly ["till","phone-portrait","tablet-landscape","kds"]`) + `type FormFactor`.
  - `CARD_TYPES` (the catalogue tuple) + `type CardType`.
  - `CAPABILITY_FLAGS` (`readonly ["integrated-card-payment","open-cash-drawer","act-as-kds"]`) +
    `type CapabilityFlag`.
  - `interface CardInstance { type: CardType; colSpan: number; rowSpan: number; config:
    Record<string, unknown>; visibleWhen?: string[] }`.
  - `interface TabDef { key: string; title: string; columns: number; cards: CardInstance[] }`.
  - `interface ThemeOverride { tokens: Record<string, string> }`.
  - `interface ProfileDef { formFactor: FormFactor; tabs: TabDef[]; capabilities: CapabilityFlag[];
    theme?: ThemeOverride }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/layouts/src/profile.test.ts
import { describe, expect, it } from "vitest";
import { CARD_TYPES, CAPABILITY_FLAGS, FORM_FACTORS } from "./profile.js";

const noDupes = (t: readonly string[]) => new Set(t).size === t.length;

describe("catalogue tuples", () => {
  it("form factors are unique and include till/phone/kds", () => {
    expect(noDupes(FORM_FACTORS)).toBe(true);
    for (const f of ["till", "phone-portrait", "kds"]) expect(FORM_FACTORS).toContain(f);
  });
  it("card types are unique and include the counter sale cards + big cards", () => {
    expect(noDupes(CARD_TYPES)).toBe(true);
    for (const c of ["product-grid", "basket", "total", "tender-pay", "floor-plan", "kds-board"])
      expect(CARD_TYPES).toContain(c);
  });
  it("capability flags are unique", () => {
    expect(noDupes(CAPABILITY_FLAGS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/layouts test profile`
Expected: FAIL — `./profile.js` does not exist.

- [ ] **Step 3: Write the module**

```ts
// packages/layouts/src/profile.ts
/**
 * Canonical types for the layout-PROFILE model (design §4): a profile is a dashboard for one form
 * factor — 1+ tabs, each tab a grid, every screen a card. The dashboard + till keep bundle-decoupled
 * local copies of these shapes, as with the older WidgetInstance model in ./types.ts.
 */

/** The device form factors a profile can target (design §4.1 — form factor is the sizing guardrail). */
export const FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

/**
 * The card catalogue — the single source of truth for placeable card kinds. "Big" cards fill a tab
 * (floor-plan, kds-board, expo, table-order, table-layout-editor); "small" cards share a grid. Adding
 * a card is a one-line change here + a contract in card-contract.ts. During SP-A the counter cards
 * overlap the older WIDGET_TYPES (./types.ts); the old tuple is removed once rendering swaps (SP-A end).
 */
export const CARD_TYPES = [
  "product-grid",
  "basket",
  "total",
  "tender-pay",
  "held-orders",
  "prep-queue",
  "notifications",
  "floor-plan",
  "table-layout-editor",
  "kds-board",
  "expo",
  "table-order",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

/**
 * Server-enforced device-capability flags a profile may carry (design §5, layer 2) — generalising the
 * hardcoded assertNotHandheld firewall. Declarative here; ENFORCEMENT lands in SP-A.2 (device slice).
 */
export const CAPABILITY_FLAGS = [
  "integrated-card-payment",
  "open-cash-drawer",
  "act-as-kds",
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

/** One placed card in a tab's grid. `colSpan`/`rowSpan` size it (HA Sections model, design §4.1). */
export interface CardInstance {
  type: CardType;
  colSpan: number;
  rowSpan: number;
  config: Record<string, unknown>;
  /**
   * Runtime-visibility states (design §6 axis 3) that make this card render, a SUBSET of the card
   * type's declared `visibilityStates`. Absent or empty ⇒ always render.
   */
  visibleWhen?: string[];
}

/** A tab: a titled grid of a fixed `columns` count holding placed cards (design §4.1). */
export interface TabDef {
  key: string;
  title: string;
  columns: number;
  cards: CardInstance[];
}

/** A theme override: allowlisted `--wt-*` token → value (design §9). */
export interface ThemeOverride {
  tokens: Record<string, string>;
}

/** A whole layout profile (design §4.1): a form factor, its tabs, capability flags, optional theme. */
export interface ProfileDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  capabilities: CapabilityFlag[];
  theme?: ThemeOverride;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/layouts test profile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/layouts/src/profile.ts packages/layouts/src/profile.test.ts
git commit -s -m "feat(layouts): profile/tab/card/theme types + catalogue tuples"
```

---

### Task 3: The card-contract registry

**Files:**
- Create: `packages/layouts/src/card-contract.ts`
- Test: `packages/layouts/src/card-contract.test.ts`

**Interfaces:**
- Consumes: `CardType`, `CapabilityFlag` (Task 2); `ConfigValidator`, `WidgetConfigSchema` from
  `./widget-config.js` (existing); `Permission` (type-only) from `@waitron/identity`.
- Produces:
  - `interface CardContract { configSchema: WidgetConfigSchema; requiredPermission?: Permission;
    requiredCapability?: CapabilityFlag; visibilityStates: readonly string[]; defaultColSpan: number;
    defaultRowSpan: number; saleCritical: boolean }`.
  - `const CARD_CONTRACTS: Record<CardType, CardContract>` — total over the catalogue.
  - `const SALE_CRITICAL_CARDS: readonly CardType[]` (derived from `saleCritical`).
  - `const GRID_MAX_COLUMNS = 24`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/layouts/src/card-contract.test.ts
import { describe, expect, it } from "vitest";
import { CARD_TYPES } from "./profile.js";
import { CARD_CONTRACTS, SALE_CRITICAL_CARDS } from "./card-contract.js";

describe("card-contract registry", () => {
  it("declares a contract for every card type", () => {
    for (const t of CARD_TYPES) expect(CARD_CONTRACTS[t]).toBeDefined();
  });
  it("every contract has sane defaults and a states array", () => {
    for (const t of CARD_TYPES) {
      const c = CARD_CONTRACTS[t];
      expect(c.defaultColSpan).toBeGreaterThanOrEqual(1);
      expect(c.defaultRowSpan).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(c.visibilityStates)).toBe(true);
    }
  });
  it("marks the four counter sale cards sale-critical and nothing else", () => {
    expect([...SALE_CRITICAL_CARDS].sort()).toEqual(
      ["basket", "product-grid", "tender-pay", "total"].sort(),
    );
  });
  it("gives the table-layout-editor a required permission", () => {
    expect(CARD_CONTRACTS["table-layout-editor"].requiredPermission).toBe("till.configure");
  });
  it("requires the integrated-card-payment capability on the pay card", () => {
    expect(CARD_CONTRACTS["tender-pay"].requiredCapability).toBe("integrated-card-payment");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/layouts test card-contract`
Expected: FAIL — `./card-contract.js` does not exist.

- [ ] **Step 3: Write the module**

```ts
// packages/layouts/src/card-contract.ts
import type { Permission } from "@waitron/identity";
import type { CapabilityFlag, CardType } from "./profile.js";
import type { ConfigValidator, WidgetConfigSchema } from "./widget-config.js";

/** The widest grid a tab may declare (design §4.1). A tab's `columns` is validated into 1..this. */
export const GRID_MAX_COLUMNS = 24;

function intInRange(min: number, max: number): ConfigValidator {
  return (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * What one card kind declares to the system (design §4.2): its config schema, the person-role
 * PERMISSION its sensitive action needs (drives the in-card locked state — §5), the device CAPABILITY
 * it requires to be available at all (drives structural absence — §6 axis 1), the runtime visibility
 * STATES an author may gate rendering on (§6 axis 3), its default grid span, and whether it is
 * sale-critical (§13 — a selling profile must place it).
 */
export interface CardContract {
  configSchema: WidgetConfigSchema;
  requiredPermission?: Permission;
  requiredCapability?: CapabilityFlag;
  visibilityStates: readonly string[];
  defaultColSpan: number;
  defaultRowSpan: number;
  saleCritical: boolean;
}

/**
 * The per-card contract registry — the ONE tested place defining every card kind's contract. The
 * `Record<CardType, …>` type makes forgetting a card a compile error. Config validators reuse the
 * fail-closed `ConfigValidator` shape from widget-config.ts. `visibilityStates` list the states a card
 * exposes; an author's `visibleWhen` must be a subset (validated in Task 6).
 */
export const CARD_CONTRACTS: Record<CardType, CardContract> = {
  "product-grid": {
    configSchema: { columns: intInRange(1, 12) },
    visibilityStates: [],
    defaultColSpan: 8,
    defaultRowSpan: 6,
    saleCritical: true,
  },
  basket: { configSchema: {}, visibilityStates: [], defaultColSpan: 4, defaultRowSpan: 4, saleCritical: true },
  total: { configSchema: {}, visibilityStates: [], defaultColSpan: 4, defaultRowSpan: 1, saleCritical: true },
  "tender-pay": {
    configSchema: {},
    requiredCapability: "integrated-card-payment",
    visibilityStates: [],
    defaultColSpan: 4,
    defaultRowSpan: 2,
    saleCritical: true,
  },
  "held-orders": {
    configSchema: {},
    visibilityStates: ["has-parked", "empty"],
    defaultColSpan: 4,
    defaultRowSpan: 2,
    saleCritical: false,
  },
  "prep-queue": {
    configSchema: {},
    visibilityStates: ["has-items", "empty"],
    defaultColSpan: 4,
    defaultRowSpan: 2,
    saleCritical: false,
  },
  notifications: {
    configSchema: {},
    visibilityStates: ["unread", "any", "empty"],
    defaultColSpan: 4,
    defaultRowSpan: 1,
    saleCritical: false,
  },
  "floor-plan": { configSchema: {}, visibilityStates: [], defaultColSpan: 24, defaultRowSpan: 12, saleCritical: false },
  "table-layout-editor": {
    configSchema: {},
    requiredPermission: "till.configure",
    visibilityStates: [],
    defaultColSpan: 24,
    defaultRowSpan: 12,
    saleCritical: false,
  },
  "kds-board": {
    configSchema: {},
    requiredCapability: "act-as-kds",
    visibilityStates: ["has-tickets", "idle"],
    defaultColSpan: 24,
    defaultRowSpan: 12,
    saleCritical: false,
  },
  expo: { configSchema: {}, visibilityStates: ["has-tickets", "idle"], defaultColSpan: 24, defaultRowSpan: 12, saleCritical: false },
  "table-order": { configSchema: {}, visibilityStates: [], defaultColSpan: 24, defaultRowSpan: 12, saleCritical: false },
};

/** The sale-critical cards, derived from the contract so it can never drift from `saleCritical`. */
export const SALE_CRITICAL_CARDS: readonly CardType[] = (
  Object.keys(CARD_CONTRACTS) as CardType[]
).filter((t) => CARD_CONTRACTS[t].saleCritical);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/layouts test card-contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/layouts/src/card-contract.ts packages/layouts/src/card-contract.test.ts
git commit -s -m "feat(layouts): card-contract registry (config/permission/capability/states/spans)"
```

---

### Task 4: `validateProfile` — structural rules

**Files:**
- Create: `packages/layouts/src/validate-profile.ts`
- Test: `packages/layouts/src/validate-profile.test.ts`

**Interfaces:**
- Consumes: `ProfileDef`, `FORM_FACTORS`, `TabDef` (Task 2); `GRID_MAX_COLUMNS` (Task 3);
  `profile.invalid` (Task 1).
- Produces: `function validateProfile(input: unknown): ProfileDef` — this task covers the OUTER +
  TAB structure only; Tasks 5–6 extend the SAME function for cards and sale-critical rules.
  Also produces `const MAX_TAB_TITLE_LENGTH = 60`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/layouts/src/validate-profile.test.ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { validateProfile } from "./validate-profile.js";

const ok = {
  formFactor: "till",
  capabilities: [],
  tabs: [{ key: "counter", title: "Counter", columns: 12, cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
    { type: "total", colSpan: 4, rowSpan: 1, config: {} },
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
  ] }],
};

function reason(fn: () => unknown): string {
  try { fn(); throw new Error("did not throw"); }
  catch (e) { if (e instanceof AppError) return String(e.params.reason); throw e; }
}

describe("validateProfile — structure", () => {
  it("accepts a well-formed till profile", () => {
    expect(validateProfile(ok).formFactor).toBe("till");
  });
  it("rejects a non-object", () => {
    expect(reason(() => validateProfile(null))).toBe("not_object");
  });
  it("rejects an unknown form factor", () => {
    expect(reason(() => validateProfile({ ...ok, formFactor: "watch" }))).toBe("bad_form_factor");
  });
  it("rejects empty tabs", () => {
    expect(reason(() => validateProfile({ ...ok, tabs: [] }))).toBe("no_tabs");
  });
  it("rejects a blank tab title", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], title: "" }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_tab");
  });
  it("rejects duplicate tab keys", () => {
    const bad = { ...ok, tabs: [ok.tabs[0], { ...ok.tabs[0] }] };
    expect(reason(() => validateProfile(bad))).toBe("duplicate_tab");
  });
  it("rejects columns out of range", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], columns: 99 }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_columns");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/layouts test validate-profile`
Expected: FAIL — `./validate-profile.js` does not exist.

- [ ] **Step 3: Write the structural validator**

```ts
// packages/layouts/src/validate-profile.ts
import { AppError } from "@waitron/shared";
import "./errors.js";
import { CARD_CONTRACTS, GRID_MAX_COLUMNS, SALE_CRITICAL_CARDS } from "./card-contract.js";
import { CARD_TYPES, CAPABILITY_FLAGS, FORM_FACTORS } from "./profile.js";
import type { CapabilityFlag, CardInstance, CardType, FormFactor, ProfileDef, TabDef } from "./profile.js";

/** Tab-title cap (design §4). Carried nowhere in an error param — a blank/over-long title is `bad_tab`. */
export const MAX_TAB_TITLE_LENGTH = 60;

/** Selling form factors must place every sale-critical card (§13). Till only for now; extend later. */
const SELLING_FORM_FACTORS: readonly FormFactor[] = ["till"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isFormFactor(v: unknown): v is FormFactor {
  return typeof v === "string" && (FORM_FACTORS as readonly string[]).includes(v);
}
function isCardType(v: unknown): v is CardType {
  return typeof v === "string" && (CARD_TYPES as readonly string[]).includes(v);
}
function isCapabilityFlag(v: unknown): v is CapabilityFlag {
  return typeof v === "string" && (CAPABILITY_FLAGS as readonly string[]).includes(v);
}

/**
 * Validate an untrusted profile (design §4/§6). Returns it on success; throws `profile.invalid` naming
 * the first rule broken, never echoing an author value (a tab is identified by its numeric index).
 * Tasks 5–6 fill in card + sale-critical validation where marked.
 */
export function validateProfile(input: unknown): ProfileDef {
  if (!isPlainObject(input)) throw new AppError("profile.invalid", { reason: "not_object" });
  if (!isFormFactor(input.formFactor)) throw new AppError("profile.invalid", { reason: "bad_form_factor" });
  const capabilities = validateCapabilities(input.capabilities);
  if (!Array.isArray(input.tabs) || input.tabs.length === 0) {
    throw new AppError("profile.invalid", { reason: "no_tabs" });
  }
  const seenKeys = new Set<string>();
  const tabs: TabDef[] = input.tabs.map((raw, tabIndex) => validateTab(raw, tabIndex, seenKeys));
  const profile: ProfileDef = { formFactor: input.formFactor, capabilities, tabs };
  assertSaleCritical(profile, SELLING_FORM_FACTORS); // Task 6 implements the body
  return profile;
}

function validateCapabilities(input: unknown): CapabilityFlag[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || !input.every(isCapabilityFlag)) {
    throw new AppError("profile.invalid", { reason: "not_object" });
  }
  return input as CapabilityFlag[];
}

function validateTab(raw: unknown, tabIndex: number, seenKeys: Set<string>): TabDef {
  if (!isPlainObject(raw)) throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  const { key, title, columns } = raw;
  if (typeof key !== "string" || key.length === 0) {
    throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  }
  if (seenKeys.has(key)) throw new AppError("profile.invalid", { reason: "duplicate_tab", tabIndex });
  seenKeys.add(key);
  if (typeof title !== "string" || title.length === 0 || title.length > MAX_TAB_TITLE_LENGTH) {
    throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  }
  if (typeof columns !== "number" || !Number.isInteger(columns) || columns < 1 || columns > GRID_MAX_COLUMNS) {
    throw new AppError("profile.invalid", { reason: "bad_columns", tabIndex });
  }
  const cards = validateCards(raw.cards, tabIndex, columns); // Task 5 implements the body
  return { key, title, columns, cards };
}

// --- Filled in by later tasks (stubs so this task compiles & its own tests pass) ---
function validateCards(input: unknown, tabIndex: number, columns: number): CardInstance[] {
  // Task 5 replaces this body. For now accept a plain array of already-shaped cards so the structural
  // tests (which pass valid cards) succeed; malformed-card cases are added in Task 5.
  if (!Array.isArray(input)) throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  return input as CardInstance[];
}
function assertSaleCritical(_profile: ProfileDef, _selling: readonly FormFactor[]): void {
  // Task 6 replaces this body.
  void _profile;
  void _selling;
  void SALE_CRITICAL_CARDS;
  void CARD_CONTRACTS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/layouts test validate-profile`
Expected: PASS (structural cases).

- [ ] **Step 5: Commit**

```bash
git add packages/layouts/src/validate-profile.ts packages/layouts/src/validate-profile.test.ts
git commit -s -m "feat(layouts): validateProfile structural + tab rules"
```

---

### Task 5: `validateProfile` — card rules

**Files:**
- Modify: `packages/layouts/src/validate-profile.ts` (replace the `validateCards` stub)
- Test: `packages/layouts/src/validate-profile.test.ts` (add cases)

**Interfaces:**
- Consumes: `CARD_CONTRACTS` (Task 3), `isCardType` (Task 4).
- Produces: full `validateCards(input, tabIndex, columns): CardInstance[]` enforcing card shape, known
  type, span ranges, per-contract config (own-property lookup), and `visibleWhen ⊆ visibilityStates`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to validate-profile.test.ts
describe("validateProfile — cards", () => {
  const withCards = (cards: unknown[]) => ({
    formFactor: "kds", capabilities: [],
    tabs: [{ key: "t", title: "T", columns: 12, cards }],
  });
  it("rejects an unknown card type", () => {
    expect(reason(() => validateProfile(withCards([{ type: "nope", colSpan: 1, rowSpan: 1, config: {} }]))))
      .toBe("unknown_card");
  });
  it("rejects a colSpan wider than the tab", () => {
    expect(reason(() => validateProfile(withCards([{ type: "kds-board", colSpan: 13, rowSpan: 1, config: {} }]))))
      .toBe("bad_span");
  });
  it("rejects a rowSpan below 1", () => {
    expect(reason(() => validateProfile(withCards([{ type: "kds-board", colSpan: 1, rowSpan: 0, config: {} }]))))
      .toBe("bad_span");
  });
  it("rejects a config key outside the contract", () => {
    expect(reason(() => validateProfile(withCards([{ type: "product-grid", colSpan: 1, rowSpan: 1, config: { nope: 1 } }]))))
      .toBe("bad_config");
  });
  it("rejects a bad config value", () => {
    expect(reason(() => validateProfile(withCards([{ type: "product-grid", colSpan: 1, rowSpan: 1, config: { columns: 99 } }]))))
      .toBe("bad_config");
  });
  it("rejects visibleWhen outside the card's declared states", () => {
    expect(reason(() => validateProfile(withCards([{ type: "notifications", colSpan: 1, rowSpan: 1, config: {}, visibleWhen: ["nope"] }]))))
      .toBe("bad_visible_when");
  });
  it("accepts a valid visibleWhen subset", () => {
    const p = validateProfile(withCards([{ type: "notifications", colSpan: 1, rowSpan: 1, config: {}, visibleWhen: ["unread"] }]));
    expect(p.tabs[0].cards[0].visibleWhen).toEqual(["unread"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @waitron/layouts test validate-profile`
Expected: FAIL — the stub accepts everything.

- [ ] **Step 3: Replace the `validateCards` stub**

```ts
function validateCards(input: unknown, tabIndex: number, columns: number): CardInstance[] {
  if (!Array.isArray(input)) throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  return input.map((raw) => {
    if (!isPlainObject(raw) || !isCardType(raw.type)) {
      throw new AppError("profile.invalid", { reason: "unknown_card", tabIndex });
    }
    const type = raw.type;
    const { colSpan, rowSpan, config } = raw;
    if (
      typeof colSpan !== "number" || !Number.isInteger(colSpan) || colSpan < 1 || colSpan > columns ||
      typeof rowSpan !== "number" || !Number.isInteger(rowSpan) || rowSpan < 1
    ) {
      throw new AppError("profile.invalid", { reason: "bad_span", tabIndex, card: type });
    }
    if (!isPlainObject(config)) {
      throw new AppError("profile.invalid", { reason: "bad_config", tabIndex, card: type });
    }
    const schema = CARD_CONTRACTS[type].configSchema;
    for (const [key, value] of Object.entries(config)) {
      // Own-property lookup, never a bare schema[key] — prototype-pollution safe (validate.ts:69).
      const validator = Object.hasOwn(schema, key) ? schema[key] : undefined;
      if (validator === undefined || !validator(value)) {
        throw new AppError("profile.invalid", { reason: "bad_config", tabIndex, card: type, configKey: key });
      }
    }
    const states = CARD_CONTRACTS[type].visibilityStates;
    let visibleWhen: string[] | undefined;
    if (raw.visibleWhen !== undefined) {
      if (!Array.isArray(raw.visibleWhen) || !raw.visibleWhen.every((s) => typeof s === "string" && states.includes(s))) {
        throw new AppError("profile.invalid", { reason: "bad_visible_when", tabIndex, card: type });
      }
      visibleWhen = raw.visibleWhen as string[];
    }
    const card: CardInstance = { type, colSpan, rowSpan, config };
    if (visibleWhen !== undefined) card.visibleWhen = visibleWhen;
    return card;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/layouts test validate-profile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/layouts/src/validate-profile.ts packages/layouts/src/validate-profile.test.ts
git commit -s -m "feat(layouts): validateProfile card shape/span/config/visibility rules"
```

---

### Task 6: `validateProfile` — sale-critical enforcement

**Files:**
- Modify: `packages/layouts/src/validate-profile.ts` (replace the `assertSaleCritical` stub)
- Test: `packages/layouts/src/validate-profile.test.ts` (add cases)

**Interfaces:**
- Consumes: `SALE_CRITICAL_CARDS` (Task 3), `SELLING_FORM_FACTORS` (Task 4).
- Produces: full `assertSaleCritical` — a selling-form-factor profile missing any sale-critical card
  (across all tabs) throws `missing_required`; non-selling factors are exempt.

- [ ] **Step 1: Write the failing tests**

```ts
// append to validate-profile.test.ts
describe("validateProfile — sale-critical", () => {
  it("rejects a till profile missing a sale-critical card", () => {
    const bad = { formFactor: "till", capabilities: [], tabs: [{ key: "c", title: "C", columns: 12, cards: [
      { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
      { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
      { type: "total", colSpan: 4, rowSpan: 1, config: {} },
      // tender-pay missing
    ] }] };
    expect(reason(() => validateProfile(bad))).toBe("missing_required");
  });
  it("allows a kds profile with none of the sale cards", () => {
    const p = validateProfile({ formFactor: "kds", capabilities: ["act-as-kds"], tabs: [
      { key: "k", title: "Kitchen", columns: 24, cards: [{ type: "kds-board", colSpan: 24, rowSpan: 12, config: {} }] },
    ] });
    expect(p.formFactor).toBe("kds");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @waitron/layouts test validate-profile`
Expected: FAIL — the till case is wrongly accepted (stub is a no-op).

- [ ] **Step 3: Replace the `assertSaleCritical` stub**

```ts
function assertSaleCritical(profile: ProfileDef, selling: readonly FormFactor[]): void {
  if (!selling.includes(profile.formFactor)) return;
  const placed = new Set<CardType>();
  for (const tab of profile.tabs) for (const card of tab.cards) placed.add(card.type);
  for (const required of SALE_CRITICAL_CARDS) {
    if (!placed.has(required)) {
      throw new AppError("profile.invalid", { reason: "missing_required", card: required });
    }
  }
}
```

Remove the now-unused `void CARD_CONTRACTS;` / `void SALE_CRITICAL_CARDS;` lines left by the Task 4 stub.

- [ ] **Step 4: Run tests to verify they pass; prove the guard by deletion**

Run: `pnpm --filter @waitron/layouts test validate-profile`
Expected: PASS. Then temporarily change `if (!placed.has(required))` to `if (false)`, re-run, confirm the
till case FAILS, and restore — the by-deletion proof (CLAUDE.md §4).

- [ ] **Step 5: Commit**

```bash
git add packages/layouts/src/validate-profile.ts packages/layouts/src/validate-profile.test.ts
git commit -s -m "feat(layouts): validateProfile sale-critical enforcement (selling form factors)"
```

---

### Task 7: `validateThemeOverride`

**Files:**
- Create: `packages/layouts/src/theme.ts`
- Test: `packages/layouts/src/theme.test.ts`

**Interfaces:**
- Consumes: `ThemeOverride` (Task 2); `theme.invalid` (Task 1).
- Produces:
  - `const THEMEABLE_TOKENS: readonly string[]` — the allowlist of `--wt-*` tokens a theme may set.
  - `const MAX_THEME_VALUE_LENGTH = 64`.
  - `function validateThemeOverride(input: unknown): ThemeOverride`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/layouts/src/theme.test.ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { THEMEABLE_TOKENS, validateThemeOverride } from "./theme.js";

function reason(fn: () => unknown): string {
  try { fn(); throw new Error("did not throw"); }
  catch (e) { if (e instanceof AppError) return String(e.params.reason); throw e; }
}

describe("validateThemeOverride", () => {
  it("accepts allowlisted tokens with safe values", () => {
    const token = THEMEABLE_TOKENS[0];
    const t = validateThemeOverride({ tokens: { [token]: "#1a2b3c" } });
    expect(t.tokens[token]).toBe("#1a2b3c");
  });
  it("rejects a non-object", () => {
    expect(reason(() => validateThemeOverride(null))).toBe("not_object");
  });
  it("rejects a missing tokens map", () => {
    expect(reason(() => validateThemeOverride({}))).toBe("bad_tokens");
  });
  it("rejects an un-allowlisted token", () => {
    expect(reason(() => validateThemeOverride({ tokens: { "--evil": "red" } }))).toBe("unknown_token");
  });
  it("rejects a value with unsafe characters (CSS injection)", () => {
    const token = THEMEABLE_TOKENS[0];
    expect(reason(() => validateThemeOverride({ tokens: { [token]: "red; } body{display:none}" } }))).toBe("bad_value");
  });
  it("rejects an over-long value", () => {
    const token = THEMEABLE_TOKENS[0];
    expect(reason(() => validateThemeOverride({ tokens: { [token]: "a".repeat(65) } }))).toBe("too_long");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/layouts test theme`
Expected: FAIL — `./theme.js` does not exist.

- [ ] **Step 3: Write the module**

```ts
// packages/layouts/src/theme.ts
import { AppError } from "@waitron/shared";
import "./errors.js";
import type { ThemeOverride } from "./profile.js";

/**
 * The `--wt-*` tokens a theme override may set (design §9). An ALLOWLIST, fail-closed: a theme can only
 * touch chrome tokens, never an arbitrary CSS custom property, so it can never smuggle a property the
 * design system does not expose. Extend as the design system exposes more themeable tokens.
 */
export const THEMEABLE_TOKENS: readonly string[] = [
  "--wt-color-primary",
  "--wt-color-primary-text",
  "--wt-color-surface",
  "--wt-color-surface-text",
  "--wt-color-accent",
  "--wt-color-danger",
  "--wt-radius",
  "--wt-font-family",
];

/** Value cap (design §9). Carried in `too_long` as the cap, never the offending length (CLAUDE.md §1). */
export const MAX_THEME_VALUE_LENGTH = 64;

// A conservative charset for a token value: letters, digits, spaces and the punctuation that appears in
// colours, lengths, and font stacks (#, %, ., ,, (), -, /). Notably EXCLUDES ; { } : < > " ' \ so a
// value cannot break out of a `--token: value;` declaration into another rule (CSS-injection safe).
const SAFE_VALUE = /^[A-Za-z0-9 #%.,()\-/]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate an untrusted theme override (design §9). Returns it on success; throws `theme.invalid`.
 * Only allowlisted tokens, only safe bounded values — the un-allowlisted token name is never echoed.
 */
export function validateThemeOverride(input: unknown): ThemeOverride {
  if (!isPlainObject(input)) throw new AppError("theme.invalid", { reason: "not_object" });
  if (!isPlainObject(input.tokens)) throw new AppError("theme.invalid", { reason: "bad_tokens" });
  const tokens: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.tokens)) {
    if (!THEMEABLE_TOKENS.includes(name)) {
      throw new AppError("theme.invalid", { reason: "unknown_token" });
    }
    if (typeof value !== "string" || !SAFE_VALUE.test(value)) {
      throw new AppError("theme.invalid", { reason: "bad_value", token: name });
    }
    if (value.length > MAX_THEME_VALUE_LENGTH) {
      throw new AppError("theme.invalid", { reason: "too_long", token: name, maxLength: MAX_THEME_VALUE_LENGTH });
    }
    tokens[name] = value;
  }
  return { tokens };
}
```

- [ ] **Step 4: Run test to verify it passes; prove the charset guard by deletion**

Run: `pnpm --filter @waitron/layouts test theme`
Expected: PASS. Then temporarily loosen `SAFE_VALUE` to `/.*/`, re-run, confirm the injection case
FAILS to reject, restore.

- [ ] **Step 5: Commit**

```bash
git add packages/layouts/src/theme.ts packages/layouts/src/theme.test.ts
git commit -s -m "feat(layouts): validateThemeOverride with token allowlist + CSS-injection-safe values"
```

---

### Task 8: Built-in default profiles

**Files:**
- Create: `packages/layouts/src/default-profiles.ts`
- Test: `packages/layouts/src/default-profiles.test.ts`

**Interfaces:**
- Consumes: `ProfileDef`, `FormFactor`, `FORM_FACTORS` (Task 2); `validateProfile` (Tasks 4–6);
  `CARD_CONTRACTS` default spans (Task 3).
- Produces: `const DEFAULT_PROFILES: Record<FormFactor, ProfileDef>` — a built-in profile for every
  form factor, each of which passes `validateProfile`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/layouts/src/default-profiles.test.ts
import { describe, expect, it } from "vitest";
import { FORM_FACTORS } from "./profile.js";
import { validateProfile } from "./validate-profile.js";
import { DEFAULT_PROFILES } from "./default-profiles.js";

describe("default profiles", () => {
  it("ships a profile for every form factor", () => {
    for (const f of FORM_FACTORS) expect(DEFAULT_PROFILES[f]).toBeDefined();
  });
  it("every default profile passes validateProfile", () => {
    for (const f of FORM_FACTORS) expect(() => validateProfile(DEFAULT_PROFILES[f])).not.toThrow();
  });
  it("the till default is a selling profile (has the sale-critical cards)", () => {
    const till = validateProfile(DEFAULT_PROFILES.till);
    const placed = new Set(till.tabs.flatMap((t) => t.cards.map((c) => c.type)));
    for (const c of ["product-grid", "basket", "total", "tender-pay"]) expect(placed.has(c as never)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/layouts test default-profiles`
Expected: FAIL — `./default-profiles.js` does not exist.

- [ ] **Step 3: Write the module**

```ts
// packages/layouts/src/default-profiles.ts
import type { FormFactor, ProfileDef } from "./profile.js";

/**
 * Built-in default profiles (design §4.3) — the "return-a-default-when-unauthored" precedent from the
 * old getLayout, one per form factor. A venue starts from / copies one; the later store slice returns
 * these when a device's profile is unauthored. Spans mirror the card-contract defaults.
 */
const TILL: ProfileDef = {
  formFactor: "till",
  capabilities: ["integrated-card-payment", "open-cash-drawer"],
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
        { type: "total", colSpan: 4, rowSpan: 1, config: {} },
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
        { type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] },
      ],
    },
    { key: "floor", title: "Floor", columns: 24, cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }] },
  ],
};

const PHONE: ProfileDef = {
  formFactor: "phone-portrait",
  capabilities: [],
  tabs: [
    { key: "floor", title: "Floor", columns: 4, cards: [{ type: "floor-plan", colSpan: 4, rowSpan: 12, config: {} }] },
    { key: "order", title: "Order", columns: 4, cards: [{ type: "table-order", colSpan: 4, rowSpan: 12, config: {} }] },
  ],
};

const TABLET: ProfileDef = {
  formFactor: "tablet-landscape",
  capabilities: [],
  tabs: [
    { key: "floor", title: "Floor", columns: 12, cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 12, config: {} }] },
    { key: "order", title: "Order", columns: 12, cards: [{ type: "table-order", colSpan: 12, rowSpan: 12, config: {} }] },
  ],
};

const KDS: ProfileDef = {
  formFactor: "kds",
  capabilities: ["act-as-kds"],
  tabs: [{ key: "kitchen", title: "Kitchen", columns: 24, cards: [{ type: "kds-board", colSpan: 24, rowSpan: 12, config: {} }] }],
};

export const DEFAULT_PROFILES: Record<FormFactor, ProfileDef> = {
  till: TILL,
  "phone-portrait": PHONE,
  "tablet-landscape": TABLET,
  kds: KDS,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/layouts test default-profiles`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/layouts/src/default-profiles.ts packages/layouts/src/default-profiles.test.ts
git commit -s -m "feat(layouts): built-in default profiles per form factor"
```

---

### Task 9: Public barrel exports + package green

**Files:**
- Modify: `packages/layouts/src/index.ts`
- Test: `packages/layouts/src/index.test.ts` (create)

**Interfaces:**
- Produces: the new surface re-exported from the package barrel, alongside the existing widget exports:
  `FORM_FACTORS`, `CARD_TYPES`, `CAPABILITY_FLAGS`, types (`FormFactor`, `CardType`, `CapabilityFlag`,
  `CardInstance`, `TabDef`, `ThemeOverride`, `ProfileDef`), `CARD_CONTRACTS`, `SALE_CRITICAL_CARDS`,
  `GRID_MAX_COLUMNS`, `CardContract`, `validateProfile`, `MAX_TAB_TITLE_LENGTH`, `validateThemeOverride`,
  `THEMEABLE_TOKENS`, `MAX_THEME_VALUE_LENGTH`, `DEFAULT_PROFILES`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/layouts/src/index.test.ts
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("@waitron/layouts barrel", () => {
  it("exports the new profile surface", () => {
    expect(api.FORM_FACTORS).toBeDefined();
    expect(api.CARD_CONTRACTS).toBeDefined();
    expect(typeof api.validateProfile).toBe("function");
    expect(typeof api.validateThemeOverride).toBe("function");
    expect(api.DEFAULT_PROFILES.till).toBeDefined();
  });
  it("still exports the existing widget surface (transitional coexistence)", () => {
    expect(api.WIDGET_TYPES).toBeDefined();
    expect(typeof api.validateLayout).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/layouts test index`
Expected: FAIL — the new names are not exported yet.

- [ ] **Step 3: Add the exports**

Append to `index.ts` (keep the existing widget re-exports and the trailing `import "./errors.js";`):

```ts
export { FORM_FACTORS, CARD_TYPES, CAPABILITY_FLAGS } from "./profile.js";
export type {
  FormFactor,
  CardType,
  CapabilityFlag,
  CardInstance,
  TabDef,
  ThemeOverride,
  ProfileDef,
} from "./profile.js";
export { CARD_CONTRACTS, SALE_CRITICAL_CARDS, GRID_MAX_COLUMNS } from "./card-contract.js";
export type { CardContract } from "./card-contract.js";
export { validateProfile, MAX_TAB_TITLE_LENGTH } from "./validate-profile.js";
export { validateThemeOverride, THEMEABLE_TOKENS, MAX_THEME_VALUE_LENGTH } from "./theme.js";
export { DEFAULT_PROFILES } from "./default-profiles.js";
```

- [ ] **Step 4: Run the full package gate**

Run:
```bash
pnpm --filter @waitron/layouts test index
pnpm --filter @waitron/layouts lint
pnpm --filter @waitron/layouts typecheck
pnpm --filter @waitron/layouts test:coverage
```
Expected: all PASS; coverage ≥ 98/98/98/95. If a branch is uncovered, add the missing negative case
(do not lower a threshold). Also run the tree-wide reachability guard, since a new `errors.ts` edge
must stay reachable from the barrel:
```bash
pnpm vitest run scripts/errors-reachable.test.ts
```
Expected: PASS (the barrel already `import "./errors.js"`).

- [ ] **Step 5: Commit**

```bash
git add packages/layouts/src/index.ts packages/layouts/src/index.test.ts
git commit -s -m "feat(layouts): export the profile/card/theme surface from the barrel"
```

---

## Self-Review (done at authoring time)

- **Spec coverage:** §4 model → Tasks 2 (types) + 8 (defaults); §4.2 card contract → Task 3; §5
  abilities (permission/capability fields) → Task 3 (`requiredPermission`/`requiredCapability`; server
  *enforcement* is SP-A.2, out of this slice by design); §6 visibility axes → Task 3
  (`visibilityStates`) + Task 5 (`visibleWhen ⊆ states`); §9 theme → Tasks 2 + 7; §13 sale-critical →
  Task 6; §13 error-code/param rules → Task 1 + Global Constraints. DB/API/rendering/device/theme-editor
  are explicitly **other slices** — not gaps.
- **Placeholder scan:** the Task-4 `validateCards`/`assertSaleCritical` are **named transitional
  stubs** that compile and pass Task 4's own tests, and are *replaced with real code in Tasks 5 and 6*
  (not left as TODOs) — an intentional TDD staging of one function, not a placeholder.
- **Type consistency:** `validateProfile`, `validateThemeOverride`, `CARD_CONTRACTS`,
  `SALE_CRITICAL_CARDS`, `GRID_MAX_COLUMNS`, `MAX_TAB_TITLE_LENGTH`, `MAX_THEME_VALUE_LENGTH`,
  `THEMEABLE_TOKENS`, `DEFAULT_PROFILES`, and the `CardInstance`/`TabDef`/`ProfileDef`/`ThemeOverride`
  shapes are used identically across tasks and the barrel.

## What this slice deliberately does NOT do (later SP-A slices)

- **SP-A.2 (next plan):** the `layout_profiles` + `tenant_themes` tables (FORCE RLS + isolation policy +
  grants; run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`), the store service
  (list/get/create/update/delete + get-with-default), the management API, and the `@waitron/db`
  `exports`-map entries.
- **SP-A.3 (device unification, H2-gated):** the `till` device kind, device→profile FK + per-device
  hardware bindings, enrolment extension, and **server-side enforcement** of the `capabilities` flags +
  the card `requiredPermission`/`requiredCapability`. The fiscal §7 gate (verify `till_id`/`node_id`
  consumers by container + owner sign-off) applies there, not here.
- **Removal of the old widget model** (`WIDGET_TYPES`/`validateLayout`/`till_layouts`/counter render)
  happens in the SP-B rendering-swap slice, once screens render from profiles.
