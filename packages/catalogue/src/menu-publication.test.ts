import { asc, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  engineErrorMessage,
  isRefusal,
  TRIGGER_ABORT,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import {
  menusFixture,
  offerOf,
  product,
  section,
  type MenusFixture,
} from "../test/menus-fixture.js";
import * as menuDocument from "./menu-document.js";
import * as operations from "./operations.js";
import * as sectionGraph from "./section-graph.js";
import { menuDocumentHash } from "./menu-document.js";
import { menuStatus, previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import { createCatalogue, createProduct, updateMenuItem, updateProduct } from "./operations.js";
import { addMember, createSection, moveMember, removeMember, updateSection } from "./sections.js";
import { menuDetails } from "./schema/menu.js";
import { menuPublications, menuVersionImages, menuVersions } from "./schema/publication.js";
import { sectionMembers, sections } from "./schema/sections.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

afterEach(() => vi.restoreAllMocks());

/** Previews and publishes, as the dashboard does: the hash the preview showed goes back. */
async function publish(menuId: string) {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  return app((tx) => publishMenu(tx, menuId, hash, "person-1"));
}

async function states(f: MenusFixture) {
  const status = await app((tx) => menuStatus(tx, [f.lunch, f.dinner]));
  return { lunch: status.get(f.lunch)!.state, dinner: status.get(f.dinner)!.state };
}

async function versionRows() {
  return fx.db
    .select()
    .from(menuVersions)
    .orderBy(asc(menuVersions.menuId), asc(menuVersions.number));
}

async function memberOf(listId: string, productId: string) {
  const [row] = await fx.db
    .select({ id: sectionMembers.id })
    .from(sectionMembers)
    .where(
      sql`${sectionMembers.sectionId} = ${listId} and ${sectionMembers.productId} = ${productId}`,
    );
  return row!.id;
}

async function sectionMemberOf(listId: string, sectionId: string) {
  const [row] = await fx.db
    .select({ id: sectionMembers.id })
    .from(sectionMembers)
    .where(
      sql`${sectionMembers.sectionId} = ${listId} and ${sectionMembers.childSectionId} = ${sectionId}`,
    );
  return row!.id;
}

describe("publishMenu", () => {
  it("writes version 1, its images, and points the publication at it", async () => {
    const f = await menusFixture(fx.db);
    await fx.db.update(sections).set({ image: "drinks.jpg" }).where(eq(sections.id, f.beer));
    const { hash } = await app((tx) => previewMenu(tx, f.lunch));
    const published = await app((tx) => publishMenu(tx, f.lunch, hash, "person-1"));
    expect(published.number).toBe(1);
    const [row] = await versionRows();
    expect(row).toMatchObject({
      id: published.versionId,
      menuId: f.lunch,
      number: 1,
      contentHash: hash,
      publishedBy: "person-1",
    });
    expect(menuDocumentHash(row!.document)).toBe(hash);
    expect(await fx.db.select().from(menuPublications)).toEqual([
      { menuId: f.lunch, versionId: published.versionId, publishedAt: row!.publishedAt },
    ]);
    expect(
      (await fx.db.select().from(menuVersionImages)).map((image) => image.filename).sort(),
    ).toEqual(["drinks.jpg", "large.jpg", "lemonade.jpg"]);
    const live = await app((tx) => readLiveDocuments(tx, [f.lunch, f.dinner]));
    expect([...live.keys()]).toEqual([f.lunch]);
    expect(live.get(f.lunch)).toEqual({ versionId: published.versionId, document: row!.document });
    const status = await app((tx) => menuStatus(tx, [f.lunch, f.dinner]));
    expect(status.get(f.lunch)).toEqual({
      state: "current",
      version: 1,
      publishedAt: row!.publishedAt.toISOString(),
      hash,
    });
    expect(status.get(f.dinner)).toEqual({ state: "unpublished" });
  });

  it("writes version 2 on a second publish, and never touches version 1", async () => {
    const f = await menusFixture(fx.db);
    const first = await publish(f.lunch);
    const [before] = await versionRows();
    await app((tx) => updateProduct(tx, f.soup, { name: "Broth" }));
    const second = await publish(f.lunch);
    expect(second.number).toBe(2);
    const rows = await versionRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(before);
    const [publication] = await fx.db.select().from(menuPublications);
    expect(publication!.versionId).toBe(second.versionId);

    const update = await captureError(() =>
      fx.db
        .update(menuVersions)
        .set({ contentHash: "forged" })
        .where(eq(menuVersions.id, first.versionId)),
    );
    expect(isRefusal(update, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(update)).toBe("menu_versions is append-only");
    const remove = await captureError(() =>
      fx.db.delete(menuVersions).where(eq(menuVersions.id, first.versionId)),
    );
    expect(isRefusal(remove, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(remove)).toBe("menu_versions is append-only");
    const removeImage = await captureError(() =>
      fx.db.delete(menuVersionImages).where(eq(menuVersionImages.versionId, first.versionId)),
    );
    expect(isRefusal(removeImage, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(removeImage)).toBe("menu_version_images is append-only");
    expect(await versionRows()).toEqual(rows);
  });

  it("writes nothing when the menu already matches its live version", async () => {
    const f = await menusFixture(fx.db);
    const first = await publish(f.lunch);
    expect(await publish(f.lunch)).toEqual(first);
    expect(await versionRows()).toHaveLength(1);
  });

  it("refuses an edit made since the preview, and writes nothing", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    const { hash } = await app((tx) => previewMenu(tx, f.lunch));
    await app((tx) => updateProduct(tx, f.lemonade, { name: "Cloudy lemonade" }));
    await expect(app((tx) => publishMenu(tx, f.lunch, hash, "person-1"))).rejects.toMatchObject({
      code: "menu.changed_since_preview",
      params: { menuId: f.lunch },
    });
    expect(await versionRows()).toHaveLength(1);
  });

  it("leaves the previous version live when a step after the version insert fails", async () => {
    const f = await menusFixture(fx.db);
    const first = await publish(f.lunch);
    await app((tx) => updateProduct(tx, f.soup, { name: "Broth" }));
    const { hash } = await app((tx) => previewMenu(tx, f.lunch));
    const images = vi.spyOn(menuDocument, "documentImages").mockImplementation(() => {
      throw new Error("the image step failed");
    });
    await expect(app((tx) => publishMenu(tx, f.lunch, hash, "person-1"))).rejects.toThrow(
      "the image step failed",
    );
    expect(images).toHaveBeenCalledOnce();
    expect(await versionRows()).toHaveLength(1);
    const live = await app((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(live.get(f.lunch)!.versionId).toBe(first.versionId);
    expect((await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch)).toMatchObject({
      state: "changed",
      version: 1,
    });
  });

  it("refuses a menu that does not exist", async () => {
    await menusFixture(fx.db);
    await expect(
      app((tx) => publishMenu(tx, "00000000-0000-4000-8000-000000000000", "x", "person-1")),
    ).rejects.toMatchObject({ code: "catalogue.not_found" });
  });

  it("leaves an unreachable shortcut out and still publishes (D13)", async () => {
    const f = await menusFixture(fx.db);
    const [details] = await fx.db.select().from(menuDetails).where(eq(menuDetails.menuId, f.lunch));
    await fx.db.insert(sectionMembers).values([
      { sectionId: details!.defaultHomeLayoutId, position: 0, productId: f.burger },
      { sectionId: details!.defaultHomeLayoutId, position: 1, productId: f.soup },
      { sectionId: details!.defaultHomeLayoutId, position: 2, childSectionId: f.mains },
    ]);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.warnings).toEqual([
      { kind: "shortcut_omitted", layoutName: "Home", name: "Burger" },
      { kind: "shortcut_omitted", layoutName: "Home", name: "Mains" },
    ]);
    await app((tx) => publishMenu(tx, f.lunch, preview.hash, "person-1"));
    const live = await app((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(live.get(f.lunch)!.document.homeLayouts[0]!.tiles).toEqual([product(f.soup)]);
  });
});

describe("menuStatus", () => {
  it("builds every menu's document in one pass", async () => {
    const f = await menusFixture(fx.db);
    const graphs = vi.spyOn(sectionGraph, "loadSectionGraph");
    const offers = vi.spyOn(operations, "listMenuOffers");
    await app((tx) => menuStatus(tx, [f.lunch, f.dinner]));
    expect(graphs).toHaveBeenCalledOnce();
    expect(offers).toHaveBeenCalledOnce();
  });

  it("leaves out an id that names no menu, and answers nothing for no ids", async () => {
    const f = await menusFixture(fx.db);
    const status = await app((tx) =>
      menuStatus(tx, [f.lunch, "00000000-0000-4000-8000-000000000000"]),
    );
    expect([...status.keys()]).toEqual([f.lunch]);
    expect(await app((tx) => menuStatus(tx, []))).toEqual(new Map());
  });

  // Review Focus 3: shared edits flag exactly the menus they change.
  describe("flags exactly the menus a shared edit changes", () => {
    async function published(): Promise<MenusFixture> {
      const f = await menusFixture(fx.db);
      await publish(f.lunch);
      await publish(f.dinner);
      expect(await states(f)).toEqual({ lunch: "current", dinner: "current" });
      return f;
    }

    it("flags both for a renamed nested section, and publishing one clears only that one", async () => {
      const f = await published();
      await app((tx) => updateSection(tx, f.beer, { internalName: "Beers" }));
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "changed" });
      await publish(f.lunch);
      expect(await states(f)).toEqual({ lunch: "current", dinner: "changed" });
      const status = await app((tx) => menuStatus(tx, [f.lunch, f.dinner]));
      expect(status.get(f.lunch)).toMatchObject({ version: 2 });
      expect(status.get(f.dinner)).toMatchObject({ version: 1 });
    });

    it("flags neither for a reporting category or a VAT class", async () => {
      const f = await published();
      await app((tx) =>
        updateProduct(tx, f.lemonade, { categoryId: f.coldDrinks, vatClass: "general" }),
      );
      expect(await states(f)).toEqual({ lunch: "current", dinner: "current" });
    });

    it("flags Dinner alone for Lemonade's price, which Lunch overrides", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.lemonade, { unitPrice: "3.20" }));
      expect(await states(f)).toEqual({ lunch: "current", dinner: "changed" });
    });

    it("flags Dinner alone for Burger's price", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.burger, { unitPrice: "13.00" }));
      expect(await states(f)).toEqual({ lunch: "current", dinner: "changed" });
    });

    it("flags both for Lemonade's allergens, each naming the shared product", async () => {
      const f = await published();
      await app((tx) =>
        updateProduct(tx, f.lemonade, { allergens: { sulphites: { presence: "contains" } } }),
      );
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "changed" });
      for (const [menuId, other] of [
        [f.lunch, "Dinner Menu"],
        [f.dinner, "Lunch Menu"],
      ] as const)
        expect((await app((tx) => previewMenu(tx, menuId))).changes).toEqual([
          {
            kind: "product_changed",
            productId: f.lemonade,
            name: "Lemonade",
            fields: ["allergens"],
            source: "shared_product",
            alsoOn: [other],
          },
        ]);
    });

    it("flags neither for Lemonade made unavailable", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.lemonade, { available: false }));
      expect(await states(f)).toEqual({ lunch: "current", dinner: "current" });
    });
  });
});

