import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { products, sectionMembers, withTransaction, type Transaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useMenuDb } from "../test/fixtures.js";
import { menusFixture, offerOf, product, type MenusFixture } from "../test/menus-fixture.js";
import { deleteMenu } from "./delete.js";
import { updateExtraList } from "./extras.js";
import {
  onceLiveVersionsAfter,
  patchLiveMenu,
  previewMenu,
  publishMenu,
  readLiveDocuments,
  readRecordedDocuments,
} from "./menu-publication.js";
import { cancelMenuPublication, queueMenuPublication } from "./menu-schedule.js";
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

const HOUR = 3_600_000;
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR);

const publish = (menuId: string, at?: Date) =>
  app(async (tx) => {
    const { hash } = await previewMenu(tx, menuId);
    return (await publishMenu(tx, menuId, hash, PERSON, { at })).versionId;
  });
const queue = (menuId: string, activatesAt: Date, at?: Date) =>
  app(async (tx) => {
    const { hash } = await previewMenu(tx, menuId);
    return queueMenuPublication(tx, menuId, hash, activatesAt, PERSON, { at });
  });
const patchName = (menuId: string, baseVersionId: string, menuItemId: string, value: string) =>
  app((tx) =>
    patchLiveMenu(
      tx,
      menuId,
      baseVersionId,
      [{ target: { kind: "offer", menuItemId }, field: "name", value }],
      PERSON,
    ),
  );
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

const extrasListOf = (...productIds: string[]) =>
  app((tx) =>
    updateExtraList(
      tx,
      f.extrasList,
      { name: "Extras", items: productIds.map((productId) => ({ productId, price: "0.40" })) },
      "en",
    ),
  );

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

  await patchName(f.lunch, v2, soup.menuItemId!, "Broth");
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
  await extrasListOf(f.lager);
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

it("keeps a published correction after the live version drops the dish", async () => {
  await declare(f.soup, "milk");
  const v1 = await publish(f.lunch);
  const soup = await line(f.lunch, v1, f.soup);
  const corrected = { milk: {}, nuts: { kinds: ["walnuts" as const] } };
  await app((tx) => updateProduct(tx, f.soup, { allergens: corrected }));
  await publish(f.lunch);
  expect(await allergensOf(soup)).toEqual(corrected);
  await removeFrom(f.lunchRoot, f.soup);
  await declare(f.soup, "eggs");
  await publish(f.lunch);
  expect(await allergensOf(soup)).toEqual(corrected);
});

it("keeps a published correction after the live version drops the variant", async () => {
  await declare(f.lemonade, "milk");
  await declare(f.large, "celery");
  const v1 = await publish(f.lunch);
  const large = await line(f.lunch, v1, f.lemonade, { productId: f.large });
  await declare(f.large, "celery", "fish");
  await publish(f.lunch);
  await removeFrom(f.drinks, f.lemonade);
  await publish(f.lunch);
  await app((tx) => setProductVariants(tx, f.lemonade, [], "en"));
  await declare(f.lemonade, "eggs");
  await app((tx) => addMember(tx, f.drinks, product(f.lemonade)));
  await publish(f.lunch);
  expect(await allergensOf(await line(f.lunch, v1, f.lemonade))).toEqual({ eggs: {} });
  expect(await allergensOf(large)).toEqual({ celery: {}, fish: {} });
});

it("keeps a published correction after the live version drops the extras item", async () => {
  await declare(f.lemonade, "milk");
  await declare(f.extraLemon, "celery");
  const v1 = await publish(f.lunch);
  const lemon = await lemonLine(v1);
  await declare(f.extraLemon, "celery", "eggs");
  await publish(f.lunch);
  await extrasListOf(f.lager);
  await declare(f.extraLemon, "fish");
  await publish(f.lunch);
  expect(await allergensOf(lemon)).toEqual({ celery: {}, eggs: {} });
});

it("keeps a set-menu dish's correction when the product stays on the menu alone", async () => {
  await declare(f.lemonade, "milk");
  const { menuId: daily, memberId } = await placeSetMenu();
  const v1 = await publish(f.lunch);
  const picked = await line(daily, v1, f.lemonade);
  const alone = await line(f.lunch, v1, f.lemonade);
  await declare(f.lemonade, "milk", "fish");
  await publish(f.lunch);
  await app((tx) => removeMember(tx, f.lunchRoot, memberId));
  await declare(f.lemonade, "eggs");
  await publish(f.lunch);
  expect(await allergensOf(alone)).toEqual({ eggs: {} });
  expect(await allergensOf(picked)).toEqual({ milk: {}, fish: {} });
});

