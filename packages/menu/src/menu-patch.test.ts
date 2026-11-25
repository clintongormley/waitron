import { seedPerson } from "@waitron/db/testing/seed.js";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { isAppError, type ContentLanguages } from "@waitron/shared";
import { useMenuDb } from "../test/fixtures.js";
import {
  menusFixture,
  NO_ICE,
  offerOf,
  section,
  type MenusFixture,
} from "../test/menus-fixture.js";
import { productDeclarationValues, type DeclarationValues } from "./declaration-values.js";
import { setIncludeFolder } from "./include-folder.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { addMember, createSectionIn } from "./sections.js";
import { menuDocumentHash } from "./menu-document.js";
import { createMenu, updateMenuDetails } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { liveVersions, previewMenu, publishMenu } from "./menu-publication.js";
import { readMenuStructure } from "./menu-structure.js";
import {
  applyMenuPatch,
  correctedCopies,
  declarationProductIds,
  declarationsFor,
  fixedLanguages,
  parseMenuPatch,
  patchFieldValue,
} from "./menu-patch.js";
import {
  liveDeclarations,
  queuedChanges,
  queuedCorrections,
  queuedDeclarationDrift,
} from "./menu-patch-declarations.js";
import {
  PATCH_FIELDS,
  type MenuPatchChange,
  type MenuPatchTarget,
  type QueuedDeclarationDrift,
} from "./menu-patch-types.js";
import { addSetMenuDishes } from "./set-menus.js";
import type { DocumentMember, FrozenOfferedModifier, MenuDocument } from "@waitron/shared";

const fx = useMenuDb();
beforeEach(async () => {
  await seedPerson(fx.db, { id: "person-1", displayName: "Test person-1" });
});

const languages: ContentLanguages = { defaultLanguage: "en", languages: ["en", "es"] };

async function liveLunch(
  prepare?: (tx: Transaction, f: MenusFixture) => Promise<void>,
): Promise<{ f: MenusFixture; document: MenuDocument }> {
  const f = await menusFixture(fx.db);
  return withTransaction(fx.db, async (tx) => {
    await prepare?.(tx, f);
    const { hash } = await previewMenu(tx, f.lunch);
    await publishMenu(tx, f.lunch, hash, "person-1");
    const live = (await liveVersions(tx, [f.lunch], "document")).get(f.lunch)!;
    return { f, document: live.document! };
  });
}

async function menuItem(f: MenusFixture, productId: string): Promise<string> {
  return withTransaction(fx.db, (tx) => offerOf(tx, f.lunch, productId));
}

function refusal(run: () => unknown): { code: string; params: unknown } {
  try {
    run();
  } catch (error) {
    if (isAppError(error)) return { code: error.code, params: error.params };
    throw error;
  }
  throw new Error("expected a refusal");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const MILK = productDeclarationValues({
  allergens: { milk: {} },
  dietOverride: { vegan: "no" },
  dietaryDeclarations: ["vegetarian"],
});
const NUTS = productDeclarationValues({
  allergens: { nuts: { kinds: ["walnuts"] } },
  dietOverride: null,
  dietaryDeclarations: ["halal"],
});
const EGGS = productDeclarationValues({
  allergens: { eggs: {} },
  dietOverride: { vegetarian: "yes" },
  dietaryDeclarations: ["vegan"],
});

describe("applyMenuPatch", () => {
  it("patches a dish's price on the menu, keeping a menu price in step", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const soup = await menuItem(f, f.soup);
    expect(document.offers[lemonade]!.grossPrice).toBe("2.80");
    expect(document.offers[soup]!.grossPrice).toBeNull();
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([
        { target: { kind: "offer", menuItemId: lemonade }, field: "price", value: "5.5" },
        { target: { kind: "offer", menuItemId: soup }, field: "price", value: "6" },
      ]),
      languages,
    );
    expect(patched.offers[lemonade]!.unitPrice).toBe("5.50");
    expect(patched.offers[lemonade]!.grossPrice).toBe("5.50");
    expect(patched.offers[soup]!.unitPrice).toBe("6.00");
    expect(patched.offers[soup]!.grossPrice).toBeNull();
  });

  it("patches a variant's price and leaves its dish alone", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const before = document.offers[lemonade]!;
    const large = before.variants.find((variant) => variant.id === f.large)!;
    expect(large.menuPrice).toBeNull();
    const target = { kind: "variant", menuItemId: lemonade, variantId: f.large };
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([{ target, field: "price", value: "4.25" }]),
      languages,
    );
    const offer = patched.offers[lemonade]!;
    const variant = offer.variants.find((v) => v.id === f.large)!;
    expect(variant.unitPrice).toBe("4.25");
    expect(variant.menuPrice).toBeNull();
    expect(variant.vatClass).toBe(large.vatClass);
    expect({ ...offer, variants: [] }).toEqual({ ...before, variants: [] });
  });

  it("keeps a variant's menu price in step when the menu sets one", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const withMenuPrice = structuredClone(document);
    withMenuPrice.offers[lemonade]!.variants[0]!.menuPrice = "3.10";
    const patched = applyMenuPatch(
      withMenuPrice,
      parseMenuPatch([
        {
          target: { kind: "variant", menuItemId: lemonade, variantId: f.large },
          field: "price",
          value: "3.9",
        },
      ]),
      languages,
    );
    expect(patched.offers[lemonade]!.variants[0]).toMatchObject({
      unitPrice: "3.90",
      menuPrice: "3.90",
    });
  });

  it("patching a dish leaves every variant as it was, but for its declarations", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const target = { kind: "offer", menuItemId: lemonade };
    const patched = applyMenuPatch(
      document,
      parseMenuPatch(
        PATCH_FIELDS.offer.map((field) => ({
          target,
          field,
          value: {
            name: "Lemon soda",
            customerName: { en: "Fizzy lemon" },
            kitchenName: "LEMSODA",
            description: { en: "Fresh" },
            image: "soda.jpg",
            price: "9",
            declarations: "product",
          }[field],
        })),
      ),
      languages,
      new Map([
        [f.lemonade, MILK],
        [f.large, NUTS],
      ]),
    );
    expect(patched.offers[lemonade]!.variants).toEqual(
      document.offers[lemonade]!.variants.map((variant) => ({ ...variant, ...NUTS })),
    );
    expect(patched.offers[lemonade]).toMatchObject({
      name: "Lemon soda",
      customerName: { en: "Fizzy lemon" },
      kitchenName: "LEMSODA",
      description: { en: "Fresh" },
      image: "soda.jpg",
      unitPrice: "9.00",
      grossPrice: "9.00",
    });
  });

  it("writes every variant field, trimming text and turning a blank kitchen name into none", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const target = { kind: "variant", menuItemId: lemonade, variantId: f.large };
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([
        { target, field: "name", value: "  Jumbo  " },
        { target, field: "customerName", value: { en: "A jug" } },
        { target, field: "kitchenName", value: "   " },
        { target, field: "image", value: null },
      ]),
      languages,
    );
    expect(patched.offers[lemonade]!.variants[0]).toMatchObject({
      name: "Jumbo",
      customerName: { en: "A jug" },
      kitchenName: null,
      image: null,
    });
    const kitchen = applyMenuPatch(
      document,
      parseMenuPatch([{ target, field: "kitchenName", value: " JMB " }]),
      languages,
    );
    expect(kitchen.offers[lemonade]!.variants[0]!.kitchenName).toBe("JMB");
  });

  it("merges translated text with the venue's languages", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const stored = structuredClone(document);
    stored.offers[lemonade]!.customerName = { en: "Lemon", es: "Limonada", fr: "Citronnade" };
    const target = { kind: "offer", menuItemId: lemonade };
    const merged = applyMenuPatch(
      stored,
      parseMenuPatch([{ target, field: "customerName", value: { en: "Lemonade", es: "  " } }]),
      languages,
    );
    expect(merged.offers[lemonade]!.customerName).toEqual({ en: "Lemonade", fr: "Citronnade" });

    const englishOnly = structuredClone(document);
    englishOnly.offers[lemonade]!.description = { en: "All about Lemonade" };
    const cleared = applyMenuPatch(
      englishOnly,
      parseMenuPatch([{ target, field: "description", value: { en: " ", es: "" } }]),
      languages,
    );
    expect(cleared.offers[lemonade]!.description).toBeNull();
    const nulled = applyMenuPatch(
      englishOnly,
      parseMenuPatch([{ target, field: "description", value: null }]),
      languages,
    );
    expect(nulled.offers[lemonade]!.description).toBeNull();
  });

  it("refuses translated text in a switched-off language that differs from what is stored", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    expect(
      refusal(() =>
        applyMenuPatch(
          document,
          [
            {
              target: { kind: "offer", menuItemId: lemonade },
              field: "customerName",
              value: { fr: "Citron" },
            },
          ],
          languages,
        ),
      ),
    ).toEqual({
      code: "menu_patch.invalid",
      params: { change: 0, field: "customerName", reason: "content.translation_invalid" },
    });
  });

  it("refuses a target the document does not hold", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const missing: MenuPatchChange[][] = [
      [{ target: { kind: "offer", menuItemId: "nope" }, field: "name", value: "X" }],
      [
        {
          target: { kind: "variant", menuItemId: lemonade, variantId: "nope" },
          field: "name",
          value: "X",
        },
      ],
      [
        {
          target: { kind: "variant", menuItemId: "nope", variantId: f.large },
          field: "name",
          value: "X",
        },
      ],
      [
        {
          target: { kind: "section", sectionId: "nope" },
          field: "internalName",
          value: "X",
        },
      ],
    ];
    for (const changes of missing) {
      expect(refusal(() => applyMenuPatch(document, changes, languages))).toEqual({
        code: "menu_patch.invalid",
        params: { change: 0, field: "target" },
      });
    }
  });

  it("refuses an id the document's dishes only inherit, as one it does not hold", async () => {
    const { f, document } = await liveLunch();
    const holders: Record<string, unknown>[] = [
      Object.prototype as Record<string, unknown>,
      Object as unknown as Record<string, unknown>,
      Object.prototype.hasOwnProperty as unknown as Record<string, unknown>,
    ];
    try {
      for (const inherited of ["__proto__", "constructor", "hasOwnProperty"]) {
        const targets = [
          { kind: "offer", menuItemId: inherited },
          { kind: "variant", menuItemId: inherited, variantId: f.large },
        ] as const;
        for (const target of targets) {
          expect(
            refusal(() =>
              applyMenuPatch(document, [{ target, field: "kitchenName", value: "X" }], languages),
            ),
          ).toEqual({ code: "menu_patch.invalid", params: { change: 0, field: "target" } });
          expect(patchFieldValue(document, target, "kitchenName", languages)).toBeUndefined();
        }
      }
      expect(holders.map((holder) => Object.hasOwn(holder, "kitchenName"))).toEqual([
        false,
        false,
        false,
      ]);
    } finally {
      for (const holder of holders) delete holder.kitchenName;
    }
  });

  it("never mutates the document it is given", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const frozen = deepFreeze(structuredClone(document));
    const snapshot = structuredClone(frozen);
    const patched = applyMenuPatch(
      frozen,
      parseMenuPatch([
        { target: { kind: "offer", menuItemId: lemonade }, field: "name", value: "Soda" },
        {
          target: { kind: "variant", menuItemId: lemonade, variantId: f.large },
          field: "price",
          value: "1",
        },
      ]),
      languages,
    );
    expect(frozen).toEqual(snapshot);
    expect(patched.offers[lemonade]!.name).toBe("Soda");
  });
});

