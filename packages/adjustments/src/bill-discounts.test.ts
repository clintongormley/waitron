import { describe, expect, it } from "vitest";
import {
  filedRowLine,
  workOutBillDiscounts,
  type BillDiscountLine,
  type BillDiscountTarget,
  type PendingBillDiscount,
  type WorkedBillDiscount,
} from "./bill-discounts.js";

function total(unit: number, quantity: number, priceQuantity: number): number {
  const product = unit * quantity;
  const whole = Math.floor(product / priceQuantity);
  return (product - whole * priceQuantity) * 2 >= priceQuantity ? whole + 1 : whole;
}

function line(
  id: string,
  lineNo: number,
  unit: number,
  more: Partial<BillDiscountLine> = {},
): BillDiscountLine {
  const quantity = more.quantity ?? 1000;
  const priceQuantity = more.priceQuantity ?? 1000;
  return {
    id,
    lineNo,
    parentLineId: null,
    setMenuRole: null,
    setMenuLineId: null,
    unitPrecision: 0,
    portion: null,
    ...more,
    quantity,
    priceQuantity,
    unit,
    lineTotal: total(unit, quantity, priceQuantity),
  };
}

const extra = (id: string, lineNo: number, parent: string, unit: number) =>
  line(id, lineNo, unit, { parentLineId: parent });

const bill: BillDiscountTarget = { kind: "bill" };
const on = (lineId: string): BillDiscountTarget => ({ kind: "line", lineId });
const setMenu = (lineId: string | null): BillDiscountTarget => ({ kind: "set_menu", lineId });

function percent(
  id: string,
  target: BillDiscountTarget,
  percentBp: number,
  position: number,
): PendingBillDiscount {
  return {
    id,
    target,
    action: "discount_percent",
    percentBp,
    amount: null,
    origin: "given",
    position,
  };
}

function amount(
  id: string,
  target: BillDiscountTarget,
  cents: number,
  position: number,
  origin: PendingBillDiscount["origin"] = "given",
): PendingBillDiscount {
  return {
    id,
    target,
    action: "discount_amount",
    percentBp: null,
    amount: cents,
    origin,
    position,
  };
}

function free(id: string, target: BillDiscountTarget, position: number): PendingBillDiscount {
  return { id, target, action: "comp", percentBp: null, amount: null, origin: "given", position };
}

function worked(result: { discounts: WorkedBillDiscount[] }, id: string): WorkedBillDiscount {
  const found = result.discounts.find((discount) => discount.id === id);
  if (found === undefined) throw new Error(`no discount ${id}`);
  return found;
}

/** Each changed line's rows as `quantity@unit` in thousandths and cents. */
function rowsOf(discount: WorkedBillDiscount): Record<string, string[]> {
  return Object.fromEntries(
    discount.lines.map(({ lineId, rows }) => [
      lineId,
      rows.map(({ quantity, unit }) => `${quantity}@${unit}`),
    ]),
  );
}

