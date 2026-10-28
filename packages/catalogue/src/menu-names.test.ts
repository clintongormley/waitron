import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { catalogues, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, listCatalogues, updateMenuDetails } from "./operations.js";
import { readMenuStructure } from "./menu-structure.js";
import { sections } from "./schema/sections.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

describe("menu names on creation and rename", () => {
  it.each(
    ["Café", "  CAFÉ  ", "Cafe\u0301"].flatMap((name) =>
      (["create", "rename"] as const).map((mode) => ({ name, mode })),
    ),
  )(
    "refuses $mode with the held name $name without changing either menu",
    async ({ name, mode }) => {
      await seedTenant(fx.db);
      const held = await app((tx) => createCatalogue(tx, { name: "Café" }));
      const other = await app((tx) => createCatalogue(tx, { name: "Dinner" }));
      await fx.db.update(catalogues).set({ active: false }).where(eq(catalogues.id, held.id));
      const before = await app(listCatalogues);
      const structure = await app((tx) => readMenuStructure(tx, other.id));
      const write =
        mode === "create"
          ? app((tx) => createCatalogue(tx, { name }))
          : app((tx) => updateMenuDetails(tx, other.id, { name, names: { en: "Changed" } }));
      await expect(write).rejects.toMatchObject({
        code: "menu.name_taken",
        params: { field: "name" },
      });
      expect(await app(listCatalogues)).toEqual(before);
      expect(await app((tx) => readMenuStructure(tx, other.id))).toEqual(structure);
    },
  );

  it("allows distinct accents and interior spacing, and excludes the renamed menu itself", async () => {
    await seedTenant(fx.db);
    const menu = await app((tx) => createCatalogue(tx, { name: "Café bar" }));
    await app((tx) => createCatalogue(tx, { name: "Cafe bar" }));
    await app((tx) => createCatalogue(tx, { name: "Café  bar" }));
    await app((tx) => updateMenuDetails(tx, menu.id, { name: "  CAFÉ BAR  " }));
    const rows = await app(listCatalogues);
    expect(rows.map((row) => row.name).sort()).toEqual(["CAFÉ BAR", "Cafe bar", "Café  bar"]);
    expect((await app((tx) => readMenuStructure(tx, menu.id))).root.internalName).toBe("CAFÉ BAR");
  });

  it("keeps existing duplicate names until renamed while allowing presentation-only saves", async () => {
    await seedTenant(fx.db);
    const first = await app((tx) => createCatalogue(tx, { name: "Lunch" }));
    const second = await app((tx) => createCatalogue(tx, { name: "Dinner" }));
    const root = (await app((tx) => readMenuStructure(tx, second.id))).rootSectionId;
    await app(async (tx) => {
      await tx.update(catalogues).set({ name: "Lunch" }).where(eq(catalogues.id, second.id));
      await tx.update(sections).set({ internalName: "Lunch" }).where(eq(sections.id, root));
    });
    await app((tx) => updateMenuDetails(tx, second.id, { name: "Lunch", names: { en: "Midday" } }));
    await app((tx) => updateMenuDetails(tx, second.id, { color: "#112233" }));
    expect((await app(listCatalogues)).map((row) => row.name)).toEqual(["Lunch", "Lunch"]);
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
    const renamed = await app(listCatalogues);
    expect(renamed).toHaveLength(2);
    expect(renamed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, name: "Lunch" }),
        expect.objectContaining({ id: second.id, name: "Evening" }),
      ]),
    );
  });
});
