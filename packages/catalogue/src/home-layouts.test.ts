import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, product, section, type MenusFixture } from "../test/menus-fixture.js";
import {
  addShortcut,
  createHomeLayout,
  deleteHomeLayout,
  duplicateHomeLayout,
  listHomeLayouts,
  moveShortcut,
  removeShortcut,
  replaceShortcut,
  renameHomeLayout,
  setDefaultHomeLayout,
} from "./home-layouts.js";
import { membersOf } from "./section-members.js";
import { readSection } from "./sections.js";
import { menuStatus, previewMenu, publishMenu } from "./menu-publication.js";
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

async function defaultLayout(menuId: string): Promise<string> {
  const [row] = await fx.db
    .select({ id: menuDetails.defaultHomeLayoutId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  return row!.id;
}

async function tileRefs(layoutId: string) {
  const rows = await fx.db
    .select()
    .from(sectionMembers)
    .where(eq(sectionMembers.sectionId, layoutId))
    .orderBy(asc(sectionMembers.position), asc(sectionMembers.id));
  return rows.map((row) => ({
    position: row.position,
    ref: row.productId === null ? section(row.childSectionId!) : product(row.productId),
  }));
}

describe("home layouts", () => {
  it("lists a menu's layouts, the default first and marked, then the others by name", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const counter = await app((tx) => createHomeLayout(tx, f.lunch, "  Counter  "));
    const bar = await app((tx) => createHomeLayout(tx, f.lunch, "Bar"));
    await app((tx) => createHomeLayout(tx, f.dinner, "Dinner only"));
    const layouts = await app((tx) => listHomeLayouts(tx, f.lunch));
    expect(layouts.map(({ id, name, isDefault }) => ({ id, name, isDefault }))).toEqual([
      { id: home, name: "Home", isDefault: true },
      { id: bar.id, name: "Bar", isDefault: false },
      { id: counter.id, name: "Counter", isDefault: false },
    ]);
    const [row] = await fx.db.select().from(sections).where(eq(sections.id, counter.id));
    expect(row).toMatchObject({ role: "home_layout", ownerMenuId: f.lunch });
  });

  it("refuses a blank name, and a menu that does not exist", async () => {
    const f = await menusFixture(fx.db);
    expect(await codeOf(() => app((tx) => createHomeLayout(tx, f.lunch, "  ")))).toBe(
      "menu_section.invalid",
    );
    const blank = await captureError(() => app((tx) => createHomeLayout(tx, f.lunch, "")));
    expect(blank).toMatchObject({ params: { field: "name" } });
    expect(await codeOf(() => app((tx) => createHomeLayout(tx, MISSING, "Bar")))).toBe(
      "catalogue.not_found",
    );
    expect(await codeOf(() => app((tx) => listHomeLayouts(tx, MISSING)))).toBe(
      "catalogue.not_found",
    );
  });

  it("duplicates a layout with its tiles in order, and the copy is edited on its own", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app(async (tx) => {
      await addShortcut(tx, home, product(f.soup));
      await addShortcut(tx, home, section(f.beer));
      await addShortcut(tx, home, product(f.lemonade));
    });
    const copy = await app((tx) => duplicateHomeLayout(tx, home, "Counter"));
    expect(copy.id).not.toBe(home);
    const expected = [
      { position: 0, ref: product(f.soup) },
      { position: 1, ref: section(f.beer) },
      { position: 2, ref: product(f.lemonade) },
    ];
    expect(await tileRefs(copy.id)).toEqual(expected);
    const [row] = await fx.db.select().from(sections).where(eq(sections.id, copy.id));
    expect(row).toMatchObject({
      internalName: "Counter",
      role: "home_layout",
      ownerMenuId: f.lunch,
    });
    const [first] = (await app((tx) => listHomeLayouts(tx, f.lunch)))[1]!.tiles;
    await app((tx) => removeShortcut(tx, copy.id, first!.memberId));
    expect(await tileRefs(home)).toEqual(expected);
    expect(await codeOf(() => app((tx) => duplicateHomeLayout(tx, home, " ")))).toBe(
      "menu_section.invalid",
    );
  });

  it("renames a layout, and refuses a blank name", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => renameHomeLayout(tx, home, " Table service "));
    expect((await app((tx) => listHomeLayouts(tx, f.lunch)))[0]!.name).toBe("Table service");
    expect(await codeOf(() => app((tx) => renameHomeLayout(tx, home, "")))).toBe(
      "menu_section.invalid",
    );
  });

  it("deletes a layout and its tiles, and refuses the default", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const counter = await app((tx) => createHomeLayout(tx, f.lunch, "Counter"));
    await app((tx) => addShortcut(tx, counter.id, product(f.soup)));
    await app((tx) => deleteHomeLayout(tx, counter.id));
    expect(await fx.db.select().from(sections).where(eq(sections.id, counter.id))).toEqual([]);
    expect(await tileRefs(counter.id)).toEqual([]);
    const refused = await captureError(() => app((tx) => deleteHomeLayout(tx, home)));
    expect(refused).toMatchObject({
      code: "menu.default_layout_required",
      params: { layoutId: home },
    });
    expect(await fx.db.select().from(sections).where(eq(sections.id, home))).toHaveLength(1);
  });

  it("makes another layout the default, after which the old default can be deleted", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const counter = await app((tx) => createHomeLayout(tx, f.lunch, "Counter"));
    await app((tx) => setDefaultHomeLayout(tx, f.lunch, counter.id));
    expect(await defaultLayout(f.lunch)).toBe(counter.id);
    const layouts = await app((tx) => listHomeLayouts(tx, f.lunch));
    expect(layouts.map((layout) => [layout.name, layout.isDefault])).toEqual([
      ["Counter", true],
      ["Home", false],
    ]);
    await app((tx) => deleteHomeLayout(tx, home));
    const dinnerHome = await defaultLayout(f.dinner);
    expect(await codeOf(() => app((tx) => setDefaultHomeLayout(tx, f.lunch, dinnerHome)))).toBe(
      "menu.layout_not_found",
    );
    expect(await codeOf(() => app((tx) => setDefaultHomeLayout(tx, MISSING, dinnerHome)))).toBe(
      "catalogue.not_found",
    );
  });

  it("refuses, in every layout write, an id that names no home layout", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const member = (await app((tx) => addShortcut(tx, home, product(f.soup)))).id;
    for (const notALayout of [MISSING, f.lunchRoot, f.drinks]) {
      const writes: (() => Promise<unknown>)[] = [
        () => app((tx) => duplicateHomeLayout(tx, notALayout, "Copy")),
        () => app((tx) => renameHomeLayout(tx, notALayout, "Renamed")),
        () => app((tx) => deleteHomeLayout(tx, notALayout)),
        () => app((tx) => setDefaultHomeLayout(tx, f.lunch, notALayout)),
        () => app((tx) => addShortcut(tx, notALayout, product(f.soup))),
        () => app((tx) => removeShortcut(tx, notALayout, member)),
        () => app((tx) => moveShortcut(tx, notALayout, member, 0)),
      ];
      for (const write of writes) {
        const refused = await captureError(write);
        expect(refused).toMatchObject({
          code: "menu.layout_not_found",
          params: { layoutId: notALayout },
        });
      }
    }
    expect(await fx.db.select().from(sections).where(eq(sections.id, f.drinks))).toMatchObject([
      { internalName: "Drinks" },
    ]);
  });
});

