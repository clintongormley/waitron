# A435 step 1 — products archived for good (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archiving a product or variant becomes permanent: nothing can switch it back on or edit
it, archiving is refused while a live or scheduled menu includes it, and the dashboard shows
archived products read-only.

**Architecture:** One new catalogue module, `packages/catalogue/src/archive.ts`, owns archiving: it
finds the published menus that include a product, refuses with `product.on_live_menu`, and performs
the archive (product, its variants, menus, extras lists). Every write path that can archive —
`patchProduct`, `saveProductEditor`, `writeProductVariants`, `deleteCatalogueItems` — calls it, and
every write path refuses a write to an archived row with `product.archived`. The dashboard swaps
Disable/Enable for Archive/View and opens an archived product read-only.

**Tech Stack:** TypeScript, drizzle on the venue's SQLite store (`node:sqlite`), Vitest (catalogue
and server: database suites through `useCatalogueDb` / the server's own helpers; dashboard: browser
mode in real headless Chromium), Lit.

**Spec:** `docs/superpowers/specs/2026-10-08-delete-and-archive-design.md`, section "Products".

## Global Constraints

- Branch `feat/a435-product-archive`, created with
  `python3 ~/workspace/tools/worktree.py new waitron feat/a435-product-archive --headless`.
- Every commit `git commit -s`; commit messages in plain English (no unexplained jargon).
- Error codes name the domain concept: `product.archived`, `product.on_live_menu`. Each refusal test
  asserts the code (and its params), never only that something threw.
- Every user-facing string has English and Spanish text.
- No backwards-compatibility or data-migration code (CLAUDE.md §3): products disabled today simply
  count as archived. No schema change and no migration in this step.
- Coverage holds `98/98/98/95` in `@waitron/catalogue`, `@waitron/server` and `@waitron/dashboard`;
  close a gap with a test that asserts behaviour, never an ignore comment.
- Run focused tests while working; the pre-push hook and CI run the rest (CLAUDE.md §2). Browser
  suites: check `memory_pressure | grep free` first.
- Comments only for an invariant or a non-obvious why; cut stale ones in files you touch.

## Review Focus

1. **An archive refused part-way leaves nothing written.** A `PATCH` that renames AND archives a
   product on a live menu must leave the old name too — the refusal rolls back the whole request.
   Test in Task 2.
2. **A folder delete holding a product that is ALREADY archived but still on a live menu** (data
   from before this change) is not refused and does not re-archive it. Test in Task 2.
3. **A variant whose parent is archived while the variant row is still on** (data from before this
   change) refuses every write with `product.archived`. Test in Task 2.
4. **A deleted menu's live version does not block an archive** — deleted menus are never served.
   Test in Task 1.
5. **A queued edition whose time has come but has not been settled counts as live; a cancelled one
   does not count.** Test in Task 1.

---

### Task 1: Find the published menus that include a product, and refuse archiving

**Files:**
- Create: `packages/catalogue/src/archive.ts`
- Modify: `packages/catalogue/src/errors.ts` (two new codes, beside `product.not_found`)
- Test: `packages/catalogue/src/archive.db.test.ts` (new), `packages/catalogue/src/archive.test.ts`
  (new, pure)

**Interfaces:**
- Produces:
  - `documentProductIds(document: MenuDocument): Set<string>`
  - `publishedMenusHolding(tx: Transaction, productIds: readonly string[], at?: Date): Promise<Map<string, HoldingMenu[]>>`
    where `interface HoldingMenu { id: string; name: string }`
  - `assertOffPublishedMenus(tx: Transaction, productIds: readonly string[]): Promise<void>`
  - error `"product.on_live_menu": { products: { id: string; name: string }[]; menus: { id: string; name: string }[] }`
  - error `"product.archived": { productId: string; field?: string }`

- [ ] **Step 1: Write the failing pure test** — `archive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { documentProductIds } from "./archive.js";
import type { MenuDocument } from "./menu-document-types.js";

const doc = (partial: Partial<MenuDocument>): MenuDocument =>
  ({
    format: 3,
    menuId: "m",
    menuName: "M",
    root: { members: [] },
    offers: {},
    home: {
      shortcuts: [],
      handheld: { columns: 3, tiles: "colours", order: "home_first" },
      till: { columns: 6, tiles: "colours", order: "home_first" },
    },
    ...partial,
  }) as MenuDocument;

describe("documentProductIds", () => {
  it("collects each dish, variant, extras item and home shortcut", () => {
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
        home: {
          ...doc({}).home,
          shortcuts: [{ kind: "product", productId: "tile" }, { kind: "empty" }],
        },
      }),
    );
    expect([...ids].sort()).toEqual(["dish", "extra", "size", "tile"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/archive.test.ts`
