import { describe, expect, it } from "vitest";
import {
  fromDraftLine,
  orderLineMergeKey,
  rebuildReturned,
  toDraftLineInput,
} from "./draft-lines.js";
import { lineBlock } from "./menu-refresh.js";
import { draftSections } from "./draft-groups.js";
import { productAsVariant } from "./order-line.js";
import { WorkingOrderStore, type OrderLine } from "./working-order.js";
import type { Place } from "./draft-place.js";
import {
  menuOfferToTillProduct,
  type DraftLine,
  type DraftLineInput,
  type TillMenuOffer,
  type TillProduct,
} from "../api/client.js";

type LiveModifier = TillMenuOffer["offeredModifiers"][number];
type LiveVariant = TillMenuOffer["variants"][number];

const each = {
  id: "unit-each",
  name: { en: "each" },
  abbreviation: { en: "ea" },
  precision: 0,
  hardwareUnit: null,
};
const kg = {
  ...each,
  id: "unit-kg",
  name: { en: "kg" },
  precision: 3,
  hardwareUnit: "kg" as const,
};

function offer(overrides: Partial<TillMenuOffer> & Pick<TillMenuOffer, "id" | "productId">) {
  return {
    menuId: "dinner",
    grossPrice: null,
    unitPrice: "12.00",
    available: true,
    image: null,
    description: null,
    menuName: "Dinner",
    placements: [[]],
    name: `${overrides.productId} staff`,
    customerName: null,
    kitchenName: null,
    unit: each,
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

function variant(id: string, unitPrice: string): LiveVariant {
  return {
    id,
    name: `${id} staff`,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice,
    menuPrice: null,
    available: true,
    unit: each,
    pricingUnit: "each",
    vatClass: "general",
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId: null,
  };
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
    name: `${productId} staff`,
    customerName: null,
    kitchenName: null,
    price,
    vatClass: "general" as const,
    maxQuantity: 3,
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
  return {
    id,
    name: `${id} staff`,
    customerName: { en: `${id} menu` },
    kitchenName: `${id} KDS`,
    available,
  };
}

function optionsList(id: string, labels: ReturnType<typeof label>[]): LiveModifier {
  return {
    kind: "options",
    id,
    name: `${id} staff`,
    customerName: null,
    kitchenName: `${id} KDS`,
    defaultLabelId: null,
    publishedDefaultLabelId: null,
    labels,
  };
}

const burger = offer({
  id: "mi-burger",
  productId: "p-burger",
  variants: [variant("v-double", "15.00")],
  offeredModifiers: [
    optionsList("doneness", [label("rare"), label("well-done")]),
    optionsList("onions", [label("none"), label("extra")]),
    extrasList("toppings", [extraItem("p-cheese", "1.00"), extraItem("p-bacon", "1.50")]),
    extrasList("premium-toppings", [extraItem("p-cheese", "2.00")]),
  ],
});
const fish = offer({ id: "mi-fish", productId: "p-fish", unit: kg, unitPrice: "30.00" });
const offers = new Map([burger, fish].map((entry) => [entry.id, entry]));

const VERSION = "mv-7";
const doubleBurger = (): TillProduct => {
  const dish = menuOfferToTillProduct(burger, VERSION);
  return productAsVariant(dish, dish.variants![0]!);
};

/** The line a till builds from the picker: a Double Burger, rare, no onions, cheese twice and bacon. */
const burgerLine = (): OrderLine => ({
  product: doubleBurger(),
  quantity: "2",
  options: [
    { listId: "doneness", labelId: "rare" },
    { listId: "onions", labelId: "none" },
  ],
  optionSnapshots: [
    {
      listName: { en: "doneness staff" },
      listCustomerName: null,
      listKitchenName: "doneness KDS",
      labelName: { en: "rare staff" },
      labelCustomerName: { en: "rare menu" },
      labelKitchenName: "rare KDS",
    },
    {
      listName: { en: "onions staff" },
      listCustomerName: null,
      listKitchenName: "onions KDS",
      labelName: { en: "none staff" },
      labelCustomerName: { en: "none menu" },
      labelKitchenName: "none KDS",
    },
  ],
  extras: [
    {
      listId: "toppings",
      productId: "p-cheese",
      name: "p-cheese staff",
      price: "1.00",
      quantity: 2,
    },
    { listId: "toppings", productId: "p-bacon", name: "p-bacon staff", price: "1.50", quantity: 1 },
  ],
  note: "no salt",
  courseId: "course-mains",
});

/** What the server answers for a saved input: a fresh id, the quantity at three places. */
const saved = (input: DraftLineInput, quantity: string): DraftLine => ({
  ...input,
  id: "dl-1",
  quantity,
  unavailable: false,
});

describe("toDraftLineInput", () => {
  it.each([
    [{ kind: "fire" }, { slot: 0, joinGroupId: null, afterGroupId: null }],
    [
      { kind: "new", slot: 3 },
      { slot: 3, joinGroupId: null, afterGroupId: null },
    ],
    [
      { kind: "new", slot: 2, afterGroupId: "g1" },
      { slot: 2, joinGroupId: null, afterGroupId: "g1" },
    ],
    [
      { kind: "join", groupId: "g2" },
      { slot: 0, joinGroupId: "g2", afterGroupId: null },
    ],
  ] satisfies [Place, Pick<DraftLineInput, "slot" | "joinGroupId" | "afterGroupId">][])(
    "round-trips the %j place through a saved draft",
    (place, wire) => {
      const line: OrderLine = { ...burgerLine(), place };
      const input = toDraftLineInput(line);
      expect(input).toMatchObject(wire);
      const restored = fromDraftLine({ ...saved(input, "2.000"), ...wire }, offers);
      expect(restored.place ?? { kind: "fire" }).toEqual(place);
      expect(toDraftLineInput(restored)).toEqual(input);
    },
  );

  it("keeps identical dishes in different places separate in the till's merge key", () => {
    const line = burgerLine();
    expect(orderLineMergeKey({ ...line, place: { kind: "new", slot: 1 } })).not.toBe(
      orderLineMergeKey(line),
    );
    expect(orderLineMergeKey({ ...line, place: { kind: "join", groupId: "g2" } })).not.toBe(
      orderLineMergeKey({ ...line, place: { kind: "join", groupId: "g3" } }),
    );
    expect(
      orderLineMergeKey({ ...line, place: { kind: "new", slot: 1, afterGroupId: "g2" } }),
    ).not.toBe(orderLineMergeKey({ ...line, place: { kind: "new", slot: 1, afterGroupId: "g3" } }));
    expect(orderLineMergeKey({ ...line, place: { kind: "fire" } })).toBe(orderLineMergeKey(line));
  });

  it("keeps an unavailable dish's place when its offer returns", () => {
    const input = { ...toDraftLineInput(burgerLine()), slot: 2, afterGroupId: "g3" };
    const missing = fromDraftLine(saved(input, "2.000"), new Map());
    const returned = rebuildReturned([missing], offers, new Map([["dinner", VERSION]])).get(0)!;
    expect(returned.place).toEqual({ kind: "new", slot: 2, afterGroupId: "g3" });
    expect(toDraftLineInput(returned)).toEqual(input);
  });

  it("gives an unplaced line explicit Fire-now wire defaults", () => {
    expect(toDraftLineInput(burgerLine())).toMatchObject({
      slot: 0,
      joinGroupId: null,
      afterGroupId: null,
    });
  });

  it("sends a plain line's menu item and version, with every other part empty", () => {
    const line: OrderLine = { product: menuOfferToTillProduct(fish, VERSION), quantity: "0.350" };
    expect(toDraftLineInput(line)).toEqual({
      slot: 0,
      joinGroupId: null,
      afterGroupId: null,
      menuItemId: "mi-fish",
      variantId: null,
      menuVersionId: VERSION,
      options: [],
      extras: [],
      note: null,
      quantity: "0.350",
      courseId: null,
      noMerge: false,
    });
  });

  it("sends the variant, each answer, each list's picks, the note, the course and no-merge", () => {
    expect(toDraftLineInput({ ...burgerLine(), noMerge: true })).toEqual({
      slot: 0,
      joinGroupId: null,
      afterGroupId: null,
      menuItemId: "mi-burger",
      variantId: "v-double",
      menuVersionId: VERSION,
      options: [
        { listId: "doneness", labelId: "rare" },
        { listId: "onions", labelId: "none" },
      ],
      extras: [
        {
          listId: "toppings",
          picks: [
            { productId: "p-cheese", quantity: 2 },
            { productId: "p-bacon", quantity: 1 },
          ],
        },
      ],
      note: "no salt",
      quantity: "2",
      courseId: "course-mains",
      noMerge: true,
    });
  });

  it("sends no version for a line priced by the server from the live one", () => {
    const line: OrderLine = { product: menuOfferToTillProduct(fish), quantity: "1" };
    expect(toDraftLineInput(line).menuVersionId).toBeNull();
  });

  it("sends a note as the server keeps it: trimmed, and none when blank", () => {
    const line = (note: string): OrderLine => ({ ...burgerLine(), note });
    expect(toDraftLineInput(line("  no salt ")).note).toBe("no salt");
    expect(toDraftLineInput(line("   ")).note).toBeNull();
  });

  it("refuses a product that names no menu item, which no draft line can carry", () => {
    const line: OrderLine = {
      product: { ...doubleBurger(), menuItemId: undefined },
      quantity: "1",
    };
    expect(() => toDraftLineInput(line)).toThrow(/no menu item/);
  });
});

describe("fromDraftLine", () => {
  it("keeps matching read course metadata locally and omits it from every save", () => {
    const input = toDraftLineInput(burgerLine());
    const course = {
      id: "retired",
      name: "Recorded dessert",
      displayOrder: 3,
      heldUntilFired: true,
    };
    const restored = fromDraftLine(
      { ...input, courseId: course.id, course, unavailable: false },
      new Map(),
    );
    expect(restored.course).toEqual(course);
    expect(toDraftLineInput(restored)).toEqual({ ...input, courseId: course.id });
    const working = new WorkingOrderStore();
    working.loadFrom("draft", [restored]);
    working.setLineCourse(0, "new-course");
    expect(working.lines[0]!.course).toBeUndefined();
  });

  it("rebuilds a line with a variant, options and extras from the offer, keeping every id, the quantity and each selection", () => {
    const line = burgerLine();
    const input = toDraftLineInput(line);

    const rebuilt = fromDraftLine(saved(input, "2.000"), offers);

    expect(toDraftLineInput(rebuilt)).toEqual(input);
    expect(rebuilt).toEqual(line);
  });

  it("rebuilds a weighed line at its own places", () => {
    const line: OrderLine = { product: menuOfferToTillProduct(fish, VERSION), quantity: "0.350" };
    expect(fromDraftLine(saved(toDraftLineInput(line), "0.350"), offers)).toEqual(line);
  });

  it("rebuilds a line with no version or variant as the live offer sells it", () => {
    const line: OrderLine = { product: menuOfferToTillProduct(fish), quantity: "1.250" };
    expect(fromDraftLine(saved(toDraftLineInput(line), "1.250"), offers)).toEqual(line);
  });

  it("keeps a not-offered line with no version or variant without inventing either", () => {
    const input = toDraftLineInput({ product: menuOfferToTillProduct(fish), quantity: "1" });
    const rebuilt = fromDraftLine(saved(input, "1.000"), new Map());
    expect(rebuilt.product.variantId).toBeUndefined();
    expect(rebuilt.product.menuVersionId).toBeUndefined();
    expect(toDraftLineInput(rebuilt)).toEqual({ ...input, quantity: "1" });
  });

  it("keeps the no-merge mark", () => {
    const line: OrderLine = { ...burgerLine(), noMerge: true };
    expect(fromDraftLine(saved(toDraftLineInput(line), "2.000"), offers)).toEqual(line);
  });

  it("keeps a line whose menu item is no longer offered, with its ids, marked as not offered", () => {
    const input = toDraftLineInput(burgerLine());
    const rebuilt = fromDraftLine({ ...saved(input, "2.000"), unavailable: true }, new Map());

    expect(rebuilt.notOffered).toBe(true);
    expect(rebuilt.blocked).toBe("removed");
    expect(rebuilt.product.name).toBe("");
    expect(toDraftLineInput(rebuilt)).toEqual(input);
  });

  it("keeps a variant, a pick and an answer the offer no longer holds, by their ids", () => {
    const input: DraftLineInput = {
      ...toDraftLineInput(burgerLine()),
      variantId: "v-gone",
      options: [{ listId: "doneness", labelId: "blue" }],
      extras: [{ listId: "toppings", picks: [{ productId: "p-gone", quantity: 1 }] }],
    };

    const rebuilt = fromDraftLine(saved(input, "2.000"), offers);

    expect(toDraftLineInput(rebuilt)).toEqual(input);
    expect(rebuilt.notOffered).toBeUndefined();
    expect(rebuilt.product.variantName).toBeUndefined();
    expect(rebuilt.extras).toEqual([
      { listId: "toppings", productId: "p-gone", name: "", price: "0.00", quantity: 1 },
    ]);
    expect(rebuilt.optionSnapshots).toBeUndefined();
  });

  describe("a pick on a variant whose unit no longer takes extras", () => {
    /** The live burger, whose Double is sold by `unit`. */
    const soldBy = (unit: typeof each & { measure?: true }) => {
      const live = offer({
        ...burger,
        variants: [{ ...variant("v-double", "15.00"), unit }],
      });
      return { live, offers: new Map([[live.id, live]]) };
    };
    const input = toDraftLineInput(burgerLine());

    it("comes back as a pick the offer no longer holds, which stops the line, once it is a measure", () => {
      const { live, offers: measured } = soldBy({ ...each, measure: true });

      const rebuilt = fromDraftLine(saved(input, "2.000"), measured);

      expect(toDraftLineInput(rebuilt)).toEqual(input);
      expect(rebuilt.extras).toEqual([
        { listId: "toppings", productId: "p-cheese", name: "", price: "0.00", quantity: 2 },
        { listId: "toppings", productId: "p-bacon", name: "", price: "0.00", quantity: 1 },
      ]);
      expect(lineBlock(rebuilt, live)?.reason).toBe("extra_removed");
    });

    it("comes back named and priced, stopping nothing, while it is not a measure", () => {
      const { live, offers: counted } = soldBy(each);

      const rebuilt = fromDraftLine(saved(input, "2.000"), counted);

      expect(rebuilt.extras).toEqual(burgerLine().extras);
      expect(lineBlock(rebuilt, live)).toBeUndefined();
    });
  });

  it("names a pick or an answer the offer holds but cannot sell now", () => {
    const soldOut = offer({
      ...burger,
      offeredModifiers: [
        optionsList("doneness", [label("rare", false)]),
        extrasList("toppings", [extraItem("p-cheese", "1.00", false)]),
      ],
    });
    const input: DraftLineInput = {
      ...toDraftLineInput(burgerLine()),
      options: [{ listId: "doneness", labelId: "rare" }],
      extras: [{ listId: "toppings", picks: [{ productId: "p-cheese", quantity: 1 }] }],
    };

    const rebuilt = fromDraftLine(saved(input, "2.000"), new Map([[soldOut.id, soldOut]]));

    expect(rebuilt.extras?.[0]?.name).toBe("p-cheese staff");
    expect(rebuilt.optionSnapshots?.[0]?.labelName).toEqual({ en: "rare staff" });
  });
});

describe("fromDraftLine: what the server and the live menu say about the line", () => {
  it("carries the server's flag that the line cannot be sold now, and nothing when it can", () => {
    const input = toDraftLineInput(burgerLine());
    expect(
      fromDraftLine({ ...saved(input, "2.000"), unavailable: true }, offers).unavailableOnServer,
    ).toBe(true);
    expect(fromDraftLine(saved(input, "2.000"), offers)).not.toHaveProperty("unavailableOnServer");
  });

  it("marks a line priced against a version other than the live one as holding no earlier price", () => {
    const input = toDraftLineInput(burgerLine());
    const live = (version: string) => new Map([["dinner", version]]);

    const stale = fromDraftLine(saved(input, "2.000"), offers, live("mv-8"));
    expect(stale.earlierPriceUnknown).toBe(true);
    expect(stale.product.menuVersionId).toBe(VERSION);
    expect(fromDraftLine(saved(input, "2.000"), offers, live(VERSION))).toEqual(burgerLine());
    const unversioned = { ...input, menuVersionId: null };
    expect(
      fromDraftLine(saved(unversioned, "2.000"), offers, live("mv-8")).earlierPriceUnknown,
    ).toBeUndefined();
    expect(fromDraftLine(saved(input, "2.000"), new Map(), live("mv-8")).earlierPriceUnknown).toBe(
      undefined,
    );
  });
});

describe("fromDraftLine: a saved quantity the offered unit cannot hold", () => {
  const preview = (line: OrderLine) => {
    const store = new WorkingOrderStore();
    store.loadFrom("draft-1", [line]);
    return { vatBreakdown: store.vatBreakdown, total: store.total };
  };

  it("keeps a weighed dish no longer offered at its exact quantity, and the preview reads it", () => {
    const input = toDraftLineInput({
      product: menuOfferToTillProduct(fish, VERSION),
      quantity: "0.350",
    });
    const rebuilt = fromDraftLine(saved(input, "0.350"), new Map());

    expect(() => preview(rebuilt)).not.toThrow();
    expect(preview(rebuilt).total).toBe("0.00");
    expect(rebuilt.quantity).toBe("0.35");
    expect(toDraftLineInput(rebuilt)).toEqual({ ...input, quantity: "0.35" });
  });

  it("keeps a dish no longer offered at a whole quantity, and the preview reads it", () => {
    const rebuilt = fromDraftLine(saved(toDraftLineInput(burgerLine()), "2.000"), new Map());
    expect(rebuilt.quantity).toBe("2");
    expect(rebuilt.product.unit?.precision).toBe(3);
    expect(preview(rebuilt).total).toBe("0.00");
  });

  it("never trims the zeros of a whole quantity written without places", () => {
    const rebuilt = fromDraftLine(saved(toDraftLineInput(burgerLine()), "30"), new Map());
    expect(rebuilt.quantity).toBe("30");
    expect(rebuilt.blocked).toBe("removed");
  });

  it("keeps an offered dish whose unit now takes fewer places, marked, and the preview reads it", () => {
    const input = { ...toDraftLineInput(burgerLine()), quantity: "0.500" };
    const rebuilt = fromDraftLine(saved(input, "0.500"), offers);

    expect(() => preview(rebuilt)).not.toThrow();
    expect(preview(rebuilt).total).toBe("9.25");
    expect(rebuilt.quantity).toBe("0.500");
    expect(rebuilt.blocked).toBe("unit_changed");
    expect(toDraftLineInput(rebuilt)).toEqual(input);
  });

  it("leaves an offered line that fits its unit unmarked", () => {
    const rebuilt = fromDraftLine(saved(toDraftLineInput(burgerLine()), "2.000"), offers);
    expect(rebuilt.blocked).toBeUndefined();
    expect(rebuilt.product.unit?.precision).toBe(0);
  });
});

describe("rebuildReturned: a line kept while its dish was not offered", () => {
  const live = (version: string) => new Map([["dinner", version]]);
  const kept = (input: DraftLineInput, unavailable = false) =>
    fromDraftLine({ ...saved(input, "2.000"), unavailable }, new Map());

  it("rebuilds the line from the offer once it is back, keeping every id and selection", () => {
    const input = toDraftLineInput(burgerLine());

    const rebuilt = rebuildReturned([kept(input)], offers, live(VERSION));

    expect([...rebuilt]).toEqual([[0, burgerLine()]]);
    expect(toDraftLineInput(rebuilt.get(0)!)).toEqual(input);
  });

  it("keeps the recorded course section when an unavailable draft dish is offered again without leaking metadata into saves", () => {
    const input = { ...toDraftLineInput(burgerLine()), courseId: "retired" };
    const course = {
      id: "retired",
      name: "Recorded dessert",
      displayOrder: 3,
      heldUntilFired: true,
    };
    const missing = fromDraftLine(
      { ...saved(input, "2.000"), course, unavailable: true },
      new Map(),
    );
    expect(missing.notOffered).toBe(true);
    const rebuilt = rebuildReturned([missing], offers, live(VERSION)).get(0)!;

    expect(rebuilt.course).toEqual(course);
    expect(rebuilt.notOffered).toBeUndefined();
    expect(rebuilt.unavailableOnServer).toBe(true);
    expect(
      draftSections([{ courseId: rebuilt.courseId ?? null, course: rebuilt.course }], []),
    ).toEqual([{ course, lineIndexes: [0] }]);
    expect(toDraftLineInput(rebuilt)).toEqual(input);
    expect(missing.course).toEqual(course);
    expect(missing.notOffered).toBe(true);

    const working = new WorkingOrderStore();
    working.loadFrom("draft", [rebuilt]);
    working.setLineCourse(0, "new-course");
    expect(working.lines[0]!.course).toBeUndefined();
    expect(toDraftLineInput(working.lines[0]!)).toEqual({ ...input, courseId: "new-course" });
  });

  it("does not adopt recorded metadata for another course when an unavailable dish returns", () => {
    const missing = kept({ ...toDraftLineInput(burgerLine()), courseId: "selected" });
    const rebuilt = rebuildReturned(
      [
        {
          ...missing,
          course: {
            id: "retired",
            name: "Recorded dessert",
            displayOrder: 3,
            heldUntilFired: true,
          },
        },
      ],
      offers,
      live(VERSION),
    ).get(0)!;

    expect(rebuilt.courseId).toBe("selected");
    expect(rebuilt.course).toBeUndefined();
    expect(
      draftSections([{ courseId: rebuilt.courseId ?? null, course: rebuilt.course }], []),
    ).toEqual([{ course: null, lineIndexes: [0] }]);
  });

  it("marks the line as holding no earlier price when the offer is back under another version", () => {
    const rebuilt = rebuildReturned(
      [kept(toDraftLineInput(burgerLine()))],
      offers,
      live("mv-8"),
    ).get(0);

    expect(rebuilt).toEqual({ ...burgerLine(), earlierPriceUnknown: true });
  });

  it("keeps a pick the returned offer no longer holds, which still stops the line", () => {
    const input: DraftLineInput = {
      ...toDraftLineInput(burgerLine()),
      extras: [{ listId: "toppings", picks: [{ productId: "p-gone", quantity: 1 }] }],
    };

    const rebuilt = rebuildReturned([kept(input)], offers, live(VERSION)).get(0)!;

    expect(toDraftLineInput(rebuilt)).toEqual(input);
    expect(rebuilt.notOffered).toBeUndefined();
    expect(lineBlock(rebuilt, burger)?.reason).toBe("extra_removed");
  });

  it("carries the server's flag that the line cannot be sold now", () => {
    const rebuilt = rebuildReturned(
      [kept(toDraftLineInput(burgerLine()), true)],
      offers,
      live(VERSION),
    ).get(0);

    expect(rebuilt?.unavailableOnServer).toBe(true);
  });

  it("rebuilds a weighed dish at the quantity the kept line holds, not the one saved", () => {
    const input = toDraftLineInput({
      product: menuOfferToTillProduct(fish, VERSION),
      quantity: "0.350",
    });
    const fishKept = fromDraftLine(saved(input, "0.350"), new Map());

    const rebuilt = rebuildReturned([fishKept], offers, live(VERSION)).get(0);

    expect(rebuilt?.quantity).toBe("0.35");
    expect(fromDraftLine(saved(input, "0.350"), offers).quantity).toBe("0.350");
  });

  it("leaves out a line still not offered, and a line that is offered already", () => {
    const offered = fromDraftLine(saved(toDraftLineInput(burgerLine()), "2.000"), offers);
    const fishGone = kept(
      toDraftLineInput({ product: menuOfferToTillProduct(fish, VERSION), quantity: "1" }),
    );

    const rebuilt = rebuildReturned(
      [offered, fishGone],
      new Map([[burger.id, burger]]),
      live(VERSION),
    );

    expect(rebuilt.size).toBe(0);
  });
});

describe("orderLineMergeKey (D10, the shared rule)", () => {
  const beerOffer = offer({ id: "mi-beer", productId: "p-beer", unitPrice: "3.00" });
  const beer = (over: Partial<OrderLine> = {}): OrderLine => ({
    product: menuOfferToTillProduct(beerOffer, VERSION),
    quantity: "1",
    ...over,
  });

  it("gives two lines of one dish one key, and a line with a different course another", () => {
    const key = orderLineMergeKey(beer());
    expect(key).toEqual(expect.any(String));
    expect(orderLineMergeKey(beer())).toBe(key);
    expect(orderLineMergeKey(beer({ courseId: "course-drinks" }))).not.toBe(key);
  });

  it("gives a line that names no menu item no key", () => {
    const counter: OrderLine = {
      product: { ...beer().product, menuItemId: undefined },
      quantity: "1",
    };
    expect(orderLineMergeKey(counter)).toBeNull();
  });
});
