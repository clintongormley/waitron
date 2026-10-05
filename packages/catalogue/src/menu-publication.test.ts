import { createIncludedMenu as createSection } from "../test/included-menu.js";
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
import { requireMenuRoot } from "./menu-structure.js";
import { applyLiveFields, menuDocumentHash } from "./menu-document.js";
import { writeProductModifiers } from "./product-modifiers.js";
import {
  assertLiveVersions,
  menuStatus,
  menusOfVersions,
  previewMenu,
  publishMenu,
  readLiveDocuments,
} from "./menu-publication.js";
import {
  createCatalogue,
  createProduct,
  deactivateProduct,
  updateMenuDetails,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
import { updateCategory } from "./categories.js";
import { moveCatalogueItems } from "./catalogue-items.js";
import { createExtraList, getExtraList, updateExtraList } from "./extras.js";
import { extraListItems } from "./schema/extras.js";
import { createUnit, updateUnit } from "./units.js";
import { addMember, moveMember, removeMember, updateSection, deleteSection } from "./sections.js";
import { listProductVariants, setProductVariants, setMenuVariants } from "./variants.js";
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
      clashes: 0,
      version: 1,
      publishedAt: row!.publishedAt.toISOString(),
      hash,
    });
    expect(status.get(f.dinner)).toEqual({ state: "unpublished", clashes: 0 });
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

  it("warns about an exact saved portion after unit precision drops and still publishes it", async () => {
    const f = await menusFixture(fx.db);
    const unitId = await app(async (tx) => {
      const unit = await createUnit(
        tx,
        { name: { en: "Kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
        "en",
      );
      await updateProduct(tx, f.extraLemon, { unitId: unit.id });
      await tx
        .update(extraListItems)
        .set({ portion: 55 })
        .where(eq(extraListItems.listId, f.extrasList));
      return unit.id;
    });
    await publish(f.lunch);
    await app((tx) => updateUnit(tx, unitId, { precision: 2 }, "en"));

    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.warnings).toContainEqual({
      kind: "extra_portion_precision",
      listName: "Extras",
      name: "Extra lemon",
      portion: "0.055",
      abbreviation: { en: "kg" },
      precision: 2,
    });
    await app((tx) => publishMenu(tx, f.lunch, preview.hash, "person-1"));
    const versions = await versionRows();
    expect(versions).toHaveLength(2);
    const offerId = await app((tx) => offerOf(tx, f.lunch, f.lemonade));
    const oldExtra = versions[0]!.document.offers[offerId]!.offeredModifiers[0]!;
    const newExtra = versions[1]!.document.offers[offerId]!.offeredModifiers[0]!;
    if (oldExtra.kind !== "extras" || newExtra.kind !== "extras") throw new Error("extras");
    expect(oldExtra.items[0]).toMatchObject({ portion: "0.055", unit: { precision: 3 } });
    expect(newExtra.items[0]).toMatchObject({ portion: "0.055", unit: { precision: 2 } });
  });

  it("counts the photo of a product used only as an extra among the version's images", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateProduct(tx, f.extraLemon, { image: "lemon.jpg" }));
    await publish(f.lunch);
    expect(
      (await fx.db.select().from(menuVersionImages)).map((image) => image.filename).sort(),
    ).toEqual(["large.jpg", "lemon.jpg", "lemonade.jpg"]);
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

  it("keeps empty slots for unreachable shortcuts and still publishes", async () => {
    const f = await menusFixture(fx.db);
    const [details] = await fx.db.select().from(menuDetails).where(eq(menuDetails.menuId, f.lunch));
    await fx.db.insert(sectionMembers).values([
      { sectionId: details!.defaultHomeLayoutId, position: 0, productId: f.burger },
      { sectionId: details!.defaultHomeLayoutId, position: 1, productId: f.soup },
      { sectionId: details!.defaultHomeLayoutId, position: 2, childSectionId: f.mains },
    ]);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.warnings).toEqual([
      { kind: "shortcut_missing", layoutName: "Home", name: "Burger" },
      { kind: "shortcut_missing", layoutName: "Home", name: "Mains" },
    ]);
    await app((tx) => publishMenu(tx, f.lunch, preview.hash, "person-1"));
    const live = await app((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(live.get(f.lunch)!.document.homeLayouts[0]!.tiles).toEqual([
      { kind: "empty" },
      product(f.soup),
      { kind: "empty" },
    ]);
  });
});

