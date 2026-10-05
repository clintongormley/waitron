# One product colour everywhere (W92) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Every task is test-first: write the failing test, run it and watch it
> fail for the reason you expect, then write the least code that passes. This branch adds two
> migrations and changes a cross-package contract (the published menu document's `FrozenOffer` and
> `LiveOffer`, read by the till and the dashboard), so it takes the **FULL review path**: a per-task
> reviewer, then `/finish-branch` with two Codex run-it reviews.

**Goal:** categories and products get an optional colour; a product's effective colour (own, else its
category's or the nearest coloured category above, else none) is frozen into each published menu
and painted on the till's tiles; the dashboard edits it from the Products tree, the product editor
and Menu Structure.

**Architecture:** one pure rule (`packages/catalogue/src/color-inheritance.ts`) used by the server's
document builder and by the dashboard. Storage is two nullable columns added without a rebuild.
Colour is frozen content of a published version, never a live field.

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, drizzle-kit 0.31.11, Hono, Lit, Vitest 4
(browser mode for `@waitron/dashboard` and `@waitron/till`).

**Spec:** `docs/superpowers/specs/2026-10-05-w92-product-colours-design.md`, and the owner's queue
item W92 quoted in it. Read the spec's Decisions before any task.

## Global constraints

- A stored colour is lowercase `#rrggbb` or null; `""` is refused, never read as null. No CHECK
  constraint on either new column.
- `color` is OPTIONAL on `FrozenOffer`, `LiveOffer` and `TillProduct` (`color?: string | null`), as
  `ordering` is (`PublishedOrdering`, `packages/catalogue/src/menu-document-types.ts:31-33`): a
  version published before W92 holds none and is never rewritten. Do NOT raise
  `MENU_DOCUMENT_FORMAT` (`packages/catalogue/src/menu-document.ts:37`): `readLiveDocuments` serves
  only a version in the current format (`packages/catalogue/src/menu-publication.ts:159`), so a raise
  would stop every menu published before W92 from selling.
- A variant stores no colour; its effective colour is its parent's. No variant override.
- No colour on a menu placement, a menu item or the Price overrides tab.
- A section's colour paints only that section's tile; never the products inside it.
- No compatibility or data-migration code (CLAUDE.md §3). Never edit an existing migration file.
- Migration numbers come from drizzle-kit; never chosen by hand.
- Every new or changed string has English and Spanish (`apps/dashboard/src/i18n/strings.ts`); in
  Spanish a menu is "carta" and a colour "color".
- Forms: design-system.md → Forms. Required Name marked; a refusal under its field; one message at
  the end of the dialog body; inputs named `category-name`, `category-color`, `product-color`.
  Dialogs are `wt-modal size="standard"`. No explanatory line under a field: "A field's hint is its
  placeholder, not a line under it" (`docs/developers/design-system.md:1394`).
- Colours other than the stored data colour read `--wt-*` tokens. The till's two local custom
  properties are `--tile-fill` and `--tile-ink` (not `--wt-*`).
- Focused runs only (CLAUDE.md §2); CI owns package suites. Read the `Tests` count, never a pipe's
  exit status. Before any dashboard or till run, check `memory_pressure | /usr/bin/grep free`.
- Every changed assertion goes in the "Changed test checks" table at the end, with its reason. A
  fixture-only edit (a `color: null` added to a typed fixture or a whole-shape expectation for the
  new key) is not listed one by one; say how many in the PR.

## Review focus

1. **Editing a category must not undo a move.** A category dragged elsewhere while its Edit dialog
   is open stays where it was dropped: the dialog sends `name` and `color`, never `parentId`. Pinned
   in Task 5.
2. **A swatch inside a tree row is its own control.** Clicking it opens the colour editor and does
   not open, close or start dragging the row. Pinned in Tasks 5 and 7.
3. **A painted tile's small labels stay readable.** The price, "Section" and "Sold out" labels are
   muted on a neutral tile (`apps/till/src/widgets/menu-browser.ts:160-164`); on a painted tile
   they take the tile's ink, in both themes, sold-out tile included. Pinned in Task 4.
4. **Moving or recolouring an ancestor category recolours products that inherit.** Moving an
   uncoloured category under a coloured one, or colouring a grandparent, changes the next document
   of every menu holding its products, and a menu screen already open refreshes its status. Pinned
   in Task 3.
5. **An own colour survives category changes; clearing it falls back.** A product with its own
   colour keeps it when its category is recoloured or changed; "Use category colour" then gives
   the current category's. Pinned in Tasks 2 and 6.

---

### Task 0: Post the owner questions, then carry on

- [x] Add one entry to `/Users/clintongormley/waitron-campaign-b/questions.md` headed
  `W92 — Add category stays inline; rename checks rewritten for the Edit dialog (no answer needed to continue)`,
  with the design's "Questions for the owner" verbatim. Do not wait. Create the ledger
  `docs/handoffs/2026-10-05-w92-product-colours.md` (`Status: in progress`) if it does not exist.
  Done by the runner, with questions 1 and 2.
