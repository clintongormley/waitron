import { describe, expect, it } from "vitest";
import type {
  FrozenExtraItem,
  FrozenOfferVariant,
  FrozenOfferedModifier,
  MenuDocument,
} from "@waitron/catalogue/src/menu-document-types.js";
import type { ContentLanguages } from "@waitron/shared";
import { MenuPatchDraft, patchTree, type PatchTreeNode } from "./menu-patch-draft.js";
import { documentProduct, documentSection, menuDocument } from "./test-helpers.js";

const languages: ContentLanguages = { defaultLanguage: "en", languages: ["en", "es"] };

function variant(id: string, name: string): FrozenOfferVariant {
  return {
    id,
    name,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: "4.00",
    menuPrice: null,
    unit: {} as FrozenOfferVariant["unit"],
    pricingUnit: {} as FrozenOfferVariant["pricingUnit"],
    vatClass: "reduced",
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
  };
}

function extra(productId: string, name: string): FrozenExtraItem {
  return {
    productId,
    presentation: {} as FrozenExtraItem["presentation"],
    portion: "1",
    unit: {} as FrozenExtraItem["unit"],
    name,
    customerName: null,
    kitchenName: null,
    price: "1.00",
    vatClass: "reduced",
    maxQuantity: null,
    preselected: false,
    addAllergens: null,
    suitableFor: [],
    image: null,
  };
}

function extras(id: string, name: string, items: FrozenExtraItem[]): FrozenOfferedModifier {
  return {
    kind: "extras",
    id,
    name,
    customerName: null,
    kitchenName: null,
    minPicks: 0,
    maxPicks: null,
    items,
  };
}

function options(id: string, name: string, labels: [string, string][]): FrozenOfferedModifier {
  return {
    kind: "options",
    id,
    name,
    customerName: null,
    kitchenName: null,
    defaultLabelId: null,
    labels: labels.map(([labelId, label]) => ({
      id: labelId,
      name: label,
      customerName: null,
      kitchenName: null,
    })),
  };
}

/** Starters [Soup, Salad], Water at the top level, Mains [Grill [Steak]]. */
function lunch(): MenuDocument {
  const document = menuDocument(
    [
      documentSection("sec-starters", "Starters", [
        documentProduct("mi-soup", "p-soup"),
        documentProduct("mi-salad", "p-salad"),
      ]),
      documentProduct("mi-water", "p-water"),
      documentSection("sec-mains", "Mains", [
        documentSection("sec-grill", "Grill", [documentProduct("mi-steak", "p-steak")]),
      ]),
    ],
    { "p-soup": "Soup", "p-salad": "Salad", "p-water": "Water", "p-steak": "Steak" },
  );
  document.offers["mi-soup"]!.variants = [variant("v-cup", "Cup"), variant("v-bowl", "Bowl")];
  document.offers["mi-soup"]!.offeredModifiers = [
    extras("l-toppings", "Toppings", [extra("p-bread", "Bread"), extra("p-cheese", "Cheese")]),
    options("l-temp", "Temperature", [
      ["lab-hot", "Hot"],
      ["lab-cold", "Cold"],
    ]),
  ];
  document.offers["mi-salad"]!.offeredModifiers = [
    extras("l-toppings", "Toppings", [extra("p-cheese", "Cheese"), extra("p-nuts", "Nuts")]),
    options("l-temp", "Temperature", [
      ["lab-hot", "Hot"],
      ["lab-cold", "Cold"],
    ]),
  ];
  return document;
}

/** Each node as `label` or `[label, children]`, so a whole tree reads at a glance. */
type Shape = string | [string, Shape[]];
const shape = (nodes: PatchTreeNode[]): Shape[] =>
  nodes.map((node) =>
    node.children.length === 0 ? node.label : [node.label, shape(node.children)],
  );