async function bothDishesOfferLists(tx: Transaction, f: MenusFixture): Promise<void> {
  await writeProductModifiers(tx, f.soup, [
    { kind: "extras", id: f.extrasList },
    { kind: "options", id: f.iceList },
  ]);
}

function listsOf(document: MenuDocument, id: string): FrozenOfferedModifier[] {
  return Object.values(document.offers).flatMap((offer) =>
    offer.offeredModifiers.filter((list) => list.id === id),
  );
}

const extrasLists = (document: MenuDocument, id: string) =>
  listsOf(document, id).flatMap((list) => (list.kind === "extras" ? [list] : []));

const optionsLists = (document: MenuDocument, id: string) =>
  listsOf(document, id).flatMap((list) => (list.kind === "options" ? [list] : []));

function sectionCopies(members: readonly DocumentMember[], sectionId: string) {
  return members.flatMap((member): Extract<DocumentMember, { kind: "section" }>[] =>
    member.kind === "section"
      ? [
          ...(member.sectionId === sectionId ? [member] : []),
          ...sectionCopies(member.members, sectionId),
        ]
      : [],
  );
}

/** Lunch reaches Drinks twice: as its own folder, and inside Bar through a folder fixing its names. */
async function drinksTwice(tx: Transaction, f: MenusFixture): Promise<void> {
  const bar = (
    await createSectionIn(tx, f.lunchRoot, { internalName: "Bar", names: { en: "Bar" } })
  ).id;
  const member = await addMember(tx, bar, section(f.drinks));
  await setIncludeFolder(tx, bar, member.id, {
    showAsFolder: true,
    overrides: { names: { en: "Bar drinks" } },
  });
}

