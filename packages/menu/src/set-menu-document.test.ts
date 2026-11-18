import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import {
  kitchenCourses,
  menuItems,
  menus,
  menuVersionImages,
  products,
  setMenuLines,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useMenuDb } from "../test/fixtures.js";
import { libraryImageName, seedLibraryImages } from "../test/library-images.js";
import { assertOffPublishedMenus } from "./archive.js";
import { createOptionList } from "./options.js";
import {
  buildMenuDocument,
  buildMenuDocuments,
  documentOffers,
  documentSetMenuOffers,
} from "./menu-document.js";
import { patchLiveMenu, publishMenu, readLiveMenu } from "./menu-publication.js";
import { queueMenuPublication } from "./menu-schedule.js";
import { requireMenuRoot } from "./menu-structure.js";
import { createMenu, updateMenuDetails, updateMenuItem } from "./operations.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { addMember, createSectionIn } from "./sections.js";
import { addSetMenuDishes, saveSetMenuDishCourse, saveSetMenuVariantChoices } from "./set-menus.js";

const suite = useMenuDb();
const app = <T>(operation: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, operation);
const personId = "set-menu-publisher";
const ownProduct = (productId: string) => ({ kind: "product", productId }) as const;

async function setMenu(tx: Transaction, name: string) {
  return createMenu(tx, {
    name,
    names: { en: name },
    kind: "set_menu",
    setPrice: "14.00",
    setVatClass: "reduced",
  });
}

async function itemId(tx: Transaction, menuId: string, productId: string) {
  const rows = await tx.select().from(menuItems).where(eq(menuItems.menuId, menuId));
  return rows.find((row) => row.productId === productId)!.id;
}

async function fixture(tx: Transaction) {
  const lunch = await createMenu(tx, { name: "Lunch" });
  const daily = await setMenu(tx, "Daily menu");
  const lunchRoot = await requireMenuRoot(tx, lunch.id);
  const [starters, mains, drinks, sharing] = (
    await tx
      .insert(kitchenCourses)
      .values(
        ["Starters", "Mains", "Drinks", "Sharing plates"].map((name, displayOrder) => ({
          name,
          displayOrder,
        })),
      )
      .returning({ id: kitchenCourses.id })
  ).map(({ id }) => id);
  const [soup, sirloin, wine, bravas] = (
    await tx
      .insert(products)
      .values(
        [
          { name: "Soup", courseId: starters!, unitPrice: 700 },
          { name: "Sirloin", courseId: mains!, unitPrice: 1800 },
          { name: "Wine", courseId: mains!, unitPrice: 400 },
          { name: "Bravas", courseId: sharing!, unitPrice: 600 },
        ].map((dish) => ({ ...dish, vatClass: "reduced" as const, dietaryDeclarations: [] })),
      )
      .returning({ id: products.id })
  ).map(({ id }) => id);
  const [glass, bottle] = (
    await tx
      .insert(products)
      .values([
        { name: "Glass", parentId: wine!, courseId: drinks!, unitPrice: 450, variantOrder: 0 },
        { name: "Bottle", parentId: wine!, unitPrice: 1300, variantOrder: 1 },
      ])
      .returning({ id: products.id })
  ).map(({ id }) => id);
  const { id: optionList } = await createOptionList(
    tx,
    {
      name: "Cooking",
      labels: [{ name: "Rare", available: true }],
    },
    "en",
  );
  await writeProductModifiers(tx, sirloin!, [{ kind: "options", id: optionList }]);
  await addMember(tx, lunchRoot, ownProduct(sirloin!));
  const lines = await addSetMenuDishes(tx, daily.id, [
    { productId: soup!, excludedVariantIds: [] },
    { productId: sirloin!, excludedVariantIds: [] },
    { productId: wine!, excludedVariantIds: [bottle!] },
  ]);
  const sirloinItem = await itemId(tx, daily.id, sirloin!);
  const wineItem = await itemId(tx, daily.id, wine!);
  await updateMenuItem(tx, daily.id, sirloinItem, { grossPrice: "5.00" });
  await saveSetMenuVariantChoices(tx, daily.id, wineItem, [
    { variantId: glass!, included: true, surcharge: "1.50" },
    { variantId: bottle!, included: false, surcharge: null },
  ]);
  const dailyRef = { kind: "set_menu", menuId: daily.id } as const;
  return {
    lunch: lunch.id,
    lunchRoot,
    daily: daily.id,
    dailyRef,
    lines,
    starters: starters!,
    mains: mains!,
    sharing: sharing!,
    drinks: drinks!,
    soup: soup!,
    sirloin: sirloin!,
    sirloinItem,
    wine: wine!,
    wineItem,
    glass: glass!,
    bottle: bottle!,
    bravas: bravas!,
    optionList,
  };
}

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  await seedPerson(suite.db, { id: personId, displayName: "Set menu publisher" });
  f = await app(fixture);
});

