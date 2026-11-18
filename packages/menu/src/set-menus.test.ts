import { and, eq } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { menus, sections, withTransaction, type Transaction } from "@waitron/db";
import { useMenuDb } from "../test/fixtures.js";
import { duplicateMenu } from "./menu-copy.js";
import { readSetMenu } from "./set-menus.js";
import { menuRoot } from "./menu-structure.js";
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
  setVatClass: "reduced",
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

it.each([
  [{ setPrice: "-1" }, "setPrice"],
  [{ setPrice: null }, "setPrice"],
  [{ setPrice: undefined }, "setPrice"],
  [{ setVatClass: "luxury" as never }, "setVatClass"],
  [{ setVatClass: null }, "setVatClass"],
  [{ setTakeawayVatClass: "luxury" as never }, "setTakeawayVatClass"],
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
  await app((tx) => updateMenuDetails(tx, set.id, { setVatClass: "general" }));
  expect(await app(listMenus)).toContainEqual({
    ...set,
    name: "Daily special",
    setPrice: "0.00",
    setVatClass: "general",
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

it("duplicates the distinct takeaway rate with the eat-in rate", async () => {
  const set = await app((tx) => createMenu(tx, { ...lunch, setTakeawayVatClass: "general" }));
  const copy = await app((tx) => duplicateMenu(tx, set.id, "Lunch copy"));
  const rates = { vatClass: "reduced", takeawayVatClass: "general" };
  expect(await app((tx) => readSetMenu(tx, set.id))).toMatchObject(rates);
  expect(await app((tx) => readSetMenu(tx, copy.id))).toMatchObject(rates);
});

it("saves a takeaway-only patch, stamps it and allows clearing the override", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.setSystemTime(new Date("2030-02-01T12:00:00Z"));
  const set = await app((tx) => createMenu(tx, lunch));
  const read = () => app((tx) => readSetMenu(tx, set.id));
  expect((await read()).takeawayVatClass).toBeNull();
  const editTime = new Date("2030-02-01T12:01:00Z");
  vi.setSystemTime(editTime);
  await app((tx) => updateMenuDetails(tx, set.id, { setTakeawayVatClass: "general" }));
  expect(await read()).toMatchObject({ vatClass: "reduced", takeawayVatClass: "general" });
  expect(
    await suite.db.select({ updatedAt: menus.updatedAt }).from(menus).where(eq(menus.id, set.id)),
  ).toEqual([{ updatedAt: editTime }]);
  await app((tx) => updateMenuDetails(tx, set.id, { setPrice: "15.00" }));
  expect((await read()).takeawayVatClass).toBe("general");
  await app((tx) => updateMenuDetails(tx, set.id, { setTakeawayVatClass: null }));
  expect(await read()).toMatchObject({ vatClass: "reduced", takeawayVatClass: null });
});

it("refuses an invalid takeaway patch and a takeaway patch to an ordinary menu", async () => {
  const set = await app((tx) => createMenu(tx, lunch));
  await expect(
    app((tx) => updateMenuDetails(tx, set.id, { setTakeawayVatClass: "luxury" as never })),
  ).rejects.toMatchObject({ code: "set_menu.invalid", params: { field: "setTakeawayVatClass" } });
  const ordinary = await app((tx) => createMenu(tx, { name: "Dinner" }));
  await expect(
    app((tx) => updateMenuDetails(tx, ordinary.id, { setTakeawayVatClass: "general" })),
  ).rejects.toMatchObject({ code: "set_menu.not_found", params: { menuId: ordinary.id } });
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
