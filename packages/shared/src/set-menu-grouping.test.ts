import { expect, it } from "vitest";

import * as shared from "./index.js";
import { boundTable } from "./set-menu-fit.fixtures.js";
import type { SetMenuOffer } from "./set-menu-fit.js";
import type { SetMenuGroupingDish, SetMenuGroupingInput } from "./set-menu-grouping.js";

function dish(
  id: string,
  courseId: string,
  aLaCarteCents: number,
  productId = id,
): SetMenuGroupingDish {
  return {
    id,
    productId,
    variantId: null,
    courseId,
    aLaCarteCents,
    extrasCents: 0,
    eligible: true,
  };
}

function offer(
  id: string,
  priceCents: number,
  dishes: readonly SetMenuGroupingDish[],
  supplements: Readonly<Record<string, number>> = {},
): SetMenuOffer {
  return {
    id,
    priceCents,
    lines: [...new Set(dishes.map(({ courseId }) => courseId))].map((courseId) => ({
      count: 1,
      courseIds: [courseId],
    })),
    dishes: dishes.map(({ productId, variantId, courseId }) => ({
      productId,
      variantId,
      countsAsCourseId: courseId,
      surchargeCents: supplements[productId] ?? 0,
    })),
  };
}

function savedMenu(id: string, offerId: string, discountId: string | null = null) {
  return { id, offerId, discountId };
}

function savedDish(id: string, setMenuId: string, lineIndex: number) {
  return { id, place: { setMenuId, lineIndex } };
}

function group(
  input: Pick<SetMenuGroupingInput, "offers" | "dishes"> & Partial<SetMenuGroupingInput>,
) {
  expect(typeof shared.groupSetMenus, "shared calculation export").toBe("function");
  return shared.groupSetMenus({ discounts: [], previous: null, ...input });
}

it("selects a partly filled menu and leaves an expensive supplement à la carte", () => {
  const dishes = [
    dish("soup", "starter", 900),
    dish("hake", "main", 900),
    dish("flan", "dessert", 200),
  ];
  const lunch = offer("lunch", 1400, dishes, { flan: 350 });
  const result = group({ offers: [lunch], dishes });
  expect(result).toMatchObject({ exact: true, totalCents: 1600, setMenus: [{ offerId: "lunch" }] });
  expect(result.dishes).toEqual([
    { id: "flan", place: null, chargeCents: 200, extrasCents: 0 },
    {
      id: "hake",
      place: { setMenuId: result.setMenus[0]!.id, lineIndex: 1 },
      chargeCents: 0,
      extrasCents: 0,
    },
    {
      id: "soup",
      place: { setMenuId: result.setMenus[0]!.id, lineIndex: 0 },
      chargeCents: 0,
      extrasCents: 0,
    },
  ]);
});

it("can buy two different menu types and uses canonical courses and exact variants", () => {
  const first = dish("starter", "starter", 900);
  const second = dish("main", "main", 900);
  const third = { ...dish("coffee", "dessert", 800), variantId: "glass" };
  const fourth = dish("cake", "other", 900);
  const wrongVariant = { ...third, id: "bottle", variantId: "bottle", aLaCarteCents: 700 };
  const wrongCourse = { ...second, id: "other-main", courseId: "other", aLaCarteCents: 700 };
  const lunch = offer("lunch", 1400, [first, second]);
  const dessert = offer("dessert", 1000, [third, fourth]);
  const result = group({
    offers: [lunch, dessert],
    dishes: [first, second, third, fourth, wrongVariant, wrongCourse],
  });
  expect(result.totalCents).toBe(3800);
  expect(result.setMenus.map(({ offerId }) => offerId).sort()).toEqual(["dessert", "lunch"]);
  expect(result.dishes.filter(({ place }) => place === null).map(({ id }) => id)).toEqual([
    "bottle",
    "other-main",
  ]);
});

it.each([
  [750, 1850],
  [0, 1100],
])("charges an individually adjusted dish %i cents outside the group", (charge, total) => {
  const dishes = [
    dish("soup", "starter", 600),
    dish("hake", "main", 1500),
    dish("flan", "dessert", 500),
  ];
  const lunch = offer("lunch", 1400, dishes);
  expect(group({ offers: [lunch], dishes }).totalCents).toBe(1400);
  expect(
    group({
      offers: [lunch],
      dishes: dishes.map((line) =>
        line.id === "hake" ? { ...line, aLaCarteCents: charge, eligible: false } : line,
      ),
    }),
  ).toMatchObject({ totalCents: total, setMenus: [] });
});