- [ ] **For the controller, not an implementer:** append to that same entry the design's question 3
  (the Home page tab's tile preview stays uncoloured until W93) verbatim, and the sentence question 2
  gained after it was posted (W72e's five phone-width checks that open a rename box move to the box
  for a new category, with the same assertions).

### Task 1: Storage, the colour rule, and a category's colour

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts` (`products`, after `image`, `:88`)
- Modify: `packages/catalogue/src/schema/categories.ts` (`category_details`)
- Create (generated): `packages/db/drizzle/<next>_product_color.sql`, `packages/catalogue/drizzle/<next>_category_color.sql` and their snapshots and journal entries
- Create: `packages/catalogue/src/color-inheritance.ts`, `packages/catalogue/src/color-inheritance.test.ts`
- Modify: `packages/catalogue/src/sections.ts:72-74` (use `isStoredColor`), `packages/catalogue/src/categories.ts`, `packages/catalogue/src/errors.ts:12`
- Modify: `apps/server/src/catalogue-api.ts:142-151` (`categoryInput`)
- Test: `packages/catalogue/src/categories.test.ts`, `apps/server/src/catalogue-api.test.ts`, `apps/server/src/configuration-transfer.test.ts`, `packages/media/src/image-references.test.ts:116`

**Interfaces:**
- Produces: `isStoredColor(value: unknown): value is string`; `interface ColorNode { parentId: string | null; color: string | null }`; `categoryColor(categoryId: string | null, categories: ReadonlyMap<string, ColorNode>): string | null`; `effectiveColor(own: string | null, categoryId: string | null, categories: ReadonlyMap<string, ColorNode>): string | null` — all in `color-inheritance.ts`, which imports nothing. `Category` gains `color: string | null`; `CategoryInput` gains `color?: string | null`. `"category.invalid"` params become `{ field: "name" | "color" }`.

- [ ] **Step 1: failing tests for the rule.** `color-inheritance.test.ts` (no database):

```ts
import { describe, expect, it } from "vitest";
import { categoryColor, effectiveColor, isStoredColor, type ColorNode } from "./color-inheritance.js";

const tree = (entries: [string, ColorNode][]) => new Map(entries);
const drinks = tree([
  ["drinks", { parentId: null, color: "#256bb1" }],
  ["soft", { parentId: "drinks", color: null }],
  ["cold", { parentId: "soft", color: null }],
  ["juice", { parentId: "soft", color: "#25b125" }],
]);

describe("effectiveColor", () => {
  it("takes the product's own colour over its category's", () =>
    expect(effectiveColor("#b12525", "juice", drinks)).toBe("#b12525"));
  it("takes the main category's colour when the product has none", () =>
    expect(effectiveColor(null, "juice", drinks)).toBe("#25b125"));
  it("takes the nearest coloured category above an uncoloured one, two levels up", () =>
    expect(effectiveColor(null, "cold", drinks)).toBe("#256bb1"));
  it("is null for an uncategorised product and when nothing above is coloured", () => {
    expect(effectiveColor(null, null, drinks)).toBeNull();
    expect(categoryColor("a", tree([["a", { parentId: null, color: null }]]))).toBeNull();
  });
  it("ends at null for a category the tree lacks and for a loop in the data", () => {
    expect(categoryColor("gone", drinks)).toBeNull();
    const loop = tree([
      ["a", { parentId: "b", color: null }],
      ["b", { parentId: "a", color: null }],
    ]);
    expect(categoryColor("a", loop)).toBeNull();
  });
});

describe("isStoredColor", () => {
  it("takes lowercase #rrggbb only", () => {
    expect(isStoredColor("#b12525")).toBe(true);
    for (const value of ["#B12525", "#b12", "b12525", "red", "", null, 5]) expect(isStoredColor(value)).toBe(false);
  });
});
```

  In `categories.test.ts`, add: `createCategory` with `color: "#b12525"` stores it and `listCategories`
  and `readCategory` return it; `updateCategory(tx, id, { color: "#256bb1" })` changes the colour
  and keeps name and parent; `{ color: null }` clears it; `{ name: "X" }` alone keeps the colour;
  `"#B12525"`, `"red"` and `5` are each refused `category.invalid` with `params: { field: "color" }`
  (assert the code and params, not `toBeInstanceOf(Error)`). In `catalogue-api.test.ts`:
  `POST /management-api/categories` with `{ name: "Food", color: "#b12525" }` answers 201 holding the
  colour; `PATCH …/categories/:id` with `{ color: 5 }` answers 400 `management.request_invalid`
  `field: "color"`, and with `{ color: "#ZZZZZZ" }` 400 `category.invalid` `field: "color"`.
  Run `pnpm --filter @waitron/catalogue exec vitest run src/color-inheritance.test.ts src/categories.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts -t "categor"`; watch
  them fail (missing module; unknown column `color`).

- [ ] **Step 2: write the rule** (`color-inheritance.ts`):

```ts
/** Lowercase `#rrggbb`: the one spelling a stored colour takes. */
export function isStoredColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}

export interface ColorNode {
  parentId: string | null;
  color: string | null;
}

/** The main category's colour, else the nearest coloured category above it, else null. A walk
 * longer than the tree can only be a loop in the data, so it ends there. */
export function categoryColor(
  categoryId: string | null,
  categories: ReadonlyMap<string, ColorNode>,
): string | null {
  let id = categoryId;
  for (let steps = 0; id !== null && steps <= categories.size; steps++) {
    const node = categories.get(id);
    if (node === undefined) return null;
    if (node.color !== null) return node.color;
    id = node.parentId;
  }
  return null;
}

