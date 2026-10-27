import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { isAppError, type ContentLanguages } from "@waitron/shared";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, offerOf, type MenusFixture } from "../test/menus-fixture.js";
import { liveVersions, previewMenu, publishMenu } from "./menu-publication.js";
import { applyMenuPatch, parseMenuPatch, patchFieldValue } from "./menu-patch.js";
import { PATCH_FIELDS, type MenuPatchChange } from "./menu-patch-types.js";
import type { MenuDocument } from "./menu-document-types.js";

const fx = useCatalogueDb();
const languages: ContentLanguages = { defaultLanguage: "en", languages: ["en", "es"] };

async function liveLunch(): Promise<{ f: MenusFixture; document: MenuDocument }> {
  const f = await menusFixture(fx.db);
  return withTransaction(fx.db, async (tx) => {
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

  it("patches a variant's price and VAT class and leaves its dish alone", async () => {
    const { f, document } = await liveLunch();
    const lemonade = await menuItem(f, f.lemonade);
    const before = document.offers[lemonade]!;
    const large = before.variants.find((variant) => variant.id === f.large)!;
    expect(large.menuPrice).toBeNull();
    const target = { kind: "variant", menuItemId: lemonade, variantId: f.large };
    const patched = applyMenuPatch(
      document,
      parseMenuPatch([
        { target, field: "price", value: "4.25" },
        { target, field: "vatClass", value: "general" },
      ]),
      languages,
    );
    const offer = patched.offers[lemonade]!;
    const variant = offer.variants.find((v) => v.id === f.large)!;
    expect(variant.unitPrice).toBe("4.25");
    expect(variant.menuPrice).toBeNull();
    expect(variant.vatClass).toBe("general");
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

  it("patching a dish leaves every variant as it was", async () => {
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
            vatClass: "general",
          }[field],
        })),
      ),
      languages,
    );
    expect(patched.offers[lemonade]!.variants).toEqual(document.offers[lemonade]!.variants);
    expect(patched.offers[lemonade]).toMatchObject({
      name: "Lemon soda",
      customerName: { en: "Fizzy lemon" },
      kitchenName: "LEMSODA",
      description: { en: "Fresh" },
      image: "soda.jpg",
      unitPrice: "9.00",
      grossPrice: "9.00",
      vatClass: "general",
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
          target: { kind: "section", sectionId: f.drinks },
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
      vatClass: "zero",
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

  it("refuses a body that is not a list of changes", () => {
    for (const body of [null, {}, "changes", { changes: [] }]) {
      expect(refusal(() => parseMenuPatch(body))).toEqual({
        code: "menu_patch.invalid",
        params: { change: -1, field: "changes" },
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
      [offer, "vatClass", "luxury"],
      [offer, "vatClass", null],
      [offer, "name", "   "],
      [offer, "name", null],
      [section, "internalName", ""],
      [offer, "kitchenName", 3],
      [offer, "customerName", "Lemonade"],
      [offer, "customerName", ["en"]],
      [offer, "description", { english: "Fresh" }, "content.translation_invalid"],
      [section, "names", { en: 3 }, "content.translation_invalid"],
      [offer, "image", ""],
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
      patchFieldValue(document, { kind: "section", sectionId: f.drinks }, "internalName"),
    ).toBeUndefined();
  });
});
