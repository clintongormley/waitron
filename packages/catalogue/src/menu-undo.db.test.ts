import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, offerOf, type MenusFixture } from "../test/menus-fixture.js";
import { readContentLanguages, writeContentLanguages } from "./content-languages.js";
import type { MenuChange, MenuPreview } from "./menu-document-types.js";
import { readMenuHome, setHomeDisplay } from "./menu-home.js";
import { readMenuStructure } from "./menu-structure.js";
import { previewMenu, publishMenu } from "./menu-publication.js";
import { menuChangeActions, type MenuChangeAction, type MenuUndoCommand } from "./menu-undo.js";
import { updateMenuDetails, updateMenuItem } from "./operations.js";
import { sectionMembers, sections } from "./schema/sections.js";
import { setIncludeFolder } from "./include-folder.js";
import { createSectionIn, updateSection } from "./sections.js";
import { setMenuVariantPrice } from "./variants.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

/** Each command through the catalogue function its route calls. */
function run(tx: Transaction, command: MenuUndoCommand): Promise<unknown> {
  switch (command.method) {
    case "renameCatalogue":
      return updateMenuDetails(tx, command.menuId, { name: command.name });
    case "updateMenuItem":
      return updateMenuItem(tx, command.menuId, command.menuItemId, command.input);
    case "setMenuVariantPrice":
      return setMenuVariantPrice(
        tx,
        command.menuItemId,
        command.variantId,
        command.price,
        command.menuId,
      );
    case "updateSection":
      return updateSection(tx, command.sectionId, command.patch);
    case "setHomeDisplay":
      return setHomeDisplay(tx, command.menuId, command.device, command.patch);
  }
}

async function publish(menuId: string): Promise<void> {
  const { hash } = await app((tx) => previewMenu(tx, menuId));
  await app((tx) => publishMenu(tx, menuId, hash, "person-1"));
}

async function readPreview(menuId: string): Promise<MenuPreview> {
  return app((tx) => previewMenu(tx, menuId));
}

async function actionsOf(preview: MenuPreview): Promise<ReadonlyMap<string, MenuChangeAction>> {
  const { languages } = await app((tx) => readContentLanguages(tx, "en"));
  return menuChangeActions({ preview, languages });
}

/** The one change `pick` finds, and the action offered beside it. */
async function changeAndAction(
  preview: MenuPreview,
  pick: (change: MenuChange) => boolean,
): Promise<{ change: MenuChange; action: MenuChangeAction }> {
  const found = preview.changes.filter(pick);
  expect(found).toHaveLength(1);
  const change = found[0]!;
  return { change, action: (await actionsOf(preview)).get(change.id)! };
}

function commandOf(action: MenuChangeAction): MenuUndoCommand {
  expect(action.kind).toBe("undo");
  return (action as Extract<MenuChangeAction, { kind: "undo" }>).command;
}

/** Changes Burger's menu price on Dinner, the unrelated change every Undo leaves alone. */
async function changeBurgerPrice(f: MenusFixture): Promise<void> {
  await app(async (tx) =>
    updateMenuItem(tx, f.dinner, await offerOf(tx, f.dinner, f.burger), { grossPrice: "13.50" }),
  );
}

/**
 * Runs the Undo of the one change `pick` finds on `menuId`, then reads the preview again: that
 * change is gone, every other change is as it was, and so is `otherMenuId`'s preview.
 */
async function undoAndCheck(
  menuId: string,
  otherMenuId: string,
  pick: (change: MenuChange) => boolean,
): Promise<MenuUndoCommand> {
  const before = await readPreview(menuId);
  const otherBefore = await readPreview(otherMenuId);
  const { change, action } = await changeAndAction(before, pick);
  const command = commandOf(action);
  await app((tx) => run(tx, command));
  const after = await readPreview(menuId);
  expect(after.changes.map(({ id }) => id)).not.toContain(change.id);
  const others = before.changes.filter(({ id }) => id !== change.id);
  expect(others.length).toBeGreaterThan(0);
  expect(after.changes).toEqual(others);
  const otherAfter = await readPreview(otherMenuId);
  expect(otherAfter.changes).toEqual(otherBefore.changes);
  expect(otherAfter.hash).toBe(otherBefore.hash);
  return command;
}

