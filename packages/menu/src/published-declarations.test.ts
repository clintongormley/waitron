import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { products, sectionMembers, withTransaction, type Transaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useMenuDb } from "../test/fixtures.js";
import { menusFixture, offerOf, product, type MenusFixture } from "../test/menus-fixture.js";
import { updateExtraList } from "./extras.js";
import {
  menusOfVersions,
  patchLiveMenu,
  previewMenu,
  publishMenu,
  readLiveDocuments,
  readRecordedDocuments,
} from "./menu-publication.js";
import { createMenu, deactivateMenu, updateProduct } from "./operations.js";
import { productDeclarationValues } from "./product-declarations.js";
import {
  declarationsInDocument,
  readPublishedDeclarations,
  type PublishedLine,
} from "./published-declarations.js";
import { addMember, removeMember } from "./sections.js";
import { addSetMenuDishes } from "./set-menus.js";
import { setProductVariants } from "./variants.js";

vi.mock("./menu-publication.js", { spy: true });

const fx = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const PERSON = "person-1";

let f: MenusFixture;
beforeEach(async () => {
  vi.clearAllMocks();
  await seedPerson(fx.db, { id: PERSON, displayName: "Test person-1" });
  f = await menusFixture(fx.db);
});

const publish = (menuId: string) =>
  app(async (tx) => {
    const { hash } = await previewMenu(tx, menuId);
    return (await publishMenu(tx, menuId, hash, PERSON)).versionId;
  });
const declare = (
  productId: string,
  ...allergens: ("milk" | "fish" | "eggs" | "celery" | "sesame")[]
) =>
  app((tx) =>
    updateProduct(tx, productId, {
      allergens: Object.fromEntries(allergens.map((name) => [name, {}])),
    }),
  );
const read = (...lines: PublishedLine[]) => app((tx) => readPublishedDeclarations(tx, lines));
const allergensOf = async (line: PublishedLine) => (await read(line)).get(line.id)?.allergens;

const line = async (
  menuId: string,
  versionId: string,
  dish: string,
  over: Partial<PublishedLine> = {},
): Promise<PublishedLine> => ({
  id: crypto.randomUUID(),
  menuVersionId: versionId,
  menuItemId: await app((tx) => offerOf(tx, menuId, dish)),
  productId: dish,
  extraListId: null,
  ...over,
});
const lemonLine = (versionId: string, menuId = f.lunch) =>
  line(menuId, versionId, f.lemonade, { productId: f.extraLemon, extraListId: f.extrasList });

async function removeFrom(listId: string, productId: string): Promise<void> {
  const [member] = await fx.db
    .select({ id: sectionMembers.id })
    .from(sectionMembers)
    .where(and(eq(sectionMembers.sectionId, listId), eq(sectionMembers.productId, productId)));
  await app((tx) => removeMember(tx, listId, member!.id));
}

/** Places a set menu listing Lemonade and its variant in Lunch; answers the set menu's id and its place there. */
function placeSetMenu() {
  return app(async (tx) => {
    const { id } = await createMenu(tx, {
      name: "Daily menu",
      names: { en: "Daily menu" },
      kind: "set_menu",
      setPrice: "14.00",
      setVatClass: "reduced",
    });
    await tx.update(products).set({ courseId: f.course }).where(eq(products.id, f.lemonade));
    await addSetMenuDishes(tx, id, [{ productId: f.lemonade, excludedVariantIds: [] }]);
    const { id: memberId } = await addMember(tx, f.lunchRoot, { kind: "set_menu", menuId: id });
    return { menuId: id, memberId };
  });
}

it("reads a dish from its menu's live version after a later publish and a patch", async () => {
  await declare(f.soup, "milk");
  const v1 = await publish(f.lunch);
  const soup = await line(f.lunch, v1, f.soup);
  await declare(f.soup, "fish");
  expect(await allergensOf(soup)).toEqual({ milk: {} });

  const v2 = await publish(f.lunch);
  await declare(f.soup, "eggs");
  expect(await allergensOf(soup)).toEqual({ fish: {} });

  await app((tx) =>
    patchLiveMenu(
      tx,
      f.lunch,
      v2,
      [{ target: { kind: "offer", menuItemId: soup.menuItemId! }, field: "name", value: "Broth" }],
      PERSON,
    ),
  );
  expect(await allergensOf(soup)).toEqual({ fish: {} });
});