describe("applyMenuPatch on every copy", () => {
  it("patches an extra's price on every dish that offers its list", async () => {
    const { f, document } = await liveLunch(bothDishesOfferLists);
    const target = { kind: "extra", listId: f.extrasList, productId: f.extraLemon } as const;
    const before = extrasLists(document, f.extrasList);
    expect(before).toHaveLength(2);
    expect(patchFieldValue(document, target, "price")).toBe("0.40");
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([
        { target, field: "price", value: "0.6" },
        { target, field: "image", value: " lemon.jpg " },
      ]),
      languages,
    );
    const items = extrasLists(patched, f.extrasList).map((list) =>
      list.items.find((item) => item.productId === f.extraLemon)!,
    );
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toMatchObject({ price: "0.60", image: "lemon.jpg" });
      expect(item).not.toHaveProperty("unitPrice");
      expect(item.presentation).toEqual(
        before[0]!.items.find((candidate) => candidate.productId === f.extraLemon)!.presentation,
      );
    }
    expect(patchFieldValue(patched, target, "price")).toBe("0.60");
  });

  it("rewrites an extra's presentation with its wording", async () => {
    const { f, document } = await liveLunch(bothDishesOfferLists);
    const target = { kind: "extra", listId: f.extrasList, productId: f.extraLemon } as const;
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([
        { target, field: "name", value: "Lemon slice" },
        { target, field: "customerName", value: { en: "A slice of lemon" } },
        { target, field: "kitchenName", value: "SLICE" },
      ]),
      languages,
    );
    for (const list of extrasLists(patched, f.extrasList)) {
      const item = list.items.find((candidate) => candidate.productId === f.extraLemon)!;
      expect(item).toMatchObject({
        name: "Lemon slice",
        customerName: { en: "A slice of lemon" },
        kitchenName: "SLICE",
      });
      expect(item.presentation).toEqual({
        name: "Lemon slice",
        customerName: { en: "A slice of lemon" },
        kitchenName: "SLICE",
        variantName: null,
        variantCustomerName: null,
        variantKitchenName: null,
      });
    }
    const variantExtra = structuredClone(document);
    for (const list of extrasLists(variantExtra, f.extrasList))
      list.items[0]!.presentation = {
        ...list.items[0]!.presentation,
        variantName: "Big",
        variantCustomerName: { en: "Big" },
        variantKitchenName: "BIG",
      };
    const kitchenOnly = applyMenuPatch(
      variantExtra,
      parseMenuPatch([{ target, field: "kitchenName", value: null }]),
      languages,
    );
    const [first] = extrasLists(kitchenOnly, f.extrasList);
    expect(first!.items[0]!.presentation).toEqual({
      name: first!.items[0]!.name,
      customerName: first!.items[0]!.customerName,
      kitchenName: null,
      variantName: null,
      variantCustomerName: null,
      variantKitchenName: null,
    });
  });

  it("patches an option label and a list name in every copy", async () => {
    const { f, document } = await liveLunch(bothDishesOfferLists);
    const label = { kind: "option_label", listId: f.iceList, labelId: NO_ICE } as const;
    const list = { kind: "list", listKind: "options", listId: f.iceList } as const;
    const extras = { kind: "list", listKind: "extras", listId: f.extrasList };
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([
        { target: label, field: "name", value: "Without ice" },
        { target: label, field: "customerName", value: { en: "Straight" } },
        { target: label, field: "kitchenName", value: "NOICE" },
        { target: list, field: "name", value: "Ice choice" },
        { target: extras, field: "kitchenName", value: "ADD" },
      ]),
      languages,
    );
    const ice = optionsLists(patched, f.iceList);
    expect(ice).toHaveLength(2);
    for (const copy of ice) {
      expect(copy.name).toBe("Ice choice");
      expect(copy.labels.find((candidate) => candidate.id === NO_ICE)).toMatchObject({
        name: "Without ice",
        customerName: { en: "Straight" },
        kitchenName: "NOICE",
      });
    }
    const added = extrasLists(patched, f.extrasList);
    expect(added.map((copy) => copy.kitchenName)).toEqual(["ADD", "ADD"]);
    expect(patchFieldValue(patched, label, "name")).toBe("Without ice");
    expect(patchFieldValue(patched, list, "name")).toBe("Ice choice");
  });

  it("patches a section everywhere it appears, except where an included folder fixes it", async () => {
    const { f, document } = await liveLunch(drinksTwice);
    const before = sectionCopies(document.root.members, f.drinks);
    expect(before.map((copy) => copy.fixed)).toEqual([undefined, { names: { en: "Bar drinks" } }]);
    expect(before.map((copy) => copy.names)).toEqual([
      { en: "Something to drink" },
      { en: "Bar drinks" },
    ]);
    const target = { kind: "section", sectionId: f.drinks } as const;
    expect(patchFieldValue(document, target, "names")).toEqual({
      en: "Something to drink",
    });
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([
        { target, field: "internalName", value: " Drinks list " },
        { target, field: "names", value: { en: "To drink" } },
        { target, field: "image", value: "drinks.jpg" },
      ]),
      languages,
    );
    const [direct, fixed] = sectionCopies(patched.root.members, f.drinks);
    expect(direct).toMatchObject({
      internalName: "Drinks list",
      names: { en: "To drink" },
      image: "drinks.jpg",
    });
    expect(fixed).toMatchObject({
      internalName: "Drinks list",
      names: { en: "Bar drinks" },
      image: "drinks.jpg",
      fixed: { names: { en: "Bar drinks" } },
    });
    expect(sectionCopies(patched.root.members, f.beer)).toHaveLength(2);
    const beer = applyMenuPatch(
      document,
      parseMenuPatch([
        { target: { kind: "section", sectionId: f.beer }, field: "image", value: "beer.jpg" },
      ]),
      languages,
    );
    expect(sectionCopies(beer.root.members, f.beer).map((copy) => copy.image)).toEqual([
      "beer.jpg",
      "beer.jpg",
    ]);
  });

  it("stores a section's cleared names as no names", async () => {
    const { f, document } = await liveLunch();
    const target = { kind: "section", sectionId: f.drinks };
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([{ target, field: "names", value: { en: " ", es: "" } }]),
      languages,
    );
    expect(sectionCopies(patched.root.members, f.drinks)[0]!.names).toEqual({});
    const nulled = applyMenuPatch(
      document,
      parseMenuPatch([{ target, field: "names", value: null }]),
      languages,
    );
    expect(sectionCopies(nulled.root.members, f.drinks)[0]!.names).toEqual({});
  });

  it("refuses a target the version does not hold", async () => {
    const { f, document } = await liveLunch(drinksTwice);
    const missing: MenuPatchChange["target"][] = [
      { kind: "extra", listId: f.extrasList, productId: f.soup },
      { kind: "extra", listId: f.iceList, productId: f.extraLemon },
      { kind: "option_label", listId: f.iceList, labelId: "nope" },
      { kind: "option_label", listId: f.extrasList, labelId: NO_ICE },
      { kind: "list", listKind: "extras", listId: f.iceList },
      { kind: "list", listKind: "options", listId: "nope" },
      { kind: "section", sectionId: f.mains },
    ];
    for (const target of missing) {
      const field = target.kind === "section" ? "internalName" : "name";
      expect(
        refusal(() => applyMenuPatch(document, [{ target, field, value: "X" }], languages)),
      ).toEqual({ code: "menu_patch.invalid", params: { change: 0, field: "target" } });
      expect(patchFieldValue(document, target, field)).toBeUndefined();
    }
    const everyCopyFixed = structuredClone(document);
    for (const copy of sectionCopies(everyCopyFixed.root.members, f.drinks))
      copy.fixed = { names: { en: "Fixed", es: "Fijo" }, image: null };
    const names = { kind: "section", sectionId: f.drinks } as const;
    expect(
      refusal(() =>
        applyMenuPatch(
          everyCopyFixed,
          [{ target: names, field: "image", value: "x.jpg" }],
          languages,
        ),
      ),
    ).toEqual({ code: "menu_patch.invalid", params: { change: 0, field: "target" } });
    expect(
      refusal(() =>
        applyMenuPatch(everyCopyFixed, [{ target: names, field: "names", value: null }], languages),
      ),
    ).toEqual({ code: "menu_patch.invalid", params: { change: 0, field: "target" } });
    expect(patchFieldValue(everyCopyFixed, names, "image")).toBeUndefined();
    expect(patchFieldValue(everyCopyFixed, names, "names", languages)).toBeUndefined();
    expect(patchFieldValue(everyCopyFixed, names, "internalName")).toBe("Drinks");
  });

  it("rethrows a fault that is not a refusal", async () => {
    const { f, document } = await liveLunch();
    const target = { kind: "section", sectionId: f.drinks } as const;
    const throwing = {
      get en(): string {
        throw new TypeError("boom");
      },
    };
    expect(() => parseMenuPatch([{ target, field: "names", value: throwing }])).toThrow(TypeError);
    // Reads 1 and 2 are the two parses; the third is the merge.
    let readsOfEn = 0;
    const throwsInMerge = {
      get en(): string {
        readsOfEn += 1;
        if (readsOfEn > 2) throw new TypeError("boom");
        return "Drinks";
      },
    };
    const [change] = parseMenuPatch([{ target, field: "names", value: throwsInMerge }]);
    expect(() => applyMenuPatch(document, [change!], languages)).toThrow(TypeError);
    expect(readsOfEn).toBe(3);
  });

  it("patches the languages a folder does not fix, and skips a folder fixing them all", async () => {
    const { f, document } = await liveLunch(async (tx, f) => {
      await drinksTwice(tx, f);
      await writeContentLanguages(tx, languages);
      await updateMenuDetails(tx, f.drinksMenu, {
        names: { en: "Something to drink", es: "Algo de beber" },
      });
    });
    const target = { kind: "section", sectionId: f.drinks } as const;
    expect(sectionCopies(document.root.members, f.drinks).map((copy) => copy.names)).toEqual([
      { en: "Something to drink", es: "Algo de beber" },
      { en: "Bar drinks", es: "Algo de beber" },
    ]);
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([{ target, field: "names", value: { en: "To drink", es: "Bebidas" } }]),
      languages,
    );
    const [direct, folder] = sectionCopies(patched.root.members, f.drinks);
    expect(direct!.names).toEqual({ en: "To drink", es: "Bebidas" });
    expect(folder!.names).toEqual({ en: "Bar drinks", es: "Bebidas" });
    expect(folder!.fixed).toEqual({ names: { en: "Bar drinks" } });
    const cleared = applyMenuPatch(
      document,
      parseMenuPatch([{ target, field: "names", value: null }]),
      languages,
    );
    expect(sectionCopies(cleared.root.members, f.drinks).map((copy) => copy.names)).toEqual([
      {},
      { en: "Bar drinks" },
    ]);

    const blankFixed = structuredClone(document);
    sectionCopies(blankFixed.root.members, f.drinks)[1]!.fixed = { names: { es: " " } };
    sectionCopies(blankFixed.root.members, f.drinks)[0]!.fixed = { names: { en: "Ours" } };
    expect(patchFieldValue(blankFixed, target, "names")).toEqual({
      en: "Something to drink",
      es: "Algo de beber",
    });
    const dropped = applyMenuPatch(
      blankFixed,
      parseMenuPatch([{ target, field: "names", value: { en: "To drink", es: "Bebidas" } }]),
      languages,
    );
    expect(sectionCopies(dropped.root.members, f.drinks).map((copy) => copy.names)).toEqual([
      { en: "Ours", es: "Bebidas" },
      { en: "To drink" },
    ]);

    const fixedEverywhere = structuredClone(document);
    sectionCopies(fixedEverywhere.root.members, f.drinks)[1]!.fixed = {
      names: { en: "Bar drinks", es: "Barra" },
    };
    fixedEverywhere.root.members = [...fixedEverywhere.root.members].reverse();
    expect(patchFieldValue(fixedEverywhere, target, "names")).toEqual({
      en: "Something to drink",
      es: "Algo de beber",
    });
    const skipped = applyMenuPatch(
      fixedEverywhere,
      parseMenuPatch([{ target, field: "names", value: { en: "To drink", es: "Bebidas" } }]),
      languages,
    );
    expect(sectionCopies(skipped.root.members, f.drinks).map((copy) => copy.names)).toEqual([
      { en: "Bar drinks", es: "Algo de beber" },
      { en: "To drink", es: "Bebidas" },
    ]);
  });
});