it.each([
  [{ kind: "percent", basisPoints: 5000 }, 1050, 851],
  [{ kind: "amount", cents: 1500 }, 401, 1500],
  [{ kind: "comp" }, 200, 1701],
] as const)(
  "discounts base and actual supplements and charges extras once (%j)",
  (reduction, totalCents, discountCents) => {
    const main = { ...dish("hake", "main", 1800), extrasCents: 200 };
    const result = group({
      offers: [offer("lunch", 1401, [main], { hake: 300 })],
      dishes: [main],
      discounts: [{ id: "grant", offerId: "lunch", ...reduction }],
    });
    expect(result).toMatchObject({
      exact: true,
      totalCents,
      setMenus: [{ discountId: "grant", discountCents }],
    });
  },
);

it("gives the fixed discount to the supplemented menu when it saves an extra cent", () => {
  const plain = dish("plain", "main", 2300);
  const extra = dish("extra", "main", 2300);
  const lunch = offer("lunch", 1401, [plain, extra], { extra: 300 });
  const result = group({
    offers: [lunch],
    dishes: [plain, extra],
    discounts: [{ id: "grant", offerId: "lunch", kind: "amount", cents: 1500 }],
  });
  const holder = result.setMenus.find(({ discountId }) => discountId === "grant")!;
  expect(result).toMatchObject({ exact: true, totalCents: 1602 });
  expect(result.dishes.find(({ id }) => id === "extra")?.place?.setMenuId).toBe(holder.id);
});

it("keeps only the more valuable discount when one of two menus closes", () => {
  const first = dish("first", "main", 1700);
  const second = { ...first, id: "second" };
  const lunch = offer("lunch", 1400, [first]);
  const discounts = [
    { id: "less", offerId: "lunch", kind: "amount", cents: 200 },
    { id: "more", offerId: "lunch", kind: "amount", cents: 500 },
  ] as const;
  const previous = group({ offers: [lunch], dishes: [first, second], discounts });
  expect(previous.totalCents).toBe(2100);
  expect(group({ offers: [lunch], dishes: [first], discounts, previous })).toMatchObject({
    exact: true,
    totalCents: 900,
    setMenus: [{ discountId: "more" }],
    unusedDiscountIds: ["less"],
  });
});

it("groups takeaway dishes with different VAT rates into the same set menu", () => {
  const starter = { ...dish("starter", "starter", 1000), takeawayRateBps: 1000 };
  const main = { ...dish("main", "main", 1000), takeawayRateBps: 2100 };
  const lunch = offer("lunch", 1400, [starter, main]);
  expect(group({ offers: [lunch], dishes: [starter, main] })).toMatchObject({
    exact: true,
    totalCents: 1400,
    setMenus: [{ offerId: "lunch" }],
    dishes: [
      { id: "main", place: { lineIndex: 1 } },
      { id: "starter", place: { lineIndex: 0 } },
    ],
  });
  const fourDishes = [
    starter,
    main,
    { ...starter, id: "starter-high", takeawayRateBps: 2100 },
    { ...main, id: "main-low", takeawayRateBps: 1000 },
  ];
  expect(group({ offers: [lunch], dishes: fourDishes })).toMatchObject({
    exact: true,
    totalCents: 2800,
    setMenus: [{ offerId: "lunch" }, { offerId: "lunch" }],
  });
});

it("keeps the intact saved menu after cancellation at the same price", () => {
  const soup = dish("soup", "starter", 900);
  const hake = dish("hake", "main", 1500);
  const salad = dish("salad", "starter", 900);
  const bass = dish("bass", "main", 1500);
  const lunch = offer("lunch", 1400, [soup, hake, salad, bass]);
  const previous = {
    setMenus: [savedMenu("A", "lunch"), savedMenu("B", "lunch")],
    dishes: [savedDish("soup", "A", 0), savedDish("bass", "B", 1), savedDish("salad", "B", 0)],
  };
  const result = group({ offers: [lunch], dishes: [soup, bass, salad], previous });
  expect(result).toMatchObject({ exact: true, totalCents: 2300, setMenus: [{ id: "B" }] });
  expect(result.dishes.find(({ id }) => id === "soup")?.place).toBeNull();
  expect(
    group({ offers: [lunch], dishes: [{ ...soup, aLaCarteCents: 901 }, bass, salad], previous }),
  ).toMatchObject({
    exact: true,
    totalCents: 2300,
    dishes: [{ id: "bass" }, { id: "salad", place: null }, { id: "soup", place: { lineIndex: 0 } }],
  });
});

it("rounds percentage discounts separately before comparing two menus", () => {
  const dishes = [
    dish("high-starter", "starter", 1500),
    dish("plain-starter", "starter", 1500),
    dish("high-main", "main", 1500),
    dish("plain-main", "main", 1500),
  ];
  const lunch = offer("lunch", 1400, dishes, { "high-starter": 1, "high-main": 1 });
  const discounts = ["a", "b"].map(
    (id) => ({ id, offerId: "lunch", kind: "percent", basisPoints: 5000 }) as const,
  );
  const result = group({ offers: [lunch], dishes, discounts });
  expect(result).toMatchObject({ exact: true, totalCents: 1400 });
  expect(result.setMenus.map(({ discountCents }) => discountCents)).toEqual([701, 701]);
});