async function sectionRow(sectionId: string) {
  const [row] = await fx.db
    .select({
      internalName: sections.internalName,
      names: sections.names,
      image: sections.image,
      color: sections.color,
    })
    .from(sections)
    .where(eq(sections.id, sectionId));
  return row!;
}

async function rootOf(menuId: string): Promise<string> {
  return (await app((tx) => readMenuStructure(tx, menuId))).rootSectionId;
}

const isRename = (change: MenuChange) => change.kind === "menu_renamed";

describe("menu rename Undo", () => {
  it("puts back the published name and nothing else", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    const root = await rootOf(f.dinner);
    await app((tx) => updateMenuDetails(tx, f.dinner, { name: "Supper" }));
    await changeBurgerPrice(f);
    const rootBefore = await sectionRow(root);

    const command = await undoAndCheck(f.dinner, f.lunch, isRename);

    expect(command).toEqual({ method: "renameCatalogue", menuId: f.dinner, name: "Dinner Menu" });
    expect(await sectionRow(root)).toEqual({ ...rootBefore, internalName: "Dinner Menu" });
  });

  it("is refused when another menu has taken the published name since", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => updateMenuDetails(tx, f.dinner, { name: "Supper" }));
    await app((tx) => updateMenuDetails(tx, f.lunch, { name: "Dinner Menu" }));
    const { action } = await changeAndAction(await readPreview(f.dinner), isRename);
    const command = commandOf(action);

    await expect(app((tx) => run(tx, command))).rejects.toMatchObject({
      code: "menu.name_taken",
    });

    expect((await readPreview(f.dinner)).changes).toContainEqual(
      expect.objectContaining({ kind: "menu_renamed", from: "Dinner Menu", to: "Supper" }),
    );
  });
});

describe("Home display Undo", () => {
  const isHandheld = (change: MenuChange) =>
    change.kind === "home_display_changed" && change.device === "handheld";

  it("sends only the column count when only that changed", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => setHomeDisplay(tx, f.dinner, "handheld", { columns: 2 }));
    await changeBurgerPrice(f);
    const homeBefore = await app((tx) => readMenuHome(tx, f.dinner));

    const command = await undoAndCheck(f.dinner, f.lunch, isHandheld);

    expect(command).toEqual({
      method: "setHomeDisplay",
      menuId: f.dinner,
      device: "handheld",
      patch: { columns: 3 },
    });
    const homeAfter = await app((tx) => readMenuHome(tx, f.dinner));
    expect(homeAfter.till).toEqual(homeBefore.till);
    expect(homeAfter.shortcuts).toEqual(homeBefore.shortcuts);
    expect(homeAfter.handheld).toEqual({ ...homeBefore.handheld, columns: 3 });
  });

  it("sends the columns and the tiles when both changed, never the order", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) =>
      setHomeDisplay(tx, f.dinner, "handheld", { columns: 2, tiles: "thumbnails" }),
    );
    await changeBurgerPrice(f);
    const homeBefore = await app((tx) => readMenuHome(tx, f.dinner));

    const command = await undoAndCheck(f.dinner, f.lunch, isHandheld);

    expect(command).toEqual({
      method: "setHomeDisplay",
      menuId: f.dinner,
      device: "handheld",
      patch: { columns: 3, tiles: "colours" },
    });
    const homeAfter = await app((tx) => readMenuHome(tx, f.dinner));
    expect(homeAfter.till).toEqual(homeBefore.till);
    expect(homeAfter.shortcuts).toEqual(homeBefore.shortcuts);
  });
});