describe("a section shown through folders fixing different languages", () => {
  /** Lunch shows Drinks through a folder fixing its English name, and inside Bar through one
   * fixing its Spanish name. */
  async function eachFolderFixesOneLanguage(tx: Transaction, f: MenusFixture): Promise<void> {
    await writeContentLanguages(tx, languages);
    await updateMenuDetails(tx, f.drinksMenu, {
      names: { en: "Base English", es: "Base Spanish" },
    });
    const structure = await readMenuStructure(tx, f.lunch);
    const member = structure.root.members.find(
      (candidate) => candidate.ref.kind === "section" && candidate.ref.sectionId === f.drinks,
    )!;
    await setIncludeFolder(tx, f.lunchRoot, member.id, {
      showAsFolder: true,
      overrides: { names: { en: "Fixed English" } },
    });
    const bar = await createSectionIn(tx, f.lunchRoot, {
      internalName: "Bar",
      names: { en: "Bar" },
    });
    const second = await addMember(tx, bar.id, section(f.drinks));
    await setIncludeFolder(tx, bar.id, second.id, {
      showAsFolder: true,
      overrides: { names: { es: "Fixed Spanish" } },
    });
  }

  it("reads each language from a copy that takes it, so editing one leaves the other's copies alone", async () => {
    const { f, document } = await liveLunch(eachFolderFixesOneLanguage);
    const target = { kind: "section", sectionId: f.drinks } as const;
    expect(sectionCopies(document.root.members, f.drinks).map((copy) => copy.names)).toEqual([
      { en: "Fixed English", es: "Base Spanish" },
      { en: "Base English", es: "Fixed Spanish" },
    ]);
    const live = patchFieldValue(document, target, "names", languages) as Record<string, string>;
    expect(live).toEqual({ en: "Base English", es: "Base Spanish" });
    expect(fixedLanguages(document, target, "names", languages)).toEqual([]);
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([{ target, field: "names", value: { ...live, es: "Changed Spanish" } }]),
      languages,
    );
    expect(sectionCopies(patched.root.members, f.drinks).map((copy) => copy.names)).toEqual([
      { en: "Fixed English", es: "Changed Spanish" },
      { en: "Base English", es: "Fixed Spanish" },
    ]);
  });

  it("names a language every copy fixes, and shows its fixed text", async () => {
    const { f, document } = await liveLunch(async (tx, f) => {
      await writeContentLanguages(tx, languages);
      await updateMenuDetails(tx, f.drinksMenu, {
        names: { en: "Base English", es: "Base Spanish" },
      });
    });
    const target = { kind: "section", sectionId: f.drinks } as const;
    const [only] = sectionCopies(document.root.members, f.drinks);
    only!.names = { en: "Fixed English", es: "Base Spanish" };
    only!.fixed = { names: { en: "Fixed English" } };
    expect(fixedLanguages(document, target, "names", languages)).toEqual(["en"]);
    expect(patchFieldValue(document, target, "names", languages)).toEqual({
      en: "Fixed English",
      es: "Base Spanish",
    });
    expect(fixedLanguages(document, target, "internalName", languages)).toEqual([]);
    const lemonade = await menuItem(f, f.lemonade);
    expect(
      fixedLanguages(document, { kind: "offer", menuItemId: lemonade }, "customerName", languages),
    ).toEqual([]);
    expect(
      fixedLanguages(document, { kind: "section", sectionId: "nope" }, "names", languages),
    ).toEqual([]);
  });
});