it("falls back to the line's own version when the live version dropped the dish", async () => {
  await declare(f.soup, "milk");
  const v1 = await publish(f.lunch);
  const soup = await line(f.lunch, v1, f.soup);
  await removeFrom(f.lunchRoot, f.soup);
  await publish(f.lunch);
  await declare(f.soup, "fish");
  expect(await allergensOf(soup)).toEqual({ milk: {} });
});

it("falls back to the line's own version when the live version dropped the variant", async () => {
  await declare(f.lemonade, "milk");
  await declare(f.large, "celery");
  const v1 = await publish(f.lunch);
  const large = await line(f.lunch, v1, f.lemonade, { productId: f.large });
  await removeFrom(f.drinks, f.lemonade);
  await publish(f.lunch);
  await app((tx) => setProductVariants(tx, f.lemonade, [], "en"));
  await declare(f.lemonade, "fish");
  await app((tx) => addMember(tx, f.drinks, product(f.lemonade)));
  await publish(f.lunch);
  expect(await allergensOf(await line(f.lunch, v1, f.lemonade))).toEqual({ fish: {} });
  expect(await allergensOf(large)).toEqual({ celery: {} });
});

it("falls back to the line's own version when the live version dropped the extras item", async () => {
  await declare(f.lemonade, "milk");
  await declare(f.extraLemon, "celery");
  await declare(f.lager, "sesame");
  const v1 = await publish(f.lunch);
  const lemon = await lemonLine(v1);
  await app((tx) =>
    updateExtraList(
      tx,
      f.extrasList,
      { name: "Extras", items: [{ productId: f.lager, price: "0.40" }] },
      "en",
    ),
  );
  await declare(f.extraLemon, "eggs");
  await publish(f.lunch);
  expect(await allergensOf(lemon)).toEqual({ celery: {} });
});

it("falls back for a set-menu dish when the live version dropped the set menu", async () => {
  await declare(f.large, "celery");
  const { menuId: daily, memberId } = await placeSetMenu();
  const v1 = await publish(f.lunch);
  const dish = await line(daily, v1, f.lemonade, { productId: f.large });
  await app((tx) => removeMember(tx, f.lunchRoot, memberId));
  await publish(f.lunch);
  await declare(f.large, "fish");
  expect(await allergensOf(dish)).toEqual({ celery: {} });
});

it("reads a variant, an extra and a set-menu dish, with the frozen values whole", async () => {
  await app(async (tx) => {
    await updateProduct(tx, f.lemonade, {
      allergens: { milk: {} },
      dietaryDeclarations: ["vegetarian"],
      dietOverride: { vegetarian: "yes" },
    });
    await updateProduct(tx, f.large, {
      allergens: { nuts: { kinds: ["walnuts"] } },
      dietaryDeclarations: ["vegan"],
      dietOverride: { vegan: "no" },
    });
    await updateProduct(tx, f.extraLemon, {
      allergens: { eggs: {} },
      dietaryDeclarations: ["halal"],
      dietOverride: { vegan: "yes" },
    });
  });
  const { menuId: daily } = await placeSetMenu();
  const v1 = await publish(f.lunch);
  const dish = await line(f.lunch, v1, f.lemonade);
  const variant = await line(f.lunch, v1, f.lemonade, { productId: f.large });
  const extra = await lemonLine(v1);
  const picked = await line(daily, v1, f.lemonade, { productId: f.large });
  const pickedExtra = await lemonLine(v1, daily);
  const lemonade = productDeclarationValues({
    allergens: { milk: {} },
    dietOverride: { vegetarian: "yes" },
    dietaryDeclarations: ["vegetarian"],
  });
  const large = productDeclarationValues({
    allergens: { nuts: { kinds: ["walnuts"] } },
    dietOverride: { vegan: "no" },
    dietaryDeclarations: ["vegan"],
  });
  const lemon = productDeclarationValues({
    allergens: { eggs: {} },
    dietOverride: null,
    dietaryDeclarations: ["halal"],
  });
  expect(await read(dish, variant, extra, picked, pickedExtra)).toEqual(
    new Map([
      [dish.id, lemonade],
      [variant.id, large],
      [extra.id, lemon],
      [picked.id, large],
      [pickedExtra.id, lemon],
    ]),
  );
});

