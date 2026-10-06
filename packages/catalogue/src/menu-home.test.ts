import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, product, section, type MenusFixture } from "../test/menus-fixture.js";
import { HOME_DISPLAY_DEFAULTS } from "./device-home.js";
import {
  addShortcut,
  moveShortcut,
  readMenuHome,
  removeShortcut,
  replaceShortcut,
  setHomeDisplay,
} from "./menu-home.js";
import { buildMenuDocument } from "./menu-document.js";
import { membersOf } from "./section-members.js";
import { readSection } from "./sections.js";
import { menuStatus, previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import { deactivateCatalogue, deactivateProduct, listMenuOffers } from "./operations.js";
import { addMember, createSectionIn, deleteSection, removeMember } from "./sections.js";
import { menuDetails, menuItems } from "./schema/menu.js";
import { sectionMembers, sections } from "./schema/sections.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const MISSING = "00000000-0000-4000-8000-000000000000";

async function codeOf(fn: () => Promise<unknown>): Promise<unknown> {
  return ((await captureError(fn)) as { code?: unknown }).code;
}

const homeOf = async (menuId: string) =>
  (await app((tx) => readMenuHome(tx, menuId))).homeSectionId;

async function tileRefs(sectionId: string) {
  const rows = await fx.db
    .select()
    .from(sectionMembers)
    .where(eq(sectionMembers.sectionId, sectionId))
    .orderBy(asc(sectionMembers.position), asc(sectionMembers.id));
  return rows.map((row) => ({
    position: row.position,
    ref: row.productId === null ? section(row.childSectionId!) : product(row.productId),
  }));
}

/** A second `home_layout` section the menu owns, as a development venue's named layout left it. */
async function leftoverLayout(menuId: string, productId?: string): Promise<string> {
  const [row] = await fx.db
    .insert(sections)
    .values({ internalName: "Counter", role: "home_layout", ownerMenuId: menuId })
    .returning({ id: sections.id });
  if (productId !== undefined)
    await fx.db.insert(sectionMembers).values({ sectionId: row!.id, position: 0, productId });
  return row!.id;
}

async function displayRow(menuId: string) {
  const [row] = await fx.db.select().from(menuDetails).where(eq(menuDetails.menuId, menuId));
  return row!;
}

describe("the Device Home Page", () => {
  it("reads the menu's Device Home Page: its section, its shortcuts in order with names and reach, and both display settings at their defaults", async () => {
    const f = await menusFixture(fx.db);
    const { homeSectionId } = await displayRow(f.lunch);
    const [owned] = await fx.db.select().from(sections).where(eq(sections.id, homeSectionId));
    expect(owned).toMatchObject({ role: "home_layout", ownerMenuId: f.lunch });
    const soup = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    const drinks = await app((tx) => addShortcut(tx, f.lunch, section(f.drinks)));
    const [rootSoup] = await fx.db
      .select({ id: sectionMembers.id })
      .from(sectionMembers)
      .where(and(eq(sectionMembers.sectionId, f.lunchRoot), eq(sectionMembers.productId, f.soup)));
    await app((tx) => removeMember(tx, f.lunchRoot, rootSoup!.id));
    // The staff name and the internal name, never the customer-facing ones.
    expect(await app((tx) => readMenuHome(tx, f.lunch))).toEqual({
      homeSectionId,
      shortcuts: [
        {
          memberId: soup.id,
          position: 0,
          ref: product(f.soup),
          name: "Soup",
          reachable: false,
          missingName: "Soup",
        },
        {
          memberId: drinks.id,
          position: 1,
          ref: section(f.drinks),
          name: "Drinks",
          reachable: true,
          missingName: null,
        },
      ],
      handheld: HOME_DISPLAY_DEFAULTS.handheld,
      till: HOME_DISPLAY_DEFAULTS.till,
    });
    await app((tx) => addMember(tx, f.lunchRoot, product(f.soup)));
    expect((await app((tx) => readMenuHome(tx, f.lunch))).shortcuts[0]!.reachable).toBe(true);
  });

  it("reads only the menu's own home section", async () => {
    const f = await menusFixture(fx.db);
    const leftover = await leftoverLayout(f.lunch, f.lemonade);
    const home = await homeOf(f.lunch);
    expect(home).not.toBe(leftover);
    const soup = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, section(f.beer), 0));
    await app((tx) => moveShortcut(tx, f.lunch, soup.id, 0));
    await app((tx) => replaceShortcut(tx, f.lunch, soup.id, product(f.lager)));
    expect((await app((tx) => readMenuHome(tx, f.lunch))).shortcuts.map((t) => t.ref)).toEqual([
      product(f.lager),
      section(f.beer),
    ]);
    const { document } = await app((tx) => buildMenuDocument(tx, f.lunch));
    expect(document.home.shortcuts).toEqual([product(f.lager), section(f.beer)]);
    const [held] = await fx.db
      .select({ id: sectionMembers.id })
      .from(sectionMembers)
      .where(eq(sectionMembers.sectionId, leftover));
    for (const write of [
      () => app((tx) => removeShortcut(tx, f.lunch, held!.id)),
      () => app((tx) => moveShortcut(tx, f.lunch, held!.id, 0)),
      () => app((tx) => replaceShortcut(tx, f.lunch, held!.id, product(f.soup))),
    ])
      expect(await codeOf(write)).toBe("menu_section.not_found");
    await app((tx) => removeShortcut(tx, f.lunch, soup.id));
    expect(await tileRefs(leftover)).toEqual([{ position: 0, ref: product(f.lemonade) }]);
    expect(await tileRefs(home)).toEqual([{ position: 0, ref: section(f.beer) }]);
  });

  it("refuses a menu that does not exist", async () => {
    const f = await menusFixture(fx.db);
    const member = (await app((tx) => addShortcut(tx, f.lunch, product(f.soup)))).id;
    const calls: (() => Promise<unknown>)[] = [
      () => app((tx) => readMenuHome(tx, MISSING)),
      () => app((tx) => setHomeDisplay(tx, MISSING, "till", { columns: 8 })),
      () => app((tx) => addShortcut(tx, MISSING, product(f.soup))),
      () => app((tx) => replaceShortcut(tx, MISSING, member, product(f.lager))),
      () => app((tx) => removeShortcut(tx, MISSING, member)),
      () => app((tx) => moveShortcut(tx, MISSING, member, 0)),
    ];
    for (const call of calls)
      expect(await captureError(call)).toMatchObject({
        code: "catalogue.not_found",
        params: { catalogueId: MISSING },
      });
    expect(await tileRefs(await homeOf(f.lunch))).toEqual([{ position: 0, ref: product(f.soup) }]);
  });
});