describe("readLiveDocuments keeps each version's parsed document", () => {
  /** The SQL of every statement `fn` prepares on the handle. */
  async function statements<T>(fn: (tx: Transaction) => Promise<T>) {
    return app(async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (q: { sql: string }) => unknown } }
      ).session;
      const prepared = vi.spyOn(session, "prepareQuery");
      const result = await fn(tx);
      const sql = prepared.mock.calls.map(([query]) => query.sql);
      prepared.mockRestore();
      return { result, sql };
    });
  }
  const documentReads = (sql: readonly string[]) => sql.filter((text) => /"document"/.test(text));

  it("reads a version's document once, and hands it back frozen", async () => {
    const f = await menusFixture(fx.db);
    const first = await publish(f.lunch);
    const cold = await statements((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(documentReads(cold.sql)).toHaveLength(1);
    const warm = await statements((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(documentReads(warm.sql)).toEqual([]);
    const [row] = await versionRows();
    expect(warm.result.get(f.lunch)).toEqual({
      versionId: first.versionId,
      document: row!.document,
    });

    const document = warm.result.get(f.lunch)!.document;
    const offer = Object.values(document.offers)[0]!;
    expect(() => {
      (offer as { name: string }).name = "Changed";
    }).toThrow(TypeError);
    expect(() => (document.root.members as unknown[]).push(null)).toThrow(TypeError);

    await app((tx) => updateProduct(tx, f.soup, { name: "Broth" }));
    const second = await publish(f.lunch);
    const republished = await statements((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(documentReads(republished.sql)).toHaveLength(1);
    expect(republished.result.get(f.lunch)!.versionId).toBe(second.versionId);
  });

  it("reads a document again when its row's content hash is not the kept one", async () => {
    const f = await menusFixture(fx.db);
    const { versionId } = await publish(f.lunch);
    const kept = (await app((tx) => readLiveDocuments(tx, [f.lunch]))).get(f.lunch)!.document;
    const triggers = fx.db.all<{ sql: string }>(
      sql`select sql from sqlite_master where type = 'trigger' and name = 'menu_versions_append_only_update'`,
    );
    fx.db.run(sql`drop trigger menu_versions_append_only_update`);
    const rewritten = { ...kept, menuName: "Rewritten" };
    await fx.db
      .update(menuVersions)
      .set({ document: rewritten, contentHash: menuDocumentHash(rewritten) })
      .where(eq(menuVersions.id, versionId));
    fx.db.run(sql.raw(triggers[0]!.sql));

    const read = await statements((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(documentReads(read.sql)).toHaveLength(1);
    expect(read.result.get(f.lunch)!.document.menuName).toBe("Rewritten");
  });

  it("keeps at most 32 documents, dropping the least recently read", async () => {
    const f = await menusFixture(fx.db);
    const menuIds = [f.lunch];
    await publish(f.lunch);
    for (let n = 1; n <= 32; n++) {
      const menu = await app((tx) => createCatalogue(tx, { name: `Menu ${n}` }));
      await publish(menu.id);
      menuIds.push(menu.id);
    }
    const reads = async (ids: readonly string[]) =>
      documentReads((await statements((tx) => readLiveDocuments(tx, ids))).sql).length;
    // One read holding more documents than are kept still answers every one of them.
    const all = await app((tx) => readLiveDocuments(tx, menuIds));
    expect([...all.values()].filter(({ document }) => document !== undefined)).toHaveLength(33);

    for (const menuId of menuIds) await reads([menuId]);
    // Lunch, read longest ago, is the one dropped; reading the rest leaves the first of them oldest.
    expect(await reads(menuIds.slice(2))).toBe(0);
    expect(await reads([f.lunch])).toBe(1);
    expect(await reads([menuIds[1]!])).toBe(1);
  });
});

describe("assertLiveVersions", () => {
  it("answers each allowed published menu's live version and document, and no unpublished one", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await publish(f.lunch);
    const live = await app((tx) => assertLiveVersions(tx, [f.lunch, f.dinner], []));
    const [row] = await versionRows();
    expect([...live.keys()]).toEqual([f.lunch]);
    expect(live.get(f.lunch)).toEqual({ versionId: lunch.versionId, document: row!.document });
  });

  it("accepts versions that are live, however many lines assert each", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await publish(f.lunch);
    const dinner = await publish(f.dinner);
    const live = await app((tx) =>
      assertLiveVersions(
        tx,
        [f.lunch, f.dinner],
        [
          { menuId: f.lunch, versionId: lunch.versionId },
          { menuId: f.dinner, versionId: dinner.versionId },
          { menuId: f.lunch, versionId: lunch.versionId },
        ],
      ),
    );
    expect(live.get(f.lunch)!.versionId).toBe(lunch.versionId);
    expect(live.get(f.dinner)!.versionId).toBe(dinner.versionId);
  });

  it("refuses a version that is no longer live, naming each such menu once with its live version", async () => {
    const f = await menusFixture(fx.db);
    const first = await publish(f.lunch);
    const dinner = await publish(f.dinner);
    await app((tx) => updateProduct(tx, f.soup, { name: "Broth" }));
    const second = await publish(f.lunch);
    await expect(
      app((tx) =>
        assertLiveVersions(
          tx,
          [f.lunch, f.dinner],
          [
            { menuId: f.lunch, versionId: first.versionId },
            { menuId: f.dinner, versionId: dinner.versionId },
            { menuId: f.lunch, versionId: first.versionId },
          ],
        ),
      ),
    ).rejects.toMatchObject({
      code: "menu.version_changed",
      params: { menus: [{ menuId: f.lunch, liveVersionId: second.versionId }] },
    });
  });

  it("refuses a version of a menu with no live version among the allowed ones", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await publish(f.lunch);
    const asserted = [{ menuId: f.lunch, versionId: lunch.versionId }];
    // Published, but not one of the menus the caller allows.
    await expect(app((tx) => assertLiveVersions(tx, [f.dinner], asserted))).rejects.toMatchObject({
      code: "menu.version_changed",
      params: { menus: [{ menuId: f.lunch, liveVersionId: null }] },
    });
    // Allowed, but never published.
    await expect(
      app((tx) =>
        assertLiveVersions(tx, [f.dinner], [{ menuId: f.dinner, versionId: lunch.versionId }]),
      ),
    ).rejects.toMatchObject({
      code: "menu.version_changed",
      params: { menus: [{ menuId: f.dinner, liveVersionId: null }] },
    });
  });
});

describe("a live version published before its document froze VAT", () => {
  /** Makes the menu's live version a copy of its current one in the earlier format, VAT left out. */
  async function liveInEarlierFormat(menuId: string): Promise<string> {
    const { versionId } = await publish(menuId);
    const [row] = await fx.db.select().from(menuVersions).where(eq(menuVersions.id, versionId));
    const document = JSON.parse(
      JSON.stringify({ ...row!.document, format: 1 }, (key, value: unknown) =>
        key === "vatClass" || key === "vatRate" ? undefined : value,
      ),
    ) as typeof row.document;
    expect(JSON.stringify(document)).not.toMatch(/vatClass|vatRate/);
    const [earlier] = await fx.db
      .insert(menuVersions)
      .values({
        menuId,
        number: row!.number + 1,
        document,
        contentHash: menuDocumentHash(document),
        publishedAt: row!.publishedAt,
        publishedBy: "person-1",
      })
      .returning({ id: menuVersions.id });
    await fx.db
      .update(menuPublications)
      .set({ versionId: earlier!.id })
      .where(eq(menuPublications.menuId, menuId));
    return earlier!.id;
  }

  it("is not served for selling, as if the menu had no live version, and its menu shows changed", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await liveInEarlierFormat(f.lunch);
    const dinner = await publish(f.dinner);
    const live = await app((tx) => readLiveDocuments(tx, [f.lunch, f.dinner]));
    expect([...live.keys()]).toEqual([f.dinner]);
    expect(live.get(f.dinner)!.versionId).toBe(dinner.versionId);
    await expect(
      app((tx) =>
        assertLiveVersions(tx, [f.lunch, f.dinner], [{ menuId: f.lunch, versionId: lunch }]),
      ),
    ).rejects.toMatchObject({
      code: "menu.version_changed",
      params: { menus: [{ menuId: f.lunch, liveVersionId: null }] },
    });
    expect(await states(f)).toEqual({ lunch: "changed", dinner: "current" });
  });
});

describe("a live version published while its document froze a VAT rate", () => {
  /** Makes the menu's live version a copy of its current one that also holds a `vatRate` beside
   * every `vatClass`, as a version published before the rate left the document does. */
  async function liveWithFrozenRates(menuId: string): Promise<string> {
    const { versionId } = await publish(menuId);
    const [row] = await fx.db.select().from(menuVersions).where(eq(menuVersions.id, versionId));
    const document = JSON.parse(
      JSON.stringify({ ...row!.document, format: 2 }, (_key, value: unknown) =>
        typeof value === "object" && value !== null && "vatClass" in value
          ? { ...value, vatRate: "10.00" }
          : value,
      ),
    ) as typeof row.document;
    expect(JSON.stringify(document)).toMatch(/"vatRate":"10.00"/);
    const [earlier] = await fx.db
      .insert(menuVersions)
      .values({
        menuId,
        number: row!.number + 1,
        document,
        contentHash: menuDocumentHash(document),
        publishedAt: row!.publishedAt,
        publishedBy: "person-1",
      })
      .returning({ id: menuVersions.id });
    await fx.db
      .update(menuPublications)
      .set({ versionId: earlier!.id })
      .where(eq(menuPublications.menuId, menuId));
    return earlier!.id;
  }

  it("is still served for selling, and its menu shows changed until it is published again", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await liveWithFrozenRates(f.lunch);
    await publish(f.dinner);

    const live = await app((tx) => readLiveDocuments(tx, [f.lunch, f.dinner]));

    expect(live.get(f.lunch)!.versionId).toBe(lunch);
    // An order naming the version it was priced against is accepted.
    await app((tx) =>
      assertLiveVersions(tx, [f.lunch, f.dinner], [{ menuId: f.lunch, versionId: lunch }]),
    );
    expect(await states(f)).toEqual({ lunch: "changed", dinner: "current" });
    await publish(f.lunch);
    expect(await states(f)).toEqual({ lunch: "current", dinner: "current" });
  });
});

/** Each live offer's colour on the menu's live version, by product id. */
async function liveColors(menuId: string): Promise<Map<string, string | null | undefined>> {
  const document = (await app((tx) => readLiveDocuments(tx, [menuId]))).get(menuId)!.document;
  const offers = (await app((tx) => applyLiveFields(tx, [document]))).get(menuId)!;
  return new Map(offers.map((offer) => [offer.productId, offer.color]));
}

const colorChange = (productId: string, name: string) => ({
  kind: "product_changed",
  productId,
  name,
  fields: ["color"],
  source: "shared_product",
});

describe("a category's colour", () => {
  it("a category colour edit is a shared change each menu publishes on its own", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app((tx) => updateCategory(tx, f.softDrinks, { color: "#256bb1" }));
    expect(await states(f)).toEqual({ lunch: "changed", dinner: "changed" });
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toContainEqual({
      ...colorChange(f.lemonade, "Lemonade"),
      alsoOn: ["Dinner Menu"],
    });
    expect((await liveColors(f.lunch)).get(f.lemonade)).toBeNull();
    await publish(f.lunch);
    expect((await liveColors(f.lunch)).get(f.lemonade)).toBe("#256bb1");
    expect((await liveColors(f.dinner)).get(f.lemonade)).toBeNull();
    await publish(f.dinner);
    expect((await liveColors(f.dinner)).get(f.lemonade)).toBe("#256bb1");
  });

  it("moving an uncoloured category under a coloured one changes the next document", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateCategory(tx, f.coldDrinks, { color: "#25b125" }));
    await publish(f.lunch);
    expect(await states(f)).toMatchObject({ lunch: "current" });
    await app((tx) => updateCategory(tx, f.softDrinks, { parentId: f.coldDrinks }));
    expect(await states(f)).toMatchObject({ lunch: "changed" });
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      colorChange(f.lemonade, "Lemonade"),
      colorChange(f.lager, "Lager"),
      colorChange(f.soup, "Soup"),
    ]);
    await publish(f.lunch);
    expect(await liveColors(f.lunch)).toEqual(
      new Map([
        [f.lemonade, "#25b125"],
        [f.lager, "#25b125"],
        [f.soup, "#25b125"],
      ]),
    );
  });

  it("moving it with the Products tree's Move is a colour change to publish", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => updateCategory(tx, f.coldDrinks, { color: "#25b125" }));
    await publish(f.lunch);
    expect(await states(f)).toMatchObject({ lunch: "current" });
    await app((tx) =>
      moveCatalogueItems(tx, { productIds: [], categoryIds: [f.softDrinks] }, f.coldDrinks),
    );
    expect(await states(f)).toMatchObject({ lunch: "changed" });
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      colorChange(f.lemonade, "Lemonade"),
      colorChange(f.lager, "Lager"),
      colorChange(f.soup, "Soup"),
    ]);
    expect((await liveColors(f.lunch)).get(f.lemonade)).toBeNull();
    await publish(f.lunch);
    expect((await liveColors(f.lunch)).get(f.lemonade)).toBe("#25b125");
  });
});