it("shares a fixed discount's remaining value across the supplements of one menu", () => {
  const starter = dish("starter", "starter", 220);
  const main = dish("main", "main", 40);
  const lunch = offer("lunch", 1400, [starter, main], { starter: 100, main: 100 });
  const result = group({
    offers: [lunch],
    dishes: [starter, main],
    discounts: [{ id: "grant", offerId: "lunch", kind: "amount", cents: 1500 }],
  });
  expect(result).toMatchObject({
    exact: true,
    totalCents: 40,
    dishes: [
      { id: "main", place: null },
      { id: "starter", chargeCents: 100 },
    ],
  });
});

it("keeps equal-priced dish places and the saved discount holder on a repeat", () => {
  const starter = dish("first", "starter", 900);
  const second = { ...starter, id: "second" };
  const main = dish("main", "main", 1500);
  const lunch = offer("lunch", 1400, [starter, main]);
  const previous = {
    setMenus: [savedMenu("A", "lunch"), savedMenu("B", "lunch", "grant")],
    dishes: [{ id: "first", place: null }, savedDish("second", "B", 0), savedDish("main", "B", 1)],
  };
  const result = group({
    offers: [lunch],
    dishes: [starter, second, main],
    discounts: [{ id: "grant", offerId: "lunch", kind: "amount", cents: 200 }],
    previous,
  });
  expect(result).toMatchObject({
    exact: true,
    totalCents: 2100,
    setMenus: [{ id: "B", discountId: "grant" }],
    dishes: [previous.dishes[0], previous.dishes[2], previous.dishes[1]],
  });
});

it("charges one discount on a mixed-rate menu and its supplement", () => {
  const starter = { ...dish("starter", "starter", 1800), takeawayRateBps: 1000 };
  const main = { ...dish("main", "main", 2200), takeawayRateBps: 2100 };
  const lunch = offer("lunch", 1401, [starter, main], { main: 300 });
  const result = group({
    offers: [lunch],
    dishes: [starter, main],
    discounts: [{ id: "grant", offerId: "lunch", kind: "percent", basisPoints: 5000 }],
  });
  expect(result).toMatchObject({
    exact: true,
    totalCents: 850,
    setMenus: [{ offerId: "lunch", discountId: "grant", discountCents: 851 }],
  });
});

it("replaces a saved menu's discount even when the previous discount was larger", () => {
  const first = dish("first", "main", 1700);
  const second = { ...first, id: "second" };
  const lunch = offer("lunch", 1400, [first]);
  const discounts = [
    { id: "before", offerId: "lunch", kind: "amount", cents: 500 },
    { id: "after", offerId: "lunch", kind: "amount", cents: 200, replacesDiscountId: "before" },
  ] as const;
  const result = group({
    offers: [lunch],
    dishes: [first, second],
    discounts,
    previous: {
      setMenus: [savedMenu("A", "lunch"), savedMenu("B", "lunch", "before")],
      dishes: [savedDish(first.id, "A", 0), savedDish(second.id, "B", 0)],
    },
  });
  expect(result).toMatchObject({
    exact: true,
    totalCents: 2600,
    setMenus: [
      { id: "A", discountId: null },
      { id: "B", discountId: "after" },
    ],
    unusedDiscountIds: ["before"],
  });
});

it("keeps a proven price at the limit for choosing between equally priced places", () => {
  const main = dish("main", "main", 900);
  const offers = Array.from({ length: 160 }, (_, i) => offer(`lunch-${i}`, 500, [main]));
  const result = group({
    offers,
    dishes: [main],
    previous: { setMenus: [], dishes: [{ id: main.id, place: null }] },
  });
  expect(result).toMatchObject({ exact: true, totalCents: 500 });
});

it("keeps the cheaper complete bill found before the discount search reaches its limit", () => {
  const dishes = [
    dish("0", "starter", 2),
    dish("1", "starter", 4),
    dish("2", "main", 1),
    dish("3", "main", 11),
  ];
  const input = {
    dishes,
    offers: [
      offer("lunch", 1, dishes, { "0": 5, "1": 4, "2": 6, "3": 6 }),
      offer("special", 1, dishes.slice(1), { "1": 6, "2": 6, "3": 5 }),
    ],
    discounts: [
      { id: "one", offerId: "lunch", kind: "percent", basisPoints: 5000 },
      { id: "two", offerId: "special", kind: "amount", cents: 7 },
      { id: "three", offerId: "lunch", kind: "percent", basisPoints: 7500 },
    ] as const,
  };
  // Two dishes cost 3¢ à la carte. The discounted menus cost 0¢ and 1¢.
  expect(group(input).totalCents).toBe(4);
});

