import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, type MenusFixture } from "../test/menus-fixture.js";
import { writeContentLanguages } from "./content-languages.js";
import { setIncludeFolder } from "./include-folder.js";
import { readMenuHome } from "./menu-home.js";
import { readMenuStructure } from "./menu-structure.js";
import { menuItems } from "./schema/menu.js";
import { sectionMembers, sections } from "./schema/sections.js";
import type { IncludeFolderInput } from "./section-types.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

async function refusalOf(fn: () => Promise<unknown>): Promise<unknown> {
  const error = (await captureError(fn)) as { code?: unknown; params?: unknown };
  return { code: error.code, params: error.params };
}

/** The menus fixture, with a photo and a colour written straight into the Drinks root, so a read
 * that answered the folder's instead of the included menu's own would differ. */
async function fixture(): Promise<MenusFixture & { include: string; soupMember: string }> {
  const f = await menusFixture(fx.db);
  await app((tx) =>
    tx
      .update(sections)
      .set({ image: "drinks.jpg", color: "#445566" })
      .where(eq(sections.id, f.drinks)),
  );
  const { nodes } = await app((tx) => readMenuStructure(tx, f.lunch));
  return {
    ...f,
    include: nodes.find((node) => node.includedMenuId === f.drinksMenu)!.memberId,
    soupMember: nodes.find((node) => node.ref.kind === "product")!.memberId,
  };
}

const storedRow = async (memberId: string) =>
  (
    await fx.db
      .select({
        showAsFolder: sectionMembers.showAsFolder,
        overrides: sectionMembers.folderOverrides,
      })
      .from(sectionMembers)
      .where(eq(sectionMembers.id, memberId))
  )[0];