describe("patchTree", () => {
  it("holds the menu in document order, each dish's variants under it, then one group of every list", () => {
    expect(shape(patchTree(lunch(), "Extras and options"))).toEqual([
      ["Starters", [["Soup", ["Cup", "Bowl"]], "Salad"]],
      "Water",
      ["Mains", [["Grill", ["Steak"]]]],
      [
        "Extras and options",
        [
          ["Toppings", ["Bread", "Cheese", "Nuts"]],
          ["Temperature", ["Hot", "Cold"]],
        ],
      ],
    ]);
  });

  it("targets each node at what a patch to it changes, and the group at nothing", () => {
    const tree = patchTree(lunch(), "Extras and options");
    const [starters, water, mains, group] = tree;
    expect(starters!.target).toEqual({ kind: "section", sectionId: "sec-starters" });
    expect(starters!.children[0]!.target).toEqual({ kind: "offer", menuItemId: "mi-soup" });
    expect(starters!.children[0]!.children[1]!.target).toEqual({
      kind: "variant",
      menuItemId: "mi-soup",
      variantId: "v-bowl",
    });
    expect(water!.target).toEqual({ kind: "offer", menuItemId: "mi-water" });
    expect(mains!.children[0]!.target).toEqual({ kind: "section", sectionId: "sec-grill" });
    expect(group!.target).toBeNull();
    const [toppings, temperature] = group!.children;
    expect(toppings!.target).toEqual({ kind: "list", listKind: "extras", listId: "l-toppings" });
    expect(toppings!.children[2]!.target).toEqual({
      kind: "extra",
      listId: "l-toppings",
      productId: "p-nuts",
    });
    expect(temperature!.target).toEqual({ kind: "list", listKind: "options", listId: "l-temp" });
    expect(temperature!.children[1]!.target).toEqual({
      kind: "option_label",
      listId: "l-temp",
      labelId: "lab-cold",
    });
  });

  it("leaves the group out of a menu that offers no list", () => {
    const document = menuDocument([documentProduct("mi-water", "p-water")], { "p-water": "Water" });
    expect(shape(patchTree(document, "Extras and options"))).toEqual(["Water"]);
  });

  it("lists the extras and options in the order the menu shows the dishes offering them", () => {
    const document = menuDocument(
      [documentProduct("20", "p-soup"), documentProduct("3", "p-salad")],
      { "p-soup": "Soup", "p-salad": "Salad" },
    );
    document.offers["20"]!.offeredModifiers = [extras("l-z", "Toppings", [])];
    document.offers["3"]!.offeredModifiers = [extras("l-a", "Dressings", [])];
    expect(shape(patchTree(document, "Extras and options"))).toEqual([
      "Soup",
      "Salad",
      ["Extras and options", ["Toppings", "Dressings"]],
    ]);
  });

  it("leaves out a dish the document holds no offer for", () => {
    const document = menuDocument([documentProduct("mi-water", "p-water")], { "p-water": "Water" });
    document.root.members.push(documentProduct("mi-ghost", "p-ghost"));
    expect(shape(patchTree(document, "Extras and options"))).toEqual(["Water"]);
  });
});

const soup = { kind: "offer", menuItemId: "mi-soup" } as const;
const salad = { kind: "offer", menuItemId: "mi-salad" } as const;
const bowl = { kind: "variant", menuItemId: "mi-soup", variantId: "v-bowl" } as const;

