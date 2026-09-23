import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  createCatalogue,
  createMenuSection,
  listMenuSections,
  updateMenuSection,
} from "./operations.js";
import { useCatalogueDb } from "../test/fixtures.js";

const fx = useCatalogueDb();
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const MISSING = "00000000-0000-4000-8000-0000000000dd";

let menuId = "";
let otherMenuId = "";

beforeEach(async () => {
  await seedTenant(fx.db);
  await run(async (tx) => {
    menuId = (await createCatalogue(tx, { name: "Lunch" })).id;
    otherMenuId = (await createCatalogue(tx, { name: "Dinner" })).id;
  });
});

describe("listing a menu's sections", () => {
  it("returns only that menu's sections, in display order", async () => {
    await run(async (tx) => {
      await createMenuSection(tx, { menuId, name: { en: "Desserts" }, displayOrder: 2 });
      await createMenuSection(tx, { menuId, name: { en: "Starters" }, displayOrder: 0 });
      await createMenuSection(tx, { menuId: otherMenuId, name: { en: "Wine" }, displayOrder: 1 });
      await createMenuSection(tx, { menuId, name: { en: "Mains" }, displayOrder: 1 });
    });

    const sections = await run((tx) => listMenuSections(tx, menuId));

    expect(sections.map((section) => [section.name, section.displayOrder])).toEqual([
      [{ en: "Starters" }, 0],
      [{ en: "Mains" }, 1],
      [{ en: "Desserts" }, 2],
    ]);
    expect(sections.every((section) => section.menuId === menuId && section.active)).toBe(true);
  });

  it("breaks a display-order tie by section id", async () => {
    const created = await run(async (tx) => [
      await createMenuSection(tx, { menuId, name: { en: "Tapas" } }),
      await createMenuSection(tx, { menuId, name: { en: "Raciones" } }),
      await createMenuSection(tx, { menuId, name: { en: "Postres" } }),
    ]);

    const sections = await run((tx) => listMenuSections(tx, menuId));

    expect(sections.map((section) => section.id)).toEqual(
      created.map((section) => section.id).sort(),
    );
  });

  it("answers an empty list for a menu with no sections", async () => {
    expect(await run((tx) => listMenuSections(tx, menuId))).toEqual([]);
  });

  it("refuses a menu id no catalogue holds", async () => {
    await expect(run((tx) => listMenuSections(tx, MISSING))).rejects.toMatchObject({
      code: "catalogue.not_found",
      params: { catalogueId: MISSING },
    });
  });
});

describe("renaming a section", () => {
  it("replaces the section's name and leaves its siblings alone", async () => {
    const [starters, mains] = await run(async (tx) => [
      await createMenuSection(tx, { menuId, name: { en: "Starters" }, displayOrder: 0 }),
      await createMenuSection(tx, { menuId, name: { en: "Mains" }, displayOrder: 1 }),
    ]);

    await run((tx) =>
      updateMenuSection(tx, starters!.id, { name: { en: "Small plates", es: "Tapas" } }),
    );

    expect(await run((tx) => listMenuSections(tx, menuId))).toEqual([
      { ...starters, name: { en: "Small plates", es: "Tapas" } },
      mains,
    ]);
  });

  it("refuses a section id no row holds", async () => {
    await expect(
      run((tx) => updateMenuSection(tx, MISSING, { name: { en: "Anything" } })),
    ).rejects.toMatchObject({ code: "menu_section.not_found", params: { sectionId: MISSING } });
  });
});