it("passes over a queued version a patch cancelled and queued again", async () => {
  await declare(f.soup, "milk");
  const v1 = await publish(f.lunch);
  const soup = await line(f.lunch, v1, f.soup);
  await removeFrom(f.lunchRoot, f.soup);
  const v2 = await publish(f.lunch);
  await app((tx) => addMember(tx, f.lunchRoot, product(f.soup)));
  await declare(f.soup, "fish");
  const queued = await queue(f.lunch, hoursFromNow(24));
  const lemonade = await app((tx) => offerOf(tx, f.lunch, f.lemonade));
  const { number, requeued } = await patchName(f.lunch, v2, lemonade, "Lemon soda");
  expect(queued.number).toBeLessThan(number);
  expect(requeued).toHaveLength(1);
  expect(await allergensOf(soup)).toEqual({ milk: {} });
});

it("never reads a version still waiting for its time", async () => {
  await removeFrom(f.lunchRoot, f.soup);
  const v1 = await publish(f.lunch);
  await app((tx) => addMember(tx, f.lunchRoot, product(f.soup)));
  await declare(f.soup, "fish");
  await queue(f.lunch, hoursFromNow(24));
  expect(await allergensOf(await line(f.lunch, v1, f.soup))).toBeUndefined();
});

it("reads a scheduled version whose time passed before anything settled it", async () => {
  await declare(f.soup, "milk");
  const v1 = await publish(f.lunch, hoursFromNow(-5));
  const soup = await line(f.lunch, v1, f.soup);
  await declare(f.soup, "milk", "fish");
  await queue(f.lunch, hoursFromNow(-2), hoursFromNow(-4));
  await removeFrom(f.lunchRoot, f.soup);
  await queue(f.lunch, hoursFromNow(-1), hoursFromNow(-3));
  expect(await allergensOf(soup)).toEqual({ milk: {}, fish: {} });
});

it("starts from the newest version that was live when the menu has none now", async () => {
  await declare(f.soup, "milk");
  const v1 = await publish(f.lunch);
  const soup = await line(f.lunch, v1, f.soup);
  await declare(f.soup, "milk", "fish");
  await publish(f.lunch);
  await declare(f.soup, "eggs");
  await queue(f.lunch, hoursFromNow(24));
  await app((tx) => deleteMenu(tx, f.lunch, PERSON));
  expect(await app((tx) => readLiveDocuments(tx, [f.lunch]))).toEqual(new Map());
  expect(await allergensOf(soup)).toEqual({ milk: {}, fish: {} });
});

it("never reads a version older than the line's own", async () => {
  await declare(f.soup, "milk");
  await publish(f.lunch);
  await removeFrom(f.lunchRoot, f.soup);
  const v2 = await publish(f.lunch);
  await declare(f.lager, "sesame");
  await publish(f.lunch);
  expect(await allergensOf(await line(f.lunch, v2, f.soup))).toBeUndefined();
});

