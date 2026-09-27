import { describe, expect, it } from "vitest";
import { lineBlock, refreshBasket, withUnavailable } from "./menu-refresh.js";
import { menuOfferToTillProduct, type TillMenuOffer } from "../api/client.js";
import type { OrderLine } from "./working-order.js";

type LiveModifier = TillMenuOffer["offeredModifiers"][number];
type LiveVariant = TillMenuOffer["variants"][number];

const unit = {
  id: "unit-each",
  name: { es: "unidad" },
  abbreviation: { es: "ud" },
  precision: 0,
  hardwareUnit: null,
};

function offer(overrides: Partial<TillMenuOffer> & Pick<TillMenuOffer, "id" | "productId">) {
  return {
    menuId: "lunch",
    grossPrice: null,
    unitPrice: "3.00",
    active: true,
    available: true,
    image: null,
    description: null,
    menuName: "Lunch",
    placements: [[]],
    name: overrides.productId,
    customerName: { es: `${overrides.productId} carta` },
    kitchenName: `${overrides.productId} KDS`,
    unit,
    vatClass: "general",
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId: null,
    offeredModifiers: [],
    variants: [],
    ...overrides,
  } satisfies TillMenuOffer;
}

function extraItem(productId: string, price: string, available = true) {
  return {
    productId,
    name: productId,
    customerName: null,
    kitchenName: null,
    price,
    vatClass: "general" as const,
    maxQuantity: 2,
    preselected: false,
    addAllergens: null,
    suitableFor: [],
    image: null,
    available,
  };
}

function extrasList(id: string, items: ReturnType<typeof extraItem>[]): LiveModifier {
  return {
    kind: "extras",
    id,
    name: id,
    customerName: null,
    kitchenName: null,
    minPicks: 0,
    maxPicks: null,
    items,
  };
}

function label(id: string, available = true) {
  return { id, name: id, customerName: null, kitchenName: null, available };
}

function optionsList(
  id: string,
  labels: ReturnType<typeof label>[],
  defaultLabelId: string | null,
) {
  return {
    kind: "options" as const,
    id,
    name: id,
    customerName: null,
    kitchenName: null,
    defaultLabelId,
    labels,
  };
}

function variant(id: string, unitPrice: string, overrides: Partial<LiveVariant> = {}): LiveVariant {
  return {
    id,
    name: id,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice,
    menuPrice: null,
    offered: true,
    available: true,
    unit,
    pricingUnit: "each",
    vatClass: "general",
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId: null,
    ...overrides,
  };
}

const NOTHING = { products: [], optionLabels: [], extraItems: [] };

const burger = offer({
  id: "offer-burger",
  productId: "burger",
  unitPrice: "9.00",
  offeredModifiers: [
    extrasList("list-extras", [extraItem("cheese", "1.00"), extraItem("bacon", "1.50")]),
    optionsList("list-cooked", [label("rare"), label("medium")], "rare"),
  ],
});
const wine = offer({
  id: "offer-wine",
  productId: "wine",
  unitPrice: "4.00",
  variants: [variant("glass", "4.00"), variant("bottle", "18.00")],
});

describe("withUnavailable", () => {
  it("marks each dish, variant, extras item and option label from the set, not from the load", () => {
    const loaded = [
      { ...burger, available: false },
      wine,
      offer({
        id: "offer-soup",
        productId: "soup",
        offeredModifiers: [extrasList("list-extras", [extraItem("bacon", "1.50")])],
      }),
    ];
    const [greyBurger, greyWine, soup] = withUnavailable(loaded, {
      products: ["cheese", "bottle"],
      optionLabels: ["rare"],
      extraItems: [{ menuItemId: "offer-soup", extraListId: "list-extras", productId: "bacon" }],
    });

    // Burger was loaded sold out and the set no longer lists it.
    expect(greyBurger!.available).toBe(true);
    const [extras, cooked] = greyBurger!.offeredModifiers;
    expect(
      extras!.kind === "extras" && extras.items.map((i) => [i.productId, i.available]),
    ).toEqual([
      ["cheese", false],
      ["bacon", true],
    ]);
    expect(cooked!.kind === "options" && cooked.labels.map((l) => [l.id, l.available])).toEqual([
      ["rare", false],
      ["medium", true],
    ]);
    expect(cooked!.kind === "options" && cooked.defaultLabelId).toBe("medium");
    expect(greyWine!.variants.map((v) => [v.id, v.available])).toEqual([
      ["glass", true],
      ["bottle", false],
    ]);
    // Bacon is switched off on the soup's offer only; the burger's bacon stays.
    const [soupExtras] = soup!.offeredModifiers;
    expect(soupExtras!.kind === "extras" && soupExtras.items[0]!.available).toBe(false);
  });

  describe("the default label", () => {
    const steak = offer({
      id: "offer-steak",
      productId: "steak",
      offeredModifiers: [
        optionsList("list-cooked", [label("rare"), label("medium"), label("well-done")], "rare"),
      ],
    });
    const defaultWith = (unavailable: string[]) => {
      const [served] = withUnavailable([steak], { ...NOTHING, optionLabels: unavailable });
      const [cooked] = served!.offeredModifiers;
      if (cooked?.kind !== "options") throw new Error("options");
      return cooked.defaultLabelId;
    };

    it("stays the loaded default while it is available", () => {
      expect(defaultWith(["medium"])).toBe("rare");
    });

    it("is the first available label in the list's order while the loaded default is not", () => {
      expect(defaultWith(["rare", "medium"])).toBe("well-done");
    });

    it("is null while every label is unavailable", () => {
      expect(defaultWith(["rare", "medium", "well-done"])).toBeNull();
    });
  });

  it("keeps a variant this menu does not offer unavailable, whatever the set says", () => {
    const [served] = withUnavailable(
      [offer({ ...wine, variants: [variant("bottle", "18.00", { offered: false })] })],
      NOTHING,
    );
    expect(served!.variants[0]!.available).toBe(false);
  });
});