export function effectiveColor(
  own: string | null,
  categoryId: string | null,
  categories: ReadonlyMap<string, ColorNode>,
): string | null {
  return own ?? categoryColor(categoryId, categories);
}
```

  In `sections.ts` replace the private `isHexColor` (`:72-74`) with `isStoredColor` imported from
  `./color-inheritance.js`; its callers (`colorOf`, `:86-90`) are unchanged.

- [ ] **Step 3: schema and migrations.** Add `color: label("color"),` to `products` after `image`
  (`packages/db/src/schema/catalogue.ts:88`) with the comment
  `// Its own tile colour, lowercase #rrggbb; null takes its category's. A variant's own value is ignored: it reads its parent's.`
  (worded as `categoryId`'s comment is, `:49`)
  and to `category_details` (import `label` from `@waitron/db`). No `check()`. Generate:
  `pnpm --filter @waitron/db db:generate --name product_color` and
  `pnpm --filter @waitron/catalogue db:generate --name category_color`. Read both SQL files: each
  must be exactly one `ALTER TABLE … ADD \`color\` text;` and nothing else. A rebuild
  (`__new_products` or `__new_category_details`) is a stop: do not ship it; report it.

- [ ] **Step 4: category reads and writes.** In `categories.ts`: `columns` gains
  `color: categoryDetails.color`; `Category` gains `color: string | null`; `CategoryInput` gains
  `color?: string | null`; a `categoryColorInput(value: unknown): string | null` returns null for
  null, the value when `isStoredColor`, else throws `category.invalid` `{ field: "color" }`.
  `createCategory` inserts `color: input.color === undefined ? null : categoryColorInput(input.color)`;
  `updateCategory` computes `color = patch.color === undefined ? current.color : categoryColorInput(patch.color)`
  and the upsert (`:96-99`) writes `{ parentId, color }` in both `values` and `set`. Widen
  `"category.invalid"` in `errors.ts` to `{ field: "name" | "color" }`. In `categoryInput`
  (`catalogue-api.ts:142`), after `parentId`:

```ts
if (body.color !== undefined) {
  if (body.color !== null && typeof body.color !== "string")
    throw new AppError("management.request_invalid", { field: "color" });
  result.color = body.color;
}
```

- [ ] **Step 5: transfer and the media pin.** In `apps/server/src/configuration-transfer.test.ts`,
  beside "copies declared configuration into a fresh venue…" (`:254`), add "carries a category's
  colour and a product's own colour": seed a category with `#b12525` and a product with
  `#256bb1` (raw `update products set color = …` until Task 2 adds the writer), export, import into
  a fresh venue, read both back. Change `packages/media/src/image-references.test.ts:116` per the
  Changed test checks table.

- [ ] **Step 6: run.** The Step 1 commands, plus
  `pnpm --filter @waitron/catalogue exec vitest run src/sections.test.ts src/sections.db.test.ts src/categories.db.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts`,
  `pnpm --filter @waitron/media exec vitest run src/image-references.test.ts`. Guards, from the
  root: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`. Typecheck
  `@waitron/db`, `@waitron/catalogue`, `@waitron/server`, `@waitron/media`; then
  `pnpm --filter @waitron/dashboard typecheck` (its `CategorySummary` is its own interface, so it
  should not change yet). `pnpm format:check`. Only now may the ledger and the PR say "no venue
  reset needed": the upgrade guard passed with the generated files.

- [ ] **Step 7: commit** (`git commit -s`): "Categories and products can store a colour; categories take it on save".

### Task 2: A product's own colour, and variants having none

**Files:**
- Modify: `packages/catalogue/src/variant-fallback.ts:100-115`, `product-types.ts` (`Product`, `ProductEditorInput`), `product-editor-input.ts`, `product-editor.ts`, `operations.ts` (`PRODUCT_BASE_COLUMNS` `:168`, `RawProduct`, `UpdateProductInput` `:134`, `patchProduct` `:1124`)
- Create: `packages/catalogue/src/product-colors.ts` (exported from `index.ts`)
- Modify: `apps/server/src/catalogue-api.ts:1392` (product PATCH)
- Modify: `apps/dashboard/src/widgets/product-editor.ts:177` (`emptyDraft` gains `color: null`, so the dashboard still compiles; no UI yet)
- Test: `variant-fallback.test.ts`, `product-editor-input.test.ts`, `product-editor.test.ts`, `operations.test.ts` (catalogue); `catalogue-api.test.ts`

**Interfaces:**
- Consumes: `isStoredColor` (Task 1).
- Produces: `effectiveProductColumns.color` (parent-always); `setProductColor(tx: Transaction, productId: string, color: string | null): Promise<void>` — refuses a non-null value that is not `isStoredColor` with `product.invalid` `{ field: "color" }`, then answers a variant's or unknown id with `product.not_found`; `Product.color: string | null`; `ProductEditorInput.color: string | null` (so `ProductEditorValue.color`); `UpdateProductInput.color?: string | null`; PATCH `/management-api/products/:id` body key `color`.

- [ ] **Step 1: failing tests.**
  - `variant-fallback.test.ts`: per the Changed test checks table, the fixture gives the parent
    `color: "#256bb1"` (in the `.set({...})` at `:119-125`) and Wine 175 `color: "#b12525"`
    (`:145-168`); `color` joins the entries the variant cannot set (`:566`); the `INHERITED_KEYS`
    pin (`:713-729`) gains `"color"`.
  - `product-editor-input.test.ts`: a top-level body with `color: "#b12525"` parses to that colour;
    an absent or null `color` parses to null; `""`, `"  "`, `"#B12525"`, `"red"` and `5` are each
    refused `product.invalid` `{ field: "color" }` (so `""` is never read as "no colour", as
    categories and sections refuse it); a variant body (`isVariant: true`) with `color: "#b12525"`
    is refused `product.invalid` `{ field: "color" }`, and with `color: null` parses.
  - `product-editor.test.ts` (catalogue): saving a product with `color: "#256bb1"` reads back
    `color: "#256bb1"`; saving it again with `color: null` reads back null (the reset);
    `listProducts` returns `color` for it; saving a variant writes its stored `color` back to null
    (write `#b12525` onto the variant row with raw SQL first, then save the variant's page).
  - `operations.test.ts` (or a new `product-colors.test.ts`): `setProductColor` stores and clears;
    on a variant id answers `product.not_found` and leaves the row; `"#B12525"` answers
    `product.invalid` `color`.
  - `catalogue-api.test.ts`: `PATCH /management-api/products/:id` `{ color: "#256bb1" }` → 204 and
    `GET /management-api/products` shows it; `{ color: null }` → 204 and null; `{ color: 1 }` → 400
    `management.request_invalid` `field: "color"`; a variant's id → 404 `product.not_found`; a
    product with its own colour keeps it after its category is recoloured (Review focus 5).
  Run `pnpm --filter @waitron/catalogue exec vitest run src/variant-fallback.test.ts src/product-editor-input.test.ts src/product-editor.test.ts src/operations.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts -t "colour|color"`.

- [ ] **Step 2: implement.**
  - `effectiveProductColumns` gains `color: parentsAlways(products.color, parentProducts.color),`;
    fix the header comment (`variant-fallback.ts:12-13`): "The category, the unit and the colour
    are the inherited fields a variant cannot override".
  - `product-colors.ts`:

```ts
import { eq } from "drizzle-orm";
import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { isStoredColor } from "./color-inheritance.js";
import { productWithId } from "./variant-fallback.js";
import "./errors.js";

/** Set a product's own colour, or null to take its category's. A variant has none of its own, so its
 * id answers as an id that names no product, as `setMainReportingCategory` does. */
export async function setProductColor(
  tx: Transaction,
  productId: string,
  color: string | null,
): Promise<void> {
  if (color !== null && !isStoredColor(color))
    throw new AppError("product.invalid", { field: "color" });
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(productWithId(productId, "top-level"));
  if (!product) throw new AppError("product.not_found", { productId });
  await tx.update(products).set({ color, updatedAt: now() }).where(eq(products.id, product.id));
}
```

  - `product-editor-input.ts`, beside the category check (`:148-150`), validate in the parser, NOT
    through `nullableText` (`:78-82`), which trims and turns `""` into null:

```ts
const color = body.color ?? null;
if (color !== null && !isStoredColor(color)) invalid("color");
// A variant's colour is always its parent's.
if (isVariant && color !== null) invalid("color");
```

  (importing `isStoredColor` from `./color-inheritance.js`) and return `color`. `setProductColor`
  keeps its own check for the PATCH route. `ProductEditorInput` gains `/** Its own tile colour;
  null takes its category's, and is the only value a variant's body may hold. */ color: string | null;`.
  - `product-editor.ts`: `columns` gains `color: products.color`; `readProductEditor`'s variant
    branch (`:95-103`) returns `color: null` beside `primaryCategoryId: null`, so a colour a variant
    row still holds is never read back; the variant branch's update
    (`:206-210`) sets `color: null` beside `categoryId: null`; the top-level branch calls
    `await setProductColor(tx, productId, value.color);` after `setMainReportingCategory` (`:212`).
  - `operations.ts`: `PRODUCT_BASE_COLUMNS` gains `color: effective.color`; `RawProduct` and
    `Product` gain `color: string | null`; `UpdateProductInput` gains `color?: string | null`;
    `patchProduct` destructures `color` out of `patch` beside `categoryId` and calls
    `if (color !== undefined) await setProductColor(tx, id, color);`.
  - Product PATCH route: declare `color?: unknown` in the body type and, beside `image`
    (`catalogue-api.ts:1457-1462`), refuse a value that is neither a string nor null with
    `management.request_invalid` `{ field: "color" }` and set `patch.color`.
  - Dashboard compile fix only: `emptyDraft()` (`product-editor.ts:177`) gains `color: null`; add
    `color: null` to typed fixtures typecheck names.

- [ ] **Step 3: run** the Step 1 commands; typecheck `@waitron/catalogue`, `@waitron/server`,
  `@waitron/venue-service`, `@waitron/dashboard`, `@waitron/till`; then run every suite holding a
  typed `Product` or `ProductEditorInput` fixture that typecheck flagged, and
  `pnpm --filter @waitron/catalogue exec vitest run src/variants.test.ts src/variants.db.test.ts`
  (`blankInherited` now also blanks `color`). From the root,
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/catalogue-engine-neutral.test.ts`
  (the new `product-colors.ts` imports `./errors.js` and the database). `pnpm format:check`.
- [ ] **Step 4: commit:** "Products: an own colour, set in the editor or by PATCH; a variant has none".

### Task 3: The published document carries each product's effective colour

**Files:**
- Modify: `packages/catalogue/src/product-colors.ts` (add `readEffectiveColors`), `menu-document.ts` (`buildMenuDocuments` `:128`, `freezeOffer` `:302`, `PRODUCT_FIELD_ORDER` `:650`, `productFields` `:723`), `menu-document-types.ts` (`FrozenOffer` `:35`, `LiveOffer` `:118`, `ProductChangeField` `:185`)
- Modify: `apps/dashboard/src/widgets/menu-preview.ts:32` (`PRODUCT_FIELDS.color: "menu_preview.field_color"`, the existing string), `apps/dashboard/src/api/live-queries.ts:4-21` and `:182-184`
- Test: `menu-document.test.ts`, `menu-publication.test.ts` (catalogue); `apps/dashboard/src/widgets/menu-preview.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`

**Interfaces:**
- Consumes: `effectiveColor`, `effectiveProductColumns.color`, `listCategories` returning `color`.
- Produces: `readEffectiveColors(tx: Transaction, productIds: readonly string[]): Promise<Map<string, string | null>>`; `FrozenOffer.color?: string | null` and `LiveOffer.color?: string | null` (optional: Global constraints), always set by `freezeOffer` from now on; `ProductChangeField` includes `"color"`. `MENU_DOCUMENT_FORMAT` stays 2.

- [ ] **Step 1: failing tests** (`menusFixture`, `packages/catalogue/test/menus-fixture.ts:54`):
  - `menu-document.test.ts` — "gives each offer its product's effective colour": Soft drinks gets
    `#256bb1`; Lemonade's offer on Lunch carries `#256bb1`; Lemonade with its own `#b12525` carries
    that; a new category under Cold drinks under a coloured Soft drinks (move Cold drinks under it
    with `updateCategory`), holding Soup, gives Soup's offer `#256bb1` (nested); with nothing
    coloured an offer carries `null`; the frozen variant (`offer.variants[0]`) has no `color` key.
  - same file — "keeps a section's colour on the section only": set the Drinks section's colour
    `#b12525` (`updateSection`) and Lemonade's own `#25b125`: the Drinks member carries `#b12525`,
    Lemonade's offer `#25b125`, and Lager (uncoloured, inside Beer inside Drinks) `null`.
  - same file — "gives a product placed twice the same colour on every menu": add Lemonade to
    Lunch's root as well as Drinks; build Lunch and Dinner; each has one Lemonade offer with the
    same colour.
  - `menu-publication.test.ts` — "a category colour edit is a shared change each menu publishes on
    its own": publish Lunch and Dinner; colour Soft drinks; `menuStatus` of both is `changed`;
    `previewMenu(Lunch)` lists a `product_changed` for Lemonade with `fields` containing `"color"`,
    `source: "shared_product"` and `alsoOn: ["Dinner Menu"]` (use the fixture's real name);
    `applyLiveFields` on Lunch's live document still gives Lemonade's offer the old colour (`null`);
    after publishing Lunch it gives `#256bb1`, and Dinner's live offer is still `null` until Dinner
    is published.
  - same file — "moving an uncoloured category under a coloured one changes the next document"
    (Review focus 4).
  - same file — "a live version published before W92 holds no colour": build it as
    `liveInEarlierFormat` does (`menu-publication.test.ts:443-468`), but keep `format: 2` and drop
    only each offer's `color` key (`offers: Object.fromEntries(Object.entries(doc.offers).map(([id,
    { color, ...offer }]) => [id, offer]))`; a section's `color` predates W92 and stays), and assert
    the copy holds no offer `color`. Then: `readLiveDocuments` still serves it (unlike the
    earlier-format case at `:470`); `menuStatus` is `changed`; `previewMenu` lists a
    `product_changed` for each of its offers with `fields: ["color"]`; and `applyLiveFields` on it
    gives offers with no `color` property (`not.toHaveProperty("color")`), which the till draws
    neutral (Task 4 pins that end).
  - `live-queries.test.ts` — "refreshes the menu status and preview when a category changes":
    the `it.each` shape at `:189`, invalidating `categories` and `category_details`.
  - `menu-preview.test.ts` — a `product_changed` with `fields: ["color"]` reads "colour" (and
    "color" in Spanish).
  Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-document.test.ts src/menu-publication.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/widgets/menu-preview.test.ts`.

