# Modifier ↔ Allergen Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A menu modifier changes a dish's as-served EU-14 allergen profile in both directions — *adds* ("extra cheese" → milk) and *removes* ("gluten-free bun" → gluten) — surfaced on the till/handheld order line and the KDS/expo ticket.

**Architecture:** Two nullable JSONB overlay columns (`add_allergens`, `remove_allergens`) on the existing FORCE-RLS `option_group_items` table, mirroring the per-option `vat_class` override. One pure leaf function `deriveAsServedAllergens(base, options)` folds the overlays against the dish's published allergens (the **Cautious** policy: an unreviewed base stays pending, a remove needs a reviewed base and clears may_contain, an add wins a conflict). The function is used server-side for the KDS/expo queue read and deep-imported by the till (the `priceBasket` precedent) for client-side display. Non-fiscal throughout — nothing is added to `sale_lines` or `record-sale.ts`, pinned by a huella-invariance test.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle ORM + PostgreSQL/PGlite, Vitest (node + headless-Chromium browser mode), Lit (dashboard/till widgets).

**Spec:** `docs/superpowers/specs/2026-08-31-modifier-allergen-association-design.md`

## Global Constraints

- **Non-fiscal invariant:** never add an allergen column to `sale_lines` or read allergens in `packages/core/src/record-sale.ts` / the fiscal backend. As-served is computed on read/display only. (Spec §7.)
- **Error codes name the DOMAIN CONCEPT and are never renamed once shipped** (CLAUDE.md §3). Grep the `allergen.*` / `catalogue.*` siblings in `packages/catalogue/src/errors.ts` before naming the new one; every file that throws a code does `import "./errors.js"`.
- **English identifiers only** (`packages/db/src/english-only.ts` guard): `add_allergens`, `remove_allergens`, `allergens` are all English — fine. Do not introduce Spanish schema tokens.
- **No backwards-compat / data-migration code** — pre-production; schema drops & recreates (CLAUDE.md §3). Additive nullable columns need no backfill.
- **The pure derivation module must stay runtime-dep-free.** `packages/catalogue/src/derivation.ts` currently imports only `import type … from "./allergens.js"` (erased at build). Keep it that way so the till's deep import `@waitron/catalogue/src/derivation.js` pulls in nothing heavy (the `priceBasket` precedent, `apps/till/src/state/working-order.ts:25`).
- **Cautious policy (verbatim, spec §4):** base `null` → `{ allergens: merge(all adds), pending: true }` (removes ignored); base reviewed → `{ allergens: merge(base minus all removes, all adds), pending: false }`; a remove deletes the code entirely (clears `contains` AND `may_contain`); removes applied before adds so **add wins** a cross-option conflict.
- **Types shared db↔catalogue↔till must stay structurally identical** (the `ProductAllergens = Record<string, AllergenDeclaration>` comment in `allergens.ts:28-33`). Type `add_allergens` with the db-layer `AllergenMap` (`schema/catalogue.ts:26`); type `remove_allergens` as `string[]`.
- **Verify step for every task** (the per-slice gate, memory `format-check-in-per-slice-gate`): `pnpm --filter <pkg> lint && pnpm --filter <pkg> typecheck && pnpm --filter <pkg> format:check && pnpm --filter <pkg> test:coverage`. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true` (CLAUDE.md §4).

---

### Task 1: Schema — the two overlay columns on `option_group_items`

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts:183-208` (the `optionGroupItems` table)
- Generate: `packages/db/drizzle/00NN_*.sql` (via `db:generate`)
- Test: `packages/db/src/schema/catalogue.rls.test.ts` (add columns to an existing option-item RLS case)

**Interfaces:**
- Produces: `optionGroupItems.addAllergens` (`jsonb`, `$type<AllergenMap>()`, nullable) and `optionGroupItems.removeAllergens` (`jsonb`, `$type<string[]>()`, nullable). `AllergenMap` is already exported from this file (`:26`).

- [ ] **Step 1: Write the failing test** — extend the option-item RLS/round-trip test to insert & read the two new columns as `app_user`.