describe("home tiles", () => {
  it("keeps deleted subsection tiles in every menu's layout with their owned paths", async () => {
    const f = await menusFixture(fx.db);
    const nested = await app((tx) => createSectionIn(tx, f.beer, { internalName: "Bottles" }));
    const home = await defaultLayout(f.lunch);
    const other = await defaultLayout(f.dinner);
    await app(async (tx) => {
      await addShortcut(tx, home, product(f.lemonade));
      await addShortcut(tx, home, section(f.beer));
      await addShortcut(tx, home, product(f.soup));
      await addShortcut(tx, home, section(nested.id));
      await addShortcut(tx, other, section(nested.id));
      await addShortcut(tx, other, section(f.beer));
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
    const otherBefore = (await app((tx) => listHomeLayouts(tx, f.dinner)))[0]!.tiles.map((t) => [
      t.memberId,
      t.position,
    ]);
    const before = (await app((tx) => listHomeLayouts(tx, f.lunch)))[0]!.tiles.map((t) => [
      t.memberId,
      t.position,
    ]);
    await app((tx) => deleteSection(tx, f.beer));
    const [layout] = await app((tx) => listHomeLayouts(tx, f.lunch));
    expect(layout!.tiles.map((t) => [t.memberId, t.position])).toEqual(before);
    expect(layout!.tiles.map((t) => [t.position, t.ref, t.missingName, t.reachable])).toEqual([
      [0, product(f.lemonade), null, true],
      [1, { kind: "missing", name: "Drinks › Beer" }, "Drinks › Beer", false],
      [2, product(f.soup), null, true],
      [3, { kind: "missing", name: "Drinks › Beer › Bottles" }, "Drinks › Beer › Bottles", false],
    ]);
    expect(
      (await app((tx) => listHomeLayouts(tx, f.dinner)))[0]!.tiles.map((t) => [
        t.memberId,
        t.position,
      ]),
    ).toEqual(otherBefore);
    expect(
      (await app((tx) => listHomeLayouts(tx, f.dinner)))[0]!.tiles.map((t) => t.missingName),
    ).toEqual(["Drinks › Beer › Bottles", "Drinks › Beer"]);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.document.homeLayouts[0]!.tiles).toEqual([
      product(f.lemonade),
      { kind: "empty" },
      product(f.soup),
      { kind: "empty" },
    ]);
    expect(
      (await app((tx) => listMenuOffers(tx, [f.lunch]))).map((offer) => offer.productId).sort(),
    ).toEqual([f.lemonade, f.soup].sort());
    expect(preview.warnings).toEqual([
      { kind: "shortcut_missing", layoutName: "Home", name: "Drinks › Beer" },
      { kind: "shortcut_missing", layoutName: "Home", name: "Drinks › Beer › Bottles" },
    ]);
  });

  it("duplicates, moves, replaces and removes missing tiles without losing their positions", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => addShortcut(tx, home, product(f.lemonade)));
    const beer = await app((tx) => addShortcut(tx, home, section(f.beer)));
    await app((tx) => addShortcut(tx, home, product(f.soup)));
    await app((tx) => deleteSection(tx, f.beer));
    expect(
      (await app((tx) => membersOf(tx, home, "home_layout"))).map((member) => member.ref),
    ).toEqual([product(f.lemonade), { kind: "missing", name: "Drinks › Beer" }, product(f.soup)]);
    expect((await app((tx) => readSection(tx, home))).members.map((member) => member.ref)).toEqual([
      product(f.lemonade),
      product(f.soup),
    ]);
    const copy = await app((tx) => duplicateHomeLayout(tx, home, "Copy"));
    const read = async (id: string) =>
      (await app((tx) => listHomeLayouts(tx, f.lunch))).find((l) => l.id === id)!;
    expect((await read(copy.id)).tiles.map((t) => t.ref)).toEqual([
      product(f.lemonade),
      { kind: "missing", name: "Drinks › Beer" },
      product(f.soup),
    ]);
    const moved = await app((tx) => moveShortcut(tx, home, beer.id, 2));
    expect(moved.map((t) => [t.position, t.ref])).toEqual([
      [0, product(f.lemonade)],
      [1, product(f.soup)],
      [2, { kind: "missing", name: "Drinks › Beer" }],
    ]);
    const replaced = await app((tx) => replaceShortcut(tx, home, beer.id, section(f.drinks)));
    expect(replaced).toEqual({ id: beer.id, position: 2, ref: section(f.drinks) });
    expect((await read(home)).tiles[2]!.missingName).toBeNull();
    const copiedMissing = (await read(copy.id)).tiles[1]!;
    await app((tx) => removeShortcut(tx, copy.id, copiedMissing.memberId));
    expect((await read(copy.id)).tiles.map((t) => [t.position, t.ref])).toEqual([
      [0, product(f.lemonade)],
      [1, product(f.soup)],
    ]);
  });

  it("retains existing section targets with the owning menu path when an inclusion is removed", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => addShortcut(tx, home, section(f.beer)));
    await app((tx) => addShortcut(tx, home, product(f.lager)));
    const [edge] = await fx.db
      .select()
      .from(sectionMembers)
      .where(
        and(eq(sectionMembers.sectionId, f.lunchRoot), eq(sectionMembers.childSectionId, f.drinks)),
      );
    await app((tx) => removeMember(tx, f.lunchRoot, edge!.id));
    const [layout] = await app((tx) => listHomeLayouts(tx, f.lunch));
    expect(layout!.tiles.map((t) => [t.ref, t.missingName, t.reachable])).toEqual([
      [section(f.beer), "Drinks › Beer", false],
      [product(f.lager), "Lager", false],
    ]);
    expect((await app((tx) => previewMenu(tx, f.lunch))).document.homeLayouts[0]!.tiles).toEqual([
      { kind: "empty" },
      { kind: "empty" },
    ]);
    await app((tx) => addMember(tx, f.lunchRoot, section(f.drinks)));
    expect(
      (await app((tx) => listHomeLayouts(tx, f.lunch)))[0]!.tiles.map((t) => t.missingName),
    ).toEqual([null, null]);
  });

  it("keeps structural shortcuts through an inactive inclusion but publishes empty slots", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => addShortcut(tx, home, section(f.drinks)));
    await app((tx) => addShortcut(tx, home, section(f.beer)));
    expect((await app((tx) => previewMenu(tx, f.lunch))).document.homeLayouts[0]!.tiles).toEqual([
      section(f.drinks),
      section(f.beer),
    ]);
    await app((tx) => deactivateCatalogue(tx, f.drinksMenu));
    await app((tx) => addShortcut(tx, home, product(f.lager)));
    const [layout] = await app((tx) => listHomeLayouts(tx, f.lunch));
    expect(layout!.tiles.every((t) => t.reachable && t.missingName === null)).toBe(true);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.document.homeLayouts[0]!.tiles).toEqual([
      { kind: "empty" },
      { kind: "empty" },
      { kind: "empty" },
    ]);
    expect(preview.warnings.map((w) => w.name)).toEqual(["Drinks", "Beer", "Lager"]);
  });

  it("refuses unreachable, duplicate, missing and variant replacements without changing the tile", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const tile = await app((tx) => addShortcut(tx, home, product(f.soup)));
    await app((tx) => addShortcut(tx, home, product(f.lemonade)));
    for (const [ref, code] of [
      [product(f.burger), "menu.shortcut_unreachable"],
      [product(f.lemonade), "menu_section.member_duplicate"],
      [section(MISSING), "menu_section.not_found"],
      [product(f.large), "menu_section.membership_invalid"],
    ] as const) {
      expect(await codeOf(() => app((tx) => replaceShortcut(tx, home, tile.id, ref)))).toBe(code);
    }
    expect(
      await codeOf(() => app((tx) => replaceShortcut(tx, home, MISSING, product(f.soup)))),
    ).toBe("menu_section.not_found");
    expect(await tileRefs(home)).toEqual([
      { position: 0, ref: product(f.soup) },
      { position: 1, ref: product(f.lemonade) },
    ]);
    expect(await app((tx) => replaceShortcut(tx, home, tile.id, product(f.soup)))).toEqual(tile);
  });

  it("accepts a product or included menu section the menu reaches, however deep", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const lager = await app((tx) => addShortcut(tx, home, product(f.lager)));
    expect(lager).toMatchObject({ position: 0, ref: product(f.lager) });
    const beer = await app((tx) => addShortcut(tx, home, section(f.beer)));
    expect(beer).toMatchObject({ position: 1, ref: section(f.beer) });
    const first = await app((tx) => addShortcut(tx, home, product(f.soup), 0));
    expect(first.position).toBe(0);
    expect(await tileRefs(home)).toEqual([
      { position: 0, ref: product(f.soup) },
      { position: 1, ref: product(f.lager) },
      { position: 2, ref: section(f.beer) },
    ]);
  });

  it("refuses a product or included menu section the menu does not reach", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    for (const ref of [product(f.burger), section(f.mains)]) {
      const refused = await captureError(() => app((tx) => addShortcut(tx, home, ref)));
      expect(refused).toMatchObject({
        code: "menu.shortcut_unreachable",
        params: { layoutId: home, ref },
      });
    }
    expect(await tileRefs(home)).toEqual([]);
  });

  it("accepts an Inactive product the menu places, and publishing keeps an empty slot with a warning", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => deactivateProduct(tx, f.soup));
    const tile = await app((tx) => addShortcut(tx, home, product(f.soup)));
    expect(tile.ref).toEqual(product(f.soup));
    const [layout] = await app((tx) => listHomeLayouts(tx, f.lunch));
    expect(layout!.tiles).toMatchObject([{ ref: product(f.soup), reachable: true }]);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.warnings).toEqual([
      { kind: "shortcut_missing", layoutName: "Home", name: "Soup" },
    ]);
    expect(preview.document.homeLayouts[0]!.tiles).toEqual([{ kind: "empty" }]);
  });

  it("accepts product tiles on an inactive menu, reached by its structure", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => deactivateCatalogue(tx, f.lunch));
    await app((tx) => addShortcut(tx, home, product(f.soup)));
    await app((tx) => addShortcut(tx, home, product(f.lager)));
    const [layout] = await app((tx) => listHomeLayouts(tx, f.lunch));
    expect(layout!.tiles.map(({ ref, reachable }) => [ref, reachable])).toEqual([
      [product(f.soup), true],
      [product(f.lager), true],
    ]);
    expect((await app((tx) => previewMenu(tx, f.lunch))).warnings).toEqual([
      { kind: "shortcut_missing", layoutName: "Home", name: "Soup" },
      { kind: "shortcut_missing", layoutName: "Home", name: "Lager" },
    ]);
  });

  it("accepts an inactive product the structure reaches", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => deactivateProduct(tx, f.lager));
    await app((tx) => addShortcut(tx, home, product(f.lager)));
    const [layout] = await app((tx) => listHomeLayouts(tx, f.lunch));
    expect(layout!.tiles).toMatchObject([{ ref: product(f.lager), reachable: true }]);
    expect((await app((tx) => previewMenu(tx, f.lunch))).warnings).toEqual([
      { kind: "shortcut_missing", layoutName: "Home", name: "Lager" },
    ]);
  });

  it("refuses unreachable menu roots and home layouts as tiles", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const counter = await app((tx) => createHomeLayout(tx, f.lunch, "Counter"));
    const dinnerHome = await defaultLayout(f.dinner);
    for (const owned of [f.lunchRoot, counter.id, f.dinnerRoot, dinnerHome]) {
      const refused = await captureError(() => app((tx) => addShortcut(tx, home, section(owned))));
      expect(refused).toMatchObject({
        code: [f.lunchRoot, f.dinnerRoot].includes(owned)
          ? "menu.shortcut_unreachable"
          : "menu_section.wrong_role",
      });
    }
  });

  it("refuses a repeated tile, a section that does not exist, and a variant", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => addShortcut(tx, home, product(f.soup)));
    expect(await codeOf(() => app((tx) => addShortcut(tx, home, product(f.soup))))).toBe(
      "menu_section.member_duplicate",
    );
    expect(await codeOf(() => app((tx) => addShortcut(tx, home, section(MISSING))))).toBe(
      "menu_section.not_found",
    );
    expect(await codeOf(() => app((tx) => addShortcut(tx, home, product(f.large))))).toBe(
      "menu_section.membership_invalid",
    );
    expect(await codeOf(() => app((tx) => addShortcut(tx, home, product(f.soup), -1)))).toBe(
      "menu_section.invalid",
    );
    expect(await codeOf(() => app((tx) => addShortcut(tx, home, product(f.lager), 0.5)))).toBe(
      "menu_section.invalid",
    );
  });

  it("adds no menu item or offer, and removing a tile removes only the tile (spec §5)", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const itemsBefore = await fx.db.select().from(menuItems).orderBy(asc(menuItems.id));
    const offersBefore = await app((tx) => listMenuOffers(tx, [f.lunch]));
    const soup = await app((tx) => addShortcut(tx, home, product(f.soup)));
    await app((tx) => addShortcut(tx, home, section(f.drinks)));
    expect(await fx.db.select().from(menuItems).orderBy(asc(menuItems.id))).toEqual(itemsBefore);
    expect(await app((tx) => listMenuOffers(tx, [f.lunch]))).toEqual(offersBefore);
    const rootBefore = await tileRefs(f.lunchRoot);
    await app((tx) => removeShortcut(tx, home, soup.id));
    expect(await tileRefs(home)).toEqual([{ position: 0, ref: section(f.drinks) }]);
    expect(await tileRefs(f.lunchRoot)).toEqual(rootBefore);
    expect(await fx.db.select().from(menuItems).orderBy(asc(menuItems.id))).toEqual(itemsBefore);
    expect(await app((tx) => listMenuOffers(tx, [f.lunch]))).toEqual(offersBefore);
  });

  it("removes a tile and closes the gap, and refuses a member the layout does not hold", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const soup = await app((tx) => addShortcut(tx, home, product(f.soup)));
    await app((tx) => addShortcut(tx, home, product(f.lager)));
    await app((tx) => removeShortcut(tx, home, soup.id));
    expect(await tileRefs(home)).toEqual([{ position: 0, ref: product(f.lager) }]);
    const refused = await captureError(() => app((tx) => removeShortcut(tx, home, soup.id)));
    expect(refused).toMatchObject({
      code: "menu_section.not_found",
      params: { sectionId: home, memberId: soup.id },
    });
  });

  it("moves a tile to an index, past the end meaning last, and refuses a bad index", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const soup = await app((tx) => addShortcut(tx, home, product(f.soup)));
    await app((tx) => addShortcut(tx, home, product(f.lager)));
    await app((tx) => addShortcut(tx, home, section(f.beer)));
    const moved = await app((tx) => moveShortcut(tx, home, soup.id, 1));
    expect(moved.map((member) => [member.position, member.ref])).toEqual([
      [0, product(f.lager)],
      [1, product(f.soup)],
      [2, section(f.beer)],
    ]);
    await app((tx) => moveShortcut(tx, home, soup.id, 99));
    expect((await tileRefs(home)).map((tile) => tile.ref)).toEqual([
      product(f.lager),
      section(f.beer),
      product(f.soup),
    ]);
    for (const to of [-1, 1.5])
      expect(await codeOf(() => app((tx) => moveShortcut(tx, home, soup.id, to)))).toBe(
        "menu_section.invalid",
      );
    expect(await codeOf(() => app((tx) => moveShortcut(tx, home, MISSING, 0)))).toBe(
      "menu_section.not_found",
    );
  });

  it("lists each tile with its name and kind, and marks one whose target left the menu", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const soup = await app((tx) => addShortcut(tx, home, product(f.soup)));
    const drinks = await app((tx) => addShortcut(tx, home, section(f.drinks)));
    const [rootSoup] = await fx.db
      .select({ id: sectionMembers.id })
      .from(sectionMembers)
      .where(and(eq(sectionMembers.sectionId, f.lunchRoot), eq(sectionMembers.productId, f.soup)));
    await app((tx) => removeMember(tx, f.lunchRoot, rootSoup!.id));
    const [layout] = await app((tx) => listHomeLayouts(tx, f.lunch));
    // The staff name and the internal name, never the customer-facing ones.
    expect(layout!.tiles).toEqual([
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
    ]);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.soup)));
    expect((await app((tx) => listHomeLayouts(tx, f.lunch)))[0]!.tiles[0]!.reachable).toBe(true);
  });
});

