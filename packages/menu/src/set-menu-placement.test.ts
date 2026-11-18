import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { menuItems, menus, sectionMembers, withTransaction, type Transaction } from "@waitron/db";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useMenuDb } from "../test/fixtures.js";
import { listTranslationGapReport } from "./content-translation-report.js";
import { validateMenuConfiguration } from "./configuration-transfer.js";
import { buildMenuDocument, documentOffers } from "./menu-document.js";
import { setIncludeFolder } from "./include-folder.js";
import { addShortcut } from "./menu-home.js";
import { includableMenus } from "./menu-inclusion.js";
import { indexMenuOccurrences } from "./menu-navigation.js";
import { readMenuStructure, requireMenuRoot } from "./menu-structure.js";
import { createMenu, createProduct, listMenuOffers, menuPrices } from "./operations.js";
import { loadSectionGraph, menusContaining, sectionPathName } from "./section-graph.js";
import { membersOf } from "./section-members.js";
import { addMember, createSectionIn } from "./sections.js";

const suite = useMenuDb();
const app = <T>(operation: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, operation);

async function menusFixture(tx: Transaction) {
  const full = await createMenu(tx, { name: "Lunch" });
  const set = await createMenu(tx, {
    name: "Daily menu",
    kind: "set_menu",
    setPrice: "14.00",
    setVatClass: "reduced",
  });
  return {
    full,
    set,
    fullRoot: await requireMenuRoot(tx, full.id),
    setRoot: await requireMenuRoot(tx, set.id),
    setRef: { kind: "set_menu", menuId: set.id } as const,
  };
}

async function dishesFixture() {
  await seedTaxpayer(suite.db);
  await seedLegacySellingUnits(suite.db);
  return app(async (tx) => {
    const fixture = await menusFixture(tx);
    const createDish = async (name: string, unitPrice: string) =>
      createProduct(tx, {
        categoryId: null,
        name,
        customerName: { en: `${name} on the menu` },
        kitchenName: `${name} for the kitchen`,
        pricingUnit: "each",
        unitPrice,
        vatClass: "reduced",
      });
    const steak = await createDish("Sirloin", "18.00");
    const soup = await createDish("Soup", "7.00");
    await addMember(tx, fixture.fullRoot, { kind: "product", productId: steak.id });
    await addMember(tx, fixture.setRoot, { kind: "product", productId: steak.id });
    await addMember(tx, fixture.setRoot, { kind: "product", productId: soup.id });
    await tx
      .update(menuItems)
      .set({ grossPrice: 500 })
      .where(and(eq(menuItems.menuId, fixture.set.id), eq(menuItems.productId, steak.id)));
    return { ...fixture, steak, soup };
  });
}

it("places a set menu without adding its dishes to the full menu's offers or copying its prices", async () => {
  const { full, fullRoot, setRef, steak, soup } = await dishesFixture();
  await app((tx) => addMember(tx, fullRoot, setRef));
  expect(
    (await app((tx) => listMenuOffers(tx, [full.id]))).map(({ productId, unitPrice }) => ({
      productId,
      unitPrice,
    })),
  ).toEqual([{ productId: steak.id, unitPrice: "18.00" }]);
  expect(
    await suite.db
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.menuId, full.id), eq(menuItems.productId, soup.id))),
  ).toEqual([]);
  expect(
    (await app((tx) => menuPrices(tx, full.id))).map(({ productId, effectivePrice }) => ({
      productId,
      effectivePrice,
    })),
  ).toEqual([{ productId: steak.id, effectivePrice: "18.00" }]);
});

it("reads a stored set-menu placement the same way through the graph and member list", async () => {
  await app(async (tx) => {
    const { fullRoot, setRoot, setRef } = await menusFixture(tx);
    const [member] = await tx
      .insert(sectionMembers)
      .values({
        sectionId: fullRoot,
        childSectionId: setRoot,
        position: 0,
      })
      .returning({ id: sectionMembers.id });
    const expected = [{ id: member!.id, position: 0, ref: setRef }];
    expect((await loadSectionGraph(tx)).children(fullRoot)).toEqual(expected);
    expect(await membersOf(tx, fullRoot)).toEqual(expected);
  });
});