describe("a live version published before offers carried a colour", () => {
  /** Makes the menu's live version a copy of its current one with no `color` on any offer; a
   * section's colour predates it and stays. */
  async function liveWithoutOfferColors(menuId: string): Promise<string> {
    const { versionId } = await publish(menuId);
    const [row] = await fx.db.select().from(menuVersions).where(eq(menuVersions.id, versionId));
    const document = {
      ...row!.document,
      format: 2 as const,
      offers: Object.fromEntries(
        Object.entries(row!.document.offers).map(([id, offer]) => {
          const earlier = { ...offer };
          delete earlier.color;
          return [id, earlier];
        }),
      ),
    };
    for (const offer of Object.values(document.offers)) expect(offer).not.toHaveProperty("color");
    const [earlier] = await fx.db
      .insert(menuVersions)
      .values({
        menuId,
        number: row!.number + 1,
        document,
        contentHash: menuDocumentHash(document),
        publishedAt: row!.publishedAt,
        publishedBy: "person-1",
      })
      .returning({ id: menuVersions.id });
    await fx.db
      .update(menuPublications)
      .set({ versionId: earlier!.id })
      .where(eq(menuPublications.menuId, menuId));
    return earlier!.id;
  }

  it("is still served, serves no colour, and its menu shows each offer's colour as a change", async () => {
    const f = await menusFixture(fx.db);
    const lunch = await liveWithoutOfferColors(f.lunch);
    const live = await app((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(live.get(f.lunch)!.versionId).toBe(lunch);
    expect(await states(f)).toMatchObject({ lunch: "changed" });
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      colorChange(f.lemonade, "Lemonade"),
      colorChange(f.lager, "Lager"),
      colorChange(f.soup, "Soup"),
    ]);
    const offers = (await app((tx) => applyLiveFields(tx, [live.get(f.lunch)!.document]))).get(
      f.lunch,
    )!;
    expect(offers).toHaveLength(3);
    for (const offer of offers) expect(offer).not.toHaveProperty("color");
  });
});