function lineOf(from: TillMenuOffer, version: string, extras: Partial<OrderLine> = {}): OrderLine {
  return { product: menuOfferToTillProduct(from, version), quantity: "1", ...extras };
}

describe("lineBlock", () => {
  const pick = (productId: string, price: string) => ({
    listId: "list-extras",
    productId,
    name: productId,
    price,
    quantity: 1,
  });

  it("finds nothing wrong with a line its offer still sells as it stands", () => {
    const line = lineOf(burger, "v1", {
      extras: [pick("cheese", "1.00")],
      options: [{ listId: "list-cooked", labelId: "rare" }],
    });
    expect(lineBlock(line, burger)).toBeUndefined();
  });

  it("names the dish when its offer is gone or it cannot be sold", () => {
    const line = lineOf(burger, "v1");
    expect(lineBlock(line, undefined)).toEqual({ reason: "removed", name: "burger" });
    expect(lineBlock(line, { ...burger, available: false })).toEqual({
      reason: "unavailable",
      name: "burger",
    });
  });

  it("names the variant when the menu stopped offering it or it cannot be sold", () => {
    const bottle = menuOfferToTillProduct(wine, "v1");
    const line: OrderLine = {
      product: { ...bottle, variantId: "bottle", variantName: "Botella" },
      quantity: "1",
    };
    expect(lineBlock(line, { ...wine, variants: [variant("glass", "4.00")] })).toEqual({
      reason: "variant_removed",
      name: "Botella",
    });
    expect(
      lineBlock(line, { ...wine, variants: [variant("bottle", "18.00", { offered: false })] }),
    ).toEqual({ reason: "variant_removed", name: "Botella" });
    expect(
      lineBlock(line, { ...wine, variants: [variant("bottle", "18.00", { available: false })] }),
    ).toEqual({ reason: "unavailable", name: "Botella" });
  });

  it("names the extra when its list no longer offers it, or it cannot be sold", () => {
    const line = lineOf(burger, "v1", { extras: [pick("bacon", "1.50")] });
    const withItems = (items: ReturnType<typeof extraItem>[]) => ({
      ...burger,
      offeredModifiers: [extrasList("list-extras", items)],
    });
    expect(lineBlock(line, withItems([extraItem("cheese", "1.00")]))).toEqual({
      reason: "extra_removed",
      name: "bacon",
    });
    expect(lineBlock(line, { ...burger, offeredModifiers: [] })).toEqual({
      reason: "extra_removed",
      name: "bacon",
    });
    expect(lineBlock(line, withItems([extraItem("bacon", "1.50", false)]))).toEqual({
      reason: "extra_unavailable",
      name: "bacon",
    });
  });

  it("names the option label when its list no longer holds it, or it cannot be chosen", () => {
    const line = lineOf(burger, "v1", { options: [{ listId: "list-cooked", labelId: "rare" }] });
    const withLabels = (labels: ReturnType<typeof label>[]) => ({
      ...burger,
      offeredModifiers: [optionsList("list-cooked", labels, null)],
    });
    expect(lineBlock(line, withLabels([label("medium")]))).toEqual({
      reason: "extra_removed",
      name: "rare",
    });
    expect(lineBlock(line, withLabels([label("rare", false), label("medium")]))).toEqual({
      reason: "extra_unavailable",
      name: "rare",
    });
  });
  it("names an answer by its id when the line was never offered its label", () => {
    const line: OrderLine = {
      product: { ...menuOfferToTillProduct(burger, "v1"), offeredModifiers: [] },
      quantity: "1",
      options: [{ listId: "list-cooked", labelId: "blue" }],
    };
    expect(lineBlock(line, burger)).toEqual({ reason: "extra_removed", name: "blue" });
  });
});

