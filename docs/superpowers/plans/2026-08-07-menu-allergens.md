# Menu & allergens (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every catalogue product a structured EU-14 allergen declaration and surface it to the customer before they order (an on-screen/printable allergen matrix + operator lookup on the till), discharging the launch-day legal duty.

**Architecture:** One additive `products.allergens jsonb` column (`null`=unreviewed, `{}`=none, else per-code `{presence, source?}`). A pure allergen taxonomy + validator in `@waitron/catalogue`. The catalogue write/read operations carry allergens; `GET /api/products` passes them to the till, which renders one allergen screen (matrix + operator lookup) and prints it. Nothing touches `sale_lines`, the fiscal path, or `computeHuella`.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/PGlite), Vitest, Lit + Vite (till), Hono (server), `@waitron/shared` `AppError` registry.

**Design:** `docs/superpowers/specs/2026-08-07-menu-allergens-design.md`.

## Global Constraints

- **TDD, one behaviour per test, commit per task.** Failing test first; watch it fail; minimal impl; watch it pass; commit `-s`.
- **Coverage thresholds:** `packages/*` = statements 98 / lines 98 / functions 98 / branches 95; `apps/till` = 95 / 95 / 90 / 88. Run `pnpm --filter <pkg> test:coverage` before claiming green.
- **Error codes name the DOMAIN CONCEPT, never the package** (`allergen.*`, not `catalogue.*`), are **never renamed once shipped**, and every file that throws one does `import "./errors.js"`. Registered by declaration-merging into `@waitron/shared` (mirror `packages/identity/src/errors.ts`).
- **`english-only` guard:** `@waitron/catalogue` is a generic package — its `src/` must use English/regime-neutral tokens only. Allergen **codes** are English (safe there); the Spanish **display names** live in `apps/till/src/i18n` (`apps/*` is exempt). Do NOT put Spanish allergen names in `@waitron/catalogue`.
- **Dependency direction:** `@waitron/catalogue` depends on `@waitron/db`, so **`packages/db` must not import from `@waitron/catalogue`** (circular). The db column `$type` uses a *structural* inline type, not catalogue's `ProductAllergens`.
- **No DELETE, deactivate-only.** `products` already has FORCE RLS + policy + grants (migration `0027`); adding a column needs **no** new RLS migration and does not engage the `inmutabilidad` guard.
- **Migration sequencing:** this adds `packages/db/drizzle/0031_*.sql`. The parallel cierre Z (#8) branch also adds a `packages/db` migration; `drizzle/meta/_journal.json` collides. Whichever lands second **rebases** its migration to the next free number.
- **Nothing touches `sale_lines`, `working_order_lines`, the fiscal backend, or `computeHuella`.** Allergens are catalogue-side, pre-purchase only.
- **Gate before PR:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter <changed> test:coverage`, and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` is a no-op here (no tenant-scoped table added) but harmless to run.

---

### Task 1: Allergen taxonomy, validator & error codes (`@waitron/catalogue`, pure)

**Files:**
- Create: `packages/catalogue/src/allergens.ts`
- Create: `packages/catalogue/src/errors.ts`
- Create: `packages/catalogue/src/allergens.test.ts`
- Modify: `packages/catalogue/src/index.ts` (add `export * from "./allergens.js";`)

**Interfaces:**
- Consumes: `AppError` from `@waitron/shared`.
- Produces:
  - `type AllergenCode` (union of the 14), `const ALLERGEN_CODES: readonly AllergenCode[]`
  - `type AllergenPresence = "contains" | "may_contain"`
  - `interface AllergenDeclaration { presence: AllergenPresence; source?: string }`
  - `type ProductAllergens = Record<string, AllergenDeclaration>` — a plain string-keyed record (keys are `AllergenCode`s, enforced at **runtime** by `validateAllergens`, not at compile time). This is deliberate: it is byte-identical to the db column's `$type` and `TillProduct.allergens`, so allergens flow db↔catalogue↔till with **no cast**. (A `Partial<Record<AllergenCode, …>>` would not be assignable to the db `Record<string, …>` type on insert — optional keys become `X | undefined`, which the index signature rejects.)
  - `function validateAllergens(value: unknown): ProductAllergens` — returns the validated object (narrowed), throws `AppError` on any invalid key/presence.
  - error codes `allergen.invalid_code` `{ code: string }` and `allergen.invalid_presence` `{ code: string; presence: string }`.

- [ ] **Step 1: Write the failing tests** — `packages/catalogue/src/allergens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { ALLERGEN_CODES, validateAllergens } from "./allergens.js";

describe("ALLERGEN_CODES", () => {
  it("is the closed EU-14 list", () => {
    expect(ALLERGEN_CODES).toHaveLength(14);
    expect(ALLERGEN_CODES).toContain("gluten");
    expect(ALLERGEN_CODES).toContain("molluscs");
    expect(new Set(ALLERGEN_CODES).size).toBe(14); // no dups
  });
});

describe("validateAllergens", () => {
  it("accepts an empty object (reviewed, none of the 14)", () => {
    expect(validateAllergens({})).toEqual({});
  });

  it("accepts a full valid declaration with an optional source", () => {
    const a = { gluten: { presence: "contains", source: "wheat" }, nuts: { presence: "may_contain" } };
    expect(validateAllergens(a)).toEqual(a);
  });

  it("rejects an unknown allergen code", () => {
    expect(() => validateAllergens({ gluteen: { presence: "contains" } })).toThrow(AppError);
    try {
      validateAllergens({ gluteen: { presence: "contains" } });
    } catch (e) {
      expect((e as AppError).code).toBe("allergen.invalid_code");
    }
  });

  it("rejects a bad presence value", () => {
    try {
      validateAllergens({ gluten: { presence: "maybe" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("allergen.invalid_presence");
    }
  });

  it("rejects a non-object value", () => {
    expect(() => validateAllergens("gluten")).toThrow(AppError);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/catalogue test allergens` → FAIL (module not found).

- [ ] **Step 3: Write `errors.ts`** (mirror `packages/identity/src/errors.ts`):

```ts
// A bare side-effect import so TypeScript augments the real "@waitron/shared" module.
import "@waitron/shared";

/** @waitron/catalogue's contribution to the shared error registry — DOMAIN-CONCEPT prefixes. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A key in a product's allergen declaration is not one of the EU-14 codes. */
    "allergen.invalid_code": { code: string };
    /** An allergen's presence is not "contains" | "may_contain". */
    "allergen.invalid_presence": { code: string; presence: string };
  }
}
```

- [ ] **Step 4: Write `allergens.ts`:**

```ts
import { AppError } from "@waitron/shared";
import "./errors.js"; // load the code registry for the throws below

export const ALLERGEN_CODES = [
  "gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk",
  "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs",
] as const;

export type AllergenCode = (typeof ALLERGEN_CODES)[number];
export type AllergenPresence = "contains" | "may_contain";
export interface AllergenDeclaration {
  presence: AllergenPresence;
  /** Optional free-text specific substance ("wheat", "almonds"), for Annex II specificity. */
  source?: string;
}
export type ProductAllergens = Partial<Record<AllergenCode, AllergenDeclaration>>;

const CODES = new Set<string>(ALLERGEN_CODES);
const PRESENCES = new Set<AllergenPresence>(["contains", "may_contain"]);

/** Validate a caller/JSON-supplied allergen map. Returns it narrowed; throws AppError on any fault. */
export function validateAllergens(value: unknown): ProductAllergens {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("allergen.invalid_code", { code: String(value) });
  }
  for (const [code, decl] of Object.entries(value as Record<string, unknown>)) {
    if (!CODES.has(code)) throw new AppError("allergen.invalid_code", { code });
    const presence = (decl as { presence?: unknown })?.presence;
    if (typeof presence !== "string" || !PRESENCES.has(presence as AllergenPresence)) {
      throw new AppError("allergen.invalid_presence", { code, presence: String(presence) });
    }
  }
  return value as ProductAllergens;
}
```

- [ ] **Step 5: Export from the barrel** — add to `packages/catalogue/src/index.ts`:

```ts
export * from "./allergens.js";
```

- [ ] **Step 6: Run tests + coverage** — `pnpm --filter @waitron/catalogue test:coverage` → PASS at threshold.

- [ ] **Step 7: Prove the guard by deletion** — temporarily change `if (!CODES.has(code))` to `if (false)`, run the "unknown code" test, confirm it FAILS, restore.

- [ ] **Step 8: Commit** — `git add -A && git commit -s -m "feat(catalogue): EU-14 allergen taxonomy + validator + error codes"`

---

### Task 2: `products.allergens` column + migration (`packages/db`)

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts` (add the column to the `products` table)
- Create: `packages/db/drizzle/0031_*.sql` (generated)
- Modify: `packages/db/drizzle/meta/_journal.json` + snapshot (generated)
- Test: `packages/db/src/schema/catalogue.test.ts` (add a column-presence assertion; create it if absent — check first)

**Interfaces:**
- Produces: `products.allergens` — a nullable jsonb column, structurally typed `Record<string, { presence: "contains" | "may_contain"; source?: string }>` (NO import from `@waitron/catalogue`).

- [ ] **Step 1: Add the column** to the `products` `pgTable` in `packages/db/src/schema/catalogue.ts`, after `active`:

```ts
    // Allergen declaration (EU 1169/2011 Annex II). NULL = not yet reviewed (a compliance gap the
    // till surfaces distinctly); {} = reviewed, contains none of the 14; else per-code presence +
    // optional specific-substance source. Structural type only — the exact AllergenCode-keyed type
    // lives in @waitron/catalogue (which depends on THIS package, so it cannot be imported here).
    allergens: jsonb("allergens").$type<
      Record<string, { presence: "contains" | "may_contain"; source?: string }>
    >(),
```

(`jsonb` is already imported. Nullable — no `.notNull()`.)

- [ ] **Step 2: Generate the migration** — `pnpm --filter @waitron/db db:generate`. It emits `packages/db/drizzle/0031_<name>.sql`.

- [ ] **Step 3: Verify the generated SQL is exactly the additive column** — open the new file; it MUST be only:

```sql
ALTER TABLE "products" ADD COLUMN "allergens" jsonb;
```

If it contains anything else (dropped/renamed anything), STOP — the schema was edited wrong. It must not touch RLS, policies, or grants.

- [ ] **Step 4: Assert the column in a schema test** — in `packages/db/src/schema/catalogue.test.ts` (mirror the file's existing column assertions; if the file does not exist, add a minimal one loading the migration into PGlite and asserting the column exists):

```ts
it("products carries a nullable allergens jsonb column", async () => {
  const db = await createPgliteDb();
  await runMigrations(db);
  const { rows } = await db.query(
    `select data_type, is_nullable from information_schema.columns
     where table_name = 'products' and column_name = 'allergens'`,
  );
  expect(rows[0]).toMatchObject({ data_type: "jsonb", is_nullable: "YES" });
});
```

- [ ] **Step 5: Run** — `pnpm --filter @waitron/db test:coverage` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -s -m "feat(db): add nullable products.allergens jsonb column (0031)"`

---

### Task 3: Carry allergens through catalogue operations (`@waitron/catalogue`)

**Files:**
- Modify: `packages/catalogue/src/operations.ts`
- Test: `packages/catalogue/src/operations.test.ts` (PGlite round-trip) and `packages/catalogue/src/operations.rls.test.ts` (real-PG, mirror existing cases)

**Interfaces:**
- Consumes: `ProductAllergens`, `validateAllergens` (Task 1); `products` (Task 2).
- Produces: `CreateProductInput.allergens?: ProductAllergens`; `UpdateProductInput.allergens?: ProductAllergens | null`; `Product.allergens: ProductAllergens | null`; `AvailableProduct.allergens: ProductAllergens | null`.

- [ ] **Step 1: Write the failing tests** — add to `packages/catalogue/src/operations.test.ts`:

```ts
it("round-trips a product's allergens", async () => {
  // ...existing catalogue/product setup helpers in this file...
  const p = await createProduct(tx, { ...baseProductInput, allergens: { gluten: { presence: "contains", source: "wheat" } } });
  expect(p.allergens).toEqual({ gluten: { presence: "contains", source: "wheat" } });
  const [listed] = await listProducts(tx, catalogueId);
  expect(listed!.allergens).toEqual({ gluten: { presence: "contains", source: "wheat" } });
});

it("defaults allergens to null (unreviewed) when omitted", async () => {
  const p = await createProduct(tx, baseProductInput);
  expect(p.allergens).toBeNull();
});

it("rejects an invalid allergen code on create", async () => {
  await expect(
    createProduct(tx, { ...baseProductInput, allergens: { nope: { presence: "contains" } } as never }),
  ).rejects.toMatchObject({ code: "allergen.invalid_code" });
});

it("listAvailableProducts returns allergens", async () => {
  await createProduct(tx, { ...baseProductInput, allergens: { milk: { presence: "contains" } } });
  await assignCatalogueToLocation(tx, locationId, catalogueId);
  const [available] = await listAvailableProducts(tx, locationId);
  expect(available!.allergens).toEqual({ milk: { presence: "contains" } });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/catalogue test operations` → FAIL.

- [ ] **Step 3: Implement** in `operations.ts`:
  - Import: `import { validateAllergens, type ProductAllergens } from "./allergens.js";`
  - `Product` interface: add `allergens: ProductAllergens | null;`
  - `CreateProductInput`: add `allergens?: ProductAllergens;`
  - `UpdateProductInput`: add `allergens?: ProductAllergens | null;`
  - `AvailableProduct`: add `allergens: ProductAllergens | null;`
  - `RawProduct`: add `allergens: ProductAllergens | null;`
  - `PRODUCT_COLUMNS`: add `allergens: products.allergens,`
  - `toProduct`: passes `allergens` through unchanged (structural `...row` already carries it; ensure the return type matches — it does, since the db `$type` is structurally assignable to `ProductAllergens | null`).
  - `createProduct`: before insert, `const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);` then add `allergens,` to `.values({...})`.
  - `updateProduct`: at the top, `if (patch.allergens != null) validateAllergens(patch.allergens);` (a `null` clears it, `undefined` leaves it unchanged; the `.set({...patch})` maps `allergens` to the column).
  - `listAvailableProducts` select: add `allergens: products.allergens,` and add `allergens: row.allergens,` to the mapped return.

- [ ] **Step 4: Add an RLS round-trip case** — in `operations.rls.test.ts`, mirror an existing real-PG product case and assert allergens survive a create→listAvailableProducts under `asAppUser` (the non-superuser role holds UPDATE/INSERT on `products` from `0027`).

- [ ] **Step 5: Run** — `pnpm --filter @waitron/catalogue test:coverage` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -s -m "feat(catalogue): carry product allergens through create/update/list"`

---

### Task 4: Expose allergens on `GET /api/products` (`apps/server` + `apps/till` client type)

**Files:**
- Modify: `apps/till/src/api/client.ts` (`TillProduct` + a local allergen type)
- Test: `apps/server/src/till-api.realpg.test.ts` (or the existing till-api test) — assert `/api/products` returns allergens; `apps/till/src/api/client.test.ts` — assert the client parses them.

**Interfaces:**
- Consumes: `AvailableProduct.allergens` (Task 3) — the route already returns `listAvailableProducts` via `c.json(products)` (`apps/server/src/till-api.ts` `GET /api/products`), so allergens flow through **with no server code change**.
- Produces: `TillProduct.allergens: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null`.

- [ ] **Step 1: Write the failing tests.**
  - `apps/server/src/till-api.realpg.test.ts`: extend the products-fetch case to seed a product with allergens and assert `GET /api/products` returns them.
  - `apps/till/src/api/client.test.ts`: mock a `/api/products` response including `allergens` and assert `listProducts()` returns it typed.

- [ ] **Step 2: Run to verify failure** → FAIL (TillProduct has no `allergens`).

- [ ] **Step 3: Implement** — in `apps/till/src/api/client.ts`, extend `TillProduct` (keep the deliberate no-catalogue-import decoupling — redefine the shape locally):

```ts
export interface TillProduct {
  id: string;
  descriptions: Record<string, string>;
  pricingUnit: "each" | "weight";
  unitPrice: string;
  vatClass: "general" | "reduced" | "super_reduced" | "zero";
  category: string | null;
  /** EU-14 allergen declaration; null = not reviewed. Keyed by allergen code. */
  allergens: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
}
```

(No server route change — verify by test that the existing `c.json(listAvailableProducts(...))` carries the field.)

- [ ] **Step 4: Run** — `pnpm --filter @waitron/server test:coverage` and `pnpm --filter @waitron/till test:coverage` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -s -m "feat(till): carry product allergens from /api/products to the client"`

---

### Task 5: Allergen display names (en/es) in till i18n (`apps/till`)

**Files:**
- Create: `apps/till/src/i18n/allergen-names.ts`
- Create: `apps/till/src/i18n/allergen-names.test.ts`

**Interfaces:**
- Produces: `function allergenName(code: string, locale: string): string` (falls back to `en`, then the raw code).

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, expect, it } from "vitest";
import { ALLERGEN_NAMES, allergenName } from "./allergen-names.js";