- [ ] **Step 2: implement.**

```ts
// product-colors.ts (add imports: inArray; batches; listCategories; effectiveColor;
// effectiveProductColumns, parentJoin, parentProducts)
/** Each product's effective colour: two reads (the products in batches, and the category tree once)
 * however many products. */
export async function readEffectiveColors(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, string | null>> {
  const colors = new Map<string, string | null>();
  if (productIds.length === 0) return colors;
  const categories = new Map((await listCategories(tx)).map((category) => [category.id, category]));
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({
        id: products.id,
        color: effectiveProductColumns.color,
        categoryId: effectiveProductColumns.categoryId,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(inArray(products.id, batch)))
      colors.set(row.id, effectiveColor(row.color, row.categoryId, categories));
  return colors;
}
```

  In `buildMenuDocuments`, after `readDishFacts` (`:128`):
  `const colors = await readEffectiveColors(tx, [...new Set(offers.map((offer) => offer.productId))]);`
  and pass `colors.get(offer.productId)!` to `freezeOffer`, which sets `color` beside `image` and
  `description`. `FrozenOffer` and `LiveOffer` gain
  `/** The product's effective colour (color-inheritance.ts), frozen when the version is built; null draws the neutral tile. Absent from a version published before it existed. */ color?: string | null;`
  — on `FrozenOffer` inside the `PublishedOrdering & { … }` object, on `LiveOffer` beside `image`.
  Do not touch `MENU_DOCUMENT_FORMAT`.
  `ProductChangeField` gains `"color"`; `PRODUCT_FIELD_ORDER` puts it after `"image"`;
  `productFields` adds `if (!same(a.color, b.color)) shared.add("color");` after the description
  line. Dashboard: `PRODUCT_FIELDS` gains `color: "menu_preview.field_color"` (the compiler requires
  it); `MENU_PUBLICATION_READS` gains `"categories"` and `"category_details"`, and the comment at
  `:182-184` becomes "The tables `menuStatus` and `previewMenu` read
  (packages/catalogue/src/menu-publication.ts); a category's colour is part of each offer's colour."

- [ ] **Step 3: run** Step 1's commands, plus `pnpm --filter @waitron/catalogue exec vitest run src/menu-publication.live.test.ts src/home-layouts.test.ts`,
  `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/till-api.sell-published.test.ts src/till-api.test.ts`
  (whole-offer `toEqual`s gain the key: fixture-only unless a value changes), and
  `pnpm exec vitest run scripts/dashboard-browser-purity.test.ts scripts/catalogue-engine-neutral.test.ts`
  from the root. Typecheck catalogue, venue-service, server, dashboard, till. Format check.
  The till: no till code changes in this task (`menuOfferToTillProduct` copies `color` in Task 4),
  and because `color` is optional no typed `LiveOffer`/`TillMenuOffer` fixture needs it, so the
  expected answer is that no till fixture changes and `pnpm --filter @waitron/till typecheck`
  passes. If typecheck flags one anyway, add the key there and run that file; the till files
  holding typed offers are `src/api/client.test.ts`, `src/state/menu-refresh.test.ts`,
  `src/state/draft-lines.test.ts`, `src/state/working-order.test.ts`,
  `src/till-app-menu-refresh.test.ts` and `src/till-app-drafts.test.ts`. The same holds for the
  dashboard's `src/widgets/test-helpers.ts`.
- [ ] **Step 4: commit:** "Menus: each published offer carries its product's colour; a colour edit is a change to publish".

### Task 4: The till paints product and section tiles

**Files:**
- Modify: `apps/till/src/api/client.ts` (`TillProduct` `:237`, `menuOfferToTillProduct` `:405`), `apps/till/src/widgets/menu-browser.ts` (styles near `:124-164`, `#productButton` `:327`, `#sectionButton` `:339`)
- Test: `apps/till/src/api/client.test.ts`, `apps/till/src/widgets/menu-browser.test.ts`, `apps/till/src/widgets/menu-browser.a11y.test.ts`

**Interfaces:**
- Consumes: `LiveOffer.color` (Task 3); `isHexColor`, `readableTextColor` from `@waitron/ui` (`packages/ui/src/index.ts:89`).
- Produces: `TillProduct.color?: string | null`.