function table(seats: number, offerCount: number) {
  const source = boundTable(1515, seats);
  const courses = new Map(
    source.offers.flatMap(({ dishes }) =>
      dishes.map(({ productId, countsAsCourseId }) => [productId, countsAsCourseId] as const),
    ),
  );
  return {
    offers: source.offers.slice(0, offerCount),
    dishes: source.dishes.map(({ id, productId }) =>
      dish(id, courses.get(productId)!, 900, productId),
    ),
  };
}

it("fits and repeats a five-course bill with eight diners and a percentage discount", () => {
  const input = {
    ...table(8, 4),
    discounts: [{ id: "grant", offerId: "offer-0", kind: "percent", basisPoints: 1000 }] as const,
  };
  const start = performance.now();
  const first = group(input);
  expect(performance.now() - start).toBeLessThan(500);
  expect(first).toMatchObject({ exact: true, unusedDiscountIds: [] });
  expect(first.totalCents).toBeLessThan(36000);
  const repeatStart = performance.now();
  expect(group({ ...input, previous: first })).toEqual(first);
  expect(performance.now() - repeatStart).toBeLessThan(500);
});

it("opens a useful menu at the limit and closes it after a cancellation without moving saved places", () => {
  const input = table(40, 5);
  const starter = dish("new-starter", "starter", 900);
  const main = dish("new-main", "main", 900);
  const dishes = [...input.dishes, starter, main];
  const offers = [...input.offers, offer("lunch", 1400, [starter, main])];
  const start = performance.now();
  const first = group({ offers, dishes });
  expect(performance.now() - start).toBeLessThan(500);
  expect(first.exact).toBe(false);
  const lunch = first.setMenus.find(({ offerId }) => offerId === "lunch");
  expect(lunch?.baseCents).toBe(1400);
  expect(group({ offers, dishes, previous: first })).toEqual(first);

  const remaining = dishes.filter(({ id }) => id !== main.id);
  const after = group({ offers, dishes: remaining, previous: first });
  expect(after.setMenus).toEqual(first.setMenus.filter((menu) => menu !== lunch));
  expect(after.totalCents).toBe(first.totalCents - 500);
  expect(after.dishes.find(({ id }) => id === starter.id)?.place).toBeNull();
  expect(group({ offers, dishes: remaining, previous: after })).toEqual(after);
  expect(after.dishes.filter(({ id }) => id !== starter.id)).toEqual(
    first.dishes.filter(({ id }) => id !== starter.id && id !== main.id),
  );
});

it("moves a released dish into a saved place immediately at the limit", () => {
  const large = table(40, 5);
  const starter = dish("lunch-starter", "starter", 900);
  const main = dish("other-main", "main", 1600);
  const lunch = offer("lunch", 1400, [starter]);
  const other = offer("other", 1400, [starter, main], { "lunch-starter": 100 });
  const previous = {
    setMenus: [savedMenu("A", "lunch"), savedMenu("B", "other")],
    dishes: [savedDish(starter.id, "A", 0), savedDish(main.id, "B", 1)],
  };
  const input = {
    offers: [...large.offers, lunch, other],
    dishes: [...large.dishes, starter, main],
  };
  const result = group({ ...input, previous });
  expect(result.exact).toBe(false);
  expect(result.dishes.find(({ id }) => id === starter.id)?.place?.setMenuId).toBe("B");
  expect(group({ ...input, previous: result })).toEqual(result);
});

it("keeps the larger discount on the surviving menu at the limit", () => {
  const large = table(40, 5);
  const first = dish("first", "main", 1700);
  const second = { ...first, id: "second", aLaCarteCents: 800 };
  const lunch = offer("lunch", 1400, [first]);
  const discounts = [
    { id: "less", offerId: "lunch", kind: "amount", cents: 200 },
    { id: "more", offerId: "lunch", kind: "amount", cents: 500 },
  ] as const;
  const previous = {
    setMenus: [savedMenu("A", "lunch", "less"), savedMenu("B", "lunch", "more")],
    dishes: [savedDish("first", "A", 0), savedDish("second", "B", 0)],
  };
  const result = group({
    offers: [...large.offers, lunch],
    dishes: [...large.dishes, first, second],
    discounts,
    previous,
  });
  expect(result.exact).toBe(false);
  expect(result.setMenus.filter(({ offerId }) => offerId === "lunch")).toMatchObject([
    { id: "A", discountId: "more", discountCents: 500 },
  ]);
  expect(result.unusedDiscountIds).toEqual(["less"]);
});
