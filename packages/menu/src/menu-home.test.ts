import { seedPerson } from "@waitron/db/testing/seed.js";
import { storedMenuParts } from "../test/menu-parts.js";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureError,
  menuItems,
  sectionMembers,
  sections,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useMenuDb } from "../test/fixtures.js";
import { menusFixture, product, section, type MenusFixture } from "../test/menus-fixture.js";
import { DEFAULT_HOME_ORDER } from "@waitron/shared";
import { readMenuHome, saveMenuHome } from "./menu-home.js";
import { addShortcut, editMenuHome } from "../test/menu-home-fixture.js";
import { buildMenuDocument } from "./menu-document.js";
import { membersOf } from "./section-members.js";
import { readSection } from "./sections.js";
import { menuStatus, previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import { createMenu, deactivateMenu, deactivateProduct, listMenuOffers } from "./operations.js";
import { addMember, createSectionIn, deleteSection, removeMember } from "./sections.js";

const fx = useMenuDb();
beforeEach(async () => {
  await seedPerson(fx.db, { id: "person-1", displayName: "Test person-1" });
});

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

async function otherHome(productId?: string): Promise<string> {
  const menu = await app((tx) => createMenu(tx, { name: "Other Home" }));
  const [parts] = await storedMenuParts(fx.db, menu.id);
  const row = { id: parts!.homeSectionId };
  if (productId !== undefined)
    await fx.db.insert(sectionMembers).values({ sectionId: row!.id, position: 0, productId });
  return row!.id;
}

async function displayRow(menuId: string) {
  const [row] = await storedMenuParts(fx.db, menuId);
  return row!;
}

describe("the Device Home Page", () => {
  it("reads the menu's Device Home Page: its section, its shortcuts in order with names and reach, and the default display order", async () => {
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
      order: DEFAULT_HOME_ORDER,
    });
    await app((tx) => addMember(tx, f.lunchRoot, product(f.soup)));
    expect((await app((tx) => readMenuHome(tx, f.lunch))).shortcuts[0]!.reachable).toBe(true);
  });

  it("reads only the menu's own home section", async () => {
    const f = await menusFixture(fx.db);
    const leftover = await otherHome(f.lemonade);
    const home = await homeOf(f.lunch);
    expect(home).not.toBe(leftover);
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    await app((tx) => addShortcut(tx, f.lunch, section(f.beer)));
    expect((await app((tx) => readMenuHome(tx, f.lunch))).shortcuts.map((t) => t.ref)).toEqual([
      product(f.lager),
      section(f.beer),
    ]);
    const { document } = await app((tx) => buildMenuDocument(tx, f.lunch));
    expect(document.home.shortcuts).toEqual([product(f.lager), section(f.beer)]);
    await app((tx) =>
      editMenuHome(tx, f.lunch, ({ shortcuts }) => {
        shortcuts.shift();
      }),
    );
    expect(await tileRefs(leftover)).toEqual([{ position: 0, ref: product(f.lemonade) }]);
    expect(await tileRefs(home)).toEqual([{ position: 0, ref: section(f.beer) }]);
  });

  it("refuses a menu that does not exist", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    const calls: (() => Promise<unknown>)[] = [
      () => app((tx) => readMenuHome(tx, MISSING)),
      () => app((tx) => saveMenuHome(tx, MISSING, { order: "menu_first", shortcuts: [] })),
    ];
    for (const call of calls)
      expect(await captureError(call)).toMatchObject({
        code: "menu.not_found",
        params: { menuId: MISSING },
      });
    expect(await tileRefs(await homeOf(f.lunch))).toEqual([{ position: 0, ref: product(f.soup) }]);
  });
});

