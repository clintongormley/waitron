import { describe, expect, it } from "vitest";
import { MONEY_SCALE, addDecimal, toScale } from "@waitron/shared";
import type { BillBalance, TabLine } from "../api/client.js";
import { tabLineGross } from "./adjust-target.js";
import { paidQuantities } from "./bill-payment.js";
import { tabLinePortionKey } from "./portion-groups.js";
import {
  pickRows,
  pickedAmount,
  pickedCount,
  pickedLineIds,
  setCount,
  tidyPicks,
  toggleRow,
  type PickRow,
  type Picks,
} from "./portion-selection.js";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Caña",
    productId: "cana",
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "5.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: "offer-cana",
    portion: true,
    ...over,
  };
}

function dish(id: string, lineNo: number, name: string, price: string): TabLine {
  return line(id, lineNo, { name, productId: name, menuItemId: name, unitPriceGross: price });
}

function balance(
  total: string,
  received: string,
  paidLines: BillBalance["paidLines"] = [],
  reserved = "0.00",
): BillBalance {
  return {
    workingOrderId: "bill-1",
    status: "open",
    total,
    received,
    reserved,
    outstanding: "0.00",
    tips: "0.00",
    payments: [],
    paidLines,
  };
}

/** The screen's key: identical whole portions share a row, and a paid mark parts them. */
function keyFor(lines: readonly TabLine[], paid: BillBalance | null) {
  return (row: TabLine) =>
    tabLinePortionKey(
      row,
      lines,
      paid === null ? null : (paidQuantities(paid).get(row.lineNo) ?? null),
    );
}

function rowsOf(
  lines: readonly TabLine[],
  paid: BillBalance | null = null,
  picks: Picks = new Set(),
  recalled: ReadonlySet<string> = new Set(),
): PickRow[] {
  return pickRows(lines, keyFor(lines, paid), paid, recalled, picks);
}

const ids = (row: PickRow) => row.members.map((member) => member.id);
const sorted = (picks: Picks) => [...picks].sort();

const fourCañas = () => [line("c3", 3), line("c1", 1), line("c4", 4), line("c2", 2)];