- [ ] **Step 1: failing tests.**
  - `client.test.ts`: `menuOfferToTillProduct` copies `color` (`"#256bb1"` and `null`), and an
    offer with no `color` key (a version published before W92) gives a product with no `color`
    property, as the `ordering` case beside it does (`:3752`).
  - `menu-browser.test.ts`, new `describe("tile colours")`: a product with `color: "#256bb1"` draws
    a tile whose inner button (`tile.shadowRoot.querySelector("button")`) computes
    `background-color: rgb(37, 107, 177)` and whose `.name`, `.price` and `.sold-out` (make one
    `available: false`) compute `rgb(255, 255, 255)`; with `#edabab`, `rgb(0, 0, 0)`; a section
    with `color: "#b12525"` paints its tile and its `.kind` label the same way; a product with
    `color: null`, one with no `color` property, and one with `color: "not-a-colour"`, keep the
    neutral look (each button's background equals an uncoloured sibling's, and the tile has no
    `style` attribute); a product with no colour inside a coloured section is not painted (Review
    focus 3). Run each assertion under `data-theme="light"` and `"dark"` (`mountWidget`'s third
    argument, as the a11y file does at `:83-88`).
  - same `describe` — "a painted tile keeps the button's feedback". `wt-button`'s feedback is
    opacity alone: a hover dip (`button:hover:not(:disabled)`,
    `packages/ui-core/src/components/wt-button.ts:52-54`) and the disabled fade (`:44-46`); it has
    NO pressed (`:active`) style of its own, so there is no pressed state for the painted rule to
    override, and this test does not claim one. Pin what exists: hovering a painted sellable tile
    (`userEvent.hover`) gives its inner button the same computed `opacity` as a hovered neutral
    tile, and one below 1; a painted sold-out tile (`available: false`) computes the same `opacity`
    as a neutral sold-out tile, below 1, still shows "Sold out" in the tile's ink, and its button
    is `disabled`. If Task 8's look at the till finds a pressed state wanted, that is a new
    finding for the owner, not part of this test.
  - `menu-browser.a11y.test.ts`: the `products` fixture (`:74-81`) gains one dark and one pale
    coloured product and the menu one coloured section; the existing light/dark `describe.each`
    (`:101`) then runs axe, colour contrast included, over them.
  Check memory first; run `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/widgets/menu-browser.test.ts src/widgets/menu-browser.a11y.test.ts`.

- [ ] **Step 2: implement.**

```ts
// menu-browser.ts
/** Custom properties for a tile painted in a stored colour, with black or white ink for contrast;
 * undefined draws the neutral tile. Checked, because the value lands in a style attribute. */
function tilePaint(color: string | null | undefined): string | undefined {
  return typeof color === "string" && isHexColor(color)
    ? `--tile-fill:${color};--tile-ink:${readableTextColor(color)}`
    : undefined;
}
```

  Each tile: `style=${tilePaint(...) ?? nothing}` and `?data-painted=${tilePaint(...) !== undefined}`
  (compute once). Styles:

```css
.tile[data-painted]::part(button) {
  background: var(--tile-fill);
  border-color: var(--tile-fill);
  color: var(--tile-ink);
}
.tile[data-painted] .price,
.tile[data-painted] .kind,
.tile[data-painted] .sold-out {
  color: inherit;
}
```

  The painted rule sets only `background`, `border-color` and `color`: never `opacity`, which
  carries `wt-button`'s hover and disabled feedback.
  `TillProduct` gains `/** The offer's effective colour; absent on a retrieved held line and from a version published before it existed. */ color?: string | null;`
  and `menuOfferToTillProduct` copies it as it copies `ordering` (`client.ts:412`):
  `...(offer.color === undefined ? {} : { color: offer.color })`. Variants stay choices in the
  modifier picker, unpainted.
- [ ] **Step 3: run** Step 1's command plus `src/state/working-order.test.ts src/state/draft-lines.test.ts`;
  typecheck and lint `@waitron/till`; format check.
- [ ] **Step 4: commit:** "Till: product and section tiles paint their colour with readable labels".

### Task 5: Products tree — Edit replaces Rename, with a colour swatch