describe("the VAT classes", () => {
  it.each(["vatClass", "takeawayVatClass"])(
    "%s is no longer patched: a change naming it is refused as a field outside the list",
    (field) => {
      const targets = [
        { kind: "offer", menuItemId: "i" },
        { kind: "variant", menuItemId: "i", variantId: "v" },
        { kind: "extra", listId: "l", productId: "p" },
      ];
      for (const target of targets)
        expect(refusal(() => parseMenuPatch([{ target, field, value: "general" }]))).toEqual({
          code: "menu_patch.invalid",
          params: { change: 0, field: "field" },
        });
    },
  );
});

describe("parseMenuPatch", () => {
  const offer = { kind: "offer", menuItemId: "item-1" };

  it("accepts every target kind with each of its fields", () => {
    const targets = {
      offer,
      variant: { kind: "variant", menuItemId: "item-1", variantId: "variant-1" },
      extra: { kind: "extra", listId: "list-1", productId: "product-1" },
      option_label: { kind: "option_label", listId: "list-1", labelId: "label-1" },
      list: { kind: "list", listKind: "options", listId: "list-1" },
      section: { kind: "section", sectionId: "section-1" },
    } as const;
    const values: Record<string, unknown> = {
      name: " Lemonade ",
      internalName: "Drinks",
      customerName: null,
      names: { en: "Drinks" },
      kitchenName: null,
      description: { en: "Fresh" },
      image: "a.jpg",
      price: "2",
      declarations: "product",
    };
    const body = Object.entries(PATCH_FIELDS).flatMap(([kind, fields]) =>
      fields.map((field) => ({
        target: targets[kind as keyof typeof targets],
        field,
        value: values[field],
      })),
    );
    const parsed = parseMenuPatch(body);
    expect(parsed).toHaveLength(body.length);
    expect(parsed[0]).toEqual({ target: offer, field: "name", value: "Lemonade" });
    expect(
      parseMenuPatch([
        { target: { kind: "list", listKind: "extras", listId: "l" }, field: "name", value: "E" },
      ]),
    ).toHaveLength(1);
  });

  it("refuses a field outside the list, naming the change", () => {
    for (const field of ["unit", "allergens", "dietaryDeclarations", "color", 7]) {
      expect(
        refusal(() =>
          parseMenuPatch([
            { target: offer, field: "name", value: "Fine" },
            { target: offer, field, value: "x" },
          ]),
        ),
      ).toEqual({ code: "menu_patch.invalid", params: { change: 1, field: "field" } });
    }
    expect(
      refusal(() =>
        parseMenuPatch([
          {
            target: { kind: "variant", menuItemId: "i", variantId: "v" },
            field: "description",
            value: null,
          },
        ]),
      ),
    ).toEqual({ code: "menu_patch.invalid", params: { change: 0, field: "field" } });
  });

  it("refuses a target it cannot read", () => {
    const targets: unknown[] = [
      { kind: "dish", menuItemId: "i" },
      { kind: "offer" },
      { kind: "offer", menuItemId: "" },
      { kind: "variant", menuItemId: "i" },
      { kind: "extra", listId: "l" },
      { kind: "option_label", listId: "l" },
      { kind: "section", sectionId: 4 },
      { kind: "list", listKind: "sauces", listId: "l" },
      { kind: "toString" },
      null,
      "offer",
    ];
    for (const target of targets) {
      expect(refusal(() => parseMenuPatch([{ target, field: "name", value: "x" }]))).toEqual({
        code: "menu_patch.invalid",
        params: { change: 0, field: "target" },
      });
    }
    for (const change of [null, "change", []]) {
      expect(refusal(() => parseMenuPatch([change]))).toEqual({
        code: "menu_patch.invalid",
        params: { change: 0, field: "target" },
      });
    }
  });

  it("refuses a body that is not a list of changes as a malformed request", () => {
    for (const body of [null, {}, "changes", { changes: [] }]) {
      expect(refusal(() => parseMenuPatch(body))).toEqual({
        code: "management.request_invalid",
        params: { field: "changes" },
      });
    }
  });

  it("refuses each bad value under its field", () => {
    const variant = { kind: "variant", menuItemId: "i", variantId: "v" };
    const section = { kind: "section", sectionId: "s" };
    const bad: [unknown, string, unknown, string?][] = [
      [offer, "price", "abc"],
      [offer, "price", "-1"],
      [offer, "price", 5],
      [offer, "name", "   "],
      [offer, "name", null],
      [section, "internalName", ""],
      [offer, "kitchenName", 3],
      [offer, "customerName", "Lemonade"],
      [offer, "customerName", ["en"]],
      [offer, "description", { english: "Fresh" }, "content.translation_invalid"],
      [section, "names", { en: 3 }, "content.translation_invalid"],
      [offer, "image", ""],
      [offer, "image", "   "],
      [variant, "image", 4],
    ];
    for (const [target, field, value, reason] of bad) {
      expect(refusal(() => parseMenuPatch([{ target, field, value }]))).toEqual({
        code: "menu_patch.invalid",
        params: { change: 0, field, ...(reason === undefined ? {} : { reason }) },
      });
    }
  });
});

describe("patchFieldValue", () => {
  it("patchFieldValue reads the current value, or undefined for a missing target", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const dish = { kind: "offer", menuItemId: lemonade } as const;
    const large = { kind: "variant", menuItemId: lemonade, variantId: f.large } as const;
    expect(patchFieldValue(document, dish, "price")).toBe("2.80");
    expect(patchFieldValue(document, dish, "name")).toBe("Lemonade");
    expect(patchFieldValue(document, dish, "description")).toEqual({ en: "All about Lemonade" });
    expect(patchFieldValue(document, large, "price")).toBe("3.50");
    expect(patchFieldValue(document, large, "kitchenName")).toBe("LRG");
    expect(
      patchFieldValue(document, { kind: "offer", menuItemId: "nope" }, "name"),
    ).toBeUndefined();
    expect(
      patchFieldValue(
        document,
        { kind: "variant", menuItemId: lemonade, variantId: "nope" },
        "name",
      ),
    ).toBeUndefined();
    expect(
      patchFieldValue(document, { kind: "section", sectionId: "nope" }, "internalName"),
    ).toBeUndefined();
    for (const field of ["unit", "__proto__", "constructor", "names"])
      expect(patchFieldValue(document, dish, field)).toBeUndefined();
  });
});

