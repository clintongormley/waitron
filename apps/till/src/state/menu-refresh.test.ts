import { describe, expect, it } from "vitest";
import { lineBlock, refreshBasket, repriceRebuilt, withUnavailable } from "./menu-refresh.js";
import { menuOfferToTillProduct, type TillMenuOffer } from "../api/client.js";
import { WorkingOrderStore, type OrderLine } from "./working-order.js";

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
    portion: "1",
    unit: {
      name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
      hardwareUnit: null,
      id: "00000000-0000-0000-0000-000000000001",
      abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
      precision: 0,
    },
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
  publishedDefaultLabelId: string | null = defaultLabelId,
) {
  return {
    kind: "options" as const,
    id,
    name: id,
    customerName: null,
    kitchenName: null,
    defaultLabelId,
    publishedDefaultLabelId,
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

const NOTHING = { products: [], optionLabels: [] };

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
      products: ["cheese", "bottle", "bacon"],
      optionLabels: ["rare"],
    });

    // Burger was loaded sold out and the set no longer lists it.
    expect(greyBurger!.available).toBe(true);
    const [extras, cooked] = greyBurger!.offeredModifiers;
    expect(
      extras!.kind === "extras" && extras.items.map((i) => [i.productId, i.available]),
    ).toEqual([
      ["cheese", false],
      ["bacon", false],
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
    // The same Unavailable product is unavailable on every offer.
    const [soupExtras] = soup!.offeredModifiers;
    expect(soupExtras!.kind === "extras" && soupExtras.items[0]!.available).toBe(false);
  });

  describe("the default label", () => {
    const defaultWith = (unavailable: string[], publishedDefault: string | null = "rare") => {
      const steak = offer({
        id: "offer-steak",
        productId: "steak",
        offeredModifiers: [
          optionsList(
            "list-cooked",
            [label("rare"), label("medium"), label("well-done")],
            publishedDefault,
          ),
        ],
      });
      const [served] = withUnavailable([steak], { ...NOTHING, optionLabels: unavailable });
      const [cooked] = served!.offeredModifiers;
      if (cooked?.kind !== "options") throw new Error("options");
      return cooked.defaultLabelId;
    };

    it("stays the published default while it is available", () => {
      expect(defaultWith(["medium"])).toBe("rare");
    });

    it("is the first available label while the published default is not", () => {
      expect(defaultWith(["rare"])).toBe("medium");
    });

    it("skips every unavailable label, not only the published default", () => {
      expect(defaultWith(["rare", "medium"])).toBe("well-done");
    });

    it("is null while every label is unavailable", () => {
      expect(defaultWith(["rare", "medium", "well-done"])).toBeNull();
    });

    it("is the first available label while the published version names no default", () => {
      expect(defaultWith(["rare"], null)).toBe("medium");
    });

    /** Loaded while "rare", the first label, was unavailable, so the served default was a fallback. */
    const loadedDuringWithdrawal = (published: string | null) =>
      offer({
        id: "offer-steak",
        productId: "steak",
        offeredModifiers: [
          optionsList(
            "list-cooked",
            [label("rare", false), label("medium"), label("well-done")],
            "medium",
            published,
          ),
        ],
      });
    const polledDefault = (loaded: TillMenuOffer) => {
      const [cooked] = withUnavailable([loaded], NOTHING)[0]!.offeredModifiers;
      if (cooked?.kind !== "options") throw new Error("options");
      return cooked.defaultLabelId;
    };

    it("returns to the published default once it is available again, not the fallback it was loaded with", () => {
      expect(polledDefault(loadedDuringWithdrawal("rare"))).toBe("rare");
    });

    it("is the first available label, not the loaded fallback, once available again when the published version names no default", () => {
      expect(polledDefault(loadedDuringWithdrawal(null))).toBe("rare");
    });
  });

  it("marks a variant loaded unavailable available when the set does not list it", () => {
    const [served] = withUnavailable(
      [
        offer({
          ...wine,
          variants: [variant("bottle", "18.00", { available: false })],
        }),
      ],
      NOTHING,
    );
    expect(served!.variants[0]!.available).toBe(true);
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

  it("names the dish when its offer is sold only as an extra, and not when it is staff only", () => {
    const line = lineOf(burger, "v1");
    expect(lineBlock(line, { ...burger, ordering: "not_sold_separately" })).toEqual({
      reason: "not_sold_separately",
      name: "burger",
    });
    expect(
      lineBlock(line, { ...burger, available: false, ordering: "not_sold_separately" }),
    ).toEqual({ reason: "not_sold_separately", name: "burger" });
    expect(lineBlock(line, { ...burger, ordering: "staff_only" })).toBeUndefined();
    expect(lineBlock(line, { ...burger, ordering: "public" })).toBeUndefined();
  });

  it("names the variant when the offer no longer has it or it cannot be sold", () => {
    const bottle = menuOfferToTillProduct(wine, "v1");
    const line: OrderLine = {
      product: { ...bottle, variantId: "bottle", variantName: "Botella" },
      quantity: "1",
    };
    expect(lineBlock(line, { ...wine, variants: [variant("glass", "4.00")] })).toEqual({
      reason: "variant_removed",
      name: "wine (Botella)",
    });
    expect(
      lineBlock(line, { ...wine, variants: [variant("bottle", "18.00", { available: false })] }),
    ).toEqual({ reason: "unavailable", name: "wine (Botella)" });
  });

  it("blocks a variant only by the unavailable set and the offer's variants", () => {
    const bottle = menuOfferToTillProduct(wine, "v1");
    const line: OrderLine = {
      product: { ...bottle, variantId: "bottle", variantName: "Botella" },
      quantity: "1",
    };
    const loaded = offer({
      ...wine,
      variants: [variant("glass", "4.00"), variant("bottle", "18.00")],
    });

    const [served] = withUnavailable([loaded], NOTHING);
    expect(lineBlock(line, served)).toBeUndefined();
    const [soldOut] = withUnavailable([loaded], { ...NOTHING, products: ["bottle"] });
    expect(lineBlock(line, soldOut)).toEqual({ reason: "unavailable", name: "wine (Botella)" });
    const [withoutBottle] = withUnavailable(
      [{ ...loaded, variants: [variant("glass", "4.00")] }],
      NOTHING,
    );
    expect(lineBlock(line, withoutBottle)).toEqual({
      reason: "variant_removed",
      name: "wine (Botella)",
    });
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
  it("says the quantity no longer fits when the offer's unit now takes fewer places than the line holds", () => {
    const widened = menuOfferToTillProduct(burger, "v1");
    const line: OrderLine = {
      product: { ...widened, unit: { ...unit, precision: 3 } },
      quantity: "0.500",
    };
    expect(lineBlock(line, burger)).toEqual({ reason: "unit_changed", name: "burger" });
    expect(lineBlock({ ...line, quantity: "2.000" }, burger)).toBeUndefined();
  });

  it("reads the places a variant line may hold from the variant's own unit, not the dish's", () => {
    const weighed = { ...unit, id: "unit-kg", precision: 3 };
    const byWeight = offer({
      id: "offer-cheese",
      productId: "cheese",
      variants: [variant("wedge", "4.00"), variant("loose", "20.00", { unit: weighed })],
    });
    const line = (variantId: string): OrderLine => ({
      product: { ...menuOfferToTillProduct(byWeight, "v1"), variantId },
      quantity: "0.250",
    });

    expect(lineBlock(line("loose"), byWeight)).toBeUndefined();
    expect(lineBlock(line("wedge"), { ...byWeight, unit: weighed })).toEqual({
      reason: "unit_changed",
      name: "cheese",
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
  const eachSide = { from: unit, to: unit };
  const kg = {
    id: "unit-kg",
    name: { es: "kilo" },
    abbreviation: { es: "kg" },
    precision: 3,
    hardwareUnit: "kg" as const,
  };

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

  it("names the dish and each extra whose price changed when the line's total did not", () => {
    const line = lineOf(burger, "v1", {
      extras: [
        { listId: "list-extras", productId: "cheese", name: "cheese", price: "1.00", quantity: 1 },
        { listId: "list-extras", productId: "bacon", name: "bacon", price: "1.50", quantity: 1 },
      ],
    });
    const offsetting = {
      ...burger,
      unitPrice: "8.00",
      offeredModifiers: [
        extrasList("list-extras", [extraItem("cheese", "2.00"), extraItem("bacon", "1.50")]),
      ],
    };
    const outcome = refreshBasket([line], [offsetting], live);
    expect(outcome.changed).toEqual([
      { lineNo: 1, name: "burger", from: "9.00", to: "8.00", units: eachSide },
      { lineNo: 1, name: "cheese", from: "1.00", to: "2.00", units: eachSide },
    ]);
    expect(outcome.adopted.get(0)!.product.unitPrice).toBe("8.00");
  });

  it("names the product and variant when an extra's change offsets its price", () => {
    const withCheese = {
      ...wine,
      offeredModifiers: [extrasList("list-extras", [extraItem("cheese", "1.00")])],
    };
    const line: OrderLine = {
      product: {
        ...menuOfferToTillProduct(withCheese, "v1"),
        variantId: "bottle",
        variantName: "bottle",
        unitPrice: "18.00",
      },
      quantity: "1",
      extras: [
        { listId: "list-extras", productId: "cheese", name: "cheese", price: "1.00", quantity: 1 },
      ],
    };
    const offsetting = {
      ...withCheese,
      variants: [variant("glass", "4.00"), variant("bottle", "17.00")],
      offeredModifiers: [extrasList("list-extras", [extraItem("cheese", "2.00")])],
    };
    const outcome = refreshBasket([line], [offsetting], live);
    expect(outcome.changed).toEqual([
      { lineNo: 1, name: "wine (bottle)", from: "18.00", to: "17.00", units: eachSide },
      { lineNo: 1, name: "cheese", from: "1.00", to: "2.00", units: eachSide },
    ]);
    expect(outcome.adopted.get(0)!.product.unitPrice).toBe("17.00");
  });

  it("gives a weighed line's dish and extra rows the dish's unit, which its extras are billed by too", () => {
    const ham = offer({
      id: "offer-ham",
      productId: "ham",
      unitPrice: "20.00",
      unit: kg,
      offeredModifiers: [extrasList("list-extras", [extraItem("cheese", "2.00")])],
    });
    const line = lineOf(ham, "v1", {
      quantity: "0.500",
      extras: [
        { listId: "list-extras", productId: "cheese", name: "cheese", price: "2.00", quantity: 1 },
      ],
    });
    const offsetting = {
      ...ham,
      unitPrice: "18.00",
      offeredModifiers: [extrasList("list-extras", [extraItem("cheese", "4.00")])],
    };
    const outcome = refreshBasket([line], [offsetting], live);
    expect(outcome.changed).toEqual([
      { lineNo: 1, name: "ham", from: "20.00", to: "18.00", units: { from: kg, to: kg } },
      { lineNo: 1, name: "cheese", from: "2.00", to: "4.00", units: { from: kg, to: kg } },
    ]);
  });

  it("gives each side of a part row its own unit when the live version sells the dish by another", () => {
    const line = lineOf(burger, "v1", {
      quantity: "2",
      extras: [
        { listId: "list-extras", productId: "cheese", name: "cheese", price: "1.00", quantity: 1 },
      ],
    });
    const byWeight = {
      ...burger,
      unit: kg,
      unitPrice: "8.00",
      offeredModifiers: [extrasList("list-extras", [extraItem("cheese", "2.00")])],
    };
    const outcome = refreshBasket([line], [byWeight], live);
    expect(outcome.changed).toEqual([
      { lineNo: 1, name: "burger", from: "9.00", to: "8.00", units: { from: unit, to: kg } },
      { lineNo: 1, name: "cheese", from: "1.00", to: "2.00", units: { from: unit, to: kg } },
    ]);
  });

  it("names a dish whose unit changed while every price stayed the same", () => {
    const line = lineOf(burger, "v1", { quantity: "2" });
    const outcome = refreshBasket([line], [{ ...burger, unit: kg }], live);
    expect(outcome.changed).toEqual([
      { lineNo: 1, name: "burger", from: "9.00", to: "9.00", units: { from: unit, to: kg } },
    ]);
  });

  it("names only the dish, not an extra whose price stayed the same, when only the dish's unit changed", () => {
    const line = lineOf(burger, "v1", {
      quantity: "2",
      extras: [
        { listId: "list-extras", productId: "cheese", name: "cheese", price: "1.00", quantity: 1 },
      ],
    });
    const outcome = refreshBasket([line], [{ ...burger, unit: kg }], live);
    expect(outcome.changed).toEqual([
      { lineNo: 1, name: "burger", from: "9.00", to: "9.00", units: { from: unit, to: kg } },
    ]);
  });

  it("shows a unit change and a price change on one row at the unit price, even when the line's total changed", () => {
    const line = lineOf(burger, "v1", { quantity: "2" });
    const outcome = refreshBasket([line], [{ ...burger, unit: kg, unitPrice: "8.00" }], live);
    expect(outcome.changed).toEqual([
      { lineNo: 1, name: "burger", from: "9.00", to: "8.00", units: { from: unit, to: kg } },
    ]);
    expect(outcome.adopted.get(0)!.product.unitPrice).toBe("8.00");
  });

  it("adopts a line silently when the live version sends the same unit afresh", () => {
    const line = lineOf(burger, "v1", { quantity: "2" });
    const outcome = refreshBasket([line], [{ ...burger, unit: { ...unit } }], live);
    expect(outcome.changed).toEqual([]);
    expect(outcome.adopted.get(0)!.product.menuVersionId).toBe("v2");
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
    expect(outcome.changed).toEqual([
      { lineNo: 1, name: "wine (bottle)", from: "18.00", to: "16.00" },
    ]);
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

  it("keeps a line whose quantity the live unit cannot hold out of adoption, so the preview still reads it", () => {
    const widened = menuOfferToTillProduct(burger, "v1");
    const line: OrderLine = {
      product: { ...widened, unit: { ...unit, precision: 3 } },
      quantity: "0.500",
      blocked: "unit_changed",
    };
    const outcome = refreshBasket([line], [burger], live);
    const store = new WorkingOrderStore();
    store.loadFrom("draft-1", [line]);
    store.adoptLines(outcome.adopted);

    expect(() => store.vatBreakdown).not.toThrow();
    expect(outcome.blocked).toEqual([{ lineNo: 1, name: "burger", reason: "unit_changed" }]);
    expect(outcome.adopted.has(0)).toBe(false);
  });

  it("asks about a line rebuilt from a saved draft at its new price alone, since its earlier price was never held", () => {
    const line: OrderLine = { ...lineOf(lemonade, "v1"), earlierPriceUnknown: true };
    const outcome = refreshBasket([line], [lemonade], live);
    expect(outcome.changed).toEqual([{ lineNo: 1, name: "Lemonade", to: "3.00" }]);
    expect(outcome.adopted.get(0)!.product.menuVersionId).toBe("v2");
    expect(outcome.adopted.get(0)!.earlierPriceUnknown).toBeUndefined();
  });

  it("leaves saved lines, and lines already on the live version, alone", () => {
    const saved = { ...lineOf(lemonade, "v1"), workingOrderLineId: "wol-1" };
    const current = lineOf(lemonade, "v2");
    const outcome = refreshBasket([saved, current], [{ ...lemonade, unitPrice: "2.50" }], live);
    expect(outcome).toEqual({ changed: [], blocked: [], adopted: new Map() });
  });
});

describe("repriceRebuilt", () => {
  const byId = (...offers: TillMenuOffer[]) => new Map(offers.map((each) => [each.id, each]));
  const lemonade = offer({ id: "offer-lemonade", productId: "Lemonade", unitPrice: "3.00" });
  const live = new Map([["lunch", "v2"]]);
  /** Rebuilt under v2 while the till still held v1's offers, at v1's price. */
  const rebuilt = (source: TillMenuOffer): OrderLine => ({
    ...lineOf(source, "v2"),
    earlierPriceUnknown: true,
  });

  it("prices a rebuilt line whose version is now live from the live offer, and forgets the mark", () => {
    const repriced = repriceRebuilt(
      [rebuilt(lemonade)],
      byId({ ...lemonade, unitPrice: "3.50" }),
      live,
    );

    expect(repriced.get(0)!.product.unitPrice).toBe("3.50");
    expect(repriced.get(0)!.product.menuVersionId).toBe("v2");
    expect(repriced.get(0)!.earlierPriceUnknown).toBeUndefined();
  });

  it("leaves a line still not on the live version, one the till built itself, and one no longer offered", () => {
    const older = { ...lineOf(lemonade, "v1"), earlierPriceUnknown: true as const };
    const own = lineOf(lemonade, "v2");
    const gone = rebuilt(offer({ id: "offer-gone", productId: "Gone" }));

    expect(repriceRebuilt([older, own, gone], byId(lemonade), live)).toEqual(new Map());
  });

  it("leaves a line whose variant or unit the live offer can no longer hold as it stands", () => {
    const glass = menuOfferToTillProduct(wine, "v2");
    const variantGone: OrderLine = {
      product: { ...glass, variantId: "glass" },
      quantity: "1",
      earlierPriceUnknown: true,
    };
    const widened: OrderLine = {
      product: { ...menuOfferToTillProduct(burger, "v2"), unit: { ...unit, precision: 3 } },
      quantity: "0.500",
      earlierPriceUnknown: true,
    };
    const withoutGlass = { ...wine, variants: wine.variants.filter((each) => each.id !== "glass") };

    expect(repriceRebuilt([variantGone, widened], byId(withoutGlass, burger), live)).toEqual(
      new Map(),
    );
  });
});
