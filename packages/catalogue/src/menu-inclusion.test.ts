import { describe, expect, it } from "vitest";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useCatalogueDb, seedLegacySellingUnits } from "../test/fixtures.js";
import { createCatalogue, createProduct, updateMenuDetails } from "./operations.js";
import { readMenuStructure, requireMenuRoot } from "./menu-structure.js";
import {
  addMember,
  createSectionIn,
  deleteSection,
  readSection,
  removeMember,
  replaceMember,
  updateSection,
} from "./sections.js";
import { addShortcut, readMenuHome } from "./menu-home.js";
import { listContentTranslationGaps } from "./content-languages.js";
import { loadSectionGraph } from "./section-graph.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const section = (sectionId: string) => ({ kind: "section" as const, sectionId });
const product = (productId: string) => ({ kind: "product" as const, productId });
async function fixture() {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const a = await createCatalogue(tx, { name: "Evening" });
    const b = await createCatalogue(tx, { name: "Drinks" });
    const c = await createCatalogue(tx, { name: "Wines" });
    return {
      a: a.id,
      b: b.id,
      c: c.id,
      ar: await requireMenuRoot(tx, a.id),
      br: await requireMenuRoot(tx, b.id),
      cr: await requireMenuRoot(tx, c.id),
    };
  });
}