describe("workOutBillDiscounts: spec 7.3's worked examples", () => {
  it("shares 10.00 off a 50.00 bill by price, and each bill after Pay for items by its own", () => {
    const whole = workOutBillDiscounts(
      [line("a", 1, 1000), line("b", 2, 500), line("rest", 3, 3500)],
      [amount("ten", bill, 1000, 1)],
    );
    expect(whole.takes).toBe(1000);
    expect(worked(whole, "ten")).toMatchObject({ holds: "yes", takes: 1000 });
    expect(rowsOf(worked(whole, "ten"))).toEqual({
      a: ["1000@800"],
      b: ["1000@400"],
      rest: ["1000@2800"],
    });

    const paid = workOutBillDiscounts(
      [line("a", 1, 1000), line("b", 2, 500)],
      [amount("three", bill, 300, 1)],
    );
    expect(paid.takes).toBe(300);
    expect(rowsOf(worked(paid, "three"))).toEqual({ a: ["1000@800"], b: ["1000@400"] });

    const left = workOutBillDiscounts([line("rest", 3, 3500)], [amount("seven", bill, 700, 1)]);
    expect(left.takes).toBe(700);
    expect(rowsOf(worked(left, "seven"))).toEqual({ rest: ["1000@2800"] });
  });

  const daily = (soup: boolean) => [
    line("daily", 1, 1400, { setMenuRole: "set_menu" }),
    ...(soup ? [line("soup", 2, 0, { setMenuRole: "dish", setMenuLineId: "daily" })] : []),
    line("hake", 3, 0, { setMenuRole: "dish", setMenuLineId: "daily" }),
    line("wine", 4, 800),
  ];

  it("shares 5.00 off the Daily bill as 3.18 and 1.82, before and after the Soup is cancelled", () => {
    for (const soup of [true, false]) {
      const result = workOutBillDiscounts(daily(soup), [amount("five", bill, 500, 1)]);
      expect(result.takes).toBe(500);
      expect(rowsOf(worked(result, "five"))).toEqual({
        daily: ["1000@1082"],
        wine: ["1000@618"],
      });
    }
  });

  it("works out each bill of Pay for the Hake alone at 11.50", () => {
    const hake = workOutBillDiscounts(
      [
        line("daily", 1, 1400, { setMenuRole: "set_menu" }),
        line("hake", 2, 0, { setMenuRole: "dish", setMenuLineId: "daily" }),
      ],
      [amount("share", bill, 250, 1)],
    );
    expect(rowsOf(worked(hake, "share"))).toEqual({ daily: ["1000@1150"] });
    const left = workOutBillDiscounts(
      [line("soup", 1, 600), line("wine", 2, 800)],
      [amount("share", bill, 250, 1)],
    );
    expect(left.takes).toBe(250);
    expect(rowsOf(worked(left, "share"))).toEqual({ soup: ["1000@493"], wine: ["1000@657"] });
  });

  it("takes 10% off the burger and its chips as 1.40, and 1.55 once onion rings are added", () => {
    const burger = [line("burger", 1, 1200), extra("chips", 2, "burger", 200)];
    const ten = workOutBillDiscounts(burger, [percent("ten", on("burger"), 1000, 1)]);
    expect(ten.takes).toBe(140);
    expect(rowsOf(worked(ten, "ten"))).toEqual({ burger: ["1000@1080"], chips: ["1000@180"] });

    const rings = workOutBillDiscounts(
      [...burger, extra("rings", 3, "burger", 150)],
      [percent("ten", on("burger"), 1000, 1)],
    );
    expect(rings.takes).toBe(155);
    expect(rowsOf(worked(rings, "ten"))).toEqual({
      burger: ["1000@1080"],
      chips: ["1000@180"],
      rings: ["1000@135"],
    });
  });

  it("shares 2.00 off the burger as 1.71 and 0.29", () => {
    const result = workOutBillDiscounts(
      [line("burger", 1, 1200), extra("chips", 2, "burger", 200)],
      [amount("two", on("burger"), 200, 1)],
    );
    expect(result.takes).toBe(200);
    expect(rowsOf(worked(result, "two"))).toEqual({ burger: ["1000@1029"], chips: ["1000@171"] });
  });
});

describe("workOutBillDiscounts: the order discounts are worked out in", () => {
  it("takes the bill's 10% from the bill as the dish's 10% left it, whatever the positions", () => {
    const result = workOutBillDiscounts(
      [line("steak", 1, 1000), line("salad", 2, 500)],
      [percent("whole", bill, 1000, 1), percent("dish", on("steak"), 1000, 2)],
    );
    expect(result.discounts.map(({ id }) => id)).toEqual(["dish", "whole"]);
    expect(worked(result, "dish").takes).toBe(100);
    expect(worked(result, "whole").takes).toBe(140);
    expect(result.takes).toBe(240);
  });

  it("works Free out before a percentage on the same dish", () => {
    const result = workOutBillDiscounts(
      [line("steak", 1, 1000)],
      [percent("ten", on("steak"), 1000, 1), free("free", on("steak"), 2)],
    );
    expect(result.discounts.map(({ id }) => id)).toEqual(["free", "ten"]);
    expect(worked(result, "free").takes).toBe(1000);
    expect(rowsOf(worked(result, "free"))).toEqual({ steak: ["1000@0"] });
    expect(worked(result, "ten")).toMatchObject({ holds: "yes", takes: 0, lines: [] });
  });

  it("works two discounts on one dish out in the order they were given", () => {
    const result = workOutBillDiscounts(
      [line("steak", 1, 1000)],
      [amount("two", on("steak"), 200, 2), percent("ten", on("steak"), 1000, 1)],
    );
    expect(worked(result, "ten").takes).toBe(100);
    expect(worked(result, "two").takes).toBe(200);
    expect(result.takes).toBe(300);
  });

  it("works an extra's own discount out before its dish's", () => {
    const result = workOutBillDiscounts(
      [line("burger", 1, 1000), extra("chips", 2, "burger", 200)],
      [percent("dish", on("burger"), 5000, 1), free("chips", on("chips"), 2)],
    );
    expect(result.discounts.map(({ id }) => id)).toEqual(["chips", "dish"]);
    expect(worked(result, "chips").takes).toBe(200);
    expect(worked(result, "dish").takes).toBe(500);
  });

  it("works a set menu's discount out after the dishes' and before the bill's", () => {
    const result = workOutBillDiscounts(
      [
        line("daily", 1, 1400, { setMenuRole: "set_menu" }),
        line("soup", 2, 0, { setMenuRole: "dish", setMenuLineId: "daily" }),
        line("wine", 3, 800),
      ],
      [
        percent("whole", bill, 1000, 1),
        percent("menu", setMenu("daily"), 5000, 2),
        percent("wine", on("wine"), 5000, 3),
      ],
    );
    expect(result.discounts.map(({ id }) => id)).toEqual(["wine", "menu", "whole"]);
    expect(worked(result, "menu").takes).toBe(700);
    expect(worked(result, "whole").takes).toBe(110);
  });
});