describe("setHomeDisplay", () => {
  it("stores each setting for its device alone", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => setHomeDisplay(tx, f.lunch, "till", { columns: 8, order: "menu_first" }));
    const once = await app((tx) => readMenuHome(tx, f.lunch));
    expect(once.till).toEqual({ columns: 8, tiles: "colours", order: "menu_first" });
    expect(once.handheld).toEqual(HOME_DISPLAY_DEFAULTS.handheld);
    await app((tx) => setHomeDisplay(tx, f.lunch, "handheld", { tiles: "thumbnails" }));
    const twice = await app((tx) => readMenuHome(tx, f.lunch));
    expect(twice.handheld).toEqual({ columns: 3, tiles: "thumbnails", order: "home_first" });
    expect(twice.till).toEqual({ columns: 8, tiles: "colours", order: "menu_first" });
    await app((tx) => setHomeDisplay(tx, f.lunch, "till", {}));
    expect((await app((tx) => readMenuHome(tx, f.lunch))).till).toEqual(twice.till);
    expect((await app((tx) => readMenuHome(tx, f.dinner))).till).toEqual(
      HOME_DISPLAY_DEFAULTS.till,
    );
  });

  it("refuses a value its device cannot take, writing nothing", async () => {
    const f = await menusFixture(fx.db);
    const before = await displayRow(f.lunch);
    const refusals: ["handheld" | "till", Record<string, unknown>, string][] = [
      ["handheld", { columns: 1 }, "columns"],
      ["handheld", { columns: 7 }, "columns"],
      ["till", { columns: 5 }, "columns"],
      ["till", { columns: 11 }, "columns"],
      ["till", { columns: 6.5 }, "columns"],
      ["till", { columns: "8" }, "columns"],
      ["handheld", { tiles: "pictures" }, "tiles"],
      ["till", { tiles: "pictures" }, "tiles"],
      ["handheld", { order: "first" }, "order"],
      ["till", { order: "first" }, "order"],
      ["till", { columns: 8, tiles: "pictures" }, "tiles"],
    ];
    for (const [device, patch, field] of refusals)
      expect(
        await captureError(() => app((tx) => setHomeDisplay(tx, f.lunch, device, patch))),
      ).toMatchObject({ code: "menu.home_display_invalid", params: { device, field } });
    expect(await displayRow(f.lunch)).toEqual(before);
  });

  it("accepts each range's ends", async () => {
    const f = await menusFixture(fx.db);
    for (const [device, columns] of [
      ["handheld", 2],
      ["handheld", 6],
      ["till", 6],
      ["till", 10],
    ] as const) {
      await app((tx) => setHomeDisplay(tx, f.lunch, device, { columns }));
      expect((await app((tx) => readMenuHome(tx, f.lunch)))[device].columns).toBe(columns);
    }
  });
});