describe("publishing the layouts", () => {
  async function publish(menuId: string) {
    const { hash } = await app((tx) => previewMenu(tx, menuId));
    await app((tx) => publishMenu(tx, menuId, hash, "person-1"));
  }

  it("carries every layout and its tiles in order, the default first", async () => {
    const f: MenusFixture = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    const counter = await app((tx) => createHomeLayout(tx, f.lunch, "Counter"));
    await app(async (tx) => {
      await addShortcut(tx, counter.id, section(f.beer));
      await addShortcut(tx, counter.id, product(f.soup));
      await addShortcut(tx, home, product(f.lemonade));
      await setDefaultHomeLayout(tx, f.lunch, counter.id);
    });
    const { document } = await app((tx) => previewMenu(tx, f.lunch));
    expect(document.defaultHomeLayoutId).toBe(counter.id);
    expect(document.homeLayouts).toEqual([
      { id: counter.id, name: "Counter", tiles: [section(f.beer), product(f.soup)] },
      { id: home, name: "Home", tiles: [product(f.lemonade)] },
    ]);
  });

  it("flags the menu changed on a tile edit, and current again when the edit is undone", async () => {
    const f = await menusFixture(fx.db);
    const home = await defaultLayout(f.lunch);
    await app((tx) => addShortcut(tx, home, product(f.soup)));
    await app((tx) => addShortcut(tx, home, product(f.lemonade)));
    await publish(f.lunch);
    const state = async () => (await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch)!.state;
    expect(await state()).toBe("current");
    const lager = await app((tx) => addShortcut(tx, home, product(f.lager)));
    expect(await state()).toBe("changed");
    await app((tx) => removeShortcut(tx, home, lager.id));
    expect(await state()).toBe("current");
    const [soup] = (await app((tx) => listHomeLayouts(tx, f.lunch)))[0]!.tiles;
    await app((tx) => moveShortcut(tx, home, soup!.memberId, 1));
    expect(await state()).toBe("changed");
    const { changes } = await app((tx) => previewMenu(tx, f.lunch));
    expect(changes).toEqual([
      { kind: "layout_changed", layoutId: home, name: "Home", source: "this_menu" },
    ]);
    // Dinner's status is untouched by Lunch's layout.
    await publish(f.dinner);
    await app((tx) => moveShortcut(tx, home, soup!.memberId, 0));
    expect((await app((tx) => menuStatus(tx, [f.dinner]))).get(f.dinner)!.state).toBe("current");
  });
});