describe("workOutBillDiscounts: what a set-menu discount covers", () => {
  const lines = () => [
    line("daily", 1, 1400, { setMenuRole: "set_menu" }),
    line("soup", 2, 200, { setMenuRole: "dish", setMenuLineId: "daily" }),
    extra("bread", 3, "soup", 100),
    line("hake", 4, 0, { setMenuRole: "dish", setMenuLineId: "daily" }),
  ];

  it("covers the row and its charged dishes, not their paid extras", () => {
    const result = workOutBillDiscounts(lines(), [percent("ten", setMenu("daily"), 1000, 1)]);
    expect(worked(result, "ten")).toMatchObject({ holds: "yes", takes: 160 });
    expect(rowsOf(worked(result, "ten"))).toEqual({ daily: ["1000@1260"], soup: ["1000@180"] });
  });

  it("covers the same lines when given as Free", () => {
    const result = workOutBillDiscounts(lines(), [free("free", setMenu("daily"), 1)]);
    expect(worked(result, "free").takes).toBe(1600);
    expect(rowsOf(worked(result, "free"))).toEqual({ daily: ["1000@0"], soup: ["1000@0"] });
  });

  it("takes nothing once its row is gone, and says so", () => {
    for (const target of [setMenu(null), setMenu("gone")]) {
      const result = workOutBillDiscounts(lines(), [percent("ten", target, 1000, 1)]);
      expect(worked(result, "ten")).toEqual({
        id: "ten",
        holds: "set_menu_gone",
        takes: 0,
        lines: [],
      });
      expect(result.takes).toBe(0);
    }
  });

  it("cuts an amount larger than its target down to what the target costs", () => {
    const result = workOutBillDiscounts(lines(), [amount("big", setMenu("daily"), 2000, 1)]);
    expect(worked(result, "big")).toMatchObject({ holds: "cut_down", takes: 1600 });
    expect(rowsOf(worked(result, "big"))).toEqual({ daily: ["1000@0"], soup: ["1000@0"] });
  });

  it("cuts a dish's amount down to the dish and its extras", () => {
    const result = workOutBillDiscounts(
      [line("burger", 1, 1000, { unitPrecision: null }), extra("chips", 2, "burger", 200)],
      [amount("big", on("burger"), 1500, 1)],
    );
    expect(worked(result, "big")).toMatchObject({ holds: "cut_down", takes: 1200 });
    expect(rowsOf(worked(result, "big"))).toEqual({ burger: ["1000@0"], chips: ["1000@0"] });
  });

  it("cuts a bill's amount down to the bill", () => {
    const result = workOutBillDiscounts(
      [line("wine", 1, 800, { unitPrecision: null })],
      [amount("big", bill, 1000, 1)],
    );
    expect(worked(result, "big")).toMatchObject({ holds: "cut_down", takes: 800 });
  });
});