describe("home tiles", () => {
  it("keeps deleted subsection tiles in every menu's Device Home Page with their owned paths", async () => {
    const f = await menusFixture(fx.db);
    const nested = await app((tx) => createSectionIn(tx, f.beer, { internalName: "Bottles" }));
    await app(async (tx) => {
      await addShortcut(tx, f.lunch, product(f.lemonade));
      await addShortcut(tx, f.lunch, section(f.beer));
      await addShortcut(tx, f.lunch, product(f.soup));
      await addShortcut(tx, f.lunch, section(nested.id));
      await addShortcut(tx, f.dinner, section(nested.id));
      await addShortcut(tx, f.dinner, section(f.beer));
    });
    const [dinnerInclusion] = await fx.db
      .select()
      .from(sectionMembers)
      .where(
        and(
          eq(sectionMembers.sectionId, f.dinnerRoot),
          eq(sectionMembers.childSectionId, f.drinks),
        ),
      );
    await app((tx) => removeMember(tx, f.dinnerRoot, dinnerInclusion!.id));
    const shortcutsOf = async (menuId: string) =>
      (await app((tx) => readMenuHome(tx, menuId))).shortcuts;
    const otherBefore = (await shortcutsOf(f.dinner)).map((t) => [t.memberId, t.position]);
    const before = (await shortcutsOf(f.lunch)).map((t) => [t.memberId, t.position]);
    await app((tx) => deleteSection(tx, f.beer));
    const shortcuts = await shortcutsOf(f.lunch);
    expect(shortcuts.map((t) => [t.memberId, t.position])).toEqual(before);
    expect(shortcuts.map((t) => [t.position, t.ref, t.missingName, t.reachable])).toEqual([
      [0, product(f.lemonade), null, true],
      [1, { kind: "missing", name: "Drinks › Beer" }, "Drinks › Beer", false],
      [2, product(f.soup), null, true],
      [3, { kind: "missing", name: "Drinks › Beer › Bottles" }, "Drinks › Beer › Bottles", false],
    ]);
    expect((await shortcutsOf(f.dinner)).map((t) => [t.memberId, t.position])).toEqual(otherBefore);
    expect((await shortcutsOf(f.dinner)).map((t) => t.missingName)).toEqual([
      "Drinks › Beer › Bottles",
      "Drinks › Beer",
    ]);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.document.home.shortcuts).toEqual([
      product(f.lemonade),
      { kind: "empty" },
      product(f.soup),
      { kind: "empty" },
    ]);
    expect(
      (await app((tx) => listMenuOffers(tx, [f.lunch]))).map((offer) => offer.productId).sort(),
    ).toEqual([f.lemonade, f.soup].sort());
    expect(preview.warnings).toEqual([
      { kind: "shortcut_missing", name: "Drinks › Beer" },
      { kind: "shortcut_missing", name: "Drinks › Beer › Bottles" },
    ]);
  });

  it("moves, replaces and removes missing tiles without losing their positions", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    await app((tx) => addShortcut(tx, f.lunch, product(f.lemonade)));
    const beer = await app((tx) => addShortcut(tx, f.lunch, section(f.beer)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => deleteSection(tx, f.beer));
    expect(
      (await app((tx) => membersOf(tx, home, "home_layout"))).map((member) => member.ref),
    ).toEqual([product(f.lemonade), { kind: "missing", name: "Drinks › Beer" }, product(f.soup)]);
    expect((await app((tx) => readSection(tx, home))).members.map((member) => member.ref)).toEqual([
      product(f.lemonade),
      product(f.soup),
    ]);
    const read = async () => (await app((tx) => readMenuHome(tx, f.lunch))).shortcuts;
    const moved = await app((tx) => moveShortcut(tx, f.lunch, beer.id, 2));
    expect(moved.map((t) => [t.position, t.ref])).toEqual([
      [0, product(f.lemonade)],
      [1, product(f.soup)],
      [2, { kind: "missing", name: "Drinks › Beer" }],
    ]);
    const replaced = await app((tx) => replaceShortcut(tx, f.lunch, beer.id, section(f.drinks)));
    expect(replaced).toEqual({ id: beer.id, position: 2, ref: section(f.drinks) });
    expect((await read())[2]!.missingName).toBeNull();
    const wine = await app((tx) => createSectionIn(tx, f.drinks, { internalName: "Wine" }));
    await app((tx) => addShortcut(tx, f.lunch, section(wine.id)));
    await app((tx) => deleteSection(tx, wine.id));
    const missing = (await read())[3]!;
    expect(missing.ref).toEqual({ kind: "missing", name: "Drinks › Wine" });
    await app((tx) => removeShortcut(tx, f.lunch, missing.memberId));
    expect((await read()).map((t) => [t.position, t.ref])).toEqual([
      [0, product(f.lemonade)],
      [1, product(f.soup)],
      [2, section(f.drinks)],
    ]);
  });

  it("retains existing section targets with the owning menu path when an inclusion is removed", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, section(f.beer)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    const [edge] = await fx.db
      .select()
      .from(sectionMembers)
      .where(
        and(eq(sectionMembers.sectionId, f.lunchRoot), eq(sectionMembers.childSectionId, f.drinks)),
      );
    await app((tx) => removeMember(tx, f.lunchRoot, edge!.id));
    const { shortcuts } = await app((tx) => readMenuHome(tx, f.lunch));
    expect(shortcuts.map((t) => [t.ref, t.missingName, t.reachable])).toEqual([
      [section(f.beer), "Drinks › Beer", false],
      [product(f.lager), "Lager", false],
    ]);
    expect((await app((tx) => previewMenu(tx, f.lunch))).document.home.shortcuts).toEqual([
      { kind: "empty" },
      { kind: "empty" },
    ]);
    await app((tx) => addMember(tx, f.lunchRoot, section(f.drinks)));
    expect(
      (await app((tx) => readMenuHome(tx, f.lunch))).shortcuts.map((t) => t.missingName),
    ).toEqual([null, null]);
  });

  it("keeps structural shortcuts through an inactive inclusion but publishes empty slots", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, section(f.drinks)));
    await app((tx) => addShortcut(tx, f.lunch, section(f.beer)));
    expect((await app((tx) => previewMenu(tx, f.lunch))).document.home.shortcuts).toEqual([
      section(f.drinks),
      section(f.beer),
    ]);
    await app((tx) => deactivateCatalogue(tx, f.drinksMenu));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    const { shortcuts } = await app((tx) => readMenuHome(tx, f.lunch));
    expect(shortcuts.every((t) => t.reachable && t.missingName === null)).toBe(true);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.document.home.shortcuts).toEqual([
      { kind: "empty" },
      { kind: "empty" },
      { kind: "empty" },
    ]);
    expect(preview.warnings.map((w) => w.name)).toEqual(["Drinks", "Beer", "Lager"]);
  });

  it("refuses unreachable, duplicate, missing and variant replacements without changing the tile", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    const tile = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lemonade)));
    for (const [ref, code] of [
      [product(f.burger), "menu.shortcut_unreachable"],
      [product(f.lemonade), "menu_section.member_duplicate"],
      [section(MISSING), "menu_section.not_found"],
      [product(f.large), "menu_section.membership_invalid"],
    ] as const) {
      expect(await codeOf(() => app((tx) => replaceShortcut(tx, f.lunch, tile.id, ref)))).toBe(
        code,
      );
    }
    expect(
      await codeOf(() => app((tx) => replaceShortcut(tx, f.lunch, MISSING, product(f.soup)))),
    ).toBe("menu_section.not_found");
    expect(await tileRefs(home)).toEqual([
      { position: 0, ref: product(f.soup) },
      { position: 1, ref: product(f.lemonade) },
    ]);
    expect(await app((tx) => replaceShortcut(tx, f.lunch, tile.id, product(f.soup)))).toEqual(tile);
  });

  it("accepts a product or included menu section the menu reaches, however deep", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    const lager = await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    expect(lager).toMatchObject({ position: 0, ref: product(f.lager) });
    const beer = await app((tx) => addShortcut(tx, f.lunch, section(f.beer)));
    expect(beer).toMatchObject({ position: 1, ref: section(f.beer) });
    const first = await app((tx) => addShortcut(tx, f.lunch, product(f.soup), 0));
    expect(first.position).toBe(0);
    expect(await tileRefs(home)).toEqual([
      { position: 0, ref: product(f.soup) },
      { position: 1, ref: product(f.lager) },
      { position: 2, ref: section(f.beer) },
    ]);
  });

  it("refuses a product or included menu section the menu does not reach", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    for (const ref of [product(f.burger), section(f.mains)]) {
      const refused = await captureError(() => app((tx) => addShortcut(tx, f.lunch, ref)));
      expect(refused).toMatchObject({ code: "menu.shortcut_unreachable", params: { ref } });
    }
    expect(await tileRefs(home)).toEqual([]);
  });

  it("accepts an Inactive product the menu places, and publishing keeps an empty slot with a warning", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => deactivateProduct(tx, f.soup));
    const tile = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    expect(tile.ref).toEqual(product(f.soup));
    const { shortcuts } = await app((tx) => readMenuHome(tx, f.lunch));
    expect(shortcuts).toMatchObject([{ ref: product(f.soup), reachable: true }]);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.warnings).toEqual([{ kind: "shortcut_missing", name: "Soup" }]);
    expect(preview.document.home.shortcuts).toEqual([{ kind: "empty" }]);
  });

  it("accepts product tiles on an inactive menu, reached by its structure", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => deactivateCatalogue(tx, f.lunch));
    await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    const { shortcuts } = await app((tx) => readMenuHome(tx, f.lunch));
    expect(shortcuts.map(({ ref, reachable }) => [ref, reachable])).toEqual([
      [product(f.soup), true],
      [product(f.lager), true],
    ]);
    expect((await app((tx) => previewMenu(tx, f.lunch))).warnings).toEqual([
      { kind: "shortcut_missing", name: "Soup" },
      { kind: "shortcut_missing", name: "Lager" },
    ]);
  });

  it("accepts an inactive product the structure reaches", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => deactivateProduct(tx, f.lager));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    const { shortcuts } = await app((tx) => readMenuHome(tx, f.lunch));
    expect(shortcuts).toMatchObject([{ ref: product(f.lager), reachable: true }]);
    expect((await app((tx) => previewMenu(tx, f.lunch))).warnings).toEqual([
      { kind: "shortcut_missing", name: "Lager" },
    ]);
  });

  it("refuses unreachable menu roots and home sections as tiles", async () => {
    const f = await menusFixture(fx.db);
    const leftover = await leftoverLayout(f.lunch);
    const dinnerHome = await homeOf(f.dinner);
    const lunchHome = await homeOf(f.lunch);
    for (const owned of [f.lunchRoot, leftover, f.dinnerRoot, dinnerHome, lunchHome]) {
      const refused = await captureError(() =>
        app((tx) => addShortcut(tx, f.lunch, section(owned))),
      );
      expect(refused).toMatchObject({
        code: [f.lunchRoot, f.dinnerRoot].includes(owned)
          ? "menu.shortcut_unreachable"
          : "menu_section.wrong_role",
      });
    }
  });

  it("refuses a repeated tile, a section that does not exist, and a variant", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    expect(await codeOf(() => app((tx) => addShortcut(tx, f.lunch, product(f.soup))))).toBe(
      "menu_section.member_duplicate",
    );
    expect(await codeOf(() => app((tx) => addShortcut(tx, f.lunch, section(MISSING))))).toBe(
      "menu_section.not_found",
    );
    expect(await codeOf(() => app((tx) => addShortcut(tx, f.lunch, product(f.large))))).toBe(
      "menu_section.membership_invalid",
    );
    expect(await codeOf(() => app((tx) => addShortcut(tx, f.lunch, product(f.soup), -1)))).toBe(
      "menu_section.invalid",
    );
    expect(await codeOf(() => app((tx) => addShortcut(tx, f.lunch, product(f.lager), 0.5)))).toBe(
      "menu_section.invalid",
    );
  });

  it("adds no menu item or offer, and removing a tile removes only the tile (spec §5)", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    const itemsBefore = await fx.db.select().from(menuItems).orderBy(asc(menuItems.id));
    const offersBefore = await app((tx) => listMenuOffers(tx, [f.lunch]));
    const soup = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, section(f.drinks)));
    expect(await fx.db.select().from(menuItems).orderBy(asc(menuItems.id))).toEqual(itemsBefore);
    expect(await app((tx) => listMenuOffers(tx, [f.lunch]))).toEqual(offersBefore);
    const rootBefore = await tileRefs(f.lunchRoot);
    await app((tx) => removeShortcut(tx, f.lunch, soup.id));
    expect(await tileRefs(home)).toEqual([{ position: 0, ref: section(f.drinks) }]);
    expect(await tileRefs(f.lunchRoot)).toEqual(rootBefore);
    expect(await fx.db.select().from(menuItems).orderBy(asc(menuItems.id))).toEqual(itemsBefore);
    expect(await app((tx) => listMenuOffers(tx, [f.lunch]))).toEqual(offersBefore);
  });

  it("removes a tile and closes the gap, and refuses a member the Device Home Page does not hold", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    const soup = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    await app((tx) => removeShortcut(tx, f.lunch, soup.id));
    expect(await tileRefs(home)).toEqual([{ position: 0, ref: product(f.lager) }]);
    const refused = await captureError(() => app((tx) => removeShortcut(tx, f.lunch, soup.id)));
    expect(refused).toMatchObject({
      code: "menu_section.not_found",
      params: { sectionId: home, memberId: soup.id },
    });
  });

  it("moves a tile to an index, past the end meaning last, and refuses a bad index", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    const soup = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    await app((tx) => addShortcut(tx, f.lunch, section(f.beer)));
    const moved = await app((tx) => moveShortcut(tx, f.lunch, soup.id, 1));
    expect(moved.map((member) => [member.position, member.ref])).toEqual([
      [0, product(f.lager)],
      [1, product(f.soup)],
      [2, section(f.beer)],
    ]);
    await app((tx) => moveShortcut(tx, f.lunch, soup.id, 99));
    expect((await tileRefs(home)).map((tile) => tile.ref)).toEqual([
      product(f.lager),
      section(f.beer),
      product(f.soup),
    ]);
    for (const to of [-1, 1.5])
      expect(await codeOf(() => app((tx) => moveShortcut(tx, f.lunch, soup.id, to)))).toBe(
        "menu_section.invalid",
      );
    expect(await codeOf(() => app((tx) => moveShortcut(tx, f.lunch, MISSING, 0)))).toBe(
      "menu_section.not_found",
    );
  });
});