In `packages/db/src/schema/catalogue.rls.test.ts`, find the existing `optionGroupItems` insert/select case (added in #184) and add, within the same tenant context, an assertion that a row written with the overlay reads back:

```ts
// as app_user, under withTenant(tenantId):
const [item] = await db
  .insert(optionGroupItems)
  .values({
    tenantId,
    groupId,
    name: { en: "Gluten-free bun" },
    addAllergens: null,
    removeAllergens: ["gluten"],
  })
  .returning();
expect(item!.removeAllergens).toEqual(["gluten"]);
expect(item!.addAllergens).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/db test catalogue.rls`
Expected: FAIL — `addAllergens`/`removeAllergens` are not properties of the insert type (typecheck) / column does not exist.

- [ ] **Step 3: Add the columns** to `optionGroupItems` in `schema/catalogue.ts`, immediately after `vatClass` (`:193`), with the doc comment explaining the overlay:

```ts
    vatClass: text("vat_class"),
    // The per-option ALLERGEN OVERLAY (EU 1169/2011 Annex II), applied to the dish's published
    // allergens to produce the as-served profile (@waitron/catalogue deriveAsServedAllergens). Both
    // NULLABLE and additive: option_group_items' existing FORCE RLS + policy + app_user grants (0082)
    // cover them with no change (the same way products' allergen overlays ride on products' policy).
    // `add_allergens`: codes this option ADDS ("extra cheese" → milk). NULL = adds nothing.
    addAllergens: jsonb("add_allergens").$type<AllergenMap>(),
    // `remove_allergens`: codes this option REMOVES ("gluten-free bun" → gluten). NULL = removes
    // nothing. A remove only takes effect against a REVIEWED base (Cautious policy, design §4).
    removeAllergens: jsonb("remove_allergens").$type<string[]>(),
    sort: integer("sort").notNull().default(0),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/db db:generate`
Expected: a new `packages/db/drizzle/00NN_*.sql` adding the two columns (`ADD COLUMN "add_allergens" jsonb`, `ADD COLUMN "remove_allergens" jsonb`). No RLS/policy/grant statements — the table already forces RLS and grants to `app_user` (0082). Confirm the SQL contains only the two `ALTER TABLE "option_group_items" ADD COLUMN` lines and the snapshot update.

- [ ] **Step 5: Run test to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test catalogue.rls`
Expected: PASS.

- [ ] **Step 6: Run the fiscal immutability guard** (a tenant-scoped table changed; confirms nothing regressed — CLAUDE.md §3)

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS (`option_group_items` already `relforcerowsecurity=true`; the additive columns do not change it).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/catalogue.ts packages/db/drizzle/
git commit -s -m "feat(db): add allergen overlay columns to option_group_items"
```

---

### Task 2: The pure derivation `deriveAsServedAllergens`

**Files:**
- Modify: `packages/catalogue/src/derivation.ts` (append; keep it runtime-dep-free)
- Test: `packages/catalogue/src/derivation.test.ts` (append cases; create the file if absent, mirroring the existing `mergeAllergenMaps`/`republish` tests)

**Interfaces:**
- Consumes: `mergeAllergenMaps` (same file, `:18`), `ProductAllergens`/`AllergenDeclaration` (type-only from `./allergens.js`).
- Produces:
  ```ts
  export interface OptionAllergenOverlay { add: ProductAllergens | null; remove: readonly string[] | null; }
  export interface AsServedAllergens { allergens: ProductAllergens; pending: boolean; }
  export function deriveAsServedAllergens(
    base: ProductAllergens | null,
    options: readonly OptionAllergenOverlay[],
  ): AsServedAllergens;
  ```

- [ ] **Step 1: Write the failing tests** in `packages/catalogue/src/derivation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveAsServedAllergens } from "./derivation.js";

describe("deriveAsServedAllergens (Cautious policy)", () => {
  it("unreviewed base → pending, adds shown, removes IGNORED", () => {
    const r = deriveAsServedAllergens(null, [
      { add: { milk: { presence: "contains" } }, remove: ["gluten"] },
    ]);
    expect(r).toEqual({ allergens: { milk: { presence: "contains" } }, pending: true });
  });

  it("reviewed base → base minus removes, plus adds", () => {
    const r = deriveAsServedAllergens(
      { gluten: { presence: "contains" }, milk: { presence: "contains" } },
      [{ add: null, remove: ["gluten"] }],
    );
    expect(r).toEqual({ allergens: { milk: { presence: "contains" } }, pending: false });
  });

  it("a remove clears may_contain too, not only contains", () => {
    const r = deriveAsServedAllergens({ nuts: { presence: "may_contain" } }, [
      { add: null, remove: ["nuts"] },
    ]);
    expect(r).toEqual({ allergens: {}, pending: false });
  });

  it("cross-option conflict: remove + add of same code → ADD WINS", () => {
    const r = deriveAsServedAllergens({ gluten: { presence: "contains" } }, [
      { add: null, remove: ["gluten"] },
      { add: { gluten: { presence: "contains" } }, remove: null },
    ]);
    expect(r).toEqual({ allergens: { gluten: { presence: "contains" } }, pending: false });
  });

  it("empty options echo a reviewed base unchanged", () => {
    const base = { eggs: { presence: "contains" } } as const;
    expect(deriveAsServedAllergens(base, [])).toEqual({ allergens: base, pending: false });
  });

  it("reviewed-none base (`{}`) with an add → the add, not pending", () => {
    const r = deriveAsServedAllergens({}, [{ add: { milk: { presence: "contains" } }, remove: null }]);
    expect(r).toEqual({ allergens: { milk: { presence: "contains" } }, pending: false });
  });

  it("null base with no options → empty + pending", () => {
    expect(deriveAsServedAllergens(null, [])).toEqual({ allergens: {}, pending: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/catalogue test derivation`
Expected: FAIL — `deriveAsServedAllergens` is not exported.

- [ ] **Step 3: Implement** — append to `packages/catalogue/src/derivation.ts` (no new imports):

```ts
/** A selected option's allergen overlay: the codes it ADDS and the codes it REMOVES. */
export interface OptionAllergenOverlay {
  add: ProductAllergens | null;
  remove: readonly string[] | null;
}

/** The as-served allergen profile of one dish line: the declared set plus a `pending` flag when the
 * dish's own allergens are unreviewed. Structurally the RecipeDerivation shape, so every surface that
 * renders product allergens already knows it. */
export interface AsServedAllergens {
  allergens: ProductAllergens;
  pending: boolean;
}

/** Fold a dish's published allergens with its selected options' overlays (design §4, "Cautious").
 * `base === null` (unreviewed) → the plate stays pending: removes cannot subtract from an unknown
 * base, so only the (always-safe) adds show. A reviewed base has its removed codes deleted entirely
 * (both `contains` and `may_contain`) and the adds merged in — adds applied last, so an add WINS a
 * cross-option conflict (over-declaring is the safe direction). Pure and total. */
export function deriveAsServedAllergens(
  base: ProductAllergens | null,
  options: readonly OptionAllergenOverlay[],
): AsServedAllergens {
  let adds: ProductAllergens = {};
  const removes = new Set<string>();
  for (const opt of options) {
    if (opt.add) adds = mergeAllergenMaps(adds, opt.add);
    if (opt.remove) for (const code of opt.remove) removes.add(code);
  }
  if (base === null) return { allergens: adds, pending: true };
  const stripped: ProductAllergens = {};
  for (const [code, decl] of Object.entries(base)) {
    if (!removes.has(code)) stripped[code] = decl;
  }
  return { allergens: mergeAllergenMaps(stripped, adds), pending: false };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/catalogue test derivation`
Expected: PASS (all 7).

- [ ] **Step 5: Prove the guard by deletion** (CLAUDE.md §4) — temporarily change `if (base === null)` to `if (false)` and confirm the "unreviewed base" test FAILS (removes would wrongly apply); restore.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/derivation.ts packages/catalogue/src/derivation.test.ts
git commit -s -m "feat(catalogue): deriveAsServedAllergens — Cautious dish − removes + adds fold"
```

---

### Task 3: Overlay validation + the new error code

**Files:**
- Modify: `packages/catalogue/src/errors.ts` (add one `allergen.*` code)
- Modify: `packages/catalogue/src/allergens.ts` (add `validateRemoveAllergens` + `assertAllergenOverlayDisjoint`)
- Test: `packages/catalogue/src/allergens.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export function validateRemoveAllergens(value: unknown): AllergenCode[];
  export function assertAllergenOverlayDisjoint(add: ProductAllergens | null, remove: readonly string[] | null): void;
  ```
  and error code `allergen.add_remove_conflict: { code: string }`.

- [ ] **Step 1: Write the failing tests** in `packages/catalogue/src/allergens.test.ts`:

```ts
import { AppError } from "@waitron/shared";
import { assertAllergenOverlayDisjoint, validateRemoveAllergens } from "./allergens.js";

it("validateRemoveAllergens accepts valid EU-14 codes", () => {
  expect(validateRemoveAllergens(["gluten", "milk"])).toEqual(["gluten", "milk"]);
});
it("validateRemoveAllergens rejects a non-array", () => {
  expect(() => validateRemoveAllergens({})).toThrow(AppError);
});
it("validateRemoveAllergens rejects an unknown code", () => {
  expect(() => validateRemoveAllergens(["banana"])).toThrow(/allergen.invalid_code/);
});
it("assertAllergenOverlayDisjoint throws when a code is both added and removed", () => {
  expect(() =>
    assertAllergenOverlayDisjoint({ gluten: { presence: "contains" } }, ["gluten"]),
  ).toThrow(/allergen.add_remove_conflict/);
});
it("assertAllergenOverlayDisjoint is a no-op when either side is null", () => {
  expect(() => assertAllergenOverlayDisjoint(null, ["gluten"])).not.toThrow();
  expect(() => assertAllergenOverlayDisjoint({ milk: { presence: "contains" } }, null)).not.toThrow();
});
```

(Match the assertion style already in `allergens.test.ts` — if it asserts on `err.code` rather than a message regex, use that. The code string is `allergen.add_remove_conflict`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/catalogue test allergens`
Expected: FAIL — functions not exported / code not registered.

- [ ] **Step 3a: Register the error code** — in `packages/catalogue/src/errors.ts`, inside the `declare module "@waitron/shared"` block beside the other `allergen.*` codes (`:8-12`):

```ts
    /** An option's allergen overlay adds and removes the same EU-14 code — a contradiction. */
    "allergen.add_remove_conflict": { code: string };
```

- [ ] **Step 3b: Implement the validators** — append to `packages/catalogue/src/allergens.ts` (it already imports `AppError`, `"./errors.js"`, and has `CODES`):

```ts
/** Validate a caller/JSON-supplied remove-list. Returns it narrowed; throws on any fault. */
export function validateRemoveAllergens(value: unknown): AllergenCode[] {
  if (!Array.isArray(value)) throw new AppError("allergen.invalid_code", { code: String(value) });
  const out: AllergenCode[] = [];
  for (const code of value) {
    if (typeof code !== "string" || !CODES.has(code)) {
      throw new AppError("allergen.invalid_code", { code: String(code) });
    }
    out.push(code as AllergenCode);
  }
  return out;
}

/** Reject an overlay that both adds and removes the same code (design §3). No-op if either side is
 * absent. Defence-in-depth at the core — never trust the caller (CLAUDE.md §3). */
export function assertAllergenOverlayDisjoint(
  add: ProductAllergens | null,
  remove: readonly string[] | null,
): void {
  if (!add || !remove) return;
  for (const code of remove) {
    if (Object.prototype.hasOwnProperty.call(add, code)) {
      throw new AppError("allergen.add_remove_conflict", { code });
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/catalogue test allergens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/catalogue/src/errors.ts packages/catalogue/src/allergens.ts packages/catalogue/src/allergens.test.ts
git commit -s -m "feat(catalogue): validate option allergen overlay (disjoint add/remove, valid codes)"
```

---

### Task 4: Catalogue ops — persist, read, and project the overlay

**Files:**
- Modify: `packages/catalogue/src/operations.ts` (option-item types, columns, create/update, sell-path projection)
- Test: `packages/catalogue/src/operations.test.ts` (append; mirror the existing `createOptionGroupItem`/`listAvailableProducts` cases)

**Interfaces:**
- Consumes: Task 3's `validateAllergens`/`validateRemoveAllergens`/`assertAllergenOverlayDisjoint`; Task 1's columns.
- Produces: `addAllergens: ProductAllergens | null` + `removeAllergens: string[] | null` on `OptionGroupItem` (`:707`), `CreateOptionGroupItemInput` (`:740`), `UpdateOptionGroupItemInput` (`:750`), and `ResolvedOptionItem` (`:106`).

- [ ] **Step 1: Write the failing tests** in `operations.test.ts` (mirror the existing option-item harness — a `tx` from the catalogue test db):

```ts
it("createOptionGroupItem persists an allergen overlay", async () => {
  const item = await createOptionGroupItem(tx, groupId, {
    name: { en: "Gluten-free bun" },
    removeAllergens: ["gluten"],
  });
  expect(item.removeAllergens).toEqual(["gluten"]);
  expect(item.addAllergens).toBeNull();
});

it("createOptionGroupItem rejects a conflicting overlay", async () => {
  await expect(
    createOptionGroupItem(tx, groupId, {
      name: { en: "x" },
      addAllergens: { gluten: { presence: "contains" } },
      removeAllergens: ["gluten"],
    }),
  ).rejects.toThrow(/allergen.add_remove_conflict/);
});

it("listAvailableProducts projects the option overlay onto ResolvedOptionItem", async () => {
  // attach `groupId` (with the gluten-free item) to a product, then:
  const products = await listAvailableProducts(tx, /* …existing args… */);
  const item = products
    .find((p) => p.id === productId)!
    .optionGroups.flatMap((g) => g.items)
    .find((i) => i.id === itemId)!;
  expect(item.removeAllergens).toEqual(["gluten"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/catalogue test operations`
Expected: FAIL — `removeAllergens` not on the input/row types.

- [ ] **Step 3a: Extend the types** in `operations.ts`. Add to `ResolvedOptionItem` (`:106-111`), `OptionGroupItem` (`:707-715`), `CreateOptionGroupItemInput` (`:740-748`), `UpdateOptionGroupItemInput` (`:750-756`):

```ts
  // (ResolvedOptionItem, OptionGroupItem): read shape
  addAllergens: ProductAllergens | null;
  removeAllergens: string[] | null;
```
```ts
  // (CreateOptionGroupItemInput, UpdateOptionGroupItemInput): input shape
  addAllergens?: ProductAllergens | null;
  removeAllergens?: string[] | null;
```

Import the validators at `operations.ts:15`:
```ts
import {
  assertAllergenOverlayDisjoint,
  validateAllergens,
  validateRemoveAllergens,
  type ProductAllergens,
} from "./allergens.js";
```

- [ ] **Step 3b: Add the columns** to `OPTION_GROUP_ITEM_COLUMNS` (`:768-776`):
```ts
  addAllergens: optionGroupItems.addAllergens,
  removeAllergens: optionGroupItems.removeAllergens,
```

- [ ] **Step 3c: Validate + write in `createOptionGroupItem`** (`:855-873`). Before the insert, add a shared normalizer and use it:

```ts
// module-level helper (define once, reuse in update):
function normalizeOverlay(input: {
  addAllergens?: ProductAllergens | null;
  removeAllergens?: string[] | null;
}): { addAllergens: ProductAllergens | null; removeAllergens: string[] | null } | undefined {
  const hasAdd = input.addAllergens !== undefined;
  const hasRemove = input.removeAllergens !== undefined;
  if (!hasAdd && !hasRemove) return undefined;
  const add = input.addAllergens == null ? null : validateAllergens(input.addAllergens);
  const remove = input.removeAllergens == null ? null : validateRemoveAllergens(input.removeAllergens);
  assertAllergenOverlayDisjoint(add, remove);
  return { addAllergens: add, removeAllergens: remove };
}
```

In `createOptionGroupItem`, spread the normalized overlay into `.values({...})` (both default to NULL when omitted):
```ts
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(normalizeOverlay(input) ?? {}),
```
And ensure the returned row casts the columns (the `.returning(OPTION_GROUP_ITEM_COLUMNS)` already carries them; the `vatClass` cast line stays).

- [ ] **Step 3d: Validate + write in `updateOptionGroupItem`** (`:888-894`). Because disjointness must hold on the *resulting* row, read the current sides when only one is patched:

```ts
export async function updateOptionGroupItem(
  tx: Transaction,
  itemId: string,
  patch: UpdateOptionGroupItemInput,
): Promise<void> {
  const touchesOverlay = patch.addAllergens !== undefined || patch.removeAllergens !== undefined;
  const write: Record<string, unknown> = { ...patch };
  if (touchesOverlay) {
    const [cur] = await tx
      .select({ addAllergens: optionGroupItems.addAllergens, removeAllergens: optionGroupItems.removeAllergens })
      .from(optionGroupItems)
      .where(eq(optionGroupItems.id, itemId));
    const add =
      patch.addAllergens === undefined
        ? (cur?.addAllergens ?? null)
        : patch.addAllergens == null
          ? null
          : validateAllergens(patch.addAllergens);
    const remove =
      patch.removeAllergens === undefined
        ? (cur?.removeAllergens ?? null)
        : patch.removeAllergens == null
          ? null
          : validateRemoveAllergens(patch.removeAllergens);
    assertAllergenOverlayDisjoint(add, remove);
    write.addAllergens = add;
    write.removeAllergens = remove;
  }
  await tx.update(optionGroupItems).set(write).where(eq(optionGroupItems.id, itemId));
}
```

- [ ] **Step 3e: Project onto the sell path.** In `listAvailableProducts`, add to the option-item select (`:613-616`):
```ts
        addAllergens: optionGroupItems.addAllergens,
        removeAllergens: optionGroupItems.removeAllergens,
```
and to the assembled item (`:657-662`):
```ts
          addAllergens: r.addAllergens as ProductAllergens | null,
          removeAllergens: r.removeAllergens as string[] | null,
```

- [ ] **Step 4: Run to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test operations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/catalogue/src/operations.ts packages/catalogue/src/operations.test.ts
git commit -s -m "feat(catalogue): persist/read/project option allergen overlay"
```

---

### Task 5: catalogue-api — parse and thread the overlay on the option-item routes

**Files:**
- Modify: `apps/server/src/catalogue-api.ts` (CREATE `:651-686`, PATCH `:688-730`, STATUS map `~:104-114`)
- Test: `apps/server/src/catalogue-api.test.ts` (append; mirror the existing option-item route tests)

**Interfaces:**
- Consumes: Task 4's `CreateOptionGroupItemInput`/`UpdateOptionGroupItemInput`.
- Produces: the two routes accept `addAllergens`/`removeAllergens` in the body (validation deferred to the ops, exactly as product `allergens` is — `catalogue-api.ts:435,513-514`).

- [ ] **Step 1: Write the failing test** in `catalogue-api.test.ts`:

```ts
it("POST option item accepts an allergen overlay", async () => {
  const res = await api.post(`/management-api/option-groups/${groupId}/items`, {
    name: { en: "Gluten-free bun" },
    removeAllergens: ["gluten"],
  });
  expect(res.status).toBe(201);
  expect(res.body.removeAllergens).toEqual(["gluten"]);
});

it("POST option item 400s on a conflicting overlay", async () => {
  const res = await api.post(`/management-api/option-groups/${groupId}/items`, {
    name: { en: "x" },
    addAllergens: { gluten: { presence: "contains" } },
    removeAllergens: ["gluten"],
  });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("allergen.add_remove_conflict");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test catalogue-api`
Expected: FAIL — overlay not returned / conflict not mapped to 400.

- [ ] **Step 3a: Thread the CREATE route** (`:651-686`). Add to the `readJsonBody` shape and the `input`:
```ts
        active?: unknown;
        addAllergens?: unknown;
        removeAllergens?: unknown;
```
```ts
        ...(body.active === undefined ? {} : { active: body.active }),
        ...(body.addAllergens === undefined ? {} : { addAllergens: body.addAllergens as ProductAllergens | null }),
        ...(body.removeAllergens === undefined ? {} : { removeAllergens: body.removeAllergens as string[] | null }),
```

- [ ] **Step 3b: Thread the PATCH route** (`:688-730`). Add the two fields to the body shape, then:
```ts
      if (body.addAllergens !== undefined) patch.addAllergens = body.addAllergens as ProductAllergens | null;
      if (body.removeAllergens !== undefined) patch.removeAllergens = body.removeAllergens as string[] | null;
```
(Validation stays in the ops. `ProductAllergens` is imported from `@waitron/catalogue`; add it if absent.)

- [ ] **Step 3c: Map the new code** in the STATUS map beside the other `allergen.*` codes (`:104-106`):
```ts
    "allergen.add_remove_conflict": 400,
```

- [ ] **Step 4: Run to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test catalogue-api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/catalogue-api.ts apps/server/src/catalogue-api.test.ts
git commit -s -m "feat(server): thread option allergen overlay through the catalogue-api routes"
```

---

### Task 6: Dashboard authoring — the per-item allergen editor

**Files:**
- Modify: `apps/dashboard/src/api/client.ts:257-277` (`OptionGroupItem` read type, `OptionGroupItemInput`, `OptionGroupItemPatch`)
- Modify: `apps/dashboard/src/widgets/option-group-manager.ts` (per-item allergen editor)
- Test: `apps/dashboard/src/widgets/option-group-manager.test.ts` (browser mode)

**Interfaces:**
- Consumes: `dashboard-allergen-picker` (`allergen-picker.ts`) — prop `.declaration` (three-state `AllergenDeclaration`), event `allergens-changed` → `{ value: AllergenDeclaration }`.
- Produces: the manager emits `update-option-group-item` with `{ addAllergens }` and/or `{ removeAllergens }` in the patch.

> **Note:** browser-mode vitest is memory-heavy (memory `browser-mode-vitest-ram`). Do NOT run its `test:coverage` concurrently with another browser-mode package.

- [ ] **Step 1: Write the failing test** in `option-group-manager.test.ts` (mirror the existing per-item VAT/price tests):

```ts
it("emits removeAllergens when an item's remove-list changes", async () => {
  const el = await fixture(html`<dashboard-option-group-manager .groups=${[group]}></dashboard-option-group-manager>`);
  const events: any[] = [];
  el.addEventListener("update-option-group-item", (e: any) => events.push(e.detail));
  const removeSelect = el.shadowRoot!.querySelector(`[data-test="item-remove-${item.id}"]`) as HTMLSelectElement;
  // select "gluten", dispatch change …
  selectOption(removeSelect, "gluten");
  expect(events.at(-1)).toMatchObject({ itemId: item.id, patch: { removeAllergens: ["gluten"] } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/dashboard test option-group-manager`
Expected: FAIL — no remove control renders.

- [ ] **Step 3a: Extend the client types** (`client.ts`). Add to the `OptionGroupItem` read interface, `OptionGroupItemInput` (`:260-266`), and `OptionGroupItemPatch` (`:271-277`):
```ts
  addAllergens?: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
  removeAllergens?: string[] | null;
```
(For the read `OptionGroupItem` type make them non-optional `… | null` to match the server row.)

- [ ] **Step 3b: Render the editor** in `#renderItemRow` (`:323-374`), after the VAT `<label>`. Reuse the allergen picker for adds and a native multiselect for removes (the 14 codes come from a local display-order constant — the dashboard already localises codes via `i18n/codes.ts`):

```ts
          <dashboard-allergen-picker
            data-test=${`item-add-${item.id}`}
            .declaration=${item.addAllergens ?? null}
            @allergens-changed=${(e: CustomEvent<{ value: AllergenDeclaration }>) => {
              e.stopPropagation();
              this.#updateItem(groupId, item.id, { addAllergens: e.detail.value });
            }}
          ></dashboard-allergen-picker>
          <label class="removes">
            ${t("option_group.removes")}
            <select
              multiple
              data-test=${`item-remove-${item.id}`}
              @change=${(e: Event) => this.#onItemRemoveChange(groupId, item.id, e)}
            >
              ${ALLERGEN_CODES.map(
                (code) =>
                  html`<option value=${code} .selected=${(item.removeAllergens ?? []).includes(code)}>
                    ${allergenName(code)}
                  </option>`,
              )}
            </select>
          </label>
```
Add the handler beside `#onItemVatChange` (`:317-321`):
```ts
  #onItemRemoveChange(groupId: string, itemId: string, event: Event): void {
    event.stopPropagation();
    const selected = Array.from((event.target as HTMLSelectElement).selectedOptions, (o) => o.value);
    this.#updateItem(groupId, itemId, { removeAllergens: selected.length ? selected : null });
  }
```
Import `ALLERGEN_CODES`/`allergenName` from the dashboard's existing allergen i18n (`i18n/codes.ts`/`domain.ts`) and add the `option_group.removes` string to the dashboard strings.

- [ ] **Step 3c: Verify the manager's own state carries `addAllergens`/`removeAllergens`** — where it maps a fetched item to its row model, thread the two fields so the pickers seed correctly.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/dashboard test option-group-manager`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/widgets/option-group-manager.ts apps/dashboard/src/widgets/option-group-manager.test.ts apps/dashboard/src/i18n/
git commit -s -m "feat(dashboard): author per-option allergen adds/removes in the option-group manager"
```

---

### Task 7: Till surface — overlay on `TillOptionItem`, client-side as-served, basket render

**Files:**
- Modify: `apps/till/src/api/client.ts:147-152` (`TillOptionItem`)
- Modify: the server mapping that builds `TillProduct.optionGroups` from `ResolvedOptionGroup` (find in `apps/server/src/till-api.ts` — the products endpoint's `ResolvedOptionItem → TillOptionItem` map)
- Modify: `apps/till/src/widgets/basket.ts:84-118` (render as-served on the dish line)
- Modify: `apps/till/src/state/order-line.ts` or a new `as-served.ts` helper (client-side derivation call)
- Test: `apps/till/src/widgets/basket.test.ts` (browser mode)

**Interfaces:**
- Consumes: Task 2's `deriveAsServedAllergens` (deep import), Task 4's projected `ResolvedOptionItem.addAllergens/removeAllergens`.
- Produces: `TillOptionItem.addAllergens/removeAllergens`; a per-line as-served `{ allergens, pending }` rendered under the dish.

> **Note:** browser-mode vitest — see the Task 6 memory note.

- [ ] **Step 1: Write the failing test** in `basket.test.ts`:

```ts
it("shows the as-served allergen set for a dish with a gluten-removing modifier", async () => {
  const line: OrderLine = {
    product: { /* …TillProduct with allergens: { gluten: { presence: "contains" } } … */ },
    quantity: "1",
    options: [{ optionGroupItemId: "opt-1", name: { en: "Gluten-free bun" }, priceDelta: "0.00" }],
  };
  // the product's optionGroups carry opt-1 with removeAllergens: ["gluten"]
  const el = await fixture(html`<till-basket .lines=${[line]}></till-basket>`);
  const asServed = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`)!;
  expect(asServed.textContent).not.toMatch(/gluten/i);
  expect(asServed.textContent).not.toMatch(/review|pendiente/i); // base was reviewed
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test basket`
Expected: FAIL — no allergen row renders.

- [ ] **Step 3a: Extend `TillOptionItem`** (`client.ts:147-152`):
```ts
  addAllergens: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
  removeAllergens: string[] | null;
```

- [ ] **Step 3b: Carry the overlay in the server's till-product mapping.** In the `ResolvedOptionItem → TillOptionItem` map (`apps/server/src/till-api.ts`, the products endpoint), add `addAllergens: item.addAllergens, removeAllergens: item.removeAllergens`.

- [ ] **Step 3c: Compute + render** in `basket.ts`. Deep-import the derivation (the `priceBasket` precedent), gather the line's option overlays from `line.product.optionGroups`, and render the as-served set under the dish (after the child option rows, `:115`):

```ts
import { deriveAsServedAllergens } from "@waitron/catalogue/src/derivation.js";
// … per line, before/after the options map:
const overlays = (line.options ?? []).map((sel) => {
  const item = (line.product.optionGroups ?? [])
    .flatMap((g) => g.items)
    .find((i) => i.id === sel.optionGroupItemId);
  return { add: item?.addAllergens ?? null, remove: item?.removeAllergens ?? null };
});
const asServed = deriveAsServedAllergens(line.product.allergens, overlays);
// render: a chip row of asServed.allergens keys (localised via the till's allergen-names i18n),
// plus a "not fully reviewed" note when asServed.pending — data-test=`line-allergens-${index}`.
```
Reuse `apps/till/src/i18n/allergen-names.ts` for code → label. Only render the row when the line has options OR the product itself has allergens (skip the plain no-allergen case to avoid noise).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test basket`
Expected: PASS.

- [ ] **Step 5: Prove the pending path** — add a case where `line.product.allergens` is `null` and assert the "not fully reviewed" note renders (Cautious policy visible to the waiter).

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/api/client.ts apps/server/src/till-api.ts apps/till/src/widgets/basket.ts apps/till/src/widgets/basket.test.ts
git commit -s -m "feat(till): as-served allergen line from modifier overlays (client-side shared derivation)"
```

---

### Task 8: KDS/expo server read — attach the as-served profile per fired dish line

**Files:**
- Modify: `apps/server/src/working-order.ts` — `StationQueueItem` (`~:3098`), `ExpoItem` (`~:3362`), a new `readAsServedByParent`, and the `listStationQueue`/`listExpoQueue` attach points (`:3293`, `:3574`, `:3329`, `:3632`)
- Test: `apps/server/src/working-order.test.ts` (or the KDS queue test file; mirror the existing `listStationQueue`/modifier tests)

**Interfaces:**
- Consumes: Task 2's `deriveAsServedAllergens`, Task 1's overlay columns.
- Produces: `asServed: AsServedAllergens` and `removed: string[]` on `StationQueueItem` and `ExpoItem`.

- [ ] **Step 1: Write the failing test** — a fired order whose dish has `allergens: { gluten: contains }` and a modifier with `removeAllergens: ["gluten"]`:

```ts
it("attaches an as-served profile with the removed allergen dropped", async () => {
  // ring + fire a burger (gluten) with a gluten-free-bun modifier, then:
  const queue = await listStationQueue(tx, cfg, stationId);
  const item = queue.groups.flatMap((g) => g.items).find((i) => i.workingOrderLineId === parentLineId)!;
  expect(item.asServed.allergens).toEqual({});
  expect(item.asServed.pending).toBe(false);
  expect(item.removed).toEqual(["gluten"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test working-order`
Expected: FAIL — `asServed` not on the item.

- [ ] **Step 3a: Extend the item shapes.** Add to `StationQueueItem` (`:3098-3100`) and `ExpoItem` (`:3362-3365`):
```ts
  asServed: AsServedAllergens;
  removed: string[];
```
Import `AsServedAllergens`/`deriveAsServedAllergens` from `@waitron/catalogue`.

- [ ] **Step 3b: Add `readAsServedByParent`** beside `readModifiersByParent` (`:3169`). It reads each parent's base allergens (join `products` on the parent line's `product_id`) and each child's overlay (join `option_group_items` on the child's `option_group_item_id`, which is nullable — a deleted option yields no overlay), then derives per parent:

```ts
async function readAsServedByParent(
  tx: Transaction,
  tenantId: string,
  parentLineIds: string[],
): Promise<Map<string, { asServed: AsServedAllergens; removed: string[] }>> {
  const out = new Map<string, { asServed: AsServedAllergens; removed: string[] }>();
  if (parentLineIds.length === 0) return out;
  // base allergens per parent line (parent line id === parentLineId)
  const parents = await tx
    .select({ lineId: workingOrderLines.id, allergens: products.allergens })
    .from(workingOrderLines)
    .leftJoin(
      products,
      and(eq(products.tenantId, tenantId), eq(products.id, workingOrderLines.productId)),
    )
    .where(and(eq(workingOrderLines.tenantId, tenantId), inArray(workingOrderLines.id, parentLineIds)));
  // child overlays per parent
  const children = await tx
    .select({
      parentLineId: workingOrderLines.parentLineId,
      addAllergens: optionGroupItems.addAllergens,
      removeAllergens: optionGroupItems.removeAllergens,
    })
    .from(workingOrderLines)
    .leftJoin(
      optionGroupItems,
      and(eq(optionGroupItems.tenantId, tenantId), eq(optionGroupItems.id, workingOrderLines.optionGroupItemId)),
    )
    .where(and(eq(workingOrderLines.tenantId, tenantId), inArray(workingOrderLines.parentLineId, parentLineIds)))
    .orderBy(workingOrderLines.lineNo);
  const overlaysByParent = new Map<string, { add: AllergenMap | null; remove: string[] | null }[]>();
  for (const c of children) {
    const list = overlaysByParent.get(c.parentLineId!) ?? [];
    list.push({ add: c.addAllergens ?? null, remove: c.removeAllergens ?? null });
    overlaysByParent.set(c.parentLineId!, list);
  }
  for (const p of parents) {
    const base = (p.allergens ?? null) as ProductAllergens | null;
    const asServed = deriveAsServedAllergens(base, overlaysByParent.get(p.lineId) ?? []);
    const removed = base ? Object.keys(base).filter((c) => !(c in asServed.allergens)) : [];
    out.set(p.lineId, { asServed, removed });
  }
  return out;
}
```
(`AllergenMap`/`ProductAllergens` are structurally identical; cast at the boundary as the existing option-item reads do.)

- [ ] **Step 3c: Attach in `listStationQueue`** (after the `readModifiersByParent` call, `:3293`) and shape the item (`:3323-3342`):
```ts
  const asServedByParent = await readAsServedByParent(tx, cfg.tenantId, rows.map((r) => r.workingOrderLineId));
```
```ts
      asServed: asServedByParent.get(row.workingOrderLineId)?.asServed ?? { allergens: {}, pending: true },
      removed: asServedByParent.get(row.workingOrderLineId)?.removed ?? [],
```
Do the same in `listExpoQueue` (`:3574`, `:3624-3636`) keyed on `row.lineId`.

- [ ] **Step 4: Run to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test working-order`
Expected: PASS.

- [ ] **Step 5: Prove non-fiscal isolation stays** — quick grep that `record-sale.ts` still has no allergen reference (`git grep -n allergen packages/core/src/record-sale.ts` → no output). This is a lightweight cross-check; Task 10 is the real guard.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/working-order.ts apps/server/src/working-order.test.ts
git commit -s -m "feat(server): attach as-served allergens to the KDS station/expo queue reads"
```

---

### Task 9: KDS/expo render — show the as-served profile on the ticket

**Files:**
- Modify: `apps/dashboard/src/screens/kitchen-screen.ts` (station queue ticket) and the expo screen (whichever renders `ExpoItem`)
- Modify: dashboard client types for the queue item shape (`asServed`, `removed`)
- Test: `apps/dashboard/src/screens/kitchen-screen.test.ts` (browser mode)

**Interfaces:**
- Consumes: Task 8's `asServed`/`removed` on the queue items.

> **Note:** browser-mode vitest — Task 6 memory note.

- [ ] **Step 1: Write the failing test** — render a station item whose `removed: ["gluten"]` and assert a "NO GLUTEN" callout, and one whose `asServed.pending` is true and assert a "not reviewed" warning.

```ts
it("shows a removed-allergen callout and an added-allergen chip on the ticket", async () => {
  const item = { /* …StationQueueItem… */ asServed: { allergens: { milk: { presence: "contains" } }, pending: false }, removed: ["gluten"] };
  const el = await fixture(html`<kitchen-screen .queue=${queueWith(item)}></kitchen-screen>`);
  const ticket = el.shadowRoot!.querySelector(`[data-test="ticket-${item.id}"]`)!;
  expect(ticket.textContent).toMatch(/no gluten/i);
  expect(ticket.textContent).toMatch(/milk/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/dashboard test kitchen-screen`
Expected: FAIL.

- [ ] **Step 3: Render** on each queue ticket, beneath the dish name + modifiers: the `asServed.allergens` codes as "contains" chips (localised via `i18n/codes.ts`), each `removed` code as a struck / "NO <CODE>" callout, and a "⚠ not reviewed" line when `asServed.pending`. Add `asServed`/`removed` to the dashboard's queue-item client type. Keep the reduced-motion / colour-plus-text convention used by the order-timing bands (a code, not colour alone).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/dashboard test kitchen-screen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/ apps/dashboard/src/api/
git commit -s -m "feat(dashboard): render as-served allergens on the KDS station/expo ticket"
```

---

### Task 10: Non-fiscal huella-invariance test

**Files:**
- Test: the fiscal/modifier test that #184 used to pin `parent_line_id` out of the huella (find it: `git grep -l "computeHuella\|invarian" packages/fiscal-verifactu packages/core apps/server` and the modifier fiscal test from #184). Add a sibling case.

**Interfaces:**
- Consumes: Task 4/5 (create an option item with an overlay), the existing sale-ring/record path.

- [ ] **Step 1: Write the test** — ring and file two sales identical except the modifier's allergen overlay, and assert equal huella (the overlay never perturbs the filed record):

```ts
it("an option's allergen overlay does not change the filed huella (non-fiscal)", async () => {
  // option A: name "Bun", removeAllergens: null; option B: same name/price, removeAllergens: ["gluten"]
  const saleA = await ringAndFile(/* burger + option A */);
  const saleB = await ringAndFile(/* burger + option B */);
  expect(saleB.huella).toEqual(saleA.huella);
});
```
(Both options must be byte-identical in `name`/`priceDelta`/`vatClass` so the child `sale_lines` are identical; only the catalogue allergen overlay differs. If the harness reuses one option item, instead file one sale, then `updateOptionGroupItem` to set `removeAllergens`, and file an identical second sale — same expectation.)

- [ ] **Step 2: Run to verify it PASSES immediately** (this is a guard, not a red-first cycle — the feature is already non-fiscal by construction). If it FAILS, an allergen field has leaked into the sale path — stop and fix the leak, do not adjust the test.

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter <pkg> test <file>`
Expected: PASS.

- [ ] **Step 3: Prove it can fail** — temporarily append the overlay to the child `sale_lines` insert in `record-sale.ts`, confirm the test goes RED, then revert. This proves the guard actually watches the fiscal path (CLAUDE.md §4).

- [ ] **Step 4: Commit**

```bash
git add <the test file>
git commit -s -m "test(fiscal): pin option allergen overlay out of the huella (non-fiscal)"
```

---

## Self-Review

**Spec coverage:**
- §3 data model → Task 1 (columns) + Task 3 (validation) + Task 4 (types/persist). ✓
- §4 derivation (Cautious) → Task 2. ✓
- §5 till surface → Task 7; KDS/expo → Tasks 8 (read) + 9 (render). ✓
- §5 authoring → Task 6. ✓
- §6 component table → Tasks 1–9 map one-to-one. ✓
- §7 non-fiscal → Task 10 (+ the Task 8 grep cross-check). ✓
- §8 testing → each task is TDD, with the derivation as the spine (Task 2) and the invariance guard (Task 10). ✓
- §9 open questions are advisor/follow-up, no task. ✓

**Placeholder scan:** every code step carries real code; test steps carry real assertions. The one deliberately-deferred lookup is the exact file path of the #184 huella-invariance test (Task 10) and the till-product mapping site (Task 7 step 3b) — both named by a `git grep` the executor runs, not invented.

**Type consistency:** `AsServedAllergens { allergens: ProductAllergens; pending: boolean }` and `OptionAllergenOverlay { add: ProductAllergens | null; remove: readonly string[] | null }` (Task 2) are consumed with those exact names in Tasks 7 and 8. `addAllergens: ProductAllergens | null` / `removeAllergens: string[] | null` are the field names in Tasks 1, 4, 5, 6, 7, 8 (the DB `$type<AllergenMap>()` is structurally `ProductAllergens`; cast at boundaries as the existing option reads do). Error code `allergen.add_remove_conflict` is defined in Task 3 and mapped to 400 in Task 5.

**Ordering:** 1→2→3 foundational; 4 needs 1–3; 5 needs 4; 6 needs 4/5 client types; 7 needs 2+4; 8 needs 1+2; 9 needs 8; 10 needs 4/5. No forward references.