describe("workOutBillDiscounts: weighed lines and shares of a bill", () => {
  it("reports what a weighed line takes, not what was asked", () => {
    // 2 kg at 3.00/kg: every whole-cent price gives an even total, so 0.03 off cannot be met.
    const result = workOutBillDiscounts(
      [line("ham", 1, 300, { quantity: 2000, unitPrecision: 3 })],
      [amount("three", bill, 3, 1)],
    );
    expect(worked(result, "three")).toMatchObject({ holds: "yes", takes: 2 });
    expect(result.takes).toBe(2);
    expect(rowsOf(worked(result, "three"))).toEqual({ ham: ["2000@299"] });
  });

  it("lets an extra take the cent its weighed dish cannot", () => {
    const result = workOutBillDiscounts(
      [line("ham", 1, 300, { quantity: 2000, unitPrecision: 3 }), extra("bread", 2, "ham", 100)],
      [amount("three", on("ham"), 3, 1)],
    );
    expect(worked(result, "three")).toMatchObject({ holds: "yes", takes: 3 });
    expect(rowsOf(worked(result, "three"))).toEqual({ ham: ["2000@299"], bread: ["1000@99"] });
  });

  it("works a bill_share amount out with the dishes, on its own line only", () => {
    const result = workOutBillDiscounts(
      [line("burger", 1, 1000), extra("chips", 2, "burger", 200), line("wine", 3, 500)],
      [
        percent("whole", bill, 1000, 0),
        percent("dish", on("burger"), 1000, 1),
        amount("share", on("chips"), 100, 2, "bill_share"),
        amount("wineShare", on("wine"), 100, 3, "bill_share"),
      ],
    );
    expect(result.discounts.map(({ id }) => id)).toEqual(["dish", "share", "wineShare", "whole"]);
    expect(worked(result, "dish").takes).toBe(120);
    expect(rowsOf(worked(result, "share"))).toEqual({ chips: ["1000@80"] });
    // 10% of 9.00 + 0.80 + 4.00.
    expect(worked(result, "whole").takes).toBe(138);
  });

  it("keeps a bill_share amount on a dish off its extras", () => {
    const result = workOutBillDiscounts(
      [line("burger", 1, 1000), extra("chips", 2, "burger", 200)],
      [amount("share", on("burger"), 100, 1, "bill_share")],
    );
    expect(rowsOf(worked(result, "share"))).toEqual({ burger: ["1000@900"] });
  });
});

describe("workOutBillDiscounts: a line an earlier discount split", () => {
  const beers = () => [line("beer", 1, 1003, { quantity: 3000 }), line("wine", 2, 800)];

  it("numbers the part at the lower price after the bill's last line", () => {
    const result = workOutBillDiscounts(beers(), [amount("cent", on("beer"), 1, 1)]);
    expect(worked(result, "cent").lines).toEqual([
      {
        lineId: "beer",
        rows: [
          { id: "beer", lineNo: 1, quantity: 2000, unit: 1003, total: 2006 },
          { id: "beer#3", lineNo: 3, quantity: 1000, unit: 1002, total: 1002 },
        ],
      },
    ]);
  });

  it("works a later percentage out once on each part", () => {
    const result = workOutBillDiscounts(beers(), [
      amount("cent", on("beer"), 1, 1),
      percent("quarter", on("beer"), 2500, 2),
    ]);
    // 25% of 20.06 is 5.02 and of 10.02 is 2.51; of the whole 30.08 it would be 7.52.
    expect(worked(result, "quarter").takes).toBe(753);
    expect(rowsOf(worked(result, "quarter"))).toEqual({ beer: ["2000@752", "1000@751"] });
  });

  it("shares a later amount by quantity, the cent left over to the earlier part", () => {
    const result = workOutBillDiscounts(beers(), [
      amount("cent", on("beer"), 1, 1),
      amount("two", on("beer"), 2, 2),
    ]);
    expect(worked(result, "two").takes).toBe(2);
    expect(rowsOf(worked(result, "two"))).toEqual({ beer: ["2000@1002", "1000@1002"] });
  });

  it("numbers a second split after the first", () => {
    const result = workOutBillDiscounts(beers(), [
      amount("cent", on("beer"), 1, 1),
      amount("four", on("beer"), 4, 2),
    ]);
    // By quantity 0.03 and 0.01: 20.03 over two beers splits again.
    expect(worked(result, "four").takes).toBe(4);
    expect(worked(result, "four").lines).toEqual([
      {
        lineId: "beer",
        rows: [
          { id: "beer", lineNo: 1, quantity: 1000, unit: 1002, total: 1002 },
          { id: "beer#3", lineNo: 3, quantity: 1000, unit: 1001, total: 1001 },
          { id: "beer#4", lineNo: 4, quantity: 1000, unit: 1001, total: 1001 },
        ],
      },
    ]);
  });

  it("lets the bill's discount cover every part", () => {
    const result = workOutBillDiscounts(beers(), [
      amount("cent", on("beer"), 1, 1),
      percent("whole", bill, 1000, 2),
    ]);
    // 10% of 20.06 + 10.02 + 8.00.
    expect(worked(result, "whole").takes).toBe(381);
    expect(result.takes).toBe(382);
  });
});