describe("menusOfVersions", () => {
  it("names the menu of every version, live or not, and leaves out an id that is no version", async () => {
    const f = await menusFixture(fx.db);
    const first = await publish(f.lunch);
    await app((tx) => updateProduct(tx, f.soup, { name: "Broth" }));
    const second = await publish(f.lunch);
    const dinner = await publish(f.dinner);
    const unknown = "00000000-0000-4000-8000-000000000000";
    const menus = await app((tx) =>
      menusOfVersions(tx, [first.versionId, second.versionId, dinner.versionId, unknown]),
    );
    expect(menus).toEqual(
      new Map([
        [first.versionId, f.lunch],
        [second.versionId, f.lunch],
        [dinner.versionId, f.dinner],
      ]),
    );
    await expect(app((tx) => menusOfVersions(tx, []))).resolves.toEqual(new Map());
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

  it("answers every menu when no ids are named", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    const brunch = await app((tx) => createCatalogue(tx, { name: "Brunch Menu" }));
    const status = await app((tx) => menuStatus(tx));
    expect([...status.keys()].sort()).toEqual([f.lunch, f.dinner, f.drinksMenu, brunch.id].sort());
    expect(status.get(f.dinner)).toMatchObject({ state: "current", version: 1 });
    expect(status.get(brunch.id)).toEqual({ state: "unpublished", clashes: 0 });
  });

  // Review Focus 3: shared edits flag exactly the menus they change.
  describe("flags exactly the menus an included-menu edit changes", () => {
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

    it("flags neither for a reporting category", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.lemonade, { categoryId: f.coldDrinks }));
      expect(await states(f)).toEqual({ lunch: "current", dinner: "current" });
    });

    it("flags both for Lemonade's VAT class, each naming the shared product", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.lemonade, { vatClass: "general" }));
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
            fields: ["vat"],
            source: "shared_product",
            alsoOn: [other],
          },
        ]);
    });

    it("flags both for the VAT class of Lemonade's Large variant", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.large, { vatClass: "general" }));
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "changed" });
    });

    it("flags both for Extra lemon's VAT class, used only as an extra, naming the shared product", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.extraLemon, { vatClass: "general" }));
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "changed" });
      expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
        {
          kind: "product_changed",
          productId: f.extraLemon,
          name: "Extra lemon",
          fields: ["vat"],
          source: "shared_product",
          alsoOn: ["Dinner Menu"],
        },
      ]);
    });

    it("flags Dinner alone for Burger's VAT class", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.burger, { vatClass: "general" }));
      expect(await states(f)).toEqual({ lunch: "current", dinner: "changed" });
    });

    it("flags both for an included product price while Lunch keeps its own price", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.lemonade, { unitPrice: "3.20" }));
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "changed" });
    });

    it("flags Dinner alone for Burger's price", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.burger, { unitPrice: "13.00" }));
      expect(await states(f)).toEqual({ lunch: "current", dinner: "changed" });
    });

    it("flags Lunch alone when it sets Soup's own price to the 5.00 it already charged", async () => {
      const f = await published();
      const soupOffer = await app((tx) => offerOf(tx, f.lunch, f.soup));
      const charged = async () =>
        (await app((tx) => menuDocument.buildMenuDocument(tx, f.lunch))).document.offers[soupOffer]!
          .unitPrice;
      expect(await charged()).toBe("5.00");
      await app((tx) => updateMenuItem(tx, f.lunch, soupOffer, { grossPrice: "5.00" }));
      expect(await charged()).toBe("5.00");
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "current" });
    });

    it("flags Lunch alone when it sets Large's price to the 3.50 it already charged", async () => {
      const f = await published();
      const lemonadeOffer = await app((tx) => offerOf(tx, f.lunch, f.lemonade));
      const charged = async () =>
        (await app((tx) => menuDocument.buildMenuDocument(tx, f.lunch))).document.offers[
          lemonadeOffer
        ]!.variants.find((variant) => variant.id === f.large)!.unitPrice;
      expect(await charged()).toBe("3.50");
      await app((tx) =>
        setMenuVariants(tx, lemonadeOffer, [{ variantId: f.large, price: "3.50" }], f.lunch),
      );
      expect(await charged()).toBe("3.50");
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "current" });
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

    // The published menu carries the setting (spec §9): a change flags the menu, and what is live
    // keeps the old setting until the menu is published again.
    it("flags Lunch alone for Soup's ordering, and publishing freezes the new setting", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.soup, { ordering: "not_sold_separately" }));
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "current" });
      expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
        {
          kind: "product_changed",
          productId: f.soup,
          name: "Soup",
          fields: ["ordering"],
          source: "shared_product",
        },
      ]);
      const soupOffer = await app((tx) => offerOf(tx, f.lunch, f.soup));
      const liveOrdering = async () =>
        (await app((tx) => readLiveDocuments(tx, [f.lunch]))).get(f.lunch)!.document.offers[
          soupOffer
        ]!.ordering;
      expect(await liveOrdering()).toBe("public");
      await publish(f.lunch);
      expect(await states(f)).toEqual({ lunch: "current", dinner: "current" });
      expect(await liveOrdering()).toBe("not_sold_separately");
    });

    it("flags neither for Extra lemon's ordering, used only as an extra", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.extraLemon, { ordering: "not_sold_separately" }));
      expect(await states(f)).toEqual({ lunch: "current", dinner: "current" });
    });

    it("flags neither for Lemonade made unavailable", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.lemonade, { available: false }));
      expect(await states(f)).toEqual({ lunch: "current", dinner: "current" });
    });

    it("flags both for a new photo on Extra lemon, used only as an extra, naming the shared product", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.extraLemon, { image: "lemon.jpg" }));
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "changed" });
      expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
        {
          kind: "product_changed",
          productId: f.extraLemon,
          name: "Extra lemon",
          fields: ["image"],
          source: "shared_product",
          alsoOn: ["Dinner Menu"],
        },
      ]);
    });

    it("attributes a portion edit only to menus offering that extras list", async () => {
      const f = await menusFixture(fx.db);
      const lunchOnly = await app(async (tx) => {
        const list = await createExtraList(
          tx,
          {
            name: "Soup extras",
            minPicks: 0,
            maxPicks: 2,
            items: [{ productId: f.extraLemon, price: "0.40" }],
          },
          "en",
        );
        await writeProductModifiers(tx, f.soup, [{ kind: "extras", id: list.id }]);
        return list.id;
      });
      await publish(f.lunch);
      await publish(f.dinner);
      await fx.db
        .update(extraListItems)
        .set({ portion: 2000 })
        .where(eq(extraListItems.listId, f.extrasList));
      await fx.db
        .update(extraListItems)
        .set({ portion: 3000 })
        .where(eq(extraListItems.listId, lunchOnly));

      expect(
        (await app((tx) => previewMenu(tx, f.lunch))).changes.filter(
          (change) => change.kind === "extra_portion_changed",
        ),
      ).toEqual([
        expect.objectContaining({ listId: f.extrasList, alsoOn: ["Dinner Menu"] }),
        expect.objectContaining({ listId: lunchOnly }),
      ]);
      expect(
        (await app((tx) => previewMenu(tx, f.lunch))).changes.find(
          (change) => change.kind === "extra_portion_changed" && change.listId === lunchOnly,
        ),
      ).not.toHaveProperty("alsoOn");
    });

    it("attributes a unit edit only to menus offering that extras list", async () => {
      const f = await menusFixture(fx.db);
      const lunchOnly = await app(async (tx) => {
        const list = await createExtraList(
          tx,
          {
            name: "Soup extras",
            minPicks: 0,
            maxPicks: 2,
            items: [{ productId: f.extraLemon, price: "0.40" }],
          },
          "en",
        );
        await writeProductModifiers(tx, f.soup, [{ kind: "extras", id: list.id }]);
        return list.id;
      });
      await publish(f.lunch);
      await publish(f.dinner);
      await app(async (tx) => {
        const unit = await createUnit(
          tx,
          { name: { en: "Kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
          "en",
        );
        await updateProduct(tx, f.extraLemon, { unitId: unit.id });
      });

      const changes = (await app((tx) => previewMenu(tx, f.lunch))).changes.filter(
        (change) => change.kind === "extra_unit_changed",
      );
      expect(changes).toEqual([
        expect.objectContaining({ listId: f.extrasList, alsoOn: ["Dinner Menu"] }),
        expect.objectContaining({ listId: lunchOnly }),
      ]);
      expect(
        changes.find(
          (change) => change.kind === "extra_unit_changed" && change.listId === lunchOnly,
        ),
      ).not.toHaveProperty("alsoOn");
    });

    it("keeps separate item-limit changes for two lists in one menu", async () => {
      const f = await menusFixture(fx.db);
      const lunchOnly = await app(async (tx) => {
        const list = await createExtraList(
          tx,
          {
            name: "Soup extras",
            minPicks: 0,
            maxPicks: 2,
            items: [{ productId: f.extraLemon, price: "0.40" }],
          },
          "en",
        );
        await writeProductModifiers(tx, f.soup, [{ kind: "extras", id: list.id }]);
        return list.id;
      });
      await publish(f.lunch);
      await publish(f.dinner);
      await fx.db
        .update(extraListItems)
        .set({ maxQuantity: null })
        .where(eq(extraListItems.productId, f.extraLemon));

      const changes = (await app((tx) => previewMenu(tx, f.lunch))).changes.filter(
        (change) => change.kind === "extra_max_quantity_changed",
      );
      expect(changes).toEqual([
        expect.objectContaining({ listId: f.extrasList, alsoOn: ["Dinner Menu"] }),
        expect.objectContaining({ listId: lunchOnly }),
      ]);
      expect(changes.find((change) => change.listId === lunchOnly)).not.toHaveProperty("alsoOn");
    });

    it("flags both for Extra lemon deleted, naming the product and each dish's extras", async () => {
      const f = await published();
      await app((tx) => deactivateProduct(tx, f.extraLemon));
      expect(await states(f)).toEqual({ lunch: "changed", dinner: "changed" });
      expect((await app((tx) => previewMenu(tx, f.dinner))).changes).toEqual([
        {
          kind: "product_changed",
          productId: f.lemonade,
          name: "Lemonade",
          fields: ["extras"],
          source: "shared_product",
          alsoOn: ["Lunch Menu"],
        },
        {
          kind: "product_deleted",
          productId: f.extraLemon,
          name: "Extra lemon",
          source: "shared_product",
          alsoOn: ["Lunch Menu"],
        },
      ]);
    });

    it("does not add a second deletion line when the extra was also a dish in that menu", async () => {
      const f = await menusFixture(fx.db);
      await app((tx) => addMember(tx, f.dinnerRoot, product(f.extraLemon)));
      await publish(f.lunch);
      await publish(f.dinner);
      await app((tx) => deactivateProduct(tx, f.extraLemon));

      const changes = (await app((tx) => previewMenu(tx, f.dinner))).changes.filter(
        (change) => "productId" in change && change.productId === f.extraLemon,
      );
      expect(changes).toEqual([
        {
          kind: "product_removed",
          productId: f.extraLemon,
          name: "Extra lemon",
          under: [],
          source: "shared_product",
        },
      ]);
    });

    it("does not match different deleted extras across menus", async () => {
      const f = await menusFixture(fx.db);
      await app(async (tx) => {
        await removeMember(tx, f.lunchRoot, await memberOf(f.lunchRoot, f.soup));
        const lunchExtras = await createExtraList(
          tx,
          {
            name: "Lunch extras",
            customerName: { en: "Lunch additions" },
            kitchenName: "LUNCH EXTRAS",
            minPicks: 0,
            maxPicks: 1,
            items: [{ productId: f.soup, price: null }],
          },
          "en",
        );
        await writeProductModifiers(tx, f.lemonade, [
          { kind: "extras", id: lunchExtras.id },
          { kind: "options", id: f.iceList },
        ]);
      });
      await publish(f.lunch);
      await app((tx) =>
        writeProductModifiers(tx, f.lemonade, [
          { kind: "extras", id: f.extrasList },
          { kind: "options", id: f.iceList },
        ]),
      );
      await publish(f.dinner);
      await app(async (tx) => {
        await deactivateProduct(tx, f.soup);
        await deactivateProduct(tx, f.extraLemon);
      });

      for (const [menuId, productId, name] of [
        [f.lunch, f.soup, "Soup"],
        [f.dinner, f.extraLemon, "Extra lemon"],
      ] as const) {
        const deletions = (await app((tx) => previewMenu(tx, menuId))).changes.filter(
          (change) => change.kind === "product_deleted",
        );
        expect(deletions).toEqual([
          { kind: "product_deleted", productId, name, source: "shared_product" },
        ]);
      }
    });

    it("does not call an active product deleted when its extras list is disabled", async () => {
      const f = await published();
      await app(async (tx) => {
        const list = await getExtraList(tx, f.extrasList);
        await updateExtraList(
          tx,
          f.extrasList,
          {
            name: list.name,
            customerName: list.customerName,
            kitchenName: list.kitchenName,
            minPicks: list.minPicks,
            maxPicks: list.maxPicks,
            active: false,
            items: list.items,
          },
          "en",
        );
      });
      expect((await app((tx) => previewMenu(tx, f.dinner))).changes).toEqual([
        {
          kind: "product_changed",
          productId: f.lemonade,
          name: "Lemonade",
          fields: ["extras", "options"],
          source: "shared_product",
          alsoOn: ["Lunch Menu"],
        },
      ]);
    });

    it("flags neither for Extra lemon made unavailable", async () => {
      const f = await published();
      await app((tx) => updateProduct(tx, f.extraLemon, { available: false }));
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

  it("names Lemonade added under Drinks as an included menu change when no other published menu uses Drinks", async () => {
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
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
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
        fields: ["allergens", "vat"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
      {
        kind: "product_changed",
        productId: f.extraLemon,
        name: "Extra lemon",
        fields: ["allergens", "vat"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
    ]);
  });

  it("names an included Drinks menu's rename, also on Dinner", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app((tx) => updateMenuDetails(tx, f.drinksMenu, { name: "Refreshments" }));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "section_changed",
        sectionId: f.drinks,
        name: "Refreshments",
        fields: ["names"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Refreshments" },
        alsoOn: ["Dinner Menu"],
      },
    ]);
  });

  it("names a shared change on a menu no other published menu shares without an also-on list", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) => updateMenuDetails(tx, f.drinksMenu, { name: "Refreshments" }));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "section_changed",
        sectionId: f.drinks,
        name: "Refreshments",
        fields: ["names"],
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Refreshments" },
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
      await deleteSection(tx, f.beer);
      const created = await createSection(tx, {
        internalName: "Wine",
        names: { en: "By the glass" },
      });
      await addMember(tx, f.drinks, section(created.id));
      await addMember(tx, f.drinks, product(juice));
      return created.id;
    });
    const also = {
      source: "included_menu",
      includedMenu: { id: f.drinksMenu, name: "Drinks" },
      alsoOn: ["Dinner Menu"],
    };
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
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
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

  it("builds only this menu's document when every change is its own", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app(async (tx) => moveMember(tx, f.lunchRoot, await memberOf(f.lunchRoot, f.soup), 0));
    const offers = vi.spyOn(operations, "listMenuOffers");
    await app((tx) => previewMenu(tx, f.lunch));
    expect(offers.mock.calls.map(([, menuIds]) => menuIds)).toEqual([[f.lunch, f.drinksMenu]]);
  });

  it("builds the other published menus, and no unpublished one, only when a change is shared", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app((tx) => createCatalogue(tx, { name: "Brunch Menu" }));
    await app((tx) =>
      updateProduct(tx, f.lemonade, { allergens: { sulphites: { presence: "contains" } } }),
    );
    const graphs = vi.spyOn(sectionGraph, "loadSectionGraph");
    const offers = vi.spyOn(operations, "listMenuOffers");
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.changes.map((change) => change.alsoOn)).toEqual([["Dinner Menu"]]);
    expect(offers.mock.calls.map(([, menuIds]) => menuIds)).toEqual([
      [f.lunch, f.drinksMenu],
      [f.dinner, f.drinksMenu],
    ]);
    expect(graphs).toHaveBeenCalledOnce();
  });

  it("attributes included folder changes to the other published parent", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    await app(async (tx) => {
      await updateMenuDetails(tx, f.drinksMenu, { name: "Refreshments" });
      await moveMember(tx, f.drinks, await memberOf(f.drinks, f.lemonade), 5);
    });
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.changes.map((change) => change.alsoOn)).toEqual([
      ["Dinner Menu"],
      ["Dinner Menu"],
    ]);
  });

  it("carries the menu's live-version status beside its changes", async () => {
    const f = await menusFixture(fx.db);
    expect((await app((tx) => previewMenu(tx, f.lunch))).status).toEqual({
      state: "unpublished",
      clashes: 0,
    });
    const { hash } = await app((tx) => previewMenu(tx, f.lunch));
    await app((tx) => publishMenu(tx, f.lunch, hash, "person-1"));
    const [row] = await versionRows();
    const current = await app((tx) => previewMenu(tx, f.lunch));
    expect(current.status).toEqual({
      state: "current",
      clashes: 0,
      version: 1,
      publishedAt: row!.publishedAt.toISOString(),
      hash,
    });
    expect(current.status).toEqual((await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch));
    await app((tx) => updateProduct(tx, f.soup, { name: "Broth" }));
    const changed = await app((tx) => previewMenu(tx, f.lunch));
    expect(changed.status).toEqual({ ...current.status, state: "changed" });
    expect(changed.hash).not.toBe(hash);
  });

  it("carries the whole document the publish would make live", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) => updateProduct(tx, f.soup, { name: "Broth" }));
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    const { document } = await app((tx) => menuDocument.buildMenuDocument(tx, f.lunch));
    expect(preview.document).toEqual(document);
    expect(menuDocumentHash(preview.document)).toBe(preview.hash);
    expect(Object.values(preview.document.offers).map((offer) => offer.name)).toContain("Broth");
  });

  it("names a reorder of Lunch's top level as this menu's change", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app(async (tx) => moveMember(tx, f.lunchRoot, await memberOf(f.lunchRoot, f.soup), 0));
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      { kind: "order_changed", list: [], source: "this_menu" },
    ]);
  });

  it("names a product taken off the menu as this menu's, and a deleted one as the product's", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await publish(f.dinner);
    const soupMember = await memberOf(f.lunchRoot, f.soup);
    await app(async (tx) => {
      await removeMember(tx, f.lunchRoot, soupMember);
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
      clashes: 0,
    });
  });
});

