import { describe, expect, it } from "vitest";
import { categories, products, withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, product } from "../test/menus-fixture.js";
import {
  archiveProducts,
  assertProductWritable,
  assertOffPublishedMenus,
  publishedMenusHolding,
} from "./archive.js";
import { menuPublications } from "./schema/publication.js";
import { addMember, removeMember } from "./sections.js";
import { readMenuStructure } from "./menu-structure.js";
import { insertVersion, previewMenu, publishMenu } from "./menu-publication.js";
import { cancelMenuPublication, queueMenuPublication } from "./menu-schedule.js";
import { eq } from "drizzle-orm";
import { listProductVariants, setProductVariants } from "./variants.js";
import { readProductEditor, saveProductEditor } from "./product-editor.js";
import { deleteCatalogueItems } from "./catalogue-items.js";
import { extraListItems, extraLists } from "./schema/extras.js";
import { createExtraList, getExtraList, updateExtraList } from "./extras.js";
import { menuItems } from "./schema/menu.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { offerOf } from "../test/menus-fixture.js";
import { sectionMembers } from "./schema/sections.js";
import { deactivateCatalogue, deactivateProduct, updateProduct } from "./operations.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const T0 = new Date("2026-10-08T10:00:00.000Z");
const later = new Date("2026-10-09T10:00:00.000Z");

async function publish(menuId: string, at = T0) {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  return app((tx) => publishMenu(tx, menuId, hash, "person-1", { at }));
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
    for (const id of [f.lemonade, f.large, f.extraLemon])
      expect(await menuIds(id)).toEqual([f.lunch]);
    expect(await menuIds(f.burger)).toBeUndefined();
  });

  it("names the live menu for a product present only in its stored home shortcuts", async () => {
    const f = await menusFixture(fx.db);
    const { document } = await app((tx) => previewMenu(tx, f.lunch));
    const shortcutOnly = {
      ...document,
      root: { members: [] },
      offers: {},
      home: {
        ...document.home,
        shortcuts: [product(f.soup), { kind: "empty" as const }],
      },
    };
    await app(async (tx) => {
      const versionId = await insertVersion(tx, {
        menuId: f.lunch,
        number: 1,
        document: shortcutOnly,
        contentHash: "shortcut-only",
        publishedAt: T0,
        publishedBy: "person-1",
      });
      await tx.insert(menuPublications).values({ menuId: f.lunch, versionId, publishedAt: T0 });
    });
    expect(await menuIds(f.soup)).toEqual([f.lunch]);
    expect(await menuIds(f.lemonade)).toBeUndefined();
  });

  it("returns no holdings for an empty request", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    expect(await holding([])).toEqual(new Map());
    await app((tx) => assertOffPublishedMenus(tx, []));
  });

  it("deduplicates live and future holdings and orders menus by their staff names", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.burger)));
    await queue(f.lunch, later);
    await publish(f.dinner);
    expect((await holding([f.lemonade, f.lemonade])).get(f.lemonade)).toEqual([
      { id: f.dinner, name: "Dinner Menu" },
      { id: f.lunch, name: "Lunch Menu" },
    ]);
  });

  it("does not count a draft or an obsolete published version", async () => {
    const f = await menusFixture(fx.db);
    expect(await menuIds(f.soup)).toBeUndefined();
    await publish(f.lunch);
    const { root } = await app((tx) => readMenuStructure(tx, f.lunch));
    const soup = root.members.find(
      (member) => member.ref.kind === "product" && member.ref.productId === f.soup,
    )!;
    await app((tx) => removeMember(tx, f.lunchRoot, soup.id));
    expect(await menuIds(f.soup)).toEqual([f.lunch]);
    await publish(f.lunch, new Date(T0.getTime() + 60_000));
    expect(await menuIds(f.soup, new Date(T0.getTime() + 120_000))).toBeUndefined();
    expect(await menuIds(f.lemonade)).toEqual([f.lunch]);
  });

  it("does not count an older overdue queued version after a newer queued version becomes live", async () => {
    const f = await menusFixture(fx.db);
    await queue(f.lunch, later);
    const { root } = await app((tx) => readMenuStructure(tx, f.lunch));
    const soup = root.members.find(
      (member) => member.ref.kind === "product" && member.ref.productId === f.soup,
    )!;
    await app((tx) => removeMember(tx, f.lunchRoot, soup.id));
    const newest = new Date(later.getTime() + 60_000);
    await queue(f.lunch, newest);
    expect(await menuIds(f.soup, later)).toEqual([f.lunch]);
    expect(await menuIds(f.soup, newest)).toBeUndefined();
    expect(await menuIds(f.lemonade, newest)).toEqual([f.lunch]);
  });

  it("counts a dish, a variant and an extras item on a version queued for later", async () => {
    const f = await menusFixture(fx.db);
    await queue(f.lunch, later);
    for (const id of [f.lemonade, f.large, f.extraLemon])
      expect(await menuIds(id)).toEqual([f.lunch]);
  });

  it("counts a queued version whose time has come before it is settled", async () => {
    const f = await menusFixture(fx.db);
    await queue(f.dinner, later);
    expect(await menuIds(f.burger, later)).toEqual([f.dinner]);
    expect(await menuIds(f.burger, new Date(later.getTime() + 60_000))).toEqual([f.dinner]);
  });

  it("does not count a cancelled queued version", async () => {
    const f = await menusFixture(fx.db);
    const edition = await queue(f.dinner, later);
    await app((tx) => cancelMenuPublication(tx, f.dinner, edition.versionId, "person-1", T0));
    expect(await menuIds(f.burger)).toBeUndefined();
    expect(await menuIds(f.burger, new Date(later.getTime() + 60_000))).toBeUndefined();
  });

  it("does not count a deleted menu's live version", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => deactivateCatalogue(tx, f.dinner));
    expect(await menuIds(f.burger)).toBeUndefined();
  });
});

