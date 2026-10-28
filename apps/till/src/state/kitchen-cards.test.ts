import { describe, expect, it } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import type { QueueGroup, StationQueueItem } from "../api/client.js";
import {
  type KitchenCard,
  type MergedQueueGroup,
  cardPlaces,
  dishesAt,
  headingStage,
  isCounterOrder,
  kitchenCards,
  lateCards,
  overviewDishes,
  thousandthsToMake,
} from "./kitchen-cards.js";
import { overviewRows } from "./kitchen-overview.js";
import { allergyBlock } from "../../test/kitchen-allergy-fixtures.js";

const THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

const at = (time: string) => `2026-10-26T${time}:00.000Z`;

function sentGroup(id: string, position: number, state: QueueGroup["state"] = "fired"): QueueGroup {
  return { id, position, displayNumber: position, numberPartyId: "party-1", state };
}

function dish(
  id: string,
  time: string,
  overrides: Partial<StationQueueItem> = {},
): StationQueueItem {
  return {
    allergy: null,
    id,
    workingOrderLineId: `line-${id}`,
    state: "queued",
    name: "Octopus",
    quantity: "1.000",
    course: null,
    firedAt: at(time),
    queuedAt: at(time),
    ...overrides,
  };
}

function held(
  id: string,
  time: string,
  overrides: Partial<StationQueueItem> = {},
): StationQueueItem {
  return dish(id, time, { firedAt: null, ...overrides });
}

function bill(
  orderId: string,
  items: StationQueueItem[],
  overrides: Partial<MergedQueueGroup> = {},
): MergedQueueGroup {
  return {
    kitchenNote: null,
    orderId,
    orderNumber: 12,
    label: "Table 4",
    queuedAt: items[0]?.queuedAt ?? at("20:00"),
    status: "placed",
    thresholds: THRESHOLDS,
    bumpMode: "line",
    items,
    ...overrides,
  };
}

const party = { id: "party-1", revision: 1 };
const keys = (cards: KitchenCard[]) => cards.map((card) => card.key);
const ids = (card: KitchenCard | undefined) => card?.items.map((item) => item.id);
const one = (order: MergedQueueGroup): KitchenCard => {
  const [card] = kitchenCards([order]);
  if (card === undefined) throw new Error("no card");
  return card;
};