describe("own section Undo", () => {
  const isMains = (f: MenusFixture) => (change: MenuChange) =>
    change.kind === "section_changed" && change.sectionId === f.mains;

  it("puts back the names and the colour in one write, leaving the photo alone", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) =>
      updateSection(tx, f.mains, {
        internalName: "Big plates",
        names: { en: "Big plates" },
        color: "#336699",
      }),
    );
    await changeBurgerPrice(f);

    const command = await undoAndCheck(f.dinner, f.lunch, isMains(f));

    expect(command).toEqual({
      method: "updateSection",
      sectionId: f.mains,
      patch: { internalName: "Mains", names: { en: "Main courses" }, color: null },
      name: "Big plates",
    });
    expect(await sectionRow(f.mains)).toEqual({
      internalName: "Mains",
      names: { en: "Main courses" },
      image: null,
      color: null,
    });
  });

  it("puts back a section inside another of this menu's sections", async () => {
    const f = await menusFixture(fx.db);
    const sides = (
      await app((tx) => createSectionIn(tx, f.mains, { internalName: "Sides", names: {} }))
    ).id;
    await publish(f.dinner);
    await app((tx) => updateSection(tx, sides, { color: "#336699" }));
    await changeBurgerPrice(f);

    const command = await undoAndCheck(
      f.dinner,
      f.lunch,
      (change) => change.kind === "section_changed" && change.sectionId === sides,
    );

    expect(command).toEqual({
      method: "updateSection",
      sectionId: sides,
      patch: { color: null },
      name: "Sides",
    });
  });

  it("is offered when a language switched off since kept its published name", async () => {
    const f = await menusFixture(fx.db);
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
    );
    await app((tx) =>
      updateSection(tx, f.mains, { names: { en: "Main courses", es: "Principales" } }),
    );
    await publish(f.dinner);
    await app((tx) =>
      updateSection(tx, f.mains, { names: { en: "Big plates", es: "Principales" } }),
    );
    await app((tx) => writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] }));
    await changeBurgerPrice(f);

    await undoAndCheck(f.dinner, f.lunch, isMains(f));

    expect((await sectionRow(f.mains)).names).toEqual({ en: "Main courses", es: "Principales" });
  });

  it.each<{ edit: string; names: Record<string, string> }>([
    { edit: "edited", names: { en: "Big plates", es: "Platos grandes" } },
    { edit: "emptied", names: { en: "Big plates" } },
  ])(
    "offers nothing when a language switched off since was $edit before it was",
    async ({ names }) => {
      const f = await menusFixture(fx.db);
      await app((tx) =>
        writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
      );
      await app((tx) =>
        updateSection(tx, f.mains, { names: { en: "Main courses", es: "Principales" } }),
      );
      await publish(f.dinner);
      await app((tx) => updateSection(tx, f.mains, { names }));
      await app((tx) => writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] }));

      const { action } = await changeAndAction(await readPreview(f.dinner), isMains(f));

      expect(action).toEqual({ kind: "none" });
    },
  );

  it("offers nothing yet for how this menu shows an included menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    const [include] = await fx.db
      .select({ id: sectionMembers.id })
      .from(sectionMembers)
      .where(
        and(
          eq(sectionMembers.sectionId, f.dinnerRoot),
          eq(sectionMembers.childSectionId, f.drinks),
        ),
      );
    await app((tx) => setIncludeFolder(tx, f.dinnerRoot, include!.id, { showAsFolder: false }));

    const { change, action } = await changeAndAction(
      await readPreview(f.dinner),
      (found) => found.kind === "section_changed" && found.sectionId === f.drinks,
    );

    expect(change).toMatchObject({ source: "this_menu", fields: ["direct"] });
    expect(action).toEqual({ kind: "none" });
  });

  it("still sends an included menu's renamed section to that menu", async () => {
    const f = await menusFixture(fx.db);
    await publish(f.dinner);
    await app((tx) => updateMenuDetails(tx, f.drinksMenu, { name: "Bar" }));

    const { action } = await changeAndAction(
      await readPreview(f.dinner),
      (change) => change.kind === "section_changed" && change.sectionId === f.drinks,
    );

    expect(action).toEqual({ kind: "edit_menu", menuId: f.drinksMenu, tab: "structure" });
  });
});
