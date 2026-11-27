import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import {
  spreadOverFiledGroups,
  workOutBillDiscounts,
  type BillDiscountLine,
  type BillDiscountTarget,
  type BillDiscountRow,
  type PendingBillDiscount,
  type WorkedBill,
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

/**
 * What the bill's invoice totals with each line at `rowsNow`: a bound dish files with the others of
 * its group at its price holding the same extras, as one dish row and one row per extra, each
 * quantity summed (`projectPortionSale`); every other row files alone.
 */
function invoiceTotal(
  lines: readonly BillDiscountLine[],
  rowsNow: ReadonlyMap<string, readonly BillDiscountRow[]>,
): number {
  const byId = new Map(lines.map((one) => [one.id, one]));
  const extraRows = (dish: BillDiscountLine) =>
    lines
      .filter(({ parentLineId }) => parentLineId === dish.id)
      .flatMap((one) => rowsNow.get(one.id)!.map((row) => ({ line: one, row })));
  const extraKey = ({ line: one, row }: ReturnType<typeof extraRows>[number]) =>
    JSON.stringify([one.portion?.group ?? one.id, row.unit, one.priceQuantity, row.quantity]);
  const filed = new Map<
    string,
    {
      quantity: number;
      n: number;
      dish: BillDiscountLine;
      unit: number;
      extras: ReturnType<typeof extraRows>;
    }
  >();
  let sum = 0;
  for (const one of lines) {
    const parent = one.parentLineId === null ? null : byId.get(one.parentLineId)!;
    if (parent?.portion != null) continue;
    for (const row of rowsNow.get(one.id)!) {
      if (one.portion === null || parent !== null) {
        sum += row.total;
        continue;
      }
      const extras = extraRows(one);
      const key = JSON.stringify([
        one.portion.group,
        row.unit,
        one.priceQuantity,
        extras.map(extraKey).sort(),
      ]);
      const group = filed.get(key) ?? { quantity: 0, n: 0, dish: one, unit: row.unit, extras };
      group.quantity += row.quantity;
      group.n += 1;
      filed.set(key, group);
    }
  }
  for (const { quantity, n, dish, unit, extras } of filed.values()) {
    sum += total(unit, quantity, dish.priceQuantity);
    for (const { line: one, row } of extras)
      sum += total(row.unit, row.quantity * n, one.priceQuantity);
  }
  return sum;
}

/**
 * Replays each discount's rows over the bill and fails when one raises a row's price, or when
 * what it says it takes differs from what the bill's invoice total actually drops by.
 */
function expectHonest(lines: readonly BillDiscountLine[], result: WorkedBill): void {
  const rowsNow = new Map(
    lines.map(({ id, lineNo, quantity, unit, lineTotal }) => [
      id,
      [{ id, lineNo, quantity, unit, total: lineTotal }] as BillDiscountRow[],
    ]),
  );
  const billTotal = () => invoiceTotal(lines, rowsNow);
  const start = billTotal();
  for (const discount of result.discounts) {
    const before = billTotal();
    for (const { lineId, rows } of discount.lines) {
      const old = new Map(rowsNow.get(lineId)!.map((row) => [row.id, row.unit]));
      const highest = Math.max(...old.values());
      for (const row of rows) expect(row.unit).toBeLessThanOrEqual(old.get(row.id) ?? highest);
      rowsNow.set(lineId, rows);
    }
    expect(discount.takes).toBe(before - billTotal());
  }
  expect(result.takes).toBe(start - billTotal());
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
    line("daily", 1, 1400),
    ...(soup ? [line("soup", 2, 0, { setMenuLineId: "daily" })] : []),
    line("hake", 3, 0, { setMenuLineId: "daily" }),
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
      [line("daily", 1, 1400), line("hake", 2, 0, { setMenuLineId: "daily" })],
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

  it("keeps the order given between Free and a discount on another line", () => {
    const lines = [line("burger", 1, 1000), extra("chips", 2, "burger", 200)];
    const result = workOutBillDiscounts(lines, [
      free("free", on("burger"), 2),
      amount("share", on("chips"), 100, 1, "bill_share"),
    ]);
    expect(result.discounts.map(({ id }) => id)).toEqual(["share", "free"]);
    expect(worked(result, "share")).toMatchObject({ holds: "yes", takes: 100 });
    expect(worked(result, "free").takes).toBe(1100);
    expectHonest(lines, result);
  });

  it("brings Free forward only to its own line's first discount", () => {
    const result = workOutBillDiscounts(
      [line("steak", 1, 1000), line("wine", 2, 800)],
      [
        free("free", on("steak"), 3),
        percent("wine", on("wine"), 1000, 2),
        percent("ten", on("steak"), 1000, 1),
      ],
    );
    expect(result.discounts.map(({ id }) => id)).toEqual(["free", "ten", "wine"]);

    const twice = workOutBillDiscounts(
      [line("steak", 1, 1000)],
      [free("second", on("steak"), 2), free("first", on("steak"), 1)],
    );
    expect(twice.discounts.map(({ id }) => id)).toEqual(["first", "second"]);
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
        line("daily", 1, 1400),
        line("soup", 2, 0, { setMenuLineId: "daily" }),
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
    line("daily", 1, 1400),
    line("soup", 2, 200, { setMenuLineId: "daily" }),
    extra("bread", 3, "soup", 100),
    line("hake", 4, 0, { setMenuLineId: "daily" }),
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

  it("cuts a bill's amount down to nothing on a bill with no lines", () => {
    const result = workOutBillDiscounts([], [amount("one", bill, 100, 1)]);
    expect(result).toEqual({
      discounts: [{ id: "one", holds: "cut_down", takes: 0, lines: [] }],
      takes: 0,
    });
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

  it("makes a line Free at a zero price even when its total was already nothing", () => {
    const result = workOutBillDiscounts(
      [line("salt", 1, 1, { quantity: 100, unitPrecision: 3 })],
      [free("free", on("salt"), 1)],
    );
    expect(worked(result, "free")).toEqual({
      id: "free",
      holds: "yes",
      takes: 0,
      lines: [
        { lineId: "salt", rows: [{ id: "salt", lineNo: 1, quantity: 100, unit: 0, total: 0 }] },
      ],
    });
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

  it("gives the cent a cheaper part cannot take to a part that can", () => {
    // 2.02 off four 1.00 beers leaves two at 0.50 and two at 0.49: 1.98 is all that is left.
    const lines = [line("beer", 1, 100, { quantity: 4000 })];
    const result = workOutBillDiscounts(lines, [
      amount("first", on("beer"), 202, 1),
      amount("rest", on("beer"), 198, 2),
    ]);
    expect(rowsOf(worked(result, "first"))).toEqual({ beer: ["2000@50", "2000@49"] });
    expect(worked(result, "rest")).toMatchObject({ holds: "yes", takes: 198 });
    expect(rowsOf(worked(result, "rest"))).toEqual({ beer: ["2000@0", "2000@0"] });
    expectHonest(lines, result);
  });

  it("takes every part to zero when an amount is larger than what the line costs", () => {
    // 3.98 off four 1.00 beers leaves two at 0.01 and two free.
    const lines = [line("beer", 1, 100, { quantity: 4000 })];
    const result = workOutBillDiscounts(lines, [
      amount("first", on("beer"), 398, 1),
      amount("three", on("beer"), 3, 2),
    ]);
    expect(rowsOf(worked(result, "first"))).toEqual({ beer: ["2000@1", "2000@0"] });
    expect(worked(result, "three")).toMatchObject({ holds: "cut_down", takes: 2 });
    expect(rowsOf(worked(result, "three"))).toEqual({ beer: ["2000@0", "2000@0"] });
    expectHonest(lines, result);
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

  it("files bound portions apart once a dish's own discount leaves them at different prices", () => {
    const pair = () => [portion("p1", 1, 0), portion("p2", 2, 1)];
    const half = workOutBillDiscounts(pair(), [
      percent("half", on("p1"), 5000, 1),
      percent("ten", bill, 1000, 2),
    ]);
    expect(worked(half, "ten").takes).toBe(150);
    expect(rowsOf(worked(half, "ten"))).toEqual({ p1: ["1000@450"], p2: ["1000@900"] });
    expectHonest(pair(), half);

    const freed = workOutBillDiscounts(pair(), [
      free("free", on("p2"), 1),
      amount("one", bill, 100, 2),
    ]);
    expect(worked(freed, "one")).toMatchObject({ holds: "yes", takes: 100 });
    expect(rowsOf(worked(freed, "one"))).toEqual({ p1: ["1000@900"] });
    expectHonest(pair(), freed);

    const five = workOutBillDiscounts(pair(), [
      amount("five", on("p1"), 500, 1),
      percent("ten", bill, 1000, 2),
    ]);
    expect(rowsOf(worked(five, "ten"))).toEqual({ p1: ["1000@450"], p2: ["1000@900"] });
    expectHonest(pair(), five);
  });

  it("files bound portions apart once their extras are at different prices", () => {
    const lines = [
      portion("d1", 1, 0),
      portion("d2", 2, 1),
      line("e1", 3, 100, { parentLineId: "d1", portion: { group: "sauce", ordinal: 0 } }),
      line("e2", 4, 100, { parentLineId: "d2", portion: { group: "sauce", ordinal: 0 } }),
    ];
    const result = workOutBillDiscounts(lines, [
      free("free", on("e1"), 1),
      amount("three", bill, 3, 2),
    ]);
    // As two rows of 10.00 each takes 0.01 and the tie for the third goes to the earlier line;
    // as one row of 20.00 it would take all three, 9.99 and 9.98.
    expect(rowsOf(worked(result, "three"))).toEqual({ d1: ["1000@998"], d2: ["1000@999"] });
    expectHonest(lines, result);
  });

  it("files each extra of bound portions with the matching extra of the other portions", () => {
    const side = (id: string, lineNo: number, parent: string, group: string, unit: number) =>
      line(id, lineNo, unit, { parentLineId: parent, portion: { group, ordinal: 0 } });
    const lines = [
      portion("d1", 1, 0),
      portion("d2", 2, 1),
      side("s1", 3, "d1", "sauce", 100),
      side("b1", 4, "d1", "bread", 50),
      side("b2", 5, "d2", "bread", 50),
      side("s2", 6, "d2", "sauce", 100),
    ];
    const result = workOutBillDiscounts(lines, [percent("ten", bill, 1000, 1)]);
    expect(rowsOf(worked(result, "ten"))).toEqual({
      d1: ["1000@900"],
      d2: ["1000@900"],
      s1: ["1000@90"],
      b1: ["1000@45"],
      b2: ["1000@45"],
      s2: ["1000@90"],
    });
    expectHonest(lines, result);
  });

  it("files every other line of a bill holding bound portions as a row of its own", () => {
    const lines = [
      portion("p1", 1, 0),
      portion("p2", 2, 1),
      line("beer", 3, 1003, { quantity: 3000, unitPrecision: null }),
      line("wine", 4, 800),
      extra("lime", 5, "wine", 50),
    ];
    const result = workOutBillDiscounts(lines, [
      amount("cent", on("beer"), 1, 1),
      amount("hundred", bill, 100, 2),
    ]);
    // Over 20.00, 20.06, 10.02, 8.00 and 0.50: shares 0.34, 0.34, 0.17, 0.14 and 0.01.
    expect(worked(result, "hundred").takes).toBe(100);
    expect(rowsOf(worked(result, "hundred"))).toEqual({
      p1: ["1000@983"],
      p2: ["1000@983"],
      beer: ["2000@986", "1000@985"],
      wine: ["1000@786"],
      lime: ["1000@49"],
    });
    expectHonest(lines, result);
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

  it("takes from a bill holding bound portions what its filed rows lose, and cuts an amount down to them", () => {
    const sauce = (id: string, lineNo: number, parent: string) =>
      line(id, lineNo, 1008, {
        parentLineId: parent,
        quantity: 125,
        unitPrecision: 3,
        portion: { group: "sauce", ordinal: 0 },
      });
    const dish = (id: string, lineNo: number, ordinal: number) =>
      line(id, lineNo, 100, { portion: { group: "croquettes", ordinal } });
    const lines = [dish("d1", 1, 0), dish("d2", 2, 1), sauce("s1", 3, "d1"), sauce("s2", 4, "d2")];
    const result = workOutBillDiscounts(lines, [
      amount("five", bill, 5, 1),
      amount("rest", bill, 448, 2),
    ]);
    // Filed as 2 × 1.00 and 0.250 × 10.08 = 2.52, 4.52: the sauces' row takes 0.03 at 9.97 (2.49),
    // though each sauce alone only drops from 1.26 to 1.25.
    expect(worked(result, "five")).toMatchObject({ holds: "yes", takes: 5 });
    expect(rowsOf(worked(result, "five"))).toEqual({
      d1: ["1000@99"],
      d2: ["1000@99"],
      s1: ["125@997"],
      s2: ["125@997"],
    });
    // 4.47 is left on the invoice, though the lines alone add up to 4.48.
    expect(worked(result, "rest")).toMatchObject({ holds: "cut_down", takes: 447 });
    expect(result.takes).toBe(452);
    expectHonest(lines, result);
  });

  it("moves a bound extra's price where its filed row takes a cent its own total does not lose", () => {
    const sauce = (id: string, lineNo: number, parent: string) =>
      line(id, lineNo, 1003, {
        parentLineId: parent,
        quantity: 125,
        unitPrecision: 3,
        portion: { group: "sauce", ordinal: 0 },
      });
    const dish = (id: string, lineNo: number, ordinal: number) =>
      line(id, lineNo, 0, { portion: { group: "croquettes", ordinal } });
    const lines = [dish("d1", 1, 0), dish("d2", 2, 1), sauce("s1", 3, "d1"), sauce("s2", 4, "d2")];
    const result = workOutBillDiscounts(lines, [amount("one", bill, 1, 1)]);
    // 0.250 at 10.03 files as 2.51 and at 10.01 as 2.50; each sauce is 1.25 at either price.
    expect(worked(result, "one")).toMatchObject({ holds: "yes", takes: 1 });
    expect(rowsOf(worked(result, "one"))).toEqual({ s1: ["125@1001"], s2: ["125@1001"] });
    expectHonest(lines, result);
  });

  // Bound dishes filed apart file their measured extras apart too, each rounded on its own: two
  // 0.125 of a sauce at 10.04 are 1.26 each, filed together 2.51; two 0.333 at 1.01 are 0.34 each,
  // filed together 0.67.
  const measured = (id: string, lineNo: number, unit: number, quantity: number, parent: string) =>
    line(id, lineNo, unit, {
      parentLineId: parent,
      quantity,
      unitPrecision: 3,
      portion: { group: `extra-${unit}-${id.slice(0, 1)}`, ordinal: 0 },
    });
  const boundDish = (id: string, lineNo: number, unit: number, ordinal: number) =>
    line(id, lineNo, unit, { portion: { group: "steak", ordinal } });

  it("holds a bound pair at one price where splitting it would refile its extras higher", () => {
    const lines = [
      boundDish("d1", 1, 1250, 0),
      boundDish("d2", 2, 1250, 1),
      measured("s1", 3, 1004, 125, "d1"),
      measured("o1", 4, 101, 333, "d1"),
      measured("s2", 5, 1004, 125, "d2"),
      measured("o2", 6, 101, 333, "d2"),
      line("wine", 7, 699),
    ];
    const result = workOutBillDiscounts(lines, [amount("one", bill, 1, 1)]);
    expect(worked(result, "one")).toMatchObject({ holds: "yes", takes: 1 });
    expect(rowsOf(worked(result, "one"))).toEqual({ wine: ["1000@698"] });
    expectHonest(lines, result);
  });

  it("leaves a bound dish as it is where its own discount would refile its extras no lower", () => {
    for (const oil of [true, false]) {
      const lines = [
        boundDish("d1", 1, 100, 0),
        boundDish("d2", 2, 100, 1),
        measured("s1", 3, 101, 333, "d1"),
        measured("s2", 4, 101, 333, "d2"),
        ...(oil ? [measured("o1", 5, 101, 333, "d1"), measured("o2", 6, 101, 333, "d2")] : []),
      ];
      // 0.5% of the first dish's 1.00 and its extras is 0.01; at 0.99 it files apart from the
      // second, and its sauce and oil with it: the invoice would rise 0.01, or with no oil stay.
      const result = workOutBillDiscounts(lines, [percent("half", on("d1"), 50, 1)]);
      expect(worked(result, "half")).toEqual({ id: "half", holds: "yes", takes: 0, lines: [] });
      expectHonest(lines, result);
    }
  });

  it("files bound portions together again once a discount brings them to one price", () => {
    const lines = [
      line("p1", 1, 1000, { portion: { group: "croquettes", ordinal: 0 } }),
      line("p2", 2, 500, { portion: { group: "croquettes", ordinal: 1 } }),
      line("wine", 3, 500),
    ];
    const result = workOutBillDiscounts(lines, [
      percent("half", on("p1"), 5000, 1),
      amount("two", bill, 2, 2),
    ]);
    // As one row of 10.00 beside the wine's 5.00 the row takes 0.01 and the wine, by its larger
    // remainder, the other; filed apart the two portions would take one each and the wine none.
    expect(rowsOf(worked(result, "two"))).toEqual({ p2: ["1000@499"], wine: ["1000@499"] });
    expectHonest(lines, result);
  });
});

describe("spreadOverFiledGroups", () => {
  const subject = (id: string, lineNo: number, unit: number, parentLineId: string | null) => ({
    row: line(id, lineNo, unit, { parentLineId }),
    quantity: 1000,
    exact: false,
    exactWhenShort: false,
  });
  type Member = ReturnType<typeof subject>;
  const spread = (groups: Member[][], cents: string) =>
    spreadOverFiledGroups(groups, decimal(cents), ({ row }) => row.lineNo).map(
      ({ rows, shares }) => ({
        rows: rows.map(({ quantity, unitGross }) => `${quantity}@${unitGross}`),
        shares: shares.map(({ row, reduction }) => `${row.id} ${reduction}`),
      }),
    );

  it("spreads one-unit dishes as one exact row, at its first member's price and line number", () => {
    // The tie for the cent goes to the lower line number: the row's 4, not its second portion's 6.
    expect(
      spread(
        [
          [subject("p1", 4, 500, null), subject("p2", 6, 500, null)],
          [subject("wine", 5, 1000, null)],
        ],
        "0.01",
      ),
    ).toEqual([
      { rows: ["1.000@5.00", "1.000@4.99"], shares: ["p1 0.00", "p2 0.01"] },
      { rows: ["1.000@10.00"], shares: ["wine 0.00"] },
    ]);
  });

  it("spreads one-unit extras as one row that is exact only when the bill would fall short", () => {
    const extras = () => [subject("e1", 2, 500, "d"), subject("e2", 3, 500, "d")];
    // 0.02 and 0.01 asked: the extras' row stays at 10.00 and the dish takes the cent it left.
    expect(spread([[subject("dish", 1, 1000, null)], extras()], "0.03")).toEqual([
      { rows: ["1.000@9.97"], shares: ["dish 0.03"] },
      { rows: ["2.000@5.00"], shares: ["e1 0.00", "e2 0.00"] },
    ]);
    expect(spread([extras()], "0.01")).toEqual([
      { rows: ["1.000@5.00", "1.000@4.99"], shares: ["e1 0.00", "e2 0.01"] },
    ]);
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

  it("refuses an extra whose dish is not on the bill", () => {
    expect(() => workOutBillDiscounts([extra("chips", 2, "burger", 200)], [])).toThrow(RangeError);
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