describe("kitchenCards", () => {
  it("makes one card per sent group, and one for an order with no party", () => {
    const g2 = sentGroup("g-2", 2);
    const g3 = sentGroup("g-3", 3);
    const partyBill = bill(
      "wo-1",
      [
        dish("a", "20:40", { group: g2 }),
        dish("b", "20:40", { group: g3 }),
        dish("moved", "20:40"),
        dish("c", "20:40", { group: g2 }),
      ],
      { party },
    );
    const counter = bill("wo-2", [dish("d", "20:40"), dish("e", "20:40")]);

    const cards = kitchenCards([partyBill, counter]);

    expect(keys(cards)).toEqual(["|o:wo-1", "|g:g-2", "|g:g-3", "|o:wo-2"]);
    expect(cards.map(ids)).toEqual([["moved"], ["a", "c"], ["b"], ["d", "e"]]);
    expect(cards.map((card) => card.group)).toEqual([null, g2, g3, null]);
    expect(cards.map((card) => card.orders)).toEqual([
      [partyBill],
      [partyBill],
      [partyBill],
      [counter],
    ]);
  });

  it("keeps each station's part of an order on its own card", () => {
    const grill = bill("wo-1", [dish("a", "20:40")], { stationId: "grill" });
    const fryer = bill("wo-1", [dish("b", "20:40")], { stationId: "fryer" });

    const cards = kitchenCards([grill, fryer]);

    expect(keys(cards)).toEqual(["grill|o:wo-1", "fryer|o:wo-1"]);
    expect(cards.map(ids)).toEqual([["a"], ["b"]]);
  });

  it("merges one group's dishes from two bills into one card", () => {
    const g2 = sentGroup("g-2", 2);
    const bill1 = bill(
      "wo-1",
      [dish("one-g2", "20:40", { group: g2 }), dish("one-moved", "20:40")],
      {
        party,
        orderNumber: 12,
      },
    );
    const bill2 = bill(
      "wo-2",
      [dish("two-g2", "20:40", { group: g2 }), dish("two-moved", "20:40")],
      {
        party,
        orderNumber: 13,
      },
    );

    const cards = kitchenCards([bill1, bill2]);

    expect(keys(cards)).toEqual(["|o:wo-1", "|g:g-2", "|o:wo-2"]);
    const merged = cards[1];
    expect(merged?.orders).toEqual([bill1, bill2]);
    expect(ids(merged)).toEqual(["one-g2", "two-g2"]);
    // A dish carries no order id of its own, so the card says which bill each came from.
    expect(merged?.orderOf.get("one-g2")).toBe(bill1);
    expect(merged?.orderOf.get("two-g2")).toBe(bill2);
    expect(cards[0]?.orders).toEqual([bill1]);
    expect(cards[2]?.orders).toEqual([bill2]);
  });

  it("puts a card in its least advanced dish's column, held dishes counting as Waiting", () => {
    const column = (...items: StationQueueItem[]) => one(bill("wo-1", items)).column;

    expect(column(dish("a", "20:40"), dish("b", "20:40", { state: "preparing" }))).toBe("queued");
    expect(
      column(dish("a", "20:40", { state: "preparing" }), dish("b", "20:40", { state: "ready" })),
    ).toBe("preparing");
    expect(
      column(dish("a", "20:40", { state: "ready" }), dish("b", "20:40", { state: "ready" })),
    ).toBe("ready");
    expect(column(held("a", "20:40"), dish("b", "20:40", { state: "ready" }))).toBe("queued");
  });

  it("ages a card from its own oldest fired dish, never a held one", () => {
    const g2 = sentGroup("g-2", 2);
    const g3 = sentGroup("g-3", 3);
    const cards = kitchenCards([
      bill(
        "wo-1",
        [
          held("waiting", "20:00", { group: g2 }),
          dish("first", "20:40", { group: g2 }),
          dish("second", "21:15", { group: g3 }),
          dish("later", "21:30", { group: g3 }),
        ],
        { party },
      ),
    ]);

    expect(cards.map((card) => card.since)).toEqual([
      Date.parse(at("20:40")),
      Date.parse(at("21:15")),
    ]);
    expect(one(bill("wo-2", [held("h", "20:00")])).since).toBeNull();
  });

  it("orders cards oldest first, untimed last, ties by the read then group position", () => {
    const partyBill = bill(
      "wo-1",
      [
        held("held", "20:00", { group: sentGroup("g-4", 4, "held") }),
        dish("second", "21:15", { group: sentGroup("g-3", 3) }),
        dish("first", "20:40", { group: sentGroup("g-2", 2) }),
      ],
      { party },
    );
    const counter = bill("wo-2", [dish("counter", "21:00")]);

    expect(keys(kitchenCards([partyBill, counter]))).toEqual([
      "|g:g-2",
      "|o:wo-2",
      "|g:g-3",
      "|g:g-4",
    ]);
  });
});

describe("a card's course sections", () => {
  const starters = { id: "co-start", name: "Starters", displayOrder: 1 };
  const salads = { id: "co-salad", name: "Salads", displayOrder: 1 };
  const mains = { id: "co-main", name: "Mains", displayOrder: 2 };

  it("orders courseless first, then by course, a tie by first read; its items and taps follow", () => {
    const card = one(
      bill("wo-1", [
        dish("steak", "20:40", { course: mains }),
        dish("soup", "20:40", { course: starters }),
        dish("caesar", "20:40", { course: salads }),
        dish("bread", "20:40"),
        dish("croquetas", "20:40", { course: starters }),
      ]),
    );
    const drawn = ["bread", "soup", "croquetas", "caesar", "steak"];

    expect(card.sections.map((section) => section.course?.id ?? null)).toEqual([
      null,
      "co-start",
      "co-salad",
      "co-main",
    ]);
    expect(card.sections.flatMap((section) => section.items.map((item) => item.id))).toEqual(drawn);
    expect(ids(card)).toEqual(drawn);
    expect(dishesAt(card, "queued")).toEqual(drawn);
  });
});