Expected: FAIL — `./archive.js` does not exist.

- [ ] **Step 3: Write `archive.ts` (first part) and the two error codes**

In `packages/catalogue/src/errors.ts`, beside `"product.not_found"`:

```ts
    /** A write named an archived product or variant, or a variant of an archived product. Archiving
     * is permanent. `field` places the refusal where the body named the row. */
    "product.archived": { productId: string; field?: string };
    /** Archiving was refused because a menu version that is live, or queued to go live, includes
     * these products as a dish, a variant, an extras item or a home shortcut. */
    "product.on_live_menu": {
      products: { id: string; name: string }[];
      menus: { id: string; name: string }[];
    };
```

Create `packages/catalogue/src/archive.ts`:

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
 * For each of `productIds` some served menu's live version, or a version queued to go live after
 * `at`, includes: those menus, by name. A deleted menu is never served, so its versions do not
 * count.
 */
export async function publishedMenusHolding(
  tx: Transaction,
  productIds: readonly string[],
  at: Date = now(),
): Promise<Map<string, HoldingMenu[]>> {
  const wanted = new Set(productIds);
  const holding = new Map<string, Map<string, HoldingMenu>>();
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

Check `catalogues` is exported by `@waitron/db` (`grep -n "catalogues" packages/db/src/index.ts`);
if not, import it the way `menu-publication.ts`'s siblings do.

- [ ] **Step 4: Run the pure test** — same command. Expected: PASS.

- [ ] **Step 5: Write the failing database tests** — `archive.db.test.ts`, using `menusFixture`
  (`packages/catalogue/test/menus-fixture.ts`: Lunch holds Lemonade with variant Large and the
  extras item Extra lemon; Dinner holds Burger):

```ts
import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { assertOffPublishedMenus, publishedMenusHolding } from "./archive.js";
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

describe("publishedMenusHolding", () => {
  it("names the live menu for a dish, its variant and an extras item", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    const found = await holding([f.lemonade, f.large, f.extraLemon, f.burger]);
    expect(found.get(f.lemonade)).toEqual([{ id: f.lunch, name: "Lunch Menu" }]);
    expect(found.get(f.large)).toEqual([{ id: f.lunch, name: "Lunch Menu" }]);
    expect(found.get(f.extraLemon)).toEqual([{ id: f.lunch, name: "Lunch Menu" }]);
    expect(found.has(f.burger)).toBe(false); // Dinner was never published
  });

  it("counts a version queued for later", async () => {
    const f = await menusFixture(fx.db);
    await queue(f.dinner, later);
    expect((await holding([f.burger])).get(f.burger)?.map((m) => m.id)).toEqual([f.dinner]);
  });

  it("counts a queued version whose time has come before it is settled", async () => {
    const f = await menusFixture(fx.db);
    await queue(f.dinner, later);
    const after = new Date(later.getTime() + 60_000);
    expect((await holding([f.burger], after)).get(f.burger)?.map((m) => m.id)).toEqual([f.dinner]);
  });

  it("does not count a cancelled queued version", async () => {
    const f = await menusFixture(fx.db);
    const edition = await queue(f.dinner, later);
    await app((tx) => cancelMenuPublication(tx, f.dinner, edition.versionId, "person-1", T0));
    expect((await holding([f.burger])).has(f.burger)).toBe(false);
  });

  it("does not count a deleted menu's live version", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => deactivateCatalogue(tx, f.dinner));
    expect((await holding([f.burger])).has(f.burger)).toBe(false);
  });
});

describe("assertOffPublishedMenus", () => {
  it("refuses with the products and menus", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await expect(app((tx) => assertOffPublishedMenus(tx, [f.lemonade]))).rejects.toMatchObject({
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

Before running, confirm against the source: the fixture field names (`lemonade`, `large`,
`extraLemon`, `burger`, `lunch`, `dinner`) and that `extraLemon` is the extras item's PRODUCT id
(`test/menus-fixture.ts`); that `queueMenuPublication`'s result carries `versionId` (`QueuedEdition`); and the Lunch menu's
name (`"Lunch Menu"` in the fixture). Fix the test to the source, never the source to the test.

- [ ] **Step 6: Run them** — `pnpm --filter @waitron/catalogue exec vitest run src/archive.db.test.ts`.
  Expected: PASS (the module exists already). Then prove each test by breaking the code it guards:
  remove the `queued`/`gt` half, the `served` filter and the `variants` loop in turn, rerun, see the
  matching test fail, restore.

- [ ] **Step 7: Commit**

```bash
git add packages/catalogue/src/archive.ts packages/catalogue/src/archive.test.ts \
  packages/catalogue/src/archive.db.test.ts packages/catalogue/src/errors.ts
git commit -s -m "Catalogue: find the live and scheduled menus that include a product, and refuse archiving it"
```

---

### Task 2: Archive through one function; refuse writes to an archived product

**Files:**
- Modify: `packages/catalogue/src/archive.ts` (add `archiveProducts`, move `markInactive` here)
- Modify: `packages/catalogue/src/operations.ts` (`patchProduct`, `deactivateProduct`, remove
  `markInactive`)
- Modify: `packages/catalogue/src/product-editor.ts` (`saveProductEditor`)
- Modify: `packages/catalogue/src/catalogue-items.ts` (`deleteCatalogueItems`)
- Test: `packages/catalogue/src/archive.db.test.ts`

**Interfaces:**
- Consumes: `assertOffPublishedMenus` (Task 1).
- Produces: `archiveProducts(tx: Transaction, ids: readonly string[]): Promise<void>` — archives
  each named product that is still on, together with its variants that are still on, and each named
  variant still on; refuses `product.on_live_menu` first. `markInactive(tx, ids)` now lives in
  `archive.ts` with the same signature.

- [ ] **Step 1: Write the failing tests** (append to `archive.db.test.ts`; import `updateProduct`,
  `listProductVariants`, `readProductEditor`, `saveProductEditor`, `deleteCatalogueItems`,
  `extraListItems` from `./schema/extras.js`, `products` from `@waitron/db`, `eq` from
  `drizzle-orm`):

```ts
const archived = (productId: string) => ({ code: "product.archived", params: { productId } });

describe("archiving", () => {
  it("archives a product and all its variants, and takes it out of extras lists", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.lemonade, { active: false }));
    const variants = await app((tx) => listProductVariants(tx, f.lemonade));
    expect(variants.every((v) => !v.active)).toBe(true);
    await app((tx) => updateProduct(tx, f.extraLemon, { active: false }));
    const left = await app((tx) =>
      tx.select().from(extraListItems).where(eq(extraListItems.productId, f.extraLemon)),
    );
    expect(left).toEqual([]);
  });

  it("refuses archiving a product on a live menu and writes nothing", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await expect(
      app((tx) => updateProduct(tx, f.lemonade, { name: "Renamed", active: false })),
    ).rejects.toMatchObject({ code: "product.on_live_menu" });
    const [row] = await app((tx) =>
      tx.select({ name: products.name, active: products.active }).from(products)
        .where(eq(products.id, f.lemonade)),
    );
    expect(row).toEqual({ name: expect.not.stringMatching(/^Renamed$/), active: true });
  });

  it("refuses switching an archived product back on, and any other edit", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.burger, { active: false }));
    await expect(app((tx) => updateProduct(tx, f.burger, { active: true }))).rejects.toMatchObject(
      archived(f.burger),
    );
    await expect(app((tx) => updateProduct(tx, f.burger, { unitPrice: "9" }))).rejects.toMatchObject(
      archived(f.burger),
    );
  });

  it("refuses a write to a variant whose product is archived but whose own row is on", async () => {
    const f = await menusFixture(fx.db);
    // Data from before this change: the parent off, the variant row left on.
    await app((tx) => tx.update(products).set({ active: false }).where(eq(products.id, f.lemonade)));
    await expect(app((tx) => updateProduct(tx, f.large, { unitPrice: "3" }))).rejects.toMatchObject(
      archived(f.large),
    );
  });

  it("refuses every editor save of an archived product", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.burger, { active: false }));
    const value = await app((tx) => readProductEditor(tx, f.burger));
    await expect(
      app((tx) => saveProductEditor(tx, f.burger, f.dinner, { ...value, active: true }, "en")),
    ).rejects.toMatchObject(archived(f.burger));
  });

  it("an editor save that archives does only that", async () => {
    const f = await menusFixture(fx.db);
    const value = await app((tx) => readProductEditor(tx, f.burger));
    await app((tx) =>
      saveProductEditor(tx, f.burger, f.dinner, { ...value, active: false }, "en"),
    );
    expect((await app((tx) => readProductEditor(tx, f.burger))).active).toBe(false);
  });

  it("a folder delete refuses when a product inside is on a live menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await expect(
      app((tx) =>
        deleteCatalogueItems(tx, { productIds: [f.lemonade], categoryIds: [] }, "move_up"),
      ),
    ).rejects.toMatchObject({ code: "product.on_live_menu" });
  });

  it("a folder delete passes over a product already archived while still on a live menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) => tx.update(products).set({ active: false }).where(eq(products.id, f.lemonade)));
    await app((tx) =>
      deleteCatalogueItems(tx, { productIds: [f.lemonade], categoryIds: [] }, "move_up"),
    );
  });
});
```

`saveProductEditor` reads its `catalogueId` argument only when creating, so any catalogue id
serves for an update.

- [ ] **Step 2: Run them to see them fail** —
  `pnpm --filter @waitron/catalogue exec vitest run src/archive.db.test.ts`. Expected: the new cases
  fail (no refusals yet; variants stay on; extras item stays).

- [ ] **Step 3: Add `archiveProducts` and move `markInactive`** — in `archive.ts` (add imports:
  `takeOffMenus`, `dropMenuPrices` from `./menu-removal.js`, `extraListItems` from
  `./schema/extras.js`):

```ts
/** Sets the products Inactive and nothing else: the caller takes them off menus. */
export async function markInactive(tx: Transaction, ids: readonly string[]): Promise<void> {
  for (const batch of batches(ids))
    await tx
      .update(products)
      .set({ active: false, updatedAt: now() })
      .where(inArray(products.id, batch));
}