describe("saveMenuHome", () => {
  it("replaces the page with the ordered draft and changes Shown first", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    const soup = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lemonade)));
    const lager = await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    const drinksId = crypto.randomUUID();

    const saved = await app((tx) =>
      saveMenuHome(tx, f.lunch, {
        order: "menu_first",
        shortcuts: [
          { memberId: lager.id, ref: product(f.lager) },
          { memberId: drinksId, ref: { kind: "section", sectionId: f.drinks } },
          { memberId: soup.id, ref: product(f.soup) },
        ],
      }),
    );
    expect(saved).toEqual({
      homeSectionId: home,
      order: "menu_first",
      shortcuts: [
        {
          memberId: lager.id,
          position: 0,
          ref: product(f.lager),
          name: "Lager",
          reachable: true,
          missingName: null,
        },
        {
          memberId: drinksId,
          position: 1,
          ref: section(f.drinks),
          name: "Drinks",
          reachable: true,
          missingName: null,
        },
        {
          memberId: soup.id,
          position: 2,
          ref: product(f.soup),
          name: "Soup",
          reachable: true,
          missingName: null,
        },
      ],
      dropped: [],
    });
    const { dropped, ...savedPage } = saved;
    expect(await app((tx) => readMenuHome(tx, f.lunch))).toEqual(savedPage);
    expect(await tileRefs(await homeOf(f.dinner))).toEqual([]);
  });

  it("keeps the stored missing name when a previously saved target is deleted", async () => {
    const f = await menusFixture(fx.db);
    const beer = await app((tx) => addShortcut(tx, f.lunch, section(f.beer)));
    await app((tx) => deleteSection(tx, f.beer));
    const saved = await app((tx) =>
      saveMenuHome(tx, f.lunch, {
        order: "menu_first",
        shortcuts: [{ memberId: beer.id, ref: { kind: "section", sectionId: f.beer } }],
      }),
    );
    expect(saved.shortcuts).toEqual([
      {
        memberId: beer.id,
        position: 0,
        ref: { kind: "missing", name: "Drinks › Beer" },
        name: "Drinks › Beer",
        missingName: "Drinks › Beer",
        reachable: false,
      },
    ]);
    expect(saved.dropped).toEqual([]);
  });

  it("refuses a missing tile when another Save removed its row", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, section(f.beer)));
    await app((tx) => deleteSection(tx, f.beer));
    const draft = await app((tx) => readMenuHome(tx, f.lunch));
    await app((tx) => saveMenuHome(tx, f.lunch, { order: "home_first", shortcuts: [] }));
    expect((await app((tx) => readMenuHome(tx, f.lunch))).shortcuts).toEqual([]);
    await expect(app((tx) => saveMenuHome(tx, f.lunch, draft))).rejects.toMatchObject({
      code: "menu_section.not_found",
      params: { memberId: draft.shortcuts[0]!.memberId, field: "shortcuts.0.ref" },
    });
    expect((await app((tx) => readMenuHome(tx, f.lunch))).shortcuts).toEqual([]);
  });

  it("drops newly chosen targets deleted before Save and closes the gaps", async () => {
    const f = await menusFixture(fx.db);
    const soupId = crypto.randomUUID();
    const beerId = crypto.randomUUID();
    const drinksId = crypto.randomUUID();
    const lemonadeId = crypto.randomUUID();
    await app((tx) => deactivateProduct(tx, f.soup));
    await app((tx) => deleteSection(tx, f.beer));
    await app((tx) => deactivateMenu(tx, f.drinksMenu));
    const saved = await app((tx) =>
      saveMenuHome(tx, f.lunch, {
        order: "menu_first",
        shortcuts: [
          { memberId: soupId, ref: product(f.soup) },
          { memberId: beerId, ref: { kind: "section", sectionId: f.beer } },
          { memberId: drinksId, ref: { kind: "section", sectionId: f.drinks } },
          { memberId: lemonadeId, ref: product(f.lemonade) },
        ],
      }),
    );
    expect(saved.dropped).toEqual([
      { memberId: soupId, reason: "deleted" },
      { memberId: beerId, reason: "deleted" },
      { memberId: drinksId, reason: "deleted" },
    ]);
    expect(saved.shortcuts.map(({ memberId, position }) => [memberId, position])).toEqual([
      [lemonadeId, 0],
    ]);
    expect(saved.order).toBe("menu_first");
  });

  it("refuses duplicate ids, duplicate targets, foreign ids and new unreachable targets without changing saved settings", async () => {
    const f = await menusFixture(fx.db);
    const soup = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    const foreign = await app((tx) => addShortcut(tx, f.dinner, product(f.lager)));
    const before = await app((tx) => readMenuHome(tx, f.lunch));
    const another = crypto.randomUUID();
    const lager = { memberId: another, ref: product(f.lager) };
    for (const [shortcut, code] of [
      [{ ...lager, memberId: soup.id }, "menu_section.membership_invalid"],
      [{ ...lager, ref: product(f.soup) }, "menu_section.member_duplicate"],
      [{ ...lager, memberId: foreign.id }, "menu_section.membership_invalid"],
      [{ ...lager, ref: product(f.burger) }, "menu.shortcut_unreachable"],
      [{ ...lager, ref: product(f.large) }, "menu_section.membership_invalid"],
    ] as const) {
      expect(
        await codeOf(() =>
          app((tx) =>
            saveMenuHome(tx, f.lunch, {
              order: "menu_first",
              shortcuts: [{ memberId: soup.id, ref: product(f.soup) }, shortcut],
            }),
          ),
        ),
      ).toBe(code);
      expect(await app((tx) => readMenuHome(tx, f.lunch))).toEqual(before);
    }
    expect((await app((tx) => readMenuHome(tx, f.dinner))).shortcuts[0]?.memberId).toBe(foreign.id);
  });

  it("identifies the draft shortcut whose target was taken off the menu", async () => {
    const f = await menusFixture(fx.db);
    const root = await app((tx) => readSection(tx, f.lunchRoot));
    const member = root.members.find(
      ({ ref }) => ref.kind === "product" && ref.productId === f.soup,
    )!;
    await app((tx) => removeMember(tx, f.lunchRoot, member.id));
    await expect(
      app((tx) =>
        saveMenuHome(tx, f.lunch, {
          order: "menu_first",
          shortcuts: [{ memberId: crypto.randomUUID(), ref: product(f.soup) }],
        }),
      ),
    ).rejects.toMatchObject({
      code: "menu.shortcut_unreachable",
      params: { ref: product(f.soup), field: "shortcuts.0.ref" },
    });
  });

  it("refuses to save a deleted menu", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => deactivateMenu(tx, f.lunch));
    expect(
      await codeOf(() =>
        app((tx) =>
          saveMenuHome(tx, f.lunch, {
            order: "menu_first",
            shortcuts: [],
          }),
        ),
      ),
    ).toBe("menu.deleted");
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

  it("moves and removes missing tiles without losing their positions", async () => {
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
    const moved = await app((tx) =>
      editMenuHome(tx, f.lunch, ({ shortcuts }) => {
        const index = shortcuts.findIndex(({ memberId }) => memberId === beer.id);
        shortcuts.push(shortcuts.splice(index, 1)[0]!);
      }),
    );
    expect(moved.shortcuts.map((t) => [t.position, t.ref])).toEqual([
      [0, product(f.lemonade)],
      [1, product(f.soup)],
      [2, { kind: "missing", name: "Drinks › Beer" }],
    ]);
    await app((tx) =>
      editMenuHome(tx, f.lunch, ({ shortcuts }) => {
        shortcuts.pop();
      }),
    );
    expect((await read()).map((tile) => tile.ref)).toEqual([product(f.lemonade), product(f.soup)]);
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
    await app((tx) => deactivateMenu(tx, f.drinksMenu));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    const { shortcuts } = await app((tx) => readMenuHome(tx, f.lunch));
    expect(shortcuts.every((t) => t.reachable && t.missingName === null)).toBe(true);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.document.home.shortcuts).toEqual([
      { kind: "empty" },
      { kind: "empty" },
      { kind: "empty" },
    ]);
    expect(preview.warnings.map((w) => ("name" in w ? w.name : undefined))).toEqual([
      "Drinks",
      "Beer",
      "Lager",
    ]);
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

  it("publishes an empty slot and warning when a saved shortcut is later disabled", async () => {
    const f = await menusFixture(fx.db);
    const home = await homeOf(f.lunch);
    await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => deactivateProduct(tx, f.soup));
    const { shortcuts } = await app((tx) => readMenuHome(tx, f.lunch));
    expect(shortcuts).toMatchObject([
      { position: 0, ref: { kind: "missing", name: "Soup" }, reachable: false },
    ]);
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    expect(preview.warnings).toEqual([{ kind: "shortcut_missing", name: "Soup" }]);
    expect(preview.document.home.shortcuts).toEqual([{ kind: "empty" }]);

    const rows = await fx.db
      .select()
      .from(sectionMembers)
      .where(eq(sectionMembers.sectionId, home));
    expect(rows.map(({ productId, missingName }) => ({ productId, missingName }))).toEqual([
      { productId: null, missingName: "Soup" },
    ]);
  });

  it("keeps product tiles on an inactive menu readable through its structure", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
    await app((tx) => addShortcut(tx, f.lunch, product(f.lager)));
    await app((tx) => deactivateMenu(tx, f.lunch));
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

  it("refuses unreachable menu roots and home sections as tiles", async () => {
    const f = await menusFixture(fx.db);
    const leftover = await otherHome();
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
    await app((tx) =>
      editMenuHome(tx, f.lunch, (draft) => {
        draft.shortcuts = draft.shortcuts.filter(({ memberId }) => memberId !== soup.id);
      }),
    );
    expect(await tileRefs(home)).toEqual([{ position: 0, ref: section(f.drinks) }]);
    expect(await tileRefs(f.lunchRoot)).toEqual(rootBefore);
    expect(await fx.db.select().from(menuItems).orderBy(asc(menuItems.id))).toEqual(itemsBefore);
    expect(await app((tx) => listMenuOffers(tx, [f.lunch]))).toEqual(offersBefore);
  });
});

