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
    expect(draft.rebase(next)).toEqual({ dropped: 1 });
    expect(draft.changes()).toEqual([{ target: salad, field: "price", value: "5.00" }]);
    expect(draft.changed(bowl)).toBe(false);
  });

  it("on rebase drops without counting a change the new live version already holds", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: salad, field: "price", value: "5.00" });
    draft.set({ target: soup, field: "price", value: "6.00" });
    const next = lunch();
    next.offers["mi-salad"]!.unitPrice = "5.00";
    expect(draft.rebase(next)).toEqual({ dropped: 0 });
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
    expect(draft.rebase(next)).toEqual({ dropped: 2 });
    expect(draft.changes()).toEqual([{ target: salad, field: "price", value: "5.00" }]);
  });

  it("on rebase drops and counts wording a newer version's switched-off language refuses", () => {
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
    expect(draft.rebase(next)).toEqual({ dropped: 1 });
    expect(draft.changes()).toEqual([{ target: salad, field: "price", value: "5.00" }]);
  });

  it("on rebase lets a failure that is not a refusal through rather than counting it", () => {
    const draft = new MenuPatchDraft(lunch(), languages);
    draft.set({ target: salad, field: "price", value: "5.00" });
    const next = lunch() as MenuDocument & { unclonable: () => void };
    next.unclonable = () => undefined;
    expect(() => draft.rebase(next)).toThrow(DOMException);
  });

  it("on rebase takes the content languages it is given, dropping and counting what they refuse", () => {
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
    expect(draft.rebase(fixedNames(), languages)).toEqual({ dropped: 0 });
    expect(draft.changes()).toHaveLength(1);
    expect(draft.rebase(fixedNames(), { defaultLanguage: "en", languages: ["en"] })).toEqual({
      dropped: 1,
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
    expect(draft.rebase(drinksWith(true))).toEqual({ dropped: 1 });
    expect(draft.changes()).toEqual([{ target, field: "internalName", value: "Bar drinks" }]);
    draft.set({ target, field: "names", value: { en: "Refreshments", es: "Copas" } });
    expect(draft.changes()).toContainEqual({
      target,
      field: "names",
      value: { en: "Bar", es: "Copas" },
    });
    // The fixed language already holds the live text, so nothing typed is lost.
    expect(draft.rebase(drinksWith(true))).toEqual({ dropped: 0 });
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
    expect(draft.rebase(drinksWith(true))).toEqual({ dropped: 0 });
    expect(draft.changes()).toEqual([
      { target, field: "names", value: { en: "Bar", es: "Copas" } },
    ]);
  });
});
