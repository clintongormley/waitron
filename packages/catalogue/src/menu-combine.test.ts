import { describe, expect, it } from "vitest";
import type { Decimal } from "@waitron/shared";
import type { CombineInput } from "./menu-combine-types.js";
import { combineOffer, clashesOf } from "./menu-combine.js";
const d = (s: string) => s as Decimal;
const input = (
  own: Partial<CombineInput["own"]> = {},
  rest: Partial<CombineInput> = {},
): CombineInput => ({
  productId: "lager",
  catalogue: { price: d("3.00"), variants: [{ variantId: "pint", price: null }] },
  own: { price: null, offered: null, variants: [], ...own },
  placedInOwnSections: false,
  included: [],
  ...rest,
});
const local = (own: Partial<CombineInput["own"]> = {}) =>
  combineOffer(input(own, { placedInOwnSections: true }));
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
  it("reports disagreement once on the unpriced size", () => {
    const offer = combineOffer(input({}, { placedInOwnSections: true, included: via() }));
    expect(offer.price).toMatchObject({
      state: "clash",
      candidates: [
        { place: { kind: "own_sections" }, value: "3.00" },
        { place: { kind: "menu", menuId: "drinks", menuName: "Drinks" }, value: "3.50" },
      ],
    });
    expect(clashesOf(offer).map((c) => [c.field, c.variantId])).toEqual([["price", "pint"]]);
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
    expect(offer.variants[0]!.price).toMatchObject({
      state: "decided",
      value: "3.50",
      level: "product",
      source: { kind: "parent" },
      otherwise: { state: "clash" },
    });
    expect(clashesOf(offer)).toEqual([]);
  });
  it("refuses an unreached product", () => expect(() => combineOffer(input())).toThrow());
  it("always reports on/off disagreement but suppresses prices when off", () => {
    const off = local({ offered: false, price: d("9") });
    expect(
      clashesOf(combineOffer(input({}, { placedInOwnSections: true, included: via(off) }))).map(
        (c) => c.field,
      ),
    ).toContain("offered");
    expect(
      clashesOf(
        combineOffer(input({ offered: false }, { placedInOwnSections: true, included: via(off) })),
      ),
    ).toEqual([]);
  });
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
    "size price beats product price with own placement %s",
    (placedInOwnSections) => {
      const drinks = local({ variants: [{ variantId: "pint", price: d("3.80"), offered: null }] });
      const offer = combineOffer(
        input({ price: d("4") }, { placedInOwnSections, included: via(drinks) }),
      );
      expect(offer.variants[0]!.price).toMatchObject({
        state: "decided",
        value: "3.80",
        level: "size",
        source: { kind: "menu", menuId: "drinks" },
      });
      expect(clashesOf(offer)).toEqual([]);
    },
  );
  it("unpriced sizes follow this menu's product decision", () => {
    expect(
      combineOffer(input({ price: d("4") }, { included: via() })).variants[0]!.price,
    ).toMatchObject({ state: "decided", value: "4", level: "product", source: { kind: "parent" } });
  });
  it("catalogue size prices participate in size clashes", () => {
    const offer = combineOffer(
      input(
        {},
        {
          catalogue: { price: d("3"), variants: [{ variantId: "pint", price: d("5") }] },
          placedInOwnSections: true,
          included: via(local({ variants: [{ variantId: "pint", price: d("6"), offered: null }] })),
        },
      ),
    );
    expect(offer.variants[0]!.price).toMatchObject({ state: "clash", level: "size" });
    expect(clashesOf(offer).map((c) => c.variantId)).toEqual(["pint"]);
  });
  it("accepts zero and compares decimal values", () => {
    expect(local({ price: d("0.00") }).price).toMatchObject({ state: "decided", value: "0.00" });
    const offer = combineOffer(
      input(
        {},
        {
          catalogue: { price: d("3.5"), variants: [] },
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
it("propagates an unresolved size-level candidate even beside an unpriced own placement", () => {
  const size = input(
    {},
    {
      placedInOwnSections: true,
      catalogue: { price: d("3"), variants: [{ variantId: "pint", price: d("5") }] },
      included: via(local({ variants: [{ variantId: "pint", price: d("6"), offered: null }] })),
    },
  );
  const child = combineOffer(size);
  const parent = combineOffer(
    input({ price: d("4") }, { placedInOwnSections: true, included: via(child) }),
  );
  expect(parent.variants[0]!.price).toEqual({
    state: "clash",
    level: "size",
    candidates: [
      { place: { kind: "menu", menuId: "drinks", menuName: "Drinks" }, undecided: true },
    ],
  });
  expect(clashesOf(parent).map((c) => [c.field, c.variantId])).toEqual([["price", "pint"]]);
});
it("resolves a size's own switch and retains the otherwise on/off clash", () => {
  const child = local({ variants: [{ variantId: "pint", price: null, offered: false }] });
  const parent = combineOffer(
    input(
      { variants: [{ variantId: "pint", price: null, offered: true }] },
      { placedInOwnSections: true, included: via(child) },
    ),
  );
  expect(parent.variants[0]!.offered).toMatchObject({
    state: "decided",
    value: true,
    source: { kind: "own" },
    otherwise: { state: "clash", candidates: [{ value: true }, { value: false }] },
  });
  expect(clashesOf(parent)).toEqual([]);
});
