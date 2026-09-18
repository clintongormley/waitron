# Modifiers → Extras + Options — Branch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "modifier" concept with two features — Extras (reusable lists of
products, each pick becomes its own sale line) and Options (reusable lists of labels, saved as a note
on the dish line) — composed by a product through one ordered attachment list, and remove the built-in
doneness field and the text modifier.

**Architecture:** Extras name `products` (the one product model gains a `sold_alone` flag), so an
extra owns no price/VAT/allergen/name of its own — it reads the product. Options are pure label lists
with three names each, frozen onto the order line as text. A product's `product_modifiers` table holds
one ordered list, each row pointing at exactly one of an extras list or an options list. The order/sale
path keeps today's parent-dish + child-line expansion; an extra's child line carries `product_id` on
the open order and only frozen facts on the filed sale.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL dialect today; written engine-neutral for the
in-flight SQLite switch), Hono routes, Lit web components (dashboard + till), Vitest (PGlite + real
Postgres via `describeEachTarget`).

**Spec:** `docs/superpowers/specs/2026-09-18-one-product-model-design.md` — read it before any task.
This plan implements **branch 1 only**; variants-as-products is branch 2, a separate plan, after the
SQLite flip.

## Global Constraints

Every task's requirements implicitly include this section.

- **Read `CLAUDE.md` first.** Its §1 (writing claims), §2 (the gate), §3 (conventions), §4 (testing)
  and §5 (fiscal invariants) apply to every task; several tasks exist because of a rule in it.
- **Worktree, never `main`.** This branch's worktree is created with
  `python3 ~/workspace/tools/worktree.py new waitron feat/modifiers-extras-options` (not a plain
  `git worktree add`, which `/land-branch` cannot tear down). Branch name: `feat/modifiers-extras-options`.
- **Every commit needs `git commit -s`.** Plain English in commit messages; exact file, function and
  error-code names appear once as pointers; a command that was run goes in verbatim.
- **TDD, always.** Failing test first, watched failing for the right reason, then the minimal code. A
  test that never failed proves nothing.
- **Engine neutrality (spec §7).** No `pg_advisory_xact_lock` in new code; no JSON containment
  (`@>`); no new `pgEnum`. Use the shared column vocabulary from `@waitron/db` (`id()`, `flag()`,
  `count()`, `money()`, `json()`, `label()`) for every new column, so the SQLite flip's conversions
  cover them. Booleans are `flag()`.
- **No backwards-compatibility or data-migration code.** Waitron is pre-production; schema changes drop
  and recreate (`CLAUDE.md` §3). Migration-number collisions on rebase are fixed by **regeneration**
  (reset the migrations dir to main's state, regenerate, re-run the grant assertions and
  `inmutabilidad`), never by hand-editing snapshots or `_journal.json`.
- **Error codes name the domain concept, never the package** (`extras.*`, `options.*`), are registered
  in `packages/catalogue/src/errors.ts` with English + Spanish alert wording where the code is an
  incident (`scripts/alert-codes.test.ts`), and are **never renamed once shipped**. Retired `modifier.*`
  codes stay registered, left unthrown.
- **The gate per task:** run the focused behavioural tests for what you changed while implementing,
  then `/finish-branch` at the end of the branch runs the local checks once and watches CI. Do not add
  a whole-workspace local run just to finish.
- **The fiscal fingerprint is unrecoverable (spec §14, CLAUDE.md §5).** Any change to how an order or
  sale line is built is gated by the byte-identical huella check in Task 9 — written first.
- **New tables** are classified in `CATALOGUE_CLASSIFICATION`
  (`packages/catalogue/src/classification.ts`) and, if append-only, carry `ENABLE ALWAYS`
  `reject_mutation()` triggers. None of branch 1's tables are append-only (they are `state`).
- **Money is whole cents after the flip**; today it is `numeric(12,2)`. Use `money()`, never a raw
  numeric, so P5 of the SQLite plan converts the new price columns for free.

## File Structure

**New (catalogue package — `packages/catalogue/src/`):**

- `schema/options.ts` — `option_lists`, `option_labels` Drizzle tables.
- `schema/extras.ts` — `extra_lists`, `extra_list_items`, `menu_item_extra_lists`,
  `menu_item_extra_items` Drizzle tables. `product_modifiers` also lives here.
- `options.ts` — options list CRUD (`listOptionLists`, `getOptionList`, `createOptionList`,
  `updateOptionList`, `deleteOptionList`, `optionListDependants`).
- `extras.ts` — extras list CRUD + price/VAT resolution (`listExtraLists`, `getExtraList`,
  `createExtraList`, `updateExtraList`, `deleteExtraList`, `extraListDependants`, `resolveExtraPrice`).
