import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogues, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { duplicateMenu } from "./menu-copy.js";
import { createCatalogue, createProduct, updateMenuItem } from "./operations.js";
import { addShortcut, readMenuHome, setHomeDisplay } from "./menu-home.js";
import { readMenuStructure, requireMenuRoot } from "./menu-structure.js";
import { menuStatus, previewMenu, publishMenu } from "./menu-publication.js";
import { setIncludeFolder } from "./include-folder.js";
import { addMember, createSectionIn, deleteSection, removeMember } from "./sections.js";
import { membersOf } from "./section-members.js";
import type { TileRef } from "./section-types.js";
import { setMenuVariants, setProductVariants } from "./variants.js";
import { menuDetails, menuItems } from "./schema/menu.js";
import { menuPublications, menuVersions } from "./schema/publication.js";
import { sectionMembers, sections } from "./schema/sections.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

interface Fixture {
  lunch: string;
  desserts: string;
  dessertsRoot: string;
  cakes: string;
  burger: string;
  lemonade: string;
  large: string;
  water: string;
  juice: string;
}

/**
 * Lunch holds a nested section with a product and a sub-section, a product, and an include of
 * Desserts shown with its own folder; its home has a shortcut to its own section, one to a section
 * of Desserts (reachable only through the include) and one left missing by a deleted section.
 */
async function fixture(): Promise<Fixture> {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const lunch = (
      await createCatalogue(tx, {
        name: "Lunch",
        names: { en: "Lunch menu", es: "Menú del día" },
        color: "#aa3300",
      })
    ).id;
    const desserts = (await createCatalogue(tx, { name: "Desserts" })).id;
    const dessertsRoot = await requireMenuRoot(tx, desserts);
    const cakes = (await createSectionIn(tx, dessertsRoot, { internalName: "Cakes" })).id;
    const make = async (name: string, unitPrice: string) =>
      (
        await createProduct(tx, {
          catalogueId: lunch,
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
        })
      ).id;
    const burger = await make("Burger", "12.00");
    const lemonade = await make("Lemonade", "3.00");
    const water = await make("Water", "2.00");
    const juice = await make("Juice", "2.75");
    const [large] = await setProductVariants(
      tx,
      lemonade,
      [
        {
          name: "Large",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "3.50",
          available: true,
        },
      ],
      "en",
    );

    const lunchRoot = await requireMenuRoot(tx, lunch);
    const drinks = (
      await createSectionIn(tx, lunchRoot, {
        internalName: "Drinks",
        names: { en: "Drinks", es: "Bebidas" },
        color: "#112233",
      })
    ).id;
    await addMember(tx, drinks, { kind: "product", productId: lemonade });
    const cold = (await createSectionIn(tx, drinks, { internalName: "Cold" })).id;
    await addMember(tx, cold, { kind: "product", productId: water });
    await addMember(tx, lunchRoot, { kind: "product", productId: burger });
    const include = await addMember(tx, lunchRoot, { kind: "section", sectionId: dessertsRoot });
    await setIncludeFolder(tx, lunchRoot, include.id, {
      showAsFolder: false,
      overrides: { names: { en: "Sweets" }, color: "#445566" },
    });
    const juiceMember = await addMember(tx, lunchRoot, { kind: "product", productId: juice });
    await removeMember(tx, lunchRoot, juiceMember.id);

    await addShortcut(tx, lunch, { kind: "section", sectionId: drinks });
    await addShortcut(tx, lunch, { kind: "section", sectionId: cakes });
    const temporary = (await createSectionIn(tx, lunchRoot, { internalName: "Specials" })).id;
    await addShortcut(tx, lunch, { kind: "section", sectionId: temporary });
    await deleteSection(tx, temporary);

    await setHomeDisplay(tx, lunch, "handheld", {
      columns: 2,
      tiles: "thumbnails",
      order: "menu_first",
    });
    await setHomeDisplay(tx, lunch, "till", {
      columns: 8,
      tiles: "thumbnails",
      order: "menu_first",
    });

    const burgerItem = await itemOf(tx, lunch, burger);
    await updateMenuItem(tx, lunch, burgerItem, { grossPrice: "11.50" });
    const lemonadeItem = await itemOf(tx, lunch, lemonade);
    await setMenuVariants(tx, lemonadeItem, [{ variantId: large!.id, price: "3.20" }], lunch);
    return {
      lunch,
      desserts,
      dessertsRoot,
      cakes,
      burger,
      lemonade,
      large: large!.id,
      water,
      juice,
    };
  }).then(async (f) => {
    const { hash } = await app((tx) => previewMenu(tx, f.lunch));
    await app((tx) => publishMenu(tx, f.lunch, hash, "person-1"));
    return f;
  });
}