describe("refreshBasket", () => {
  const lemonade = offer({ id: "offer-lemonade", productId: "Lemonade", unitPrice: "3.00" });
  const live = new Map([["lunch", "v2"]]);

  it("adopts a line silently when nothing it holds changed, asserting the new version", () => {
    const line = lineOf(lemonade, "v1");
    const outcome = refreshBasket([line], [lemonade], live);
    expect(outcome.changed).toEqual([]);
    expect(outcome.blocked).toEqual([]);
    expect(outcome.adopted.get(0)!.product.menuVersionId).toBe("v2");
  });

  it("reports a price change as the line's total before and after, and adopts the new price", () => {
    const line = lineOf(lemonade, "v1");
    const outcome = refreshBasket([line], [{ ...lemonade, unitPrice: "2.50" }], live);
    expect(outcome.changed).toEqual([{ lineNo: 1, name: "Lemonade", from: "3.00", to: "2.50" }]);
    expect(outcome.adopted.get(0)!.product.unitPrice).toBe("2.50");
  });

  it("counts an extra's new price into the line's change and adopts it on the pick", () => {
    const line = lineOf(burger, "v1", {
      quantity: "2",
      extras: [
        { listId: "list-extras", productId: "bacon", name: "bacon", price: "1.50", quantity: 1 },
      ],
    });
    const dearer = {
      ...burger,
      offeredModifiers: [
        extrasList("list-extras", [extraItem("cheese", "1.00"), extraItem("bacon", "2.00")]),
      ],
    };
    const outcome = refreshBasket([line], [dearer], live);
    expect(outcome.changed).toEqual([{ lineNo: 1, name: "burger", from: "21.00", to: "22.00" }]);
    expect(outcome.adopted.get(0)!.extras).toEqual([
      { listId: "list-extras", productId: "bacon", name: "bacon", price: "2.00", quantity: 1 },
    ]);
  });

  it("keeps a variant line on its variant, at the variant's new price", () => {
    const glass = menuOfferToTillProduct(wine, "v1");
    const line: OrderLine = {
      product: { ...glass, variantId: "bottle", variantName: "bottle", unitPrice: "18.00" },
      quantity: "1",
    };
    const outcome = refreshBasket(
      [line],
      [{ ...wine, variants: [variant("glass", "4.00"), variant("bottle", "16.00")] }],
      live,
    );
    expect(outcome.changed).toEqual([{ lineNo: 1, name: "bottle", from: "18.00", to: "16.00" }]);
    expect(outcome.adopted.get(0)!.product).toMatchObject({
      variantId: "bottle",
      unitPrice: "16.00",
      menuVersionId: "v2",
    });
  });

  it("blocks a line the new version no longer sells, and does not adopt a removed one", () => {
    const outcome = refreshBasket(
      [lineOf(lemonade, "v1"), lineOf(burger, "v1")],
      [{ ...burger, available: false }],
      live,
    );
    expect(outcome.blocked).toEqual([
      { lineNo: 1, name: "Lemonade", reason: "removed" },
      { lineNo: 2, name: "burger", reason: "unavailable" },
    ]);
    expect(outcome.adopted.has(0)).toBe(false);
    expect(outcome.adopted.get(1)!.product.menuVersionId).toBe("v2");
  });

  it("shows the new price of a line it blocks too, so confirming never re-prices it unseen", () => {
    const cheese = {
      listId: "list-extras",
      productId: "cheese",
      name: "cheese",
      price: "1.00",
      quantity: 1,
    };
    const line = lineOf(burger, "v1", { extras: [cheese] });
    const dearerNoCheese = {
      ...burger,
      unitPrice: "12.00",
      offeredModifiers: [extrasList("list-extras", [extraItem("cheese", "1.00", false)])],
    };
    const outcome = refreshBasket([line], [dearerNoCheese], live);
    expect(outcome.blocked).toEqual([{ lineNo: 1, name: "cheese", reason: "extra_unavailable" }]);
    expect(outcome.changed).toEqual([{ lineNo: 1, name: "burger", from: "10.00", to: "13.00" }]);
    expect(outcome.adopted.get(0)!.product.unitPrice).toBe("12.00");
  });

  it("keeps a pick the live version no longer offers as it was, so the line stays blocked for it", () => {
    const bacon = {
      listId: "list-extras",
      productId: "bacon",
      name: "bacon",
      price: "1.50",
      quantity: 1,
    };
    const line = lineOf(burger, "v1", { extras: [bacon] });
    const withoutBacon = {
      ...burger,
      offeredModifiers: [extrasList("list-extras", [extraItem("cheese", "1.00")])],
    };
    const outcome = refreshBasket([line], [withoutBacon], live);
    expect(outcome.blocked).toEqual([{ lineNo: 1, name: "bacon", reason: "extra_removed" }]);
    expect(outcome.adopted.get(0)!.extras).toEqual([bacon]);
  });

  it("leaves saved lines, and lines already on the live version, alone", () => {
    const saved = { ...lineOf(lemonade, "v1"), workingOrderLineId: "wol-1" };
    const current = lineOf(lemonade, "v2");
    const outcome = refreshBasket([saved, current], [{ ...lemonade, unitPrice: "2.50" }], live);
    expect(outcome).toEqual({ changed: [], blocked: [], adopted: new Map() });
  });
});