const place = () => app((tx) => addMember(tx, f.lunchRoot, f.dailyRef));
const build = () => app((tx) => buildMenuDocument(tx, f.lunch));
const live = () => app((tx) => readLiveMenu(tx, f.lunch));
const publish = (menuId: string = f.lunch) =>
  app(async (tx) =>
    publishMenu(tx, menuId, (await buildMenuDocument(tx, menuId)).workingHash, personId),
  );
const copied = async () => (await build()).document.setMenus?.[f.daily];
const fromLive = async () => (await live())!.document.setMenus?.[f.daily];

it("freezes surcharges and keeps ordinary offers and prices separate", async () => {
  await place();
  const { document, clashes } = await build();
  const ordinary = documentOffers(document);
  const copy = document.setMenus?.[f.daily];
  expect(copy).toBeDefined();
  const offers = documentSetMenuOffers(document);
  expect(offers.map(({ productId, unitPrice }) => [productId, unitPrice])).toEqual([
    [f.soup, "0.00"],
    [f.sirloin, "5.00"],
    [f.wine, "0.00"],
  ]);
  expect(
    copy?.offers[f.wineItem]?.variants.map(({ id, unitPrice, menuPrice }) => ({
      id,
      unitPrice,
      menuPrice,
    })),
  ).toEqual([{ id: f.glass, unitPrice: "1.50", menuPrice: "1.50" }]);
  expect(ordinary.map(({ productId, unitPrice }) => [productId, unitPrice])).toEqual([
    [f.sirloin, "18.00"],
  ]);
  expect(ordinary[0]?.offeredModifiers).toContainEqual(
    expect.objectContaining({ id: f.optionList }),
  );
  expect(copy?.offers[f.sirloinItem]?.offeredModifiers).toEqual(ordinary[0]?.offeredModifiers);
  expect(clashes).toEqual([]);
});

it("freezes the terms and each kept variant's own course", async () => {
  await place();
  const copy = await copied();
  expect(copy?.terms).toEqual({
    price: "14.00",
    vatClass: "reduced",
    takeawayVatClass: "reduced",
    names: { en: "Daily menu" },
    lines: [
      { id: f.lines[0]!.id, count: 1, courseIds: [f.starters] },
      { id: f.lines[1]!.id, count: 1, courseIds: [f.mains] },
      { id: f.lines[2]!.id, count: 1, courseIds: [f.drinks] },
    ],
  });
  expect(
    Object.values(copy!.offers).find(({ productId }) => productId === f.soup)?.countsAsCourseId,
  ).toBe(f.starters);
  expect(copy?.offers[f.wineItem]?.variants[0]?.countsAsCourseId).toBe(f.drinks);
});