describe("previewMenu", () => {
  it("lists everything as added for a menu never published", async () => {
    const f = await menusFixture(fx.db);
    const preview = await app((tx) => previewMenu(tx, f.dinner));
    expect(preview.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.changes.map((change) => [change.kind, "name" in change && change.name])).toEqual(
      [
        ["section_added", "Drinks"],
        ["section_added", "Beer"],
        ["section_added", "Mains"],
        ["product_added", "Lemonade"],
        ["product_added", "Lager"],
        ["product_added", "Burger"],
      ],
    );
    expect(preview.warnings).toEqual([]);
  });

  it("names Lemonade added under Drinks as this menu's change when no other menu uses Drinks", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await removeMember(tx, f.dinnerRoot, await sectionMemberOf(f.dinnerRoot, f.drinks));
      await removeMember(tx, f.drinks, await memberOf(f.drinks, f.lemonade));
    });
    await publish(f.lunch);
    await app((tx) => addMember(tx, f.drinks, product(f.lemonade), 0));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "product_added",
        productId: f.lemonade,
        name: "Lemonade",
        under: ["Drinks"],
        source: "this_menu",
      },
    ]);
  });

  it("names Burger's new price as the shared product's, also on Dinner", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.burger)));
    await publish(f.lunch);
    await publish(f.dinner);
    await app((tx) => updateProduct(tx, f.burger, { unitPrice: "13.00" }));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "price_changed",
        productId: f.burger,
        name: "Burger",
        from: "12.00",
        to: "13.00",
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
    ]);
  });

  it("names sulphites on Lemonade and on its extra as shared product changes (Review Focus 1)", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app(async (tx) => {
      await updateProduct(tx, f.lemonade, {
        allergens: { sulphites: { presence: "contains" } },
        vatClass: "general",
        available: false,
      });
      await updateProduct(tx, f.extraLemon, {
        allergens: { sulphites: { presence: "contains" } },
        vatClass: "general",
      });
    });
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "product_changed",
        productId: f.lemonade,
        name: "Lemonade",
        fields: ["allergens"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
      {
        kind: "product_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        fields: ["allergens"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
    ]);
  });

  it("names a renamed Drinks as the shared section's change, also on Dinner", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app((tx) => updateSection(tx, f.drinks, { internalName: "Refreshments" }));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "section_changed",
        sectionId: f.drinks,
        name: "Refreshments",
        fields: ["names"],
        source: "shared_section",
        alsoOn: ["Dinner Menu"],
      },
    ]);
  });

  it("names a shared change on a menu no other published menu shares without an also-on list", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) => updateSection(tx, f.drinks, { internalName: "Refreshments" }));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "section_changed",
        sectionId: f.drinks,
        name: "Refreshments",
        fields: ["names"],
        source: "shared_section",
      },
    ]);
  });

  it("names each change inside a section both published menus use as shared, also on the other", async () => {
    const f = await menusFixture(fx.db);
    const juice = await app(
      async (tx) =>
        (
          await createProduct(tx, {
            catalogueId: f.lunch,
            categoryId: null,
            name: "Juice",
            customerName: { en: "Pressed juice" },
            kitchenName: "JCE",
            pricingUnit: "each",
            unitPrice: "2.50",
            vatClass: "reduced",
          })
        ).id,
    );
    await publish(f.lunch);
    await publish(f.dinner);
    const wine = await app(async (tx) => {
      await removeMember(tx, f.drinks, await sectionMemberOf(f.drinks, f.beer));
      const created = await createSection(tx, {
        internalName: "Wine",
        names: { en: "By the glass" },
      });
      await addMember(tx, f.drinks, section(created.id));
      await addMember(tx, f.drinks, product(juice));
      return created.id;
    });
    const also = { source: "shared_section", alsoOn: ["Dinner Menu"] };
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      { kind: "section_removed", sectionId: f.beer, name: "Beer", under: ["Drinks"], ...also },
      { kind: "section_added", sectionId: wine, name: "Wine", under: ["Drinks"], ...also },
      {
        kind: "product_removed",
        productId: f.lager,
        name: "Lager",
        under: ["Drinks", "Beer"],
        ...also,
      },
      { kind: "product_added", productId: juice, name: "Juice", under: ["Drinks"], ...also },
    ]);
    await publish(f.lunch);
    await publish(f.dinner);
    await app(async (tx) => moveMember(tx, f.drinks, await memberOf(f.drinks, f.lemonade), 5));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      { kind: "order_changed", list: ["Drinks"], ...also },
    ]);
  });

  it("leaves a menu out of also-on when its own matching change is its own setting", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app(async (tx) => {
      await updateProduct(tx, f.lemonade, { unitPrice: "3.20" });
      await updateMenuItem(tx, f.lunch, await offerOf(tx, f.lunch, f.lemonade), {
        grossPrice: "2.60",
      });
    });
    expect((await app((tx) => previewMenu(tx, f.dinner))).changes).toEqual([
      {
        kind: "price_changed",
        productId: f.lemonade,
        name: "Lemonade",
        from: "3.00",
        to: "3.20",
        source: "shared_product",
      },
    ]);
  });

  it("compares no other menu when every change is this menu's own", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app(async (tx) => moveMember(tx, f.lunchRoot, await memberOf(f.lunchRoot, f.soup), 0));
    const diffs = vi.spyOn(menuDocument, "diffEntries");
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      { kind: "order_changed", list: [], source: "this_menu" },
    ]);
    expect(diffs).toHaveBeenCalledOnce();
  });

  it("names a reorder of Lunch's top level as this menu's change", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app(async (tx) => moveMember(tx, f.lunchRoot, await memberOf(f.lunchRoot, f.soup), 0));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      { kind: "order_changed", list: [], source: "this_menu" },
    ]);
  });

  it("names a product the menu switched off as this menu's, and a deleted one as the product's", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app(async (tx) => {
      await updateMenuItem(tx, f.lunch, await offerOf(tx, f.lunch, f.soup), { active: false });
      await updateProduct(tx, f.lager, { active: false });
    });
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "product_removed",
        productId: f.lager,
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
      { kind: "product_removed", productId: f.soup, name: "Soup", under: [], source: "this_menu" },
    ]);
  });

  it("refuses a menu that does not exist", async () => {
    await expect(
      app((tx) => previewMenu(tx, "00000000-0000-4000-8000-000000000000")),
    ).rejects.toMatchObject({ code: "catalogue.not_found" });
  });

  it("previews a menu created after the others were published", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    const brunch = await app((tx) => createCatalogue(tx, { name: "Brunch Menu" }));
    const preview = await app((tx) => previewMenu(tx, brunch.id));
    expect(preview.changes).toEqual([]);
    expect((await app((tx) => menuStatus(tx, [brunch.id]))).get(brunch.id)).toEqual({
      state: "unpublished",
    });
  });
});