describe("publishing the Device Home Page", () => {
  async function publish(menuId: string) {
    const { hash } = await app((tx) => previewMenu(tx, menuId));
    await app((tx) => publishMenu(tx, menuId, hash, "person-1"));
  }

  it("carries the shortcuts in order and the shared display order", async () => {
    const f: MenusFixture = await menusFixture(fx.db);
    await app(async (tx) => {
      await addShortcut(tx, f.lunch, section(f.beer));
      await addShortcut(tx, f.lunch, product(f.soup));
      await editMenuHome(tx, f.lunch, (draft) => {
        draft.order = "menu_first";
      });
    });
    const { document } = await app((tx) => previewMenu(tx, f.lunch));
    expect(document.home).toEqual({
      shortcuts: [section(f.beer), product(f.soup)],
      order: "menu_first",
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
    await app((tx) =>
      editMenuHome(tx, f.lunch, (draft) => {
        draft.shortcuts = draft.shortcuts.filter(({ memberId }) => memberId !== lager.id);
      }),
    );
    expect(await state()).toBe("current");
    await app((tx) =>
      editMenuHome(tx, f.lunch, ({ shortcuts }) => {
        shortcuts.reverse();
      }),
    );
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
          ['["home","shortcuts"]'],
          ['["home","shortcuts"]'],
        ]),
        targets: {
          before: [{ kind: "home", field: "shortcuts" }],
          after: [{ kind: "home", field: "shortcuts" }],
        },
      },
    ]);
    await app((tx) =>
      editMenuHome(tx, f.lunch, ({ shortcuts }) => {
        shortcuts.reverse();
      }),
    );
    expect(await state()).toBe("current");
    await app((tx) =>
      editMenuHome(tx, f.lunch, (draft) => {
        draft.order = "menu_first";
      }),
    );
    expect(await state()).toBe("changed");
    expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual([
      {
        kind: "home_display_changed",
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
          null,
          ['["home","order"]'],
          ['["home","order"]'],
        ]),
        targets: {
          before: [{ kind: "home", field: "order" }],
          after: [{ kind: "home", field: "order" }],
        },
      },
    ]);
    await app((tx) =>
      editMenuHome(tx, f.lunch, (draft) => {
        draft.order = "home_first";
      }),
    );
    expect(await state()).toBe("current");
    // Dinner's status is untouched by Lunch's Device Home Page.
    await publish(f.dinner);
    await app((tx) =>
      editMenuHome(tx, f.lunch, ({ shortcuts }) => {
        shortcuts.reverse();
      }),
    );
    await app((tx) =>
      editMenuHome(tx, f.lunch, (draft) => {
        draft.order = "menu_first";
      }),
    );
    expect((await app((tx) => menuStatus(tx, [f.dinner]))).get(f.dinner)!.state).toBe("current");
  });

  it("a draft display change leaves the live version as it was", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.lunch);
    await app((tx) =>
      editMenuHome(tx, f.lunch, (draft) => {
        draft.order = "menu_first";
      }),
    );
    const liveOrder = async () =>
      (await app((tx) => readLiveDocuments(tx, [f.lunch]))).get(f.lunch)!.document.home.order;
    expect(await liveOrder()).toBe("home_first");
    expect((await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch)!.state).toBe("changed");
    await publish(f.lunch);
    expect(await liveOrder()).toBe("menu_first");
  });
});