it("can freeze two different courses for the same product", async () => {
  await place();
  const shared = [{ productId: f.bravas, excludedVariantIds: [] }];
  const { special, dailyItem, specialItem } = await app(async (tx) => {
    const special = await setMenu(tx, "Special menu");
    await addMember(tx, f.lunchRoot, ownProduct(f.bravas));
    await addSetMenuDishes(tx, f.daily, shared);
    await addSetMenuDishes(tx, special.id, shared);
    const specialItem = await itemId(tx, special.id, f.bravas);
    await saveSetMenuDishCourse(tx, special.id, specialItem, f.starters);
    await addMember(tx, f.lunchRoot, { kind: "set_menu", menuId: special.id });
    return { special: special.id, specialItem, dailyItem: await itemId(tx, f.daily, f.bravas) };
  });
  const { document } = await build();
  expect(document.setMenus?.[f.daily]?.offers[dailyItem]).toMatchObject({
    countsAsCourseId: f.sharing,
    courseOverrideId: null,
  });
  expect(document.setMenus?.[special]?.offers[specialItem]).toMatchObject({
    countsAsCourseId: f.starters,
    courseOverrideId: f.starters,
  });
  const bravas = documentOffers(document).find(({ productId }) => productId === f.bravas);
  expect(bravas).toMatchObject({ unitPrice: "6.00" });
  expect(bravas).not.toHaveProperty("courseOverrideId");
});

it("changes the working hash but waits for a republish to change the live surcharge", async () => {
  await place();
  const first = await build();
  await publish();
  await app((tx) => updateMenuItem(tx, f.daily, f.sirloinItem, { grossPrice: "6.00" }));
  expect((await build()).workingHash).not.toBe(first.workingHash);
  expect((await fromLive())?.offers[f.sirloinItem]?.unitPrice).toBe("5.00");
  await publish();
  expect((await fromLive())?.offers[f.sirloinItem]?.unitPrice).toBe("6.00");
});

it("keeps a dish's published course until the full menu is republished", async () => {
  await place();
  // Bravas still covers the mains line after Sirloin moves.
  await app(async (tx) => {
    await tx.update(products).set({ courseId: f.mains }).where(eq(products.id, f.bravas));
    await addSetMenuDishes(tx, f.daily, [{ productId: f.bravas, excludedVariantIds: [] }]);
  });
  const before = await build();
  await publish();
  await suite.db.update(products).set({ courseId: f.starters }).where(eq(products.id, f.sirloin));
  expect((await build()).workingHash).not.toBe(before.workingHash);
  expect((await fromLive())?.offers[f.sirloinItem]?.countsAsCourseId).toBe(f.mains);
  await publish();
  expect((await fromLive())?.offers[f.sirloinItem]?.countsAsCourseId).toBe(f.starters);
});

it("refuses the full menu if a dish moves to a course no line accepts", async () => {
  await place();
  await suite.db.update(products).set({ courseId: f.sharing }).where(eq(products.id, f.soup));
  expect((await build()).setMenuProblems).toEqual([
    {
      menuId: f.daily,
      name: "Daily menu",
      problems: [
        {
          kind: "dish_not_included",
          productId: f.soup,
          name: "Soup",
          parentName: null,
          courseId: f.sharing,
          courseName: "Sharing plates",
        },
        { kind: "line_unfillable", lineId: f.lines[0]!.id },
      ],
    },
  ]);
  await expect(publish()).rejects.toMatchObject({
    code: "set_menu.not_publishable",
    params: { menuId: f.daily, count: 2 },
  });
  expect(await live()).toBeNull();
});

it("copies the set menu's stored change stamp rather than the time of the build", async () => {
  const older = new Date("2026-11-17T11:00:00.000Z");
  await suite.db.update(menus).set({ updatedAt: older }).where(eq(menus.id, f.daily));
  await place();
  const first = await build();
  expect(first.document.setMenus?.[f.daily]?.changedAt).toBe(older.toISOString());
  expect((await build()).workingHash).toBe(first.workingHash);
  await app((tx) => updateMenuItem(tx, f.daily, f.sirloinItem, { grossPrice: "6.00" }));
  const [stored] = await suite.db
    .select({ stamp: menus.updatedAt })
    .from(menus)
    .where(eq(menus.id, f.daily));
  const updated = await build();
  expect(updated.document.setMenus?.[f.daily]?.changedAt).toBe(stored!.stamp.toISOString());
  expect(stored!.stamp).not.toEqual(older);
  expect(updated.workingHash).not.toBe(first.workingHash);
});