it("reads the line's own dish where one document holds its product twice", async () => {
  const { menuId: daily } = await placeSetMenu();
  const v1 = await publish(f.lunch);
  const dish = await line(f.lunch, v1, f.lemonade);
  const picked = await line(daily, v1, f.lemonade);
  const recorded = await app((tx) => readRecordedDocuments(tx, [v1]));
  const document = structuredClone(recorded.get(v1)!);
  const ordinary = document.offers[dish.menuItemId!]!;
  const copy = document.setMenus![daily]!.offers[picked.menuItemId!]!;
  const lemonOf = (offer: typeof ordinary | typeof copy) =>
    offer.offeredModifiers.find((list) => list.kind === "extras")!.items[0]!;
  ordinary.allergens = { milk: {} };
  copy.allergens = { fish: {} };
  lemonOf(ordinary).addAllergens = { eggs: {} };
  lemonOf(copy).addAllergens = { sesame: {} };

  const lemon = await lemonLine(v1);
  const pickedLemon = await lemonLine(v1, daily);
  const read = (of: PublishedLine) => declarationsInDocument(document, of)?.allergens;
  expect([dish, picked, lemon, pickedLemon].map(read)).toEqual([
    { milk: {} },
    { fish: {} },
    { eggs: {} },
    { sesame: {} },
  ]);

  delete document.offers[dish.menuItemId!];
  expect(read(dish)).toBeUndefined();
  expect(read(lemon)).toEqual({ sesame: {} });
});

it("reads a menu's live version even when it is not sold now", async () => {
  await declare(f.soup, "milk");
  const v1 = await publish(f.lunch);
  await declare(f.soup, "fish");
  await publish(f.lunch);
  await app((tx) => deactivateMenu(tx, f.lunch));
  expect(await allergensOf(await line(f.lunch, v1, f.soup))).toEqual({ fish: {} });
});

it("a line with no version or found nowhere is absent", async () => {
  const v1 = await publish(f.lunch);
  const soup = await line(f.lunch, v1, f.soup);
  expect(
    await read(
      { ...soup, id: "no-version", menuVersionId: null },
      { ...soup, id: "unknown-version", menuVersionId: crypto.randomUUID() },
      { ...soup, id: "no-item", menuItemId: null },
      { ...soup, id: "no-product", productId: null },
      { ...soup, id: "another-product", productId: f.lager },
      { ...soup, id: "another-dishs-variant", productId: f.large },
      { ...soup, id: "another-list", productId: f.extraLemon, extraListId: f.iceList },
      { ...soup, id: "not-in-list", extraListId: f.extrasList },
      await line(f.dinner, v1, f.burger),
    ),
  ).toEqual(new Map());
  expect(await read()).toEqual(new Map());
});

it("one read per table however many lines", async () => {
  await declare(f.soup, "milk");
  const versions = [f.lunch, f.dinner, f.drinksMenu];
  const published: string[] = [];
  for (const menuId of versions) published.push(await publish(menuId));
  const dropped = await line(f.lunch, published[0]!, f.soup);
  const kept: PublishedLine[] = [];
  for (const [index, menuId] of versions.entries())
    kept.push(await line(menuId, published[index]!, f.lemonade));
  await removeFrom(f.lunchRoot, f.soup);
  await publish(f.lunch);
  const lines = Array.from({ length: 2001 }, (_, index) => ({
    ...[...kept, dropped][index % 4]!,
    id: `line-${index}`,
  }));
  vi.clearAllMocks();
  expect((await read(...lines)).size).toBe(2001);
  expect(menusOfVersions).toHaveBeenCalledTimes(1);
  expect(readLiveDocuments).toHaveBeenCalledTimes(1);
  expect(readRecordedDocuments).toHaveBeenCalledTimes(1);
});