**Files:**
- Modify: `apps/dashboard/src/widgets/color-field.ts` (options; the none button `:143-156`), `apps/dashboard/src/api/client.ts:296-304` (`CategorySummary.color`, `CategoryInput.color?`), `apps/dashboard/src/widgets/category-form.ts:53-78` (`categoryRefusalErrors`), `apps/dashboard/src/widgets/product-list.ts` (line numbers at c2b886e99, after W72e: `CategoryNameDraft` `:55-56`, `willUpdate`'s rename branch `:537-540`, `#renaming` `:665-667`, folder cell `:1094-1096`, menu's Rename `:1116-1122`, `rowActivation` `:1274-1275`), `apps/dashboard/src/widgets/catalogue-browser.ts` (`#saveName` `:538-556`, `@rename-folder` `:604-608`)
- Keep unchanged: W72e's `#fitNameBox` and `#scheduleFit` (`product-list.ts:634-663`), which then serve only the box for a new category
- Create: `apps/dashboard/src/widgets/category-details-form.ts` (`dashboard-category-details-form`), with `category-details-form.test.ts` and `category-details-form.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `color-field.test.ts`, `category-form.test.ts`, `product-list.test.ts`, `catalogue-browser.test.ts`, `catalogue-browser.a11y.test.ts`, `product-list.a11y.test.ts`

**Interfaces:**
- Consumes: `effectiveColor` is not needed here; categories carry their own `color` (Task 1).
- Produces: `ColorFieldOptions` gains `noneLabel?: string` and `inherited?: string | null` (absent: today's "No colour" button, unchanged); `dashboard-category-details-form` with properties `open: boolean`, `busy: boolean`, `value: CategorySummary | null`, `errors: Record<string, string>` (keys `name`, `color`, `_form`), events `wt-submit` `{ name: string; color: string | null }` and `wt-cancel`; `dashboard-product-list` event `edit-folder` `{ folderId }` (replacing `rename-folder`).

- [ ] **Step 1: failing tests.**
  - `color-field.test.ts`: with `noneLabel: "Use category colour"` and `inherited: "#25b125"` the
    no-colour button is named by that label alone, holds a chip whose computed background is
    `rgb(37, 177, 37)`, and its accessible description is `#25b125` (each palette swatch is named
    by its value); with `inherited: null` it is named by the label and, INSIDE the button, a second
    line reads "Its category has no colour." and is the button's accessible description
    (`aria-describedby`), and nothing in the fieldset sits between the options and the error
    line; with neither option it is exactly today's button (existing cases stay green).
  - `category-details-form.test.ts`: opens holding the category's name and colour; Name is
    required (marked, and a blank name shows `folders.name_required` beside it, the bottom message,
    and disables Save); choosing a swatch and Save emits `{ name, color }`; "No colour" emits
    `color: null`; `errors.color` shows under the chooser, `errors.name` under Name, `errors._form`
    at the end of the body; Esc and Cancel emit `wt-cancel`; inputs are named `category-name` and
    `category-color`. At 390 × 844 (`page.viewport`, restored afterwards as W72e's `onPhone` helper
    does, `product-list.test.ts:1566-1580`), in English and Spanish, with
    `errors.name = codeMessage("category.name_taken")`: the Name input and its refusal each lie
    inside the dialog's visible box (left ≥ its left, right ≤ its right, both within 0–390) and the
    refusal does not overflow (`scrollWidth ≤ clientWidth`), the check W72e makes of the tree's box.
  - `category-form.test.ts`: `categoryRefusalErrors({ code: "category.invalid", params: { field: "color" } })`
    gives `{ color: t("editor.field_rejected") }`; `management.request_invalid` `field: "color"`
    gives `color`; `category.invalid` with `field: "name"` or no params still gives `name`.
  - `product-list.test.ts`: per the Changed test checks table — including W72e's five phone-width
    cases that open a rename box (`describe("the product list at phone width")`, from `:1521`),
    which stop compiling once the `rename` kind goes and move to the box for a new category with
    the same assertions; plus "draws a swatch beside a category's name in its colour, outlined when
    it has none, and its click sends `edit-folder` without opening or closing the row" (Review
    focus 2: the row's `aria-expanded` is unchanged and no `category-toggle` is sent).
  - `catalogue-browser.test.ts`: per the table; plus "keeps a move made while the Edit dialog is
    open" (open Edit on `b`, drag `b` into `f`, Save: `moveCatalogueItems` was called and
    `updateCategory` received `("b", { name: "Bottles", color: null })` with no `parentId`) and
    "the swatch opens the same dialog".
  - The two `*.a11y.test.ts` files: axe, light and dark, on the tree with swatches and on the
    open dialog.
  Check memory; run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/color-field.test.ts src/widgets/category-details-form.test.ts src/widgets/category-form.test.ts src/widgets/product-list.test.ts src/widgets/catalogue-browser.test.ts`.

- [ ] **Step 2: implement.**
  - `colorField` (the none button, `color-field.ts:143-156`): it renders
    `<span id=${`${name}-none-label`}>${noneLabel ?? t("editor.color_none")}</span>` and is named
    by that span alone (`aria-labelledby`). When `inherited` is a string, an `aria-hidden` chip
    `<span class="chip" style=${`background:${inherited}`}></span>` sits before the label and the
    button's description is the colour's value. When `noneLabel` is set and `inherited === null`,
    the button holds, under its label, a second line
    `<span class="note" id=${`${name}-none-note`}>${t("editor.color_category_none")}</span>`, and
    `aria-describedby` points at it — the label-plus-description pattern `wt-combobox` uses for an
    option's description (design-system.md, the `wt-combobox` row). Nothing is drawn under the
    field: design-system.md:1394. Style `.chip` like `.swatch` at `--wt-space-4`; `.note` in
    `--wt-color-text-muted`, `--wt-font-size-sm`, as its own line inside the button (the button
    grows to two lines).
  - `dashboard-category-details-form`: modelled on `section-details-form.ts` (`wt-modal size="standard"`,
    `textField` for Name with `folders.name`, `colorField` named `category-color`, error id
    `category-color-error`, heading `folders.edit_heading`, bottom message as that form builds it,
    `wt-form-actions` Cancel/Save).
  - `product-list.ts`: `CategoryNameDraft` loses its `rename` kind and `#renaming` (`:665-667`);
    `willUpdate`'s rename branch (`:537-540`) goes, leaving `#nameValue = ""`; `rowActivation`
    (`:1274-1275`) makes every folder row `"toggle"`; W72e's `#fitNameBox` and `#scheduleFit` stay
    as they are. The folder cell (`:1094-1096`)
    always shows `<strong>${folder.name}</strong>` unless it is the create draft, and draws AFTER the
    name and its count and asterisk, inside the `folder-name` span W85b's `#fitNames` fits (so names
    at one depth still line up, W84's check, and the swatch wraps inside the room before the pinned
    Actions column; ruling 2026-10-05: a swatch drawn before the name moved every category name one
    tap target further in than a product's at the same depth)
    `<button part="swatch-button" type="button" data-test=${`color-${folder.id}`}
    aria-label=${t("folders.edit_color").replace("{name}", folder.name)}
    @click=${(e: Event) => { e.stopPropagation(); this.#send("edit-folder", { folderId: folder.id }); }}><span
    part=${folder.color ? "color-swatch" : "color-swatch empty"}
    style=${folder.color ? `background:${folder.color}` : nothing}></span></button>`; styles:
    `wt-data-table::part(swatch-button)` a `--wt-tap-min` square, no border, transparent;
    `wt-data-table::part(color-swatch)` `--wt-space-5` square, `1px solid var(--wt-color-border)`,
    `--wt-radius-sm`. The menu's Rename (`:1116-1122`) becomes `data-test=edit-${id}`,
    `t("action.edit")`, sending `edit-folder`.
  - `catalogue-browser.ts`: state `editingCategory: CategorySummary | null`, `categoryBusy`,
    `categoryErrors`; `@edit-folder` opens the dialog; `wt-submit` calls
    `api.updateCategory(id, { name, color })`, closes on success, and on refusal sets
    `categoryErrors = categoryRefusalErrors(error, null)` and stays open; `#saveName` keeps only its
    create branch.
  - `client.ts`: `CategorySummary.color: string | null`; `CategoryInput.color?: string | null`.
  - Strings (English | Spanish): `folders.edit_heading` "Edit category" | "Editar categoría";
    `folders.name_required` "Enter a name for the category." | "Introduce un nombre para la
    categoría."; `folders.edit_color` "Change the colour of {name}" | "Cambiar el color de {name}";
    `editor.color_use_category` "Use category colour" | "Usar el color de la categoría";
    `editor.color_category_none` "Its category has no colour." | "Su categoría no tiene color.".
    Delete `folders.rename` in both languages once a grep finds no reader.
- [ ] **Step 3: run** Step 1's command plus the two a11y files and `src/screens/catalogue-screen.test.ts`;
  typecheck, lint `@waitron/dashboard`; format check; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`.
- [ ] **Step 4: W72e at phone width, after the swatch.** The swatch button makes every category
  row's name a `--wt-tap-min` longer, which can widen the table and move the pinned column.
  Re-run W72e's phone-width cases on their own, with the swatch in place:
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts -t "the product list at phone width"`,
  and read the `Tests` count: it must include every case of that `describe` (the moved ones and
  the create case at `:1697`), none skipped. Then the 390 px case for the Edit dialog's Name refusal
  (Step 1, `category-details-form.test.ts`). A failure here is fixed in this task, never by
  loosening a W72e assertion.
- [ ] **Step 5: commit:** "Products: Edit replaces Rename for a category, with its colour and a swatch".

### Task 6: Product editor — the colour chooser and "Use category colour"

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts` (`SERVER_FIELDS` `:100`, `DRAFT_ERROR_KEYS` `:162`, `renderName` area `:1021-1049`, `render` `:1740`)
- Test: `apps/dashboard/src/widgets/product-editor.test.ts`, `product-editor.a11y.test.ts`, `apps/dashboard/src/screens/catalogue-screen.test.ts`

**Interfaces:**
- Consumes: `colorField` options (Task 5); `categoryColor` from `@waitron/catalogue/src/color-inheritance.js` (Task 1); `ProductEditorInput.color` (Task 2); `CategorySummary.color` (Task 5).

- [ ] **Step 1: failing tests** (`product-editor.test.ts`): a product with no parent shows the
  colour group, named `product-color`; its "Use category colour" choice shows the colour of the
  draft's category, and after choosing another category (no save) shows that one's, or, for an
  uncoloured category, carries "Its category has no colour." as its own second line and
  accessible description (inside the choice, not under the field); choosing a swatch then Save sends `color: "#b12525"`; choosing "Use
  category colour" then Save sends `color: null` (the reset); a product opened with an own colour
  shows that swatch selected; a variant (`inherited` set) shows no colour group and sends
  `color: null`; `productEditorField("color", "en")` is `"color"` and a refusal with that field
  shows under the chooser. a11y: axe light and dark with the group shown.
  Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts src/widgets/product-editor.a11y.test.ts`.