describe("declarations", () => {
  async function addSetMenu(tx: Transaction, f: MenusFixture): Promise<void> {
    const { id } = await createMenu(tx, {
      name: "Daily menu",
      names: { en: "Daily menu" },
      kind: "set_menu",
      setPrice: "14.00",
    });
    await tx.update(products).set({ courseId: f.course }).where(eq(products.id, f.lemonade));
    await addSetMenuDishes(tx, id, [{ productId: f.lemonade, excludedVariantIds: [] }]);
    await addMember(tx, f.lunchRoot, { kind: "set_menu", menuId: id });
  }

  const setMenuOffers = (document: MenuDocument) =>
    Object.values(document.setMenus ?? {}).flatMap(({ offers }) => Object.values(offers));
  const offers = (document: MenuDocument) => [
    ...Object.values(document.offers),
    ...setMenuOffers(document),
  ];
  const extraItems = (document: MenuDocument, productId: string) =>
    offers(document).flatMap(({ offeredModifiers }) =>
      offeredModifiers.flatMap((list) =>
        list.kind === "extras" ? list.items.filter((item) => item.productId === productId) : [],
      ),
    );
  const extraValues = ({ allergens }: DeclarationValues, suitableFor: string[]) => ({
    addAllergens: allergens,
    suitableFor,
  });

  async function lunchWithSetMenu() {
    const { f, document } = await liveLunch(addSetMenu);
    const lemonade = await menuItem(f, f.lemonade);
    const targets = {
      dish: { kind: "offer", menuItemId: lemonade },
      variant: { kind: "variant", menuItemId: lemonade, variantId: f.large },
      extra: { kind: "extra", listId: f.extrasList, productId: f.extraLemon },
      soup: { kind: "offer", menuItemId: await menuItem(f, f.soup) },
    } as const satisfies Record<string, MenuPatchTarget>;
    return { f, document, targets };
  }
  const declarations = (...targets: MenuPatchTarget[]): MenuPatchChange[] =>
    targets.map((target) => ({ target, field: "declarations", value: "product" }));

  it("declarations copies the product's values to the dish, its set-menu copies, a variant and an extra", async () => {
    const { f, document, targets } = await lunchWithSetMenu();
    const current = new Map([
      [f.lemonade, MILK],
      [f.large, NUTS],
      [f.extraLemon, EGGS],
    ]);
    const patched = applyMenuPatch(
      document,
      declarations(targets.dish, targets.variant, targets.extra),
      languages,
      current,
    );
    const dishes = offers(patched).filter(({ productId }) => productId === f.lemonade);
    expect(dishes).toHaveLength(2);
    for (const dish of dishes) {
      expect(dish).toMatchObject(MILK);
      expect(dish.variants.find(({ id }) => id === f.large)).toMatchObject(NUTS);
    }
    const extras = extraItems(patched, f.extraLemon);
    expect(extras).toHaveLength(2);
    for (const extra of extras)
      expect(extra).toMatchObject(extraValues(EGGS, ["vegan", "vegetarian", "no_meat", "no_fish"]));
    const soup = targets.soup.menuItemId;
    expect(patched.offers[soup]).toEqual(document.offers[soup]);
  });

  it("a dish's declarations take every copy's variants, each with its own values", async () => {
    const { f, document, targets } = await lunchWithSetMenu();
    const patched = applyMenuPatch(
      document,
      declarations(targets.dish),
      languages,
      new Map([
        [f.lemonade, MILK],
        [f.large, NUTS],
      ]),
    );
    const dishes = offers(patched).filter(({ productId }) => productId === f.lemonade);
    expect(dishes).toHaveLength(2);
    for (const dish of dishes) {
      expect(dish).toMatchObject(MILK);
      expect(dish.variants).toHaveLength(1);
      expect(dish.variants[0]).toMatchObject({ id: f.large, ...NUTS });
    }
  });

  it("copies an unreviewed product's allergens as null", async () => {
    const { f, document, targets } = await lunchWithSetMenu();
    const unreviewed = productDeclarationValues();
    const patched = applyMenuPatch(
      document,
      declarations(targets.dish, targets.extra),
      languages,
      new Map([
        [f.lemonade, unreviewed],
        [f.large, unreviewed],
        [f.extraLemon, unreviewed],
      ]),
    );
    expect(document.offers[targets.dish.menuItemId]!.allergens).toEqual({});
    expect(patched.offers[targets.dish.menuItemId]!.allergens).toBeNull();
    expect(extraItems(patched, f.extraLemon)[0]!.addAllergens).toBeNull();
  });

  it('refuses a declarations value other than "product"', () => {
    const target = { kind: "offer", menuItemId: "item-1" };
    for (const value of [null, {}, { milk: {} }, "Product", true])
      expect(refusal(() => parseMenuPatch([{ target, field: "declarations", value }]))).toEqual({
        code: "menu_patch.invalid",
        params: { change: 0, field: "declarations" },
      });
  });

  it("refuses a product whose declarations it was not given", async () => {
    const { document, targets } = await lunchWithSetMenu();
    for (const current of [undefined, new Map<string, DeclarationValues>()])
      for (const target of [targets.dish, targets.variant, targets.extra])
        expect(
          refusal(() => applyMenuPatch(document, declarations(target), languages, current)),
        ).toEqual({ code: "menu_patch.invalid", params: { change: 0, field: "declarations" } });
  });

  it("patchFieldValue reads the frozen declarations", async () => {
    const { f, document, targets } = await lunchWithSetMenu();
    const patched = applyMenuPatch(
      document,
      declarations(targets.dish, targets.variant, targets.extra),
      languages,
      new Map([
        [f.lemonade, MILK],
        [f.large, NUTS],
        [f.extraLemon, EGGS],
      ]),
    );
    expect(patchFieldValue(patched, targets.dish, "declarations")).toEqual(MILK);
    expect(patchFieldValue(patched, targets.variant, "declarations")).toEqual(NUTS);
    expect(patchFieldValue(patched, targets.extra, "declarations")).toEqual(
      extraValues(EGGS, ["vegan", "vegetarian", "no_meat", "no_fish"]),
    );
  });

  it("names the products a declarations change copies from, and no other change's", async () => {
    const { f, document, targets } = await lunchWithSetMenu();
    const ids = (...changes: MenuPatchChange[]) => declarationProductIds(document, changes);
    expect(ids(...declarations(targets.dish))).toEqual([f.lemonade, f.large]);
    expect(ids(...declarations(targets.variant))).toEqual([f.large]);
    expect(ids(...declarations(targets.extra))).toEqual([f.extraLemon]);
    expect(ids({ target: targets.dish, field: "price", value: "2.00" })).toEqual([]);
    expect(ids(...declarations({ kind: "offer", menuItemId: "nope" }))).toEqual([]);
  });

  it("answers every copy a declarations change corrects, the target's own product's first", async () => {
    const { f, document, targets } = await lunchWithSetMenu();
    const set = setMenuOffers(document)[0]!;
    Object.assign(set, MILK);
    set.variants.push({ ...structuredClone(set.variants[0]!), id: "set-only", name: "Jug" });
    const held = productDeclarationValues({
      allergens: {},
      dietOverride: null,
      dietaryDeclarations: [],
    });
    const dish = { productId: f.lemonade, name: "Lemonade" };
    const large = { productId: f.large, name: "Large", values: held };
    expect(correctedCopies(document, targets.dish)).toEqual([
      { ...dish, values: held },
      large,
      { ...dish, values: MILK },
      large,
      { productId: "set-only", name: "Jug", values: held },
    ]);
    expect(correctedCopies(document, targets.variant)).toEqual([large, large]);
    const extra = {
      productId: f.extraLemon,
      name: "Extra lemon",
      values: declarationsFor("extra", held),
    };
    expect(correctedCopies(document, targets.extra)).toEqual([extra, extra]);
    expect(correctedCopies(document, { kind: "offer", menuItemId: "nope" })).toEqual([]);
  });

  describe("on queued versions", () => {
    const AT = new Date("2026-10-08T06:00:00.000Z");
    const drift = (
      document: MenuDocument,
      live: MenuDocument,
      current: ReadonlyMap<string, DeclarationValues>,
    ) =>
      queuedDeclarationDrift(
        [{ versionId: "v2", activatesAt: AT, document }],
        current,
        liveDeclarations(live),
      );
    const listed = (
      ...targets: { target: MenuPatchTarget; stillOld: boolean; replaces?: unknown }[]
    ) => [
      {
        versionId: "v2",
        activatesAt: AT.toISOString(),
        targets: targets.map((entry) =>
          entry.stillOld ? entry : { ...entry, replaces: expect.any(Array) },
        ),
      },
    ];
    const allOf = (
      f: MenusFixture,
      values: Partial<Record<"dish" | "variant" | "extra", DeclarationValues>>,
    ) => {
      const reviewed = productDeclarationValues({
        allergens: {},
        dietOverride: null,
        dietaryDeclarations: [],
      });
      return new Map(
        [f.soup, f.lager]
          .map((id) => [id, reviewed] as const)
          .concat([
            [f.lemonade, values.dish ?? reviewed],
            [f.large, values.variant ?? reviewed],
            [f.extraLemon, values.extra ?? reviewed],
          ]),
      );
    };

    it("lists a queued version's dish, variant and extra that differ, and nothing when they agree", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      expect(drift(document, document, allOf(f, {}))).toEqual([]);
      expect(drift(document, document, allOf(f, { dish: MILK }))).toEqual(
        listed({ target: targets.dish, stillOld: true }),
      );
      expect(drift(document, document, allOf(f, { variant: NUTS }))).toEqual(
        listed(
          { target: targets.dish, stillOld: true },
          { target: targets.variant, stillOld: true },
        ),
      );
      expect(drift(document, document, allOf(f, { extra: EGGS }))).toEqual(
        listed({ target: targets.extra, stillOld: true }),
      );
    });

    it("stillOld is true only when every differing copy holds the live version's value of its product", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const current = allOf(f, { dish: MILK });
      const stillOld = (queued: MenuDocument, live = document) =>
        drift(queued, live, current)[0]!.targets[0]!.stillOld;
      expect(stillOld(document)).toBe(true);

      for (const copyOf of [
        (queued: MenuDocument) => queued.offers[targets.dish.menuItemId]!,
        (queued: MenuDocument) => setMenuOffers(queued)[0]!,
      ]) {
        const thirdValue = structuredClone(document);
        Object.assign(copyOf(thirdValue), NUTS);
        expect(stillOld(thirdValue)).toBe(false);
      }

      const corrected = structuredClone(document);
      Object.assign(setMenuOffers(corrected)[0]!, MILK);
      expect(stillOld(corrected)).toBe(true);

      const lacking = structuredClone(document);
      delete lacking.setMenus;
      expect(drift(document, lacking, current)).toEqual(
        listed({ target: targets.dish, stillOld: true }),
      );
      expect(drift(document, lacking, allOf(f, { extra: EGGS }))).toEqual(
        listed({ target: targets.extra, stillOld: true }),
      );
    });

    it("stillOld is false when the live version's own copies disagree", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      for (const copyOf of [
        (live: MenuDocument) => live.offers[targets.dish.menuItemId]!,
        (live: MenuDocument) => setMenuOffers(live)[0]!,
      ]) {
        const live = structuredClone(document);
        Object.assign(copyOf(live), NUTS);
        expect(drift(document, live, allOf(f, { dish: MILK }))).toEqual(
          listed({ target: targets.dish, stillOld: false }),
        );
      }
    });

    it("a variant's third value unticks its dish too", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const queued = structuredClone(document);
      Object.assign(setMenuOffers(queued)[0]!.variants[0]!, NUTS);
      expect(drift(queued, document, allOf(f, { dish: MILK, variant: MILK }))).toEqual(
        listed(
          { target: targets.dish, stillOld: false },
          { target: targets.variant, stillOld: false },
        ),
      );
    });

    it("a target not still old carries each distinct value a correction writes over, its own product's first", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const queued = structuredClone(document);
      Object.assign(setMenuOffers(queued)[0]!.variants[0]!, NUTS);
      const [{ targets: listedTargets }] = drift(
        queued,
        document,
        allOf(f, { dish: MILK, variant: MILK }),
      ) as [QueuedDeclarationDrift];
      const reviewed = allOf(f, {}).get(f.soup)!;
      const large = (values: DeclarationValues) => ({
        productId: f.large,
        name: "Large",
        values,
      });
      expect(listedTargets.map(({ replaces }) => replaces)).toEqual([
        [
          { productId: f.lemonade, name: "Lemonade", values: reviewed },
          large(reviewed),
          large(NUTS),
        ],
        [large(reviewed), large(NUTS)],
      ]);
      const extra = structuredClone(document);
      for (const item of extraItems(extra, f.extraLemon))
        Object.assign(item, declarationsFor("extra", NUTS));
      expect(drift(extra, document, allOf(f, { extra: EGGS }))[0]!.targets).toEqual([
        {
          target: targets.extra,
          stillOld: false,
          replaces: [
            {
              productId: f.extraLemon,
              name: "Extra lemon",
              values: declarationsFor("extra", NUTS),
            },
          ],
        },
      ]);
      expect(drift(document, document, allOf(f, { dish: MILK }))[0]!.targets[0]).not.toHaveProperty(
        "replaces",
      );
    });

    it("says what a variant that agrees holds beside the dish's third value", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const queued = structuredClone(document);
      for (const offer of offers(queued))
        if (offer.productId === f.lemonade) Object.assign(offer, NUTS);
      const reviewed = allOf(f, {}).get(f.soup)!;
      expect(drift(queued, document, allOf(f, { dish: MILK }))[0]!.targets).toEqual([
        {
          target: targets.dish,
          stillOld: false,
          replaces: [
            { productId: f.lemonade, name: "Lemonade", values: NUTS },
            { productId: f.large, name: "Large", values: reviewed },
          ],
        },
      ]);
    });

    it("lists a variant the live version lacks under its dish alone, ticked while it holds the live dish's value", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const live = structuredClone(document);
      for (const offer of offers(live)) offer.variants = [];
      const current = allOf(f, { variant: NUTS });
      expect(drift(document, live, current)).toEqual(
        listed({ target: targets.dish, stillOld: true, replaces: expect.any(Array) }),
      );

      const deliberate = structuredClone(document);
      Object.assign(setMenuOffers(deliberate)[0]!.variants[0]!, EGGS);
      expect(drift(deliberate, live, current)).toEqual(
        listed({ target: targets.dish, stillOld: false }),
      );
    });

    it("reads an added variant's old value from its dish live, not from its dish in the queued version", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const live = structuredClone(document);
      for (const offer of offers(live))
        Object.assign(offer, offer.productId === f.lemonade && EGGS, { variants: [] });
      const current = allOf(f, { variant: NUTS });
      expect(drift(document, live, current)).toEqual(
        listed({ target: targets.dish, stillOld: false }),
      );

      const inheriting = structuredClone(document);
      for (const offer of offers(inheriting))
        for (const variant of offer.variants) Object.assign(variant, EGGS);
      expect(drift(inheriting, live, current)).toEqual(
        listed({ target: targets.dish, stillOld: true, replaces: expect.any(Array) }),
      );
    });

    it("says what a ticked correction replaces at an added variant that takes other values than its dish", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const live = structuredClone(document);
      for (const offer of offers(live))
        if (offer.productId === f.lemonade)
          for (const copy of [offer, ...offer.variants]) Object.assign(copy, MILK);
      const queued = structuredClone(live);
      for (const offer of offers(queued))
        if (offer.productId === f.lemonade)
          offer.variants.unshift({
            ...structuredClone(offer.variants[0]!),
            id: "medium",
            name: "Medium",
          });
      const taking = (dish: DeclarationValues, medium: DeclarationValues) =>
        new Map([...allOf(f, { dish, variant: dish }), ["medium", medium]]);
      const none = allOf(f, {}).get(f.soup)!;
      const all = [
        { productId: f.lemonade, name: "Lemonade", values: MILK },
        { productId: "medium", name: "Medium", values: MILK },
        { productId: f.large, name: "Large", values: MILK },
      ];

      // The dish changes live, to other values than the variant takes.
      expect(drift(queued, live, taking(NUTS, none))).toEqual(
        listed(
          { target: targets.dish, stillOld: true, replaces: all },
          { target: targets.variant, stillOld: true },
        ),
      );
      // The dish already agrees.
      expect(drift(queued, live, taking(MILK, none))).toEqual(
        listed({ target: targets.dish, stillOld: true, replaces: all }),
      );
      // Its dish's live line covers it.
      expect(drift(queued, live, taking(none, none))).toEqual(
        listed(
          { target: targets.dish, stillOld: true },
          { target: targets.variant, stillOld: true },
        ),
      );
      // It already agrees.
      expect(drift(queued, live, taking(NUTS, MILK))).toEqual(
        listed(
          { target: targets.dish, stillOld: true },
          { target: targets.variant, stillOld: true },
        ),
      );
    });

    it("keeps a variant the live version holds to its own old value, not its dish's", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const live = structuredClone(document);
      for (const offer of offers(live))
        for (const variant of offer.variants) Object.assign(variant, EGGS);
      expect(drift(document, live, allOf(f, { variant: NUTS }))).toEqual(
        listed(
          { target: targets.dish, stillOld: false },
          { target: targets.variant, stillOld: false },
        ),
      );
    });

    it("takes its targets and old values from the lookup alone, for a menu with no live version", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const before = allOf(f, {});
      const bySave = (document: MenuDocument) =>
        queuedDeclarationDrift(
          [{ versionId: "v2", activatesAt: AT, document }],
          allOf(f, { dish: MILK, extra: EGGS }),
          ({ target, productId }) => ({
            target,
            values: declarationsFor(target.kind, before.get(productId)!),
          }),
        );
      expect(bySave(document)).toEqual(
        listed({ target: targets.dish, stillOld: true }, { target: targets.extra, stillOld: true }),
      );
      const thirdValue = structuredClone(document);
      Object.assign(thirdValue.offers[targets.dish.menuItemId]!, NUTS);
      expect(bySave(thirdValue)).toEqual(
        listed(
          { target: targets.dish, stillOld: false },
          { target: targets.extra, stillOld: true },
        ),
      );
    });

    it("lists no product the live version lacks", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const live = structuredClone(document);
      delete live.offers[targets.soup.menuItemId];
      expect(drift(document, live, new Map([...allOf(f, {}), [f.soup, MILK]]))).toEqual([]);
      expect(drift(document, document, new Map([...allOf(f, {}), [f.soup, MILK]]))).toEqual(
        listed({ target: targets.soup, stillOld: true }),
      );
    });

    it("ignores the order allergens were saved in", async () => {
      const { f, document, targets } = await lunchWithSetMenu();
      const both = structuredClone(document);
      both.offers[targets.soup.menuItemId]!.allergens = { milk: {}, eggs: {} };
      const current = productDeclarationValues({
        allergens: { eggs: {}, milk: {} },
        dietOverride: null,
        dietaryDeclarations: [],
      });
      expect(drift(both, document, new Map([...allOf(f, {}), [f.soup, current]]))).toEqual([]);
    });

    const corrections = (
      document: MenuDocument,
      live: MenuDocument,
      changes: readonly MenuPatchChange[],
      current: ReadonlyMap<string, DeclarationValues>,
    ) =>
      queuedCorrections(
        [
          {
            versionId: "v2",
            contentHash: menuDocumentHash(document),
            document,
            changes: queuedChanges(document, live, changes),
          },
        ],
        languages,
        current,
      );

    it("corrects a variant and an extra alone, not the same extra in another list", async () => {
      const { f, document: live, targets } = await lunchWithSetMenu();
      const queued = structuredClone(live);
      const lists = queued.offers[targets.dish.menuItemId]!.offeredModifiers;
      const extras = lists.find(({ kind }) => kind === "extras")!;
      lists.unshift({ ...structuredClone(extras), id: "other-list" });
      const corrected = corrections(
        queued,
        live,
        declarations(targets.variant, targets.extra),
        allOf(f, { dish: MILK, variant: NUTS, extra: EGGS }),
      ).get("v2")!.document;
      const expected = structuredClone(queued);
      for (const offer of offers(expected))
        if (offer.productId === f.lemonade) {
          Object.assign(offer.variants[0]!, NUTS);
          for (const list of offer.offeredModifiers)
            if (list.kind === "extras" && list.id === f.extrasList)
              Object.assign(
                list.items.find(({ productId }) => productId === f.extraLemon)!,
                declarationsFor("extra", EGGS),
              );
        }
      expect(corrected).toEqual(expected);
      expect(extraItems(corrected, f.extraLemon)).toHaveLength(3);
    });

    it("corrects the copies a queued version holds, wherever it holds the product", async () => {
      const { f, document: live, targets } = await lunchWithSetMenu();
      const queued = structuredClone(live);
      delete queued.offers[targets.dish.menuItemId];
      const changes = [
        ...declarations(targets.dish, targets.soup),
        { target: targets.soup, field: "price", value: "9.00" },
      ];
      const correct = (document: MenuDocument) =>
        corrections(document, live, changes, allOf(f, { dish: MILK, variant: NUTS }));
      const { document: corrected, contentHash } = correct(queued).get("v2")!;
      expect(contentHash).toBe(menuDocumentHash(corrected));
      expect(setMenuOffers(corrected)[0]).toMatchObject({ productId: f.lemonade, ...MILK });
      expect(setMenuOffers(corrected)[0]!.variants[0]).toMatchObject(NUTS);
      expect(corrected.offers).toEqual(queued.offers);
      const without = structuredClone(queued);
      delete without.setMenus;
      expect(correct(without)).toEqual(new Map());
    });
  });
});