describe("a published menu serves each variant as sellable as it is itself", () => {
  const serve = (menuId: string) =>
    app(async (tx) => {
      const live = await readLiveDocuments(tx, [menuId]);
      return (await applyLiveFields(tx, [live.get(menuId)!.document])).get(menuId)!;
    });
  const setLargeAvailable = (f: MenusFixture, available: boolean) =>
    app(async (tx) =>
      setProductVariants(
        tx,
        f.lemonade,
        (await listProductVariants(tx, f.lemonade)).map((variant) =>
          variant.id === f.large ? { ...variant, available } : variant,
        ),
        "en",
      ),
    );

  it("lists an Unavailable variant as not sellable, and sells it once Available without a republish", async () => {
    const f = await menusFixture(fx.db);
    await setLargeAvailable(f, false);
    await publish(f.lunch);
    const large = async () =>
      (await serve(f.lunch))
        .find((offer) => offer.productId === f.lemonade)!
        .variants.find((variant) => variant.id === f.large)!;
    expect(await large()).toMatchObject({ id: f.large, available: false });
    expect(await large()).not.toHaveProperty("offered");
    expect(await large()).not.toHaveProperty("ownOffered");
    await setLargeAvailable(f, true);
    expect(await large()).toMatchObject({ id: f.large, available: true });
    expect(await versionRows()).toHaveLength(1);
  });

  it("previews a menu including another with its price clashes and nothing else", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      // Dinner places Lemonade itself and reaches it through Drinks, which prices Large apart.
      await addMember(tx, f.dinnerRoot, product(f.lemonade));
      await setMenuVariants(
        tx,
        await offerOf(tx, f.drinksMenu, f.lemonade),
        [{ variantId: f.large, price: "4.20" }],
        f.drinksMenu,
      );
    });
    const preview = await app((tx) => previewMenu(tx, f.dinner));
    expect(
      preview.clashes.map(({ productId, variantId, field }) => ({ productId, variantId, field })),
    ).toEqual([{ productId: f.lemonade, variantId: f.large, field: "price" }]);
  });
});