- [ ] **Step 2: implement.** `SERVER_FIELDS.color = "color"`; `DRAFT_ERROR_KEYS.color = "color"`; a
  `renderColor()` after `renderName` when `this.inherited === null`, calling `colorField` with
  `color: this.draft.color`, `name: "product-color"`, `errorId: "product-color-error"`,
  `noneLabel: t("editor.color_use_category")`,
  `inherited: categoryColor(this.draft.primaryCategoryId, new Map(this.categories.map((c) => [c.id, c])))`,
  `error: this.error("color")`, `busy: this.suspended`, `change: (color) => this.change("color", color)`;
  add `colorFieldStyles` to the editor's styles. The save body already spreads the draft; check
  `color` reaches it.
- [ ] **Step 3: run** Step 1 plus `src/screens/catalogue-screen.test.ts`; typecheck, lint; format check.
- [ ] **Step 4: commit:** "Product editor: choose a colour, or use the category's".

### Task 7: Menu Structure — product and section swatches

**Files:**
- Create: `apps/dashboard/src/widgets/product-color-form.ts` (`dashboard-product-color-form`), `product-color-form.test.ts`, `product-color-form.a11y.test.ts`
- Modify: `apps/dashboard/src/widgets/menu-structure-table.ts` (`#nameCell` `:585-635`, new `categories` property beside `products` `:216`), `apps/dashboard/src/screens/menus-screen.ts` (`#renderStructure` `:1936-1990`), `apps/dashboard/src/api/client.ts` (`setProductColor`), `strings.ts`
- Test: `menu-structure-table.test.ts`, `menu-structure-table.a11y.test.ts`, `menus-screen.test.ts`, `apps/dashboard/src/api/client-routes.test.ts`

**Interfaces:**
- Consumes: `effectiveColor` (Task 1), `Product.color` (Task 2), `CategorySummary.color`, `colorField` options (Task 5).
- Produces: `DashboardApi.setProductColor(id: string, color: string | null): Promise<void>` (PATCH `/management-api/products/${id}` `{ color }`); table event `wt-product-color` `{ productId: string }`; `dashboard-product-color-form` with `open`, `busy`, `name: string`, `color: string | null`, `inherited: string | null`, `errors: Record<string, string>`, events `wt-submit` `{ color: string | null }` and `wt-cancel`.

- [ ] **Step 1: failing tests.**
  - `client-routes.test.ts`: `setProductColor("p1", "#b12525")` sends PATCH
    `/management-api/products/p1` with `{ color: "#b12525" }`.
  - `product-color-form.test.ts`: heading "Colour of Lemonade"; the scope sentence "Changes this
    product's colour on every menu that uses it." is in the body; the chooser is named
    `product-color` and offers "Use category colour" with the inherited chip; Save emits the colour;
    `errors.color` under the chooser, `errors._form` at the end; Esc/Cancel emit `wt-cancel`.
  - `menu-structure-table.test.ts`: a product row shows a swatch of its effective colour (own; else
    its category's from `categories`; else outlined) and its click sends `wt-product-color` without
    toggling the row or starting a drag; a section row shows its own colour, and its click sends
    `wt-member-edit` with the same detail as the row's Edit (`:677-679`); on a read-only row inside
    an included menu both swatches are drawn and are not buttons.
  - `menus-screen.test.ts`: the product swatch opens the dialog for that product; Save calls
    `setProductColor` and closes; a refusal (`product.invalid` `field: "color"`) stays open with
    `editor.field_rejected` under the chooser; the section swatch opens the section form.
  - a11y files: axe light and dark with swatches and the open dialog.
  Check memory; run `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/widgets/product-color-form.test.ts src/widgets/menu-structure-table.test.ts src/screens/menus-screen.test.ts`.
- [ ] **Step 2: implement.** The swatch markup and styles are Task 5's (`swatch-button`,
  `color-swatch`, styled through `wt-data-table::part`), placed after the row's name (and its
  count, if any) — not before the thumbnail or folder icon, which would move that row's name off
  the line names at one depth share (Task 5's ruling, 2026-10-05). The product colour is
  `effectiveColor(product.color, product.categoryId, categoryMap)` with `categoryMap` rebuilt in
  `willUpdate` when `categories` changes. `menus-screen` passes `.categories=${this.categories}`
  (already watched, `:780-781`), holds `colouring: Product | null`, `colorBusy`, `colorErrors`, and
  renders the dialog; Save calls `api.setProductColor`, closes on success (the products and status
  queries refresh themselves), and on refusal maps `field: "color"` to
  `{ color: t("editor.field_rejected") }`, anything else to `_form` with `codeMessage`. Strings:
  `product_color.heading` "Colour of {name}" | "Color de {name}"; `product_color.scope` "Changes this
  product's colour on every menu that uses it." | "Cambia el color de este producto en todas las
  cartas que lo usan.".
- [ ] **Step 3: run** Step 1 plus the a11y files and `src/screens/menus-screen.a11y.test.ts`;
  typecheck, lint; format check.
- [ ] **Step 4: commit:** "Menu Structure: product and section swatches open their colour editors".

### Task 8: Look at it

- [ ] Check memory and the heaviest processes. Start the stack with
  `wa-wt demo waitron-feat-product-colours` (the dev venue migrates in place; if it does not, reset
  with `wa-wt reset demo waitron-feat-product-colours`, re-enrol the till, and record why in the
  ledger and PR). Light and dark, at 1280 px and 390 px:
  - Products tree: swatches beside categories, the row menu's Edit, the Edit dialog (name, chooser,
    a refused duplicate name under Name).
  - Product editor: the colour group, "Use category colour" with and without an inherited colour.
  - Menu Structure: product and section swatches, the product colour dialog and its sentence, a
    read-only included row.
  - Preview tab after a category colour edit: "colour" listed; publish.
  - Till (enrolled with `DEMO`): painted product and section tiles, a pale and a dark colour, a
    sold-out painted tile, pressed and hovered states, search results.
  Save screenshots under `$(mktemp -d)`, never the worktree. Fix what looks wrong in the task that
  owns it, with a test that would have caught it.

### Task 9: Documentation and backlog

- [ ] `docs/developers/products.md`: a short "Colour" section (own colour, else the main category's
  or nearest coloured ancestor's, else neutral; one colour on every menu; frozen at publish; a
  section's colour is its own tile's), and in _What a variant reads from its parent_
  (`:276-292`) add the colour to the fields a variant cannot override.
- [ ] `docs/developers/design-system.md:188-197`: the data-colour exception now has users — the
  category and product swatches and the till's painted tiles (black or white ink by
  `readableTextColor`, labels on a painted tile take that ink); drop "no screen passes `wt-lozenge`
  one today"; one line on the swatch-button/`color-swatch` parts in table cells.
- [ ] `docs/developers/product-categories.md:5-6` and `:358-361`: a category has an optional colour,
  set from Edit or its swatch; stored in `category_details.color`.
- [ ] `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md`: a dated note under each
  of `:25`, `:51` and `:514`: "Superseded 2026-10-05 by W92
  (`docs/superpowers/specs/2026-10-05-w92-product-colours-design.md`): a category has an optional
  colour again, which products inherit." The original lines stay.