async function itemOf(tx: Transaction, menuId: string, productId: string): Promise<string> {
  const rows = await tx
    .select({ id: menuItems.id, productId: menuItems.productId })
    .from(menuItems)
    .where(eq(menuItems.menuId, menuId));
  return rows.find((row) => row.productId === productId)!.id;
}

/** Every row the menu owns, as stored. */
async function rowsOf(menuId: string) {
  return app(async (tx) => {
    const owned = await tx
      .select()
      .from(sections)
      .where(eq(sections.ownerMenuId, menuId))
      .orderBy(asc(sections.id));
    const members = await tx
      .select()
      .from(sectionMembers)
      .where(
        inArray(
          sectionMembers.sectionId,
          owned.map((section) => section.id),
        ),
      )
      .orderBy(asc(sectionMembers.sectionId), asc(sectionMembers.position), asc(sectionMembers.id));
    const [details] = await tx.select().from(menuDetails).where(eq(menuDetails.menuId, menuId));
    const items = await tx
      .select()
      .from(menuItems)
      .where(eq(menuItems.menuId, menuId))
      .orderBy(asc(menuItems.id));
    const overrides = await tx
      .select({
        menuItemId: menuItemVariantOverrides.menuItemId,
        productId: menuItemVariantOverrides.productId,
        variantId: menuItemVariantOverrides.variantId,
        price: menuItemVariantOverrides.price,
      })
      .from(menuItemVariantOverrides)
      .innerJoin(menuItems, eq(menuItems.id, menuItemVariantOverrides.menuItemId))
      .where(eq(menuItems.menuId, menuId))
      .orderBy(asc(menuItemVariantOverrides.menuItemId));
    const versions = await tx.select().from(menuVersions).where(eq(menuVersions.menuId, menuId));
    const publications = await tx
      .select()
      .from(menuPublications)
      .where(eq(menuPublications.menuId, menuId));
    return { owned, members, details: details!, items, overrides, versions, publications };
  });
}

/** Labels each section the menu owns by its role and internal name, so two menus' reads compare. */
function sectionLabels(rows: Awaited<ReturnType<typeof rowsOf>>): Map<string, string> {
  return new Map(
    rows.owned.map((section) => [
      section.id,
      section.role === "section" ? `section:${section.internalName}` : section.role,
    ]),
  );
}

/** The value with every owned section id replaced by its label and every member id dropped. */
function relabelled(value: unknown, labels: ReadonlyMap<string, string>): unknown {
  return JSON.parse(JSON.stringify(value), (key, item: unknown) =>
    key === "memberId" || key === "id"
      ? undefined
      : typeof item === "string" && labels.has(item)
        ? labels.get(item)
        : item,
  );
}

