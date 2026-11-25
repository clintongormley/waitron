import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { menuItems, withTransaction, type Transaction } from "@waitron/db";
import type {
  IncludeFolder,
  MemberRef,
  MenuStructureMemberInput,
  MenuStructureSaveInput,
} from "@waitron/shared";
import { useMenuDb } from "../test/fixtures.js";
import { menusFixture, offerOf, product, section } from "../test/menus-fixture.js";
import { writeContentLanguages } from "./content-languages.js";
import { setIncludeFolder } from "./include-folder.js";
import { saveMenuStructure } from "./index.js";
import { addShortcut, readMenuHome } from "./menu-home.js";
import { readMenuStructure } from "./menu-structure.js";
import {
  createMenu,
  deactivateMenu,
  deactivateProduct,
  listMenuOffers,
  menuPrices,
  updateMenuItem,
} from "./operations.js";
import {
  addMember,
  createSectionIn,
  deleteSections,
  listMembers,
  readSection,
  removeMember,
} from "./sections.js";
import { setMenuVariantPrice } from "./variants.js";

const fx = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const newId = () => crypto.randomUUID();
const member = (ref: MemberRef, id: string = newId()) => ({ id, ref });
const folder: IncludeFolder = { showAsFolder: true, overrides: {} };
const draftSection = (id: string, members: MenuStructureSaveInput["rootMembers"] = []) => ({
  id,
  internalName: "Owned section",
  names: {},
  image: null,
  color: null,
  members,
});
const save = (menuId: string, draft: MenuStructureSaveInput) =>
  app((tx) => saveMenuStructure(tx, menuId, draft, "en"));

it("swaps same-product members, keeps a moved child and its offer, and syncs menus that include it", async () => {
  const f = await menusFixture(fx.db);
  const before = await app(async (tx) => {
    const parent = await createSectionIn(tx, f.lunchRoot, { internalName: "Old parent" });
    const child = await createSectionIn(tx, parent.id, { internalName: "Kept child" });
    const first = await addMember(tx, child.id, product(f.soup));
    const second = (await readMenuStructure(tx, f.lunch)).nodes.find(
      (row) => row.ref.kind === "product",
    )!;
    const childMember = (await listMembers(tx, parent.id))[0]!;
    const shortcut = await addShortcut(tx, f.lunch, section(parent.id));
    await addMember(tx, f.dinnerRoot, section(f.lunchRoot));
    return {
      parent,
      child,
      first,
      second,
      childMember,
      shortcut,
      offer: await offerOf(tx, f.lunch, f.soup),
    };
  });
  const extra = member(product(f.extraLemon));
  expect(
    await save(f.lunch, {
      rootMembers: [
        member(section(before.child.id), before.childMember.id),
        member(product(f.soup), before.first.id),
      ],
      sections: [
        draftSection(before.child.id, [member(product(f.soup), before.second.memberId), extra]),
      ],
      prices: [{ productId: f.soup, price: "6.25" }],
    }),
  ).toEqual({ dropped: [] });
  const after = await app((tx) => readMenuStructure(tx, f.lunch));
  expect(after.nodes.map((node) => node.memberId)).toEqual([
    before.childMember.id,
    before.first.id,
  ]);
  expect(after.nodes[0]?.internalName).toBe("Owned section");
  await expect(app((tx) => readSection(tx, before.parent.id))).rejects.toMatchObject({
    code: "menu_section.not_found",
  });
  expect(after.nodes[0]?.children?.map((node) => node.memberId)).toEqual([
    before.second.memberId,
    extra.id,
  ]);
  expect(await app((tx) => offerOf(tx, f.lunch, f.soup))).toBe(before.offer);
  expect(
    (await fx.db.select().from(menuItems).where(eq(menuItems.id, before.offer)))[0]?.grossPrice,
  ).toBe(625);
  expect((await app((tx) => readMenuHome(tx, f.lunch))).shortcuts).toMatchObject([
    { memberId: before.shortcut.id, ref: { kind: "missing", name: "Lunch Menu › Old parent" } },
  ]);
  expect(
    (await app((tx) => listMenuOffers(tx, [f.dinner]))).map((offer) => offer.productId),
  ).toContain(f.extraLemon);
});