- [ ] `docs/backlog.md`: a DONE entry beside W89's (`:3218`) in that shape — what changed for the
  owner, the two migrations and that they add columns without a reset, "republish every menu after
  upgrading", "export a configuration bundle again after upgrading", and a pointer to the PR's
  Changed test checks.
- [ ] Grep `docs/developers`, every `README.md`, `docs/backlog.md` and `CLAUDE.md` for "no colour",
  "no image or colour", "Rename" beside category, and "category.*colour"; fix what the change made
  wrong.
- [ ] Commit: "Docs: one product colour, inherited from categories (W92)". Set the ledger to
  `Status: done` once the PR exists; add the questions.md FYI entry the owner's 2026-10-05 test
  rule asks for, headed `W92 (#PR) — changed test checks, FYI, no answer needed`.

Then `/finish-branch` with this plan and the ledger named. The PR's first line: "Republish every
menu after upgrading; export configuration bundles again." Its description carries the table below
under "Changed test checks".

---

## Changed test checks

Line numbers at c2b886e99 (after W72e, #1241; only `product-list.test.ts` moved since 520f9cd20): the `it(` or `it.each(` line, then the assertions. **Reasons:** **R1** design
Decision 1 (a category has a colour column; the 2026-09-30 "no colour" is superseded); **R2**
Decision 3 (colour is a parent-always field of a variant); **R3** Decision 8, Products tree (Edit
dialog replaces the inline rename box); **R4** a new key on a whole-shape pin. Implementers append
every further row they meet; no row deletes a check without an equally strict check of the new
behaviour.

| Task | file:line | Before | After | Why |
| --- | --- | --- | --- | --- |
| 1 | `packages/catalogue/src/categories.test.ts:44` (`:46-50`) | `food` equals `{ id, name, parentId }` | the same with `color: null` | R4 |
| 1 | `packages/media/src/image-references.test.ts:116` (`:120`) | `category_details` columns are `category_id, parent_id`; title says "no image or colour column" | columns `category_id, color, parent_id`; title "gives category_details no image column and no trigger naming it"; the trigger check unchanged | R1 |
| 2 | `packages/catalogue/src/variant-fallback.test.ts:709` (`:713-729`) | `INHERITED_KEYS` is the fourteen keys | the same plus `color` | R2 |
| 2 | `…variant-fallback.test.ts:542` (`:566`; fixture `:119-125`, `:145-168`) | category and pricing unit are the entries a variant cannot set | `color` joins them; the fixture gives parent `#256bb1`, Wine 175 `#b12525` so the "different on each side" guarantee holds | R2 |
| 5 | `apps/dashboard/src/widgets/product-list.test.ts:1948` (`:1957`) | a category's menu: …, Rename, Move to…, Delete | …, Edit, Move to…, Delete | R3 |
| 5 | `…product-list.test.ts:2156` | Rename turns the name into a box holding it | Edit sends `edit-folder` `{ folderId: "d" }` and the row still shows its name, with no box | R3 |
| 5 | `…product-list.test.ts:2185` (`:2193`, `:2196`) | a create box replaced by a rename box sends nothing | a create box replaced by a second create box (in another category) sends nothing | R3 |
| 5 | `…product-list.test.ts:2199` (`:2202-2211`) | choosing Rename closes the menu and sends `rename-folder` | choosing Edit closes it and sends `edit-folder` | R3 |
| 5 | `…product-list.test.ts:2286` (`:2294`, `:2302`) | a rename box sends a cancel on Esc and on leaving it blank | moved to `catalogue-browser.test.ts`: the Edit dialog sends no update on Esc or Cancel, and a blank Name disables Save with its message | R3 |
| 5 | `…product-list.test.ts:1521` (`:1537`; `:1548-1557`) | W72e: a rename box in `f` and in `b`, refused `category.name_taken` and `category.invalid`, English and Spanish, at 390 px: the table not scrolled sideways, the input and the refusal between the scroller's start and the pinned Actions cell, the refusal not overflowing | the box for a new category at the same two depths (`{ kind: "create", parentId: null }` for `f`'s, `parentId: "d"` for `b`'s), same codes, languages and assertions; title says "a new category's" | R3 |
| 5 | `…product-list.test.ts:1627` (`:1632`; `:1634`) | W72e: an open rename box in `f` with a refusal is fitted again when the screen narrows from 430 to 390 px | the same with the box for a new category, `parentId: null`; the same `expectInView` | R3 |
| 5 | `…product-list.test.ts:1638` (`:1643`; `:1648-1652`) | W72e: an open rename box in `f` is fitted again when selection adds a column in a bounded list | the same with the box for a new category, `parentId: null`; same assertions (the `folder:f` checkbox drawn, box in view, pinned column unmoved) | R3 |
| 5 | `…product-list.test.ts:1656` (`:1669`, `:1672`; `:1678`) | W72e: a rename box in `f`, the table scrolled sideways before or after it opens, shows the box and refusal from their first letter | the same with the box for a new category, `parentId: null`, opened by setting `nameDraft`; same scroll of 172 px and `expectInView`; title says "the box opens" | R3 |
| 5 | `…product-list.test.ts:1682` (`:1687`; `:1693`) | W72e: an open rename box in `f` is fitted again after the list is moved on the page and the screen narrows | the same with the box for a new category, `parentId: null`; same `expectInView` | R3 |
| 5 | `apps/dashboard/src/widgets/catalogue-browser.test.ts:1005` | renames in place; sends `("d", { name: "Beverages" })` | Edit opens the dialog holding "Drinks"; Save sends `("d", { name: "Beverages", color: null })` | R3 |
| 5 | `…catalogue-browser.test.ts:1015` (`:1030-1034`) | a rename after a move sends the name only | Edit after the move sends `[["b", { name: "Beer", color: null }]]`, no `parentId`; plus the move-while-open case | R3 |
| 5 | `…catalogue-browser.test.ts:1048` (`:1061-1066`) | a duplicate name stays in the rename box with the refusal under it (both languages) | stays in the dialog's Name field with the refusal under it (both languages); the row keeps "Drinks" | R3 |
| 5 | `…catalogue-browser.test.ts:2248` (`:2260-2269`) | a rename box opened while a create saves keeps "Food" | a second create box opened while the first saves is still open, empty, after the first finishes | R3 |
| 5 | `…catalogue-browser.test.ts:2273` (`:2290-2298`, `:2305-2308`, `:2311`) | rename box steps (Esc; "Fresh" Enter) during a pending create | create box steps in `f` (Esc; "Fresh" Enter); `createCategory` calls are Juice/d, Fresh/f, Tea/null; `updateCategory` never called | R3 |
| 5 | `…catalogue-browser.test.ts:2315` (`:2327-2335`) | a refusal shows at the bottom, not under a rename box opened since | not under a create box opened since | R3 |
| 5 | `…catalogue-browser.test.ts:2349` | a refused rename left with Esc keeps the old name, one update sent | a refused Edit dialog left with Esc keeps "Drinks" in the row, one update sent | R3 |
| 5 | `apps/dashboard/src/widgets/category-form.test.ts:82` (`:89`; line numbers at d9cca52ea) | `management.request_invalid` with `field: "color"` is a refusal no field of the form shows, so it goes to the bottom message (`_form`) | removed from that list; the new case "puts a refused colour under the colour chooser…" expects `{ color: t("editor.field_rejected") }` for it, and for `category.invalid` `field: "color"` | Decision 9: the Edit dialog has a colour field, and a refused colour shows under it |