it.each(["section", "include", "set menu"] as const)(
  "refuses a %s in a set menu's list",
  async (kind) => {
    const { fullRoot, setRoot, set, setRef } = await app(menusFixture);
    await expect(
      app(async (tx) => {
        if (kind === "section") return createSectionIn(tx, setRoot, { internalName: "Desserts" });
        return addMember(
          tx,
          setRoot,
          kind === "include" ? { kind: "section", sectionId: fullRoot } : setRef,
        );
      }),
    ).rejects.toMatchObject({ code: "set_menu.dishes_only", params: { menuId: set.id } });
  },
);

it("refuses to place a set menu as an ordinary section", async () => {
  const { fullRoot, set, setRoot } = await app(menusFixture);
  await expect(
    app((tx) => addMember(tx, fullRoot, { kind: "section", sectionId: setRoot })),
  ).rejects.toMatchObject({ code: "set_menu.wrong_place", params: { menuId: set.id } });
});

it.each(["section", "set_menu"] as const)("refuses a %s shortcut to a set menu", async (kind) => {
  const { full, set, setRoot, setRef } = await app(menusFixture);
  const ref = kind === "section" ? { kind, sectionId: setRoot } : setRef;
  await expect(app((tx) => addShortcut(tx, full.id, ref))).rejects.toMatchObject({
    code: "set_menu.wrong_place",
    params: { menuId: set.id },
  });
});

it("refuses folder settings for a placed set menu", async () => {
  const { fullRoot, set, setRoot } = await app(menusFixture);
  const [member] = await suite.db
    .insert(sectionMembers)
    .values({
      sectionId: fullRoot,
      childSectionId: setRoot,
      position: 0,
    })
    .returning({ id: sectionMembers.id });
  await expect(
    app((tx) => setIncludeFolder(tx, fullRoot, member!.id, { showAsFolder: false })),
  ).rejects.toMatchObject({ code: "set_menu.wrong_place", params: { menuId: set.id } });
});

it("offers active set menus for placement separately from ordinary includes", async () => {
  await app(async (tx) => {
    const { full, fullRoot, set, setRoot } = await menusFixture(tx);
    expect(includableMenus(await loadSectionGraph(tx), full.id)).not.toContain(set.id);
    expect(await readMenuStructure(tx, full.id)).toMatchObject({
      includable: [],
      placeableSetMenus: [{ id: set.id, name: "Daily menu" }],
    });
    await tx
      .insert(sectionMembers)
      .values({ sectionId: fullRoot, childSectionId: setRoot, position: 0 });
    expect(await readMenuStructure(tx, full.id)).toMatchObject({ placeableSetMenus: [] });
  });
});

it("names the active set menu in the full menu's document without expanding its list", async () => {
  const { full, fullRoot, set, setRef, steak } = await dishesFixture();
  await app((tx) => addMember(tx, fullRoot, setRef));
  const built = await app((tx) => buildMenuDocument(tx, full.id));
  expect(built.document.root.members.map((member) => member.kind)).toEqual(["product", "set_menu"]);
  expect(built.document.root.members[1]).toEqual({
    kind: "set_menu",
    menuId: set.id,
    name: "Daily menu",
  });
  expect(built.clashes).toEqual([]);
  expect(documentOffers(built.document).map(({ productId }) => productId)).toEqual([steak.id]);
  expect(indexMenuOccurrences(built.document).map(({ target }) => target.kind)).toEqual([
    "product",
  ]);
});

it("omits an inactive set menu from the full menu's document", async () => {
  const { full, fullRoot, set, setRef } = await app(menusFixture);
  await app((tx) => addMember(tx, fullRoot, setRef));
  await suite.db.update(menus).set({ active: false }).where(eq(menus.id, set.id));
  const built = await app((tx) => buildMenuDocument(tx, full.id));
  expect(built.document.root.members).toEqual([]);
});