it("drops deleted placements and prices, a parent price with variants, and an unreachable price", async () => {
  const f = await menusFixture(fx.db);
  const include = { ...member(section(f.drinks)), folder };
  const soup = member(product(f.soup));
  const lager = member(product(f.lager));
  const replaced = member(product(f.lemonade));
  const deletedSet = await app((tx) =>
    createMenu(tx, { name: "Old Set", kind: "set_menu", setPrice: "20" }),
  );
  const set = member({ kind: "set_menu", menuId: deletedSet.id });
  await app(async (tx) => {
    await deactivateMenu(tx, deletedSet.id);
    await deactivateProduct(tx, f.soup);
    await deactivateMenu(tx, f.drinksMenu);
  });
  expect(
    await save(f.lunch, {
      rootMembers: [lager, include, soup, replaced, set],
      sections: [],
      prices: [
        { productId: f.soup, price: "4.00" },
        { productId: f.lemonade, price: "5.00" },
        { productId: f.burger, price: "9.00" },
      ],
    }),
  ).toEqual({
    dropped: [
      { memberId: include.id, reason: "deleted" },
      { memberId: soup.id, reason: "deleted" },
      { memberId: set.id, reason: "deleted" },
      { productId: f.soup, reason: "deleted" },
      { productId: f.lemonade, reason: "has_variants" },
      { productId: f.burger, reason: "unreachable" },
    ],
  });
  expect(
    (await app((tx) => readMenuStructure(tx, f.lunch))).nodes.map((node) => node.memberId),
  ).toEqual([lager.id, replaced.id]);
});

it("recreates missing draft rows, keeps disabled-language names on retained rows, and scopes and clears variant prices", async () => {
  const f = await menusFixture(fx.db);
  const before = await app(async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
    const kept = await createSectionIn(tx, f.lunchRoot, {
      internalName: "Kept",
      names: { fr: "Kept translation" },
    });
    const recreated = await createSectionIn(tx, f.lunchRoot, {
      internalName: "Restored",
      names: { fr: "Restored translation" },
    });
    const include = (await listMembers(tx, f.lunchRoot))[0]!;
    await setIncludeFolder(tx, f.lunchRoot, include.id, {
      showAsFolder: false,
      overrides: { names: { fr: "Drinks translation" } },
    });
    await removeMember(tx, f.lunchRoot, include.id);
    await deleteSections(tx, [recreated.id]);
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] });
    await updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
      grossPrice: "4.50",
    });
    await setMenuVariantPrice(tx, await offerOf(tx, f.drinksMenu, f.lemonade), f.large, "3.75");
    return { kept, recreated, include };
  });
  const rootMembers: MenuStructureMemberInput[] = [
    {
      ...member(section(f.drinks), before.include.id),
      folder: {
        showAsFolder: false,
        overrides: { names: { fr: "Drinks translation" }, color: null },
      },
    },
    member(section(before.kept.id)),
    member(section(before.recreated.id)),
  ];
  const sections = [
    draftSection(before.kept.id),
    { ...draftSection(before.recreated.id), names: { fr: "Restored translation" } },
  ];
  const price = { productId: f.lemonade, variantId: f.large, price: "0.00" };
  const sourcePrices = await app((tx) => menuPrices(tx, f.drinksMenu));
  await save(f.lunch, { rootMembers, sections, prices: [price] });
  const saved = await app((tx) => readMenuStructure(tx, f.lunch));
  expect(saved.nodes[0]).toMatchObject({
    memberId: before.include.id,
    folder: rootMembers[0]!.folder,
  });
  expect(saved.nodes.slice(1)).toMatchObject([
    { ref: section(before.kept.id), names: { fr: "Kept translation" } },
    { ref: section(before.recreated.id), names: { fr: "Restored translation" } },
  ]);
  const lemonade = async () =>
    (await app((tx) => menuPrices(tx, f.lunch))).find((offer) => offer.productId === f.lemonade);
  expect((await lemonade())?.variants).toMatchObject([{ variantId: f.large, price: "0.00" }]);
  await app(async (tx) =>
    updateMenuItem(tx, f.lunch, await offerOf(tx, f.lunch, f.lager), { grossPrice: "4.25" }),
  );
  await save(f.lunch, {
    rootMembers: [
      {
        ...member(section(f.drinks), before.include.id),
        folder: { ...folder, overrides: { names: { fr: "Old folder translation" } } },
      },
      ...rootMembers.slice(1),
    ],
    sections: [{ ...sections[0]!, names: { fr: "Old section translation" } }, sections[1]!],
    prices: [],
  });
  expect((await lemonade())?.variants).toMatchObject([{ variantId: f.large, price: null }]);
  const lunchPrices = await app((tx) => menuPrices(tx, f.lunch));
  expect(lunchPrices.find((offer) => offer.productId === f.lager)?.override).toBeNull();
  const retained = (await app((tx) => readMenuStructure(tx, f.lunch))).nodes;
  expect(retained[0]).toMatchObject({
    folder: { showAsFolder: true, overrides: { names: { fr: "Drinks translation" } } },
  });
  expect(retained[1]?.names).toEqual({ fr: "Kept translation" });
  expect(await app((tx) => menuPrices(tx, f.drinksMenu))).toEqual(sourcePrices);
});