it.each([T0, later, new Date(later.getTime() + 60_000)])(
  "does not count a deleted menu's queued version at %s",
  async (at) => {
    const f = await menusFixture(fx.db);
    await queue(f.dinner, later);
    await app((tx) => deactivateCatalogue(tx, f.dinner));
    expect(await menuIds(f.burger, at)).toBeUndefined();
  },
);

describe("assertOffPublishedMenus", () => {
  it("refuses with the products and menus", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await expect(
      app((tx) => assertOffPublishedMenus(tx, [f.lemonade, f.burger, f.lemonade])),
    ).rejects.toMatchObject({
      code: "product.on_live_menu",
      params: {
        products: [{ id: f.lemonade, name: "Lemonade" }],
        menus: [{ id: f.lunch, name: "Lunch Menu" }],
      },
    });
  });
  it("names each blocked product and deduplicates menus shared by several products", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await expect(
      app((tx) => assertOffPublishedMenus(tx, [f.lemonade, f.large, f.extraLemon])),
    ).rejects.toMatchObject({
      code: "product.on_live_menu",
      params: {
        products: [
          { id: f.lemonade, name: "Lemonade" },
          { id: f.large, name: "Large" },
          { id: f.extraLemon, name: "Extra lemon" },
        ],
        menus: [
          { id: f.dinner, name: "Dinner Menu" },
          { id: f.lunch, name: "Lunch Menu" },
        ],
      },
    });
  });
  it("passes a product no published menu includes", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) => assertOffPublishedMenus(tx, [f.burger]));
  });
});

const archived = (productId: string) => ({ code: "product.archived", params: { productId } });
const switchOff = (id: string) =>
  app((tx) => tx.update(products).set({ active: false }).where(eq(products.id, id)));
const row = async (id: string) =>
  (await app((tx) => tx.select().from(products).where(eq(products.id, id))))[0];
const snapshot = () =>
  app(async (tx) => ({
    products: await tx.select().from(products),
    categories: await tx.select().from(categories),
    extras: await tx.select().from(extraListItems),
    members: await tx.select().from(sectionMembers),
    menuItems: await tx.select().from(menuItems),
    variantPrices: await tx.select().from(menuItemVariantOverrides),
  }));
const blocked = (f: Awaited<ReturnType<typeof menusFixture>>) => ({
  code: "product.on_live_menu",
  params: {
    products: [
      { id: f.lemonade, name: "Lemonade" },
      { id: f.large, name: "Large" },
    ],
    menus: [{ id: f.lunch, name: "Lunch Menu" }],
  },
});