describe("headingStage and dishesAt", () => {
  it("names the stage a heading tap moves, and the dishes it moves", () => {
    const mixed = one(
      bill("wo-1", [
        dish("waiting", "20:40"),
        held("held", "20:40"),
        dish("started", "20:40", { state: "preparing" }),
        dish("also-waiting", "20:41"),
      ]),
    );
    expect(headingStage(mixed)).toBe("queued");
    expect(dishesAt(mixed, "queued")).toEqual(["waiting", "also-waiting"]);
    expect(dishesAt(mixed, "preparing")).toEqual(["started"]);

    const done = one(
      bill("wo-2", [
        dish("a", "20:40", { state: "ready" }),
        dish("b", "20:40", { state: "ready" }),
      ]),
    );
    expect(headingStage(done)).toBeUndefined();

    const heldAndStarted = one(
      bill("wo-3", [held("h", "20:40"), dish("p", "20:40", { state: "preparing" })]),
    );
    expect(headingStage(heldAndStarted)).toBe("preparing");
  });
});

describe("thousandthsToMake", () => {
  it("counts dishes to make: quantities, a shown unit as one, nothing held or Ready", () => {
    const cards = kitchenCards([
      bill("wo-1", [
        dish("plain", "20:40", { quantity: "2.000" }),
        dish("each", "20:40", {
          quantity: "1.500",
          unitName: { en: "each" },
          soldInEach: true,
          state: "preparing",
        }),
        dish("weighed", "20:40", { quantity: "0.350", unitName: { en: "kg" } }),
        held("held", "20:40", { quantity: "3.000" }),
        dish("ready", "20:40", { quantity: "1.000", state: "ready" }),
      ]),
    ]);

    expect(thousandthsToMake(cards)).toBe(4500);
  });
});

describe("the station's dishes for Overview", () => {
  // Picture 03's scene (plan slice 9c): T2 the oldest, a Ready card, T5, T9, then T4 and T7 held.
  const scene = (): MergedQueueGroup[] => [
    bill("t2", [
      dish("t2-sirloin", "20:40", { name: "Sirloin", state: "preparing" }),
      dish("t2-burger", "20:40", { name: "Burger", state: "preparing" }),
    ]),
    bill("ready", [
      dish("croquettes", "20:48", { name: "Croquettes", quantity: "2.000", state: "ready" }),
    ]),
    bill("t5", [dish("t5-potatoes", "20:52", { name: "Spicy potatoes", quantity: "2.000" })]),
    bill("t9", [
      dish("t9-pork", "20:57", { name: "Pork shoulder" }),
      dish("t9-potatoes", "20:57", { name: "Spicy potatoes" }),
    ]),
    bill("t4", [
      held("t4-pork", "20:45", { name: "Pork shoulder", quantity: "2.000" }),
      held("t4-potatoes", "20:45", { name: "Spicy potatoes" }),
    ]),
    bill("t7", [held("t7-rib", "20:45", { name: "Rib steak" })]),
  ];

  it("the station's dishes for Overview: held, making, and no Ready", () => {
    expect(overviewRows(overviewDishes(kitchenCards(scene())))).toEqual([
      { name: "Sirloin", making: 1000, held: 0 },
      { name: "Burger", making: 1000, held: 0 },
      { name: "Spicy potatoes", making: 3000, held: 1000 },
      { name: "Pork shoulder", making: 1000, held: 2000 },
      { name: "Rib steak", making: 0, held: 1000 },
    ]);
  });

  it("Overview's making counts add up to the dishes to make", () => {
    const cards = kitchenCards([
      ...scene(),
      bill("octopus", [
        dish("weighed", "20:55", { name: "Octopus", quantity: "0.350", unitName: { en: "kg" } }),
      ]),
    ]);
    const making = overviewRows(overviewDishes(cards)).reduce((sum, row) => sum + row.making, 0);

    expect(making).toBe(7000);
    expect(making).toBe(thousandthsToMake(cards));
  });
});