it("publishes a surcharge on a dish at a different VAT class from the set menu", async () => {
  await place();
  await suite.db.update(products).set({ vatClass: "general" }).where(eq(products.id, f.sirloin));
  await publish();
  const copy = await fromLive();
  expect(copy?.terms).toMatchObject({ vatClass: "reduced", takeawayVatClass: "reduced" });
  expect(copy?.offers[f.sirloinItem]).toMatchObject({ vatClass: "general", unitPrice: "5.00" });
});

it("freezes a takeaway-only VAT edit on the next full-menu publish", async () => {
  const older = new Date("2026-11-17T11:00:00.000Z");
  await suite.db.update(menus).set({ updatedAt: older }).where(eq(menus.id, f.daily));
  await place();
  const first = await build();
  await publish();

  await app((tx) => updateMenuDetails(tx, f.daily, { setTakeawayVatClass: "general" }));
  const second = await build();
  const copy = second.document.setMenus?.[f.daily];
  expect(second.workingHash).not.toBe(first.workingHash);
  expect(Date.parse(copy!.changedAt)).toBeGreaterThan(older.getTime());
  expect(copy?.terms).toMatchObject({ vatClass: "reduced", takeawayVatClass: "general" });
  expect((await fromLive())?.terms).toMatchObject({
    vatClass: "reduced",
    takeawayVatClass: "reduced",
  });
  await publish();
  expect(await fromLive()).toEqual(copy);
});

it("refuses to publish or live-edit a set menu on its own", async () => {
  const expected = { code: "set_menu.wrong_place", params: { menuId: f.daily } };
  await expect(publish(f.daily)).rejects.toMatchObject(expected);
  await expect(
    app((tx) => patchLiveMenu(tx, f.daily, "unpublished", [], personId)),
  ).rejects.toMatchObject(expected);
});

it("reads all built set menus' inclusion lines together", async () => {
  await place();
  const extra = await app(async (tx) => {
    const second = await setMenu(tx, "Special menu");
    const third = await setMenu(tx, "Evening menu");
    const dinner = await createMenu(tx, { name: "Dinner" });
    const dinnerRoot = await requireMenuRoot(tx, dinner.id);
    await addMember(tx, f.lunchRoot, { kind: "set_menu", menuId: second.id });
    await addMember(tx, dinnerRoot, { kind: "set_menu", menuId: third.id });
    return { second: second.id, third: third.id, dinner: dinner.id };
  });
  await app(async (tx) => {
    const select = vi.spyOn(tx, "select");
    try {
      const { menus: documents } = await buildMenuDocuments(tx);
      expect(
        select.mock.calls.filter(
          ([selection]) => selection && "id" in selection && selection.id === setMenuLines.id,
        ),
      ).toHaveLength(1);
      expect(Object.keys(documents.get(f.lunch)!.document.setMenus!).sort()).toEqual(
        [f.daily, extra.second].sort(),
      );
      expect(Object.keys(documents.get(extra.dinner)!.document.setMenus!)).toEqual([extra.third]);
    } finally {
      select.mockRestore();
    }
  });
});

it("copies a set menu placed inside an included menu", async () => {
  await app(async (tx) => {
    const specials = await createMenu(tx, { name: "Specials" });
    const root = await requireMenuRoot(tx, specials.id);
    await addMember(tx, root, f.dailyRef);
    await addMember(tx, f.lunchRoot, { kind: "section", sectionId: root });
  });
  await publish();
  expect((await fromLive())?.name).toBe("Daily menu");
});

it("still publishes when a held set menu is inactive and leaves out its copy", async () => {
  await place();
  await suite.db.update(menus).set({ active: false }).where(eq(menus.id, f.daily));
  await publish();
  const { document } = (await live())!;
  expect(document).not.toHaveProperty("setMenus");
  expect(documentSetMenuOffers(document)).toEqual([]);
  expect((await live())?.document.root.members).not.toContainEqual(
    expect.objectContaining(f.dailyRef),
  );
});

