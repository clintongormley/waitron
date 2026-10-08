# A435 step 1 — products archived for good (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archiving a product or variant becomes permanent: nothing switches it back on or changes
what it is, archiving is refused while a live or scheduled menu includes it, and the dashboard shows
an archived product's details in a read-only panel.

**Architecture:** One new catalogue module, `packages/catalogue/src/archive.ts`, owns archiving. It
finds the published menus that include a product and refuses with `product.on_live_menu`; it
performs the archive (the product, its variants, menu drafts, extras lists); and
`assertProductWritable` refuses a write to an archived row with `product.archived`. Every path that
archives — `patchProduct`, `saveProductEditor`, `writeProductVariants`, `deleteCatalogueItems` —
goes through it, and every path that changes what a product is calls `assertProductWritable`. The
dashboard swaps Disable/Enable for Archive/View; View opens a read-only details panel (owner,
2026-10-08), and the product editor never opens an archived product.

**Tech Stack:** TypeScript, drizzle on the venue's SQLite store (`node:sqlite`), Vitest (catalogue,
recipes and server: database suites; dashboard: browser mode in real headless Chromium), Lit.

**Spec:** `docs/superpowers/specs/2026-10-08-delete-and-archive-design.md`, section "Products".
Reviewed once against the spec by a fresh-context reviewer on 2026-10-08; its ten findings are
applied below.

## Global Constraints

- Branch `feat/a435-product-archive`, created with
  `python3 ~/workspace/tools/worktree.py new waitron feat/a435-product-archive --headless`.
- Every commit `git commit -s`; commit messages in plain English.
- Error codes: `product.archived { productId, field? }` and
  `product.on_live_menu { products: {id,name}[], menus: {id,name}[] }`. Each refusal test asserts
  the code and its params, never only that something threw.
- Every user-facing string has English and Spanish text.
- No backwards-compatibility or data-migration code (CLAUDE.md §3): products disabled today simply
  count as archived. No schema change and no migration in this step.
- **Writes this step refuses on an archived product or variant:** switching it on; the product
  editor save; `PATCH`-style updates through `updateProduct`; variant writes; adding it to an extras
  list; setting its course; setting its recipe. **Writes it leaves alone**, recorded in the spec by
  Task 9: translation fixes, the main reporting category, and folder moves (which carry archived
  products along with their folder).