describe("menu inclusions and owned sections", () => {
  it("refuses self-inclusion and an opposing inclusion from three nested lists", async () => {
    const f = await fixture();
    await app((tx) => addMember(tx, f.ar, section(f.br)));
    const deep = await app(async (tx) => {
      const a = await createSectionIn(tx, f.br, { internalName: "A" });
      const b = await createSectionIn(tx, a.id, { internalName: "B" });
      return (await createSectionIn(tx, b.id, { internalName: "C" })).id;
    });
    await expect(app((tx) => addMember(tx, deep, section(f.ar)))).rejects.toMatchObject({
      code: "menu_section.member_cycle",
    });
    await expect(app((tx) => addMember(tx, f.br, section(f.br)))).rejects.toMatchObject({
      code: "menu_section.member_cycle",
    });
    const { includedMenus, includableMenus } = await import("./menu-inclusion.js");
    const graph = await app(loadSectionGraph);
    expect(includableMenus(graph, f.b)).not.toContain(f.a);
    expect(includableMenus(graph, f.b)).not.toContain(f.b);
    expect(includableMenus(graph, f.b)).toContain(f.c);
    await app((tx) => addMember(tx, deep, section(f.cr)));
    expect(includedMenus(await app(loadSectionGraph), f.b)).toEqual([f.c]);
  });

  it("creates sections in place, refuses moving their member away, and accepts an own-section home tile", async () => {
    const f = await fixture();
    const first = await app((tx) => createSectionIn(tx, f.ar, { internalName: "First" }));
    const own = await app((tx) => createSectionIn(tx, f.ar, { internalName: "Mine" }, 0));
    expect((await app((tx) => readSection(tx, f.ar))).members.map((m) => m.ref)).toEqual([
      section(own.id),
      section(first.id),
    ]);
    const graph = await app(loadSectionGraph);
    expect(graph.role(own.id)).toBe("section");
    expect(graph.ownerMenu(own.id)).toBe(f.a);
    await expect(app((tx) => addMember(tx, f.br, section(own.id)))).rejects.toMatchObject({
      code: "menu_section.wrong_role",
    });
    const layout = (await app((tx) => readMenuHome(tx, f.a))).homeSectionId;
    await app((tx) => addShortcut(tx, f.a, section(own.id)));
    await expect(app((tx) => addMember(tx, f.ar, section(layout)))).rejects.toMatchObject({
      code: "menu_section.wrong_role",
    });
    const member = (await app((tx) => readSection(tx, f.ar))).members[0]!;
    await expect(app((tx) => removeMember(tx, f.ar, member.id))).rejects.toMatchObject({
      code: "menu_section.wrong_role",
    });
    await expect(
      app((tx) => replaceMember(tx, f.ar, member.id, section(f.br))),
    ).rejects.toMatchObject({ code: "menu_section.wrong_role" });
    await expect(
      app((tx) => updateSection(tx, f.ar, { internalName: "Wrong" })),
    ).rejects.toMatchObject({ code: "menu_section.wrong_role" });
  });

  it("attributes nested included products to the direct menu and preserves own placements", async () => {
    const f = await fixture();
    const [lager, merlot] = await app(async (tx) => {
      const make = (name: string) =>
        createProduct(tx, {
          catalogueId: f.a,
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice: "3",
          vatClass: "general",
        });
      return [(await make("Lager staff")).id, (await make("Merlot staff")).id];
    });
    await app(async (tx) => {
      await addMember(tx, f.ar, section(f.br));
      await addMember(tx, f.br, section(f.cr));
      await addMember(tx, f.br, product(lager!));
      await addMember(tx, f.cr, product(merlot!));
      const own = await createSectionIn(tx, f.ar, { internalName: "Specials" });
      await addMember(tx, own.id, product(lager!));
    });
    const { includedMenus, placesOf } = await import("./menu-inclusion.js");
    const graph = await app(loadSectionGraph);
    expect(includedMenus(graph, f.a)).toEqual([f.b]);
    expect(placesOf(graph, f.a, lager!)).toEqual({ own: true, via: [f.b] });
    expect(placesOf(graph, f.a, merlot!)).toEqual({ own: false, via: [f.b] });
  });

  it("returns section presentation and inclusion choices with root IDs, excluding inactive menus", async () => {
    const f = await fixture();
    const own = await app((tx) =>
      createSectionIn(tx, f.ar, {
        internalName: "Staff section",
        names: { en: "Guest section" },
        color: "#abcdef",
      }),
    );
    await app((tx) => addMember(tx, own.id, section(f.br)));
    const answer = await app((tx) => readMenuStructure(tx, f.a));
    expect(answer.nodes[0]).toMatchObject({
      internalName: "Staff section",
      names: { en: "Guest section" },
      color: "#abcdef",
      image: null,
      ownerMenuId: f.a,
    });
    expect(answer.nodes[0]!.children![0]).toMatchObject({ includedMenuId: f.b, ownerMenuId: f.b });
    expect(answer.includable).toContainEqual({ id: f.c, name: "Wines", rootSectionId: f.cr });
    expect((await app((tx) => readMenuStructure(tx, f.b))).includedBy).toEqual([
      { id: f.a, name: "Evening" },
    ]);
    await fx.db.execute(
      (await import("drizzle-orm")).sql`update catalogues set active = 0 where id = ${f.c}`,
    );
    expect(
      (await app((tx) => readMenuStructure(tx, f.a))).includable.map((m) => m.id),
    ).not.toContain(f.c);
  });
  it("retains direct included-by membership while an included menu is inactive", async () => {
    const f = await fixture();
    const { sql } = await import("drizzle-orm");
    await fx.db.execute(sql`update catalogues set active = 0 where id = ${f.b}`);
    await app((tx) => addMember(tx, f.ar, section(f.br)));
    expect((await app((tx) => readMenuStructure(tx, f.b))).includedBy).toEqual([
      { id: f.a, name: "Evening" },
    ]);
    const { includedMenus } = await import("./menu-inclusion.js");
    expect(includedMenus(await app(loadSectionGraph), f.a)).toEqual([]);
    await fx.db.execute(sql`update catalogues set active = 1 where id = ${f.b}`);
    expect(includedMenus(await app(loadSectionGraph), f.a)).toEqual([f.b]);
  });
  it("writes menu presentation to its root on creation and update", async () => {
    const f = await fixture();
    await app((tx) =>
      updateMenuDetails(tx, f.a, {
        name: "Staff evening",
        names: { en: "Guest evening" },
        color: "#123456",
      }),
    );
    expect(await app((tx) => readSection(tx, f.ar))).toMatchObject({
      internalName: "Staff evening",
      names: { en: "Guest evening" },
      color: "#123456",
      image: null,
    });
  });

  it("reports partial customer names for menu roots and owned sections", async () => {
    await seedTenant(fx.db);
    await app(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Staff menu", names: { en: "Guest menu" } });
      const root = await requireMenuRoot(tx, menu.id);
      const own = await createSectionIn(tx, root, {
        internalName: "Staff section",
        names: { en: "Guest section" },
      });
      expect(await listContentTranslationGaps(tx, "es")).toEqual([
        { kind: "menu_section", id: root },
        { kind: "menu_section", id: own.id },
      ]);
    });
  });

  it("does not count products reached only through an inactive nested inclusion, and restores them on reactivation", async () => {
    const f = await fixture();
    const wine = await app((tx) =>
      createProduct(tx, {
        catalogueId: f.c,
        categoryId: null,
        name: "Merlot",
        pricingUnit: "each",
        unitPrice: "4",
        vatClass: "general",
      }),
    );
    await app(async (tx) => {
      await addMember(tx, f.ar, section(f.br));
      await addMember(tx, f.br, section(f.cr));
      await addMember(tx, f.cr, product(wine.id));
    });
    const { sql } = await import("drizzle-orm");
    await fx.db.execute(sql`update catalogues set active = 0 where id = ${f.c}`);
    const { includedMenus, placesOf } = await import("./menu-inclusion.js");
    expect(includedMenus(await app(loadSectionGraph), f.b)).toEqual([]);
    expect(placesOf(await app(loadSectionGraph), f.a, wine.id)).toEqual({ own: false, via: [] });
    await fx.db.execute(sql`update catalogues set active = 1 where id = ${f.c}`);
    expect(placesOf(await app(loadSectionGraph), f.a, wine.id)).toEqual({ own: false, via: [f.b] });
  });
  it("refuses a malformed direct member ref with the domain code", async () => {
    const f = await fixture();
    await expect(
      app((tx) => addMember(tx, f.ar, null as unknown as import("./section-types.js").MemberRef)),
    ).rejects.toMatchObject({ code: "menu_section.membership_invalid" });
  });

  it("deletes owned descendants while keeping included menus and products", async () => {
    const f = await fixture();
    const parent = await app((tx) => createSectionIn(tx, f.ar, { internalName: "Parent" }));
    const child = await app((tx) => createSectionIn(tx, parent.id, { internalName: "Child" }));
    const dish = await app((tx) =>
      createProduct(tx, {
        catalogueId: f.a,
        categoryId: null,
        name: "Kept product",
        pricingUnit: "each",
        unitPrice: "3",
        vatClass: "general",
      }),
    );
    await app(async (tx) => {
      await addMember(tx, child.id, section(f.br));
      await addMember(tx, child.id, product(dish.id));
    });
    await app((tx) => deleteSection(tx, parent.id));
    await expect(app((tx) => readSection(tx, child.id))).rejects.toMatchObject({
      code: "menu_section.not_found",
    });
    expect((await app((tx) => readSection(tx, f.br))).id).toBe(f.br);
    expect((await app((tx) => readSection(tx, f.ar))).members).toEqual([]);
    expect(
      (await app((tx) => tx.select({ id: products.id }).from(products))).map((row) => row.id),
    ).toContain(dish.id);
  });
});
