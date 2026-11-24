import { expect, it } from "vitest";

import * as shared from "./index.js";
import { boundTable } from "./set-menu-fit.fixtures.js";
import type { SetMenuOffer } from "./set-menu-fit.js";
import type { SetMenuGroupingDish, SetMenuGroupingInput } from "./set-menu-grouping.js";

interface CpuUsage {
  readonly user: number;
  readonly system: number;
}

const process = Reflect.get(globalThis, "process") as {
  readonly env: { readonly STRYKER_MUTATOR_WORKER?: string };
  cpuUsage(previous?: CpuUsage): CpuUsage;
};

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

function expectWithinHalfSecond(start: number) {
  if (process.env.STRYKER_MUTATOR_WORKER === undefined) {
    expect(performance.now() - start).toBeLessThan(500);
  }
}

it("selects a partly filled menu and charges separately for a dish with an expensive supplement", () => {
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

it("forms two set menus from two starters and two mains", () => {
  const starter = dish("starter", "starter", 1000);
  const main = dish("main", "main", 1000);
  const lunch = offer("lunch", 1400, [starter, main]);
  const dishes = [
    starter,
    main,
    { ...starter, id: "second-starter" },
    { ...main, id: "second-main" },
  ];
  const result = group({ offers: [lunch], dishes });
  expect(result).toMatchObject({
    exact: true,
    totalCents: 2800,
    setMenus: [{ offerId: "lunch" }, { offerId: "lunch" }],
  });
  expect(result.dishes.every(({ place, chargeCents }) => place !== null && chargeCents === 0)).toBe(
    true,
  );
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
  // Two dishes cost 3¢ at their individual prices. The discounted menus cost 0¢ and 1¢.
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
  expectWithinHalfSecond(start);
  expect(first).toMatchObject({ exact: true, unusedDiscountIds: [] });
  expect(first.totalCents).toBeLessThan(36000);
  const repeatStart = performance.now();
  expect(group({ ...input, previous: first })).toEqual(first);
  expectWithinHalfSecond(repeatStart);
});

function compactCountLimitBill() {
  const portion = dish("regular-main", "main", 900);
  return {
    dishes: Array.from({ length: 10 }, (_, i) => ({ ...portion, id: `regular-${i}` })),
    offers: Array.from({ length: 11 }, (_, i) => offer(`regular-${i}`, 600 + 25 * i, [portion])),
  };
}

it("opens a useful menu at the limit and closes it after a cancellation without moving saved places", () => {
  const input =
    process.env.STRYKER_MUTATOR_WORKER === undefined ? table(40, 5) : compactCountLimitBill();
  const starter = dish("new-starter", "starter", 900);
  const main = dish("new-main", "main", 900);
  const dishes = [...input.dishes, starter, main];
  const offers = [...input.offers, offer("lunch", 1400, [starter, main])];
  const start = performance.now();
  const first = group({ offers, dishes });
  expectWithinHalfSecond(start);
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
}, 15_000);

it("moves a released dish into a saved place immediately at the limit", () => {
  const large = compactCountLimitBill();
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
  const large = compactCountLimitBill();
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

it.each([1800, 200])(
  "retains saved dish places when shifting the discount saves on a %i-cent dish",
  (aLaCarteCents) => {
    const first = dish("first", "starter", 1800);
    const second = { ...first, id: "second" };
    const plain = dish("plain", "main", 1800);
    const premium = dish("premium", "main", aLaCarteCents);
    const dishes = [first, second, plain, premium];
    const lunch = offer("lunch", 1400, [first, plain, premium], { premium: 300 });
    const discounts = [
      { id: "grant", offerId: "lunch", kind: "percent", basisPoints: 5000 },
    ] as const;
    const previous = {
      setMenus: [savedMenu("A", "lunch", "grant"), savedMenu("B", "lunch")],
      dishes: [
        savedDish(first.id, "A", 0),
        savedDish(second.id, "B", 0),
        savedDish(plain.id, "A", 1),
      ],
    };
    const result = group({ offers: [lunch], dishes, discounts, previous });
    expect(result).toMatchObject({
      exact: true,
      totalCents: 2250,
      setMenus: [
        { id: "A", discountId: null },
        { id: "B", discountId: "grant" },
      ],
      dishes: [
        previous.dishes[0],
        previous.dishes[2],
        savedDish(premium.id, "B", 1),
        previous.dishes[1],
      ],
    });
  },
);

it("leaves enough search to price an eight-diner bill with two percentage discounts", () => {
  const input = {
    ...table(8, 2),
    discounts: [
      { id: "first", offerId: "offer-0", kind: "percent", basisPoints: 1000 },
      { id: "second", offerId: "offer-1", kind: "percent", basisPoints: 1500 },
    ] as const,
  };
  const first = group(input);
  expect(first.exact).toBe(true);
  expect(first.totalCents).toBeLessThanOrEqual(16934);
  expect(group({ ...input, previous: first }).totalCents).toBe(first.totalCents);
});

it("keeps a free place usable when a saved menu empties at the limit", () => {
  const large = compactCountLimitBill();
  const comped = { ...dish("a1", "starter", 0), eligible: false };
  const starter = dish("b1", "starter", 1800);
  const inexpensive = dish("c1", "starter", 300);
  const main = dish("zd", "main", 900);
  const input = {
    offers: [
      ...large.offers,
      offer("a", 1400, [comped, inexpensive]),
      offer("b", 1400, [starter, main]),
    ],
    dishes: [...large.dishes, comped, starter, inexpensive, main],
    previous: {
      setMenus: [savedMenu("A", "a"), savedMenu("B", "b")],
      dishes: [savedDish(comped.id, "A", 0), savedDish(starter.id, "B", 0)],
    },
  };
  const result = group(input);
  expect(result.exact).toBe(false);
  expect(result.dishes.find(({ id }) => id === main.id)).toMatchObject({
    place: { setMenuId: "B", lineIndex: 1 },
    chargeCents: 0,
  });
});

it.each([
  { diners: 16, exact: true, totalCents: 19200 },
  { diners: 21, exact: false, totalCents: 25200 },
])(
  "chooses among overlapping offers with costly supplements for $diners diners",
  ({ diners, exact, totalCents }) => {
    const courses = ["starter", "main", "dessert"];
    const portions = courses.map((course) => dish(course, course, 900));
    const dishes = Array.from({ length: diners }, (_, i) =>
      portions.map((portion) => ({ ...portion, id: portion.id + i })),
    ).flat();
    const offers = [
      offer("a", 1100, portions, { starter: 300, main: 300, dessert: 300 }),
      ...[1200, 1250, 1300, 1350].map((price, i) => offer("offer-" + i, price, portions)),
    ];
    const result = group({ offers, dishes });
    expect(result).toMatchObject({ exact, totalCents });
    expect(group({ offers, dishes, previous: result })).toEqual(result);
  },
  15_000,
);

function compactPercentageDiscountBill() {
  const dishes = [dish("first-main", "main", 1500), dish("second-main", "main", 1500)];
  return {
    dishes,
    offers: [
      offer("offer-0", 1000, dishes, { "first-main": 5, "second-main": 4 }),
      offer("offer-1", 1010, dishes, { "first-main": 6, "second-main": 5 }),
    ],
  };
}

it("bounds the work on forty diners with two percentage discounts", () => {
  const underMutation = process.env.STRYKER_MUTATOR_WORKER !== undefined;
  const input = {
    ...(underMutation ? compactPercentageDiscountBill() : table(40, 2)),
    discounts: [
      { id: "first", offerId: "offer-0", kind: "percent", basisPoints: 1000 },
      { id: "second", offerId: "offer-1", kind: "percent", basisPoints: 1000 },
    ] as const,
  };
  const start = process.cpuUsage();
  const first = group(input);
  const elapsed = process.cpuUsage(start);
  // The compact bill discounts 1005¢ by 101¢ and 1015¢ by 102¢.
  expect(first.totalCents).toBe(underMutation ? 1817 : 83327);
  if (!underMutation) expect(elapsed.user + elapsed.system).toBeLessThan(500_000);
}, 15_000);

it("finds the zero-cent price on the first call when several discounts cover all supplements", () => {
  const dishes = [
    dish("0", "starter", 11),
    dish("1", "starter", 5),
    dish("2", "main", 2),
    dish("3", "main", 6),
  ];
  const input = {
    dishes,
    offers: [
      offer("lunch", 0, dishes, { "0": 2, "1": 1, "2": 3, "3": 5 }),
      offer("special", 2, dishes, { "0": 1, "1": 7, "3": 3 }),
    ],
    discounts: [
      { id: "one", offerId: "lunch", kind: "amount", cents: 3 },
      { id: "two", offerId: "special", kind: "amount", cents: 13 },
      { id: "three", offerId: "lunch", kind: "percent", basisPoints: 5000 },
    ] as const,
  };
  const result = group(input);
  expect(result).toMatchObject({ exact: true, totalCents: 0 });
  expect(group({ ...input, previous: result })).toEqual(result);
});

it("keeps the intact saved menu when equally many dishes still fit in each menu", () => {
  const soup = dish("soup", "starter", 900);
  const hake = dish("hake", "main", 400);
  const flan = dish("flan", "dessert", 200);
  const salad = dish("salad", "starter", 900);
  const bass = dish("bass", "main", 1500);
  const lunch = offer("lunch", 1400, [soup, hake, flan, salad, bass]);
  const previous = {
    setMenus: [savedMenu("A", "lunch"), savedMenu("B", "lunch")],
    dishes: [
      savedDish(soup.id, "A", 0),
      savedDish(hake.id, "A", 1),
      savedDish(flan.id, "A", 2),
      savedDish(salad.id, "B", 0),
      savedDish(bass.id, "B", 1),
    ],
  };
  const result = group({ offers: [lunch], dishes: [soup, hake, salad, bass], previous });
  expect(result).toMatchObject({ exact: true, totalCents: 2700, setMenus: [{ id: "B" }] });
  expect(result.dishes).toContainEqual({
    ...savedDish(bass.id, "B", 1),
    chargeCents: 0,
    extrasCents: 0,
  });
  expect(result.dishes).toContainEqual({
    ...savedDish(salad.id, "B", 0),
    chargeCents: 0,
    extrasCents: 0,
  });
});

it("keeps a saved dish when its extra half-cent rounds to the same price", () => {
  const first = dish("first", "starter", 900);
  const second = dish("second", "starter", 900);
  const main = dish("main", "main", 900);
  const dessert = dish("dessert", "dessert", 900);
  const lunch = offer("lunch", 1400, [first, second], { first: 1 });
  const special = offer("special", 1400, [main, dessert]);
  const previous = {
    setMenus: [savedMenu("A", "lunch", "grant")],
    dishes: [savedDish(first.id, "A", 0), { id: second.id, place: null }],
  };
  const result = group({
    offers: [lunch, special],
    dishes: [first, second, main, dessert],
    discounts: [{ id: "grant", offerId: "lunch", kind: "percent", basisPoints: 5000 }],
    previous,
  });
  expect(result).toMatchObject({ exact: true, totalCents: 3000 });
  expect(result.dishes.find(({ id }) => id === first.id)?.place).toEqual({
    setMenuId: "A",
    lineIndex: 0,
  });
  expect(result.dishes.find(({ id }) => id === second.id)?.place).toBeNull();
});

function threeCourseTable(diners: number, seed: number, offerCount: number, priceStep: number) {
  const next = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * max);
  };
  const courses = ["starter", "main", "dessert"];
  const products = courses.flatMap((courseId) =>
    Array.from({ length: 4 }, (_, i) => ({
      productId: `${courseId}-${i}`,
      variantId: null,
      courseId,
    })),
  );
  const dishes = Array.from({ length: diners }, (_, i) =>
    courses.map((courseId, course) => {
      const product = products[course * 4 + next(4)]!;
      return {
        ...product,
        id: `${courseId}-${i}`,
        aLaCarteCents: 650 + next(550),
        eligible: true,
        extrasCents: 0,
      };
    }),
  ).flat();
  const offers = Array.from({ length: offerCount }, (_, i) => ({
    id: `offer-${i}`,
    priceCents: 1500 + priceStep * i,
    lines: courses.map((courseId) => ({ courseIds: [courseId], count: 1 })),
    dishes: products
      .filter((_, j) => j % 4 === 0 || next(5) > 0)
      .map(({ courseId, ...product }) => ({
        ...product,
        countsAsCourseId: courseId,
        surchargeCents: next(5) < 2 ? 50 + next(350) : 0,
      })),
  }));
  return { offers, dishes };
}

it.each([
  { diners: 8, seed: 2, totalCents: 13257, allPlacesKept: true },
  { diners: 9, seed: 3, totalCents: 14836, allPlacesKept: false },
])("keeps the cheaper complete bill at the limit for $diners diners", (sample) => {
  const { offers, dishes } = threeCourseTable(sample.diners, sample.seed, 3, 125);
  const discounts = [
    { id: "a", offerId: "offer-0", kind: "percent", basisPoints: 1000 },
    { id: "b", offerId: "offer-1", kind: "percent", basisPoints: 1500 },
    { id: "c", offerId: "offer-2", kind: "percent", basisPoints: 1250 },
  ] as const;
  const previous = group({ offers, dishes: dishes.slice(0, -4), discounts, previous: null });
  const input = { offers, dishes, discounts, previous };
  const result = group(input);
  expect(result).toMatchObject({ exact: false, totalCents: sample.totalCents });
  const allPlacesKept = previous.dishes.every((saved) => {
    if (!saved.place) return true;
    const place = result.dishes.find(({ id }) => id === saved.id)?.place;
    return place?.setMenuId === saved.place.setMenuId && place.lineIndex === saved.place.lineIndex;
  });
  expect(allPlacesKept).toBe(sample.allPlacesKept);
  const repeat = group({ ...input, previous: result });
  expect(repeat.totalCents).toBe(result.totalCents);
  expect(repeat.dishes).toEqual(result.dishes);
});

it("charges separately for a cheap dish when one fixed discount covers only one supplement", () => {
  const large = compactCountLimitBill();
  const starter = dish("starter", "starter", 220);
  const main = dish("main", "main", 40);
  const lunch = offer("lunch", 1400, [starter, main], { starter: 100, main: 100 });
  const result = group({
    offers: [...large.offers, lunch],
    dishes: [...large.dishes, starter, main],
    discounts: [{ id: "grant", offerId: "lunch", kind: "amount", cents: 1500 }],
  });
  expect(result.exact).toBe(false);
  expect(result.dishes.find(({ id }) => id === "main")).toMatchObject({
    place: null,
    chargeCents: 40,
  });
  expect(result.setMenus.find(({ offerId }) => offerId === "lunch")).toMatchObject({
    baseCents: 1400,
    discountCents: 1500,
  });
});

it("proves prices with two discounts that only yield whole-cent supplements", () => {
  const tableInput = table(8, 2);
  const offers = tableInput.offers.map((item) => ({
    ...item,
    dishes: item.dishes.map((listing) => ({
      ...listing,
      surchargeCents: Math.trunc(listing.surchargeCents / 10) * 10,
    })),
  }));
  const input = {
    ...tableInput,
    offers,
    discounts: [
      { id: "a", offerId: "offer-0", kind: "percent", basisPoints: 1000 },
      { id: "b", offerId: "offer-1", kind: "percent", basisPoints: 1000 },
    ] as const,
  };
  const result = group(input);
  expect(result.exact).toBe(true);
  expect(group({ ...input, previous: result })).toEqual(result);
});

it("fills a free saved place without using a fixed discount allowance twice", () => {
  const large = compactCountLimitBill();
  const starter = dish("starter", "starter", 900);
  const main = dish("main", "main", 40);
  const dessert = dish("dessert", "dessert", 50);
  const lunch = offer("lunch", 1400, [starter, main, dessert], { starter: 100, main: 100 });
  const result = group({
    offers: [...large.offers, lunch],
    dishes: [...large.dishes, starter, main, dessert],
    discounts: [{ id: "grant", offerId: "lunch", kind: "amount", cents: 1500 }],
    previous: {
      setMenus: [savedMenu("A", "lunch", "grant")],
      dishes: [savedDish(starter.id, "A", 0)],
    },
  });
  expect(result.exact).toBe(false);
  expect(result.dishes.find(({ id }) => id === main.id)).toMatchObject({
    place: null,
    chargeCents: 40,
  });
  expect(result.dishes.find(({ id }) => id === dessert.id)).toMatchObject({
    place: { setMenuId: "A", lineIndex: 2 },
    chargeCents: 0,
  });
});

it.each([
  { diners: 16, seed: 7, exact: true, totalCents: 25336 },
  { diners: 21, seed: 8, exact: false, totalCents: 33183 },
])(
  "keeps the cheaper bill when $diners diners order course by course",
  (sample) => {
    const input = threeCourseTable(sample.diners, sample.seed * 7919, 5, 40);
    const starters = group({
      ...input,
      dishes: input.dishes.filter(({ courseId }) => courseId === "starter"),
    });
    const mains = group({
      ...input,
      dishes: input.dishes.filter(({ courseId }) => courseId !== "dessert"),
      previous: starters,
    });
    const result = group({ ...input, previous: mains });
    expect(result).toMatchObject({ exact: sample.exact, totalCents: sample.totalCents });
    expect(group({ ...input, previous: result })).toEqual(result);
  },
  15_000,
);