- A test that needs an archived product ON a published menu (data from before this change, or the
  till's view of an archived item) writes `active = false` straight to the `products` row; it never
  archives through a path that now refuses.
- Coverage holds `98/98/98/95` in every package touched; close a gap with a test that asserts
  behaviour, never an ignore comment.
- Run focused tests while working; the pre-push hook and CI run the rest (CLAUDE.md §2). Browser
  suites: check `memory_pressure | grep free` first.
- An implementer past about 150 tool calls with its task unfinished stops at a passing or cleanly red
  point, commits, and hands over: done, left, files, each check's state.
- Comments only for an invariant or a non-obvious why; cut stale ones in files you touch.

## Review Focus

1. **An archive refused part-way leaves nothing written.** A `PATCH` that renames AND archives a
   product on a live menu leaves the old name. Task 2.
2. **A folder delete holding a product ALREADY archived but still on a live menu** is not refused
   and does not re-archive it. Task 2.
3. **A variant whose parent is archived while its own row is still on** refuses every write with
   `product.archived`. Task 2.
4. **A deleted menu's live version does not block an archive.** Task 1.
5. **A queued edition whose time has come but is unsettled counts as live; a cancelled one does
   not.** Task 1.

---

### Task 1: Find the published menus that include a product, and refuse archiving

**Files:**
- Create: `packages/catalogue/src/archive.ts`
- Modify: `packages/catalogue/src/errors.ts` (two codes, beside `product.not_found`)
- Test: `packages/catalogue/src/archive.test.ts` (new, pure), `packages/catalogue/src/archive.db.test.ts` (new)

**Interfaces — produces:**
- `documentProductIds(document: MenuDocument): Set<string>`
- `interface HoldingMenu { id: string; name: string }`
- `publishedMenusHolding(tx, productIds: readonly string[], at?: Date): Promise<Map<string, HoldingMenu[]>>`
- `assertOffPublishedMenus(tx, productIds: readonly string[]): Promise<void>`
- the two error codes above.

- [ ] **Step 1: Write the failing pure test** — `archive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { documentProductIds } from "./archive.js";
import type { MenuDocument } from "./menu-document-types.js";

const home: MenuDocument["home"] = {
  shortcuts: [],
  handheld: { columns: 3, tiles: "colours", order: "home_first" },
  till: { columns: 6, tiles: "colours", order: "home_first" },
};
const doc = (partial: Partial<MenuDocument>): MenuDocument =>
  ({ format: 3, menuId: "m", menuName: "M", root: { members: [] }, offers: {}, home, ...partial }) as MenuDocument;

describe("documentProductIds", () => {
  it("collects each dish, variant, extras item and home shortcut, and no option label", () => {
    const ids = documentProductIds(
      doc({
        offers: {
          o1: {
            productId: "dish",
            variants: [{ id: "size" }],
            offeredModifiers: [
              { kind: "extras", items: [{ productId: "extra" }] },
              { kind: "options", labels: [{ id: "label" }] },
            ],
          },
        } as unknown as MenuDocument["offers"],
        home: { ...home, shortcuts: [{ kind: "product", productId: "tile" }, { kind: "empty" }] },
      }),
    );
    expect([...ids].sort()).toEqual(["dish", "extra", "size", "tile"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail** —
  `pnpm --filter @waitron/catalogue exec vitest run src/archive.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write the codes and `archive.ts`.** In `errors.ts`, beside `"product.not_found"`:

```ts
    /** A write named an archived product or variant, or a variant of an archived product. Archiving
     * is permanent. `field` places the refusal where the body named the row. */
    "product.archived": { productId: string; field?: string };
    /** Archiving was refused: a menu version that is live, or queued to go live, includes these
     * products as a dish, a variant, an extras item or a home shortcut. */
    "product.on_live_menu": {
      products: { id: string; name: string }[];
      menus: { id: string; name: string }[];
    };
```

Create `archive.ts`:

```ts
import { and, eq, gt, inArray } from "drizzle-orm";
import { catalogues, now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import type { MenuDocument } from "./menu-document-types.js";
import { liveVersions } from "./menu-publication.js";
import { menuScheduledPublications, menuVersions } from "./schema/publication.js";
import "./errors.js";

export interface HoldingMenu {
  id: string;
  name: string;
}

/** Every product a published document can sell or show. */
export function documentProductIds(document: MenuDocument): Set<string> {
  const ids = new Set<string>();
  for (const offer of Object.values(document.offers)) {
    ids.add(offer.productId);
    for (const variant of offer.variants) ids.add(variant.id);
    for (const entry of offer.offeredModifiers)
      if (entry.kind === "extras") for (const item of entry.items) ids.add(item.productId);
  }
  for (const tile of document.home.shortcuts) if (tile.kind === "product") ids.add(tile.productId);
  return ids;
}

/**
 * For each of `productIds` that a served menu's live version, or a version queued to go live after
 * `at`, includes: those menus. A deleted menu is never served, so its versions do not count.
 */
export async function publishedMenusHolding(
  tx: Transaction,
  productIds: readonly string[],
  at: Date = now(),
): Promise<Map<string, HoldingMenu[]>> {
  const wanted = new Set(productIds);
  if (wanted.size === 0) return new Map();
  const documents: MenuDocument[] = [];
  for (const version of (await liveVersions(tx, undefined, "document", at)).values())
    documents.push(version.document!);
  for (const row of await tx
    .select({ document: menuVersions.document })
    .from(menuScheduledPublications)
    .innerJoin(menuVersions, eq(menuVersions.id, menuScheduledPublications.versionId))
    .where(
      and(
        eq(menuScheduledPublications.state, "queued"),
        gt(menuScheduledPublications.activatesAt, at),
      ),
    ))
    documents.push(row.document);
  const served = new Map(
    (
      await tx
        .select({ id: catalogues.id, name: catalogues.name })
        .from(catalogues)
        .where(eq(catalogues.active, true))
    ).map((row) => [row.id, row.name]),
  );
  const holding = new Map<string, Map<string, HoldingMenu>>();
  for (const document of documents) {
    const name = served.get(document.menuId);
    if (name === undefined) continue;
    for (const productId of documentProductIds(document)) {
      if (!wanted.has(productId)) continue;
      const menus = holding.get(productId) ?? new Map<string, HoldingMenu>();
      menus.set(document.menuId, { id: document.menuId, name });
      holding.set(productId, menus);
    }
  }
  return new Map(
    [...holding].map(([productId, menus]) => [
      productId,
      [...menus.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ]),
  );
}

/** Refuses `product.on_live_menu` when any of `productIds` is on a live or queued menu version. */
export async function assertOffPublishedMenus(
  tx: Transaction,
  productIds: readonly string[],
): Promise<void> {
  const holding = await publishedMenusHolding(tx, productIds);
  if (holding.size === 0) return;
  const names = new Map<string, string>();
  for (const batch of batches([...holding.keys()]))
    for (const row of await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, batch)))
      names.set(row.id, row.name);
  const menus = new Map<string, HoldingMenu>();
  for (const list of holding.values()) for (const menu of list) menus.set(menu.id, menu);
  throw new AppError("product.on_live_menu", {
    products: [...holding.keys()].map((id) => ({ id, name: names.get(id)! })),
    menus: [...menus.values()].sort((a, b) => a.name.localeCompare(b.name)),
  });
}
```

- [ ] **Step 4: Run the pure test** — PASS.

- [ ] **Step 5: Write the database tests** — `archive.db.test.ts`. `menusFixture`
  (`packages/catalogue/test/menus-fixture.ts`): Lunch ("Lunch Menu") holds Lemonade, its variant
  Large, and the extras item Extra lemon; Dinner holds Burger.

```ts
import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, product } from "../test/menus-fixture.js";
import { assertOffPublishedMenus, publishedMenusHolding } from "./archive.js";
import { addShortcut } from "./menu-home.js";
import { previewMenu, publishMenu } from "./menu-publication.js";
import { cancelMenuPublication, queueMenuPublication } from "./menu-schedule.js";
import { deactivateCatalogue } from "./operations.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const T0 = new Date("2026-10-08T10:00:00.000Z");
const later = new Date("2026-10-09T10:00:00.000Z");

async function publish(menuId: string, at = T0) {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  await app((tx) => publishMenu(tx, menuId, hash, "person-1", { at }));
}
async function queue(menuId: string, activatesAt: Date) {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  return app((tx) => queueMenuPublication(tx, menuId, hash, activatesAt, "person-1", { at: T0 }));
}
const holding = (ids: string[], at = T0) => app((tx) => publishedMenusHolding(tx, ids, at));
const menuIds = async (id: string, at = T0) => (await holding([id], at)).get(id)?.map((m) => m.id);

describe("publishedMenusHolding", () => {
  it("names the live menu for a dish, its variant and an extras item", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    for (const id of [f.lemonade, f.large, f.extraLemon]) expect(await menuIds(id)).toEqual([f.lunch]);
    expect(await menuIds(f.burger)).toBeUndefined(); // Dinner was never published
  });

  it("names the live menu for a home shortcut", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, product(f.lemonade)));
    await publish(f.lunch);
    expect(await menuIds(f.lemonade)).toEqual([f.lunch]);
  });

  it("counts a dish, a variant and an extras item on a version queued for later", async () => {
    const f = await menusFixture(fx.db);
    await queue(f.lunch, later);
    for (const id of [f.lemonade, f.large, f.extraLemon]) expect(await menuIds(id)).toEqual([f.lunch]);
  });

  it("counts a queued version whose time has come before it is settled", async () => {
    const f = await menusFixture(fx.db);
    await queue(f.dinner, later);
    expect(await menuIds(f.burger, new Date(later.getTime() + 60_000))).toEqual([f.dinner]);
  });

  it("does not count a cancelled queued version", async () => {
    const f = await menusFixture(fx.db);
    const edition = await queue(f.dinner, later);
    await app((tx) => cancelMenuPublication(tx, f.dinner, edition.versionId, "person-1", T0));
    expect(await menuIds(f.burger)).toBeUndefined();
  });

  it("does not count a deleted menu's live version", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => deactivateCatalogue(tx, f.dinner));
    expect(await menuIds(f.burger)).toBeUndefined();
  });
});

describe("assertOffPublishedMenus", () => {
  it("refuses with the products and menus", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await expect(app((tx) => assertOffPublishedMenus(tx, [f.lemonade, f.burger]))).rejects.toMatchObject({
      code: "product.on_live_menu",
      params: {
        products: [{ id: f.lemonade, name: expect.any(String) }],
        menus: [{ id: f.lunch, name: "Lunch Menu" }],
      },
    });
  });
  it("passes a product no published menu includes", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) => assertOffPublishedMenus(tx, [f.burger]));
  });
});
```

If `addShortcut`'s menu-reach rule needs Lemonade's section rather than Lunch's root, read
`menu-home.test.ts` for the shape it uses and follow it.

- [ ] **Step 6: Run, then prove each test by breaking its code** —
  `pnpm --filter @waitron/catalogue exec vitest run src/archive.db.test.ts` (PASS). Remove in turn
  the queued-versions read, the `served` filter, the variants loop and the extras loop; rerun; see
  the matching test fail; restore.

- [ ] **Step 7: Commit**

```bash
git add packages/catalogue/src/archive.ts packages/catalogue/src/archive.test.ts \
  packages/catalogue/src/archive.db.test.ts packages/catalogue/src/errors.ts
git commit -s -m "Catalogue: find the live and scheduled menus that include a product, and refuse archiving it"
```

---

### Task 2: One archive path; refuse writes to an archived product

**Files:**
- Modify: `packages/catalogue/src/archive.ts` (add `markInactive` — moved here —,
  `removeFromExtraLists`, `archiveProducts`, `assertProductWritable`)
- Modify: `packages/catalogue/src/operations.ts` (`patchProduct`, `deactivateProduct`; delete
  `markInactive`)
- Modify: `packages/catalogue/src/product-editor.ts` (`saveProductEditor`)
- Modify: `packages/catalogue/src/catalogue-items.ts` (`deleteCatalogueItems`)
- Modify: `packages/catalogue/src/index.ts` (export `assertProductWritable`)
- Test: `packages/catalogue/src/archive.db.test.ts`

**Interfaces:**
- Consumes: `assertOffPublishedMenus` (Task 1).
- Produces:
  - `markInactive(tx, ids: readonly string[]): Promise<void>` (unchanged signature, new home)
  - `removeFromExtraLists(tx, productIds: readonly string[]): Promise<void>`
  - `archiveProducts(tx, ids: readonly string[]): Promise<void>`
  - `assertProductWritable(tx, productId: string): Promise<void>` — exported from the package.

- [ ] **Step 1: Write the failing tests** (append to `archive.db.test.ts`; add imports
  `updateProduct` from `./operations.js`, `listProductVariants` from `./variants.js`,
  `readProductEditor`, `saveProductEditor` from `./product-editor.js`, `deleteCatalogueItems` from
  `./catalogue-items.js`, `extraListItems` from `./schema/extras.js`, `products` from
  `@waitron/db`, `eq` from `drizzle-orm`):

```ts
const archived = (productId: string) => ({ code: "product.archived", params: { productId } });
const switchOff = (id: string) =>
  app((tx) => tx.update(products).set({ active: false }).where(eq(products.id, id)));
const row = async (id: string) =>
  (await app((tx) =>
    tx.select({ name: products.name, active: products.active }).from(products).where(eq(products.id, id)),
  ))[0];

describe("archiving", () => {
  it("archives a product and every variant still on", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.lemonade, { active: false }));
    const variants = await app((tx) => listProductVariants(tx, f.lemonade));
    expect(variants.map((v) => v.active)).toEqual(variants.map(() => false));
  });

  it("takes an archived product out of every extras list", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.extraLemon, { active: false }));
    expect(
      await app((tx) => tx.select().from(extraListItems).where(eq(extraListItems.productId, f.extraLemon))),
    ).toEqual([]);
  });

  it("refuses archiving a product on a live menu and writes nothing", async () => {
    const f = await menusFixture(fx.db);
    const before = await row(f.lemonade);
    await publish(f.lunch);
    await expect(
      app((tx) => updateProduct(tx, f.lemonade, { name: "Renamed", active: false })),
    ).rejects.toMatchObject({ code: "product.on_live_menu" });
    expect(await row(f.lemonade)).toEqual(before);
  });

  it("refuses switching an archived product back on, and any other edit", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.burger, { active: false }));
    await expect(app((tx) => updateProduct(tx, f.burger, { active: true }))).rejects.toMatchObject(archived(f.burger));
    await expect(app((tx) => updateProduct(tx, f.burger, { unitPrice: "9" }))).rejects.toMatchObject(archived(f.burger));
  });

  it("refuses a write to a variant whose product is archived but whose own row is on", async () => {
    const f = await menusFixture(fx.db);
    await switchOff(f.lemonade);
    await expect(app((tx) => updateProduct(tx, f.large, { unitPrice: "3" }))).rejects.toMatchObject(archived(f.large));
  });

  it("refuses every editor save of an archived product", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.burger, { active: false }));
    const value = await app((tx) => readProductEditor(tx, f.burger));
    await expect(
      app((tx) => saveProductEditor(tx, f.burger, f.dinner, { ...value, active: true }, "en")),
    ).rejects.toMatchObject(archived(f.burger));
  });

  it("an editor save that archives writes nothing else it carries", async () => {
    const f = await menusFixture(fx.db);
    const value = await app((tx) => readProductEditor(tx, f.lemonade));
    await app((tx) =>
      saveProductEditor(
        tx,
        f.lemonade,
        f.dinner,
        { ...value, active: false, name: "Renamed", variants: value.variants.map((v) => ({ ...v, name: `${v.name} x` })) },
        "en",
      ),
    );
    const after = await app((tx) => readProductEditor(tx, f.lemonade));
    expect(after.active).toBe(false);
    expect(after.name).toBe(value.name);
    expect(after.variants.map((v) => v.name)).toEqual(value.variants.map((v) => v.name));
  });

  it("a folder delete refuses when a product inside is on a live menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await expect(
      app((tx) => deleteCatalogueItems(tx, { productIds: [f.lemonade], categoryIds: [] }, "move_up")),
    ).rejects.toMatchObject({ code: "product.on_live_menu" });
  });

  it("a folder delete passes over a product already off while still on a live menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await switchOff(f.lemonade);
    await app((tx) => deleteCatalogueItems(tx, { productIds: [f.lemonade], categoryIds: [] }, "move_up"));
  });
});
```

`saveProductEditor` reads its `catalogueId` argument only when creating, so any catalogue id
serves for an update.

- [ ] **Step 2: Run to see the new cases fail** —
  `pnpm --filter @waitron/catalogue exec vitest run src/archive.db.test.ts`.

- [ ] **Step 3: Add to `archive.ts`** (imports: `takeOffMenus`, `dropMenuPrices` from
  `./menu-removal.js`; `extraListItems` from `./schema/extras.js`; `readUpdatedName` from
  `./product-names.js`):

```ts
/** Sets the products Inactive and nothing else: the caller takes them off menus. */
export async function markInactive(tx: Transaction, ids: readonly string[]): Promise<void> {
  for (const batch of batches(ids))
    await tx
      .update(products)
      .set({ active: false, updatedAt: now() })
      .where(inArray(products.id, batch));
}

/** Deletes every extras-list item offering any of the products; a variant can be an item too. */
export async function removeFromExtraLists(
  tx: Transaction,
  productIds: readonly string[],
): Promise<void> {
  for (const batch of batches(productIds))
    await tx.delete(extraListItems).where(inArray(extraListItems.productId, batch));
}

/** Refuses `product.archived` when the product, or its parent, is archived. A missing row is left
 * to the caller's own not-found. */
export async function assertProductWritable(tx: Transaction, productId: string): Promise<void> {
  const row = await readUpdatedName(tx, productId);
  if (row !== undefined && (!row.active || row.parentActive === false))
    throw new AppError("product.archived", { productId });
}

/**
 * Archives each named product or variant still on, with every variant still on of each named
 * product: refused with `product.on_live_menu` before anything is written, then taken off menu
 * drafts and extras lists. A row already off is passed over, whatever menu still shows it.
 */
export async function archiveProducts(tx: Transaction, ids: readonly string[]): Promise<void> {
  const named: { id: string; parentId: string | null; active: boolean }[] = [];
  for (const batch of batches(ids))
    named.push(
      ...(await tx
        .select({ id: products.id, parentId: products.parentId, active: products.active })
        .from(products)
        .where(inArray(products.id, batch))),
    );
  const dishes = named.filter((r) => r.active && r.parentId === null).map((r) => r.id);
  const variants = new Set(named.filter((r) => r.active && r.parentId !== null).map((r) => r.id));
  for (const batch of batches(dishes))
    for (const variant of await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.parentId, batch), eq(products.active, true))))
      variants.add(variant.id);
  const all = [...dishes, ...variants];
  await assertOffPublishedMenus(tx, all);
  await markInactive(tx, all);
  await removeFromExtraLists(tx, all);
  await takeOffMenus(tx, dishes);
  await dropMenuPrices(tx, [...variants]);
}
```

`readUpdatedName` must not create an import cycle problem: `product-names.ts` does not import
`archive.ts`. In `operations.ts` delete `markInactive`, import `archiveProducts` and
`assertProductWritable` from `./archive.js`, and make `deactivateProduct` call
`archiveProducts(tx, [id])`. Point every other importer of `markInactive`
(`grep -rn "markInactive" packages/catalogue/src`) at `./archive.js`. Export
`assertProductWritable` from `packages/catalogue/src/index.ts` beside the other product exports.

- [ ] **Step 4: Change `patchProduct`** (`operations.ts`). Replace its first two lines with:

```ts
  const namesChange = checkNames && (patch.name !== undefined || patch.active !== undefined);
  const row = await readUpdatedName(tx, id);
  if (row !== undefined && (!row.active || row.parentActive === false))
    throw new AppError("product.archived", { productId: id });
  // Before the row is written: archiveProducts passes over a row already off.
  if (patch.active === false && row?.active === true) await archiveProducts(tx, [id]);
```

Keep the `assertNotOfferedAsExtra` / `assertUpdatedNamesFree` lines that follow. Delete the tail
that ran `takeOffMenus` / `dropMenuPrices` on a change from Active, and drop those imports if
unused.

- [ ] **Step 5: Change `saveProductEditor`** (`product-editor.ts`). Replace the stored-row select
  with `const product = await readUpdatedName(tx, productId);` (it carries `id`, `name`, `active`,
  `parentId` and `parentActive`, covering `StoredName`), then:

```ts
    if (!product) throw new AppError("product.not_found", { productId });
    if (!product.active || product.parentActive === false)
      throw new AppError("product.archived", { productId });
```

After `parseProductEditorInput` and the `parentId` check, add:

```ts
  // An archiving save archives and writes nothing else it carries: the dashboard sends the stored
  // value back with `active: false`, and its variants and options must not be rewritten onto an
  // archived row.
  if (productId !== null && !value.active) {
    await archiveProducts(tx, [productId]);
    return readProductEditor(tx, productId);
  }
```

- [ ] **Step 6: Change `deleteCatalogueItems`** (`catalogue-items.ts`): collect every product the
  deletion reaches first — the selection's `productIds`, and for a `delete` of contents each
  selected subtree's top-level products, read exactly as the loop reads them today — then call
  `await archiveProducts(tx, reached)` once, before the folder loops vacate or remove anything. Drop
  the `markInactive` calls and the final `takeOffMenus`.

- [ ] **Step 7: Run** — `pnpm --filter @waitron/catalogue exec vitest run src/archive.db.test.ts`.
  PASS. Do not fix other suites here; Task 4 does.

- [ ] **Step 8: Commit**

```bash
git add packages/catalogue/src
git commit -s -m "Catalogue: one archive path that refuses a live menu, and no writes to an archived product"
```

---

### Task 3: Variants and extras lists

**Files:**
- Modify: `packages/catalogue/src/variants.ts` (`writeProductVariants`)
- Modify: `packages/catalogue/src/extras.ts` (`assertProductsExist`)
- Test: `packages/catalogue/src/archive.db.test.ts`

**Interfaces — consumes:** `assertOffPublishedMenus`, `removeFromExtraLists` (Tasks 1–2).

The rule for an archived variant named in a variants write: sent with `active: true` it is refused;
sent with `active: false` it is accepted and NOTHING is written to it, so reading the editor value
and saving it back unchanged keeps working and the body's row positions still match the editor's
rows (`product-editor.ts` maps `variants.N` errors by position).

- [ ] **Step 1: Write the failing tests** (append; import `setProductVariants` from
  `./variants.js`, `createExtraList` from `./extras.js`):

```ts
describe("variants and extras", () => {
  it("refuses switching an archived variant back on", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.large, { active: false }));
    const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
    await expect(
      app((tx) => setProductVariants(tx, f.lemonade, [{ ...large!, active: true }], "en")),
    ).rejects.toMatchObject({ code: "product.archived", params: { productId: f.large, field: "variants.0.active" } });
  });

  it("accepts an archived variant sent back unchanged, and writes nothing to it", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.large, { active: false }));
    const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
    await app((tx) =>
      setProductVariants(tx, f.lemonade, [{ ...large!, active: false, name: "Changed" }], "en"),
    );
    const [after] = await app((tx) => listProductVariants(tx, f.lemonade));
    expect(after).toMatchObject({ id: f.large, name: large!.name, active: false });
  });

  it("refuses a variants write to an archived product", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.lemonade, { active: false }));
    await expect(app((tx) => setProductVariants(tx, f.lemonade, [], "en"))).rejects.toMatchObject(
      archived(f.lemonade),
    );
  });

  it("refuses archiving a variant a live menu offers, by switching it off or leaving it out", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
    for (const inputs of [[{ ...large!, active: false }], []])
      await expect(app((tx) => setProductVariants(tx, f.lemonade, inputs, "en"))).rejects.toMatchObject({
        code: "product.on_live_menu",
      });
  });

  it("takes a variant switched off by a variants write out of extras lists", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => createExtraList(tx, { name: "Sizes", items: [{ productId: f.large }] }, "en"));
    const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
    await app((tx) => setProductVariants(tx, f.lemonade, [{ ...large!, active: false }], "en"));
    expect(
      await app((tx) => tx.select().from(extraListItems).where(eq(extraListItems.productId, f.large))),
    ).toEqual([]);
  });

  it("refuses adding an archived product to an extras list", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.extraLemon, { active: false }));
    await expect(
      app((tx) =>
        createExtraList(
          tx,
          {
            name: "More extras",
            customerName: { en: "Add more" },
            kitchenName: "MORE",
            minPicks: 0,
            maxPicks: 1,
            items: [{ productId: f.extraLemon, price: "0.40" }],
          },
          "en",
        ),
      ),
    ).rejects.toMatchObject({
      code: "product.archived",
      params: { productId: f.extraLemon, field: "items.0.productId" },
    });
  });
});
```

The list body follows `extras.test.ts`'s "offers a variant itself as an item"; Lunch is not
published in this case, so the archive is not refused.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Change `writeProductVariants`** (`variants.ts`).

After `const parent = await assertProductForWrite(tx, productId);`:

```ts
  if (!parent.active) throw new AppError("product.archived", { productId });
```

After the loop refusing `product.variant_not_found`:

```ts
  const archivedOn = normalized.findIndex(
    (input) => input.id !== undefined && currentActive.get(input.id) === false && input.active,
  );
  if (archivedOn !== -1)
    throw new AppError("product.archived", {
      productId: normalized[archivedOn]!.id!,
      field: `variants.${archivedOn}.active`,
    });
  const left = current.filter((variant) => !seen.has(variant.id));
  const madeInactive = [
    ...normalized.flatMap((input) =>
      input.id !== undefined && !input.active && currentActive.get(input.id) ? [input.id] : [],
    ),
    ...left.filter((variant) => variant.active).map((variant) => variant.id),
  ];
  if (madeInactive.length > 0) await assertOffPublishedMenus(tx, madeInactive);
```

In the write loop, skip a row that was archived before this write:

```ts
    if (input.id !== undefined && currentActive.get(input.id) === false) continue;
```

Delete the later `left` / `madeInactive` declarations; keep the loop over `left` and, after it:

```ts
  if (madeInactive.length > 0) {
    await dropMenuPrices(tx, madeInactive);
    await removeFromExtraLists(tx, madeInactive);
  }
```

The `assertContentTranslations` check in the normalising loop already skips inactive variants, so an
archived variant's stale customer name never blocks a save.

- [ ] **Step 4: Change `assertProductsExist`** (`extras.ts`):

```ts
  const rows = await tx
    .select({ id: products.id, active: products.active })
    .from(products)
    .where(inArray(products.id, named));
  const held = new Map(rows.map((row) => [row.id, row.active]));
  const at = input.items.findIndex((item) => !held.has(item.productId));
  if (at !== -1) throw new AppError("extras.invalid", { field: `items.${at}.productId` });
  const archived = input.items.findIndex((item) => held.get(item.productId) === false);
  if (archived !== -1)
    throw new AppError("product.archived", {
      productId: input.items[archived]!.productId,
      field: `items.${archived}.productId`,
    });
```

and say in its comment that it refuses an archived product too.

- [ ] **Step 5: Run** `src/archive.db.test.ts` — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src
git commit -s -m "Catalogue: no variants write brings an archived variant back, and extras lists refuse archived products"
```

---

### Task 4: Bring the other catalogue, recipes and venue-service suites in line

**Files:** tests only, plus `packages/recipes/src/recipes.ts` (`setProductRecipe`).

- [ ] **Step 1: Recipes refuse an archived product.** Add a failing case to the recipes suite
  (`grep -ln "setProductRecipe" packages/recipes/src/*.test.ts`): `setProductRecipe` on an archived
  product rejects with `product.archived`. Then at the top of `setProductRecipe` call
  `await assertProductWritable(tx, productId);` (imported from `@waitron/catalogue`). Run the recipes
  suite.

- [ ] **Step 2: Run `pnpm --filter @waitron/catalogue test`** and fix every failure. A test that
  asserted a restore or re-enable becomes a refusal test asserting `product.archived` — never delete
  one. A test that needs an archived product on a published menu writes `active = false` straight to
  the row (Global Constraints). Known, as of `main` 49a80d770:
  - `product-names.db.test.ts:108, 111, 138, 145, 152, 218, 222`
  - `menu-removal.test.ts:193, 537–538`
  - `active-available.test.ts:114`; `menu-structure.test.ts:523`
  - `product-editor.test.ts:267, 283, 1003`
  - `variants.db.test.ts:290, 384, 649, 698`
  - `operations.test.ts:674`
  - `menu-publication.test.ts:1430, 1456, 1502–1503, 2214, 2432`; `menu-document.test.ts:249, 562`
  - `configuration-transfer.test.ts:133, 411–440` (export and import of archived products: should
    pass unchanged — confirm)

- [ ] **Step 3: Run `pnpm --filter @waitron/venue-service exec vitest run src/category-dependencies.test.ts`**
  and fix `:105` (it switches a product back on after a folder delete) the same way.

- [ ] **Step 4: Coverage** — `pnpm --filter @waitron/catalogue test:coverage`; read the per-file
  rows for `archive.ts`, `variants.ts`, `extras.ts`, `operations.ts`, `product-editor.ts`,
  `catalogue-items.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -s -m "Catalogue and recipes: tests that restored archived products now expect the refusal"
```

---

### Task 5: Server routes

**Files:**
- Modify: `apps/server/src/catalogue-api.ts` (status map; the editor route), `apps/server/src/kitchen.ts`
  (`setProductCourse`), every other status map naming catalogue product codes
- Test: `apps/server/src/catalogue-api.test.ts`, the course route's suite

- [ ] **Step 1: Write the failing route tests** in `catalogue-api.test.ts`, with its own helpers:
  - `PUT /management-api/products/:id/editor` with `active: true` on an archived product → **409**,
    `code: "product.archived"`.
  - The same route archiving a product on a published menu → **409**, `product.on_live_menu`,
    `params.menus` naming the menu.
  - The same route archiving a product whose stored course is then switched off answers **200** and
    leaves the product archived: the archive does not run the routing step.
  - `POST /management-api/folders/delete` with a product on a published menu → **409**
    `product.on_live_menu`.
  - The extras-list create route naming an archived product → **409** `product.archived`.
  - `PUT /management-api/products/:id/course` on an archived product → **409** `product.archived`.

- [ ] **Step 2: Run to see them fail** —
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`.

- [ ] **Step 3: Implement.**
  - Status map: `"product.archived": 409, "product.on_live_menu": 409`. Then
    `grep -rn '"product.name_taken"' apps/server/src` and add both to each map whose routes can
    reach an archive or an archived write (`setup-api.ts` has one); say in the commit which maps
    you left and why.
  - Editor route: run `applyRouting` only when the saved product is on —
    `return product.active ? applyRouting(tx, product, routing) : product;`
  - `setProductCourse` (`kitchen.ts`): call `assertProductWritable(tx, productId)` first. Check the
    course route's status map answers 409 for `product.archived`.

- [ ] **Step 4: Run** the two suites, then `pnpm exec vitest run scripts/errors-reachable.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -s -m "Server: archiving refusals answer 409, and an archiving save skips the routing step"
```

---

### Task 6: Server suites, and the till never sells an archived item

**Files:** `apps/server/src/*.test.ts`

- [ ] **Step 1: The spec's selling test.** In `working-order.test.ts` (beside the case at `:1987` as
  of 49a80d770), add one case per kind — an archived DISH, an archived VARIANT and an archived
  EXTRAS ITEM, each with `available` still true and each switched off by a direct row write while on
  the published menu: adding it to an order is refused with `product.unavailable` (or
  `product.variant_unavailable` for the variant), and an unsent line already holding it makes
  payment refuse `product.unavailable`. Run it; it should PASS already (the readers require on AND
  available). Prove it by deleting `products.active` from `productSellable`
  (`working-order.ts`) — the dish case must fail — and restore.

- [ ] **Step 2: Run the server suites that archive** —
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/till-sale.test.ts src/working-order.test.ts`
  and fix each failure: a set-up that archives a product on a published menu switches it off by a
  direct row write instead; a reactivation becomes a `product.archived` refusal. Known:
  `till-sale.test.ts:2105`, `working-order.test.ts:1987`,
  `catalogue-api.test.ts:1303, 2178, 2250, 2293, 2316, 2370, 2483, 2577, 2613`.

- [ ] **Step 3: Find the rest** —
  `grep -rln "active: false\|active: true" apps/server/src --include='*.test.ts' | xargs grep -ln "product"`
  and run each listed suite; fix the same way.

- [ ] **Step 4: Commit**

```bash
git add apps/server
git commit -s -m "Server: tests set archived products up directly, and pin that the till never sells one"
```

---

### Task 7: Dashboard words, product list and the catalogue screen's dialogs

**Files:**
- Modify: `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`,
  `apps/dashboard/src/i18n/domain.ts`, `apps/dashboard/src/screens/units-screen.ts`
- Create: `apps/dashboard/src/widgets/archive-refusal.ts`
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts`, `apps/dashboard/src/widgets/product-list.ts`
- Test: `screens/catalogue-screen.test.ts`, `widgets/product-list.test.ts`, `widgets/archive-refusal.test.ts` (new)

- [ ] **Step 1: Strings** (`strings.ts`):

| Key | English | Spanish |
|---|---|---|
| `product.archive` | Archive | Archivar |
| `product.view` | View | Ver |
| `product.archive_named` | Archive {name} | Archivar {name} |
| `product.archive_variant_named` | Archive {name} | Archivar {name} |
| `product.archive_warning` | This can't be undone. The till stops selling the product, it comes off the extras lists that offer it, and it cannot be brought back. Its past sales are kept, and a new product can take its name. | No se puede deshacer. La caja deja de vender el producto, sale de las listas de extras que lo ofrecen y no se puede recuperar. Sus ventas pasadas se conservan y un producto nuevo puede usar su nombre. |
| `product.archive_variant_warning` | This can't be undone. The till stops offering the variant, and it cannot be brought back. Its past sales are kept. | No se puede deshacer. La caja deja de ofrecer la variante y no se puede recuperar. Sus ventas pasadas se conservan. |
| `product.archived_badge` | Archived | Archivado |
| `product.variant_archived_badge` | Archived | Archivada |
| `product.archived_notice` | This product is archived. You can look at it but not change it. | Este producto está archivado. Puedes consultarlo, pero no modificarlo. |

Keep `product.off_menus*`. Point `domain.ts:180–181` (status names) and `units-screen.ts:407` at
`product.archived_badge` / `product.variant_archived_badge`. Delete `product.disabled_badge`,
`product.variant_disabled_badge`, `product.disable_named`, `product.disable_variant_named`,
`product.disable_warning`, `product.disable_variant_warning`, `product.enable` and
`product.disabled_notice` once `grep -rn` finds no reader (the editor and variant table are Task 9's;
leave a key they still read for Task 9 to delete).

`codes.ts` (no trailing colon — the names are appended by the helper):

```ts
  "product.archived": {
    en: "This product is archived and can no longer be changed.",
    es: "Este producto está archivado y ya no se puede modificar.",
  },
  "product.on_live_menu": {
    en: "It is on a live or scheduled menu. Take it off the menu and publish, then archive it.",
    es: "Está en un menú publicado o programado. Quítalo del menú y publica; después archívalo.",
  },
```

- [ ] **Step 2: The refusal helper, test first.** `archive-refusal.test.ts`:
  `refusalText("product.on_live_menu", params)` returns the code's sentence followed by
  ` Menus: Dinner, Lunch Menu.` — and, when `params.products` holds more than one product,
  ` Products: A, B.` before the menus; `refusalText("product.offered_as_extra", params)` keeps
  today's behaviour (sentence plus list names); any other code returns `codeMessage(code)`. Add the
  words "Menus" / "Menús" and "Products" / "Productos" as strings (`product.refusal_menus`,
  `product.refusal_products`). Implement `refusalText(code: string, params: unknown): string` in
  `archive-refusal.ts` by moving `extraListNames` and `refusalText` out of `catalogue-screen.ts`;
  the screen keeps the error's `params` instead of the extracted list names.

- [ ] **Step 3: Write the failing screen and list tests.**
  - `product-list.test.ts`: a row is archived when `rowActive` says so (a variant of an archived
    product counts as archived); an archived row's actions hold only **View** (emits
    `view-product`); an active row's hold Edit and **Archive** (emits `delete-product`); the Status
    filter offers "Active" and "Archived".
  - `catalogue-screen.test.ts`: the archive dialog's heading and warning use the archive keys and
    its confirm button reads Archive; a `product.on_live_menu` refusal in that dialog shows the
    sentence and the menu names; the same refusal from an editor save that switched a variant off
    (the screen's general save path) shows them too; no restore path remains — turn each restore
    case into "an archived row offers View only".

- [ ] **Step 4: Run to see them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/screens/catalogue-screen.test.ts src/widgets/archive-refusal.test.ts`.

- [ ] **Step 5: Implement.**
  - `product-list.ts` actions column: decide with `rowActive(row)`, not the row's own flag. Archived:
    one button View (`data-test="view-${id}"`, event `view-product`; Task 9 wires the screen). Active: Edit and a danger
    Archive (`data-test="delete-${id}"`, event `delete-product`). Remove `restore-product`. The
    status cell and filter labels use the archived badge keys.
  - `catalogue-screen.ts`: delete `#restoreProduct` and the `@restore-product` listener; the delete
    dialog uses the archive keys; every place that showed a refusal through `refusalText` (the
    dialog's error and the general error at the editor save path) passes the code and its params to
    the new helper.

- [ ] **Step 6: Run** the same command, then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/catalogue src/widgets/product-list src/screens/units`.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard
git commit -s -m "Dashboard: Archive replaces Disable for products, and the live-menu refusal names the menus"
```

---

### Task 8: Dashboard folder actions and the extras-list picker

**Files:** `apps/dashboard/src/widgets/catalogue-browser.ts`, `apps/dashboard/src/widgets/extra-list-form.ts`,
`apps/dashboard/src/i18n/strings.ts`; tests `widgets/catalogue-browser.test.ts`, `widgets/extra-list-form.test.ts`

- [ ] **Step 1: Strings.**

| Key | English | Spanish |
|---|---|---|
| `folders.archive_products_heading` | Archive {count} products? | ¿Archivar {count} productos? |
| `folders.archive_products_heading_one` | Archive 1 product? | ¿Archivar 1 producto? |
| `folders.archive_products_body` | This can't be undone. The till stops selling the products, they come off the extras lists that offer them, and they cannot be brought back. Their past sales are kept. | No se puede deshacer. La caja deja de vender los productos, salen de las listas de extras que los ofrecen y no se pueden recuperar. Sus ventas pasadas se conservan. |
| `folders.also_archives` | archives {products} | archiva {products} |
| `folders.delete_off_menus` | Products archived by this deletion come off every menu they are on. | Los productos archivados por esta eliminación salen de todos los menús en los que están. |

Delete `folders.disable_products_heading(_one)`, `folders.disable_products_body`,
`folders.also_disables` once unread.

- [ ] **Step 2: Failing tests.** `catalogue-browser.test.ts`: the bulk action, heading and body read
  Archive; a `product.on_live_menu` refusal shows the products and menus through `refusalText`.
  `extra-list-form.test.ts`: the picker leaves archived products out.

- [ ] **Step 3: Run to see them fail; implement** (the browser's labels and its refusal text through
  `refusalText`; the picker filters to `active` products, `extra-list-form.ts` near the product list
  it builds); **run to PASS**:
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser.test.ts src/widgets/extra-list-form.test.ts`.

- [ ] **Step 4: Look at it** on the dev stack (`wa-wt demo waitron-feat-a435-product-archive`):
  archive one product not on a live menu and one that is, from the list and from a folder; open the
  Archived filter; phone width; both themes. Say what you saw in the commit message.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard
git commit -s -m "Dashboard: folder actions archive, and the extras picker leaves archived products out"
```

---

### Task 9: A read-only details panel for an archived product

**Files:**
- Create: `apps/dashboard/src/widgets/product-details.ts` (`<dashboard-product-details>`)
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts`, `apps/dashboard/src/i18n/strings.ts`
- Test: `widgets/product-details.test.ts`, `widgets/product-details.a11y.test.ts` (new),
  `screens/catalogue-screen.test.ts`

The owner chose a details panel over a greyed-out editor (2026-10-08): View shows the product as
plain text, not as a form. The editor is never opened for an archived product.

**Interfaces:**
- `<dashboard-product-details>` properties: `open: boolean`, `value: ProductEditorValue | null`
  (as `getProductEditor` returns it), `categories: CategorySummary[]`,
  `extraLists: ModifierListChoice[]`, `optionLists: ModifierListChoice[]` (the same types the
  editor takes — read them from `product-editor.ts`'s properties). Event: `wt-close`
  (`bubbles: true, composed: true`), from its Close button, the modal's close button and Escape.

- [ ] **Step 1: Strings** — the panel's heading is the product's staff name, so it needs no key.
  Add only what the panel labels that `strings.ts` does not already hold (reuse the
  editor's field labels — `editor.*`, `product.price`, `product.allergens` — wherever one exists;
  `grep -n` before adding). Every new key has English and Spanish.

- [ ] **Step 2: Failing tests.**
  - `product-details.test.ts`: given a value, it shows the staff name as the heading, the
    `product.archived_notice` sentence, then as a definition list: customer name per language,
    kitchen name, price with its unit, VAT class, category (by name, from `categories`), each
    variant (name and price; its own archived badge), allergens, and the options and extras lists
    attached (by name). A field with no value is left out rather than shown blank. There is no input,
    no switch and no Save. Close, the modal's close button and Escape each emit `wt-close`.
  - A fixture whose staff, customer and kitchen names are three DIFFERENT texts (CLAUDE.md §3), so
    a label reading the wrong name fails.
  - `product-details.a11y.test.ts`: axe over the open panel, both themes.
  - `catalogue-screen.test.ts`: View on an archived row (and on a variant of an archived product)
    opens the panel, not the editor; opening an archived product by its link (the `?product=` deep
    link `#openProduct` serves) opens the panel too; an active product still opens the editor.

- [ ] **Step 3: Run to see them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-details src/screens/catalogue-screen.test.ts`.

- [ ] **Step 4: Implement.** The panel is a `wt-modal` holding a `<dl>`; every colour, space and
  font reads a `--wt-*` token. The screen listens for `view-product`, reads the value with
  `getProductEditor` (passive read, as other automatic reads are), and opens the panel; in
  `#openProduct`, a value with `active: false` goes to the panel instead of the editor.

- [ ] **Step 5: Run** the same command, then `src/screens/catalogue src/widgets/product-list`.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard
git commit -s -m "Dashboard: View opens an archived product's details as a read-only panel"
```

---

### Task 9b: Variants archive on save in the editor

**Files:** `apps/dashboard/src/widgets/product-editor.ts`, `apps/dashboard/src/widgets/variant-table.ts`,
`apps/dashboard/src/i18n/strings.ts`, `docs/superpowers/specs/2026-10-08-delete-and-archive-design.md`;
tests `widgets/product-editor.test.ts`, `widgets/product-editor.save-state.test.ts`,
`widgets/variant-table.test.ts`

- [ ] **Step 1: Strings.**

| Key | English | Spanish |
|---|---|---|
| `product.variant_archive_pending_badge` | Archived when saved | Se archivará al guardar |
| `product.keep_variant` | Keep | Conservar |

Delete `editor.show_disabled`, `editor.show_disabled_one`, `editor.hide_disabled`, and the Task 7
leftovers (`product.disable`, `product.enable`, `product.disabled_notice`,
`product.variant_disabled_badge`) once unread.

- [ ] **Step 2: Failing tests.**
  - `product-editor.test.ts`: there is no Enable button for any value; a saved variant archived in
    this draft is submitted with `active: false`; a variant archived before is submitted unchanged
    at its own position (the server accepts it and writes nothing to it, Task 3).
  - `variant-table.test.ts`: a variant whose id is in `archivedIds` is not drawn; a saved variant
    switched off in this draft shows "Archived when saved" and a Keep action (emits `wt-restore`);
    an active saved variant's danger action reads Archive; an unsaved one's reads Remove; there is no
    show/hide toggle.

- [ ] **Step 3: Run to see them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts src/widgets/variant-table.test.ts`.

- [ ] **Step 4: Implement.**
  - `product-editor.ts`: delete the Enable button, the inactive notice, and the `restore` parameter
    of `save` and `submissionValue`. Remove the show/hide-inactive toggle and `showInactive`. Pass
    `.archivedIds=${new Set((this.value?.variants ?? []).filter((v) => !v.active).map((v) => v.id))}`
    to the table.
  - `variant-table.ts`: `@property({ attribute: false }) archivedIds: ReadonlySet<string> = new Set();`.
    Skip rows whose id is in it, keeping every other row's index as its position in the whole list
    (every row action reports that index). A saved row switched off in the draft: badge
    `product.variant_archive_pending_badge`, action `restore` labelled `product.keep_variant`. An
    active saved row's danger action reads `product.archive`. Remove `showInactive` and its event.

- [ ] **Step 5: Run** the same command, then
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor src/widgets/variant-table src/screens/catalogue`.

- [ ] **Step 6: Look at it** on the dev stack: View an archived product, archive a variant in the
  editor and Keep it, then archive one and save; phone width; both themes.

- [ ] **Step 7: Correct the spec**, Products section, where this step settled it: View opens a
  read-only details panel, not the editor; the editor footer gains no Archive (archiving is from the
  product list, a folder and the variant table); the editor shows no archived variants and loses
  its "show disabled" toggle; the writes this step leaves alone (translation fixes, the main
  reporting category, folder moves); the archive warning names extras lists rather than counting
  them.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard docs/superpowers/specs
git commit -s -m "Dashboard: variants archive on save in the editor, with Keep to undo before saving"
```

---

### Task 10: Documentation

- [ ] **Step 1:** Update A435 in `docs/backlog.md`: step 1 built on this branch; steps 2–6 open,
  printers next. Each point this branch left open becomes its own short catalogue entry.
- [ ] **Step 2:** Find claims the change retired —
  `grep -rn -i "enable it again\|restore.*product\|re-\?activat" docs/developers docs/backlog.md docs/backlog/catalogue.md`
  — and fix each that describes the old behaviour.
- [ ] **Step 3: Commit**

```bash
git add docs
git commit -s -m "Docs: A435 step 1 built — products are archived for good"
```
