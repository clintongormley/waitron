import { describe, expect, it } from "vitest";
import type { Decimal, CombineInput } from "@waitron/shared";
import { combineOffer, clashesOf } from "./menu-combine.js";
const d = (s: string) => s as Decimal;
const input = (
  own: Partial<CombineInput["own"]> = {},
  rest: Partial<CombineInput> = {},
): CombineInput => ({
  productId: "lager",
  product: { price: d("3.00"), variants: [] },
  own: { price: null, variants: [], ...own },
  placedInOwnSections: false,
  included: [],
  ...rest,
});
/** A product with one variant, Pint, with no price of its own. */
const pint = { price: d("3.00"), variants: [{ variantId: "pint", price: null }] };
const local = (own: Partial<CombineInput["own"]> = {}, product?: CombineInput["product"]) =>
  combineOffer(input(own, { placedInOwnSections: true, ...(product && { product }) }));
const via = (offer = local({ price: d("3.50") })) => [
  { menuId: "drinks", menuName: "Drinks", offer },
];
describe("combined menu decisions", () => {
  it("inherits the included price and its provenance", () => {
    const offer = combineOffer(input({}, { included: via() }));
    expect(offer.price).toEqual({
      state: "decided",
      value: "3.50",
      otherwise: null,
      source: { kind: "menu", menuId: "drinks", menuName: "Drinks", from: { kind: "own" } },
    });
    expect(clashesOf(offer)).toEqual([]);
  });
  it("retains the masked clash under an equal own decision", () => {
    const offer = combineOffer(
      input({ price: d("3.50") }, { placedInOwnSections: true, included: via() }),
    );
    expect(offer.price).toMatchObject({
      state: "decided",
      source: { kind: "own" },
      otherwise: { state: "clash" },
    });
    expect(clashesOf(offer)).toEqual([]);
  });
  it("refuses an unreached product", () => expect(() => combineOffer(input())).toThrow());
  it("propagates an undecided included candidate", () => {
    const clash = combineOffer(input({}, { placedInOwnSections: true, included: via() }));
    expect(combineOffer(input({}, { included: via(clash) })).price).toEqual({
      state: "clash",
      candidates: [
        { place: { kind: "menu", menuId: "drinks", menuName: "Drinks" }, undecided: true },
      ],
    });
  });
  it("keeps nested provenance and first inclusion order", () => {
    const nested = combineOffer(input({}, { included: via() }));
    const offer = combineOffer(
      input(
        {},
        {
          included: [
            { menuId: "evening", menuName: "Evening", offer: nested },
            { menuId: "other", menuName: "Other", offer: nested },
          ],
        },
      ),
    );
    expect(offer.price).toMatchObject({
      state: "decided",
      source: {
        kind: "menu",
        menuId: "evening",
        from: { kind: "menu", menuId: "drinks", from: { kind: "own" } },
      },
    });
  });
  it.each([false, true])(
    "variant price beats product price with own placement %s",
    (placedInOwnSections) => {
      const drinks = local({ variants: [{ variantId: "pint", price: d("3.80") }] }, pint);
      const offer = combineOffer(
        input({}, { product: pint, placedInOwnSections, included: via(drinks) }),
      );
      expect(offer.variants[0]!.price).toMatchObject({
        state: "decided",
        value: "3.80",
        level: "variant",
        source: { kind: "menu", menuId: "drinks" },
      });
      expect(clashesOf(offer)).toEqual([]);
    },
  );
  it("unpriced variants follow the product's own price", () => {
    expect(
      combineOffer(input({}, { product: pint, placedInOwnSections: true })).variants[0]!.price,
    ).toEqual({
      state: "decided",
      value: "3.00",
      level: "product",
      source: { kind: "parent" },
      otherwise: null,
    });
  });
  it("charges a variant's price on this menu, else its own price, else the product's", () => {
    const product = { price: d("4.00"), variants: [{ variantId: "pint", price: d("5.50") }] };
    const priceOf = (
      own: Partial<CombineInput["own"]>,
      chosen: CombineInput["product"] = product,
    ) =>
      combineOffer(input(own, { product: chosen, placedInOwnSections: true })).variants[0]!.price;
    expect(priceOf({ variants: [{ variantId: "pint", price: d("6.00") }] })).toMatchObject({
      state: "decided",
      value: "6.00",
      level: "variant",
      source: { kind: "own" },
    });
    expect(priceOf({})).toMatchObject({
      state: "decided",
      value: "5.50",
      level: "variant",
      source: { kind: "product" },
    });
    expect(
      priceOf({}, { ...product, variants: [{ variantId: "pint", price: null }] }),
    ).toMatchObject({
      state: "decided",
      value: "4.00",
      level: "product",
      source: { kind: "parent" },
    });
  });
  it("charges a variant's price of zero, on this menu or its own, rather than a later one", () => {
    const product = { price: d("4.00"), variants: [{ variantId: "pint", price: d("0.00") }] };
    const priceOf = (own: Partial<CombineInput["own"]>) =>
      combineOffer(input(own, { product, placedInOwnSections: true })).variants[0]!.price;
    expect(priceOf({})).toMatchObject({ state: "decided", value: "0.00", level: "variant" });
    expect(
      combineOffer(
        input(
          { variants: [{ variantId: "pint", price: d("0.00") }] },
          {
            product: { ...product, variants: [{ variantId: "pint", price: d("5.50") }] },
            placedInOwnSections: true,
          },
        ),
      ).variants[0]!.price,
    ).toMatchObject({ state: "decided", value: "0.00", level: "variant", source: { kind: "own" } });
  });
  it("menu variant prices participate in variant clashes", () => {
    const offer = combineOffer(
      input(
        {},
        {
          product: { price: d("3"), variants: [{ variantId: "pint", price: d("5") }] },
          placedInOwnSections: true,
          included: via(local({ variants: [{ variantId: "pint", price: d("6") }] }, pint)),
        },
      ),
    );
    expect(offer.variants[0]!.price).toMatchObject({ state: "clash", level: "variant" });
    expect(clashesOf(offer).map((c) => c.variantId)).toEqual(["pint"]);
  });
  it("accepts zero and compares decimal values", () => {
    expect(local({ price: d("0.00") }).price).toMatchObject({ state: "decided", value: "0.00" });
    const offer = combineOffer(
      input(
        {},
        {
          product: { price: d("3.5"), variants: [] },
          placedInOwnSections: true,
          included: via(),
        },
      ),
    );
    expect(offer.price).toMatchObject({
      state: "decided",
      value: "3.5",
      source: { kind: "product" },
    });
  });
});
it("propagates an unresolved variant-level candidate even beside an unpriced own placement", () => {
  const variant = input(
    {},
    {
      placedInOwnSections: true,
      product: { price: d("3"), variants: [{ variantId: "pint", price: d("5") }] },
      included: via(local({ variants: [{ variantId: "pint", price: d("6") }] }, pint)),
    },
  );
  const child = combineOffer(variant);
  const parent = combineOffer(
    input({}, { product: pint, placedInOwnSections: true, included: via(child) }),
  );
  expect(parent.variants[0]!.price).toEqual({
    state: "clash",
    level: "variant",
    candidates: [
      { place: { kind: "menu", menuId: "drinks", menuName: "Drinks" }, undecided: true },
    ],
  });
  expect(clashesOf(parent).map((c) => [c.field, c.variantId])).toEqual([["price", "pint"]]);
});
describe("price clashes, with no menu on/off setting", () => {
  const noVariants = { price: d("3.00"), variants: [] };
  const withVariants = {
    price: d("3.00"),
    variants: [
      { variantId: "pint", price: null },
      { variantId: "half", price: null },
    ],
  };
  const priced = (product: CombineInput["product"], price: string) =>
    combineOffer(input({ price: d(price) }, { product, placedInOwnSections: true }));
  const both = (product: CombineInput["product"]) => [
    { menuId: "drinks", menuName: "Drinks", offer: priced(product, "3.50") },
    { menuId: "bar", menuName: "Bar", offer: priced(product, "4.00") },
  ];

  it("reports two included menus' different prices, though the parent places nothing itself", () => {
    const offer = combineOffer(input({}, { product: noVariants, included: both(noVariants) }));
    expect(clashesOf(offer)).toEqual([
      {
        productId: "lager",
        variantId: null,
        field: "price",
        candidates: [
          {
            place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
            value: "3.50",
            source: { kind: "menu", menuId: "drinks", menuName: "Drinks", from: { kind: "own" } },
          },
          {
            place: { kind: "menu", menuId: "bar", menuName: "Bar" },
            value: "4.00",
            source: { kind: "menu", menuId: "bar", menuName: "Bar", from: { kind: "own" } },
          },
        ],
      },
    ]);
  });

  it("carries no on/off setting for the offer or any variant", () => {
    const offer = combineOffer(input({}, { product: withVariants, placedInOwnSections: true }));
    expect(offer).not.toHaveProperty("offered");
    for (const variant of offer.variants) expect(variant).not.toHaveProperty("offered");
  });
});