it("publishes one copy for two placements of the same set menu", async () => {
  await place();
  const { id } = await app(async (tx) => {
    const deals = await createSectionIn(tx, f.lunchRoot, { internalName: "Deals" });
    await addMember(tx, deals.id, f.dailyRef);
    return deals;
  });
  await publish();
  const document = (await live())!.document;
  expect(Object.keys(document.setMenus ?? {})).toEqual([f.daily]);
  const member = { ...f.dailyRef, name: "Daily menu" };
  expect(document.root.members).toContainEqual(member);
  expect(document.root.members).toContainEqual(
    expect.objectContaining({ sectionId: id, members: [member] }),
  );
});

it("uses the dish surcharge for a variant without its own and drops a dish with every variant excluded", async () => {
  await place();
  await app(async (tx) => {
    await updateMenuItem(tx, f.daily, f.wineItem, { grossPrice: "2.00" });
    await saveSetMenuVariantChoices(tx, f.daily, f.wineItem, [
      { variantId: f.glass, included: true, surcharge: null },
      { variantId: f.bottle, included: false, surcharge: null },
    ]);
  });
  expect((await copied())?.offers[f.wineItem]?.variants).toEqual([
    expect.objectContaining({ id: f.glass, unitPrice: "2.00", menuPrice: "2.00" }),
  ]);
  await app(async (tx) => {
    await tx.update(products).set({ courseId: f.drinks }).where(eq(products.id, f.bravas));
    await addSetMenuDishes(tx, f.daily, [{ productId: f.bravas, excludedVariantIds: [] }]);
    await saveSetMenuVariantChoices(tx, f.daily, f.wineItem, [
      { variantId: f.glass, included: false, surcharge: null },
      { variantId: f.bottle, included: false, surcharge: null },
    ]);
  });
  await publish();
  const copy = await fromLive();
  expect(copy?.offers).not.toHaveProperty(f.wineItem);
  expect(Object.values(copy!.offers)).toContainEqual(
    expect.objectContaining({ productId: f.bravas, countsAsCourseId: f.drinks }),
  );
  expect(copy?.root.members).not.toContainEqual(
    expect.objectContaining({ menuItemId: f.wineItem }),
  );
});

it("refuses a scheduled publish of a set menu or of a full menu with an invalid copy", async () => {
  const at = new Date("2026-11-18T12:00:00.000Z");
  const later = new Date("2026-11-18T13:00:00.000Z");
  const queue = (menuId: string) =>
    app(async (tx) => {
      const { workingHash } = await buildMenuDocument(tx, menuId);
      return queueMenuPublication(tx, menuId, workingHash, later, personId, { at });
    });
  await expect(queue(f.daily)).rejects.toMatchObject({
    code: "set_menu.wrong_place",
    params: { menuId: f.daily },
  });
  await place();
  await suite.db.update(products).set({ courseId: f.sharing }).where(eq(products.id, f.soup));
  await expect(queue(f.lunch)).rejects.toMatchObject({
    code: "set_menu.not_publishable",
    params: { menuId: f.daily, count: 2 },
  });
});

it("refuses to archive a dish listed only in a live set-menu copy", async () => {
  await place();
  await publish();
  await expect(app((tx) => assertOffPublishedMenus(tx, [f.soup]))).rejects.toMatchObject({
    code: "product.on_live_menu",
    params: { products: [{ id: f.soup, name: "Soup" }], menus: [{ id: f.lunch, name: "Lunch" }] },
  });
});

it("registers a photo used only by a dish in a published set-menu copy", async () => {
  const filename = libraryImageName("soup.jpg");
  await seedLibraryImages(suite.db, "soup.jpg");
  await suite.db.update(products).set({ image: filename }).where(eq(products.id, f.soup));
  await place();
  const { versionId } = await publish();
  const rows = await suite.db
    .select({ filename: menuVersionImages.filename })
    .from(menuVersionImages)
    .where(eq(menuVersionImages.versionId, versionId));
  expect(rows).toEqual([{ filename }]);
});