describe("lateCards", () => {
  it("counts late cards with something to make", () => {
    const now = Date.parse(at("21:00"));
    const cards = kitchenCards([
      bill("overdue", [dish("a", "20:48")]),
      bill("forgotten", [dish("b", "20:30", { state: "ready" })]),
      bill("held", [held("c", "20:00")]),
      bill("fresh", [dish("d", "20:58")]),
    ]);

    expect(lateCards(cards, now)).toBe(1);
  });
});

describe("a card's places", () => {
  const party = { id: "party-1", revision: 0 };
  const one = (overrides: Partial<MergedQueueGroup>): KitchenCard =>
    kitchenCards([bill("o1", [dish("a", "20:00")], overrides)])[0]!;

  it("names a bill at a table by the table's short name, never its label", () => {
    expect(cardPlaces(one({ party, label: "Terrace 1", tableShortNames: ["T1"] }))).toEqual(["T1"]);
  });

  it("names a bill at several tables by their short names in number order, joined with +", () => {
    expect(cardPlaces(one({ party, label: null, tableShortNames: ["T10", "T4", "T5"] }))).toEqual([
      "T4+T5+T10",
    ]);
    expect(cardPlaces(one({ party, label: null, tableShortNames: ["B2", "T4"] }))).toEqual([
      "B2+T4",
    ]);
  });

  it("names a bill at no table by its label, or not at all", () => {
    expect(cardPlaces(one({ label: "Ana" }))).toEqual(["Ana"]);
    expect(cardPlaces(one({ label: null }))).toEqual([]);
    expect(cardPlaces(one({ label: "" }))).toEqual([]);
  });

  it("names a place shared by a card's bills once", () => {
    const shared = { id: "g1", position: 1, displayNumber: 1, numberPartyId: "party-1" };
    const [card] = kitchenCards([
      bill("o1", [dish("a", "20:00", { group: { ...shared, state: "fired" } })], {
        party,
        tableShortNames: ["T4"],
      }),
      bill("o2", [dish("b", "20:00", { group: { ...shared, state: "fired" } })], {
        party,
        orderNumber: 13,
        tableShortNames: ["T4"],
      }),
    ]);
    expect(card!.orders).toHaveLength(2);
    expect(cardPlaces(card!)).toEqual(["T4"]);
  });

  it("calls a bill a counter order only with no party and no table", () => {
    expect(isCounterOrder(bill("o1", []))).toBe(true);
    expect(isCounterOrder(bill("o1", [], { label: "Ana" }))).toBe(true);
    expect(isCounterOrder(bill("o1", [], { tableShortNames: ["T4"] }))).toBe(false);
    expect(isCounterOrder(bill("o1", [], { party }))).toBe(false);
  });
});