describe("setIncludeFolder", () => {
  it("stores the switch and the overrides, and readMenuStructure answers them on the include", async () => {
    const f = await fixture();
    const folder = { showAsFolder: false, overrides: { names: { en: "Bar" } } };
    expect(await app((tx) => setIncludeFolder(tx, f.lunchRoot, f.include, folder))).toEqual(folder);
    expect(await storedRow(f.include)).toEqual(folder);
    const { nodes } = await app((tx) => readMenuStructure(tx, f.lunch));
    const drinks = nodes.find((node) => node.memberId === f.include)!;
    expect(drinks).toMatchObject({
      folder,
      internalName: "Drinks",
      names: { en: "Something to drink" },
      image: "drinks.jpg",
      color: "#445566",
    });
    const soup = nodes.find((node) => node.memberId === f.soupMember)!;
    expect("folder" in soup).toBe(false);
    const dinner = await app((tx) => readMenuStructure(tx, f.dinner));
    expect(dinner.nodes.find((node) => node.includedMenuId === f.drinksMenu)!.folder).toEqual({
      showAsFolder: true,
      overrides: {},
    });
    const mains = dinner.nodes.find((node) => node.ref.kind === "section" && !node.includedMenuId)!;
    expect("folder" in mains).toBe(false);
  });

  it("trims fixed names, keeps a blank one, and drops an empty map", async () => {
    const f = await fixture();
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
    );
    expect(
      await app((tx) =>
        setIncludeFolder(tx, f.lunchRoot, f.include, {
          showAsFolder: true,
          overrides: { names: { en: " Bar ", es: "  " }, color: "#112233" },
        }),
      ),
    ).toEqual({
      showAsFolder: true,
      overrides: { names: { en: "Bar", es: "" }, color: "#112233" },
    });
    expect(
      await app((tx) =>
        setIncludeFolder(tx, f.lunchRoot, f.include, {
          showAsFolder: true,
          overrides: { names: {}, image: null },
        }),
      ),
    ).toEqual({ showAsFolder: true, overrides: { image: null } });
    expect(await storedRow(f.include)).toEqual({ showAsFolder: true, overrides: { image: null } });
  });

  it("leaves the stored overrides alone when none are sent", async () => {
    const f = await fixture();
    const overrides = { names: { en: "Bar" }, color: "#112233" };
    await app((tx) =>
      setIncludeFolder(tx, f.lunchRoot, f.include, { showAsFolder: true, overrides }),
    );
    expect(
      await app((tx) => setIncludeFolder(tx, f.lunchRoot, f.include, { showAsFolder: false })),
    ).toEqual({ showAsFolder: false, overrides });
    expect(await storedRow(f.include)).toEqual({ showAsFolder: false, overrides });
  });

  it("refuses a member that is not an include", async () => {
    const f = await fixture();
    const off: IncludeFolderInput = { showAsFolder: false };
    const unknown = crypto.randomUUID();
    const { homeSectionId } = await app((tx) => readMenuHome(tx, f.lunch));
    const mainsMember = (await app((tx) => readMenuStructure(tx, f.dinner))).nodes.find(
      (node) => node.ref.kind === "section" && node.includedMenuId === undefined,
    )!.memberId;
    expect(
      await refusalOf(() => app((tx) => setIncludeFolder(tx, f.lunchRoot, f.soupMember, off))),
    ).toEqual({
      code: "menu_section.membership_invalid",
      params: {},
    });
    expect(
      await refusalOf(() => app((tx) => setIncludeFolder(tx, f.dinnerRoot, mainsMember, off))),
    ).toEqual({
      code: "menu_section.wrong_role",
      params: { sectionId: f.mains, role: "section" },
    });
    expect(
      await refusalOf(() => app((tx) => setIncludeFolder(tx, f.lunchRoot, unknown, off))),
    ).toEqual({
      code: "menu_section.not_found",
      params: { sectionId: f.lunchRoot, memberId: unknown },
    });
    expect(
      await refusalOf(() => app((tx) => setIncludeFolder(tx, f.dinnerRoot, f.include, off))),
    ).toEqual({
      code: "menu_section.not_found",
      params: { sectionId: f.dinnerRoot, memberId: f.include },
    });
    expect(
      await refusalOf(() => app((tx) => setIncludeFolder(tx, unknown, f.include, off))),
    ).toEqual({
      code: "menu_section.not_found",
      params: { sectionId: unknown },
    });
    expect(
      await refusalOf(() => app((tx) => setIncludeFolder(tx, homeSectionId, f.include, off))),
    ).toEqual({
      code: "menu_section.wrong_role",
      params: { sectionId: homeSectionId, role: "home_layout" },
    });
    expect(await storedRow(f.include)).toEqual({ showAsFolder: true, overrides: {} });
  });

  it("refuses effective names without the default language beside the names field", async () => {
    const f = await fixture();
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
    );
    expect(
      await refusalOf(() =>
        app((tx) =>
          setIncludeFolder(tx, f.lunchRoot, f.include, {
            showAsFolder: true,
            overrides: { names: { en: "", es: "Bebidas" } },
          }),
        ),
      ),
    ).toEqual({
      code: "menu_section.translation_required",
      params: { field: "names", language: "en" },
    });
    expect(await storedRow(f.include)).toEqual({ showAsFolder: true, overrides: {} });
    const accepted = { showAsFolder: true, overrides: { names: { es: "Bebidas" } } };
    expect(await app((tx) => setIncludeFolder(tx, f.lunchRoot, f.include, accepted))).toEqual(
      accepted,
    );
  });

  it("accepts a folder that fixes every name blank, which shows no name, as a section may", async () => {
    const f = await fixture();
    const blank = { showAsFolder: true, overrides: { names: { en: "" } } };
    expect(await app((tx) => setIncludeFolder(tx, f.lunchRoot, f.include, blank))).toEqual(blank);
  });

  it("refuses a bad colour, a photo not in the library, and names that are not text", async () => {
    const f = await fixture();
    const cases: [unknown, string][] = [
      [{ color: "#ABCDEF" }, "color"],
      [{ color: 5 }, "color"],
      [{ color: { hex: "#112233" } }, "color"],
      [{ image: "drinks.jpg" }, "image"],
      [{ image: 5 }, "image"],
      [{ image: true }, "image"],
      [{ names: { en: 7 } }, "names"],
      [{ names: "Bar" }, "names"],
      [{ names: ["Bar"] }, "names"],
      [{ names: null }, "names"],
      [{ names: { "not a language": "Bar" } }, "names"],
      [{ names: { EN: "Bar" } }, "names"],
      [{ names: { en: "Bar" }, note: "x" }, "overrides"],
      ["Bar", "overrides"],
      [null, "overrides"],
      [["Bar"], "overrides"],
    ];
    for (const [overrides, field] of cases)
      expect(
        await refusalOf(() =>
          app((tx) =>
            setIncludeFolder(tx, f.lunchRoot, f.include, {
              showAsFolder: true,
              overrides,
            } as IncludeFolderInput),
          ),
        ),
        JSON.stringify(overrides),
      ).toEqual({ code: "menu_section.invalid", params: { field } });
    for (const showAsFolder of ["no", 0, null, undefined])
      expect(
        await refusalOf(() =>
          app((tx) =>
            setIncludeFolder(tx, f.lunchRoot, f.include, {
              showAsFolder,
            } as unknown as IncludeFolderInput),
          ),
        ),
      ).toEqual({ code: "menu_section.invalid", params: { field: "showAsFolder" } });
    expect(await storedRow(f.include)).toEqual({ showAsFolder: true, overrides: {} });
  });

  it("does not change the included menu, or which menus reach the include", async () => {
    const f = await fixture();
    const offers = () =>
      fx.db.select().from(menuItems).orderBy(asc(menuItems.menuId), asc(menuItems.productId));
    const drinksBefore = await app((tx) => readMenuStructure(tx, f.drinksMenu));
    const offersBefore = await offers();
    await app((tx) =>
      setIncludeFolder(tx, f.lunchRoot, f.include, {
        showAsFolder: false,
        overrides: { names: { en: "Bar" }, image: null, color: "#112233" },
      }),
    );
    expect(await app((tx) => readMenuStructure(tx, f.drinksMenu))).toEqual(drinksBefore);
    expect(await offers()).toEqual(offersBefore);
  });
});
