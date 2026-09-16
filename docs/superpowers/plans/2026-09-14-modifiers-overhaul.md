# Modifiers Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the modifiers management screen onto the categories design, simplify the modifier and choice forms, and replace the choice editor's allergen/dietary controls with the dashboard's multi-select combobox — with a delete flow that previews dependants and cascades products and menus.

**Architecture:** Four layers, inner to outer. (1) The shared contract normalises a choice's dietary effect and fixes availability to the yes/no variant. (2) A migration flips the menu foreign key to cascade so a delete can detach menus, and the catalogue delete/dependants logic changes to match. (3) A new shared dashboard widget renders the three allergen/dietary multi-selects. (4) The screen and its two forms are rebuilt on the categories patterns.

**Tech Stack:** TypeScript, Lit web components, Drizzle ORM on PostgreSQL, Vitest (PGlite + Testcontainers real Postgres, and browser-mode Chromium for dashboard widgets), Hono for the server routes.

**Spec:** `docs/superpowers/specs/2026-09-14-modifiers-overhaul-design.md` — read it alongside this plan; every task argues from it.

## Global Constraints

- **Plain English in every commit message and PR text** — translate any domain term on first use; exact file/function/error-code names appear once as pointers; run commands verbatim. (Global CLAUDE.md.)
- **Every commit is `git commit -s`.** Never commit to `main`; this is the `modifiers-overhaul` worktree/branch.
- **TDD** — write the failing test, run it, watch it fail for the right reason, then the minimal implementation. Reading is not verification: a claim about behaviour is proven by running it, with a control where a passing and failing case would otherwise look alike.
- **Error codes name the domain concept and are never renamed once shipped.** `modifier.in_use` and its `{ modifierId, dependency }` params keep their exact shape. Every file that throws a code imports its registry (`import "./errors.js"`).
- **Tenant scoping is per query.** Every read scopes to the tenant; a by-id read too. Configuration routes compare the session tenant against the configured one and are manager-gated exactly as the sibling category routes are.
- **UI tokens only** — every colour, spacing, radius, font reads a `--wt-*` token; no hex, named colours, `rem`/`em`. Custom events are `wt-*`, carry `detail`, dispatch `bubbles: true, composed: true`, and stop the triggering event before re-emitting. Markup handed to `wt-data-table` as a cell is styled with `part=`/`::part()`, never a CSS class.
- **A new `wt-*`/dashboard widget needs a token-painting test and an `*.a11y.test.ts` axe test covering each distinct state in both themes.**
- **No backwards-compatibility or data-migration code** (pre-production). Schema changes drop/recreate; migrations carry no data-preservation code. A drizzle migration is generated, never hand-edited.
- **Run focused tests while implementing** (`pnpm --filter <pkg> test <file>` / `test:coverage` when chasing a value); do not add a whole-workspace run to finish. Real-Postgres tests need `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **Look at any rendered screen in both light and dark themes at phone width before calling it done.**

---

## File Structure

**Layer 1 — contract**
- Modify `packages/shared/src/modifiers.ts` — add `isModifierOffered`; types unchanged structurally.
- Modify `packages/catalogue/src/modifier-contract.ts` — availability fixed to yes/no; dietary effect normalised to a non-null `{ invalidates }`; use `isModifierOffered`.
- Modify `packages/catalogue/src/modifier-projection.ts` — filter with `isModifierOffered`.
- Modify `packages/catalogue/src/modifiers.ts` — `listModifiers` coalesces a stored `null` dietary effect; `deleteModifier` and a new `modifierDependants` (Layer 2).
- Modify `apps/till/src/state/as-served.ts` — a modifier choice's empty/absent dietary effect means "no effect".

**Layer 2 — delete & dependants**
- Modify `packages/catalogue/src/schema/menu.ts` — `menu_item_option_groups.group_fk` (and, if the real-PG test requires, `menu_item_options.option_fk`) → `onDelete("cascade")`.
- Create `packages/catalogue/drizzle/NNNN_*.sql` — generated migration for the FK change.
- Modify `packages/catalogue/src/modifiers.ts` — order-only refusal, `modifierDependants`.
- (No barrel edit expected: `packages/catalogue/src/index.ts` re-exports `modifiers.ts` with `export *`, so `modifierDependants`/`ModifierDependants` surface automatically. Confirm that line holds.)
- Modify `apps/server/src/catalogue-api.ts` — `GET /management-api/modifiers/:id/dependants`.
- Modify `apps/dashboard/src/api/client.ts` — `getModifierDependants` + `ModifierDependants` interface.

**Layer 3 — widget**
- Create `apps/dashboard/src/widgets/allergen-dietary-picker.ts` (+ `.test.ts`, `.a11y.test.ts`).

**Layer 4 — forms & screen**
- Modify `apps/dashboard/src/widgets/choice-form.ts` (+ tests) — use the widget; drop presence and reviewed.
- Modify `apps/dashboard/src/widgets/modifier-form.ts` (+ tests) — Available switch only for yes/no.
- Modify `apps/dashboard/src/screens/modifiers-screen.ts` (+ `.test.ts`, `.a11y.test.ts`) — the rebuilt screen.
- Modify `apps/dashboard/src/i18n/strings.ts` — new `en`/`es` strings.

---

## Task 1: Contract — availability fixed to yes/no, dietary effect normalised

**Files:**
- Modify: `packages/shared/src/modifiers.ts`
- Modify: `packages/catalogue/src/modifier-contract.ts`
- Modify: `packages/catalogue/src/modifier-projection.ts`
- Modify: `packages/catalogue/src/modifiers.ts:36-77` (`listModifiers` dietary read)
- Test: `packages/catalogue/src/modifier-contract.test.ts`

**Interfaces:**
- Produces: `isModifierOffered(modifier: { type: string; available: boolean }): boolean` from `@waitron/shared` (re-exported by `@waitron/catalogue`); `parseModifierInput` now (a) fixes `available` to `true` for `text`/`extras`/`options` regardless of the value sent, reading it only for `yes-no`, and (b) always returns a non-null `dietaryEffect: { invalidates: string[] }` on every choice.

> **Refinement of the spec:** the spec said the contract *rejects* an `available` key on the three non-yes/no types. This plan instead *fixes it to `true`* (ignores any sent value), because the shared `ModifierInput` type carries `available` structurally and forcing the value is behaviour-identical to the owner (there is no modifier-level toggle for those types) with far less type churn. The `keys()` allowlist keeps `available` permitted, so nothing is rejected. Flag at review if you would rather fork the type and reject.

- [ ] **Step 1: Write the failing tests**

Add to `packages/catalogue/src/modifier-contract.test.ts`:

```ts
import { isModifierOffered } from "@waitron/shared";

it("fixes availability to true for extras regardless of the value sent", () => {
  const input = parseModifierInput({
    type: "extras",
    name: { en: "Extras" },
    available: false,
    required: false,
    maxTotalQuantity: null,
    choices: [{ id: crypto.randomUUID(), name: { en: "Cheese" }, available: true }],
  });
  expect(input.available).toBe(true);
});

it("reads availability for a yes-no modifier", () => {
  const off = parseModifierInput({ type: "yes-no", name: { en: "Gift wrap" }, available: false });
  expect(off.available).toBe(false);
  const on = parseModifierInput({ type: "yes-no", name: { en: "Gift wrap" } });
  expect(on.available).toBe(true);
});

it("normalises an absent, null, or empty dietary effect on a choice to an empty invalidates list", () => {
  const id = crypto.randomUUID();
  const choiceOf = (dietaryEffect: unknown) =>
    (parseModifierInput({
      type: "options",
      name: { en: "Sauce" },
      defaultChoiceId: null,
      choices: [{ id, name: { en: "Ketchup" }, available: true, ...(dietaryEffect === "absent" ? {} : { dietaryEffect }) }],
    }) as { choices: { dietaryEffect?: { invalidates: string[] } | null }[] }).choices[0]!.dietaryEffect;
  expect(choiceOf("absent")).toEqual({ invalidates: [] });
  expect(choiceOf(null)).toEqual({ invalidates: [] });
  expect(choiceOf({ invalidates: [] })).toEqual({ invalidates: [] });
});