describe("A803 portion grouping: a card's rows", () => {
  /** A whole portion as the server sends one: a count of one in Each. */
  const portion = (id: string, overrides: Partial<StationQueueItem> = {}): StationQueueItem =>
    dish(id, "20:00", {
      name: "Burger",
      unitName: { "en-GB": "each", "es-ES": "unidad" },
      unitPrecision: 0,
      soldInEach: true,
      ...overrides,
    });
  const answerFor = (list: string, label: string) => ({
    listName: { "en-GB": list },
    listCustomerName: null,
    listKitchenName: null,
    labelName: { "en-GB": label },
    labelCustomerName: null,
    labelKitchenName: null,
  });
  const rows = (card: KitchenCard) =>
    card.sections.map((section) => section.rows.map((row) => row.map((item) => item.id)));

  it("A803 portion grouping: two identical portions show as one row of two", () => {
    const card = one(bill("o-1", [portion("a"), portion("b")]));
    expect(rows(card)).toEqual([[["a", "b"]]]);
    expect(ids(card)).toEqual(["a", "b"]);
  });

  it("A803 portion grouping: a group sits where its first portion was read, members in the read's order", () => {
    const card = one(
      bill("o-1", [portion("a"), portion("f", { name: "Fish" }), portion("c"), portion("d")]),
    );
    expect(rows(card)).toEqual([[["a", "c", "d"], ["f"]]]);
  });

  it("A803 portion grouping: extras in another order still group", () => {
    const cheese = { descriptions: { "en-GB": "Cheese" } };
    const bacon = { descriptions: { "en-GB": "Bacon" } };
    const card = one(
      bill("o-1", [
        portion("a", { modifiers: [cheese, bacon] }),
        portion("b", { modifiers: [bacon, cheese] }),
      ]),
    );
    expect(rows(card)).toEqual([[["a", "b"]]]);
  });

  it("A803 portion grouping: answers in another order still group", () => {
    const card = one(
      bill("o-1", [
        portion("a", {
          optionSnapshots: [answerFor("Cooking", "Rare"), answerFor("Side", "Fries")],
        }),
        portion("b", {
          optionSnapshots: [answerFor("Side", "Fries"), answerFor("Cooking", "Rare")],
        }),
      ]),
    );
    expect(rows(card)).toEqual([[["a", "b"]]]);
  });

  const apart: [string, Partial<StationQueueItem>][] = [
    ["another name", { name: "Fish" }],
    ["another extra", { modifiers: [{ descriptions: { "en-GB": "Cheese" } }] }],
    ["another answer", { optionSnapshots: [answerFor("Cooking", "Rare")] }],
    ["another note", { note: "no salt" }],
    ["another state", { state: "preparing" }],
    ["held", { firedAt: null }],
    ["an allergy block", { allergy: allergyBlock }],
    [
      "another own allergen profile",
      { asServed: { allergens: { gluten: { kinds: ["wheat"] } }, pending: false } },
    ],
    ["another diet", { asServedDiet: { vegan: "yes", vegetarian: "yes", contains: [] } }],
    ["a cross reference", { crossRefs: [{ kind: "with", name: "Fries", stationName: "Fryer" }] }],
    ["another after-period mark", { afterPeriod: "starters" }],
    [
      "a last move",
      {
        lastMove: {
          fromStationName: "Bar",
          personName: null,
          deviceName: null,
          movedAt: at("19:59"),
        },
      },
    ],
  ];

  it.each(apart)("A803 portion grouping: a portion with %s shows apart", (_, overrides) => {
    const card = one(bill("o-1", [portion("a"), portion("b", overrides)]));
    expect(rows(card).flat()).toEqual([["a"], ["b"]]);
  });

  it("A803 portion grouping: another course shows apart, in its own section", () => {
    const course = { id: "c-1", name: "Mains", displayOrder: 2 };
    const card = one(bill("o-1", [portion("a"), portion("b", { course })]));
    expect(rows(card)).toEqual([[["a"]], [["b"]]]);
  });

  const measured: [string, Partial<StationQueueItem>][] = [
    ["a measure", { quantity: "200.000", unitName: { "en-GB": "ml" }, soldInEach: false }],
    [
      "a weight of one",
      { quantity: "1.000", unitPrecision: 3, unitName: { "en-GB": "kg" }, soldInEach: false },
    ],
    ["a shown unit of one", { unitName: { "en-GB": "ración" }, soldInEach: false }],
    ["two in one line", { quantity: "2.000" }],
    ["no known precision", { unitPrecision: null }],
    [
      "an extra made here for a dish elsewhere",
      { crossRefs: [{ kind: "for", name: "Burger", stationName: "Grill" }] },
    ],
  ];

  it.each(measured)("A803 portion grouping: %s never groups", (_, overrides) => {
    const card = one(bill("o-1", [portion("a", overrides), portion("b", overrides)]));
    expect(rows(card).flat()).toEqual([["a"], ["b"]]);
  });

  it("A803 portion grouping: portions of two bills on one card show apart", () => {
    const group = sentGroup("g-1", 1);
    const [card] = kitchenCards([
      bill("o-1", [portion("a", { group })], { party }),
      bill("o-2", [portion("b", { group })], { party }),
    ]);
    expect(rows(card!).flat()).toEqual([["a"], ["b"]]);
  });

  it("A803 portion grouping: Overview counts and the dishes to make are unchanged", () => {
    const card = one(bill("o-1", [portion("a"), portion("b"), portion("c", { firedAt: null })]));
    expect(overviewRows(overviewDishes([card]))).toEqual([
      { name: "Burger", making: 2000, held: 1000 },
    ]);
    expect(thousandthsToMake([card])).toBe(2000);
    expect(dishesAt(card, "queued")).toEqual(["a", "b"]);
  });
});