describe("combined menu publication", () => {
  it("refuses to publish a variant price clash, writing nothing", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app(async (tx) => {
      await addMember(tx, f.dinnerRoot, product(f.lemonade));
      await setMenuVariants(
        tx,
        await offerOf(tx, f.drinksMenu, f.lemonade),
        [{ variantId: f.large, price: "4.20" }],
        f.drinksMenu,
      );
    });
    const preview = await app((tx) => previewMenu(tx, f.dinner));
    expect(
      preview.clashes.map(({ productId, variantId, field }) => ({ productId, variantId, field })),
    ).toEqual([{ productId: f.lemonade, variantId: f.large, field: "price" }]);
    const before = await versionRows();
    const publications = await fx.db.select().from(menuPublications);
    const images = await fx.db.select().from(menuVersionImages);
    await expect(publish(f.dinner)).rejects.toMatchObject({
      code: "menu.clashes_unresolved",
      params: { menuId: f.dinner, count: 1 },
    });
    expect(await versionRows()).toEqual(before);
    expect(await fx.db.select().from(menuPublications)).toEqual(publications);
    expect(await fx.db.select().from(menuVersionImages)).toEqual(images);
  });
  it("inherits included prices, refuses clashes without writing, and attributes the included edit", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app(async (tx) => {
      await addMember(tx, f.lunchRoot, product(f.lager));
      await updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
        grossPrice: "4.50",
      });
    });
    const status = await app((tx) => menuStatus(tx, [f.lunch]));
    expect(status.get(f.lunch)).toMatchObject({ clashes: 1 });
    const before = (await versionRows()).length;
    await expect(publish(f.lunch)).rejects.toMatchObject({
      code: "menu.clashes_unresolved",
      params: { menuId: f.lunch, count: 1 },
    });
    expect((await versionRows()).length).toBe(before);
    await publish(f.drinksMenu);
    const preview = await app((tx) => previewMenu(tx, f.dinner));
    expect(preview.changes).toContainEqual(
      expect.objectContaining({
        kind: "price_changed",
        productId: f.lager,
        from: "4.00",
        to: "4.50",
        source: "included_menu",
        includedMenu: { id: f.drinksMenu, name: "Drinks" },
      }),
    );
  });
  it("marks direct and indirect parents changed when an own price masks an included edit", async () => {
    const f = await menusFixture(fx.db);
    const outer = await app(async (tx) => {
      await updateMenuItem(tx, f.dinner, await offerOf(tx, f.dinner, f.lager), {
        grossPrice: "9.00",
      });
      const menu = await createCatalogue(tx, { name: "Outer" });
      const root = await requireMenuRoot(tx, menu.id);
      await addMember(tx, root, section(f.dinnerRoot));
      return menu.id;
    });
    await publish(f.dinner);
    await publish(outer);
    await app(async (tx) => {
      await updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
        grossPrice: "5.00",
      });
    });
    const status = await app((tx) => menuStatus(tx, [f.dinner, outer]));
    expect([...status.values()].map((s) => s.state)).toEqual(["changed", "changed"]);
  });
  it("omits an inactive inclusion's offers from management prices", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => operations.deactivateCatalogue(tx, f.drinksMenu));
    expect(
      (await app((tx) => operations.menuPrices(tx, f.dinner))).map((p) => p.productId),
    ).toEqual([f.burger]);
  });
});