describe("archiving", () => {
  it("archives a product and its variants and removes draft placements", async () => {
    const f = await menusFixture(fx.db);
    expect((await row(f.lemonade))!.active).toBe(true);
    expect((await row(f.large))!.active).toBe(true);
    expect(
      await app((tx) =>
        tx.select().from(sectionMembers).where(eq(sectionMembers.productId, f.lemonade)),
      ),
    ).toHaveLength(1);
    await app((tx) => updateProduct(tx, f.lemonade, { active: false }));
    expect((await row(f.lemonade))!.active).toBe(false);
    expect((await app((tx) => listProductVariants(tx, f.lemonade))).map((v) => v.active)).toEqual([
      false,
    ]);
    expect(
      await app((tx) =>
        tx.select().from(sectionMembers).where(eq(sectionMembers.productId, f.lemonade)),
      ),
    ).toEqual([]);
  });
  it("takes an archived product out of extras lists", async () => {
    const f = await menusFixture(fx.db);
    expect(
      await app((tx) =>
        tx.select().from(extraListItems).where(eq(extraListItems.productId, f.extraLemon)),
      ),
    ).toHaveLength(1);
    await app((tx) => deactivateProduct(tx, f.extraLemon));
    expect((await row(f.extraLemon))!.active).toBe(false);
    expect(
      await app((tx) =>
        tx.select().from(extraListItems).where(eq(extraListItems.productId, f.extraLemon)),
      ),
    ).toEqual([]);
  });
  it("refuses an archive with a simultaneous name edit without changing any state", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    const before = await snapshot();
    await expect(
      app((tx) => updateProduct(tx, f.lemonade, { name: "Renamed", active: false })),
    ).rejects.toMatchObject(blocked(f));
    expect(await snapshot()).toEqual(before);
  });
  it("refuses reactivation and any other edit of an archived product", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.burger, { active: false }));
    const before = await row(f.burger);
    for (const patch of [{ active: true }, { unitPrice: "9" }])
      await expect(app((tx) => updateProduct(tx, f.burger, patch))).rejects.toMatchObject(
        archived(f.burger),
      );
    expect(await row(f.burger)).toEqual(before);
  });
  it("refuses editing an active variant whose parent is archived", async () => {
    const f = await menusFixture(fx.db);
    await switchOff(f.lemonade);
    const before = await row(f.large);
    await expect(app((tx) => updateProduct(tx, f.large, { unitPrice: "3" }))).rejects.toMatchObject(
      archived(f.large),
    );
    expect(await row(f.large)).toEqual(before);
  });
  it("refuses editor saves of an archived product", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.burger, { active: false }));
    const value = await app((tx) => readProductEditor(tx, f.burger));
    await expect(
      app((tx) => saveProductEditor(tx, f.burger, f.dinner, { ...value, active: true }, "en")),
    ).rejects.toMatchObject(archived(f.burger));
    expect(await app((tx) => readProductEditor(tx, f.burger))).toEqual(value);
  });
  it("an archiving editor save leaves the other fields it carries unchanged", async () => {
    const f = await menusFixture(fx.db);
    const value = await app((tx) => readProductEditor(tx, f.lemonade));
    await app((tx) =>
      saveProductEditor(
        tx,
        f.lemonade,
        f.dinner,
        {
          ...value,
          active: false,
          name: "Renamed",
          variants: value.variants.map((v) => ({ ...v, name: `${v.name} x` })),
        },
        "en",
      ),
    );
    const after = await app((tx) => readProductEditor(tx, f.lemonade));
    expect(after).toEqual({
      ...value,
      active: false,
      variants: value.variants.map((v) => ({ ...v, active: false })),
    });
  });
  it("refuses a bulk folder deletion atomically when one contained family is live", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    const before = await snapshot();
    await expect(
      app((tx) =>
        deleteCatalogueItems(tx, { productIds: [f.burger], categoryIds: [f.softDrinks] }, "delete"),
      ),
    ).rejects.toMatchObject({
      code: "product.on_live_menu",
      params: {
        products: expect.arrayContaining([
          { id: f.lemonade, name: "Lemonade" },
          { id: f.large, name: "Large" },
          { id: f.lager, name: "Lager" },
          { id: f.soup, name: "Soup" },
          { id: f.extraLemon, name: "Extra lemon" },
        ]),
        menus: [{ id: f.lunch, name: "Lunch Menu" }],
      },
    });
    expect(await snapshot()).toEqual(before);
  });
  it("a folder delete skips an already archived family still present on a live menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await switchOff(f.lemonade);
    const before = await snapshot();
    await app((tx) =>
      deleteCatalogueItems(tx, { productIds: [f.lemonade], categoryIds: [] }, "move_up"),
    );
    expect(await snapshot()).toEqual(before);
  });
  it("preserves each caller's missing-product refusal", async () => {
    const f = await menusFixture(fx.db);
    const value = await app((tx) => readProductEditor(tx, f.burger));
    await expect(
      app((tx) => saveProductEditor(tx, "missing", f.dinner, value, "en")),
    ).rejects.toMatchObject({ code: "product.not_found", params: { productId: "missing" } });
    await expect(
      app((tx) => deleteCatalogueItems(tx, { productIds: ["missing"], categoryIds: [] }, "delete")),
    ).rejects.toMatchObject({ code: "product.not_found", params: { productId: "missing" } });
  });
});

