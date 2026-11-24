import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { menus, withTransaction, type Transaction } from "@waitron/db";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { useMenuDb } from "../test/fixtures.js";
import { createMenu, deactivateMenu, listMenus, updateMenuDetails } from "./operations.js";
import { readMenuStructure } from "./menu-structure.js";

const fx = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

describe("menu names on creation and rename", () => {
  it.each(
    ["Café", "  CAFÉ  ", "Cafe\u0301"].flatMap((name) =>
      (["create", "rename"] as const).map((mode) => ({ name, mode })),
    ),
  )(
    "refuses $mode with the held name $name without changing either menu",
    async ({ name, mode }) => {
      await seedTaxpayer(fx.db);
      const held = await app((tx) => createMenu(tx, { name: "Café" }));
      const other = await app((tx) => createMenu(tx, { name: "Dinner" }));
      const before = await app(listMenus);
      const structure = await app((tx) => readMenuStructure(tx, other.id));
      const write = () =>
        mode === "create"
          ? app((tx) => createMenu(tx, { name }))
          : app((tx) => updateMenuDetails(tx, other.id, { name, names: { en: "Changed" } }));
      await expect(write()).rejects.toMatchObject({
        code: "menu.name_taken",
        params: { field: "name" },
      });
      expect(await app(listMenus)).toEqual(before);
      expect(await app((tx) => readMenuStructure(tx, other.id))).toEqual(structure);
      await app((tx) => deactivateMenu(tx, held.id));
      await write();
      expect(await app(listMenus)).toContainEqual(
        expect.objectContaining({
          active: true,
          name: name.trim(),
        }),
      );
    },
  );

  it("allows distinct accents and interior spacing, and excludes the renamed menu itself", async () => {
    await seedTaxpayer(fx.db);
    const menu = await app((tx) => createMenu(tx, { name: "Café bar" }));
    await app((tx) => createMenu(tx, { name: "Cafe bar" }));
    await app((tx) => createMenu(tx, { name: "Café  bar" }));
    await app((tx) => updateMenuDetails(tx, menu.id, { name: "  CAFÉ BAR  " }));
    const rows = await app(listMenus);
    expect(rows.map((row) => row.name).sort()).toEqual(["CAFÉ BAR", "Cafe bar", "Café  bar"]);
    expect((await app((tx) => readMenuStructure(tx, menu.id))).root.internalName).toBe("CAFÉ BAR");
  });

  it("keeps existing duplicate names until renamed while allowing presentation-only saves", async () => {
    await seedTaxpayer(fx.db);
    const first = await app((tx) => createMenu(tx, { name: "Lunch" }));
    const second = await app((tx) => createMenu(tx, { name: "Dinner" }));
    await app(async (tx) => {
      await tx.update(menus).set({ name: "Lunch" }).where(eq(menus.id, second.id));
    });
    await app((tx) => updateMenuDetails(tx, second.id, { name: "Lunch", names: { en: "Midday" } }));
    await app((tx) => updateMenuDetails(tx, second.id, { color: "#112233" }));
    expect((await app(listMenus)).map((row) => row.name)).toEqual(["Lunch", "Lunch"]);
    expect((await app((tx) => readMenuStructure(tx, second.id))).root).toMatchObject({
      internalName: "Lunch",
      names: { en: "Midday" },
      color: "#112233",
    });
    await expect(
      app((tx) => updateMenuDetails(tx, second.id, { name: "LUNCH" })),
    ).rejects.toMatchObject({
      code: "menu.name_taken",
      params: { field: "name" },
    });
    await app((tx) => updateMenuDetails(tx, second.id, { name: "Evening" }));
    const renamed = await app(listMenus);
    expect(renamed).toHaveLength(2);
    expect(renamed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, name: "Lunch" }),
        expect.objectContaining({ id: second.id, name: "Evening" }),
      ]),
    );
  });
});