it("filters inactive top-level and transitive menus before combining", async () => {
  const f = await menusFixture(fx.db);
  const outer = await app(async (tx) => {
    const outer = await createCatalogue(tx, { name: "Outer" });
    await addMember(tx, await requireMenuRoot(tx, outer.id), section(f.dinnerRoot));
    return outer.id;
  });
  await app((tx) => operations.deactivateCatalogue(tx, f.drinksMenu));
  expect((await app((tx) => operations.menuPrices(tx, outer))).map((p) => p.productId)).toEqual([
    f.burger,
  ]);
  await app((tx) => operations.deactivateCatalogue(tx, outer));
  expect(await app((tx) => operations.menuPrices(tx, outer))).toEqual([]);
  expect(await app((tx) => operations.listMenuOffers(tx, [outer]))).toEqual([]);
});

it("attributes included size decisions to the directly included menu", async () => {
  const f = await menusFixture(fx.db);
  await publish(f.dinner);
  await app(async (tx) =>
    setMenuVariants(
      tx,
      await offerOf(tx, f.drinksMenu, f.lemonade),
      [{ variantId: f.large, price: "4.20" }],
      f.drinksMenu,
    ),
  );
  const changes = (await app((tx) => previewMenu(tx, f.dinner))).changes;
  expect(changes).toContainEqual(
    expect.objectContaining({
      kind: "product_changed",
      productId: f.lemonade,
      fields: ["variants"],
      source: "included_menu",
      includedMenu: { id: f.drinksMenu, name: "Drinks" },
    }),
  );
});

it("marks parents changed for an included price edit its own price masks", async () => {
  const f = await menusFixture(fx.db);
  await app(async (tx) => {
    await updateMenuItem(tx, f.dinner, await offerOf(tx, f.dinner, f.lager), {
      grossPrice: "9.00",
    });
  });
  await publish(f.dinner);
  await app(async (tx) =>
    updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
      grossPrice: "5.00",
    }),
  );
  const preview = await app((tx) => previewMenu(tx, f.dinner));
  expect(preview.status.state).toBe("changed");
  expect(preview.document.offers[await app((tx) => offerOf(tx, f.dinner, f.lager))]).toMatchObject({
    unitPrice: "9.00",
  });
  await publish(f.dinner);
  expect((await app((tx) => previewMenu(tx, f.dinner))).status.state).toBe("current");
});
it("attributes a product an included menu takes out of its structure to that menu", async () => {
  const f = await menusFixture(fx.db);
  await publish(f.dinner);
  const lagerMember = await memberOf(f.beer, f.lager);
  await app((tx) => removeMember(tx, f.beer, lagerMember));
  expect((await app((tx) => previewMenu(tx, f.dinner))).changes).toContainEqual(
    expect.objectContaining({
      kind: "product_removed",
      productId: f.lager,
      source: "included_menu",
      includedMenu: { id: f.drinksMenu, name: "Drinks" },
    }),
  );
});
it("lists direct and indirect parents beside an included menu's own price edit even when masked", async () => {
  const f = await menusFixture(fx.db);
  const outer = await app(async (tx) => {
    await updateMenuItem(tx, f.dinner, await offerOf(tx, f.dinner, f.lager), {
      grossPrice: "9.00",
    });
    const outer = await createCatalogue(tx, { name: "Outer" });
    await addMember(tx, await requireMenuRoot(tx, outer.id), section(f.dinnerRoot));
    return outer.id;
  });
  await publish(f.drinksMenu);
  await publish(f.dinner);
  await publish(outer);
  await app(async (tx) =>
    updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
      grossPrice: "5.00",
    }),
  );
  expect((await app((tx) => previewMenu(tx, f.drinksMenu))).changes).toContainEqual(
    expect.objectContaining({
      kind: "price_changed",
      productId: f.lager,
      source: "this_menu",
      alsoOn: ["Dinner Menu", "Outer"],
    }),
  );
});