describe("archive path boundaries", () => {
  it("archives a variant alone and removes its draft price without removing its parent", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await tx.insert(menuItemVariantOverrides).values({
        menuItemId: await offerOf(tx, f.lunch, f.lemonade),
        productId: f.lemonade,
        variantId: f.large,
        price: 450,
      });
    });
    expect(await app((tx) => tx.select().from(menuItemVariantOverrides))).toHaveLength(1);
    const parent = await row(f.lemonade);
    await app((tx) => archiveProducts(tx, [f.large, f.large]));
    expect((await row(f.large))!.active).toBe(false);
    expect(await row(f.lemonade)).toEqual(parent);
    expect(await app((tx) => tx.select().from(menuItemVariantOverrides))).toEqual([]);
    expect(
      await app((tx) =>
        tx.select().from(sectionMembers).where(eq(sectionMembers.productId, f.lemonade)),
      ),
    ).toHaveLength(1);
  });
  it("the writable guard permits an active product and leaves missing rows to callers", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await assertProductWritable(tx, f.burger);
      await assertProductWritable(tx, "missing");
      await updateProduct(tx, f.burger, { name: "Cheeseburger" });
    });
    expect((await row(f.burger))!.name).toBe("Cheeseburger");
    await app((tx) => updateProduct(tx, f.burger, { active: false }));
    await expect(app((tx) => assertProductWritable(tx, f.burger))).rejects.toMatchObject(
      archived(f.burger),
    );
    await switchOff(f.lemonade);
    await expect(app((tx) => assertProductWritable(tx, f.large))).rejects.toMatchObject(
      archived(f.large),
    );
  });
  it("an empty or missing archive request writes nothing", async () => {
    await menusFixture(fx.db);
    const before = await snapshot();
    await app(async (tx) => {
      await archiveProducts(tx, []);
      await archiveProducts(tx, ["missing"]);
    });
    expect(await snapshot()).toEqual(before);
  });
});