describe("duplicateMenu", () => {
  it("copies the menu's working copy into a new unpublished menu and leaves the source as it was", async () => {
    const f = await fixture();
    const before = await rowsOf(f.lunch);

    const copy = await app((tx) => duplicateMenu(tx, f.lunch, "Lunch (copy)"));

    expect(copy.id).not.toBe(f.lunch);
    expect(copy.name).toBe("Lunch (copy)");
    const [stored] = await fx.db.select().from(catalogues).where(eq(catalogues.id, copy.id));
    expect(stored!.name).toBe("Lunch (copy)");

    const source = await rowsOf(f.lunch);
    expect(source).toEqual(before);

    const copied = await rowsOf(copy.id);
    const sourceIds = new Set(source.owned.map((section) => section.id));
    for (const section of copied.owned) expect(sourceIds.has(section.id)).toBe(false);
    expect(copied.owned.every((section) => section.ownerMenuId === copy.id)).toBe(true);

    const byRole = (rows: typeof source.owned) =>
      rows
        .map(({ internalName, names, role, image, color }) => ({
          internalName,
          names,
          role,
          image,
          color,
        }))
        .sort((a, b) => `${a.role}${a.internalName}`.localeCompare(`${b.role}${b.internalName}`));
    expect(byRole(copied.owned)).toEqual(
      byRole(source.owned).map((section) =>
        section.role === "menu_root" ? { ...section, internalName: "Lunch (copy)" } : section,
      ),
    );

    // Members, list by list and position by position: own sections remapped, the include and the
    // shortcut into the included menu left pointing where they did.
    const sourceLabels = sectionLabels(source);
    const copyLabels = sectionLabels(copied);
    const membersBy = (rows: typeof source, labels: Map<string, string>) =>
      rows.members
        .map(({ sectionId, childSectionId, ...rest }) => ({
          ...rest,
          id: undefined,
          section: labels.get(sectionId)!,
          child: childSectionId === null ? null : (labels.get(childSectionId) ?? childSectionId),
        }))
        .sort((a, b) =>
          `${a.section}${String(a.position).padStart(4, "0")}`.localeCompare(
            `${b.section}${String(b.position).padStart(4, "0")}`,
          ),
        );
    const copiedMembers = membersBy(copied, copyLabels);
    expect(copiedMembers).toEqual(membersBy(source, sourceLabels));
    expect(copiedMembers).toContainEqual(expect.objectContaining({ child: f.dessertsRoot }));
    expect(copiedMembers).toContainEqual(
      expect.objectContaining({ section: "home_layout", child: f.cakes }),
    );
    expect(copiedMembers).toContainEqual(
      expect.objectContaining({ section: "home_layout", missingName: expect.any(String) }),
    );
    expect(copiedMembers).toContainEqual(
      expect.objectContaining({
        child: f.dessertsRoot,
        showAsFolder: false,
        folderOverrides: { names: { en: "Sweets" }, color: "#445566" },
      }),
    );
    for (const member of copied.members)
      if (member.childSectionId !== null && member.childSectionId !== f.dessertsRoot)
        expect(member.childSectionId === f.cakes || copyLabels.has(member.childSectionId)).toBe(
          true,
        );

    const { rootSectionId: sourceRoot, homeSectionId: sourceHome } = source.details;
    const { rootSectionId: copyRoot, homeSectionId: copyHome } = copied.details;
    const display = {
      ...source.details,
      menuId: undefined,
      rootSectionId: undefined,
      homeSectionId: undefined,
    };
    expect({
      ...copied.details,
      menuId: undefined,
      rootSectionId: undefined,
      homeSectionId: undefined,
    }).toEqual(display);
    expect(display).toEqual({
      handheldColumns: 2,
      handheldTiles: "thumbnails",
      handheldOrder: "menu_first",
      tillColumns: 8,
      tillTiles: "thumbnails",
      tillOrder: "menu_first",
    });
    expect(copyLabels.get(copyRoot)).toBe("menu_root");
    expect(copyLabels.get(copyHome)).toBe("home_layout");
    expect(sourceLabels.get(sourceRoot)).toBe("menu_root");
    expect(sourceLabels.get(sourceHome)).toBe("home_layout");

    const offers = (rows: typeof source) =>
      rows.items
        .map(({ productId, grossPrice }) => ({ productId, grossPrice }))
        .sort((a, b) => a.productId.localeCompare(b.productId));
    expect(offers(copied)).toEqual(offers(source));
    expect(offers(source)).toContainEqual({ productId: f.burger, grossPrice: 1150 });
    expect(offers(source)).toContainEqual({ productId: f.juice, grossPrice: null });
    const sourceItemIds = new Set(source.items.map((item) => item.id));
    for (const item of copied.items) expect(sourceItemIds.has(item.id)).toBe(false);
    const prices = (rows: typeof source) =>
      rows.overrides.map(({ productId, variantId, price }) => ({ productId, variantId, price }));
    expect(prices(copied)).toEqual(prices(source));
    expect(prices(source)).toEqual([{ productId: f.lemonade, variantId: f.large, price: 320 }]);
    const copiedItemIds = new Set(copied.items.map((item) => item.id));
    for (const override of copied.overrides)
      expect(copiedItemIds.has(override.menuItemId)).toBe(true);

    expect(source.versions).toHaveLength(1);
    expect(source.publications).toHaveLength(1);
    expect(copied.versions).toEqual([]);
    expect(copied.publications).toEqual([]);
    const status = await app((tx) => menuStatus(tx, [f.lunch, copy.id]));
    expect(status.get(copy.id)!.state).toBe("unpublished");
    expect(status.get(f.lunch)!.state).toBe("current");

    const structure = (menuId: string) =>
      app(async (tx) => {
        const read = await readMenuStructure(tx, menuId);
        return { root: { ...read.root, internalName: undefined }, nodes: read.nodes };
      });
    const copyMenuIds = new Map([...copyLabels, [copy.id, "this menu"]]);
    const sourceMenuIds = new Map([...sourceLabels, [f.lunch, "this menu"]]);
    expect(relabelled(await structure(copy.id), copyMenuIds)).toEqual(
      relabelled(await structure(f.lunch), sourceMenuIds),
    );
    const home = (menuId: string) => app((tx) => readMenuHome(tx, menuId));
    expect(relabelled(await home(copy.id), copyMenuIds)).toEqual(
      relabelled(await home(f.lunch), sourceMenuIds),
    );
  });

  it("keeps stored positions and the source's order where members share a position", async () => {
    await seedTenant(fx.db);
    const source = (await app((tx) => createCatalogue(tx, { name: "Tied" }))).id;
    const entries = 20;
    await app(async (tx) => {
      const root = await requireMenuRoot(tx, source);
      const [details] = await tx.select().from(menuDetails).where(eq(menuDetails.menuId, source));
      await tx.insert(sections).values(
        Array.from({ length: entries }, (_, i) => ({
          id: `tie-section-${i}`,
          internalName: `Entry ${i}`,
          ownerMenuId: source,
        })),
      );
      // Member ids sort in the reverse of the entries' numbering, so a reader's tie-break is seen.
      const tied = (sectionId: string, kind: string) =>
        Array.from({ length: entries }, (_, i) => ({
          id: `tie-${kind}-${String(entries - i).padStart(2, "0")}`,
          sectionId,
          position: 3,
          childSectionId: `tie-section-${i}`,
        }));
      await tx
        .insert(sectionMembers)
        .values([...tied(root, "member"), ...tied(details!.homeSectionId, "shortcut")]);
    });

    const copy = (await app((tx) => duplicateMenu(tx, source, "Tied copy"))).id;

    const orders = (menuId: string) =>
      app(async (tx) => {
        const names = new Map(
          (await tx.select().from(sections).where(eq(sections.ownerMenuId, menuId))).map(
            (section) => [section.id, section.internalName],
          ),
        );
        const named = (members: readonly { position: number; ref: TileRef }[]) =>
          members.map(({ position, ref }) => [
            position,
            ref.kind === "section" ? names.get(ref.sectionId) : ref.kind,
          ]);
        const [details] = await tx.select().from(menuDetails).where(eq(menuDetails.menuId, menuId));
        return {
          structure: named((await readMenuStructure(tx, menuId)).root.members),
          home: (await readMenuHome(tx, menuId)).shortcuts.map(({ position, name }) => [
            position,
            name,
          ]),
          rootRows: named(await membersOf(tx, details!.rootSectionId)),
          homeRows: named(await membersOf(tx, details!.homeSectionId, "home_layout")),
        };
      });
    const sourceOrders = await orders(source);
    expect(sourceOrders.structure).toEqual(
      Array.from({ length: entries }, (_, i) => [3, `Entry ${entries - 1 - i}`]),
    );
    expect(sourceOrders.home).toEqual(sourceOrders.structure);
    expect(sourceOrders.rootRows).toEqual(sourceOrders.structure);
    expect(sourceOrders.homeRows).toEqual(sourceOrders.structure);
    expect(await orders(copy)).toEqual(sourceOrders);
  });

  it("refuses a menu that does not exist with catalogue.not_found", async () => {
    await seedTenant(fx.db);
    await expect(
      app((tx) => duplicateMenu(tx, "00000000-0000-4000-8000-000000000000", "Copy")),
    ).rejects.toMatchObject({ code: "catalogue.not_found" });
  });

  it("refuses a blank name and writes nothing", async () => {
    const f = await fixture();
    const count = async () => (await fx.db.select().from(catalogues)).length;
    const menus = await count();
    await expect(app((tx) => duplicateMenu(tx, f.lunch, "   "))).rejects.toMatchObject({
      code: "menu_section.invalid",
      params: { field: "internalName" },
    });
    expect(await count()).toBe(menus);
  });
});
