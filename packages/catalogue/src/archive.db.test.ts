import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, product } from "../test/menus-fixture.js";
import { assertOffPublishedMenus, publishedMenusHolding } from "./archive.js";
import { menuPublications } from "./schema/publication.js";
import { addMember, removeMember } from "./sections.js";
import { readMenuStructure } from "./menu-structure.js";
import { insertVersion, previewMenu, publishMenu } from "./menu-publication.js";
import { cancelMenuPublication, queueMenuPublication } from "./menu-schedule.js";
import { deactivateCatalogue } from "./operations.js";

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