describe("variants and extras", () => {
  it("refuses switching an archived variant back on at its body position", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.large, { active: false }));
    const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
    const before = await snapshot();
    await expect(
      app((tx) =>
        setProductVariants(
          tx,
          f.lemonade,
          [
            { ...large!, id: undefined, name: "Small", active: true },
            { ...large!, active: true },
          ],
          "en",
        ),
      ),
    ).rejects.toMatchObject({
      code: "product.archived",
      params: { productId: f.large, field: "variants.1.active" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("leaves every archived variant column unchanged while retaining body positions", async () => {
    const f = await menusFixture(fx.db);
    const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
    await app((tx) =>
      setProductVariants(
        tx,
        f.lemonade,
        [large!, { ...large!, id: undefined, name: "Small" }],
        "en",
      ),
    );
    await app((tx) => updateProduct(tx, f.large, { active: false }));
    const before = await row(f.large);
    const [, small] = await app((tx) => listProductVariants(tx, f.lemonade));
    await app((tx) =>
      setProductVariants(
        tx,
        f.lemonade,
        [
          { ...small!, name: "Medium" },
          {
            ...large!,
            active: false,
            name: "Changed",
            customerName: { es: "Sin inglés" },
            kitchenName: "CHANGED",
            image: "changed.jpg",
            unitPrice: "99.00",
            available: false,
          },
          { ...large!, id: undefined, name: "Tiny" },
        ],
        "en",
      ),
    );
    expect(await row(f.large)).toEqual(before);
    const rows = await app((tx) =>
      tx.select().from(products).where(eq(products.parentId, f.lemonade)),
    );
    expect(rows.find((v) => v.id === small!.id)).toMatchObject({ name: "Medium", variantOrder: 0 });
    expect(rows.find((v) => v.name === "Tiny")).toMatchObject({ active: true, variantOrder: 2 });
  });

  it("writes nothing to an omitted already archived variant", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.large, { active: false }));
    const before = await row(f.large);
    await app((tx) =>
      setProductVariants(
        tx,
        f.lemonade,
        [
          {
            name: "Small",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "2.00",
            available: true,
          },
        ],
        "en",
      ),
    );
    expect(await row(f.large)).toEqual(before);
  });

  it("refuses a variants write to an archived parent", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.lemonade, { active: false }));
    const before = await snapshot();
    await expect(app((tx) => setProductVariants(tx, f.lemonade, [], "en"))).rejects.toMatchObject(
      archived(f.lemonade),
    );
    expect(await snapshot()).toEqual(before);
  });

  it.each(["live", "scheduled"] as const)(
    "refuses explicit and omitted variant archives on a %s menu atomically",
    async (publication) => {
      const f = await menusFixture(fx.db);
      if (publication === "live") await publish(f.lunch);
      else await queue(f.lunch, new Date(Date.now() + 86_400_000));
      const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
      const before = await snapshot();
      for (const inputs of [[{ ...large!, active: false, name: "Changed" }], []]) {
        await expect(
          app((tx) => setProductVariants(tx, f.lemonade, inputs, "en")),
        ).rejects.toMatchObject({
          code: "product.on_live_menu",
          params: {
            products: [{ id: f.large, name: "Large" }],
            menus: [{ id: f.lunch, name: "Lunch Menu" }],
          },
        });
        expect(await snapshot()).toEqual(before);
      }
    },
  );

  it.each(["explicit", "omitted"] as const)(
    "takes an %s archived variant out of extras and draft prices",
    async (mode) => {
      const f = await menusFixture(fx.db);
      await app(async (tx) => {
        await createExtraList(tx, { name: "Sizes", items: [{ productId: f.large }] }, "en");
        await tx.insert(menuItemVariantOverrides).values({
          menuItemId: await offerOf(tx, f.lunch, f.lemonade),
          productId: f.lemonade,
          variantId: f.large,
          price: 450,
        });
      });
      const [large] = await app((tx) => listProductVariants(tx, f.lemonade));
      await app((tx) =>
        setProductVariants(
          tx,
          f.lemonade,
          mode === "explicit" ? [{ ...large!, active: false }] : [],
          "en",
        ),
      );
      expect((await row(f.large))!.active).toBe(false);
      expect(
        await app((tx) =>
          tx.select().from(extraListItems).where(eq(extraListItems.productId, f.large)),
        ),
      ).toEqual([]);
      expect(await app((tx) => tx.select().from(menuItemVariantOverrides))).toEqual([]);
    },
  );

  it.each(["create", "update"] as const)(
    "refuses an archived extras item in a %s body at its position atomically",
    async (mode) => {
      const f = await menusFixture(fx.db);
      await app((tx) => updateProduct(tx, f.extraLemon, { active: false }));
      const before = await app(async (tx) => ({
        lists: await tx.select().from(extraLists),
        items: await tx.select().from(extraListItems),
      }));
      const input = {
        name: "Changed extras",
        items: [{ productId: f.burger }, { productId: f.extraLemon }],
      };
      await expect(
        app((tx) =>
          mode === "create"
            ? createExtraList(tx, input, "en")
            : updateExtraList(tx, f.extrasList, input, "en"),
        ),
      ).rejects.toMatchObject({
        code: "product.archived",
        params: { productId: f.extraLemon, field: "items.1.productId" },
      });
      expect(
        await app(async (tx) => ({
          lists: await tx.select().from(extraLists),
          items: await tx.select().from(extraListItems),
        })),
      ).toEqual(before);
    },
  );

  it("still creates and updates lists containing active variants and products", async () => {
    const f = await menusFixture(fx.db);
    const list = await app((tx) =>
      createExtraList(tx, { name: "Sizes", items: [{ productId: f.large }] }, "en"),
    );
    await app((tx) =>
      updateExtraList(
        tx,
        list.id,
        { name: "Extras changed", items: [{ productId: f.extraLemon }] },
        "en",
      ),
    );
    expect(await app((tx) => getExtraList(tx, list.id))).toMatchObject({
      name: "Extras changed",
      items: [{ productId: f.extraLemon }],
    });
  });
});