it.each([
  ["cycle", "menu_section.member_cycle", "rootMembers.0.ref"],
  ["duplicate", "menu_section.member_duplicate", "rootMembers.1.ref"],
  ["duplicate section ID", "menu_section.member_duplicate", "sections.1.id"],
  ["duplicate member ID", "menu_section.membership_invalid", "rootMembers.1.id"],
  ["duplicate price", "product.invalid", "prices.1.price"],
  ["root as section ID", "menu_section.wrong_role", "sections.0.id"],
  ["variant member", "menu_section.membership_invalid", "rootMembers.0.ref"],
  ["folder color", "menu_section.invalid", "rootMembers.0.folder.color"],
  ["two parents", "menu_section.member_duplicate", "sections.1.members.0.ref"],
  ["detached loop", "menu_section.membership_invalid", "sections.0.id"],
  ["foreign section id", "menu_section.wrong_role", "sections.0.id"],
  ["foreign section ref", "menu_section.wrong_role", "rootMembers.0.ref"],
  ["foreign member id", "menu_section.membership_invalid", "rootMembers.0.id"],
  ["home tile id", "menu_section.membership_invalid", "rootMembers.0.id"],
  ["folder on product", "menu_section.invalid", "rootMembers.0.folder"],
  ["set root as section", "set_menu.wrong_place", "rootMembers.0.ref"],
  ["variant of another product", "product.variant_not_found", "prices.0.variantId"],
] as const)("refuses %s at the submitted row", async (caseName, code, field) => {
  const f = await menusFixture(fx.db);
  const a = newId();
  const b = newId();
  const draft: MenuStructureSaveInput = { rootMembers: [], sections: [], prices: [] };
  switch (caseName) {
    case "cycle":
      await app((tx) => addMember(tx, f.dinnerRoot, section(f.lunchRoot)));
      draft.rootMembers = [{ ...member(section(f.dinnerRoot)), folder }];
      break;
    case "duplicate":
      draft.rootMembers = [member(product(f.soup)), member(product(f.soup))];
      break;
    case "duplicate section ID":
      draft.sections = [draftSection(a), draftSection(a)];
      break;
    case "duplicate member ID":
      draft.rootMembers = [member(product(f.soup), a), member(product(f.lager), a)];
      break;
    case "duplicate price":
      draft.prices = [
        { productId: f.soup, price: "4" },
        { productId: f.soup, price: "3" },
      ];
      break;
    case "root as section ID":
      draft.sections = [draftSection(f.lunchRoot)];
      break;
    case "variant member":
      draft.rootMembers = [member(product(f.large))];
      break;
    case "folder color":
      draft.rootMembers = [
        {
          ...member(section(f.drinks)),
          folder: { showAsFolder: true, overrides: { color: "blue" } },
        },
      ];
      break;
    case "two parents":
      draft.rootMembers = [member(section(a)), member(section(b))];
      draft.sections = [draftSection(a), draftSection(b, [member(section(a))])];
      break;
    case "detached loop":
      draft.sections = [
        draftSection(a, [member(section(b))]),
        draftSection(b, [member(section(a))]),
      ];
      break;
    case "foreign section id":
      draft.sections = [draftSection(f.mains)];
      break;
    case "foreign section ref":
      draft.rootMembers = [member(section(f.mains))];
      break;
    case "foreign member id": {
      const [held] = await app((tx) => listMembers(tx, f.dinnerRoot));
      draft.rootMembers = [member(product(f.soup), held!.id)];
      break;
    }
    case "home tile id": {
      const tile = await app((tx) => addShortcut(tx, f.lunch, product(f.soup)));
      draft.rootMembers = [member(product(f.soup), tile.id)];
      break;
    }
    case "folder on product":
      draft.rootMembers = [{ ...member(product(f.soup)), folder }];
      break;
    case "set root as section": {
      const set = await app((tx) =>
        createMenu(tx, { name: "Set", kind: "set_menu", setPrice: "20" }),
      );
      const { rootSectionId } = await app((tx) => readMenuStructure(tx, set.id));
      draft.rootMembers = [member(section(rootSectionId))];
      break;
    }
    case "variant of another product":
      draft.rootMembers = [member(product(f.soup))];
      draft.prices = [{ productId: f.soup, variantId: f.large, price: "4.00" }];
      break;
  }
  await expect(save(f.lunch, draft)).rejects.toMatchObject({ code, params: { field } });
});

it("refuses saves addressed to a set menu or a deleted menu", async () => {
  const f = await menusFixture(fx.db);
  const set = await app(async (tx) => {
    await deactivateMenu(tx, f.drinksMenu);
    return createMenu(tx, { name: "Set", kind: "set_menu", setPrice: "20" });
  });
  const empty = { rootMembers: [], sections: [], prices: [] };
  await expect(save(set.id, empty)).rejects.toMatchObject({ code: "set_menu.wrong_place" });
  await expect(save(f.drinksMenu, empty)).rejects.toMatchObject({ code: "menu.deleted" });
});
