import { describe, expect, it, vi } from "vitest";
import {
  groupSetMenus,
  type ServedSetMenuCopy,
  type ServedSetMenuOffer,
  type SetMenuGroupingInput,
} from "@waitron/shared";

import {
  frozenLinesOf,
  planBillGrouping,
  type GroupingCopy,
  type GroupingLine,
} from "./set-menu-grouping-plan.js";

/** The plan, and the input it handed the calculation. */
function planWithInput(...[lines, frozen, copies, newId]: Parameters<typeof planBillGrouping>) {
  const calculate = vi.fn(groupSetMenus);
  const plan = planBillGrouping(lines, frozen, copies, newId, calculate);
  return { plan, input: calculate.mock.calls[0]![0] };
}

const portion: ServedSetMenuOffer["unit"] = {
  id: "each",
  staffName: "Each",
  staffAbbreviation: "ea",
  name: { en: "Each" },
  abbreviation: { en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

function offer(productId: string, countsAsCourseId: string, unitPrice: string): ServedSetMenuOffer {
  return {
    id: `item-${productId}`,
    menuId: "daily",
    grossPrice: unitPrice,
    productId,
    countsAsCourseId,
    unitPrice,
    courseId: "sending-course",
    menuName: "Daily",
    placements: [[]],
    name: productId,
    customerName: null,
    kitchenName: null,
    unit: portion,
    vatClass: "reduced",
    takeawayVatClass: "reduced",
    category: null,
    allergens: null,
    diet: null,
    dietOverride: null,
    dietaryDeclarations: [],
    offeredModifiers: [],
    variants: [],
    variantCountsAs: {},
    available: true,
    image: null,
    description: null,
  };
}

const dailyCopy: ServedSetMenuCopy = {
  key: "daily:v1-hash",
  menuId: "daily",
  name: "Daily",
  terms: {
    price: "14.00",
    names: { en: "Daily" },
    lines: [
      { id: "first", count: 1, courseIds: ["starters"] },
      { id: "second", count: 1, courseIds: ["mains"] },
    ],
  },
  changedAt: "2026-11-24T00:00:00Z",
  structure: { members: [] },
  offers: [
    offer("soup", "starters", "0.00"),
    offer("hake", "mains", "0.00"),
    offer("sirloin", "mains", "5.00"),
  ],
};
const daily: GroupingCopy = { copy: dailyCopy, versionId: "v1" };

const aLaCarte: Record<string, number> = { soup: 600, hake: 1200, sirloin: 1800 };
const course: Record<string, string> = { soup: "starters", hake: "mains", sirloin: "mains" };

function dish(
  id: string,
  lineNo: number,
  productId: string,
  over: Partial<GroupingLine> = {},
): GroupingLine {
  const price = aLaCarte[productId] ?? 0;
  return {
    id,
    lineNo,
    parentLineId: null,
    listedProductId: productId,
    listedVariantId: null,
    countsAsCourseId: course[productId] ?? null,
    menuItemId: `item-${productId}`,
    quantity: 1000,
    soldByMeasure: false,
    listUnitPriceGross: null,
    unitPriceGross: price,
    lineTotal: price,
    aLaCarteUnitPrice: price,
    creditedTo: "ana",
    setMenuRole: null,
    setMenuId: null,
    setMenuVersionId: null,
    setMenuLineId: null,
    setMenuPlace: null,
    ...over,
  };
}

function placed(
  line: GroupingLine,
  setMenuLineId: string,
  place: number,
  chargeCents = 0,
): GroupingLine {
  return {
    ...line,
    setMenuRole: "dish",
    setMenuId: "daily",
    setMenuLineId,
    setMenuPlace: place,
    unitPriceGross: chargeCents,
    lineTotal: chargeCents,
  };
}

function menuRow(id: string, lineNo: number, over: Partial<GroupingLine> = {}): GroupingLine {
  return {
    ...dish(id, lineNo, "none"),
    listedProductId: null,
    countsAsCourseId: null,
    menuItemId: null,
    aLaCarteUnitPrice: null,
    unitPriceGross: 1400,
    lineTotal: 1400,
    setMenuRole: "set_menu",
    setMenuId: "daily",
    setMenuVersionId: "v1",
    ...over,
  };
}

function extra(id: string, lineNo: number, parentLineId: string, lineTotal: number): GroupingLine {
  return {
    ...dish(id, lineNo, "none"),
    parentLineId,
    listedProductId: null,
    countsAsCourseId: null,
    menuItemId: null,
    aLaCarteUnitPrice: null,
    unitPriceGross: lineTotal,
    lineTotal,
  };
}

function ids(...values: string[]): () => string {
  const queue = [...values];
  return () => queue.shift()!;
}

const none = new Set<string>();

describe("planBillGrouping", () => {
  it("puts Soup and Hake into one Daily at 14.00, the dishes included at 0", () => {
    const lines = [dish("soup", 1, "soup"), dish("hake", 2, "hake")];
    const { plan, input } = planWithInput(lines, none, [daily], ids("menu-a"));
    expect(input).toEqual({
      offers: [
        {
          id: "daily:v1-hash",
          priceCents: 1400,
          lines: dailyCopy.terms.lines,
          dishes: [
            {
              productId: "soup",
              variantId: null,
              countsAsCourseId: "starters",
              surchargeCents: 0,
            },
            { productId: "hake", variantId: null, countsAsCourseId: "mains", surchargeCents: 0 },
            {
              productId: "sirloin",
              variantId: null,
              countsAsCourseId: "mains",
              surchargeCents: 500,
            },
          ],
        },
      ],
      dishes: [
        {
          id: "soup",
          productId: "soup",
          variantId: null,
          courseId: "starters",
          aLaCarteCents: 600,
          extrasCents: 0,
          eligible: true,
        },
        {
          id: "hake",
          productId: "hake",
          variantId: null,
          courseId: "mains",
          aLaCarteCents: 1200,
          extrasCents: 0,
          eligible: true,
        },
      ],
      discounts: [],
      previous: {
        setMenus: [],
        dishes: [
          { id: "soup", place: null },
          { id: "hake", place: null },
        ],
      },
    });
    expect(plan).toEqual({
      exact: true,
      inserts: [{ id: "menu-a", lineNo: 3, copy: daily, priceCents: 1400, creditedTo: "ana" }],
      menuUpdates: [],
      dishUpdates: [
        {
          id: "hake",
          setMenuRole: "dish",
          setMenuLineId: "menu-a",
          setMenuPlace: 1,
          unitPriceGross: 0,
          lineTotal: 0,
          listUnitPriceGross: null,
        },
        {
          id: "soup",
          setMenuRole: "dish",
          setMenuLineId: "menu-a",
          setMenuPlace: 0,
          unitPriceGross: 0,
          lineTotal: 0,
          listUnitPriceGross: null,
        },
      ],
      deletes: [],
    });
  });

  it("passes one offer for a copy two recorded versions hold (D26)", () => {
    const lines = [dish("soup", 1, "soup"), dish("hake", 2, "hake")];
    const republished: GroupingCopy = { copy: dailyCopy, versionId: "v2" };
    const { plan, input } = planWithInput(lines, none, [daily, republished], ids("menu-a"));
    expect(input.offers.map(({ id }) => id)).toEqual(["daily:v1-hash"]);
    expect(plan.inserts).toMatchObject([{ copy: daily, priceCents: 1400 }]);
  });

  it("charges a supplement dish its supplement inside the set menu", () => {
    const lines = [dish("soup", 1, "soup"), dish("sirloin", 2, "sirloin")];
    const plan = planBillGrouping(lines, none, [daily], ids("menu-a"));
    expect(plan.inserts).toEqual([
      { id: "menu-a", lineNo: 3, copy: daily, priceCents: 1400, creditedTo: "ana" },
    ]);
    expect(plan.dishUpdates.find(({ id }) => id === "sirloin")).toEqual({
      id: "sirloin",
      setMenuRole: "dish",
      setMenuLineId: "menu-a",
      setMenuPlace: 1,
      unitPriceGross: 500,
      lineTotal: 500,
      listUnitPriceGross: null,
    });
  });

  it("plans nothing for Hake alone, cheaper at 12.00 than a 14.00 Daily", () => {
    const newId = vi.fn(() => "unused");
    const plan = planBillGrouping([dish("hake", 1, "hake")], none, [daily], newId);
    expect(plan).toMatchObject({ exact: true, inserts: [], menuUpdates: [], dishUpdates: [] });
    expect(plan.deletes).toEqual([]);
    expect(newId).not.toHaveBeenCalled();
  });

  it("plans nothing when planned again from the state it planned", () => {
    const lines = [
      placed(dish("soup", 1, "soup"), "menu-a", 0),
      placed(dish("hake", 2, "hake"), "menu-a", 1),
      menuRow("menu-a", 3),
    ];
    const { plan, input } = planWithInput(lines, none, [daily], ids());
    expect(input.previous).toEqual({
      setMenus: [{ id: "menu-a", offerId: "daily:v1-hash", discountId: null }],
      dishes: [
        { id: "soup", place: { setMenuId: "menu-a", lineIndex: 0 } },
        { id: "hake", place: { setMenuId: "menu-a", lineIndex: 1 } },
      ],
    });
    expect(plan).toMatchObject({ exact: true, inserts: [], menuUpdates: [], dishUpdates: [] });
    expect(plan.deletes).toEqual([]);
  });

  it("numbers each new set-menu row after the bill's highest line, in its dishes' order", () => {
    const lines = [
      dish("soup-1", 1, "soup"),
      dish("hake-1", 2, "hake"),
      dish("soup-2", 3, "soup"),
      dish("hake-2", 4, "hake"),
      extra("bread", 9, "hake-2", 150),
    ];
    const plan = planBillGrouping(lines, none, [daily], ids("menu-a", "menu-b"));
    expect(plan.inserts.map(({ id, lineNo, priceCents }) => ({ id, lineNo, priceCents }))).toEqual([
      { id: "menu-a", lineNo: 10, priceCents: 1400 },
      { id: "menu-b", lineNo: 11, priceCents: 1400 },
    ]);
    expect(plan.dishUpdates).toHaveLength(4);
    const homes = new Map(plan.dishUpdates.map(({ id, setMenuLineId }) => [id, setMenuLineId]));
    expect(homes.get("soup-1")).toBe(homes.get("hake-1"));
    expect(homes.get("soup-2")).toBe(homes.get("hake-2"));
    expect(homes.get("soup-1")).not.toBe(homes.get("soup-2"));
  });

  it("pairs identical dishes rung by different waiters by line number, whatever their ids", () => {
    const pairing = (firstSoup: string, secondSoup: string) => {
      const lines = [
        dish(firstSoup, 1, "soup", { creditedTo: "ana" }),
        dish(secondSoup, 2, "soup", { creditedTo: "ben" }),
        dish("hake", 3, "hake"),
        dish("sirloin", 4, "sirloin"),
      ];
      const plan = planBillGrouping(lines, none, [daily], ids("menu-a", "menu-b"));
      const lineNoOf = new Map(lines.map(({ id, lineNo }) => [id, lineNo]));
      return plan.inserts.map(({ id, lineNo, creditedTo }) => ({
        lineNo,
        creditedTo,
        dishes: plan.dishUpdates
          .filter(({ setMenuLineId }) => setMenuLineId === id)
          .map(({ id: dishId, unitPriceGross }) => [lineNoOf.get(dishId), unitPriceGross])
          .sort(),
      }));
    };
    const expected = [
      {
        lineNo: 5,
        creditedTo: "ana",
        dishes: [
          [1, 0],
          [3, 0],
        ],
      },
      {
        lineNo: 6,
        creditedTo: "ben",
        dishes: [
          [2, 0],
          [4, 500],
        ],
      },
    ];
    expect(pairing("soup-a", "soup-z")).toEqual(expected);
    expect(pairing("soup-z", "soup-a")).toEqual(expected);
  });

  it("keeps a saved set menu that keeps a dish under its own id (D5)", () => {
    const lines = [placed(dish("soup", 1, "soup"), "menu-a", 0), menuRow("menu-a", 2)];
    lines.push(dish("hake", 3, "hake"));
    const plan = planBillGrouping(lines, none, [daily], ids("unused"));
    expect(plan.inserts).toEqual([]);
    expect(plan.menuUpdates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.dishUpdates).toEqual([
      {
        id: "hake",
        setMenuRole: "dish",
        setMenuLineId: "menu-a",
        setMenuPlace: 1,
        unitPriceGross: 0,
        lineTotal: 0,
        listUnitPriceGross: null,
      },
    ]);
  });

  it("deletes a saved set menu left empty after moving its dish to the one kept (D5)", () => {
    const lines = [
      placed(dish("soup", 1, "soup"), "menu-a", 0),
      menuRow("menu-a", 2),
      placed(dish("hake", 3, "hake"), "menu-b", 1),
      menuRow("menu-b", 4),
    ];
    const plan = planBillGrouping(lines, none, [daily], ids("unused"));
    expect(plan.inserts).toEqual([]);
    expect(plan.deletes).toEqual(["menu-a"]);
    expect(plan.dishUpdates).toEqual([
      {
        id: "soup",
        setMenuRole: "dish",
        setMenuLineId: "menu-b",
        setMenuPlace: 0,
        unitPriceGross: 0,
        lineTotal: 0,
        listUnitPriceGross: null,
      },
    ]);
    expect(plan.menuUpdates).toEqual([]);
  });

  it("charges a la carte a placed dish whose set menu goes", () => {
    const lines = [placed(dish("soup", 1, "soup"), "menu-a", 0), menuRow("menu-a", 2)];
    const plan = planBillGrouping(lines, none, [daily], ids());
    expect(plan.deletes).toEqual(["menu-a"]);
    expect(plan.dishUpdates).toEqual([
      {
        id: "soup",
        setMenuRole: null,
        setMenuLineId: null,
        setMenuPlace: null,
        unitPriceGross: 600,
        lineTotal: 600,
        listUnitPriceGross: null,
      },
    ]);
  });

  it("credits a new set menu to whoever has its dish of lowest line number (D19)", () => {
    const lines = [
      dish("hake", 1, "hake", { creditedTo: "ben" }),
      dish("soup", 2, "soup", { creditedTo: "ana" }),
    ];
    const plan = planBillGrouping(lines, none, [daily], ids("menu-a"));
    expect(plan.inserts).toEqual([
      { id: "menu-a", lineNo: 3, copy: daily, priceCents: 1400, creditedTo: "ben" },
    ]);
  });

  it("credits a new set menu to nobody when its first dish is credited to nobody (D19)", () => {
    const lines = [
      dish("hake", 1, "hake", { creditedTo: null }),
      dish("soup", 2, "soup", { creditedTo: "ana" }),
    ];
    const plan = planBillGrouping(lines, none, [daily], ids("menu-a"));
    expect(plan.inserts[0]?.creditedTo).toBeNull();
  });

  it("moves a surviving set menu's credit when its lowest dish changes (D19)", () => {
    const lines = [
      dish("soup", 1, "soup", { creditedTo: "ana" }),
      placed(dish("hake", 2, "hake", { creditedTo: "ben" }), "menu-a", 1),
      menuRow("menu-a", 3, { creditedTo: "ben" }),
    ];
    const plan = planBillGrouping(lines, none, [daily], ids());
    expect(plan.inserts).toEqual([]);
    expect(plan.menuUpdates).toEqual([{ id: "menu-a", priceCents: 1400, creditedTo: "ana" }]);
  });

  it("corrects a saved set menu's stored price", () => {
    const lines = [
      placed(dish("soup", 1, "soup"), "menu-a", 0),
      placed(dish("hake", 2, "hake"), "menu-a", 1),
      menuRow("menu-a", 3, { unitPriceGross: 1300, lineTotal: 1300 }),
    ];
    const plan = planBillGrouping(lines, none, [daily], ids());
    expect(plan.menuUpdates).toEqual([{ id: "menu-a", priceCents: 1400, creditedTo: "ana" }]);
  });

  it("leaves a frozen dish out of the calculation and the writes (D2)", () => {
    const lines = [dish("soup", 1, "soup"), dish("hake", 2, "hake")];
    const { plan, input } = planWithInput(lines, new Set(["soup"]), [daily], ids("unused"));
    expect(input.dishes.map(({ id }) => id)).toEqual(["hake"]);
    expect(plan.inserts).toEqual([]);
    expect(plan.dishUpdates).toEqual([]);
  });

  it("keeps a frozen set menu and its dishes as they are, and places nobody in it (D2)", () => {
    const lines = [
      placed(dish("soup", 1, "soup"), "menu-a", 0),
      menuRow("menu-a", 2),
      dish("hake", 3, "hake"),
      dish("soup-2", 4, "soup"),
    ];
    const frozen = new Set(["menu-a", "soup"]);
    const { plan, input } = planWithInput(lines, frozen, [daily], ids("menu-b"));
    expect(input.previous).toEqual({
      setMenus: [],
      dishes: [
        { id: "hake", place: null },
        { id: "soup-2", place: null },
      ],
    });
    expect(plan.deletes).toEqual([]);
    expect(plan.menuUpdates).toEqual([]);
    expect(plan.inserts).toEqual([
      { id: "menu-b", lineNo: 5, copy: daily, priceCents: 1400, creditedTo: "ana" },
    ]);
    expect(plan.dishUpdates.map(({ id, setMenuLineId }) => [id, setMenuLineId])).toEqual([
      ["hake", "menu-b"],
      ["soup-2", "menu-b"],
    ]);
  });

  it("leaves out a row holding two portions (D13)", () => {
    const lines = [dish("soup", 1, "soup", { quantity: 2000 }), dish("hake", 2, "hake")];
    const { plan, input } = planWithInput(lines, none, [daily], ids("unused"));
    expect(input.dishes.map(({ id }) => id)).toEqual(["hake"]);
    expect(plan.inserts).toEqual([]);
    expect(plan.dishUpdates).toEqual([]);
  });

  it("leaves out a row sold by measure, and one with no listing or price (D13)", () => {
    const lines = [
      dish("soup", 1, "soup", { soldByMeasure: true }),
      dish("soup-2", 2, "soup", { listedProductId: null }),
      dish("soup-3", 3, "soup", { aLaCarteUnitPrice: null }),
      dish("hake", 4, "hake"),
    ];
    const { plan, input } = planWithInput(lines, none, [daily], ids("unused"));
    expect(input.dishes.map(({ id }) => id)).toEqual(["hake"]);
    expect(plan.inserts).toEqual([]);
  });

  it("charges a la carte a placed dish that no longer holds one portion, or is now sold by measure", () => {
    const aLaCarteRow = {
      setMenuRole: null,
      setMenuLineId: null,
      setMenuPlace: null,
      listUnitPriceGross: null,
    };
    const lines = [
      placed(dish("soup", 1, "soup"), "menu-a", 0),
      placed(dish("hake", 2, "hake", { quantity: 2000 }), "menu-a", 1),
      menuRow("menu-a", 3),
      placed(dish("sirloin", 4, "sirloin", { soldByMeasure: true }), "menu-b", 1, 500),
      menuRow("menu-b", 5),
      {
        ...dish("hake-2", 6, "hake", { quantity: 333, aLaCarteUnitPrice: 1999 }),
        unitPriceGross: 0,
      },
      extra("bread", 7, "hake", 150),
    ];
    const plan = planBillGrouping(lines, none, [daily], ids("unused"));
    expect(plan.deletes).toEqual(["menu-a", "menu-b"]);
    expect(plan.inserts).toEqual([]);
    expect(plan.dishUpdates).toEqual([
      { id: "soup", ...aLaCarteRow, unitPriceGross: 600, lineTotal: 600 },
      { id: "hake", ...aLaCarteRow, unitPriceGross: 1200, lineTotal: 2400 },
      { id: "sirloin", ...aLaCarteRow, unitPriceGross: 1800, lineTotal: 1800 },
      // 19.99 x 0.333 is 6.65667, rounded half away from zero to whole cents.
      { id: "hake-2", ...aLaCarteRow, unitPriceGross: 1999, lineTotal: 666 },
    ]);
  });

  it("leaves a frozen placed dish of two portions as it is", () => {
    const lines = [
      placed(dish("hake", 1, "hake", { quantity: 2000 }), "menu-a", 1),
      menuRow("menu-a", 2),
    ];
    const frozen = frozenLinesOf(lines, { reduced: new Set(["hake"]), held: none });
    const plan = planBillGrouping(lines, frozen, [daily], ids());
    expect(plan.dishUpdates).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("clears a stamp equal to the price on a dish it otherwise leaves as it is (D30)", () => {
    const lines = [
      placed(dish("soup", 1, "soup", { listUnitPriceGross: 0 }), "menu-a", 0),
      placed(dish("hake", 2, "hake"), "menu-a", 1),
      menuRow("menu-a", 3),
    ];
    const frozen = frozenLinesOf(lines, { reduced: none, held: none });
    const plan = planBillGrouping(lines, frozen, [daily], ids());
    expect(plan.dishUpdates).toEqual([
      {
        id: "soup",
        setMenuRole: "dish",
        setMenuLineId: "menu-a",
        setMenuPlace: 0,
        unitPriceGross: 0,
        lineTotal: 0,
        listUnitPriceGross: null,
      },
    ]);
    expect(plan.deletes).toEqual([]);
  });

  it("clears the stamp on a dish it lowers into a set menu (D30)", () => {
    const lines = [dish("soup", 1, "soup", { listUnitPriceGross: 600 }), dish("hake", 2, "hake")];
    const frozen = frozenLinesOf(lines, { reduced: none, held: none });
    const plan = planBillGrouping(lines, frozen, [daily], ids("menu-a"));
    expect(plan.dishUpdates.find(({ id }) => id === "soup")).toMatchObject({
      setMenuLineId: "menu-a",
      unitPriceGross: 0,
      listUnitPriceGross: null,
    });
  });

  it("keeps a set menu and its dishes when one of them is stamped above its price (D30)", () => {
    const lines = [
      placed(dish("soup", 1, "soup", { listUnitPriceGross: 600 }), "menu-a", 0),
      placed(dish("hake", 2, "hake"), "menu-a", 1),
      menuRow("menu-a", 3),
    ];
    const frozen = frozenLinesOf(lines, { reduced: none, held: none });
    const { plan, input } = planWithInput(lines, frozen, [daily], ids());
    expect(input.dishes).toEqual([]);
    expect(plan).toEqual({
      exact: true,
      inserts: [],
      dishUpdates: [],
      menuUpdates: [],
      deletes: [],
    });
  });

  it("passes a dish with no course or no menu item as not eligible, and charges it a la carte (D12)", () => {
    const lines = [
      placed(dish("soup", 1, "soup"), "menu-a", 0),
      placed(dish("hake", 2, "hake"), "menu-a", 1),
      menuRow("menu-a", 3),
      dish("soup-2", 4, "soup", { menuItemId: null }),
    ];
    lines[0] = { ...lines[0]!, countsAsCourseId: null };
    const { plan, input } = planWithInput(lines, none, [daily], ids());
    expect(input.dishes.find(({ id }) => id === "soup")).toMatchObject({
      courseId: "",
      eligible: false,
    });
    expect(input.dishes.find(({ id }) => id === "soup-2")?.eligible).toBe(false);
    expect(plan.deletes).toEqual(["menu-a"]);
    expect(plan.dishUpdates).toEqual([
      {
        id: "hake",
        setMenuRole: null,
        setMenuLineId: null,
        setMenuPlace: null,
        unitPriceGross: 1200,
        lineTotal: 1200,
        listUnitPriceGross: null,
      },
      {
        id: "soup",
        setMenuRole: null,
        setMenuLineId: null,
        setMenuPlace: null,
        unitPriceGross: 600,
        lineTotal: 600,
        listUnitPriceGross: null,
      },
    ]);
  });

  it("passes a variant dish as its parent's id and its own", () => {
    const lines = [
      dish("wine", 1, "wine", {
        listedVariantId: "glass",
        countsAsCourseId: "drinks",
        aLaCarteUnitPrice: 450,
      }),
    ];
    const { input } = planWithInput(lines, none, [daily], ids());
    expect(input.dishes).toEqual([
      {
        id: "wine",
        productId: "wine",
        variantId: "glass",
        courseId: "drinks",
        aLaCarteCents: 450,
        extrasCents: 0,
        eligible: true,
      },
    ]);
  });

  it("dissolves a saved set menu whose copy the bill does not record, regrouping its dishes", () => {
    const lines = [
      placed(dish("soup", 1, "soup"), "menu-old", 0),
      placed(dish("hake", 2, "hake"), "menu-old", 1),
      menuRow("menu-old", 3, { setMenuVersionId: "v0" }),
    ];
    const { plan, input } = planWithInput(lines, none, [daily], ids("menu-a"));
    expect(input.previous?.setMenus).toEqual([
      { id: "menu-old", offerId: "unrecorded:v0:daily", discountId: null },
    ]);
    expect(plan.inserts).toEqual([
      { id: "menu-a", lineNo: 4, copy: daily, priceCents: 1400, creditedTo: "ana" },
    ]);
    expect(plan.deletes).toEqual(["menu-old"]);
    expect(
      plan.dishUpdates.map(({ id, setMenuLineId, setMenuPlace }) => [
        id,
        setMenuLineId,
        setMenuPlace,
      ]),
    ).toEqual([
      ["hake", "menu-a", 1],
      ["soup", "menu-a", 0],
    ]);
  });

  it("keeps the plan's writes when the calculation is not proven cheapest", () => {
    const lines = [dish("soup", 1, "soup"), dish("hake", 2, "hake")];
    const calculate = vi.fn((input: SetMenuGroupingInput) => ({
      ...groupSetMenus(input),
      exact: false,
    }));
    const plan = planBillGrouping(lines, none, [daily], ids("menu-a"), calculate);
    expect(calculate).toHaveBeenCalledOnce();
    expect(plan.exact).toBe(false);
    expect(plan.inserts).toEqual([
      { id: "menu-a", lineNo: 3, copy: daily, priceCents: 1400, creditedTo: "ana" },
    ]);
    expect(plan.dishUpdates).toHaveLength(2);
  });

  it("passes no discounts, adds extras to their dish's total and never plans an extra", () => {
    const lines = [
      dish("soup", 1, "soup"),
      extra("croutons", 2, "soup", 150),
      extra("cheese", 3, "soup", 100),
      dish("hake", 4, "hake"),
    ];
    const { plan, input } = planWithInput(lines, none, [daily], ids("menu-a"));
    expect(input.discounts).toEqual([]);
    expect(input.dishes.map(({ id, extrasCents }) => [id, extrasCents])).toEqual([
      ["soup", 250],
      ["hake", 0],
    ]);
    expect(plan.dishUpdates.map(({ id }) => id).sort()).toEqual(["hake", "soup"]);
  });

  it("passes no previous grouping when the bill has no dish to group and no set menu", () => {
    const { input } = planWithInput([extra("bread", 1, "gone", 150)], none, [daily], ids());
    expect(input.previous).toBeNull();
    expect(input.dishes).toEqual([]);
  });
});

describe("frozenLinesOf", () => {
  const lines = [
    placed(dish("soup", 1, "soup"), "menu-a", 0),
    placed(dish("hake", 2, "hake"), "menu-a", 1),
    menuRow("menu-a", 3),
    extra("croutons", 4, "soup", 150),
    dish("soup-2", 5, "soup"),
    extra("cheese", 6, "soup-2", 100),
  ];

  it("spreads from a held extra to its dish, its set menu and that set menu's other dishes", () => {
    expect(frozenLinesOf(lines, { reduced: none, held: new Set(["croutons"]) })).toEqual(
      new Set(["croutons", "soup", "menu-a", "hake"]),
    );
  });

  it("freezes neither the dish nor the set menu of a reduced extra (D34)", () => {
    expect(frozenLinesOf(lines, { reduced: new Set(["croutons"]), held: none })).toEqual(
      new Set(["croutons"]),
    );
  });

  it.each(["reduced", "held"] as const)("spreads from a %s set menu to its dishes", (source) => {
    expect(
      frozenLinesOf(lines, { reduced: none, held: none, [source]: new Set(["menu-a"]) }),
    ).toEqual(new Set(["menu-a", "soup", "hake"]));
  });

  it.each(["reduced", "held"] as const)(
    "spreads from a %s dish to its set menu and that set menu's other dishes",
    (source) => {
      expect(
        frozenLinesOf(lines, { reduced: none, held: none, [source]: new Set(["hake"]) }),
      ).toEqual(new Set(["hake", "menu-a", "soup"]));
    },
  );

  it("freezes a dish alone when it is in no set menu", () => {
    expect(frozenLinesOf(lines, { reduced: none, held: new Set(["soup-2"]) })).toEqual(
      new Set(["soup-2"]),
    );
  });

  it("freezes nothing when nothing is named or priced below its list price", () => {
    expect(frozenLinesOf(lines, { reduced: none, held: none })).toEqual(none);
  });

  it("treats a row priced below its stamped list price as reduced (D30)", () => {
    const stamped = lines.map((line) =>
      line.id === "hake" ? { ...line, listUnitPriceGross: 1200 } : line,
    );
    expect(frozenLinesOf(stamped, { reduced: none, held: none })).toEqual(
      new Set(["hake", "menu-a", "soup"]),
    );
  });

  it("treats an extra priced below its stamped list price as reduced, leaving its dish (D34)", () => {
    const stamped = lines.map((line) =>
      line.id === "croutons" ? { ...line, listUnitPriceGross: 200 } : line,
    );
    expect(frozenLinesOf(stamped, { reduced: none, held: none })).toEqual(new Set(["croutons"]));
  });

  it("freezes nothing for a stamp equal to the price, on a dish, a set menu or an extra (D30)", () => {
    const stamped = lines.map((line) => ({ ...line, listUnitPriceGross: line.unitPriceGross }));
    expect(frozenLinesOf(stamped, { reduced: none, held: none })).toEqual(none);
  });
});