it("isModifierOffered is true for a non-yes-no type and follows availability for yes-no", () => {
  expect(isModifierOffered({ type: "extras", available: false })).toBe(true);
  expect(isModifierOffered({ type: "yes-no", available: false })).toBe(false);
  expect(isModifierOffered({ type: "yes-no", available: true })).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/catalogue test modifier-contract`
Expected: FAIL — `isModifierOffered` is not exported; availability is not fixed; dietary effect is `null`/absent rather than `{ invalidates: [] }`.

- [ ] **Step 3: Add `isModifierOffered` to `packages/shared/src/modifiers.ts`**

Append (the types above it are unchanged):

```ts
/** Whether a modifier is offered at all. Only a yes/no modifier can be turned off as a whole; the
 * other types are always offered and toggle availability per choice. */
export function isModifierOffered(modifier: { type: string; available: boolean }): boolean {
  return modifier.type !== "yes-no" || modifier.available;
}
```

- [ ] **Step 4: Fix availability and normalise the dietary effect in `modifier-contract.ts`**

Re-export the helper with the other shared re-exports at the top of `modifier-contract.ts`:

```ts
export { isModifierOffered } from "@waitron/shared";
import { isModifierOffered } from "@waitron/shared";
```

In `parseModifierInput`, drop `available` from the base parse and set it per type. Replace the `common` construction and the base-key list:

```ts
  const row = record(value, "modifier");
  const name = label(row.name, "name");
  const baseKeys = ["type", "name", "available"]; // `available` stays allowed so no stray-key error; it is read only for yes-no.
  if (row.type === "text") {
    keys(row, baseKeys, "modifier");
    return { name, available: true, type: "text" };
  }
  if (row.type === "yes-no") {
    keys(row, [...baseKeys, "defaultValue"], "modifier");
    return {
      name,
      available: bool(row.available === undefined ? true : row.available, "available"),
      type: "yes-no",
      defaultValue: bool(row.defaultValue === undefined ? false : row.defaultValue, "defaultValue"),
    };
  }
```

Below, the extras/options branch builds `common`; set its availability to `true` and keep the rest:

```ts
  const common = { name, available: true };
```

Leave the `keys(...)` allowlist for extras/options unchanged (it already lists `available` via `baseKeys`). The `common.available && required && !choices.some(available)` guard still holds (it is now always `true && …`).

In `effects()`, normalise the dietary effect so a choice never carries `null`:

```ts
  if (row.dietaryEffect === undefined || row.dietaryEffect === null) {
    out.dietaryEffect = { invalidates: [] };
  } else {
    const effect = record(row.dietaryEffect, "dietaryEffect");
    keys(effect, ["invalidates"], "dietaryEffect");
    out.dietaryEffect = { invalidates: validateDietaryDeclarations(effect.invalidates) };
  }
```

In `validateModifierSelections`, replace the two `definition.available` gate reads (the `!definition.available` at the per-selection check, and the trailing required-selection loop) with `!isModifierOffered(definition)` and `isModifierOffered(definition)` respectively — behaviour identical, one seam.

The till widgets' four bare `modifier.available` reads (`apps/till/src/widgets/product-grid.ts`, `modifier-picker.ts` ×2, `tender-pay.ts`) are left as-is on purpose: they read already-projected modifiers where `available` is `true` for every non-yes/no type, so they agree with `isModifierOffered`. Under pre-production drop/recreate there is no legacy `active=false` non-yes/no row to make them diverge. Not a change; noted so a reviewer does not read it as a missed seam.

- [ ] **Step 5: Use the helper in `modifier-projection.ts`**

In both `readProductModifiers` and `readMenuModifiers`, change the definition filter from `.filter((modifier) => modifier.available)` to `.filter(isModifierOffered)` and add the import:

```ts
import { isModifierOffered, type Modifier } from "@waitron/shared";
```

- [ ] **Step 6: Coalesce a stored null dietary effect in `listModifiers`**

In `packages/catalogue/src/modifiers.ts`, in the `items.filter(...).map(...)` choice mapping, change `dietaryEffect: item.dietaryEffect,` to:

```ts
        dietaryEffect: item.dietaryEffect ?? { invalidates: [] },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/catalogue test modifier-contract`
Expected: PASS. Then run the whole file's neighbours to catch regressions: `pnpm --filter @waitron/catalogue test modifier`.
Expected: PASS (projection and existing contract suites still green).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/modifiers.ts packages/catalogue/src/modifier-contract.ts packages/catalogue/src/modifier-projection.ts packages/catalogue/src/modifiers.ts packages/catalogue/src/modifier-contract.test.ts
git commit -s -m "Modifiers: fix availability to the yes/no type and never store a null dietary effect

A choice now always carries an explicit 'no dietary effect' rather than
an unreviewed null, and only a yes/no modifier can be turned off as a
whole. A shared isModifierOffered helper replaces the scattered
availability reads."
```

---

## Task 2: Till — an empty dietary effect means "no effect"

**Files:**
- Modify: `apps/till/src/state/as-served.ts:81-96` (`asServedDietaryDeclarations`)
- Test: the suite that covers `asServedDietaryDeclarations` (search: `apps/till/src/state/as-served*.test.ts`)

**Interfaces:**
- Consumes: nothing new. Changes only how a selected modifier choice's dietary effect folds into the dish's claims.

- [ ] **Step 1: Write the failing test**

Add a test asserting that a selected modifier choice with a **null** dietary effect leaves the dish's declared labels intact. The branch that changes is the `null`/`undefined` one: `applyDietaryEffects` (`packages/catalogue/src/dietary-declarations.ts:42`) withholds (`return []`) only when an effect is `null`, and the current `asServedDietaryDeclarations` maps a selected choice's `null` effect to `null`. A choice whose `dietaryEffect` is already `{ invalidates: [] }` keeps the claims *today* — a test using that fixture would pass before the change and prove nothing (the "both answers look alike" trap, CLAUDE.md §1). The fixture MUST use `null`.

```ts
it("keeps the dish's dietary claims when a selected modifier choice has a null dietary effect", () => {
  // A dish declared vegan, a selected choice whose dietaryEffect is null (legacy / unreviewed).
  const line = lineWithSelectedChoice({ dietaryEffect: null }, ["vegan"]);
  expect(asServedDietaryDeclarations(line)).toContain("vegan");
});
```

(Build `lineWithSelectedChoice` / reuse the file's existing line helper so a choice is selected and its `dietaryEffect` is `null`. If the file has no such helper, follow the shape the existing tests already construct for `selectedItems(line)`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/till test as-served`
Expected: FAIL — the selected choice's `null` effect makes the map produce a withholding `null`, `applyDietaryEffects` returns `[]`, and "vegan" is absent. Confirm that is the failing reason before implementing.

- [ ] **Step 3: Change the null mapping to "no effect"**

In `asServedDietaryDeclarations`, the effects map currently sends `null` for both an `undefined` and a `null` choice effect. Change it so a modifier choice never contributes a withholding `null`:

```ts
  const effects = selectedItems(line)
    .filter((item) => item !== undefined)
    .map((item) =>
      item!.dietaryEffect == null
        ? { invalidates: [] as DietaryLabel[] }
        : { invalidates: item!.dietaryEffect.invalidates as DietaryLabel[] },
    );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @waitron/till test as-served`
Expected: PASS. Run the file's siblings too if the diet suite spans more than one file.

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/state/as-served.ts apps/till/src/state/as-served*.test.ts
git commit -s -m "Till: a modifier choice with no dietary effect leaves the dish's claims intact

Previously a choice with no reviewed dietary effect made the till
withhold every dietary claim for the dish. With the reviewed state gone,
an empty effect now means the choice changes nothing."
```

---

## Task 3: Migration — flip the menu foreign key to cascade (real Postgres, with a control)

**Files:**
- Modify: `packages/catalogue/src/schema/menu.ts:130-133` (`menu_item_option_groups_group_fk`), and — only if Step 4 proves it necessary — `menu_item_options.option_fk`.
- Create: `packages/catalogue/drizzle/NNNN_<name>.sql` + the drizzle snapshot/journal entries (generated).
- Test: `packages/catalogue/src/modifier-delete-cascade.pg.test.ts` (new, real Postgres).

**Interfaces:**
- Produces: after this task, deleting an `option_groups` row that a menu item publishes succeeds at the database level.

- [ ] **Step 1: Write the failing real-PG test (the red run is the control)**

Create `packages/catalogue/src/modifier-delete-cascade.pg.test.ts`. Use the package's real-Postgres helper (`useRealPostgres` — follow an existing `*.pg.test.ts` in the package for the exact import and container setup). The test:

```ts
// 1. Seed a tenant, a product, a menu section, a menu item, an option_group (type "options")
//    with one option_group_item, attach the group to the menu item via menu_item_option_groups,
//    and publish the item with a menu_item_options row referencing the option.
// 2. DELETE the option_groups row directly (raw SQL, as the owner role).
// 3. Assert it succeeds, and that the menu_item_option_groups and menu_item_options rows are gone.
```

**The control is the TDD red step, not a committed assertion.** Once the migration is applied there is no un-flipped FK left to write a permanent control against — the migrated schema only has the cascade. So the "a green delete is not a delete that never hit the constraint" guarantee comes from *watching Step 2 fail* against the pre-migration schema with SQLSTATE `23503` (a foreign-key violation), and only then applying the flip in Step 3. Keep the committed test as the single positive assertion (delete succeeds, link rows gone); do not try to commit a RESTRICT control that the schema can no longer produce.

- [ ] **Step 2: Run the test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test modifier-delete-cascade`
Expected: FAIL — the delete throws `23503` because `menu_item_option_groups.group_fk` is `RESTRICT`.

- [ ] **Step 3: Flip the FK in the schema and regenerate the migration**

In `packages/catalogue/src/schema/menu.ts`, change the `menu_item_option_groups_group_fk` foreign key's `.onDelete("restrict")` to `.onDelete("cascade")`:

```ts
    foreignKey({
      columns: [t.tenantId, t.groupId],
      foreignColumns: [optionGroups.tenantId, optionGroups.id],
      name: "menu_item_option_groups_group_fk",
    }).onDelete("cascade"),
```

Generate the migration (never hand-write the SQL):

Run: `pnpm --filter @waitron/catalogue db:generate` (the package's generate script — confirm in `packages/catalogue/package.json`).
The latest catalogue migration is `0011_category_colour.sql`, so the new file is `0012_*`. Verify the generated SQL drops and recreates the constraint with `ON DELETE CASCADE`, and that its journal entry is monotonic (`scripts/journal-monotonic.test.ts` guards this).

- [ ] **Step 4: Run the test; if it still fails on `menu_item_options_option_fk`, flip that too**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test modifier-delete-cascade`

- If PASS: the single flip is enough. Proceed.
- If FAIL with `23503` on `menu_item_options_option_fk`: PostgreSQL checked that `RESTRICT` before the cascade removed the referencing `menu_item_options` rows. Flip `menu_item_options.option_fk` (references `option_group_items`) to `.onDelete("cascade")` in `menu.ts`, regenerate the migration, and re-run. Record in the commit message which flips were needed and that the test decided it.

- [ ] **Step 5: Run the catalogue migration/grant guards**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test:coverage` scoped to the migration/immutability guards touched, or at least `pnpm --filter @waitron/catalogue test journal` and the grant assertions the package runs. Confirm the generated migration applies from a virgin database.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/schema/menu.ts packages/catalogue/drizzle packages/catalogue/src/modifier-delete-cascade.pg.test.ts
git commit -s -m "Modifiers: let deleting a modifier detach it from published menus

The menu link's foreign key was set to refuse the delete; it now
cascades, so removing a modifier removes it from any menu that published
it. A real-Postgres test with a control proves the delete succeeds and
that the old foreign key refused it. <note which foreign keys were flipped>"
```

---

## Task 4: Catalogue — order-only delete refusal and a dependants read

**Files:**
- Modify: `packages/catalogue/src/modifiers.ts` (`deleteModifier`; new `modifierDependants`)
- Modify: the catalogue public barrel that already exports `deleteModifier`/`listModifiers` (so `modifierDependants` and `ModifierDependants` are importable by `apps/server`)
- Test: `packages/catalogue/src/modifiers.pg.test.ts` (delete behaviour) and `packages/catalogue/src/modifier-dependants.pg.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export interface ModifierDependants {
    products: { id: string; name: Record<string, string> }[];
    menus: { id: string; name: Record<string, string> }[];
    orders: number;
  }
  export async function modifierDependants(
    tx: Transaction, tenantId: string, modifierId: string,
  ): Promise<ModifierDependants>;
  ```
  `deleteModifier` now throws `modifier.in_use` only for `dependency: "order"`; product/menu links are cascaded by the delete.

- [ ] **Step 1: Write the failing tests**

In `packages/catalogue/src/modifiers.pg.test.ts`, add:

```ts
it("deletes a modifier attached to a product and published on a menu, cascading the links", async () => {
  // seed product + menu item, attach + publish the modifier, then:
  await deleteModifier(tx, tenantId, modifierId);
  // assert getModifier throws modifier.not_found, and the product_option_groups /
  // menu_item_option_groups rows for it are gone.
});

it("refuses to delete a modifier an open working order uses", async () => {
  // seed an open working_order_lines row referencing the modifier's choice (option_group_item_id).
  await expect(deleteModifier(tx, tenantId, modifierId)).rejects.toMatchObject({
    code: "modifier.in_use",
    params: expect.objectContaining({ dependency: "order" }),
  });
});
```

Create `packages/catalogue/src/modifier-dependants.pg.test.ts`:

```ts
it("reports products, menus and the open-order count a delete would touch", async () => {
  // attach to product P (descriptions), publish on menu item for product Q, one open order line.
  const dependants = await modifierDependants(tx, tenantId, modifierId);
  expect(dependants.products.map((p) => p.id)).toContain(P.id);
  expect(dependants.menus.map((m) => m.id)).toContain(menuItemId);
  expect(dependants.orders).toBe(1);
});

it("404s a modifier of another tenant", async () => {
  await expect(modifierDependants(tx, otherTenantId, modifierId)).rejects.toMatchObject({
    code: "modifier.not_found",
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test modifiers.pg modifier-dependants`
Expected: FAIL — `modifierDependants` is undefined; `deleteModifier` still refuses on product/menu.

- [ ] **Step 3: Change `deleteModifier` to refuse only on orders**

In `packages/catalogue/src/modifiers.ts`, `deleteModifier` currently calls `assertUnused(tx, tenantId, modifierId, true)`. Replace that call with an order-only probe (do not touch `assertUnused`, which `updateModifier` still uses for the type-change guard):

```ts
export async function deleteModifier(
  tx: Transaction,
  tenantId: string,
  modifierId: string,
): Promise<void> {
  await lockModifierDefinitions(tx, tenantId);
  await getModifier(tx, tenantId, modifierId); // 404s a foreign/absent id, tenant-scoped
  const open = await tx.execute<{ one: number }>(sql`
    select 1 as one from working_order_lines
    where tenant_id = ${tenantId} and (
      modifier_snapshots @> ${JSON.stringify([{ modifierId }])}::jsonb
      or option_group_item_id in (
        select id from option_group_items where tenant_id = ${tenantId} and group_id = ${modifierId}
      )
    ) limit 1`);
  if (open.rows[0])
    throw new AppError("modifier.in_use", { modifierId, dependency: "order" });
  await tx
    .delete(optionGroups)
    .where(and(eq(optionGroups.tenantId, tenantId), eq(optionGroups.id, modifierId)));
}
```

- [ ] **Step 4: Add `modifierDependants` and `ModifierDependants`**

Add to `packages/catalogue/src/modifiers.ts` (import `menuItems`, `menuItemOptionGroups` from `./schema/menu.js`, and `products`, `productOptionGroups` from `@waitron/db`):

```ts
export interface ModifierDependants {
  products: { id: string; name: Record<string, string> }[];
  menus: { id: string; name: Record<string, string> }[];
  orders: number;
}

/** What deleting this modifier would touch — the preview the dashboard's delete confirmation reads.
 * Products and menus are detached (cascaded) by the delete; an open order refuses it, so `orders`
 * gates the confirm. A menu publication has no name of its own here, so it is identified by the
 * product the menu item is (its descriptions). */
export async function modifierDependants(
  tx: Transaction,
  tenantId: string,
  modifierId: string,
): Promise<ModifierDependants> {
  await getModifier(tx, tenantId, modifierId); // 404s a foreign/absent id, tenant-scoped
  const productRows = await tx
    .select({ id: products.id, name: products.descriptions })
    .from(products)
    .innerJoin(
      productOptionGroups,
      and(
        eq(productOptionGroups.tenantId, products.tenantId),
        eq(productOptionGroups.productId, products.id),
        eq(productOptionGroups.groupId, modifierId),
      ),
    )
    .where(eq(products.tenantId, tenantId))
    .orderBy(products.id);
  const menuRows = await tx
    .select({ id: menuItems.id, name: products.descriptions })
    .from(menuItemOptionGroups)
    .innerJoin(
      menuItems,
      and(
        eq(menuItems.tenantId, menuItemOptionGroups.tenantId),
        eq(menuItems.id, menuItemOptionGroups.menuItemId),
      ),
    )
    .innerJoin(
      products,
      and(eq(products.tenantId, menuItems.tenantId), eq(products.id, menuItems.productId)),
    )
    .where(
      and(eq(menuItemOptionGroups.tenantId, tenantId), eq(menuItemOptionGroups.groupId, modifierId)),
    )
    .orderBy(menuItems.id);
  const orders = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count from working_order_lines
    where tenant_id = ${tenantId} and (
      modifier_snapshots @> ${JSON.stringify([{ modifierId }])}::jsonb
      or option_group_item_id in (
        select id from option_group_items where tenant_id = ${tenantId} and group_id = ${modifierId}
      )
    )`);
  return {
    products: productRows,
    menus: menuRows,
    orders: orders.rows[0]?.count ?? 0,
  };
}
```

The catalogue barrel `packages/catalogue/src/index.ts` already does `export * from "./modifiers.js"`, so adding `modifierDependants` and `ModifierDependants` to `modifiers.ts` surfaces them automatically — no barrel edit is needed (confirm the `export *` line before assuming it).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test modifiers.pg modifier-dependants`
Expected: PASS. Then `pnpm --filter @waitron/catalogue test:coverage` if chasing the package's coverage bar (catalogue sits at `98/98/98/95`).

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/modifiers.ts packages/catalogue/src/*.pg.test.ts
git commit -s -m "Modifiers: delete detaches products and menus, refuses only on open orders

Deleting a modifier now removes it from the products and menus that use
it and only refuses when an open order still references it. A new
dependants read lists those products and menus and counts the open
orders, for the delete confirmation to preview."
```

---

## Task 5: Server route + dashboard API client

**Files:**
- Modify: `apps/server/src/catalogue-api.ts` (add the route near the other modifier routes, ~line 400)
- Modify: `apps/dashboard/src/api/client.ts` (`ModifierDependants` interface + `getModifierDependants`)
- Test: `apps/server/src/catalogue-api.test.ts`

**Interfaces:**
- Consumes: `modifierDependants` from `@waitron/catalogue` (Task 4).
- Produces: `GET /management-api/modifiers/:id/dependants` → `{ dependants: ModifierDependants }`; `DashboardApi.getModifierDependants(id): Promise<ModifierDependants>`.

- [ ] **Step 1: Write the failing server test**

Add to `apps/server/src/catalogue-api.test.ts` (mirror the categories dependants route test — find it by grepping `dependants` in that file, or the nearest modifier-route test):

```ts
it("returns a modifier's dependants for a manager", async () => {
  // seed a modifier attached to a product; call GET /management-api/modifiers/:id/dependants
  const res = await app.request(`/management-api/modifiers/${modifierId}/dependants`, { headers: managerHeaders });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.dependants).toMatchObject({ products: expect.any(Array), menus: expect.any(Array), orders: expect.any(Number) });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/server test catalogue-api`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Add the route**

In `apps/server/src/catalogue-api.ts`, import `modifierDependants` alongside the other catalogue modifier imports, and add after the `app.delete("/management-api/modifiers/:id", …)` handler:

```ts
  app.get("/management-api/modifiers/:id/dependants", (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), "ModifierId");
      const dependants = await gated(requireManagementSession(c), (tx) =>
        modifierDependants(tx, tenantId, id),
      );
      return c.json({ dependants });
    }),
  );
```

(`gated` and `requireManagementSession` already enforce the manager session and tenant; the modifier reads are tenant-scoped inside `modifierDependants`.)

- [ ] **Step 4: Add the dashboard API method and type**

In `apps/dashboard/src/api/client.ts`, add the interface near `CategoryDependants`:

```ts
export interface ModifierDependants {
  products: { id: string; name: Record<string, string> }[];
  menus: { id: string; name: Record<string, string> }[];
  orders: number;
}
```

and the method next to `deleteModifier`:

```ts
  async getModifierDependants(id: string): Promise<ModifierDependants> {
    return (
      await this.#request<{ dependants: ModifierDependants }>(
        `/management-api/modifiers/${id}/dependants`,
        "GET",
      )
    ).dependants;
  }
```

- [ ] **Step 5: Run the server test to verify it passes**

Run: `pnpm --filter @waitron/server test catalogue-api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/catalogue-api.ts apps/server/src/catalogue-api.test.ts apps/dashboard/src/api/client.ts
git commit -s -m "Modifiers: serve a modifier's delete dependants to the dashboard

Adds the manager-gated route the delete confirmation reads and the
matching dashboard client method."
```

---

## Task 6: Shared allergen/dietary picker widget

**Files:**
- Create: `apps/dashboard/src/widgets/allergen-dietary-picker.ts`
- Test: `apps/dashboard/src/widgets/allergen-dietary-picker.test.ts`, `apps/dashboard/src/widgets/allergen-dietary-picker.a11y.test.ts`

**Interfaces:**
- Produces: `<dashboard-allergen-dietary-picker>` with property `value: { addAllergens: string[]; removeAllergens: string[]; dietary: DietaryLabel[] }` and event `wt-change` (detail `{ value }`, `bubbles: true, composed: true`). A code chosen under "adds" is removed from "removes" and vice versa.

- [ ] **Step 1: Write the failing tests**

`allergen-dietary-picker.test.ts` (use the widget test harness — `mountWidget`/`cleanupWidgets` from `../widgets/test-helpers.js`, as the other widget tests do):

```ts
it("emits the three lists on change and keeps adds and removes disjoint", async () => {
  const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
    value: { addAllergens: [], removeAllergens: ["gluten"], dietary: [] },
  });
  const changes: unknown[] = [];
  el.addEventListener("wt-change", (e) => changes.push((e as CustomEvent).detail.value));
  // choosing gluten under "adds" removes it from "removes"
  el.selectAdd("gluten"); // test-only helper OR drive the wt-combobox values + dispatch wt-change
  await el.updateComplete;
  expect(changes.at(-1)).toEqual({ addAllergens: ["gluten"], removeAllergens: [], dietary: [] });
});

it("renders every colour, spacing and font from a --wt-* token", async () => {
  // token-painting test: assert the component's stylesheet contains no hex / named colours / rem / em.
  // Follow the pattern of an existing widget token test in apps/dashboard if present, else assert on
  // the constructed CSS text.
});
```

`allergen-dietary-picker.a11y.test.ts`: axe over the widget in both themes, covering an empty state and a state with each list populated (follow `allergen-picker.a11y.test.ts` for the theme-toggling harness).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/dashboard test allergen-dietary-picker`
Expected: FAIL — element undefined.

- [ ] **Step 3: Implement the widget**

Create `apps/dashboard/src/widgets/allergen-dietary-picker.ts`. Use three `wt-combobox` with `multiple`. Options: allergens from `ALLERGEN_CODES` (`../i18n/domain.js`) labelled via `allergenName`; dietary from `DIETARY_LABELS` (`../api/client.js`) labelled via `t("editor.diet.<label>")`. Structure:

```ts
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import { ALLERGEN_CODES, allergenName } from "../i18n/domain.js";
import { DIETARY_LABELS, type DietaryLabel } from "../api/client.js";
import { t } from "../i18n/t.js";

export interface AllergenDietaryValue {
  addAllergens: string[];
  removeAllergens: string[];
  dietary: DietaryLabel[];
}

@customElement("dashboard-allergen-dietary-picker")
export class AllergenDietaryPicker extends LitElement {
  static override styles = [baseStyles, css`
    :host { display: grid; gap: var(--wt-space-3); }
  `];
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) value: AllergenDietaryValue = { addAllergens: [], removeAllergens: [], dietary: [] };

  #emit(next: AllergenDietaryValue): void {
    this.value = next;
    this.dispatchEvent(new CustomEvent("wt-change", { detail: { value: next }, bubbles: true, composed: true }));
  }
  #allergenOptions() {
    return ALLERGEN_CODES.map((code) => ({ value: code, label: allergenName(code) }));
  }
  #onAdd(event: CustomEvent<{ values: string[] }>): void {
    event.stopPropagation();
    const addAllergens = event.detail.values;
    // disjoint: anything now added is dropped from removes
    const removeAllergens = this.value.removeAllergens.filter((c) => !addAllergens.includes(c));
    this.#emit({ ...this.value, addAllergens, removeAllergens });
  }
  #onRemove(event: CustomEvent<{ values: string[] }>): void {
    event.stopPropagation();
    const removeAllergens = event.detail.values;
    const addAllergens = this.value.addAllergens.filter((c) => !removeAllergens.includes(c));
    this.#emit({ ...this.value, addAllergens, removeAllergens });
  }
  #onDietary(event: CustomEvent<{ values: string[] }>): void {
    event.stopPropagation();
    this.#emit({ ...this.value, dietary: event.detail.values as DietaryLabel[] });
  }
  override render() {
    return html`
      <wt-combobox multiple .disabled=${this.busy}
        label=${t("modifiers.add_allergen")}
        .options=${this.#allergenOptions()} .values=${this.value.addAllergens}
        @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onAdd(e)}></wt-combobox>
      <wt-combobox multiple .disabled=${this.busy}
        label=${t("modifiers.remove_allergen")}
        .options=${this.#allergenOptions()} .values=${this.value.removeAllergens}
        @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onRemove(e)}></wt-combobox>
      <wt-combobox multiple .disabled=${this.busy}
        label=${t("modifiers.invalidates_dietary")}
        .options=${DIETARY_LABELS.map((l) => ({ value: l, label: t(`editor.diet.${l}`) }))}
        .values=${this.value.dietary}
        @wt-change=${(e: CustomEvent<{ values: string[] }>) => this.#onDietary(e)}></wt-combobox>`;
  }
}
declare global {
  interface HTMLElementTagNameMap { "dashboard-allergen-dietary-picker": AllergenDietaryPicker; }
}
```

For the test's `selectAdd` helper, either add a small public test hook or (preferred) in the test set the first combobox's `.values` and dispatch its `wt-change` with `{ values: ["gluten"] }`, since that is exactly what the real combobox emits (`dispatchWtChange(this, sourceEvent, { values: this.values })`, confirmed in `wt-combobox.ts`).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/dashboard test allergen-dietary-picker`
Expected: PASS (both the behaviour and a11y files).

- [ ] **Step 5: Look at it**

Mount it in the dev dashboard (or a scratch story) and confirm the three fields render and paint correctly in light and dark themes at phone width.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/widgets/allergen-dietary-picker.ts apps/dashboard/src/widgets/allergen-dietary-picker.*test.ts
git commit -s -m "Dashboard: a shared allergen and dietary multi-select widget

Three multi-select comboboxes for the allergens a choice adds, the
allergens it removes, and the dietary preferences it rules out. Adds and
removes are kept disjoint. Products can adopt it later."
```

---

## Task 7: Choice form — use the widget, drop presence and reviewed

**Files:**
- Modify: `apps/dashboard/src/widgets/choice-form.ts` (`#effects`, `#dietaryEffect`, `#effectList`, `#save`, `willUpdate`)
- Test: `apps/dashboard/src/widgets/choice-form.test.ts`, `apps/dashboard/src/widgets/choice-form.a11y.test.ts`

**Interfaces:**
- Consumes: `<dashboard-allergen-dietary-picker>` (Task 6).
- Produces: a saved `ChoiceDraft` whose `addAllergens` is `{ code: { presence: "contains" } }`, `removeAllergens` a list, and `dietaryEffect` is `{ invalidates }` (never `null`); no presence select, no reviewed switch rendered.

- [ ] **Step 1: Write the failing tests**

In `choice-form.test.ts`:

```ts
it("writes an added allergen as contains and a non-null dietary effect", async () => {
  const form = await mountChoiceForm(); // open, kind "extras"
  // drive the picker: dispatch its wt-change with adds ["gluten"], dietary ["vegan"]
  form.shadowRoot!.querySelector("dashboard-allergen-dietary-picker")!
    .dispatchEvent(new CustomEvent("wt-change", {
      detail: { value: { addAllergens: ["gluten"], removeAllergens: [], dietary: ["vegan"] } },
      bubbles: true, composed: true,
    }));
  await form.updateComplete;
  const saved = await saveAndCapture(form); // click choice-save, read the wt-choice-save detail.value
  expect(saved.addAllergens).toEqual({ gluten: { presence: "contains" } });
  expect(saved.dietaryEffect).toEqual({ invalidates: ["vegan"] });
});

it("renders no presence select and no reviewed switch", async () => {
  const form = await mountChoiceForm();
  expect(form.shadowRoot!.querySelector('[name^="presence-"]')).toBeNull();
  expect(form.shadowRoot!.textContent).not.toContain(t("modifiers.dietary_reviewed"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/dashboard test choice-form`
Expected: FAIL — the presence selects and reviewed switch still render; the picker isn't wired.

- [ ] **Step 3: Replace the effects section**

In `choice-form.ts`:
- Delete `#effectList`, `#dietaryEffect`, and the body of `#effects` that renders the `<details>` with the add-allergen select, per-code presence selects, remove-allergen select, and the dietary reviewed switch.
- Import the widget: `import "./allergen-dietary-picker.js"; import type { AllergenDietaryValue } from "./allergen-dietary-picker.js";`
- Keep `this.effects: ModifierEffects` as the internal model, but drive it from the widget. Add a converter from `effects` to the widget value and back:

```ts
  #pickerValue(): AllergenDietaryValue {
    return {
      addAllergens: Object.keys(this.effects.addAllergens ?? {}),
      removeAllergens: this.effects.removeAllergens ?? [],
      dietary: (this.effects.dietaryEffect?.invalidates ?? []) as DietaryLabel[],
    };
  }
  #onPicker(event: CustomEvent<{ value: AllergenDietaryValue }>): void {
    event.stopPropagation();
    const v = event.detail.value;
    this.#patch({
      addAllergens: v.addAllergens.length
        ? Object.fromEntries(v.addAllergens.map((code) => [code, { presence: "contains" as const }]))
        : {},
      removeAllergens: v.removeAllergens,
      dietaryEffect: { invalidates: v.dietary },
    });
  }
```

- `#effects()` becomes:

```ts
  #effects() {
    return html`<details>
      <summary>${t("modifiers.effects")}</summary>
      <div class="fields">
        <dashboard-allergen-dietary-picker
          .busy=${this.busy}
          .value=${this.#pickerValue()}
          @wt-change=${(e: CustomEvent<{ value: AllergenDietaryValue }>) => this.#onPicker(e)}
        ></dashboard-allergen-dietary-picker>
      </div>
    </details>`;
  }
```

- In `#save`, the `dietaryEffect` written into `ChoiceDraft` must never be `null`: it comes from `this.effects.dietaryEffect ?? { invalidates: [] }`. Adjust the `value` construction so `dietaryEffect` is always the `{ invalidates }` object (the contract normalises anyway, but keep the client honest). The `// adapter for the follow-up allergen spec` comment goes on the `presence: "contains"` mapping in `#onPicker`:

```ts
  // Every added allergen is recorded as `contains`. The follow-up allergen spec
  // (docs/superpowers/specs — contains/may-contain removal) deletes this presence wrapper.
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/dashboard test choice-form`
Expected: PASS. Update any existing choice-form test that asserted on the old presence/reviewed controls — preserve the behavioural intent (that adds/removes/dietary round-trip), do not delete the assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/choice-form.ts apps/dashboard/src/widgets/choice-form.*test.ts
git commit -s -m "Dashboard: edit a choice's allergens and dietary with the shared multi-select

Replaces the contains/may-contain selects and the reviewed switch with
the shared picker. An added allergen is recorded as 'contains'; a choice
with nothing chosen carries an explicit empty dietary effect."
```

---

## Task 8: Modifier form — Available switch only for yes/no

**Files:**
- Modify: `apps/dashboard/src/widgets/modifier-form.ts` (the `switchField(... "available" ...)` render, and `#save`'s `common`)
- Test: `apps/dashboard/src/widgets/modifier-form.test.ts`, `.a11y.test.ts`

**Interfaces:**
- Produces: the modifier-level Available switch renders only when `type === "yes-no"`; for other types `#save` emits `available: true`.

- [ ] **Step 1: Write the failing tests**

```ts
it("shows the modifier-level Available switch only for a yes-no modifier", async () => {
  const form = await mountModifierForm(); // type defaults to "text"
  const availableSwitch = () => form.shadowRoot!.querySelector('[name="available"]');
  expect(availableSwitch()).toBeNull();
  setType(form, "yes-no");
  await form.updateComplete;
  expect(availableSwitch()).not.toBeNull();
  setType(form, "extras");
  await form.updateComplete;
  expect(availableSwitch()).toBeNull();
});

it("submits available true for a non-yes-no modifier", async () => {
  const form = await mountModifierForm(); // type text, name filled
  const value = await saveAndCapture(form);
  expect(value.available).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/dashboard test modifier-form`
Expected: FAIL — the switch renders for all types.

- [ ] **Step 3: Gate the switch and the save value**

In `modifier-form.ts` `render()`, wrap the `switchField(this.#fields(), "available", …)` block so it renders only for yes/no:

```ts
        ${this.type === "yes-no"
          ? switchField(this.#fields(), "available", t("modifiers.available"), this.available, (value) => { this.available = value; })
          : nothing}
```

In `#save`, set `common.available` to `true` for non-yes/no (the server forces it anyway, but keep the client honest):

```ts
    const common = { name: nonBlankNames(this.name), available: this.type === "yes-no" ? this.available : true };
```

Leave the `willUpdate` initialisation of `this.available` as is (it reads `value?.available ?? true`, harmless for the other types).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/dashboard test modifier-form`
Expected: PASS. Fix any existing test that toggled the modifier-level switch for a non-yes/no type — its behavioural intent moves to the choice-level switch already covered elsewhere.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/modifier-form.ts apps/dashboard/src/widgets/modifier-form.*test.ts
git commit -s -m "Dashboard: keep the modifier-level Available switch only for yes/no

Extras and options are made available per choice; a text modifier is
turned off by detaching it from the product."
```

---

## Task 9: Modifiers screen — header button, remembered table, columns

**Files:**
- Modify: `apps/dashboard/src/screens/modifiers-screen.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (new strings, `en` + `es`)
- Test: `apps/dashboard/src/screens/modifiers-screen.test.ts`, `.a11y.test.ts`

**Interfaces:**
- Consumes: `wt-data-table` (searchable, `viewKey`, `sortKey`, `sortDirection`, per-column `filter`), the modifier form (Task 8).
- Produces: `data-test="create-modifier"` header button; a single `wt-data-table` with `viewKey="waitron.modifiers.table"`, `sortKey="name"`, `sortDirection="ascending"`; a Name column whose cell is a ghost button (`data-test="open-<id>"`); a Type column with a filter; a Choices column; an Actions row menu (`data-test="edit-<id>"`, `data-test="delete-<id>"`). No Available column.

- [ ] **Step 1: Write the failing tests**

Rework `modifiers-screen.test.ts`'s existing "shows searchable rows and opens the shared form" and add:

```ts
it("adds a modifier from a header button with an accessible name", async () => {
  const el = await mount();
  const button = el.shadowRoot!.querySelector<HTMLElement>('[data-test="create-modifier"]')!;
  expect(button.textContent).toContain(t("modifiers.add"));
  button.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!.open).toBe(true);
});

it("configures the table to remember its view and default to Name ascending", async () => {
  const el = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")! as unknown as {
    viewKey: string; sortKey: string; sortDirection: string; searchable: boolean;
  };
  expect(table.viewKey).toBe("waitron.modifiers.table");
  expect(table.sortKey).toBe("name");
  expect(table.sortDirection).toBe("ascending");
  expect(table.searchable).toBe(true);
});

it("has no modifier-level Available column", async () => {
  const el = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")! as unknown as { columns: { key: string }[] };
  expect(table.columns.map((c) => c.key)).toEqual(["name", "type", "choices", "actions"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: FAIL — round `+` button, `wt-input` search, `available` column.

- [ ] **Step 3: Add strings**

In `apps/dashboard/src/i18n/strings.ts`, add to the `en` block (near the other `modifiers.*`), and Spanish equivalents in the `es` block:

```ts
  "modifiers.add": "Add modifier",
  "modifiers.choices": "Choices",
  "modifiers.filter_type_all": "All types",
  "modifiers.no_matches": "No modifiers match your search.",
```
```ts
  "modifiers.add": "Añadir modificador",
  "modifiers.choices": "Opciones",
  "modifiers.filter_type_all": "Todos los tipos",
  "modifiers.no_matches": "Ningún modificador coincide con tu búsqueda.",
```

- [ ] **Step 4: Rebuild the screen's heading, table and columns**

Rewrite the top of `render()` and the columns in `modifiers-screen.ts`. Replace the round add button with a text button and drop the separate `wt-input`; move search into the table. Import `type DataTableColumn` from `@waitron/ui` and add `LocaleChangeController` as categories does if locale reactivity is needed.

Heading:

```ts
    return html`<div class="heading">
        <h1>${t("modifiers.title")}</h1>
        <wt-button data-test="create-modifier" variant="primary" .disabled=${!this.locales} @click=${() => this.#edit(null)}
          >${t("modifiers.add")}</wt-button>
      </div>
```

Columns (replace the current `columns` array):

```ts
    const columns: DataTableColumn<Modifier>[] = [
      {
        key: "name",
        label: t("modifiers.name"),
        searchValue: (m) => this.#name(m),
        sortValue: (m) => this.#name(m),
        cell: (m) => html`<wt-button variant="ghost" data-test=${`open-${m.id}`} @click=${() => this.#openDetails(m)}>${this.#name(m)}</wt-button>`,
      },
      {
        key: "type",
        label: t("modifiers.type"),
        cell: (m) => t(`modifiers.${m.type}`),
        sortValue: (m) => t(`modifiers.${m.type}`),
        filter: {
          label: t("modifiers.type"),
          allLabel: t("modifiers.filter_type_all"),
          value: (m) => m.type,
          options: (["text", "extras", "options", "yes-no"] as const).map((type) => ({ value: type, label: t(`modifiers.${type}`) })),
        },
      },
      {
        key: "choices",
        label: t("modifiers.choices"),
        sortValue: (m) => (m.type === "extras" || m.type === "options" ? m.choices.length : 0),
        cell: (m) => (m.type === "extras" || m.type === "options" ? String(m.choices.length) : ""),
      },
      {
        key: "actions",
        label: t("action.edit"),
        cell: (m) => html`<wt-row-actions label=${`${t("action.edit")}: ${this.#name(m)}`}
          ><wt-button align="start" variant="ghost" data-test=${`edit-${m.id}`} @click=${() => this.#edit(m)}>${t("action.edit")}</wt-button
          ><wt-button align="start" variant="ghost" data-test=${`delete-${m.id}`} @click=${() => this.#openDelete(m)}>${t("action.delete")}</wt-button
          ></wt-row-actions>`,
      },
    ];
```

Table (replaces the `wt-input` + `wt-data-table` block; keep the loading/loadError blocks above it):

```ts
      ${!this.loading && !this.loadError
        ? html`<wt-data-table
            aria-label=${t("modifiers.title")}
            searchable
            searchLabel=${t("modifiers.search")}
            noMatchesMessage=${t("modifiers.no_matches")}
            viewKey="waitron.modifiers.table"
            sortKey="name"
            sortDirection="ascending"
            .rows=${this.modifiers}
            .columns=${columns}
            .rowKey=${(m: Modifier) => m.id}
            .emptyMessage=${t("modifiers.empty")}
          ></wt-data-table>`
        : nothing}
```

Remove the `query` state and the old `#name`-based `.filter(...)`; the table now searches via `searchValue`. Import `wt-modal` (for Tasks 10–11) and remove the now-unused `wt-input`/`wt-icon` imports if nothing else uses them. Add stub `#openDetails` and `#openDelete` that Tasks 10 and 11 flesh out (for this task, `#openDelete` can set `this.deleting = m` as the current code's delete-button handler did; `#openDetails` sets a new `@state() private detailing: Modifier | null`).

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: PASS for the three new tests; keep the existing passive-reload and content-language tests green (adjust selectors from the old `+`/`wt-input` to the new button/table).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/screens/modifiers-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/modifiers-screen.test.ts
git commit -s -m "Dashboard: rebuild the modifiers table on the categories layout

A header Add-modifier button, a full-width searchable table with a type
filter that remembers its sort and filter and defaults to name order,
and a Choices count column in place of the modifier-level Available one."
```

---

## Task 10: Modifiers screen — details modal

**Files:**
- Modify: `apps/dashboard/src/screens/modifiers-screen.ts` (`#openDetails`, a `detailing` state, the modal render, `#name`/effect summaries)
- Modify: `apps/dashboard/src/i18n/strings.ts` (details strings, `en` + `es`)
- Test: `apps/dashboard/src/screens/modifiers-screen.test.ts`, `.a11y.test.ts`

**Interfaces:**
- Consumes: the modifier form's `#edit`.
- Produces: `data-test="details-modal"`; Edit button `data-test="details-edit"` closes details and opens the form; Close `data-test="details-close"`.

- [ ] **Step 1: Write the failing tests**

```ts
it("opens a modifier's details from its name and hands off to Edit", async () => {
  const el = await mount(api({ listModifiers: vi.fn().mockResolvedValue([extrasModifier]) }));
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>(`[data-test="open-${extrasModifier.id}"]`)!.click();
  await el.updateComplete;
  const modal = el.shadowRoot!.querySelector('[data-test="details-modal"]')! as unknown as { open: boolean };
  expect(modal.open).toBe(true);
  expect(el.shadowRoot!.querySelector('[data-test="details-modal"]')!.textContent).toContain("Cheese");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="details-edit"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!.open).toBe(true);
});

it("shows a choice's allergen and dietary summary only when present", async () => {
  // extrasModifier with one choice adding gluten and invalidating vegan, one plain choice.
  // assert the gluten/vegan summary appears for the first, and no empty summary for the second.
});
```

Where `extrasModifier` is an `extras` modifier with two choices (one with `addAllergens: { gluten: { presence: "contains" } }`, `dietaryEffect: { invalidates: ["vegan"] }`; one with `dietaryEffect: { invalidates: [] }`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: FAIL — no details modal.

- [ ] **Step 3: Add strings**

`en`:
```ts
  "modifiers.details": "Modifier details",
  "modifiers.default_choice": "Default choice",
  "modifiers.no_default": "No default",
  "modifiers.adds_allergens": "Adds allergens",
  "modifiers.removes_allergens": "Removes allergens",
  "modifiers.dietary_removed": "No longer suitable for",
```
`es`:
```ts
  "modifiers.details": "Detalles del modificador",
  "modifiers.default_choice": "Opción predeterminada",
  "modifiers.no_default": "Sin predeterminada",
  "modifiers.adds_allergens": "Añade alérgenos",
  "modifiers.removes_allergens": "Elimina alérgenos",
  "modifiers.dietary_removed": "Ya no apto para",
```

- [ ] **Step 4: Implement the details modal**

Add `@state() private detailing: Modifier | null = null;` and:

```ts
  #openDetails(modifier: Modifier): void { this.detailing = modifier; }
```

Render (near the form): a `wt-modal` `data-test="details-modal"` `.open=${this.detailing !== null}`, heading `t("modifiers.details")`, `@wt-close` clearing `detailing`. Body renders, from `this.detailing`: the name per enabled language (reuse `#name` for the default, and list other enabled languages), the type label, and per type — text → `t("modifiers.text_help")`; yes/no → default value + availability; extras/options → required/cap (extras) or default choice (options) + a read-only choices table. For each choice show name, price+tax (extras only), available, preselected/default, and three summary lines shown only when non-empty:

```ts
  #choiceSummary(choice: ModifierChoice) {
    const adds = Object.keys(choice.addAllergens ?? {});
    const removes = choice.removeAllergens ?? [];
    const diet = choice.dietaryEffect?.invalidates ?? [];
    return html`
      ${adds.length ? html`<div>${t("modifiers.adds_allergens")}: ${adds.map((c) => allergenName(c)).join(", ")}</div>` : nothing}
      ${removes.length ? html`<div>${t("modifiers.removes_allergens")}: ${removes.map((c) => allergenName(c)).join(", ")}</div>` : nothing}
      ${diet.length ? html`<div>${t("modifiers.dietary_removed")}: ${diet.map((l) => t(`editor.diet.${l}`)).join(", ")}</div>` : nothing}`;
  }
```

(Import `allergenName` from `../i18n/domain.js`; `ModifierChoice` from `../api/client.js`.) Footer: Edit `data-test="details-edit"` → `this.detailing = null; this.#edit(modifier)`; Close `data-test="details-close"` → `this.detailing = null`. If any cell markup is fed to a `wt-data-table`, style it with `::part()` not a class — but a plain `<table>` inside the modal (as the modifier form uses) avoids that pitfall and is simpler here.

- [ ] **Step 5: Run to verify pass; then look at it**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: PASS. Open the details modal in the dev dashboard, light and dark, phone width; confirm the summaries only show when present.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/screens/modifiers-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/modifiers-screen.test.ts
git commit -s -m "Dashboard: show a modifier's details in a modal opened from its name

Read-only details with the choices and their allergen/dietary summaries
(shown only when a choice sets them), and an Edit button that hands off
to the editor."
```

---

## Task 11: Modifiers screen — delete confirmation with a dependants preview

**Files:**
- Modify: `apps/dashboard/src/screens/modifiers-screen.ts` (`#openDelete`, `#loadDependants`, `#delete`, the delete modal render)
- Modify: `apps/dashboard/src/i18n/strings.ts` (delete strings, `en` + `es`)
- Test: `apps/dashboard/src/screens/modifiers-screen.test.ts`, `.a11y.test.ts`

**Interfaces:**
- Consumes: `DashboardApi.getModifierDependants` (Task 5), `deleteModifier`.
- Produces: `data-test="delete-dialog"`; spinner while loading; `data-test="delete-warning"` red summary; `data-test="modifier-delete-products"` / `-menus` lists; `data-test="orders-block"` line; `data-test="dependants-error"` on a failed read; `data-test="confirm-delete"` disabled until loaded and while `orders > 0`.

- [ ] **Step 1: Write the failing tests**

Mirror the categories delete tests. Cover: loading spinner; loaded with products+menus (warning + lists shown, confirm enabled); orders block (confirm disabled + `orders-block` line); loaded empty (confirm enabled, no warning); read failed (`dependants-error`, confirm disabled); delete failure stays in the dialog; success closes and reloads. Example for the orders block:

```ts
it("blocks deletion while an open order uses the modifier", async () => {
  const client = api({ getModifierDependants: vi.fn().mockResolvedValue({ products: [], menus: [], orders: 2 }) });
  const el = await mount(client);
  openDelete(el, "m");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[data-test="orders-block"]')).not.toBeNull());
  const confirm = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="confirm-delete"]')!;
  expect(confirm.disabled).toBe(true);
});
```

(Keep the existing "identifies a retained-order dependency" test's intent — now expressed as the orders block plus a rejected `deleteModifier` still showing `modifiers.in_use.order`.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: FAIL — the delete dialog has no preview.

- [ ] **Step 3: Add strings**

`en`:
```ts
  "modifiers.delete_named": "Delete {name}",
  "modifiers.delete_warning_intro": "This cannot be undone.",
  "modifiers.delete_warning_products": "{count} product(s) will lose this modifier.",
  "modifiers.delete_warning_menus": "{count} menu item(s) will lose this modifier.",
  "modifiers.delete_orders_block": "An open order uses this modifier. Make its choices unavailable instead, or finish the order first.",
  "modifiers.delete_preview_error": "The delete preview could not be loaded. Try again.",
  "modifiers.affected_products": "Affected products",
  "modifiers.affected_menus": "Affected menu items",
```
`es`:
```ts
  "modifiers.delete_named": "Eliminar {name}",
  "modifiers.delete_warning_intro": "Esta acción no se puede deshacer.",
  "modifiers.delete_warning_products": "{count} producto(s) perderán este modificador.",
  "modifiers.delete_warning_menus": "{count} elemento(s) de menú perderán este modificador.",
  "modifiers.delete_orders_block": "Un pedido abierto usa este modificador. Marca sus opciones como no disponibles o finaliza el pedido primero.",
  "modifiers.delete_preview_error": "No se pudo cargar la vista previa de eliminación. Inténtalo de nuevo.",
  "modifiers.affected_products": "Productos afectados",
  "modifiers.affected_menus": "Elementos de menú afectados",
```

- [ ] **Step 4: Implement the preview and gated delete**

Follow `categories-screen.ts` exactly: add `@state() private dependants: ModifierDependants | null`, `@state() private dependantsError`, a `#deleteGeneration` counter, `#openDelete`, `#closeDelete`, and a generation-guarded `#loadDependants`:

```ts
  #openDelete(modifier: Modifier): void {
    this.error = null; this.dependants = null; this.dependantsError = false;
    this.deleting = modifier;
    const generation = ++this.#deleteGeneration;
    void this.#loadDependants(modifier.id, generation);
  }
  async #loadDependants(id: string, generation: number): Promise<void> {
    try {
      const dependants = await this.api.getModifierDependants(id);
      if (generation === this.#deleteGeneration) this.dependants = dependants;
    } catch {
      if (generation === this.#deleteGeneration) this.dependantsError = true;
    }
  }
```

Delete modal body (`wt-modal data-test="delete-dialog"`, heading `t("modifiers.delete_named").replace("{name}", …)`): spinner until `dependants || dependantsError`; `dependants-error` block on failure; else a red `delete-warning` paragraph built from the intro plus the product/menu count sentences (only those with count > 0), the two lists (`modifier-delete-products`, `modifier-delete-menus`), and, when `dependants.orders > 0`, an `orders-block` line. Confirm button `data-test="confirm-delete"` `.disabled=${this.busy || !this.dependants || this.dependants.orders > 0}`. `#delete` unchanged from the current handler except it reads `this.deleting`; on `modifier.in_use` (`dependency: "order"`) it shows `modifiers.in_use.order` (keep the existing `#message` mapping).

- [ ] **Step 5: Run to verify pass; then look at it**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: PASS (all delete states). Then run the a11y file, and open the dialog in the dev dashboard in both themes at phone width.

- [ ] **Step 6: Run the screen's full suite and coverage**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen choice-form modifier-form allergen-dietary-picker` then, if chasing the dashboard bar, `pnpm --filter @waitron/dashboard test:coverage` scoped as needed (dashboard sits at the `90/90/85/85` floor).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/screens/modifiers-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/modifiers-screen.*test.ts
git commit -s -m "Dashboard: preview a modifier delete and cascade it, blocking on open orders

The delete confirmation lists the products and menu items that would
lose the modifier, blocks while an open order still uses it, and shows
its own error when the preview cannot load."
```

---

## Task 12: Deep link + final look

**Files:**
- Modify: `apps/dashboard/src/screens/modifiers-screen.ts` (`?modifier=<id>` handling in `#load`)
- Test: `apps/dashboard/src/screens/modifiers-screen.test.ts`

**Interfaces:**
- Produces: a `?modifier=<id>` query param opens the editor for that modifier once, then clears the param.

- [ ] **Step 1: Write the failing test**

```ts
it("opens the editor for a ?modifier=<id> deep link and clears the param", async () => {
  history.replaceState(null, "", `/manage/modifiers?modifier=m`);
  const el = await mount();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!.open).toBe(true));
  expect(new URL(location.href).searchParams.get("modifier")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: FAIL — no deep-link handling.

- [ ] **Step 3: Implement the deep link**

In `#load`, after the modifiers list is loaded, copy the categories pattern:

```ts
    const linked = new URL(location.href).searchParams.get("modifier");
    const target = linked ? this.modifiers.find((m) => m.id === linked) : undefined;
    if (target) {
      this.#edit(target);
      const url = new URL(location.href);
      url.searchParams.delete("modifier");
      history.replaceState(null, "", url);
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/dashboard test modifiers-screen`
Expected: PASS.

- [ ] **Step 5: Final cross-screen look**

Start the dev stack from the worktree (`wa-wt demo waitron-modifiers-overhaul`; 2026-09-16 correction — this line originally said the dev till must be enrolled once with the fixed pairing code `DEMO`, which had already been deleted when it was written: device join-and-accept replaced it in #287 on 2026-09-09, and in devMode the till's join request is accepted automatically, so there is no enrolment step). In the dashboard: create an extras modifier with a couple of choices (allergens + dietary via the new picker), a yes/no modifier (toggle its Available), open the details modal, and delete a modifier that a product uses. Confirm the till still shows a product's modifiers. Look in light and dark, phone width.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/screens/modifiers-screen.ts apps/dashboard/src/screens/modifiers-screen.test.ts
git commit -s -m "Dashboard: open a modifier editor from a ?modifier=<id> link

Mirrors the categories deep link, so a link into a specific modifier
opens its editor and then clears the query parameter."
```

---

## Self-Review

**1. Spec coverage.**
- Add-modifier header button → Task 9. ✔
- Full-width search + table filters → Task 9 (table `searchable` + type `filter`). ✔
- Remembered sort/filter, alphabetical first → Task 9 (`viewKey`, `sortKey`/`sortDirection`). ✔
- Name opens a details modal with Edit + Close → Task 10. ✔
- Multi-choice combobox for allergens & dietary → Tasks 6–7. ✔
- Remove contains/may-contain (modifiers) → Task 7 (adapter writes `contains`; no presence UI). ✔
- Remove reviewed toggle; show info only when selected → Tasks 7 (no reviewed) and 10 (summary only when non-empty). ✔
- Remove modifier-level Available except yes/no → Tasks 1 (contract) and 8 (form). ✔
- Delete copies categories, cascades products/menus, refuses on orders → Tasks 3–5, 11. ✔
- Dietary null → no effect (nullable column kept) → Tasks 1–2. ✔
- Menu FK flip decided by a run-it test with a control → Task 3. ✔
- Shared widget reusable by products later → Task 6 (knows nothing of modifiers). ✔

**2. Placeholder scan.** No "TBD/TODO/handle edge cases". The only deliberately open decision is the *second* FK flip in Task 3, which is resolved by running the test (the plan states both branches and the control). The catalogue barrel path and the exact `drizzle-kit generate` script are named as "grep/check `package.json`" lookups, not code placeholders.

**3. Type consistency.** `ModifierDependants` is defined once in `@waitron/catalogue` (Task 4) and mirrored verbatim in the dashboard client (Task 5). `isModifierOffered` has one signature (Task 1) used by the contract and projection. `AllergenDietaryValue` (`{ addAllergens, removeAllergens, dietary }`) is defined in the widget (Task 6) and consumed unchanged in the choice form (Task 7). `dietaryEffect` is `{ invalidates: string[] }` everywhere it is written, never `null`.

---