describe("MenuPatchDraft", () => {
  it("holds a change until it is set back to the live value", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: soup, field: "price", value: "3.50" });
    expect(draft.changes()).toEqual([{ target: soup, field: "price", value: "3.50" }]);
    expect(draft.changed(soup)).toBe(true);
    expect(draft.changed(salad)).toBe(false);
    draft.set({ target: soup, field: "price", value: "3.00" });
    expect(draft.changes()).toEqual([]);
    expect(draft.changed(soup)).toBe(false);
  });

  it("replaces an earlier change to the same field and keeps changes to other fields", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: soup, field: "price", value: "3.50" });
    draft.set({ target: soup, field: "name", value: "Broth" });
    draft.set({ target: soup, field: "price", value: "3.75" });
    expect(draft.changes()).toEqual([
      { target: soup, field: "price", value: "3.75" },
      { target: soup, field: "name", value: "Broth" },
    ]);
  });

  it("marks a dish changed until its last changed field is set back", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: soup, field: "price", value: "3.50" });
    draft.set({ target: soup, field: "name", value: "Broth" });
    draft.set({ target: soup, field: "price", value: "3.00" });
    expect(draft.changed(soup)).toBe(true);
    draft.set({ target: soup, field: "name", value: "Soup" });
    expect(draft.changed(soup)).toBe(false);
  });

  it("unmarks a dish whose one field was changed twice and then set back", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: soup, field: "price", value: "3.50" });
    draft.set({ target: soup, field: "price", value: "3.75" });
    draft.set({ target: soup, field: "price", value: "3.00" });
    expect(draft.changed(soup)).toBe(false);
  });

  it("does not mark a variant's dish changed, nor the dish's variant", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: bowl, field: "price", value: "9.00" });
    expect(draft.changed(bowl)).toBe(true);
    expect(draft.changed(soup)).toBe(false);
  });

  it("treats a price written another way, or a name with spaces round it, as the live value", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: soup, field: "price", value: "3" });
    draft.set({ target: soup, field: "name", value: " Soup " });
    expect(draft.changes()).toEqual([]);
  });

  it("compares translated wording by language, not by key order", () => {
    const document = lunch();
    document.offers["mi-soup"]!.customerName = { en: "Soup", es: "Sopa" };
    const draft = new MenuPatchDraft(document, languages);
    draft.set({ target: soup, field: "customerName", value: { en: "Soup", es: "Caldo" } });
    expect(draft.changed(soup)).toBe(true);
    draft.set({ target: soup, field: "customerName", value: { es: "Sopa", en: "Soup" } });
    expect(draft.changes()).toEqual([]);
  });

  it("tells apart changes to every kind of target and to sections' names by language", () => {
    const document = lunch();
    const toppings = { kind: "list", listKind: "extras", listId: "l-toppings" } as const;
    const temperature = { kind: "list", listKind: "options", listId: "l-temp" } as const;
    const cheese = { kind: "extra", listId: "l-toppings", productId: "p-cheese" } as const;
    const hot = { kind: "option_label", listId: "l-temp", labelId: "lab-hot" } as const;
    const starters = { kind: "section", sectionId: "sec-starters" } as const;
    const draft = new MenuPatchDraft(document, languages);
    draft.set({ target: toppings, field: "name", value: "Add-ons" });
    draft.set({ target: cheese, field: "price", value: "1.50" });
    draft.set({ target: hot, field: "kitchenName", value: "HOT" });
    draft.set({ target: starters, field: "names", value: { en: "Starters", es: "Entrantes" } });
    expect(draft.changes()).toHaveLength(4);
    for (const target of [toppings, cheese, hot, starters])
      expect(draft.changed(target)).toBe(true);
    expect(draft.changed(temperature)).toBe(false);
    expect(draft.changed({ kind: "extra", listId: "l-toppings", productId: "p-nuts" })).toBe(false);
    expect(draft.changed({ kind: "option_label", listId: "l-temp", labelId: "lab-cold" })).toBe(
      false,
    );
    expect(draft.changed({ kind: "section", sectionId: "sec-mains" })).toBe(false);
    draft.set({ target: starters, field: "names", value: { es: "Starters para clientes" } });
    expect(draft.changed(starters)).toBe(false);
  });

  it("treats blank wording for a field with none as no change, and any wording as one", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: bowl, field: "customerName", value: { en: " ", es: "" } });
    expect(draft.changes()).toEqual([]);
    draft.set({ target: bowl, field: "customerName", value: { en: "Bowl", es: "" } });
    expect(draft.changed(bowl)).toBe(true);
  });

  it("keeps wording that changes a switched-off language, which the patch refuses", () => {
    const document = lunch();
    document.offers["mi-soup"]!.customerName = { en: "Soup", es: "Sopa", fr: "Soupe" };
    const draft = new MenuPatchDraft(document, languages);
    const change = {
      target: soup,
      field: "customerName",
      value: { en: "Soup", es: "Sopa", fr: "Bouillon" },
    };
    draft.set(change);
    expect(draft.changes()).toEqual([change]);
  });

  it("clears one field's change and leaves the others", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: soup, field: "price", value: "3.50" });
    draft.set({ target: soup, field: "name", value: "Broth" });
    draft.clear(soup, "price");
    expect(draft.changes()).toEqual([{ target: soup, field: "name", value: "Broth" }]);
    expect(draft.changed(soup)).toBe(true);
    draft.clear(soup, "name");
    draft.clear(soup, "name");
    expect(draft.changes()).toEqual([]);
    expect(draft.changed(soup)).toBe(false);
  });

  it("keeps a value the patch would refuse, so the form can say what is wrong", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: soup, field: "name", value: "  " });
    expect(draft.changes()).toEqual([{ target: soup, field: "name", value: "  " }]);
  });

  it("on rebase drops and counts a change whose target has gone, keeping the rest", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: bowl, field: "price", value: "9.00" });
    draft.set({ target: salad, field: "price", value: "5.00" });
    const next = lunch();
    next.offers["mi-soup"]!.variants = [variant("v-cup", "Cup")];
    expect(draft.rebase(next)).toEqual({ dropped: 1, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([{ target: salad, field: "price", value: "5.00" }]);
    expect(draft.changed(bowl)).toBe(false);
  });

  it("on rebase drops without counting a change the new live version already holds", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: salad, field: "price", value: "5.00" });
    draft.set({ target: soup, field: "price", value: "6.00" });
    const next = lunch();
    next.offers["mi-salad"]!.unitPrice = "5.00";
    expect(draft.rebase(next)).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([{ target: soup, field: "price", value: "6.00" }]);
    draft.set({ target: salad, field: "price", value: "5.00" });
    expect(draft.changes()).toHaveLength(1);
  });

  it("on rebase drops and counts every change the new version refuses, whatever its place", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: soup, field: "name", value: "  " });
    draft.set({ target: salad, field: "price", value: "5.00" });
    draft.set({ target: bowl, field: "price", value: "9.00" });
    const next = lunch();
    next.offers["mi-soup"]!.variants = [];
    expect(draft.rebase(next)).toEqual({ dropped: 2, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([{ target: salad, field: "price", value: "5.00" }]);
  });

  it("on rebase lets go without counting text in a switched-off language the person left as it was, and keeps the rest of its change", () => {
    const document = lunch();
    document.offers["mi-soup"]!.customerName = { en: "Soup", es: "Sopa", fr: "Soupe" };
    const draft = new MenuPatchDraft(document, languages);
    draft.set({
      target: soup,
      field: "customerName",
      value: { en: "Soup", es: "Caldo", fr: "Soupe" },
    });
    draft.set({ target: salad, field: "price", value: "5.00" });
    const next = lunch();
    next.offers["mi-soup"]!.customerName = { en: "Soup", es: "Sopa", fr: "Potage" };
    expect(draft.rebase(next)).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([
      { target: soup, field: "customerName", value: { en: "Soup", es: "Caldo" } },
      { target: salad, field: "price", value: "5.00" },
    ]);
  });

  it("on rebase counts text typed in a switched-off language that it lets go, and keeps the rest of its change", () => {
    const document = lunch();
    document.offers["mi-soup"]!.customerName = { en: "Soup", es: "Sopa", fr: "Soupe" };
    const draft = new MenuPatchDraft(document, languages);
    draft.set({
      target: soup,
      field: "customerName",
      value: { en: "Soup", es: "Caldo", fr: "Bouillon" },
    });
    draft.set({ target: salad, field: "price", value: "5.00" });
    const next = lunch();
    next.offers["mi-soup"]!.customerName = { en: "Soup", es: "Sopa", fr: "Potage" };
    expect(draft.rebase(next)).toEqual({
      dropped: 0,
      trimmed: ["offer:mi-soup/customerName"],
      fixed: [],
    });
    expect(draft.changes()).toEqual([
      { target: soup, field: "customerName", value: { en: "Soup", es: "Caldo" } },
      { target: salad, field: "price", value: "5.00" },
    ]);
  });

  it("on rebase removes a change typed only in a switched-off language, counting it as text let go rather than dropped", () => {
    const document = lunch();
    document.offers["mi-soup"]!.customerName = { en: "Soup", es: "Sopa", fr: "Soupe" };
    const draft = new MenuPatchDraft(document, languages);
    draft.set({
      target: soup,
      field: "customerName",
      value: { en: "Soup", es: "Sopa", fr: "Bouillon" },
    });
    expect(draft.rebase(document)).toEqual({
      dropped: 0,
      trimmed: ["offer:mi-soup/customerName"],
      fixed: [],
    });
    expect(draft.changes()).toEqual([]);
  });

  it("on rebase sends the stored text in a language switched off and back on, counting nothing", () => {
    const document = lunch();
    document.offers["mi-soup"]!.description = { en: "Old soup", es: "Sopa vieja" };
    const draft = new MenuPatchDraft(document, languages);
    draft.set({
      target: soup,
      field: "description",
      value: { en: "Old soup", es: "Sopa nueva" },
    });
    expect(draft.rebase(document, { defaultLanguage: "es", languages: ["es"] })).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { es: "Sopa nueva" } },
    ]);
    expect(draft.rebase(document, languages)).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "Old soup", es: "Sopa nueva" } },
    ]);
  });

  it("on rebase counts new wording let go in a switched-off language, and sends the stored text once it is back", () => {
    const document = lunch();
    document.offers["mi-soup"]!.description = { en: "Old soup", es: "Sopa vieja" };
    const draft = new MenuPatchDraft(document, languages);
    draft.set({
      target: soup,
      field: "description",
      value: { en: "New soup", es: "Sopa nueva" },
    });
    expect(draft.rebase(document, { defaultLanguage: "es", languages: ["es"] })).toEqual({
      dropped: 0,
      trimmed: ["offer:mi-soup/description"],
      fixed: [],
    });
    expect(draft.rebase(document, languages)).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "Old soup", es: "Sopa nueva" } },
    ]);
  });

  it("on rebase moves text the person left as it was onto a newer version's, keeping only what they typed", () => {
    const description = (en: string, es: string) => {
      const document = lunch();
      document.offers["mi-soup"]!.description = { en, es };
      return document;
    };
    const draft = new MenuPatchDraft(description("Old soup", "Sopa vieja"), languages);
    draft.set({
      target: soup,
      field: "description",
      value: { en: "New soup", es: "Sopa vieja" },
    });
    expect(draft.rebase(description("Other soup", "Sopa de otro"))).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "New soup", es: "Sopa de otro" } },
    ]);
    expect(draft.rebase(description("Other soup", "Sopa cinco"))).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "New soup", es: "Sopa cinco" } },
    ]);
    expect(
      draft.rebase(description("Other soup", "Sopa cinco"), {
        defaultLanguage: "en",
        languages: ["en"],
      }),
    ).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "New soup" } },
    ]);
  });

  it("on rebase removes without counting a change whose typed text a newer version already holds", () => {
    const description = (en: string, es: string) => {
      const document = lunch();
      document.offers["mi-soup"]!.description = { en, es };
      return document;
    };
    const draft = new MenuPatchDraft(description("Old soup", "Sopa vieja"), languages);
    draft.set({
      target: soup,
      field: "description",
      value: { en: "Old soup", es: "Sopa nueva" },
    });
    expect(draft.rebase(description("Other soup", "Sopa nueva"))).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.changes()).toEqual([]);
  });

  it("on rebase sends a language switched on with its stored text, or blank when it has none", () => {
    const document = lunch();
    document.offers["mi-soup"]!.description = { en: "Old soup", es: "Sopa vieja", fr: "Vieille" };
    const draft = new MenuPatchDraft(document, languages);
    draft.set({
      target: soup,
      field: "description",
      value: { en: "Old soup", es: "Sopa nueva" },
    });
    draft.set({ target: salad, field: "description", value: { en: "Fresh", es: "" } });
    const withFrenchAndItalian = { defaultLanguage: "en", languages: ["en", "es", "fr", "it"] };
    expect(draft.rebase(document, withFrenchAndItalian)).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.changes()).toEqual([
      {
        target: soup,
        field: "description",
        value: { en: "Old soup", es: "Sopa nueva", fr: "Vieille", it: "" },
      },
      { target: salad, field: "description", value: { en: "Fresh", es: "", fr: "", it: "" } },
    ]);
  });

  it("on rebase leaves each place's own text in a switched-off language a folder fixes in one of them", () => {
    const document = menuDocument(
      [documentSection("sec-drinks", "Drinks", []), documentSection("sec-drinks", "Drinks", [])],
      {},
    );
    const [plain, folder] = document.root.members as Extract<
      MenuDocument["root"]["members"][number],
      { kind: "section" }
    >[];
    plain!.names = { en: "Drinks", es: "Bebidas" };
    folder!.names = { en: "Drinks", es: "Copas" };
    folder!.fixed = { names: { es: "Copas" } };
    const target = { kind: "section", sectionId: "sec-drinks" } as const;
    const draft = new MenuPatchDraft(document, languages);
    draft.set({ target, field: "names", value: { en: "Refreshments", es: "Bebidas" } });
    expect(draft.rebase(document, { defaultLanguage: "en", languages: ["en"] })).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.changes()).toEqual([{ target, field: "names", value: { en: "Refreshments" } }]);
  });

  it("on rebase lets a failure that is not a refusal through rather than counting it", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: salad, field: "price", value: "5.00" });
    const next = lunch() as MenuDocument & { unclonable: () => void };
    next.unclonable = () => undefined;
    expect(() => draft.rebase(next)).toThrow(DOMException);
  });

  it("on rebase takes the content languages it is given, counting a change typed only in one they remove", () => {
    const fixedNames = () => {
      const document = menuDocument([documentSection("sec-drinks", "Drinks", [])], {});
      const drinks = document.root.members[0] as Extract<
        MenuDocument["root"]["members"][number],
        { kind: "section" }
      >;
      drinks.names = { en: "Bar", es: "Bebidas" };
      drinks.fixed = { names: { en: "Bar" } };
      return document;
    };
    const target = { kind: "section", sectionId: "sec-drinks" } as const;
    const draft = new MenuPatchDraft(fixedNames(), languages);
    draft.set({ target, field: "names", value: { en: "Bar", es: "Copas" } });
    expect(draft.changes()).toHaveLength(1);
    expect(draft.rebase(fixedNames(), languages)).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toHaveLength(1);
    expect(draft.rebase(fixedNames(), { defaultLanguage: "en", languages: ["en"] })).toEqual({
      dropped: 0,
      trimmed: ["section:sec-drinks/names"],
      fixed: [],
    });
    expect(draft.changes()).toEqual([]);
  });

  it("on rebase lets go of a name change only in a language every folder now fixes, and sends the fixed text", () => {
    const drinksWith = (fixed: boolean) => {
      const document = menuDocument([documentSection("sec-drinks", "Drinks", [])], {});
      const drinks = document.root.members[0] as Extract<
        MenuDocument["root"]["members"][number],
        { kind: "section" }
      >;
      drinks.names = { en: fixed ? "Bar" : "Drinks", es: "Bebidas" };
      if (fixed) drinks.fixed = { names: { en: "Bar" } };
      return document;
    };
    const target = { kind: "section", sectionId: "sec-drinks" } as const;
    const draft = new MenuPatchDraft(drinksWith(false), languages);
    draft.set({ target, field: "names", value: { en: "Refreshments", es: "Bebidas" } });
    draft.set({
      target: { kind: "section", sectionId: "sec-drinks" },
      field: "internalName",
      value: "Bar drinks",
    });
    expect(draft.changes()).toHaveLength(2);
    expect(draft.rebase(drinksWith(true))).toEqual({ dropped: 1, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([{ target, field: "internalName", value: "Bar drinks" }]);
    draft.set({ target, field: "names", value: { en: "Refreshments", es: "Copas" } });
    expect(draft.changes()).toContainEqual({
      target,
      field: "names",
      value: { en: "Bar", es: "Copas" },
    });
    // The fixed language already holds the live text, so nothing typed is lost.
    expect(draft.rebase(drinksWith(true))).toEqual({ dropped: 0, trimmed: [], fixed: [] });
  });

  it("on rebase does not count as dropped a name change still staged in another language once one is fixed", () => {
    const drinksWith = (fixed: boolean) => {
      const document = menuDocument([documentSection("sec-drinks", "Drinks", [])], {});
      const drinks = document.root.members[0] as Extract<
        MenuDocument["root"]["members"][number],
        { kind: "section" }
      >;
      drinks.names = { en: fixed ? "Bar" : "Drinks", es: "Bebidas" };
      if (fixed) drinks.fixed = { names: { en: "Bar" } };
      return document;
    };
    const target = { kind: "section", sectionId: "sec-drinks" } as const;
    const draft = new MenuPatchDraft(drinksWith(false), languages);
    draft.set({ target, field: "names", value: { en: "Refreshments", es: "Copas" } });
    expect(draft.rebase(drinksWith(true))).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: ["section:sec-drinks/names"],
    });
    expect(draft.changes()).toEqual([
      { target, field: "names", value: { en: "Bar", es: "Copas" } },
    ]);
  });

  /** Lunch whose Soup description is "Old soup" in English and `es` in Spanish. */
  const soupIn = (es: string, en = "Old soup") => {
    const document = lunch();
    document.offers["mi-soup"]!.description = { en, es };
    return document;
  };
  const englishOnly: ContentLanguages = { defaultLanguage: "en", languages: ["en"] };

  it("on rebase keeps text typed over an older version through a newer one holding the same text and a later one changing it", () => {
    const draft = new MenuPatchDraft(soupIn("Sopa vieja"), languages);
    draft.set({ target: soup, field: "description", value: { en: "New soup", es: "Sopa mia" } });
    const typed = [
      { target: soup, field: "description", value: { en: "New soup", es: "Sopa mia" } },
    ];
    expect(draft.rebase(soupIn("Sopa mia"))).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual(typed);
    expect(draft.rebase(soupIn("Sopa de otro"))).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual(typed);
    expect(draft.rebase(soupIn("Sopa de otro"), englishOnly)).toEqual({
      dropped: 0,
      trimmed: ["offer:mi-soup/description"],
      fixed: [],
    });
  });

  it("on rebase moves a language typed back to the text it was typed over onto a newer version's", () => {
    const draft = new MenuPatchDraft(soupIn("Sopa vieja"), languages);
    draft.set({ target: soup, field: "description", value: { en: "New soup", es: "Sopa mia" } });
    draft.set({ target: soup, field: "description", value: { en: "New soup", es: "Sopa vieja" } });
    expect(draft.rebase(soupIn("Sopa de otro"))).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "New soup", es: "Sopa de otro" } },
    ]);
  });

  it("follows a held field's untouched languages onto a newer version and keeps what it was typed over once staged", () => {
    const draft = new MenuPatchDraft(soupIn("Sopa vieja"), languages);
    const long = "x".repeat(5000);
    draft.hold(soup, "description");
    expect(draft.changes()).toEqual([]);
    expect(draft.rebase(soupIn("Sopa de otro"))).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.follow(soup, "description", { en: long, es: "Sopa vieja" })).toEqual({
      value: { en: long, es: "Sopa de otro" },
      lost: false,
      fixed: false,
    });
    draft.set({
      target: soup,
      field: "description",
      value: { en: "New soup", es: "Sopa de otro" },
    });
    expect(draft.rebase(soupIn("Sopa cinco"))).toEqual({ dropped: 0, trimmed: [], fixed: [] });
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "New soup", es: "Sopa cinco" } },
    ]);
    expect(draft.rebase(soupIn("Sopa cinco"), englishOnly)).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
  });

  it("follows a held field's typed text in a removed language out, saying it was typed", () => {
    const draft = new MenuPatchDraft(soupIn("Sopa vieja"), languages);
    draft.hold(soup, "description");
    expect(draft.rebase(soupIn("Sopa vieja"), englishOnly)).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.follow(soup, "description", { en: "x", es: "Sopa mia" })).toEqual({
      value: { en: "x" },
      lost: true,
      fixed: false,
    });
  });

  it("forgets what a field was typed over once its change is cleared", () => {
    const draft = new MenuPatchDraft(soupIn("Sopa vieja"), languages);
    draft.hold(soup, "description");
    draft.clear(soup, "description");
    draft.rebase(soupIn("Sopa de otro"));
    draft.set({ target: soup, field: "description", value: { en: "New soup", es: "Sopa vieja" } });
    draft.rebase(soupIn("Sopa cinco"));
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "New soup", es: "Sopa vieja" } },
    ]);
  });

  it("forgets what a field was typed over once it is typed back to the live text", () => {
    const draft = new MenuPatchDraft(soupIn("Sopa vieja"), languages);
    draft.set({ target: soup, field: "description", value: { en: "New soup", es: "Sopa mia" } });
    draft.set({ target: soup, field: "description", value: { en: "Old soup", es: "Sopa vieja" } });
    draft.rebase(soupIn("Sopa de otro"));
    draft.set({ target: soup, field: "description", value: { en: "New soup", es: "Sopa vieja" } });
    draft.rebase(soupIn("Sopa cinco"));
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "New soup", es: "Sopa vieja" } },
    ]);
  });

  it("on rebase forgets what a change was typed over once a newer version holds it", () => {
    const draft = new MenuPatchDraft(soupIn("Sopa vieja"), languages);
    draft.set({ target: soup, field: "description", value: { en: "New soup", es: "Sopa mia" } });
    expect(draft.rebase(soupIn("Sopa mia", "New soup"))).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.changes()).toEqual([]);
    draft.set({
      target: soup,
      field: "description",
      value: { en: "Newer soup", es: "Sopa vieja" },
    });
    draft.rebase(soupIn("Sopa cinco", "New soup"));
    expect(draft.changes()).toEqual([
      { target: soup, field: "description", value: { en: "Newer soup", es: "Sopa vieja" } },
    ]);
  });

  it("on rebase forgets what a change was typed over once a newer version refuses it", () => {
    const bowlNamed = (es: string, kept = true) => {
      const document = lunch();
      const variants = document.offers["mi-soup"]!.variants;
      variants[1]!.customerName = { en: "Bowl", es };
      if (!kept) variants.pop();
      return document;
    };
    const draft = new MenuPatchDraft(bowlNamed("Cuenco"), languages);
    draft.set({ target: bowl, field: "customerName", value: { en: "Bowl", es: "Tazon" } });
    expect(draft.rebase(bowlNamed("Cuenco", false))).toEqual({
      dropped: 1,
      trimmed: [],
      fixed: [],
    });
    draft.rebase(bowlNamed("Tazon"));
    draft.set({ target: bowl, field: "customerName", value: { en: "Big bowl", es: "Cuenco" } });
    draft.rebase(bowlNamed("Cuenco hondo"));
    expect(draft.changes()).toEqual([
      { target: bowl, field: "customerName", value: { en: "Big bowl", es: "Cuenco" } },
    ]);
  });

  it("follows a held name's text typed in a language a newer version's folder fixes onto the fixed text, saying so", () => {
    const drinksWith = (fixed: boolean) => {
      const document = menuDocument([documentSection("sec-drinks", "Drinks", [])], {});
      const drinks = document.root.members[0] as Extract<
        MenuDocument["root"]["members"][number],
        { kind: "section" }
      >;
      drinks.names = { en: fixed ? "Bar" : "Drinks", es: "Bebidas" };
      if (fixed) drinks.fixed = { names: { en: "Bar" } };
      return document;
    };
    const target = { kind: "section", sectionId: "sec-drinks" } as const;
    const long = "x".repeat(5000);
    const draft = new MenuPatchDraft(drinksWith(false), languages);
    draft.hold(target, "names");
    draft.rebase(drinksWith(true));
    expect(draft.follow(target, "names", { en: "Refreshments", es: long })).toEqual({
      value: { en: "Bar", es: long },
      lost: false,
      fixed: true,
    });
    expect(draft.follow(target, "names", { en: "Bar", es: long })).toEqual({
      value: { en: "Bar", es: long },
      lost: false,
      fixed: false,
    });
  });

  it("on rebase treats a name language a folder fixed as untyped once a newer version frees it", () => {
    const drinksWith = (en: string, fixed: boolean) => {
      const document = menuDocument([documentSection("sec-drinks", "Drinks", [])], {});
      const drinks = document.root.members[0] as Extract<
        MenuDocument["root"]["members"][number],
        { kind: "section" }
      >;
      drinks.names = { en, es: "Bebidas" };
      if (fixed) drinks.fixed = { names: { en } };
      return document;
    };
    const target = { kind: "section", sectionId: "sec-drinks" } as const;
    const draft = new MenuPatchDraft(drinksWith("Drinks", false), languages);
    draft.set({ target, field: "names", value: { en: "Refreshments", es: "Copas" } });
    expect(draft.rebase(drinksWith("Bar", true))).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: ["section:sec-drinks/names"],
    });
    expect(draft.rebase(drinksWith("Beverages", false))).toEqual({
      dropped: 0,
      trimmed: [],
      fixed: [],
    });
    expect(draft.changes()).toEqual([
      { target, field: "names", value: { en: "Beverages", es: "Copas" } },
    ]);
  });
});