const CODES = ["gluten","crustaceans","eggs","fish","peanuts","soybeans","milk","nuts","celery","mustard","sesame","sulphites","lupin","molluscs"];

describe("allergen names", () => {
  it("has an en and es name for every EU-14 code", () => {
    for (const c of CODES) {
      expect(ALLERGEN_NAMES[c]?.en).toBeTruthy();
      expect(ALLERGEN_NAMES[c]?.es).toBeTruthy();
    }
  });
  it("resolves by locale and falls back to en then the code", () => {
    expect(allergenName("milk", "es")).toBe("Leche");
    expect(allergenName("milk", "fr")).toBe(ALLERGEN_NAMES.milk!.en);
    expect(allergenName("unknown", "es")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `allergen-names.ts`** — the canonical EU names. **Verify the `es` column against the Spanish version of Reg. 1169/2011 Annex II (BOE / EUR-Lex ES) before committing** — these are the load-bearing display strings:

```ts
export const ALLERGEN_NAMES: Record<string, { en: string; es: string }> = {
  gluten:      { en: "Cereals containing gluten",     es: "Cereales con gluten" },
  crustaceans: { en: "Crustaceans",                   es: "Crustáceos" },
  eggs:        { en: "Eggs",                          es: "Huevos" },
  fish:        { en: "Fish",                          es: "Pescado" },
  peanuts:     { en: "Peanuts",                       es: "Cacahuetes" },
  soybeans:    { en: "Soybeans",                      es: "Soja" },
  milk:        { en: "Milk",                          es: "Leche" },
  nuts:        { en: "Nuts",                          es: "Frutos de cáscara" },
  celery:      { en: "Celery",                        es: "Apio" },
  mustard:     { en: "Mustard",                       es: "Mostaza" },
  sesame:      { en: "Sesame seeds",                  es: "Granos de sésamo" },
  sulphites:   { en: "Sulphur dioxide and sulphites", es: "Dióxido de azufre y sulfitos" },
  lupin:       { en: "Lupin",                         es: "Altramuces" },
  molluscs:    { en: "Molluscs",                      es: "Moluscos" },
};

export function allergenName(code: string, locale: string): string {
  const entry = ALLERGEN_NAMES[code];
  if (!entry) return code;
  return (entry as Record<string, string>)[locale] ?? entry.en;
}
```

- [ ] **Step 4: Run** — `pnpm --filter @waitron/till test allergen-names` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -s -m "feat(till): canonical EU allergen display names (en/es)"`

---

### Task 6: The allergen screen — matrix + operator lookup (`apps/till`)

**Files:**
- Create: `apps/till/src/screens/till-allergen-screen.ts` (Lit element `<till-allergen-screen>`)
- Create: `apps/till/src/screens/till-allergen-screen.test.ts`
- Create: `apps/till/src/screens/till-allergen-screen.a11y.test.ts`
- Modify: `apps/till/src/screens/till-counter-screen.ts` (add an "Allergens" button that opens the screen)
- Modify: `apps/till/src/i18n/strings.ts` (add UI-chrome keys: `allergens.title`, `allergens.notice`, `allergens.pending`, `allergens.contains`, `allergens.mayContain`, `allergens.print`, `allergens.close`, `allergens.open`)

**Interfaces:**
- Consumes: `TillProduct[]` (Task 4, incl. `allergens`), `allergenName` + `ALLERGEN_NAMES` (Task 5), `t()` (i18n), `ALLERGEN_CODES` order — redefine the 14-code display order locally in the till (do NOT import `@waitron/catalogue` into the browser bundle; mirror the client-decoupling rule).
- Produces: `<till-allergen-screen .products=${TillProduct[]} .locale=${string} .invoiceLocale=${string}>`; the counter screen renders an "Allergens" `wt-button` that shows it.

Mirror the existing screen/widget conventions exactly: `apps/till/src/screens/till-ticket-view.ts` (structure, print path, `invoiceLocale` handling), `apps/till/src/widgets/product-grid.ts` (grid + `wt-button` tiles), `apps/till/src/widgets/held-orders.ts` (a list widget with row actions + a `wt-dialog`), and their `.test.ts` / `.a11y.test.ts` siblings.

- [ ] **Step 1: Add the i18n keys** to `strings.ts` (`en` source of truth + `es` translations), e.g. `en.allergens = { title: "Allergens", notice: "Allergen information is available — please ask staff.", pending: "Allergen info pending", contains: "Contains", mayContain: "May contain", print: "Print", close: "Close", open: "Allergens" }`, and the `es` equivalents.

- [ ] **Step 2: Write the failing component tests** — `till-allergen-screen.test.ts` (mirror `product-grid.test.ts` harness):

```ts
// renders a row per product with its name (operator locale)
// a "contains" cell for a declared allergen, a "may contain" cell distinct from it
// shows the `source` in the row detail (open dialog) as e.g. "Cereals containing gluten (wheat)"
// a product with allergens === null renders the "pending" state, NOT an all-clear row
// a product with allergens === {} renders as reviewed / no allergens (distinct from pending)
// renders allergen column headers via allergenName(code, locale)
```

- [ ] **Step 3: Run to verify failure** → FAIL (element not defined).

- [ ] **Step 4: Implement `<till-allergen-screen>`** — a `wt-card`-framed screen: a header carrying `t("allergens.notice")`; a product × 14-allergen grid (columns = `allergenName(code, locale)`, rows = products); each cell shows contains/may-contain/blank; a row tap opens a `wt-dialog` with per-allergen `name (source)` detail; `allergens === null` rows render the `pending` treatment; a **Print** `wt-button` calls the same print path `till-ticket-view.ts` uses, rendering in `invoiceLocale`. Use `wt-*` primitives and design tokens only (the `no-hardcoded-chrome` guard). Define the 14-code display order as a local `const` array in this file.

- [ ] **Step 5: Wire the counter screen** — in `till-counter-screen.ts`, add an "Allergens" `wt-button` (label `t("allergens.open")`) that shows `<till-allergen-screen>` (overlay/route as the counter screen already toggles views); pass `.products`, `.locale`, `.invoiceLocale`.

- [ ] **Step 6: Write the a11y test** — mirror `till-ticket-view.a11y.test.ts` (roles, headings, dialog focus, contrast via the token guard).

- [ ] **Step 7: Run** — `pnpm --filter @waitron/till test:coverage` → PASS at 95/95/90/88.

- [ ] **Step 8: Prove the pending guard by deletion** — temporarily make the `allergens === null` branch render an all-clear row; confirm the "pending, NOT all-clear" test FAILS; restore.

- [ ] **Step 9: Commit** — `git add -A && git commit -s -m "feat(till): allergen screen (matrix + operator lookup) with print"`

---

### Task 7: Seed + demo, end-to-end (`apps/server`)

**Files:**
- Create: `apps/server/scripts/allergens-demo.ts` (mirror `apps/server/scripts/catalogue-demo.ts`)
- Modify: `apps/server/package.json` (add `"demo:allergens": "tsx scripts/allergens-demo.ts"`)

**Interfaces:**
- Consumes: everything above (`createProduct` with allergens, `listAvailableProducts`).

- [ ] **Step 1: Write the demo** — mirror `catalogue-demo.ts`: provision/seed a catalogue with 3–4 products carrying varied allergens (one with a `source`, one `may_contain`, one `{}`, one left `null`), assign it to a location, then `listAvailableProducts` and print (to stdout) the allergen matrix + a single-product operator-lookup view. It must run against a real/PGlite DB and exit 0.

- [ ] **Step 2: Run it** — `pnpm --filter @waitron/server demo:allergens` → prints the matrix, the `null`/pending product shown distinctly, exit 0.

- [ ] **Step 3: Commit** — `git add -A && git commit -s -m "feat(server): allergens end-to-end demo (demo:allergens)"`

---

## Self-review (run before handing off)

- **Spec coverage:** D1 tags→Task 1/3; D2 jsonb column→Task 2; D3 not-on-sale_lines→(no task touches them, by construction); D4 null-vs-{}→Task 1 (validator accepts both) + Task 6 (pending render); D5 codes-in-catalogue / names-in-till→Task 1 + Task 5; D6 headless authoring→Task 3 + Task 7 (no authoring UI); D7 one screen→Task 6. §Surfaces compliance mapping→Task 6 (notice) + spec. §Server single change→Task 4. §Migration sequencing→Global Constraints + Task 2.
- **Placeholder scan:** none — every step carries code or an exact file to mirror.
- **Type consistency:** `ProductAllergens` / `AllergenDeclaration` / `validateAllergens` used identically in Tasks 1→3; the db structural type (Task 2) and `TillProduct.allergens` (Task 4) are the same `{ presence: "contains"|"may_contain"; source?: string }` shape; `allergenName` (Task 5) consumed in Task 6.

## Execution handoff

After the plan is approved, implement via **superpowers:subagent-driven-development** (fresh subagent per task, two-stage review between tasks). Sequence is linear (1→7); Task 2's migration number rebases if cierre Z lands first.