describe("A803 selection:", () => {
  it("4 identical Cañas form one counted row; ticking it picks all four; count 2 then picks the first two line ids", () => {
    const [row] = rowsOf(fourCañas());

    expect(rowsOf(fourCañas())).toHaveLength(1);
    expect(row!.counted).toBe(true);
    expect(ids(row!)).toEqual(["c1", "c2", "c3", "c4"]);
    const all = toggleRow(row!, new Set());
    expect(sorted(all)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(pickedCount(row!, all)).toBe(4);
    expect(sorted(setCount(row!, 2, all))).toEqual(["c1", "c2"]);
  });

  it("toggling a ticked grouped row clears it, and so does toggling a partly picked one", () => {
    const [row] = rowsOf(fourCañas());

    expect(toggleRow(row!, toggleRow(row!, new Set())).size).toBe(0);
    expect(toggleRow(row!, setCount(row!, 2, new Set())).size).toBe(0);
  });

  it("€52.00 with €40.00 received and 4 × €5.00 Caña: ticking the row picks the first two (€10.00 leaves €42.00; a third would leave €37.00) and the row is then blocked floor, so + cannot add a third", () => {
    const lines = [
      dish("p", 1, "Paella", "32.00"),
      ...fourCañas().map((c) => ({ ...c, lineNo: c.lineNo + 1 })),
    ];
    const paid = balance("52.00", "40.00");
    const caña = rowsOf(lines, paid).find((row) => row.members[0]!.name === "Caña")!;

    expect(caña.blocked).toBeNull();
    const picks = toggleRow(caña, new Set());
    expect(sorted(picks)).toEqual(["c1", "c2"]);
    const after = rowsOf(lines, paid, picks).find((row) => row.members[0]!.name === "Caña")!;
    expect(after.blocked).toEqual({ reason: "floor", kept: "40.00" });
    expect(sorted(setCount(after, 3, picks))).toEqual(["c1", "c2"]);
    expect(pickedAmount(rowsOf(lines, paid, picks), picks)).toBe("10.00");
  });

  it("the kept money is what was received plus what is reserved", () => {
    const lines = [
      dish("p", 1, "Paella", "32.00"),
      ...fourCañas().map((c) => ({ ...c, lineNo: c.lineNo + 1 })),
    ];
    const paid = balance("52.00", "35.00", [], "5.00");
    const caña = rowsOf(lines, paid).find((row) => row.members[0]!.name === "Caña")!;

    const picks = toggleRow(caña, new Set());
    expect(sorted(picks)).toEqual(["c1", "c2"]);
    expect(rowsOf(lines, paid, picks)[1]!.blocked).toEqual({ reason: "floor", kept: "40.00" });
  });

  it("a weighed line is its own row, not counted", () => {
    const weighed = (id: string, lineNo: number) =>
      line(id, lineNo, {
        unitPrecision: 3,
        quantity: "0.320",
        portion: false,
        unitPriceGross: "20.00",
      });
    const rows = rowsOf([weighed("w1", 1), weighed("w2", 2)]);

    expect(rows.map(ids)).toEqual([["w1"], ["w2"]]);
    expect(rows.map((row) => row.counted)).toEqual([false, false]);
    expect(rows[0]!.each).toBe("6.40");
  });

  it("an unbound line of 3 is its own row, not counted, and moves whole", () => {
    const three = line("u", 1, { quantity: "3.000", portion: false });
    const [row, ...rest] = rowsOf([three, line("c2", 2)]);

    expect(ids(row!)).toEqual(["u"]);
    expect(rest.map(ids)).toEqual([["c2"]]);
    expect(row!.counted).toBe(false);
    expect(row!.each).toBe("15.00");
    const picks = toggleRow(row!, new Set());
    expect(pickedLineIds([row!], picks)).toEqual(["u"]);
    expect(pickedAmount([row!], picks)).toBe("15.00");
  });

  it("a paid Croqueta's row is blocked paid; its unpaid twins form their own row", () => {
    const croquetas = [1, 2, 3].map((n) => dish(`k${n}`, n, "Croqueta", "3.00"));
    const paid = balance("9.00", "3.00", [{ lineId: "k1", lineNo: 1, paidQuantity: "1.000" }]);
    const rows = rowsOf(croquetas, paid);

    expect(rows.map(ids)).toEqual([["k1"], ["k2", "k3"]]);
    expect(rows[0]!.blocked).toEqual({ reason: "paid" });
    expect(rows[1]!.blocked).toBeNull();
    expect(toggleRow(rows[0]!, new Set()).size).toBe(0);
    expect(setCount(rows[0]!, 1, new Set()).size).toBe(0);
  });

  it("€52.00 with €40.00 received: a €12.00 row is pickable, and once picked, a €0.01 row is blocked floor with kept 40.00", () => {
    const lines = [
      dish("a", 1, "Arroz", "12.00"),
      dish("b", 2, "Pan", "0.01"),
      dish("c", 3, "Chuletón", "39.99"),
    ];
    const paid = balance("52.00", "40.00");
    const before = rowsOf(lines, paid);

    expect(before.map((row) => row.blocked)).toEqual([
      null,
      null,
      { reason: "floor", kept: "40.00" },
    ]);
    const picks = toggleRow(before[0]!, new Set());
    expect(sorted(picks)).toEqual(["a"]);
    expect(rowsOf(lines, paid, picks)[1]!.blocked).toEqual({ reason: "floor", kept: "40.00" });
    expect(toggleRow(rowsOf(lines, paid, picks)[1]!, picks)).toEqual(picks);
  });

  it("a contribution marks no dish paid", () => {
    const rows = rowsOf(fourCañas(), balance("20.00", "10.00"));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.blocked).toBeNull();
    expect(sorted(toggleRow(rows[0]!, new Set()))).toEqual(["c1", "c2"]);
  });

  it("with no balance read, nothing is blocked", () => {
    const rows = rowsOf([dish("c", 1, "Chuletón", "39.99")]);

    expect(rows[0]!.blocked).toBeNull();
    expect(sorted(toggleRow(rows[0]!, new Set()))).toEqual(["c"]);
  });

  it("a Caña recalled into a draft is in no row: of 4 Cañas with the first recalled, the row reads 3 and count 2 picks the second and third", () => {
    const [row, ...rest] = rowsOf(fourCañas(), null, new Set(), new Set(["c1"]));

    expect(rest).toEqual([]);
    expect(ids(row!)).toEqual(["c2", "c3", "c4"]);
    expect(sorted(setCount(row!, 2, new Set()))).toEqual(["c2", "c3"]);
  });

  it("an extra is in no row of its own, and its dish's row takes its price", () => {
    const burger = dish("b", 1, "Burger", "10.00");
    const cheese = line("x", 2, {
      name: "Cheese",
      productId: "cheese",
      parentLineNo: 1,
      unitPriceGross: "0.55",
      portion: false,
    });
    const rows = rowsOf([burger, cheese]);

    expect(rows.map(ids)).toEqual([["b"]]);
    expect(rows[0]!.each).toBe(
      toScale(addDecimal(tabLineGross(burger), tabLineGross(cheese)), MONEY_SCALE),
    );
    expect(rows[0]!.each).toBe("10.55");
  });

  it("tidyPicks after a re-read in which one picked member was paid elsewhere keeps the row's first unpaid members, as many as were picked", () => {
    const lines = fourCañas();
    const before = rowsOf(lines);
    const picks = setCount(before[0]!, 2, new Set());
    const paid = balance("20.00", "5.00", [{ lineId: "c1", lineNo: 1, paidQuantity: "1.000" }]);

    const tidied = tidyPicks(before, rowsOf(lines, paid, picks), picks);

    expect(sorted(tidied)).toEqual(["c2", "c3"]);
  });

  it("tidyPicks after a re-read in which a picked member was recalled drops it and keeps the row's count from its first remaining members", () => {
    const lines = fourCañas();
    const before = rowsOf(lines);
    const picks = setCount(before[0]!, 2, new Set());

    const tidied = tidyPicks(before, rowsOf(lines, null, picks, new Set(["c1"])), picks);

    expect(sorted(tidied)).toEqual(["c2", "c3"]);
  });

  it("tidyPicks does not count a picked dish now paid against the room the floor leaves", () => {
    const lines = fourCañas();
    const before = rowsOf(lines);
    const picks = setCount(before[0]!, 2, new Set());
    const paid = balance("20.00", "10.00", [{ lineId: "c1", lineNo: 1, paidQuantity: "1.000" }]);

    const tidied = tidyPicks(before, rowsOf(lines, paid, picks), picks);

    expect(sorted(tidied)).toEqual(["c2", "c3"]);
  });

  it("tidyPicks never keeps more than the re-read floor allows", () => {
    const lines = fourCañas();
    const before = rowsOf(lines);
    const picks = toggleRow(before[0]!, new Set());

    const tidied = tidyPicks(before, rowsOf(lines, balance("20.00", "10.00"), picks), picks);

    expect(sorted(tidied)).toEqual(["c1", "c2"]);
  });

  it("a vanished id is dropped", () => {
    const before = rowsOf([dish("gone", 1, "Flan", "4.00"), line("c2", 2)]);
    const picks = new Set(["gone", "c2", "never-a-row"]);

    expect(sorted(tidyPicks(before, rowsOf([line("c2", 2)]), picks))).toEqual(["c2"]);
  });

  it("pickedLineIds is in line order", () => {
    const lines = [dish("p", 3, "Paella", "32.00"), line("c1", 1), line("c4", 4)];
    const rows = rowsOf(lines);
    let picks: Picks = new Set();
    for (const row of rows) picks = toggleRow(row, picks);

    expect(rows.map(ids)).toEqual([["p"], ["c1", "c4"]]);
    expect(pickedLineIds(rows, picks)).toEqual(["c1", "p", "c4"]);
  });

  it("pickedAmount sums dish and extras exactly", () => {
    const pennies = [1, 2, 3].map((n) => dish(`n${n}`, n, "Nube", "0.05"));
    const pennyRows = rowsOf(pennies);
    const burger = dish("b", 1, "Burger", "10.00");
    const extra = line("x", 2, {
      parentLineNo: 1,
      name: "Bacon",
      productId: "bacon",
      unitPriceGross: "1.10",
      portion: false,
    });
    const burgerRows = rowsOf([burger, extra]);

    expect(pickedAmount(pennyRows, toggleRow(pennyRows[0]!, new Set()))).toBe("0.15");
    expect(pickedAmount(burgerRows, toggleRow(burgerRows[0]!, new Set()))).toBe(
      toScale(addDecimal(tabLineGross(burger), tabLineGross(extra)), MONEY_SCALE),
    );
    expect(pickedAmount(burgerRows, new Set())).toBe("0.00");
  });
});