describe("the management prices read", () => {
  it("gives an Active row of the management prices the combined decisions a till's offer has", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
        grossPrice: "5.00",
      });
      await setProductVariants(
        tx,
        f.lemonade,
        [
          {
            id: f.large,
            name: "Large",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "3.50",
            available: true,
          },
          {
            name: "Jug",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "9.00",
            available: true,
            active: false,
          },
        ],
        "en",
      );
    });
    const prices = await app((tx) => operations.menuPrices(tx, f.dinner));
    const offers = await app((tx) => operations.listMenuOffers(tx, [f.dinner]));
    for (const offer of offers) {
      const row = prices.find(({ productId }) => productId === offer.productId)!;
      const active = new Set(row.variants.filter((v) => v.active).map((v) => v.variantId));
      expect({
        ...row.combined,
        variants: row.combined.variants.filter((v) => active.has(v.variantId)),
      }).toEqual(offer.combined);
    }
  });

  it("lists an inactive product an included menu prices, with that menu as its source, and its clash without blocking publication", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
        grossPrice: "5.00",
      });
      // Dinner also places Lager itself, at its own 4.00: a clash with Drinks' 5.00.
      await addMember(tx, f.dinnerRoot, product(f.lager));
      await deactivateProduct(tx, f.lager);
    });
    const lager = (await app((tx) => operations.menuPrices(tx, f.dinner))).find(
      ({ productId }) => productId === f.lager,
    )!;
    expect(lager.active).toBe(false);
    expect(lager.combined.price).toEqual({
      state: "clash",
      candidates: [
        { place: { kind: "own_sections" }, value: "4.00", source: { kind: "product" } },
        {
          place: { kind: "menu", menuId: f.drinksMenu, menuName: "Drinks" },
          value: "5.00",
          source: { kind: "menu", menuId: f.drinksMenu, menuName: "Drinks", from: { kind: "own" } },
        },
      ],
    });
    const preview = await app((tx) => previewMenu(tx, f.dinner));
    expect(preview.clashes.filter(({ productId }) => productId === f.lager)).toEqual([]);
    expect((await app((tx) => menuStatus(tx, [f.dinner]))).get(f.dinner)!.clashes).toBe(0);
  });
});

describe("review regressions", () => {
  it.each([false, true])(
    "previews own placement with inactive inclusion present=%s",
    async (includeInactive) => {
      const f = await menusFixture(fx.db);
      const parent = await app(async (tx) => {
        const parent = await createCatalogue(tx, { name: "Own placement" });
        const root = await requireMenuRoot(tx, parent.id);
        if (includeInactive) await addMember(tx, root, section(f.drinks));
        await addMember(tx, root, product(f.lager));
        await operations.deactivateCatalogue(tx, f.drinksMenu);
        return parent.id;
      });
      const preview = await app((tx) => previewMenu(tx, parent));
      const offer = Object.values(preview.document.offers).find((o) => o.productId === f.lager);
      expect(offer).toMatchObject({ placements: [[]], unitPrice: "4.00" });
      expect(preview.changes).toEqual([
        {
          kind: "product_added",
          productId: f.lager,
          name: "Lager",
          under: [],
          source: "this_menu",
        },
      ]);
      expect(
        (await app((tx) => operations.listMenuOffers(tx, [parent]))).map((o) => o.placements),
      ).toEqual([[[]]]);
      expect(
        (await app((tx) => operations.menuPrices(tx, parent))).map((o) => o.placements),
      ).toEqual([[[]]]);
    },
  );

  it.each(["own", "shared"])(
    "retains %s variant attribution beside an included size edit",
    async (otherSource) => {
      const f = await menusFixture(fx.db);
      const small = await app(async (tx) => {
        const variants = await setProductVariants(
          tx,
          f.lemonade,
          [
            {
              id: f.large,
              name: "Large",
              customerName: { en: "A big glass" },
              kitchenName: "LRG",
              image: "large.jpg",
              unitPrice: "3.50",
              available: true,
            },
            {
              name: "Small",
              customerName: { en: "A small glass" },
              kitchenName: "SML",
              image: null,
              unitPrice: "2.00",
              available: true,
            },
          ],
          "en",
        );
        return variants[1]!.id;
      });
      await publish(f.dinner);
      await app(async (tx) => {
        await setMenuVariants(
          tx,
          await offerOf(tx, f.drinksMenu, f.lemonade),
          [{ variantId: f.large, price: "4.20" }],
          f.drinksMenu,
        );
        if (otherSource === "own")
          await setMenuVariants(
            tx,
            await offerOf(tx, f.dinner, f.lemonade),
            [{ variantId: small, price: "2.50" }],
            f.dinner,
          );
        else
          await setProductVariants(
            tx,
            f.lemonade,
            [
              {
                id: f.large,
                name: "Large",
                customerName: { en: "A big glass" },
                kitchenName: "LRG",
                image: "large.jpg",
                unitPrice: "3.50",
                available: true,
              },
              {
                id: small,
                name: "Tiny",
                customerName: { en: "A small glass" },
                kitchenName: "SML",
                image: null,
                unitPrice: "2.00",
                available: true,
              },
            ],
            "en",
          );
      });
      const changes = (await app((tx) => previewMenu(tx, f.dinner))).changes.filter(
        (c) => c.kind === "product_changed" && c.productId === f.lemonade,
      );
      expect(changes).toContainEqual(
        expect.objectContaining({
          fields: ["variants"],
          source: otherSource === "own" ? "this_menu" : "shared_product",
        }),
      );
      expect(changes).toContainEqual(
        expect.objectContaining({
          fields: ["variants"],
          source: "included_menu",
          includedMenu: { id: f.drinksMenu, name: "Drinks" },
        }),
      );
    },
  );
});

it("retains two direct included sources for independent size edits", async () => {
  const f = await menusFixture(fx.db);
  const setup = await app(async (tx) => {
    const [large, small] = await setProductVariants(
      tx,
      f.lemonade,
      [
        {
          id: f.large,
          name: "Large",
          customerName: { en: "A big glass" },
          kitchenName: "LRG",
          image: null,
          unitPrice: null,
          available: true,
        },
        {
          name: "Small",
          customerName: { en: "A small glass" },
          kitchenName: "SML",
          image: null,
          unitPrice: null,
          available: true,
        },
      ],
      "en",
    );
    const second = await createCatalogue(tx, { name: "Second drinks" });
    const root = await requireMenuRoot(tx, second.id);
    await addMember(tx, root, product(f.lemonade));
    await addMember(tx, f.dinnerRoot, section(root));
    return { second: second.id, large: large!.id, small: small!.id };
  });
  await publish(f.dinner);
  await app(async (tx) => {
    await setMenuVariants(
      tx,
      await offerOf(tx, f.drinksMenu, f.lemonade),
      [{ variantId: setup.large, price: "4.20" }],
      f.drinksMenu,
    );
    await setMenuVariants(
      tx,
      await offerOf(tx, setup.second, f.lemonade),
      [{ variantId: setup.small, price: "2.20" }],
      setup.second,
    );
  });
  const preview = await app((tx) => previewMenu(tx, f.dinner));
  expect(preview.clashes).toEqual([]);
  const changes = preview.changes.filter(
    (c) => c.kind === "product_changed" && c.productId === f.lemonade,
  );
  expect(changes).toHaveLength(2);
  expect(changes).toContainEqual(
    expect.objectContaining({
      fields: ["variants"],
      source: "included_menu",
      includedMenu: { id: f.drinksMenu, name: "Drinks" },
    }),
  );
  expect(changes).toContainEqual(
    expect.objectContaining({
      fields: ["variants"],
      source: "included_menu",
      includedMenu: { id: setup.second, name: "Second drinks" },
    }),
  );
});
