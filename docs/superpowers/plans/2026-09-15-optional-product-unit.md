# Optional product unit + click-a-unit-to-see-products — Implementation Plan

> **2026-09-14 — the tenant column is gone.** The tenant-id removal this document anticipates has
> landed: every `tenant_id` column, every tenant argument and the `withTenant` helper are gone
> (`withTransaction` replaces it), one database holds one taxpayer as the single row of `tenants`,
> and nothing filters by a tenant. Read every tenant-carrying signature, tenant predicate and
> "a by-id read scopes to the tenant" rule below as the shape at the time of writing. Spec:
> [drop-tenant-id](../specs/2026-09-14-drop-tenant-id-design.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a product's unit optional (no unit reads as "Each", which is never stored), and make clicking a unit's row on the Units screen open a modal of the products that use it — via a new whole-row-click capability on the shared table.

**Architecture:** A product with no `product_units` row means "Each". The editor read returns `null` (so the form shows the Each option); the display/pricing reads synthesise a shared `EACH_UNIT` at the single `sellableUnit()` choke point, so `Product.unit`/`AvailableProduct.unit` stay non-null and the till/offer/receipt paths are unchanged. The write path clears the row when Each is chosen. A new generic whole-row-click affordance is added to `wt-data-table` and adopted on the Units screen.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL/PGlite, Hono (server), Lit (dashboard + `@waitron/ui`), Vitest (Node + real-Chromium browser mode).

**Spec:** `docs/superpowers/specs/2026-09-15-optional-product-unit-design.md`

## Global Constraints

- **TDD, always:** write the failing test, run it and watch it fail for the right reason, write the minimal code, watch it pass, commit. Every code step here is paired with a test step.
- **`git commit -s`** on every commit. Plain-English commit messages and PR text (no unexplained jargon); exact file/function/error-code names may appear once as pointers.
- **No schema migration** in this branch — a product with no `product_units` row is already valid. Do NOT run `drizzle-kit generate`; if you think you need a migration, stop and re-read the spec.
- **Error codes are never renamed once shipped.** `editor.unit_required` is a dashboard i18n *string* key (not a domain error code) — its *use* is removed here; removing the key itself is allowed only after confirming nothing references it.
- **A by-id read scopes to the tenant.** The units routes already do (`gated` + `deps.cfg.tenantId`, and `getUnit` is tenant-scoped) — keep it that way on the new route.
- **Lit `<select>`:** when `<option>`s come from a `${…}` expression, mark the chosen option with `.selected`; a `.value` binding alone runs before the options exist.
- **`@waitron/ui` tokens:** every colour, spacing, radius, font reads a `--wt-*` token — no hex, no named colours, no `rem`/`em`. Guard: `packages/ui/src/no-hardcoded-chrome.test.ts`.
- **A changed `wt-*` primitive behaviour needs two tests:** a token-painting test and an axe a11y test in the sibling `*.a11y.test.ts`, covering each distinct state in both themes.
- **Grant/role assertions** use `asAppUser(tx)`; PGlite is fine for these tasks (no concurrency or who-connected behaviour under test).
- **Rejected writes assert the domain error code** (not just `toBeInstanceOf(Error)`).
- **i18n parity:** add every new string to BOTH the `en` and `es` sections of `apps/dashboard/src/i18n/strings.ts`.
- **Rendered pages:** open them and LOOK in both themes and at phone width; a string/DOM assertion does not prove a page renders.

---

### Task 1: `EACH_UNIT` synthetic + `sellableUnit()` returns it

A product with no stored unit must read (for display/pricing) as a synthetic "Each" unit so `Product.unit`/`AvailableProduct.unit` stay non-null.

**Files:**
- Modify: `packages/catalogue/src/units.ts` (add exports)
- Modify: `packages/catalogue/src/operations.ts:415-433` (`sellableUnit`) and its 3 call sites (`:392`, `:1019`, `:1768`)
- Test: `packages/catalogue/src/operations.test.ts` (or `units.test.ts` — put it beside the existing product-read tests)
- Test (cross-package sale-path proof): `packages/venue-service/src/operations.test.ts`

**Interfaces:**
- Produces: `EACH_UNIT_ID` (the sentinel UUID `00000000-0000-0000-0000-000000000001`), `EACH_UNIT: SellableUnit` — exported from `@waitron/catalogue` via `units.ts`. Consumed by Task 3 and the display reads.

- [ ] **Step 1: Write the failing test** — a product row with NO `product_units` row reads back with the Each unit.

```ts
// packages/catalogue/src/operations.test.ts
import { EACH_UNIT } from "./units.js";

it("reads a product with no unit as the synthetic Each unit", async () => {
  const tenantId = /* seed a tenant/catalogue via the suite's helper */;
  // Insert a product row directly WITHOUT a product_units row (raw insert or the suite's product helper,
  // then delete its product_units row) so we exercise the null-join branch:
  const productId = await insertBareProduct(tx, tenantId, { pricingUnit: "each" });
  const [product] = await listProducts(tx, tenantId);
  expect(product.unit).toEqual(EACH_UNIT);
  expect(product.unit.id).toBe("00000000-0000-0000-0000-000000000001");
  expect(product.unit.hardwareUnit).toBeNull();
  expect(product.pricingUnit).toBe("each");
});
```

(Use the suite's existing product-insert helper; if it always assigns a unit, insert the `products` row directly with drizzle and skip `assignProductUnit`.)

- [ ] **Step 1b: Write the sale-path proof test** (the reviewer's required proof that the sentinel id survives the live order path — `working_line_contexts.unit_id` is `uuid NOT NULL`).

Add a venue-service test (beside the existing `recordWorkingLineContexts` tests, `packages/venue-service/src/operations.test.ts`) that adds a NO-UNIT product to a working order and asserts the line context row is written without error:

```ts
it("records a working line context for a product with no unit (Each)", async () => {
  // seed a product with NO product_units row, then drive the offer/menu read + recordWorkingLineContexts
  // exactly as the existing line-context tests do:
  await expect(recordWorkingLineContexts(tx, tenantId, /* the no-unit offer line(s) */)).resolves.not.toThrow();
  const [ctx] = await tx.select({ unitId: workingLineContexts.unitId }).from(workingLineContexts) /* …scoped… */;
  expect(ctx!.unitId).toBe("00000000-0000-0000-0000-000000000001"); // the sentinel, not "" (which a uuid column rejects)
});
```

Run it and watch it fail with `id: ""` (uuid rejection) BEFORE Step 3 sets the sentinel, to prove the test exercises the real column. This test lives in venue-service, so it is committed with Task 1 as the cross-package guard for the sentinel decision.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/catalogue test src/operations.test.ts -t "synthetic Each"`
Expected: FAIL — today `sellableUnit()` throws `unit.not_found` when the join is null.

- [ ] **Step 3: Add `EACH_UNIT` to `units.ts`**

```ts
// packages/catalogue/src/units.ts — near the SellableUnit interface
/** The unit a product reads as when it has NO stored unit. It is NEVER written to the units table or a
 * product_units row (a no-unit product simply has no row); `sellableUnit()` returns it for the null
 * join so Product/AvailableProduct.unit stay non-null and the sale/receipt paths are unchanged.
 *
 * Its id is a SENTINEL UUID, not "": the live order path writes `offer.unit.id` into
 * `working_line_contexts.unit_id` (`uuid NOT NULL`, no FK — venue-service schema/service.ts:278,
 * operations.ts:870), so the id must be a valid UUID. This matches the till's own "each" fallback id
 * (apps/till/src/widgets/product-name.ts:28) so server and till agree. Nothing looks it up as a real
 * unit and it never reaches product_units. */
export const EACH_UNIT_ID = "00000000-0000-0000-0000-000000000001";
export const EACH_UNIT: SellableUnit = {
  id: EACH_UNIT_ID,
  name: { en: "Each", es: "Unidad", ca: "Unitat", gl: "Unidade", eu: "Unitatea" },
  abbreviation: { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" },
  precision: 0,
  hardwareUnit: null,
};
```

- [ ] **Step 4: `sellableUnit()` returns `EACH_UNIT` instead of throwing; drop the now-unused `legacy` param**

```ts
// packages/catalogue/src/operations.ts — import EACH_UNIT from "./units.js"
function sellableUnit(
  id: string | null,
  name: Record<string, string> | null,
  precision: number | null,
  hardwareUnit: string | null | undefined,
  abbreviation: Record<string, string> | null,
): SellableUnit {
  if (id !== null && name !== null && precision !== null) {
    return {
      id,
      name,
      precision,
      abbreviation: abbreviation ?? {},
      hardwareUnit: hardwareUnit as SellableUnit["hardwareUnit"],
    };
  }
  // A product with no stored unit reads as Each (never stored).
  return EACH_UNIT;
}
```

Update all three call sites to drop the `row.pricingUnit` (legacy) argument — e.g. `:392` becomes `sellableUnit(row.unitId, unitName, unitPrecision, hardwareUnit, unitAbbreviation)`. Do the same at `:1019` and `:1768`.

- [ ] **Step 5: Run the test to verify it passes, plus the read paths**

Run: `pnpm --filter @waitron/catalogue test src/operations.test.ts`
Expected: PASS. Fix any existing test that asserted a unitless product read throws — such a read now returns Each.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/units.ts packages/catalogue/src/operations.ts packages/catalogue/src/operations.test.ts packages/venue-service/src/operations.test.ts
git commit -s -m "A product with no stored unit reads as a synthetic Each unit

sellableUnit() now returns a shared EACH_UNIT (with a sentinel UUID id)
for the null-unit join instead of throwing, so Product/AvailableProduct.unit
stay non-null and the till, offer and receipt paths are unchanged for a
no-unit product. A venue-service test proves the sentinel id survives the
working_line_contexts (uuid NOT NULL) write on the live order path."
```

---

### Task 2: `readProductUnitId` returns `null`; editor value type nullable

The product editor must read "no unit" as `null` so the form can show the Each option.

**Files:**
- Modify: `packages/catalogue/src/units.ts:215-231` (`readProductUnitId`)
- Modify: `packages/catalogue/src/product-editor.ts:20-25,56` (`ProductEditorValue`)
- Test: `packages/catalogue/src/product-editor.test.ts`

**Interfaces:**
- Produces: `readProductUnitId(tx, tenantId, productId): Promise<string | null>`; `ProductEditorValue.unitId: string | null`. Consumed by the server editor route and the dashboard client (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// packages/catalogue/src/product-editor.test.ts
it("reads a product with no unit as unitId null", async () => {
  const productId = await insertBareProduct(tx, tenantId, { pricingUnit: "each" }); // no product_units row
  const value = await readProductEditor(tx, tenantId, productId);
  expect(value.unitId).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/catalogue test src/product-editor.test.ts -t "unitId null"`
Expected: FAIL — `readProductUnitId` throws `unit.not_found` today.

- [ ] **Step 3: Make `readProductUnitId` return null**

```ts
// packages/catalogue/src/units.ts
export async function readProductUnitId(
  tx: Transaction,
  tenantId: string,
  productId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ productId: products.id, unitId: productUnits.unitId })
    .from(products)
    .leftJoin(
      productUnits,
      and(eq(productUnits.tenantId, products.tenantId), eq(productUnits.productId, products.id)),
    )
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
  if (row === undefined) throw new AppError("product.not_found", { productId });
  return row.unitId; // null when the product has no unit (Each)
}
```

- [ ] **Step 4: Widen `ProductEditorValue.unitId`**

`ProductEditorValue = Omit<ProductEditorInput, "variants"> & {…}`. The nullability comes from `ProductEditorInput.unitId` in `product-editor-input.ts` (Task 3). For this task, ensure `readProductEditor`'s return compiles: its `unitId: await readProductUnitId(...)` is now `string | null`, which requires `ProductEditorInput.unitId: string | null` — do that in Task 3. To keep Task 2 self-contained and green, land Task 2 and Task 3 together if the typecheck couples them, OR temporarily type the field here; prefer landing 2+3 in sequence and running typecheck at the end of Task 3.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @waitron/catalogue test src/product-editor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/units.ts packages/catalogue/src/product-editor.ts packages/catalogue/src/product-editor.test.ts
git commit -s -m "readProductUnitId returns null for a product with no unit

The product editor read now reports no unit as null so the form can show
the Each option, instead of throwing unit.not_found."
```

---

### Task 3: Write path honours a null unit (`clearProductUnit`, create/update, input parse)

Saving a product as Each stores no `product_units` row; switching an existing product to Each deletes its row. The legacy `pricingUnit` compat path branches directly instead of resolving an "each" seed.

**Files:**
- Modify: `packages/catalogue/src/units.ts` (add `clearProductUnit`)
- Modify: `packages/catalogue/src/operations.ts` (`CreateProductInput`/`UpdateProductInput` `unitId?: string | null`; `createProduct:1204-1251`; `updateProduct:1401-1421`)
- Modify: `packages/catalogue/src/product-editor-input.ts` (`ProductEditorInput.unitId: string | null`; nullable parse)
- Test: `packages/catalogue/src/operations.test.ts`, `packages/catalogue/src/product-editor-input.test.ts` (if present; else operations.test.ts)

**Interfaces:**
- Consumes: `getSeededUnit(tx, tenant, "kg")` (still seeded); `assignProductUnit`.
- Produces: `clearProductUnit(tx, tenantId, productId): Promise<void>`. `CreateProductInput.unitId?: string | null` and `UpdateProductInput.unitId?: string | null` where `null` = Each, `undefined` = (create: fall back to legacy `pricingUnit`; update: leave unchanged). Consumed by Task 4's route flow indirectly and by the editor path.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/catalogue/src/operations.test.ts
it("creates a product with no unit when unitId is null", async () => {
  const created = await createProduct(tx, tenantId, { ...baseInput, unitId: null });
  expect(created.pricingUnit).toBe("each");
  expect(await readProductUnitId(tx, tenantId, created.id)).toBeNull();
});

it("clears a product's unit when updated to null", async () => {
  const created = await createProduct(tx, tenantId, { ...baseInput, unitId: kgUnitId });
  await updateProduct(tx, tenantId, created.id, { unitId: null });
  expect(await readProductUnitId(tx, tenantId, created.id)).toBeNull();
  const [after] = await tx.select({ p: products.pricingUnit }).from(products).where(eq(products.id, created.id));
  expect(after!.p).toBe("each");
});

it("legacy pricingUnit 'each' creates a product with no unit", async () => {
  const created = await createProduct(tx, tenantId, { ...baseInputNoUnit, pricingUnit: "each" });
  expect(await readProductUnitId(tx, tenantId, created.id)).toBeNull();
});

it("still rejects a create with neither unitId nor pricingUnit", async () => {
  await expect(createProduct(tx, tenantId, { ...baseInputNoUnit })).rejects.toMatchObject({
    code: "management.request_invalid",
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/catalogue test src/operations.test.ts -t "no unit|clears a product|legacy pricingUnit 'each'|neither unitId"`
Expected: FAIL.

- [ ] **Step 3: Add `clearProductUnit`**

```ts
// packages/catalogue/src/units.ts
/** Remove a product's unit assignment (it then reads as Each). A no-op when there is no row. */
export async function clearProductUnit(
  tx: Transaction,
  tenantId: string,
  productId: string,
): Promise<void> {
  await tx
    .delete(productUnits)
    .where(and(eq(productUnits.tenantId, tenantId), eq(productUnits.productId, productId)));
}
```

- [ ] **Step 4: Nullable input types + create/update resolution**

```ts
// operations.ts — interfaces
export interface CreateProductInput { /* … */ unitId?: string | null; pricingUnit?: PricingUnit; /* … */ }
export interface UpdateProductInput { /* … */ unitId?: string | null; pricingUnit?: PricingUnit; /* … */ }
```

`createProduct` (replace the `:1204-1213` resolution and the `:1240` / `:1251` uses):

```ts
if (input.unitId === undefined && input.pricingUnit === undefined) {
  throw new AppError("management.request_invalid", { field: "unitId" });
}
// Resolve to the unit to assign, or null for Each (no unit stored).
let selectedUnit: SellableUnit | null;
if (input.unitId === null) {
  selectedUnit = null;
} else if (input.unitId !== undefined) {
  selectedUnit = await getSellableUnit(tx, tenantId, input.unitId); // 404s an unknown unit
} else if (input.pricingUnit === "each") {
  selectedUnit = null;
} else {
  selectedUnit = await getSeededUnit(tx, tenantId, "kg"); // legacy weight → kg seed
  if (selectedUnit === null) throw new AppError("management.request_invalid", { field: "unitId" });
}
// …insert with pricingUnit: selectedUnit === null ? "each" : legacyPricingUnit(selectedUnit)…
// after the insert:
if (selectedUnit !== null) await assignProductUnit(tx, tenantId, row!.id, selectedUnit.id);
```

`updateProduct` (replace the `:1401-1421` block) — tri-state so a null clears, an undefined leaves unchanged:

```ts
type UnitAction = { kind: "keep" } | { kind: "clear" } | { kind: "set"; unit: SellableUnit };
let unitAction: UnitAction;
if (unitId === null) {
  unitAction = { kind: "clear" };
} else if (unitId !== undefined) {
  unitAction = { kind: "set", unit: await getSellableUnit(tx, tenantId, unitId) };
} else if (pricingUnit === undefined) {
  unitAction = { kind: "keep" };
} else if (pricingUnit === "each") {
  unitAction = { kind: "clear" };
} else {
  const kg = await getSeededUnit(tx, tenantId, "kg");
  if (kg === null) throw new AppError("management.request_invalid", { field: "unitId" });
  unitAction = { kind: "set", unit: kg };
}
await tx
  .update(products)
  .set({
    ...rest,
    ...(unitAction.kind === "keep"
      ? {}
      : { pricingUnit: unitAction.kind === "clear" ? "each" : legacyPricingUnit(unitAction.unit) }),
    ...(allergens !== undefined ? { manualAllergens: allergens } : {}),
    ...(dietOverride !== undefined ? { dietOverride } : {}),
    ...(directDietary === undefined ? {} : { dietaryDeclarations: directDietary }),
    updatedAt: sql`now()`,
  })
  .where(and(eq(products.tenantId, tenantId), eq(products.id, id)));
if (unitAction.kind === "set") await assignProductUnit(tx, tenantId, id, unitAction.unit.id);
else if (unitAction.kind === "clear") await clearProductUnit(tx, tenantId, id);
```

Then delete the now-unused `legacyUnitSeed` helper (`operations.ts:439-443`) if nothing else references it (grep first).

- [ ] **Step 5: Nullable parse in `product-editor-input.ts`**

```ts
// product-editor-input.ts
function nullableId(value: unknown, field: string): string | null {
  return value === null ? null : id(value, field);
}
// interface: unitId: string | null;
// in parseProductEditorInput: const unitId = nullableId(body.unitId, "unitId");
```

Add a test: a body with `unitId: null` parses to `unitId: null`; `unitId: "not-a-uuid"` still throws `product.invalid`.

- [ ] **Step 6: Run to verify all pass + typecheck the package**

Run: `pnpm --filter @waitron/catalogue test && pnpm --filter @waitron/catalogue typecheck`
Expected: PASS. Fix fallout in existing operations tests that assumed a unit is always assigned.

- [ ] **Step 7: Commit**

```bash
git add packages/catalogue/src/units.ts packages/catalogue/src/operations.ts packages/catalogue/src/product-editor-input.ts packages/catalogue/src/*.test.ts
git commit -s -m "A product's unit is optional on the write path

createProduct/updateProduct accept unitId null (Each): no product_units
row is written, pricingUnit derives to each, and switching an existing
product to Each deletes its row via the new clearProductUnit. The legacy
pricingUnit compat path branches on each vs weight directly instead of
resolving an each seed."
```

---

### Task 4: `reassignProductsToUnit` accepts a null target (reassign to Each)

Emptying a unit — so it can be deleted — by clearing its products' unit.

**Files:**
- Modify: `packages/catalogue/src/units.ts:190-213`
- Test: `packages/catalogue/src/units.test.ts` (the file with the existing reassign tests — `units.pg.test.ts` per the module comment; put it beside the two opposite-order reassign tests)

**Interfaces:**
- Produces: `reassignProductsToUnit(tx, tenantId, sourceUnitId, productIds, targetUnitId: string | null)` — `null` deletes the listed products' rows (they become Each). Consumed by Task 6's route.

- [ ] **Step 1: Write the failing test**

```ts
it("reassigning to null clears the products' unit (they become Each)", async () => {
  // two products on sourceUnit
  await reassignProductsToUnit(tx, tenantId, sourceUnit, [p1, p2], null);
  expect(await productsUsingUnit(tx, tenantId, sourceUnit)).toHaveLength(0);
  expect(await readProductUnitId(tx, tenantId, p1)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/catalogue test src/units.pg.test.ts -t "reassigning to null"`
Expected: FAIL (type error / current signature requires a string target).

- [ ] **Step 3: Implement the null branch**

```ts
export async function reassignProductsToUnit(
  tx: Transaction,
  tenantId: string,
  sourceUnitId: string,
  productIds: readonly string[],
  targetUnitId: string | null,
): Promise<void> {
  const scope = and(
    eq(productUnits.tenantId, tenantId),
    eq(productUnits.unitId, sourceUnitId),
    inArray(productUnits.productId, productIds),
  );
  if (targetUnitId === null) {
    // Reassign to Each: drop the rows for the listed products still on the source unit.
    await tx.delete(productUnits).where(scope);
    return;
  }
  const [target] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.id, targetUnitId)))
    .for("key share");
  if (target === undefined) throw new AppError("unit.not_found", { unitId: targetUnitId });
  await tx.update(productUnits).set({ unitId: targetUnitId }).where(scope);
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @waitron/catalogue test src/units.pg.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/catalogue/src/units.ts packages/catalogue/src/units.pg.test.ts
git commit -s -m "reassignProductsToUnit can reassign products to Each (null target)

A null target deletes the listed products' unit rows so a unit can be
emptied and then deleted."
```

---

### Task 5: Drop the `each` seed

`each` stops being a seeded unit; the other five stay.

**Files:**
- Modify: `packages/catalogue/src/provisioning.ts:19-34` (drop `each` from `UNIT_NAMES`/`UNIT_ABBR`) and `:87-93` (drop the `'each'` seed row)
- Test: `packages/catalogue/src/provisioning.test.ts`

- [ ] **Step 1: Update the failing test** — provisioning seeds five units, none `each`.

```ts
// provisioning.test.ts — adjust the existing seed assertion
const seeded = await tx.select({ seedKey: units.seedKey }).from(units).where(eq(units.tenantId, tenantId));
expect(seeded.map((u) => u.seedKey).sort()).toEqual(["g", "kg", "l", "mg", "ml"]);
expect(await getSeededUnit(tx, tenantId, "each")).toBeNull();
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/catalogue test src/provisioning.test.ts` → FAIL (still 6, includes `each`).

- [ ] **Step 3: Remove the `each` seed** — delete the `each:` keys from `UNIT_NAMES` and `UNIT_ABBR`, and delete the `(${node.tenantId}, 'each', …)` values row at `:88` (keep the other five).

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @waitron/catalogue test` → PASS. Fix any other catalogue test that assumed the `each` seed exists.

- [ ] **Step 5: Commit**

```bash
git add packages/catalogue/src/provisioning.ts packages/catalogue/src/provisioning.test.ts
git commit -s -m "Stop seeding an 'each' unit

Each is now the implicit default for a product with no unit (rendered
via EACH_UNIT), not a stored, listed, editable unit. Provisioning seeds
g/kg/mg/ml/l only."
```

---

### Task 6: Server — GET products-using-a-unit + reassign accepts a null target

**Files:**
- Modify: `apps/server/src/units-api.ts` (new GET route `:82`-ish; reassign body `:101-105`)
- Test: the units-api test (find it: `apps/server/src/units-api*.test.ts`; add cases beside the existing reassign/delete tests)

**Interfaces:**
- Produces: `GET /management-api/units/:id/products` → `ProductUsingUnit[]` (200), `unit.not_found` (404), gated by `person.manage`. `POST …/products/reassign` body `unitId` may be `null` (reassign to Each). Consumed by the dashboard client (Task 7).

- [ ] **Step 1: Write the failing tests**

```ts
it("GET /management-api/units/:id/products returns the products using the unit", async () => {
  const res = await app.request(`/management-api/units/${unitId}/products`, { headers: managerHeaders });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ id: p1, name: expect.any(Object), available: true }]);
});
it("GET …/products 404s an unknown unit", async () => {
  const res = await app.request(`/management-api/units/${randomUuid}/products`, { headers: managerHeaders });
  expect(res.status).toBe(404);
});
it("reassign accepts a null target and clears the products' unit", async () => {
  const res = await app.request(`/management-api/units/${unitId}/products/reassign`, {
    method: "POST", headers: managerHeaders,
    body: JSON.stringify({ productIds: [p1], unitId: null }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});
```

(Include a no-session case → 401, mirroring the existing route tests, to keep the `person.manage` gate covered.)

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @waitron/server test src/units-api.test.ts` → FAIL (route 404s / null rejected).

- [ ] **Step 3: Add the GET route** (place after the `GET /:id` route, before the reassign route)

```ts
app.get("/management-api/units/:id/products", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const id = unitId(c);
    return c.json(
      await gated(sessionId, async (tx) => {
        await getUnit(tx, deps.cfg.tenantId, id); // 404 for an unknown or foreign unit
        return productsUsingUnit(tx, deps.cfg.tenantId, id);
      }),
    );
  }),
);
```

- [ ] **Step 4: Let the reassign body accept a null target**

```ts
// replace the strict unitId check at :101-105
if (body.unitId !== null && (typeof body.unitId !== "string" || !isUuid(body.unitId))) {
  throw new AppError("management.request_invalid", { field: "unitId" });
}
const targetUnitId = body.unitId as string | null;
```

- [ ] **Step 5: Run to verify they pass** — `pnpm --filter @waitron/server test src/units-api.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/units-api.ts apps/server/src/units-api.test.ts
git commit -s -m "Add a route to read the products using a unit; reassign to Each

GET /management-api/units/:id/products returns the products using a unit
(so the Units screen can show them on a row click), and the reassign
route accepts a null target to clear products' unit (reassign to Each)."
```

---

### Task 7: Dashboard client — nullable unit types, `listUnitProducts`, reassign to Each

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`ProductEditorInput.unitId:314`; `reassignProductsUnit:2043-2053`; add `listUnitProducts` near `:2026`)
- Test: covered by the screen tests (Tasks 9–10); no standalone client test unless the suite already has `client.test.ts` for these methods.

**Interfaces:**
- Produces: `listUnitProducts(id: string): Promise<ProductUsingUnit[]>`; `reassignProductsUnit(id, productIds, targetUnitId: string | null)`; `ProductEditorInput.unitId: string | null` (and `ProductEditorValue` via `extends`). Consumed by the product form (Task 9) and units screen (Task 10).

- [ ] **Step 1: Change the types and methods**

```ts
// client.ts — ProductEditorInput
unitId: string | null;

// listUnitProducts (beside listUnits)
/** `GET /management-api/units/:id/products` — the products using this unit. */
listUnitProducts(id: string): Promise<ProductUsingUnit[]> {
  return this.#request<ProductUsingUnit[]>(`/management-api/units/${id}/products`, "GET");
}

// reassignProductsUnit — allow a null target (reassign to Each)
reassignProductsUnit(
  id: string,
  productIds: string[],
  targetUnitId: string | null,
): Promise<ProductUsingUnit[]> {
  return this.#request<ProductUsingUnit[]>(
    `/management-api/units/${id}/products/reassign`,
    "POST",
    { productIds, unitId: targetUnitId },
  );
}
```

If `listUnits`/`reassign` are mirrored in `background` client or in a mock/fake client used by tests, add `listUnitProducts` there too (grep `reassignProductsUnit` and `background` in the dashboard test helpers).

- [ ] **Step 2: Typecheck** — `pnpm --filter @waitron/dashboard typecheck`. Expect errors only where the product form/units screen consume the old types; those are fixed in Tasks 9–10. Land Task 7 together with 9–10 if the typecheck must be green at commit; otherwise commit the client change and proceed.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/api/client.ts
git commit -s -m "Dashboard client: nullable product unit, listUnitProducts, reassign to Each"
```

---

### Task 8: `wt-data-table` — generic whole-row-click affordance

Add an accessible, opt-in whole-row-click to the shared table using the stretched-link pattern, so a screen can make rows activatable without swallowing per-row controls (checkboxes, the Edit/Delete menu). Only the plain (non-tree) render path is in scope; a tree table ignores `rowClick`.

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts` (props, plain-path `<tr>` render, styles)
- Test: `packages/ui/src/components/wt-data-table.test.ts` (behaviour + token painting), `packages/ui/src/components/wt-data-table.a11y.test.ts` (axe, both themes)

**Interfaces:**
- Produces: `@property({ attribute: false }) rowClick?: (row: Row) => void;` and `@property({ attribute: false }) rowClickLabel: (row: Row) => string = () => "Open row";`. When `rowClick` is set (plain path), the first column's cell content is wrapped in a stretched `<button class="row-activate">` labelled by `rowClickLabel`, and the `<tr>` gets `class="clickable"`. Consumed by the Units screen (Task 10).

- [ ] **Step 1: Write the failing tests**

```ts
// wt-data-table.test.ts
it("activates a row on click when rowClick is set", async () => {
  const clicked: string[] = [];
  const el = await fixture(html`<wt-data-table
    .rows=${[{ id: "a", name: "Alpha" }]}
    .columns=${[{ key: "name", label: "Name", cell: (r) => r.name }]}
    .rowKey=${(r) => r.id}
    .rowClick=${(r) => clicked.push(r.id)}
    .rowClickLabel=${(r) => `Open ${r.name}`}
  ></wt-data-table>`);
  const activate = el.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!;
  expect(activate.getAttribute("aria-label")).toBe("Open Alpha");
  activate.click();
  expect(clicked).toEqual(["a"]);
});

it("does not activate the row when an in-cell control is clicked", async () => {
  const clicked: string[] = [];
  const el = await fixture(html`<wt-data-table
    .rows=${[{ id: "a", name: "Alpha" }]}
    .columns=${[
      { key: "name", label: "Name", cell: (r) => r.name },
      { key: "actions", label: "", cell: () => html`<button class="edit">Edit</button>` },
    ]}
    .rowKey=${(r) => r.id}
    .rowClick=${(r) => clicked.push(r.id)}
  ></wt-data-table>`);
  el.shadowRoot!.querySelector<HTMLButtonElement>("button.edit")!.click();
  expect(clicked).toEqual([]); // the row was not activated by the Edit click
});

it("paints the focused clickable row from a token", async () => {
  // render with rowClick set, focus the .row-activate button, and assert the row cell's
  // background resolves to the --wt-color-surface-raised token value (via :focus-within).
  // Assert :focus-within, NOT :hover — getComputedStyle cannot force a hover state.
  // Mirror the existing token-painting assertions in this file for how they read the value.
});
```

For the a11y test, follow this file's ACTUAL structure — it uses `describe.each(["light","dark"])` (`wt-data-table.a11y.test.ts:12`), not a `for` loop or a `renderTable` helper. Add a clickable-rows case inside that existing per-theme block, rendering the table with `.rowClick`/`.rowClickLabel` set and asserting `axe` finds no violations (the same shape as the sibling cases).

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @waitron/ui test src/components/wt-data-table.test.ts` → FAIL (no `.row-activate`).

- [ ] **Step 3: Add props**

```ts
@property({ attribute: false }) rowClick?: (row: Row) => void;
@property({ attribute: false }) rowClickLabel: (row: Row) => string = () => "Open row";
```

- [ ] **Step 4: Render the stretched activator (plain path only, `:690-704`)**

Give the `<tr>` `class=${classMap({ clickable: this.rowClick !== undefined })}`. In the FIRST column cell, when `rowClick` is set, wrap the cell content so a stretched button overlays the row:

```ts
${this.columns.map((column, ci) => html`
  <td data-align=${column.align ?? "start"}>
    ${
      ci === 0 && this.rowClick !== undefined
        ? html`<button
              class="row-activate"
              aria-label=${this.rowClickLabel(row)}
              @click=${() => this.rowClick!(row)}
            ></button>${column.cell(row, { ancestorOnly: false })}`
        : column.cell(row, { ancestorOnly: false })
    }
  </td>
`)}
```

The mouse-anywhere behaviour and the "don't hijack in-cell controls" behaviour come from CSS (next step): the stretched button sits behind interactive controls, which are lifted above it.

- [ ] **Step 5: Styles (all `--wt-*` tokens)**

```css
tr.clickable { position: relative; }
tr.clickable:hover td,
tr.clickable:focus-within td { background: var(--wt-color-surface-raised); cursor: pointer; }
/* The stretched activator covers the whole row for mouse users; it is a real focusable button for
   keyboard/AT (labelled by rowClickLabel). It sits at the base layer… */
.row-activate {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer;
  z-index: 0;
}
.row-activate:focus-visible { outline: var(--wt-focus-ring); outline-offset: var(--wt-focus-offset); }
/* …and every other interactive control in a clickable row sits ABOVE it, so a click on the
   Edit/Delete menu or the selection checkbox never activates the row. */
tr.clickable td :is(button, a, input, select, label, wt-row-actions):not(.row-activate) { position: relative; z-index: 1; }
```

These are the tokens this file already uses (verified): the existing row hover is
`background: var(--wt-color-surface-raised)` (`wt-data-table.ts:77-78`), and the focus
convention is `outline: var(--wt-focus-ring); outline-offset: var(--wt-focus-offset)`
(`:42-43`, `:94-95`). Do not invent tokens.

- [ ] **Step 6: Run to verify they pass** — `pnpm --filter @waitron/ui test src/components/wt-data-table.test.ts src/components/wt-data-table.a11y.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts packages/ui/src/components/wt-data-table.a11y.test.ts
git commit -s -m "wt-data-table: optional whole-row-click via a stretched activator

A screen can set .rowClick (+ .rowClickLabel) to make each row activate
on click. A real focusable button, labelled per row, gives keyboard and
AT access; in-cell controls (checkbox, Edit/Delete menu) sit above the
stretched activator so they are never swallowed. Plain (non-tree) tables
only."
```

---

### Task 9: Product form — Each is the default, unit no longer required

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor-model.ts` (`ProductEditorDraft.unitId: string | null`)
- Modify: `apps/dashboard/src/widgets/product-editor.ts` (`emptyDraft:38`; `willUpdate:149`; validation `:248-249`; select `:573-588`; change handler; remove `defaultUnitId` prop `:133`)
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts:329` (drop `.defaultUnitId`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (add `editor.unit_each`; remove the `editor.unit_required` USE)
- Test: `apps/dashboard/src/widgets/product-editor.test.ts` (browser mode)

**Interfaces:**
- Consumes: `ProductEditorInput.unitId: string | null` (Task 7).

- [ ] **Step 1: Write the failing tests** (browser)

```ts
it("defaults a new product to Each (no unit)", async () => {
  const el = await fixture(html`<dashboard-product-editor .open=${true} .units=${[kgChoice]} .locales=${["en"]}></dashboard-product-editor>`);
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="unit"]')!;
  expect(select.value).toBe(""); // the Each option
  expect(el.shadowRoot!.querySelector('[data-test="add-unit"]')).toBeTruthy();
});

it("submits unitId null when Each stays selected", async () => {
  const el = await fixture(/* editor with a valid name + price */);
  const submit = oneEvent(el, "wt-submit");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click(); // or the save button
  const { detail } = await submit;
  expect(detail.value.unitId).toBeNull();
});

it("submits the chosen real unit and marks it selected after load", async () => {
  const el = await fixture(html`<dashboard-product-editor .open=${true} .value=${{ ...draft, unitId: kgId }} .units=${[kgChoice]} .locales=${["en"]}></dashboard-product-editor>`);
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="unit"]')!;
  expect(select.value).toBe(kgId);
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @waitron/dashboard test src/widgets/product-editor.test.ts` → FAIL.

- [ ] **Step 3: Model + draft**

`product-editor-model.ts`: `unitId: string | null`. `product-editor.ts` `emptyDraft()`: `unitId: null`. `willUpdate`: `this.draft = this.value ? structuredClone(this.value) : emptyDraft();` (drop the `unitId: this.defaultUnitId` seed). Remove the `@property() defaultUnitId` line.

- [ ] **Step 4: Remove the required-unit validation** — delete the two lines at `:248-249` (`if (!this.units.some(... )) errors.unit = t("editor.unit_required")`).

- [ ] **Step 5: The select — Each option + `.selected`, no required marker**

```ts
<label
  >${t("product.unit")}<select
    name="unit"
    .value=${this.draft.unitId ?? ""}
    aria-describedby="unit-error"
    @change=${(event: Event) => {
      event.stopPropagation();
      this.change("unitId", (event.target as HTMLSelectElement).value || null);
    }}
  >
    <option value="" .selected=${this.draft.unitId === null}>${t("editor.unit_each")}</option>
    ${this.units.map(
      (unit) => html`<option value=${unit.id} .selected=${unit.id === this.draft.unitId}>${this.unitLabel(unit)}</option>`,
    )}
  </select></label
>
```

Drop `aria-required`/`aria-invalid` on the unit select and the `<span class="error" id="unit-error">` (no unit error any more), or keep the span empty — simplest is to remove the unit error span.

- [ ] **Step 6: i18n + catalogue-screen**

`strings.ts`: add `"editor.unit_each": "Each"` (en) and `"editor.unit_each": "Unidad"` (es), beside `editor.choose`. Remove the `editor.unit_required` reference (done in Step 4); leave the string key unless a used/defined-parity guard flags it — grep for `editor.unit_required` and, if nothing else uses it, remove the key from both locales. `catalogue-screen.ts:329`: delete the `.defaultUnitId=${…}` line.

- [ ] **Step 7: Run to verify they pass, then LOOK**

Run: `pnpm --filter @waitron/dashboard test src/widgets/product-editor.test.ts`
Then open the product editor and confirm the Each default and a chosen unit render correctly in BOTH themes and at phone width (the browser harness renders it; drive it via the test or the dev stack).

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/widgets/product-editor-model.ts apps/dashboard/src/widgets/product-editor.ts apps/dashboard/src/screens/catalogue-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/widgets/product-editor.test.ts
git commit -s -m "Product form: Each is the default unit and unit is optional

The unit dropdown shows Each as the pre-selected default; leaving it on
Each saves the product with no unit. The required-unit validation is
removed and the default-to-first-unit binding is gone."
```

---

### Task 10: Units screen — click a row to see its products; reassign to Each

**Files:**
- Modify: `apps/dashboard/src/screens/units-screen.ts` (adopt `rowClick`; fetch products; reassign target gains Each; `#changeUnit` maps Each → null)
- Modify: `apps/dashboard/src/i18n/strings.ts` (`units.view_products` row label, `units.change_unit_each`)
- Test: `apps/dashboard/src/screens/units-screen.test.ts` (browser mode)

**Interfaces:**
- Consumes: `api.listUnitProducts` (Task 7); `api.reassignProductsUnit(..., string | null)` (Task 7); `wt-data-table .rowClick`/`.rowClickLabel` (Task 8).

- [ ] **Step 1: Write the failing tests** (browser)

```ts
it("opens the products modal when a unit row is clicked", async () => {
  api.listUnitProducts = async () => [{ id: "p1", name: { en: "Soup" }, available: true }];
  const el = await mountUnitsScreen(api, { units: [unitA] });
  el.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!.click();
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector('[data-test="in-use-dialog"]')!;
  expect(dialog.hasAttribute("open") || (dialog as any).open).toBe(true);
  expect(el.shadowRoot!.textContent).toContain("Soup");
});

it("offers Each (no unit) as a reassign target and reassigns to it", async () => {
  const reassigned: unknown[] = [];
  api.reassignProductsUnit = async (id, ids, target) => { reassigned.push([id, ids, target]); return []; };
  // open the modal (row click), tick p1, choose the Each option, click change
  // …select the option whose value is the Each sentinel…
  expect(reassigned[0]).toEqual([unitA.id, ["p1"], null]); // Each maps to a null target
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @waitron/dashboard test src/screens/units-screen.test.ts` → FAIL.

- [ ] **Step 3: Fetch-and-open on row click**

Add a handler and wire the table:

```ts
async #openUnitProducts(unit: Unit): Promise<void> {
  if (this.busy) return;
  this.busy = true;
  this.error = null;
  try {
    const products = await this.api.listUnitProducts(unit.id);
    this.#openInUse(unit.id, products);
  } catch (error) {
    this.error = error as UnitError;
  } finally {
    this.busy = false;
  }
}
```

On the units `<wt-data-table>` add:

```ts
.rowClick=${(unit: Unit) => void this.#openUnitProducts(unit)}
.rowClickLabel=${(unit: Unit) => `${t("units.view_products")}: ${localizedName(unit.name)}`}
```

(The Edit/Delete `wt-row-actions` in the actions column keeps working — it sits above the stretched activator, and its buttons already `stopPropagation`.)

- [ ] **Step 4: Reassign target gains "Each (no unit)"**

In the reassign `<select>`, add an Each option and map it to a null target. Use a sentinel value distinct from a uuid and from the placeholder `""`:

```ts
// a module constant
const REASSIGN_EACH = "__each__";
// in the select, after the placeholder option:
<option value=${REASSIGN_EACH}>${t("units.change_unit_each")}</option>
${otherUnits.map((unit) => html`<option value=${unit.id}>${localizedName(unit.name)}</option>`)}
```

`#changeUnit` maps the sentinel to `null`:

```ts
const target = this.reassignTarget === REASSIGN_EACH ? null : this.reassignTarget;
this.inUseProducts = await this.api.reassignProductsUnit(this.inUseUnitId, this.selectedProducts, target);
```

The disabled guard already treats `reassignTarget === ""` (placeholder) as "nothing chosen"; the sentinel is a real choice so the button enables.

- [ ] **Step 5: i18n** — add to BOTH locales:
`"units.view_products": "View products"` / `"Ver productos"`;
`"units.change_unit_each": "Each (no unit)"` / `"Unidad (sin unidad)"`.

- [ ] **Step 6: Run to verify they pass, then LOOK** — `pnpm --filter @waitron/dashboard test src/screens/units-screen.test.ts`; then open the Units screen, click a row, and confirm the modal + Each reassign option render in both themes and at phone width.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/screens/units-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/units-screen.test.ts
git commit -s -m "Units screen: click a unit to see its products; reassign to Each

A whole-row click opens the products-using-this-unit modal (loaded via
the new read route), reusing the existing bulk-reassign toolbar, whose
target now includes Each (no unit) so a unit can be emptied and deleted."
```

---

### Task 11: Whole-branch verification + docs

**Files:**
- Modify (if stale): `docs/backlog.md`; the handoff ledger `docs/handoffs/2026-09-15-optional-product-unit.md` (gitignored)

- [ ] **Step 1: Typecheck the touched packages**

Run: `pnpm --filter @waitron/catalogue --filter @waitron/server --filter @waitron/dashboard --filter @waitron/ui typecheck`
Expected: clean. Fix any remaining `unitId` nullability fallout.

- [ ] **Step 2: Run the touched packages' suites**

Run: `pnpm --filter @waitron/catalogue test:coverage` and `pnpm --filter @waitron/ui test:coverage`; the dashboard and server suites via their focused files (browser/real-PG — mind the concurrency rule: check free memory and other test runs first).
Expected: green, coverage bars held (`98/98/98/95` in catalogue; `90/90/85/85` in ui/dashboard/server).

- [ ] **Step 3: Search for stale claims about a required unit** — grep runbooks/READMEs/specs (whole tree, prose too) for "unit is required", "each unit", "choose a unit"; update any that the change falsified (CLAUDE.md §1: editing a file is not auditing it — read the prose across the base-to-tip range).

- [ ] **Step 4: Update the backlog** if it lists this work; set the handoff ledger to `Status: done`.

- [ ] **Step 5: Ready for finish-branch** — do NOT skip the wave (full ceremony: cross-package contract change). Announce readiness to run `finish-branch`.

---

## Self-review notes

- **Spec coverage:** unit optional (T2/T3), Each never stored + synthetic display (T1), drop each seed (T5), reassign to Each (T4/T6/T10), product form default Each (T9), row-click modal + new GET (T6/T8/T10), no schema migration (honoured — no drizzle step), no fiscal impact (unchanged reads). All spec sections map to a task.
- **Type consistency:** `unitId: string | null` flows editor-input (T3) → catalogue value (T2) → client (T7) → draft/form (T9); `reassignProductsToUnit`/`reassignProductsUnit` take `string | null` (T4/T6/T7/T10); `EACH_UNIT`/`clearProductUnit`/`listUnitProducts`/`rowClick` names are used identically where produced and consumed.
- **Known coupling:** Tasks 2 and 3 must typecheck together (the nullable `unitId` type spans both); Task 7's client types go green once Tasks 9–10 consume them — land 7→9→10 in order.
