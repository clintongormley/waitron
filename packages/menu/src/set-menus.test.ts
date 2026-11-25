import { and, eq } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import {
  kitchenCourses,
  menus,
  products,
  sections,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useMenuDb } from "../test/fixtures.js";
import { buildMenuDocument } from "./menu-document.js";
import { publishMenu, readLiveMenu } from "./menu-publication.js";
import { addSetMenuDishes, readSetMenu } from "./set-menus.js";
import { menuRoot, requireMenuRoot } from "./menu-structure.js";
import { addMember } from "./sections.js";
import {
  createMenu,
  listMenus,
  menuPrices,
  setVenueDefaultMenu,
  updateMenuDetails,
} from "./operations.js";

const suite = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const lunch = {
  name: "Daily menu",
  kind: "set_menu",
  setPrice: "14.00",
} as const;

it("lists a priced set menu with its root and home sections", async () => {
  const created = await app((tx) => createMenu(tx, lunch));
  const expected = { id: created.id, active: true, ...lunch };
  expect(created).toEqual(expected);
  expect(await app(listMenus)).toContainEqual(expected);
  expect(await app((tx) => menuRoot(tx, created.id))).toEqual(expect.any(String));
  expect(
    await suite.db
      .select({ role: sections.role })
      .from(sections)
      .where(and(eq(sections.ownerMenuId, created.id), eq(sections.role, "home_layout"))),
  ).toEqual([{ role: "home_layout" }]);
});

it("a set menu's terms are its price, names and lines", async () => {
  await seedPerson(suite.db, { id: "terms-publisher", displayName: "Terms publisher" });
  const { set, holder, course, lines } = await app(async (tx) => {
    const set = await createMenu(tx, {
      name: "Daily menu",
      names: { en: "Daily menu" },
      kind: "set_menu",
      setPrice: "14.00",
    });
    const [{ id: course }] = await tx
      .insert(kitchenCourses)
      .values({ name: "Mains", displayOrder: 0 })
      .returning({ id: kitchenCourses.id });
    const [{ id: dish }] = await tx
      .insert(products)
      .values({ name: "Hake", courseId: course, unitPrice: 1200, vatClass: "reduced" })
      .returning({ id: products.id });
    const lines = await addSetMenuDishes(tx, set.id, [{ productId: dish, excludedVariantIds: [] }]);
    const holder = await createMenu(tx, { name: "Lunch" });
    await addMember(tx, await requireMenuRoot(tx, holder.id), {
      kind: "set_menu",
      menuId: set.id,
    });
    return { set, holder: holder.id, course, lines };
  });
  expect(set).toMatchObject({
    name: "Daily menu",
    active: true,
    kind: "set_menu",
    setPrice: "14.00",
  });
  const read = await app((tx) => readSetMenu(tx, set.id));
  expect(read).not.toHaveProperty("vatClass");
  expect(read).not.toHaveProperty("takeawayVatClass");
  await app(async (tx) =>
    publishMenu(tx, holder, (await buildMenuDocument(tx, holder)).workingHash, "terms-publisher"),
  );
  const live = await app((tx) => readLiveMenu(tx, holder));
  expect(live?.document.setMenus?.[set.id]?.terms).toEqual({
    price: "14.00",
    names: { en: "Daily menu" },
    lines: [{ id: lines[0]!.id, count: 1, courseIds: [course] }],
  });
});

it.each([
  [{ setPrice: "-1" }, "setPrice"],
  [{ setPrice: null }, "setPrice"],
  [{ setPrice: undefined }, "setPrice"],
])("refuses missing or invalid terms %j", async (terms, field) => {
  await expect(app((tx) => createMenu(tx, { ...lunch, ...terms }))).rejects.toMatchObject({
    code: "set_menu.invalid",
    params: { field },
  });
});

it.each(["10000.01", "14000.00"])("refuses a set-menu price of %s", async (setPrice) => {
  const refusal = { code: "set_menu.invalid", params: { field: "setPrice" } };
  await expect(app((tx) => createMenu(tx, { ...lunch, setPrice }))).rejects.toMatchObject(refusal);
  const set = await app((tx) => createMenu(tx, { ...lunch, setPrice: "10000.00" }));
  expect(set.setPrice).toBe("10000.00");
  await expect(app((tx) => updateMenuDetails(tx, set.id, { setPrice }))).rejects.toMatchObject(
    refusal,
  );
  expect(await app(listMenus)).toContainEqual(set);
});

it("changes a set menu's terms independently and refuses terms for an ordinary menu", async () => {
  const set = await app((tx) => createMenu(tx, lunch));
  await app((tx) => updateMenuDetails(tx, set.id, { name: "Daily special", setPrice: "0" }));
  expect(await app(listMenus)).toContainEqual({
    ...set,
    name: "Daily special",
    setPrice: "0.00",
  });

  const ordinary = await app((tx) => createMenu(tx, { name: "Dinner" }));
  await expect(
    app((tx) => updateMenuDetails(tx, ordinary.id, { setPrice: "1.00" })),
  ).rejects.toMatchObject({ code: "set_menu.not_found", params: { menuId: ordinary.id } });

  await suite.db.update(menus).set({ active: false }).where(eq(menus.id, set.id));
  await expect(
    app((tx) => updateMenuDetails(tx, set.id, { setPrice: "2.00" })),
  ).rejects.toMatchObject({ code: "set_menu.not_found", params: { menuId: set.id } });
});

it("stamps a price-only patch", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.setSystemTime(new Date("2030-02-01T12:00:00Z"));
  const set = await app((tx) => createMenu(tx, lunch));
  const editTime = new Date("2030-02-01T12:01:00Z");
  vi.setSystemTime(editTime);
  await app((tx) => updateMenuDetails(tx, set.id, { setPrice: "15.00" }));
  expect((await app((tx) => readSetMenu(tx, set.id))).price).toBe("15.00");
  expect(
    await suite.db.select({ updatedAt: menus.updatedAt }).from(menus).where(eq(menus.id, set.id)),
  ).toEqual([{ updatedAt: editTime }]);
});

it("refuses a set menu as the venue default and leaves the current default in place", async () => {
  const ordinary = await app((tx) => createMenu(tx, { name: "Dinner" }));
  await app((tx) => setVenueDefaultMenu(tx, ordinary.id));
  const set = await app((tx) => createMenu(tx, lunch));
  await expect(app((tx) => setVenueDefaultMenu(tx, set.id))).rejects.toMatchObject({
    code: "set_menu.wrong_place",
    params: { menuId: set.id },
  });
  expect(
    await suite.db.select({ id: menus.id }).from(menus).where(eq(menus.isDefault, true)),
  ).toEqual([{ id: ordinary.id }]);
});

it("refuses to show a set menu in ordinary menu Prices", async () => {
  const set = await app((tx) => createMenu(tx, lunch));
  await expect(app((tx) => menuPrices(tx, set.id))).rejects.toMatchObject({
    code: "set_menu.wrong_place",
    params: { menuId: set.id },
  });
});