it("reads a line's own version last, even one that was never live", async () => {
  await declare(f.soup, "milk");
  await publish(f.lunch);
  await removeFrom(f.lunchRoot, f.soup);
  await declare(f.lager, "sesame");
  const v2 = await publish(f.lunch);
  await app((tx) => addMember(tx, f.lunchRoot, product(f.soup)));
  await declare(f.soup, "fish");
  const { versionId } = await queue(f.lunch, hoursFromNow(24));
  const lemonade = await app((tx) => offerOf(tx, f.lunch, f.lemonade));
  await patchName(f.lunch, v2, lemonade, "Lemon soda");
  expect(await allergensOf(await line(f.lunch, versionId, f.soup))).toEqual({ fish: {} });
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
      dietaryDeclarations: ["vegan"],
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
    dietaryDeclarations: ["vegan", "vegetarian", "no_meat", "no_fish"],
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

it("reads a line's own version when it outnumbers the live one", async () => {
  await declare(f.soup, "milk");
  const v1 = await publish(f.lunch);
  await declare(f.soup, "fish");
  const { versionId: waiting } = await queue(f.lunch, hoursFromNow(24));
  const soup = await line(f.lunch, v1, f.soup);
  const ahead = { ...soup, id: "ahead", menuVersionId: waiting };
  const allergens = async () => {
    const found = await read(soup, ahead);
    return [soup, ahead].map(({ id }) => found.get(id)?.allergens);
  };
  expect(await allergens()).toEqual([{ milk: {} }, { fish: {} }]);
  await app((tx) => cancelMenuPublication(tx, f.lunch, waiting, PERSON));
  expect(await allergens()).toEqual([{ milk: {} }, { fish: {} }]);
});

it("takes one statement for any number of lines once their documents are kept", async () => {
  await declare(f.soup, "milk");
  const published: string[] = [];
  for (const menuId of [f.lunch, f.dinner]) published.push(await publish(menuId));
  const [old, dinner] = published as [string, string];
  const dropped = await line(f.lunch, old, f.soup);
  const stale = await line(f.lunch, old, f.lemonade);
  await removeFrom(f.lunchRoot, f.soup);
  const lunch = await publish(f.lunch, hoursFromNow(-3));
  const { versionId: due } = await queue(f.drinksMenu, hoursFromNow(-1), hoursFromNow(-2));
  const current = [
    await line(f.lunch, lunch, f.lemonade),
    await line(f.dinner, dinner, f.lemonade),
    await line(f.drinksMenu, due, f.lemonade),
  ];
  const statements = async (...lines: PublishedLine[]) => {
    const prepared = vi.spyOn(
      (fx.db as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } })
        .session,
      "prepareQuery",
    );
    try {
      const { size } = await read(...lines);
      return {
        size,
        statements: prepared.mock.calls.filter(([{ sql }]) => sql.includes("menu_versions")).length,
      };
    } finally {
      prepared.mockRestore();
    }
  };
  const many = (lines: PublishedLine[]) =>
    Array.from({ length: 2001 }, (_, index) => ({
      ...lines[index % lines.length]!,
      id: `line-${index}`,
    }));

  expect(await statements(...current)).toEqual({ size: 3, statements: 2 });
  expect(await statements(...current)).toEqual({ size: 3, statements: 1 });
  expect(await statements(...many(current))).toEqual({ size: 2001, statements: 1 });
  expect(await statements(...current, stale)).toEqual({ size: 4, statements: 1 });
  expect(await statements(...current, stale, dropped)).toEqual({ size: 5, statements: 2 });
  expect(await statements(...many([...current, stale, dropped]))).toEqual({
    size: 2001,
    statements: 1,
  });
  expect(onceLiveVersionsAfter).toHaveBeenCalledTimes(6);

  const unknown = Array.from({ length: 600 }, () => crypto.randomUUID());
  expect(
    await statements(
      ...unknown.map((id) => ({ ...dropped, id, menuVersionId: id })),
      ...current,
      dropped,
    ),
  ).toEqual({ size: 4, statements: 2 });
});

it("reads a long history in a few statements, each line from the newest version holding it", async () => {
  await declare(f.soup, "milk");
  await declare(f.lager, "milk");
  const versions = [await publish(f.lunch)];
  const [soup, lager, lemonade] = [
    await line(f.lunch, versions[0]!, f.soup),
    await line(f.lunch, versions[0]!, f.lager),
    await line(f.lunch, versions[0]!, f.lemonade),
  ];
  for (let number = 2; number <= 49; number += 1) {
    if (number === 3) await removeFrom(f.lunchRoot, f.soup);
    if (number === 2) await declare(f.soup, "celery");
    if (number === 20) await removeFrom(f.beer, f.lager);
    if (number < 20) await declare(f.lager, number === 19 ? "sesame" : "milk", "eggs");
    await declare(f.lemonade, number % 2 === 0 ? "fish" : "eggs");
    versions.push(await publish(f.lunch));
  }
  vi.clearAllMocks();
  const found = await read(soup, lager, lemonade);
  expect([soup, lager, lemonade].map(({ id }) => found.get(id)?.allergens)).toEqual([
    { celery: {} },
    { sesame: {}, eggs: {} },
    { eggs: {} },
  ]);
  expect(onceLiveVersionsAfter).toHaveBeenCalledTimes(1);
  const documentReads = vi.mocked(readRecordedDocuments).mock.calls.map(([, ids]) => ids);
  expect(new Set(documentReads[0])).toEqual(new Set([versions[48]]));
  // Soup is in the two oldest versions alone, so its walk reaches every one of them.
  expect(documentReads.map((ids) => new Set(ids).size)).toEqual([1, 2, 4, 8, 16, 16, 2]);
});