describe("workOutBillDiscounts: bound portions", () => {
  const portion = (id: string, lineNo: number, ordinal: number) =>
    line(id, lineNo, 1000, { portion: { group: "croquettes", ordinal } });

  it("spreads a bill's discount over bound portions as the one row they are filed as", () => {
    const result = workOutBillDiscounts(
      [portion("p1", 1, 0), portion("p2", 2, 1), portion("p3", 3, 2), line("wine", 4, 1000)],
      [amount("three", bill, 3, 1)],
    );
    // As one row of 30.00 they take 0.02 and the wine 0.01; line by line, a portion each.
    expect(result.takes).toBe(3);
    expect(rowsOf(worked(result, "three"))).toEqual({
      p2: ["1000@999"],
      p3: ["1000@999"],
      wine: ["1000@999"],
    });
  });

  it("hands a filed row's two prices to its portions by ordinal, the higher price first", () => {
    const result = workOutBillDiscounts(
      [portion("p1", 1, 0), portion("p2", 2, 2), portion("p3", 3, 1)],
      [amount("one", bill, 1, 1)],
    );
    expect(rowsOf(worked(result, "one"))).toEqual({ p2: ["1000@999"] });
  });

  it("files bound portions' extras in their dishes' order, whatever their own line numbers", () => {
    const sauce = (id: string, lineNo: number, parent: string) =>
      line(id, lineNo, 1000, { parentLineId: parent, portion: { group: "sauce", ordinal: 0 } });
    const result = workOutBillDiscounts(
      [
        line("d1", 1, 0, { portion: { group: "croquettes", ordinal: 1 } }),
        line("d2", 2, 0, { portion: { group: "croquettes", ordinal: 2 } }),
        sauce("e2", 3, "d2"),
        sauce("e1", 4, "d1"),
      ],
      [amount("one", bill, 1, 1)],
    );
    // The sauces' filed row is d1's then d2's, so d1's keeps the higher of its two prices.
    expect(rowsOf(worked(result, "one"))).toEqual({ e2: ["1000@999"] });
  });
});

describe("filedRowLine", () => {
  const subject = (id: string, lineNo: number, parentLineId: string | null) => ({
    row: line(id, lineNo, 500, { parentLineId }),
    quantity: 1000,
    exact: false,
    exactWhenShort: false,
  });

  it("makes a row of one-unit dishes exact, at its first member's price and line number", () => {
    expect(filedRowLine([subject("p1", 4, null), subject("p2", 5, null)])).toMatchObject({
      lineId: "p1",
      addedOrder: 4,
      gross: "10.00",
      quantity: "2.000",
      exact: true,
      exactWhenShort: false,
    });
  });

  it("makes a row of one-unit extras exact only when short", () => {
    expect(filedRowLine([subject("e1", 2, "d"), subject("e2", 3, "d")])).toMatchObject({
      exact: false,
      exactWhenShort: true,
    });
  });
});

describe("workOutBillDiscounts: refusals of what the caller passed", () => {
  it("refuses a target line that is not on the bill", () => {
    expect(() =>
      workOutBillDiscounts([line("wine", 1, 800)], [percent("ten", on("beer"), 1000, 1)]),
    ).toThrow(RangeError);
  });

  it("refuses a line whose total is not its unit price times its quantity", () => {
    expect(() => workOutBillDiscounts([{ ...line("wine", 1, 800), lineTotal: 799 }], [])).toThrow(
      RangeError,
    );
  });

  it("refuses Free on the whole bill", () => {
    expect(() => workOutBillDiscounts([line("wine", 1, 800)], [free("free", bill, 1)])).toThrow(
      RangeError,
    );
  });

  it("refuses a value that does not match its action", () => {
    for (const discount of [
      { ...percent("p", bill, 1000, 1), percentBp: null },
      { ...amount("a", bill, 100, 1), amount: null },
      { ...amount("a", bill, 100, 1), amount: 0 },
      { ...amount("a", bill, 100, 1), amount: 1.5 },
    ]) {
      expect(() => workOutBillDiscounts([line("wine", 1, 800)], [discount])).toThrow(RangeError);
    }
  });
});