- `option-contract.ts`, `extra-contract.ts` — pure validators (parse an authoring body; validate an
  order's selections), the split heirs of `modifier-contract.ts`.
- `product-modifiers.ts` — read/write of a product's ordered attachment list.

**New (shared — `packages/shared/src/`):**

- `option-selection.ts` — the frozen options snapshot type (`OptionSnapshot`) and the order-selection
  wire type.
- `extra-selection.ts` — the extras order-selection wire type.

**Modified:**

- `packages/db/src/schema/catalogue.ts` — add `sold_alone` to `products`; remove the `option_groups`
  family in Task 12.
- `packages/db/src/schema/orders.ts`, `sales.ts` — replace `modifier_snapshots` with the options
  snapshot column; the extras child line gains nothing new on filed `sale_lines` (frozen name already
  present), and on `working_order_lines` its `option_group_item_id` becomes `product_id`; remove
  `doneness`.
- `packages/db/src/schema/ticket-items.ts` — remove `doneness`.
- `apps/server/src/catalogue-api.ts`, `working-order.ts`, `modifier-selection.ts`,
  `kitchen-ticket.ts`, `kitchen-print.ts`, `receipt-lines.ts`, `receipt-ticket.ts` — routes and the
  order/sale path.
- `apps/dashboard/src/screens/modifiers-screen.ts`, `widgets/product-editor.ts`,
  `widgets/product-list.ts` and new `widgets/extra-list-form.ts`, `widgets/option-list-form.ts`.
- `apps/till/src/widgets/modifier-picker.ts`, `line-extras-editor.ts`, `basket.ts` and the expo/ticket
  views.
- `docs/developers/modifiers.md` — rewritten; `docs/backlog.md` — reconciled.

**Removed (Task 12):** `packages/catalogue/src/{modifiers,modifier-contract,modifier-projection,modifier-lock,modifier-limits}.ts`
(the parts not carried into the new contracts), `apps/dashboard/src/widgets/choice-form.ts`,
`apps/dashboard/src/widgets/option-group-manager.ts`, `packages/shared/src/modifier-snapshots.ts`.

---

## Task 1: Products gain `sold_alone`

**Files:**

- Modify: `packages/db/src/schema/catalogue.ts` (the `products` table)
- Modify: `packages/catalogue/src/product-types.ts` (`Product`, `ProductEditorInput`, `ProductEditorValue`)
- Modify: `packages/catalogue/src/operations.ts` (product read), `product-editor.ts` (editor read/write),
  `product-editor-input.ts` (body screen)
- Test: `packages/catalogue/src/product-editor-input.test.ts`, `operations.test.ts`

**Interfaces:**

- Produces: `products.sold_alone` (boolean, NOT NULL DEFAULT true); `Product.soldAlone: boolean`;
  `ProductEditorInput.soldAlone: boolean`.

- [ ] **Step 1: Write the failing test** — in `product-editor-input.test.ts`, assert
      `parseProductEditorInput` accepts `soldAlone: false` and returns it, defaults it to `true` when
      absent, and rejects a non-boolean with `management.request_invalid` naming field `soldAlone`.

```ts
it("carries soldAlone through, defaulting to true", () => {
  expect(parseProductEditorInput({ ...validBody, soldAlone: false }).soldAlone).toBe(false);
  expect(parseProductEditorInput(validBody).soldAlone).toBe(true);
});
it("rejects a non-boolean soldAlone", () => {
  expect(() => parseProductEditorInput({ ...validBody, soldAlone: 1 })).toThrow(
    expect.objectContaining({ code: "management.request_invalid", params: { field: "soldAlone" } }),
  );
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/catalogue test product-editor-input`; expect a type/undefined failure.

- [ ] **Step 3: Add the column** — in `catalogue.ts`, add to `products`:

```ts
soldAlone: flag("sold_alone").notNull().default(true),
```

Add a comment stating the invariant: a product with `sold_alone = false` is a full product (price,
VAT, allergens, category, unit) that is never offered standalone — only referenced (extras, later
recipes). Do NOT reference "modifier" — this column outlives that word.

- [ ] **Step 4: Regenerate the core migration** — `products` is in the core set. Follow
      `CLAUDE.md` §3: `pnpm --filter @waitron/db db:generate` (the repo's generate script), verify the
      generated SQL adds the column, and run the grant assertions + `inmutabilidad` afterwards. If a
      journal collision appears on rebase, reset the migrations dir to main's state and regenerate.

- [ ] **Step 5: Thread through the type and read/write** — add `soldAlone` to `Product`,
      `ProductEditorInput`, `ProductEditorValue` in `product-types.ts`; select it in the product read
      in `operations.ts`; screen it in `parseProductEditorInput` (default `true`, boolean-or-throw
      `management.request_invalid` field `soldAlone`); persist it in `product-editor.ts`'s write.

- [ ] **Step 6: Run the tests and watch them pass** — `pnpm --filter @waitron/catalogue test product-editor-input operations`.

- [ ] **Step 7: Commit** — `git add -p && git commit -s -m "Add a sold-alone flag to products"`.

---

## Task 2: Options — data model and contract

**Files:**

- Create: `packages/catalogue/src/schema/options.ts`, `option-contract.ts`, `options.ts`
- Modify: `packages/catalogue/src/classification.ts` (classify the two tables), `index.ts` (exports),
  `errors.ts` (codes)
- Modify: `packages/shared/src/option-selection.ts` (create), `index.ts` (export)
- Test: `option-contract.test.ts`, `options.pg.test.ts`

**Interfaces:**

- Produces:
  - Tables `option_lists` (`id`, `name`, `customer_name`, `kitchen_name`, `default_label_id`, `sort`,
    `active`) and `option_labels` (`id`, `list_id`, `name`, `customer_name`, `kitchen_name`,
    `available`, `sort`).
  - `interface OptionList { id; name; customerName; kitchenName; defaultLabelId: string | null;
    labels: OptionLabel[] }` and `OptionLabel { id; name; customerName; kitchenName; available }`
    (three names = `name: string`, `customerName: Record<string,string> | null`, `kitchenName: string | null`).
  - `interface OptionListInput` (same, labels carry an optional `id` on the way in).
  - `parseOptionListInput(value: unknown): OptionListInput` — validator.
  - `validateOptionSelections(lists: readonly OptionList[], value: unknown): OptionSelection[]` where
    `OptionSelection = { listId: string; labelId: string }`.
  - CRUD: `listOptionLists`, `getOptionList`, `createOptionList`, `updateOptionList`,
    `deleteOptionList`, `optionListDependants` — all `(tx, …)`.
  - Shared `OptionSnapshot` (spec §2.3) and the wire `OptionSelection` in
    `packages/shared/src/option-selection.ts`.

- [ ] **Step 1: Write the failing contract test** — in `option-contract.test.ts`:

```ts
it("requires a staff name on the list and each label, and rejects an unknown key", () => {
  expect(() => parseOptionListInput({ name: "", labels: [] })).toThrow(/options\.invalid/);
});
it("normalises customer/kitchen names and keeps label order", () => {
  const input = parseOptionListInput({
    name: "Cooked",
    customerName: { en: "How cooked?", es: "¿Punto?" },
    kitchenName: "Cook",
    defaultLabelId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    labels: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Medium rare",
        customerName: { es: "Al punto" }, kitchenName: "MR", available: true },
    ],
  });
  expect(input.defaultLabelId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  expect(input.labels[0].kitchenName).toBe("MR");
});
it("rejects a defaultLabelId that names no label", () => { /* expect options.invalid */ });
it("validateOptionSelections requires exactly one pick and rejects an unavailable label", () => { /* … */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/catalogue test option-contract`.

- [ ] **Step 3: Write the tables** — `schema/options.ts`, using the shared vocabulary. `default_label_id`
      is a nullable `id` (no FK to `option_labels` to avoid a circular-create ordering problem; the
      contract validates it names a label of the list, mirroring today's `option_groups.default_choice_id`).
      `option_labels.list_id` FK → `option_lists.id` ON DELETE CASCADE. Add indexes on `(list_id, sort)`.

- [ ] **Step 4: Write the contract** — `parseOptionListInput` and `validateOptionSelections` in
      `option-contract.ts`, following the shape of `modifier-contract.ts` (the `label`/`record`/`keys`/`id`
      helpers) but with three names at both levels and no price/VAT/allergen fields. An options list is
      always "pick exactly one, default preselected".

- [ ] **Step 5: Write the snapshot + selection wire types** — `packages/shared/src/option-selection.ts`:

```ts
export type OptionSelection = { listId: string; labelId: string };
export type OptionSnapshot = {
  listName: Record<string, string>; listCustomerName: Record<string, string> | null; listKitchenName: string | null;
  labelName: Record<string, string>; labelCustomerName: Record<string, string> | null; labelKitchenName: string | null;
};
```

Export from `packages/shared/src/index.ts`.

- [ ] **Step 6: Write CRUD** — `options.ts`. `createOptionList`/`updateOptionList` validate content
      translations (`validateContentTranslations`) for every name; write list + labels in one
      transaction; `deleteOptionList` cascades labels and the `product_modifiers` rows that name it
      (Task 6 adds that table; for now delete cascades labels only and the product-attachment cascade
      is completed in Task 6). No advisory lock, no order check (spec §2.3). `optionListDependants`
      returns the products and menus that reference it (products via `product_modifiers`, once Task 6
      lands; return empty until then).

- [ ] **Step 7: Classify + register errors** — add `classify("option_lists", "state", STATE)` and
      `classify("option_labels", "state", STATE)` to `CATALOGUE_CLASSIFICATION`. Register
      `options.invalid: { field: string }` and `options.not_found: { optionListId: string }` and
      `options.in_use: { optionListId: string; dependency: string }` in `errors.ts`.

- [ ] **Step 8: Write the PGlite CRUD test** — `options.pg.test.ts` using `usePgliteDb`: create → read
      back three names and label order; update relabels and reorders; delete cascades labels. Rejected
      writes assert the domain code, not `toBeInstanceOf(Error)`.

- [ ] **Step 9: Run and commit** — `pnpm --filter @waitron/catalogue test option`; then
      `git commit -s -m "Add option lists: reusable label lists with three names each"`.

---

## Task 3: Options — API routes

**Files:**

- Modify: `apps/server/src/catalogue-api.ts`, `apps/server/src/errors.ts` (status mapping)
- Test: `apps/server/src/catalogue-api.test.ts` (or the modifier route test it replaces)

**Interfaces:**

- Produces: `GET /management-api/modifiers/options`, `POST` (201), `GET/PATCH/DELETE
  /management-api/modifiers/options/:id`, `GET /management-api/modifiers/options/:id/dependants`.
  Responses `{ optionLists }` / `{ optionList }` / `{ ok: true }` / the dependants preview.

- [ ] **Step 1: Write the failing route test** — POST creates and returns 201 with the normalized
      list; GET lists; PATCH replaces; DELETE returns `{ ok: true }`; an invalid body returns 400
      `options.invalid`. Use the existing catalogue-api test harness (a management session + `gated`).

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Add the routes** — mirror the existing `/management-api/modifiers` block
      (`catalogue-api.ts:427-471`), calling the Task 2 CRUD. Map `options.invalid` → 400,
      `options.not_found` → 404, `options.in_use` → 409 in `apps/server/src/errors.ts`.

- [ ] **Step 4: Run and commit** — `git commit -s -m "Serve option lists over the management API"`.

---

## Task 4: Extras — data model, contract, price/VAT resolution

**Files:**

- Create: `packages/catalogue/src/schema/extras.ts` (`extra_lists`, `extra_list_items`),
  `extra-contract.ts`, `extras.ts`
- Modify: `classification.ts`, `index.ts`, `errors.ts`, `packages/shared/src/extra-selection.ts` (create)
- Test: `extra-contract.test.ts`, `extras.pg.test.ts`

**Interfaces:**

- Produces:
  - `extra_lists` (`id`, `name`, `customer_name`, `kitchen_name`, `min_picks`, `max_picks`, `sort`,
    `active`); `extra_list_items` (`id`, `list_id` FK cascade, `product_id` FK restrict, `sort`,
    `max_quantity` default 1 check `>= 1`, `preselected`, `price` money nullable).
  - `interface ExtraList { id; name; customerName; kitchenName; minPicks: number; maxPicks: number | null;
    items: ExtraListItem[] }`; `ExtraListItem { id; productId; maxQuantity; preselected; price: string | null }`.
  - `parseExtraListInput(value): ExtraListInput`.
  - `validateExtraSelections(lists, value): ExtraSelection[]` where
    `ExtraSelection = { listId: string; picks: { productId: string; quantity: number }[] }`.
  - `resolveExtraPrice(item: ExtraListItem, product: { unitPrice: string }, menuPrice?: string | null): string`
    — the spec §3.3 order: menu → item → product.
  - Shared `ExtraSelection` wire type in `extra-selection.ts`.

- [ ] **Step 1: Write the failing contract test** — `extra-contract.test.ts`:

```ts
it("requires min_picks<=max_picks and max_quantity>=1", () => { /* expect extras.invalid */ });
it("validateExtraSelections enforces min/max total picks and per-item max_quantity", () => { /* … */ });
it("rejects a pick naming a product the list does not offer", () => { /* extras.invalid */ });
```

Plus a resolution test:

```ts
it("resolveExtraPrice takes menu over item over product", () => {
  const item = { id: "…", productId: "p", maxQuantity: 1, preselected: false, price: "1.50" };
  expect(resolveExtraPrice(item, { unitPrice: "3.00" })).toBe("1.50");
  expect(resolveExtraPrice({ ...item, price: null }, { unitPrice: "3.00" })).toBe("3.00");
  expect(resolveExtraPrice(item, { unitPrice: "3.00" }, "1.00")).toBe("1.00");
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Write the tables** (`schema/extras.ts`), the shared vocabulary; `price` is `money().$type<…>()`
      nullable. Add the `extra_list_items_qty_ck` check (`max_quantity >= 1`) and a `min_picks/max_picks`
      check (`max_picks is null or max_picks >= min_picks`, `min_picks >= 0`).

- [ ] **Step 4: Write the contract** (`extra-contract.ts`) and `resolveExtraPrice` (in `extras.ts`),
      following `modifier-contract.ts`'s helpers. VAT is not on the item — the resolver reads it from
      the product later (Task 8), so the contract does not touch VAT.

- [ ] **Step 5: Write CRUD** (`extras.ts`): `create/update/deleteExtraList`, `getExtraList`,
      `listExtraLists`, `extraListDependants`. `deleteExtraList` cascades items and (Task 6) product
      attachments and menu rows; a **product** delete is refused with `product.in_use` when an extras
      list names it — add that check to the product delete path in `operations.ts` (extend the existing
      menu-usage refusal). No advisory lock; no JSON containment.

- [ ] **Step 6: Classify + errors** — classify the two tables `state`; register
      `extras.invalid: { field }`, `extras.not_found: { extraListId }`,
      `extras.in_use: { extraListId; dependency }`, `extras.limit_exceeded: { listId }`.

- [ ] **Step 7: Write the PGlite test** (`extras.pg.test.ts`) — create with two products at different
      prices; read back; the "exactly one bread" shape (`min_picks=1, max_picks=1`); delete cascades
      items; `product.in_use` when a list names a product being deleted.

- [ ] **Step 8: Run and commit** — `git commit -s -m "Add extra lists: reusable product lists with per-role pricing"`.

---

## Task 5: Extras — per-menu publication

**Files:**

- Modify: `packages/catalogue/src/schema/extras.ts` (add `menu_item_extra_lists`, `menu_item_extra_items`),
  `extras.ts` (publication read/write), `classification.ts`, `modifier-projection.ts` heir
- Test: `extras.pg.test.ts`, a menu-projection test

**Interfaces:**

- Produces: `menu_item_extra_lists` (`menu_item_id`, `list_id`, `display_order`),
  `menu_item_extra_items` (`menu_item_id`, `list_id`, `product_id`, `price` money nullable, `available`);
  `readMenuExtras(tx, menuItemIds): Map<string, ExtraList[]>` and `readProductExtras(tx, productIds)`
  (the heirs of `readMenuModifiers`/`readProductModifiers` in `modifier-projection.ts`).

- [ ] **Step 1: Write the failing test** — publishing a dish's extras list narrows items and reprices;
      `readMenuExtras` returns the published price (menu → item → product) and drops unpublished items;
      `readProductExtras` returns the product-default view.

- [ ] **Step 2–4: Tables, then the projection reads**, mirroring `modifier-projection.ts` but keyed on
      `product_id` instead of `option_id`, and using `resolveExtraPrice`. Classify both new tables.

- [ ] **Step 5: Run and commit** — `git commit -s -m "Publish extra lists per menu with per-offer prices"`.

---

## Task 6: Extras — API routes; `product_modifiers` attachment; product read/write

**Files:**

- Create: `packages/catalogue/src/product-modifiers.ts`; add `product_modifiers` to `schema/extras.ts`
- Modify: `apps/server/src/catalogue-api.ts`, `apps/server/src/errors.ts`,
  `packages/catalogue/src/{operations.ts,product-editor.ts,product-editor-input.ts,product-types.ts}`
- Test: catalogue-api route test; `product-modifiers.pg.test.ts`; `product-editor-input.test.ts`

**Interfaces:**

- Produces:
  - Table `product_modifiers` (`product_id` FK cascade, `sort`, `extra_list_id` FK nullable,
    `option_list_id` FK nullable, check `num_nonnulls(extra_list_id, option_list_id) = 1`).
  - `readProductModifiers(tx, productIds): Map<string, ProductModifierRef[]>` where
    `ProductModifierRef = { kind: "extras" | "options"; id: string }`.
  - `writeProductModifiers(tx, productId, refs: ProductModifierRef[])`.
  - Product body field `modifiers: { kind: "extras" | "options"; id: string }[]` (replacing
    `modifierIds`/`optionGroupIds`); `Product.modifiers: ProductModifierRef[]`.
  - Routes `GET/POST/.../modifiers/extras`, `.../modifiers/extras/:id` (GET/PATCH/DELETE),
    `.../modifiers/extras/:id/dependants`.

- [ ] **Step 1: Write the failing tests** — (a) the attachment table's "exactly one of" check rejects a
      row with both or neither reference; (b) `parseProductEditorInput` accepts an ordered
      `modifiers: [{kind,id}]`, rejects a bad `kind` and a non-uuid id with `management.request_invalid`
      field `modifiers`, and rejects sending the legacy `modifierIds`/`optionGroupIds` alongside it; (c)
      the extras routes CRUD.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Add `product_modifiers`** and `product-modifiers.ts` read/write. Attachment ordering by
      `sort`. `deleteExtraList`/`deleteOptionList` now cascade their rows here (complete the Task 2/4
      cascades). `extraListDependants`/`optionListDependants` now read products through this table.

- [ ] **Step 4: Replace `modifierIds` in the product body** — in `product-editor-input.ts`, remove the
      `screenOptionGroupIds`/`modifierIds` screen, add a `modifiers` screen validating an ordered array
      of `{ kind: "extras"|"options", id: uuid }`, reject either legacy field. Persist via
      `writeProductModifiers` in the same transaction as the product write (`product-editor.ts`). Read
      via `readProductModifiers` in `operations.ts`; add `modifiers` to `Product`/`ProductEditorValue`.

- [ ] **Step 5: Add the extras routes** — mirror Task 3. Map `extras.*` statuses in
      `apps/server/src/errors.ts`.

- [ ] **Step 6: Run and commit** — `pnpm --filter @waitron/catalogue test`; then
      `git commit -s -m "Attach extras and options to a product through one ordered list"`.

---

## Task 7: Order path — validate and snapshot extras + options selections

**Files:**

- Modify: `apps/server/src/modifier-selection.ts` (rewrite), `apps/server/src/working-order.ts`
  (line building), `packages/db/src/schema/orders.ts` (columns)
- Test: `apps/server/src/modifier-selection.test.ts` (rewrite), `working-order.test.ts`

**Interfaces:**

- Consumes: `validateExtraSelections`, `validateOptionSelections`, `readProductExtras`,
  `readMenuExtras`, `readProductModifiers`, `resolveExtraPrice`.
- Produces:
  - `working_order_lines`: `option_snapshots` (json `OptionSnapshot[]`, default `[]`) replaces
    `modifier_snapshots`; the child modifier line's `option_group_item_id` becomes `product_id`
    (nullable; the extra's product).
  - `buildLineExtras(tx, …): { extraChildren: …; optionSnapshots: OptionSnapshot[] }` — the heir of
    `snapshotSelections`.
  - Wire per requested line: `extras: ExtraSelection[]`, `options: OptionSelection[]` (replacing
    `modifierSelections`).

- [ ] **Step 1: Write the failing test** — an order line with an options answer freezes all six names
      into `option_snapshots`; an extras pick becomes a child line carrying `product_id`, the product's
      frozen three names, `quantity = dish × picks`, the resolved price and **the product's own VAT
      rate** (fixture: a 21% wine as an extra on a 10% dish → child VAT 21%). A required options list
      with no answer, and an extras `min_picks` violation, are rejected with the domain code.

```ts
it("freezes six option names onto the line", async () => { /* assert option_snapshots row */ });
it("an extra child line carries product_id and the product's own VAT", async () => {
  // dish vat 10%, wine product vat 21%; assert child.vatRate === "21.00" and child.productId === wineId
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Add/rename the columns** in `orders.ts`; regenerate the core migration
      (`CLAUDE.md` §3). Remove `modifier_snapshots` and the child `option_group_item_id`.

- [ ] **Step 4: Rewrite `modifier-selection.ts`** as `buildLineExtras`: validate `options` →
      `OptionSnapshot[]` (reading the list + chosen label's three names from the resolved definitions);
      validate `extras` → child rows, each carrying `product_id`, the product's three names, the
      resolved price and the product's `vat_class`. No `@>`; no advisory lock.

- [ ] **Step 5: Wire into `working-order.ts`** — replace the `modifierSelections` handling in the
      parent/child expansion; the parent line stores `option_snapshots`, each extra becomes a child
      line (the existing child-line insert path, now keyed by `product_id`).

- [ ] **Step 6: Run and commit** — `pnpm --filter @waitron/server test working-order modifier-selection`;
      then `git commit -s -m "Validate and freeze extras and options onto an order line"`.

---

## Task 8: Held orders, quantity-only updates, compare-by-values

**Files:**

- Modify: `apps/server/src/working-order.ts` (held read, quantity-only update),
  `apps/server/src/modifier-selection.ts` (`sameSelections` heir)
- Test: `apps/server/src/modifier-selection.test.ts`, `working-order.test.ts`

**Interfaces:**

- Produces: `sameExtraSelections(value, childLines)` and `sameOptionSelections(value, snapshots)` —
  compare by values, order-independent (the heir of `sameModifierSelections`, guarding
  `apps/server/src/modifier-selection.test.ts`).

- [ ] **Step 1: Write the failing test** — a quantity-only update on a held line preserves the frozen
      extras child prices and option snapshots; a reordered-but-equal selection compares equal; a
      changed answer takes the new-validation path; a duplicate pick differs.

- [ ] **Step 2–4:** implement the two comparators (compare by values, never JSON key/order — the
      standing guard), wire the held read and quantity-only update to use them.

- [ ] **Step 5: Run and commit** — `git commit -s -m "Preserve frozen extras and options on held-order updates"`.

---

## Task 9: The fiscal fingerprint gate + the filed sale line

**Files:**

- Modify: `packages/core/src/record-sale.ts`, `packages/core/src/sale-line-rows.ts`,
  `packages/db/src/schema/sales.ts`
- Test: `packages/core/src/record-sale.test.ts` (or the fiscal fixture test), the shared alta fixture

**Interfaces:**

- Produces: `sale_lines.option_snapshots` (json, default `[]`) replaces `modifier_snapshots`; the extra
  child line on a filed sale carries the frozen three names + quantity + price + VAT and **no
  `product_id`** (spec §3.4, decision 11; architecture §6).

- [ ] **Step 1: Write the fiscal test FIRST** — the shared alta fixture sale (with an extra child line
      and an options answer) produces **byte-identical** `CuotaTotal`, `ImporteTotal` and huella to a
      recorded golden value. This is the unrecoverable gate (CLAUDE.md §5, spec §14). "Passes the
      validator" is not enough — assert the exact strings.

```ts
it("the alta fixture huella is unchanged by the extras/options rework", async () => {
  const { huella, importeTotal, cuotaTotal } = await recordSaleAndFile(fixtureWithExtraAndOption);
  expect({ huella, importeTotal, cuotaTotal }).toEqual(GOLDEN); // recorded from main before the change
});
```

- [ ] **Step 2: Record the golden value** on `main`'s current behaviour for the equivalent fixture (a
      dish + priced extra + options answer), so the test asserts "unchanged", not a guess. Note in the
      test comment the command that produced it.

- [ ] **Step 3: Run and watch it fail** on the branch (the line shapes have changed).

- [ ] **Step 4: Update `sale-line-rows.ts` / `record-sale.ts`** — carry the extra child line's frozen
      facts (no `product_id`), the parent's `option_snapshots`; drop `modifier_snapshots`. The fiscal
      record is still built from `total` + `vat_breakdown`, never from `sale_lines` (design §4), so the
      arithmetic must land identically.

- [ ] **Step 5: Run the fiscal test and watch it pass**, plus the whole `@waitron/core` and
      `@waitron/fiscal-verifactu` suites (`test:coverage`) since the sale line shape is shared.

- [ ] **Step 6: Commit** — `git commit -s -m "File extras as snapshot-only child lines, huella unchanged"`.

---

## Task 10: Remove doneness end to end; seed a "Cooked" options list

**Files:**

- Modify: `packages/db/src/schema/orders.ts`, `ticket-items.ts` (remove `doneness`),
  `apps/server/src/working-order.ts` (remove `invalid_doneness`), `kitchen-ticket.ts`,
  `apps/till/src/widgets/line-extras-editor.ts` and callers; `apps/server/scripts/demo-seed/*`
- Test: the demo-seed test, kitchen-ticket test

- [ ] **Step 1: Write the failing test** — the demo seed builds a "Cooked" options list (three
      different names per label) attached to the meat dishes; a kitchen ticket for a steak prints the
      chosen label's **kitchen** name; no `doneness` field remains (a grep guard or a type check).

- [ ] **Step 2–4:** remove the `doneness` pgEnum, the columns, `DONENESS`, `working_order.invalid_doneness`
      and its validation, the ticket line, and the meat-gated `<select>`; regenerate the core migration;
      add the seed list.

- [ ] **Step 5: Run and commit** — `git commit -s -m "Replace the built-in doneness field with an options list"`.

---

## Task 11: Dashboard — Extras and Options tabs, product editor, products list

**Files:**

- Modify: `apps/dashboard/src/screens/modifiers-screen.ts` (two tabs),
  `apps/dashboard/src/widgets/product-editor.ts` (Modifiers section), `product-list.ts` (sold_alone
  column + filter)
- Create: `apps/dashboard/src/widgets/extra-list-form.ts`, `option-list-form.ts`
- Modify: `apps/dashboard/src/api/client.ts`, `i18n/{codes,strings}.ts`
- Test: `*.test.ts` beside each widget; `*.a11y.test.ts` for both new forms

**Interfaces:**

- Consumes: the Task 3/6 routes; the wire types.
- Produces: the two forms emitting `wt-submit` with `{ value: OptionListInput | ExtraListInput }`; the
  product editor's Modifiers section emitting the ordered `modifiers` list.

- [ ] **Step 1: Write the failing a11y + behaviour tests** — each form: a token-painting test and an
      axe test in both themes covering each state (the `wt-*` two-test rule); the extras form is a
      product picker showing each product's price with the **inheritance-hint** pattern (§9.1) — a blank
      price field shows the product's own price as placeholder; the options form edits labels with three
      names and a default; the product editor's Modifiers section lists both kinds in one ordered list.

- [ ] **Step 2–4:** build the forms and screen tabs on the Categories pattern (header Add button,
      search with filters, remembered sort, detail modal, delete-with-dependants). Custom events are
      `wt-*`, `bubbles+composed`, the triggering event stopped before re-emitting. Cells handed to
      `wt-data-table` are styled with `part=`/`::part()`, never a CSS class. A product created inside an
      extras list starts `soldAlone=false`.

- [ ] **Step 5: LOOK at it** — render both tabs, both forms and the product editor at phone width in
      both themes with the workspace playwright Chromium (the "open it and LOOK" rule; a browser-mode
      package has the harness).

- [ ] **Step 6: Run and commit** — `git commit -s -m "Split the modifiers screen into Extras and Options tabs"`.

---

## Task 12: Till — picker, basket, kitchen/expo, receipt

**Files:**

- Modify: `apps/till/src/widgets/modifier-picker.ts`, `line-extras-editor.ts`, `basket.ts`,
  `modifier-snapshot.ts`, `dish-format.ts`, `screens/till-expo-screen.ts`, `till-ticket-view.ts`,
  `apps/server/src/{kitchen-ticket,kitchen-print,receipt-lines,receipt-ticket}.ts`; `apps/till/src/api/client.ts`
- Test: the till widget tests, `apps/server` ticket/receipt tests

- [ ] **Step 1: Write the failing tests** — the picker walks a dish's `product_modifiers` in order,
      drawing the extras widget (quantity steppers with resolved prices) or an options radio group
      (default preselected); the basket shows extras as child lines and the option answers as the
      **staff** names; a kitchen ticket shows extras + option **kitchen** names; a receipt shows extras
      + option **customer** names (three-different-text fixtures so a wrong-name read fails).

- [ ] **Step 2–4:** implement; the per-line `note` stays; the doneness `<select>` is gone (Task 10).

- [ ] **Step 5: LOOK at it** — the till is browser-mode; render the picker and basket in both themes.

- [ ] **Step 6: Run and commit** — `git commit -s -m "Draw extras and options on the till, tickets and receipts"`.

---

## Task 13: Remove the old modifier machinery; docs; backlog

**Files:**

- Remove: `packages/catalogue/src/{modifier-lock,modifier-projection}.ts`, the retired parts of
  `{modifiers,modifier-contract,modifier-limits}.ts`, `packages/shared/src/modifier-snapshots.ts`,
  `apps/dashboard/src/widgets/{choice-form,option-group-manager}.ts`
- Remove tables: `option_groups`, `option_group_items`, `product_option_groups`,
  `menu_item_option_groups`, `menu_item_options` (`packages/db/src/schema/catalogue.ts`,
  `packages/catalogue/src/schema/menu.ts`); drop from `CATALOGUE_CLASSIFICATION`
- Modify: `docs/developers/modifiers.md` (rewrite), `docs/backlog.md` (reconcile the modifier entries)
- Test: the guards (`errors-reachable`, `english-only`, `alert-codes`, `classification-complete`,
  `live-subscriptions`, `module-seams`, `no-hardcoded-chrome`, `claude-md-pointers`)

- [ ] **Step 1: Delete the dead code and tables** — grep for every remaining importer first
      (`grep -rn "option_groups\|optionGroupIds\|modifierSelections\|ModifierSnapshot\|modifier-lock"`),
      confirm each is gone, then remove. Regenerate the core + catalogue migrations.

- [ ] **Step 2: Rewrite `docs/developers/modifiers.md`** — describe Extras and Options as the two
      features under the one Modifiers screen, the wire shapes, the frozen snapshots, and the price/VAT
      resolution. Kept as one file (spec decision 5), not split.

- [ ] **Step 3: Reconcile `docs/backlog.md`** — update the modifier entries to what shipped; note the
      two open items (optional options list; per-variant attachments deferred to branch 2), and that
      branch 2 (variants-as-products) is the next slice.

- [ ] **Step 4: Run every guard** — `npx vitest run` at the repo root for the root-project guards, plus
      the changed packages' `test:coverage`. Prove any new guard by deletion.

- [ ] **Step 5: Commit** — `git commit -s -m "Remove the old modifier tables, widgets and docs"`.

---

## Finish

- [ ] Run focused behavioural checks for the changed packages, then `/finish-branch` (full ceremony —
      this branch touches fiscal invariants and a cross-package contract). The fresh-context
      plan-vs-spec read and the Codex run-it seat run on every branch and are never cut.
- [ ] Confirm the current-head CI scope selected `@waitron/catalogue @waitron/shared @waitron/db
      @waitron/core @waitron/server @waitron/dashboard @waitron/till` (the genuinely changed packages)
      and is green before announcing readiness to land.
- [ ] Announce readiness to run `finish-branch`, then wait for the owner's approval to `/land-branch`.

## Self-Review notes

- **Spec coverage:** §1 sold_alone → Task 1; §2 Options → Tasks 2–3, 7, 9, 11, 12; §3 Extras → Tasks
  4–6, 7, 9, 11, 12; §5 attachment → Task 6; §7 engine neutrality → Global Constraints + every schema
  task; §8 deletions → Tasks 10, 13; §9 dashboard + §9.1 hint → Task 11; §10 till → Task 12; §11 API +
  codes → Tasks 3, 6; §12 testing → each task's tests + Task 9 fiscal gate; §2.4 doneness → Task 10.
  §4/§6 (variants, reporting) are branch 2 — out of scope, correctly absent.
- **Engine neutrality** is a global constraint and re-stated on every schema task.
- **Type consistency:** `ProductModifierRef { kind; id }`, `OptionSelection { listId; labelId }`,
  `ExtraSelection { listId; picks[] }`, `OptionSnapshot` (six names) are defined once (Tasks 2, 4, 6)
  and consumed by the same names in Tasks 7–12.