/**
 * Archives each named product or variant that is still on, with every variant still on of each
 * named product: refused with `product.on_live_menu` first, then taken off menu drafts and extras
 * lists. A row already off is passed over, whatever menu still shows it.
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
  const dishes = named.filter((row) => row.active && row.parentId === null).map((row) => row.id);
  const variants = new Set(
    named.filter((row) => row.active && row.parentId !== null).map((row) => row.id),
  );
  for (const batch of batches(dishes))
    for (const row of await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.parentId, batch), eq(products.active, true))))
      variants.add(row.id);
  await assertOffPublishedMenus(tx, [...dishes, ...variants]);
  await markInactive(tx, [...dishes, ...variants]);
  for (const batch of batches(dishes))
    await tx.delete(extraListItems).where(inArray(extraListItems.productId, batch));
  await takeOffMenus(tx, dishes);
  await dropMenuPrices(tx, [...variants]);
}
```

In `operations.ts` delete `markInactive`, import `archiveProducts` from `./archive.js`, and make
`deactivateProduct` call `archiveProducts(tx, [id])`. Update every other importer of
`markInactive` (`grep -rn "markInactive" packages/catalogue/src`) to import it from `./archive.js`.

- [ ] **Step 4: Change `patchProduct`** (`operations.ts`):

Replace the opening two lines that read `row` with an unconditional read and the refusal:

```ts
  const namesChange = checkNames && (patch.name !== undefined || patch.active !== undefined);
  const row = await readUpdatedName(tx, id);
  if (row !== undefined && (!row.active || row.parentActive === false))
    throw new AppError("product.archived", { productId: id });
  if (patch.active === false && row?.active === true) await archiveProducts(tx, [id]);
```

Keep the `assertNotOfferedAsExtra` and `assertUpdatedNamesFree` lines that follow (they read
`row`). Delete the tail:

```ts
  // Only a change from Active runs the removal: the editor resends `active` on every save.
  if (patch.active === false && row?.active === true)
    await (row.parentId === null ? takeOffMenus : dropMenuPrices)(tx, [id]);
```

and drop `takeOffMenus`/`dropMenuPrices` from `operations.ts`'s imports if nothing else uses them.
Confirm `readUpdatedName`'s `UpdatedName` carries `parentActive` (`product-names.ts`); it does as of
`main` 49a80d770.

- [ ] **Step 5: Change `saveProductEditor`** (`product-editor.ts`): replace the stored-row select
  with `readUpdatedName(tx, productId)` (it returns `id`, `name`, `active`, `parentId`,
  `parentActive`, which covers `StoredName`), then right after it:

```ts
    if (!product) throw new AppError("product.not_found", { productId });
    if (!product.active || product.parentActive === false)
      throw new AppError("product.archived", { productId });
```

After `parseProductEditorInput` and the `parentId` check, add:

```ts
  // An archiving save archives and changes nothing else: the dashboard sends the stored value back
  // with `active: false`, and the variants and options it carries must not be rewritten onto an
  // archived row.
  if (productId !== null && !value.active) {
    await archiveProducts(tx, [productId]);
    return readProductEditor(tx, productId);
  }
```

- [ ] **Step 6: Change `deleteCatalogueItems`** (`catalogue-items.ts`): stop calling
  `markInactive` and `takeOffMenus`; collect every product id the deletion reaches (the selection's
  `productIds` and each subtree's products, exactly as `deactivated` collects them today) and call
  `await archiveProducts(tx, deactivated)` once, BEFORE the folder loops write anything — so read the
  subtrees' products first, archive, then vacate and remove folders. `archiveProducts` passes over
  rows already off.

- [ ] **Step 7: Run the catalogue package's tests** —
  `pnpm --filter @waitron/catalogue exec vitest run src/archive.db.test.ts` (PASS), then
  `pnpm --filter @waitron/catalogue test` and fix what the change breaks in OTHER suites. Tests that
  asserted a restore or a re-enable become refusal tests asserting `product.archived` — never
  delete one. Known: `product-names.db.test.ts` ("refuses reactivating…" ×3 and the Inactive
  duplicate cases), `menu-removal.test.ts` ("is not put back on any menu when made Active again"),
  `active-available.test.ts`, `menu-structure.test.ts`, `product-editor.test.ts` ("…Active again
  when sent active true", "adds, re-activates and restores variants…"), `operations.test.ts`.
  A test that wrote an archived product for another purpose sets up its data without going through
  the refused write.

- [ ] **Step 8: Commit**

```bash
git add packages/catalogue
git commit -s -m "Catalogue: archiving is permanent — one archive path, refused on a live menu, no writes after"
```

---

### Task 3: Variants and extras lists

**Files:**
- Modify: `packages/catalogue/src/variants.ts` (`writeProductVariants`)
- Modify: `packages/catalogue/src/extras.ts` (`assertProductsExist`)
- Test: `packages/catalogue/src/archive.db.test.ts`, the existing `variants.db.test.ts` and extras
  suites

**Interfaces:**
- Consumes: `assertOffPublishedMenus`, `product.archived` (Task 1).

- [ ] **Step 1: Write the failing tests** (append to `archive.db.test.ts`; import
  `setProductVariants` from `./variants.js` and `createExtraList` from `./extras.js`):

```ts
describe("variants and extras", () => {
  it("refuses a variants write naming an archived variant", async () => {
    const f = await menusFixture(fx.db);
    const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
    await app((tx) => updateProduct(tx, f.large, { active: false }));
    await expect(
      app((tx) => setProductVariants(tx, f.lemonade, [{ ...large!, active: true }], "en")),
    ).rejects.toMatchObject({
      code: "product.archived",
      params: { productId: f.large, field: "variants.0.id" },
    });
  });

  it("refuses a variants write to an archived product", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.lemonade, { active: false }));
    await expect(app((tx) => setProductVariants(tx, f.lemonade, [], "en"))).rejects.toMatchObject({
      code: "product.archived",
      params: { productId: f.lemonade },
    });
  });

  it("refuses archiving a variant a live menu offers, by switching it off or leaving it out", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
    for (const inputs of [[{ ...large!, active: false }], []])
      await expect(
        app((tx) => setProductVariants(tx, f.lemonade, inputs, "en")),
      ).rejects.toMatchObject({ code: "product.on_live_menu" });
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

- [ ] **Step 2: Run to see them fail** — same command as Task 2 Step 2.

- [ ] **Step 3: Change `writeProductVariants`** (`variants.ts`):

After `const parent = await assertProductForWrite(tx, productId);`:

```ts
  if (!parent.active) throw new AppError("product.archived", { productId });
```

After the loop that refuses `product.variant_not_found`:

```ts
  const archivedAt = normalized.findIndex(
    (input) => input.id !== undefined && currentActive.get(input.id) === false,
  );
  if (archivedAt !== -1)
    throw new AppError("product.archived", {
      productId: normalized[archivedAt]!.id!,
      field: `variants.${archivedAt}.id`,
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

and delete the later `left` / `madeInactive` declarations (keep the loop over `left` and the
`dropMenuPrices(tx, madeInactive)` call, which now use these). Leaving an archived variant OUT of
the body stays allowed: the `left` loop keeps it off and orders it last.

- [ ] **Step 4: Change `assertProductsExist`** (`extras.ts`): select `active` too and refuse an
  archived product at its item:

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

Update the function's comment to say it also refuses an archived product.

- [ ] **Step 5: Run** — `pnpm --filter @waitron/catalogue exec vitest run src/archive.db.test.ts`
  (PASS), then `pnpm --filter @waitron/catalogue test`; turn the restore cases in
  `variants.db.test.ts` (":290, :384, :649, :698" as of 49a80d770) and `product-editor.test.ts`
  into refusal cases as in Task 2 Step 7. Then `pnpm --filter @waitron/catalogue test:coverage` and
  read the per-file table for `archive.ts`, `variants.ts`, `extras.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue
git commit -s -m "Catalogue: no write brings an archived variant back, and extras lists refuse archived products"
```

---

### Task 4: Server routes answer the two new refusals

**Files:**
- Modify: `apps/server/src/catalogue-api.ts` (status map near `"product.not_found": 404`)
- Test: `apps/server/src/catalogue-api.test.ts`

- [ ] **Step 1: Write the failing route tests** in `catalogue-api.test.ts`, beside the existing
  product editor cases, using that file's own helpers for a manager session and a product:
  - `PUT /management-api/products/:id/editor` with `active: true` on an archived product answers
    **409** with body `code: "product.archived"`.
  - The same route archiving a product on a published menu answers **409** with
    `code: "product.on_live_menu"` and `params.menus` naming the menu.
  - `POST /management-api/folders/delete` with that product answers **409**
    `product.on_live_menu`.
  Turn the existing reactivation cases (":1303" name_taken on reactivation; ":2250" "is removed and
  restored…", as of 49a80d770) into `product.archived` refusals.

- [ ] **Step 2: Run to see them fail** —
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`. Expected: 500 instead
  of 409 for the new codes.

- [ ] **Step 3: Add the statuses**

```ts
  "product.archived": 409,
  "product.on_live_menu": 409,
```

Then `grep -rn '"product.name_taken"' apps/server/src` and add both codes to every other status map
that lists catalogue product codes (`setup-api.ts` lists one); a map whose routes cannot reach an
archive needs nothing — say which in the commit message.

- [ ] **Step 4: Run** — same command, PASS; then `pnpm --filter @waitron/server exec vitest run
  src/catalogue-api` and `pnpm exec vitest run scripts/errors-reachable.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -s -m "Server: archiving refusals answer 409 with their own codes"
```

---

### Task 5: Dashboard words, product list, dialogs

**Files:**
- Modify: `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts`
- Modify: `apps/dashboard/src/widgets/product-list.ts`
- Modify: `apps/dashboard/src/widgets/catalogue-browser.ts`
- Modify: the extras-list form's product picker (`apps/dashboard/src/widgets/extra-list-form.ts`,
  around the line that lists products for picking)
- Test: `screens/catalogue-screen.test.ts`, `widgets/product-list.test.ts`,
  `widgets/catalogue-browser.test.ts`, `widgets/extra-list-form.test.ts`

**Interfaces:**
- Consumes: refusal bodies `product.archived { productId, field? }`,
  `product.on_live_menu { products: {id,name}[], menus: {id,name}[] }`.

- [ ] **Step 1: Strings.** Replace the Disable/Enable product keys with Archive keys. New English and
  Spanish text:

| Key | English | Spanish |
|---|---|---|
| `product.archive` | Archive | Archivar |
| `product.view` | View | Ver |
| `product.archive_named` | Archive {name} | Archivar {name} |
| `product.archive_variant_named` | Archive {name} | Archivar {name} |
| `product.archive_warning` | This archives the product for good: the till stops selling it, and it cannot be brought back. Its past sales are kept, and a new product can take its name. It also comes off any extras list that offers it. | Esto archiva el producto para siempre: la caja deja de venderlo y no se puede recuperar. Sus ventas pasadas se conservan y un producto nuevo puede usar su nombre. También sale de las listas de extras que lo ofrecen. |
| `product.archive_variant_warning` | This archives the variant for good: the till stops offering it, and it cannot be brought back. Its past sales are kept. | Esto archiva la variante para siempre: la caja deja de ofrecerla y no se puede recuperar. Sus ventas pasadas se conservan. |
| `product.archived_badge` | Archived | Archivado |
| `product.archived_notice` | This product is archived. You can look at it but not change it. | Este producto está archivado. Puedes consultarlo, pero no modificarlo. |
| `folders.archive_products_heading` | Archive {count} products? | ¿Archivar {count} productos? |
| `folders.archive_products_heading_one` | Archive 1 product? | ¿Archivar 1 producto? |
| `folders.archive_products_body` | This archives the products for good: the till stops selling them, and they cannot be brought back. Their past sales are kept. | Esto archiva los productos para siempre: la caja deja de venderlos y no se pueden recuperar. Sus ventas pasadas se conservan. |
| `folders.also_archives` | archives {products} | archiva {products} |
| `folders.delete_off_menus` | Products archived by this deletion come off every menu they are on. | Los productos archivados por esta eliminación salen de todos los menús en los que están. |

Keep `product.off_menus*` and `folders.off_menus*` (still true for menu drafts). Delete
`product.disable`, `product.enable`, `product.disable_named`, `product.disable_variant_named`,
`product.disable_warning`, `product.disable_variant_warning`, `product.disabled_badge`,
`product.disabled_notice`, `folders.disable_products_heading(_one)`, `folders.disable_products_body`,
`folders.also_disables` once nothing reads them (`grep -rn` each key under `apps/dashboard/src`;
`variant-table.ts` and `product-editor.ts` are Task 6's and still read some — leave those keys for
Task 6 to delete). Match the existing Spanish register in `strings.ts`.

In `codes.ts`:

```ts
  "product.archived": {
    en: "This product is archived and can no longer be changed.",
    es: "Este producto está archivado y ya no se puede modificar.",
  },
  "product.on_live_menu": {
    en: "It is on a live or scheduled menu. Take it off the menu and publish, then archive it:",
    es: "Está en un menú publicado o programado. Quítalo del menú y publica; después archívalo:",
  },
```

- [ ] **Step 2: Write the failing browser tests.**
  - `product-list.test.ts`: an archived row's actions hold only **View** (emits `edit-product`); an
    active row's hold Edit and **Archive** (emits `delete-product`); the Status filter options read
    "Active" and "Archived".
  - `catalogue-screen.test.ts`: the archive dialog's heading and warning use the new keys; a
    `product.on_live_menu` refusal shows the code's sentence followed by the menu names (and, with
    more than one product, the product names); no Enable/restore path remains (delete the restore
    cases or turn them into "an archived row offers View only").
  - `catalogue-browser.test.ts`: the bulk action reads Archive, and a `product.on_live_menu` refusal
    shows the menu and product names.
  - `extra-list-form.test.ts`: the product picker leaves archived products out.

- [ ] **Step 3: Run to see them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/screens/catalogue-screen.test.ts src/widgets/catalogue-browser.test.ts src/widgets/extra-list-form.test.ts`
  (check `memory_pressure | grep free` first).

- [ ] **Step 4: Implement.**
  - `product-list.ts`, actions column: an inactive row renders one `wt-button` "View"
    (`data-test="view-${id}"`, event `edit-product`); an active row renders Edit and a danger
    "Archive" (`data-test="delete-${id}"`, event `delete-product`). Remove `restore-product`. The
    status cell and filter use `product.archived_badge` for an inactive row; update
    `productStatusName` accordingly.
  - `catalogue-screen.ts`: delete `#restoreProduct` and the `@restore-product` listener; the delete
    dialog uses the archive keys and its confirm button reads `product.archive`. Generalise
    `refusalText` so `product.on_live_menu` appends the menu names (and the product names when the
    refusal names more than one product), read from `params` the way `extraListNames` reads
    `extraLists`; set the dialog's `deleteErrorKey` text through it.
  - `catalogue-browser.ts`: the bulk Disable label, heading, body and `also_disables` use the archive
    keys; its refusal text goes through the same helper — move `refusalText` and its readers to a
    small module both import (for example `apps/dashboard/src/widgets/archive-refusal.ts`).
  - `extra-list-form.ts`: filter the picker's products to `active` ones.

- [ ] **Step 5: Run** — same command, PASS; then the whole catalogue screen family:
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/catalogue src/widgets/product src/widgets/catalogue src/widgets/extra-list`.

- [ ] **Step 6: Look at it.** Start the dev stack (`wa-wt demo waitron-feat-a435-product-archive`),
  archive a product not on a live menu, try one that is, open the Archived filter, at phone width
  and in both themes. Note what you saw in the commit message.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard
git commit -s -m "Dashboard: Archive replaces Disable for products, with the live-menu refusal named"
```

---

### Task 6: The product editor opens an archived product read-only; variants archive in the editor

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`
- Modify: `apps/dashboard/src/widgets/variant-table.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `widgets/product-editor.test.ts`, `widgets/product-editor.save-state.test.ts`,
  `widgets/product-editor.a11y.test.ts`, `widgets/variant-table.test.ts`

- [ ] **Step 1: Strings.**

| Key | English | Spanish |
|---|---|---|
| `product.variant_archived_badge` | Archived | Archivada |
| `product.variant_archive_pending_badge` | Archived when saved | Se archivará al guardar |
| `product.keep_variant` | Keep | Conservar |
| `editor.show_archived` | Show {count} archived | Mostrar {count} archivadas |
| `editor.show_archived_one` | Show 1 archived | Mostrar 1 archivada |
| `editor.hide_archived` | Hide archived | Ocultar archivadas |

Delete `product.variant_disabled_badge`, `editor.show_disabled(_one)`, `editor.hide_disabled`, and
whichever Task 5 leftovers (`product.disable`, `product.enable`, `product.disabled_notice`) nothing
reads after this task.

- [ ] **Step 2: Write the failing browser tests.**
  - `product-editor.test.ts`: opened on a value with `active: false`, every field and the variant
    table are disabled, there is no Save and no Enable button, the Available switch is absent, the
    notice reads `product.archived_notice`, and Cancel still closes the editor.
  - `product-editor.test.ts`: a saved variant archived in the draft is still sent with
    `active: false`; a variant that was ALREADY archived in the loaded value is left out of the
    submitted `variants`.
  - `variant-table.test.ts`: a variant archived in the loaded value shows `Archived` and only the
    Open action; a variant switched off in this draft shows `Archived when saved` and a **Keep**
    action (emits `wt-restore`); an active saved variant's danger action reads **Archive**; an unsaved
    variant's still reads Remove.

- [ ] **Step 3: Run to see them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts src/widgets/variant-table.test.ts`.

- [ ] **Step 4: Implement.**
  - `product-editor.ts`: add `private get archived() { return this.value?.id !== undefined && this.value?.active === false; }`
    and make `suspended` return `this.busy || this.windowOpen || this.archived`. The Cancel button and
    the modal's `dismissible` must stay usable, so they read `this.busy || this.windowOpen` instead
    of `suspended`; check `reportCancel` and the close handler do not themselves refuse while
    suspended. Render no Save and no Enable button when archived; delete the Enable button and the
    `restore` parameter of `save` / `submissionValue`. Hide the Available switch when archived. The
    inactive notice uses `product.archived_notice`.
  - `submissionValue`: drop from `value.variants` every variant whose id is archived in `this.value`
    (`this.value.variants.filter((v) => !v.active)`), so the server never receives one (Task 3
    refuses it).
  - Pass the archived ids to the table: `.archivedIds=${new Set(this.value?.variants.filter((v) => !v.active).map((v) => v.id))}`.
    The show/hide toggle uses the `editor.*_archived` keys.
  - `variant-table.ts`: add `@property({ attribute: false }) archivedIds: ReadonlySet<string> = new Set();`.
    A row whose id is in it: badge `product.variant_archived_badge`, Available switch disabled, only
    the Open action. A saved row switched off in the draft: badge
    `product.variant_archive_pending_badge`, action `restore` labelled `product.keep_variant`. An
    active saved row's danger action reads `product.archive`.

- [ ] **Step 5: Run** — same command, then
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor src/widgets/variant-table src/screens/catalogue`
  (the save-state and a11y suites included; the a11y suite covers the read-only state in both
  themes — add that state if it is not there).

- [ ] **Step 6: Look at it** on the dev stack: open an archived product from the Archived filter,
  archive a variant inside a product and Keep it again, at phone width and in both themes.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard
git commit -s -m "Dashboard: an archived product opens read-only, and variants archive on save with a Keep undo"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/backlog.md` (A435 entry)
- Modify: `docs/superpowers/specs/2026-10-08-delete-and-archive-design.md` only if building showed a
  sentence of it to be wrong — say what and why in the commit.

- [ ] **Step 1:** Update A435's entry: step 1 (products) built on this branch; steps 2–6 open,
  printers next. Any point this branch left open becomes its own short entry in the catalogue area.
- [ ] **Step 2:** Grep the docs for claims the change retired: `grep -rn -i "enable it again\|restore.*product\|re-?activat" docs/developers docs/backlog.md docs/backlog/catalogue.md apps/dashboard/README* packages/catalogue/README* 2>/dev/null`
  and fix each that describes the old behaviour.
- [ ] **Step 3: Commit**

```bash
git add docs
git commit -s -m "Docs: A435 step 1 built — products are archived for good"
```