it("holds the same set menu in two lists of one full menu", async () => {
  await app(async (tx) => {
    const { full, fullRoot, set, setRef } = await menusFixture(tx);
    const section = await createSectionIn(tx, fullRoot, { internalName: "Lunch deals" });
    await addMember(tx, fullRoot, setRef);
    await addMember(tx, section.id, setRef);
    await expect(addMember(tx, fullRoot, setRef)).rejects.toMatchObject({
      code: "menu_section.member_duplicate",
      params: { sectionId: fullRoot },
    });
    const { document } = await buildMenuDocument(tx, full.id);
    const member = { kind: "set_menu", menuId: set.id, name: "Daily menu" };
    expect(document.root.members).toEqual([
      expect.objectContaining({ kind: "section", sectionId: section.id, members: [member] }),
      member,
    ]);
  });
});

const importMenus = {
  menus: [
    { id: "lunch", name: "Lunch" },
    { id: "daily", name: "Daily menu", kind: "set_menu", set_price: 1400 },
  ],
  sections: [
    { id: "lunch-root", owner_menu_id: "lunch", role: "menu_root" },
    { id: "lunch-home", owner_menu_id: "lunch", role: "home_layout", internal_name: "Home" },
    { id: "daily-root", owner_menu_id: "daily", role: "menu_root" },
    { id: "daily-section", owner_menu_id: "daily", role: "section", internal_name: "Desserts" },
  ],
};

it.each([
  ["include in a set menu", "daily-root", "lunch-root"],
  ["child section in a set menu", "daily-root", "daily-section"],
  ["set menu on Device Home", "lunch-home", "daily-root"],
])("refuses importing a %s", (_placement, section_id, child_section_id) => {
  expect(() =>
    validateMenuConfiguration({
      ...importMenus,
      section_members: [{ section_id, child_section_id, position: 0 }],
    }),
  ).toThrowError(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "section_members.child_section_id" },
    }),
  );
});

it("imports a set-menu placement, and refuses ordinary folder settings on it", () => {
  const placement = { section_id: "lunch-root", child_section_id: "daily-root", position: 0 };
  expect(() =>
    validateMenuConfiguration({ ...importMenus, section_members: [placement] }),
  ).not.toThrow();
  expect(() =>
    validateMenuConfiguration({
      ...importMenus,
      section_members: [{ ...placement, show_as_folder: 0 }],
    }),
  ).toThrowError(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "section_members.show_as_folder" },
    }),
  );
});

it("finds the full menu that holds a set menu through an owned section", async () => {
  await app(async (tx) => {
    const { full, fullRoot, set, setRoot, setRef } = await menusFixture(tx);
    const section = await createSectionIn(tx, fullRoot, { internalName: "Lunch deals" });
    await addMember(tx, section.id, setRef);
    const graph = await loadSectionGraph(tx);
    expect(graph.parents(setRoot)).toEqual([section.id]);
    expect(menusContaining(graph, setRoot)).toEqual([full.id, set.id].sort());
    expect(sectionPathName(graph, setRoot)).toBe("Daily menu");
    expect((await readMenuStructure(tx, set.id)).includedBy).toEqual([]);
  });
});

it("does not offer translations for a set-menu placement as an included menu", async () => {
  await app(async (tx) => {
    const { fullRoot, setRoot } = await menusFixture(tx);
    const [placement] = await tx
      .insert(sectionMembers)
      .values({
        sectionId: fullRoot,
        childSectionId: setRoot,
        position: 0,
        folderNames: { en: "An ordinary include's translated name" },
      })
      .returning({ id: sectionMembers.id });
    const gaps = await listTranslationGapReport(tx, {
      defaultLanguage: "en",
      languages: ["en", "es"],
    });
    expect(gaps.find(({ language }) => language === "es")!.gaps).not.toContainEqual(
      expect.objectContaining({ id: placement!.id, kind: "included_menu" }),
    );
  });
});

it("offers ordinary includes only for menus that accept them", async () => {
  await app(async (tx) => {
    const { full, set } = await menusFixture(tx);
    const specials = await createMenu(tx, { name: "Specials" });
    expect((await readMenuStructure(tx, full.id)).includable.map(({ id }) => id)).toEqual([
      specials.id,
    ]);
    expect((await readMenuStructure(tx, set.id)).includable).toEqual([]);
  });
});