describe("publishing the Device Home Page", () => {
  async function publish(menuId: string) {
    const { hash } = await app((tx) => previewMenu(tx, menuId));
    await app((tx) => publishMenu(tx, menuId, hash, "person-1"));
  }

  it("carries the shortcuts in order and both devices' display settings", async () => {
    const f: MenusFixture = await menusFixture(fx.db);
    await app(async (tx) => {
      await addShortcut(tx, f.lunch, section(f.beer));
      await addShortcut(tx, f.lunch, product(f.soup));
      await setHomeDisplay(tx, f.lunch, "till", { columns: 8, order: "menu_first" });
    });
    const { document } = await app((tx) => previewMenu(tx, f.lunch));
    expect(document.home).toEqual({
      shortcuts: [section(f.beer), product(f.soup)],
      handheld: HOME_DISPLAY_DEFAULTS.handheld,
      till: { columns: 8, tiles: "colours", order: "menu_first" },
    });
  });

  it("flags the menu changed on a shortcut edit or a display change, and current again when each is undone", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lemonade)));
    await publish(f.lunch);
    const state = async () => (await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch)!.state;
    expect(await state()).toBe("current");
    const lager = await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    expect(await state()).toBe("changed");
    await app((tx) => removeShortcut(tx, f.lunch, lager.id));
    expect(await state()).toBe("current");
    const [soup] = (await app((tx) => readMenuHome(tx, f.lunch))).shortcuts;
    await app((tx) => moveShortcut(tx, f.lunch, soup!.memberId, 1));
    expect(await state()).toBe("changed");
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "home_shortcuts_changed",
        source: "this_menu",
        id: JSON.stringify([
          f.lunch,
          "home_shortcuts_changed",
          "this_menu",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          ['["home","handheld","shortcuts"]', '["home","till","shortcuts"]'],
          ['["home","handheld","shortcuts"]', '["home","till","shortcuts"]'],
        ]),
        targets: {
          before: [
            { kind: "home", device: "handheld", field: "shortcuts" },
            { kind: "home", device: "till", field: "shortcuts" },
          ],
          after: [
            { kind: "home", device: "handheld", field: "shortcuts" },
            { kind: "home", device: "till", field: "shortcuts" },
          ],
        },
      },
    ]);
    await app((tx) => moveShortcut(tx, f.lunch, soup!.memberId, 0));
    expect(await state()).toBe("current");
    await app((tx) => setHomeDisplay(tx, f.lunch, "till", { columns: 7 }));
    expect(await state()).toBe("changed");
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "home_display_changed",
        device: "till",
        source: "this_menu",
        id: JSON.stringify([
          f.lunch,
          "home_display_changed",
          "this_menu",
          null,
          null,
          null,
          null,
          null,
          null,
          "till",
          null,
          ['["home","till","columns"]'],
          ['["home","till","columns"]'],
        ]),
        targets: {
          before: [{ kind: "home", device: "till", field: "columns" }],
          after: [{ kind: "home", device: "till", field: "columns" }],
        },
      },
    ]);
    await app((tx) => setHomeDisplay(tx, f.lunch, "till", { columns: 6 }));
    expect(await state()).toBe("current");
    // Dinner's status is untouched by Lunch's Device Home Page.
    await publish(f.dinner);
    await app((tx) => moveShortcut(tx, f.lunch, soup!.memberId, 1));
    await app((tx) => setHomeDisplay(tx, f.lunch, "handheld", { order: "menu_first" }));
    expect((await app((tx) => menuStatus(tx, [f.dinner]))).get(f.dinner)!.state).toBe("current");
  });

  it("a draft display change leaves the live version as it was", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) => setHomeDisplay(tx, f.lunch, "till", { columns: 9 }));
    const liveTill = async () =>
      (await app((tx) => readLiveDocuments(tx, [f.lunch]))).get(f.lunch)!.document.home.till;
    expect((await liveTill()).columns).toBe(6);
    expect((await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch)!.state).toBe("changed");
    await publish(f.lunch);
    expect((await liveTill()).columns).toBe(9);
  });
});
