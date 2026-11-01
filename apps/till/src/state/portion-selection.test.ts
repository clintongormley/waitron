import { describe, expect, it } from "vitest";
import { MONEY_SCALE, addDecimal, toScale } from "@waitron/shared";
import type { BillBalance, TabLine } from "../api/client.js";
import { tabLineGross } from "./adjust-target.js";
import { paidQuantities } from "./bill-payment.js";
import { tabLinePortionKey } from "./portion-groups.js";
import {
  pickGroups,
  pickRows,
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

/** Identical whole portions share a row, and a paid mark parts them. */
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
  return pickRows(pickGroups(lines, keyFor(lines, paid), paid, recalled), picks);
}

/** `tidyPicks` over the rows drawn before and the re-read bill. */
function tidy(
  before: readonly PickRow[],
  lines: readonly TabLine[],
  paid: BillBalance | null,
  picks: Picks,
  recalled: ReadonlySet<string> = new Set(),
): Picks {
  return tidyPicks(before, pickGroups(lines, keyFor(lines, paid), paid, recalled), picks);
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

    const tidied = tidy(before, lines, paid, picks);

    expect(sorted(tidied)).toEqual(["c2", "c3"]);
  });

  it("tidyPicks after a re-read in which a picked member was recalled drops it and keeps the row's count from its first remaining members", () => {
    const lines = fourCañas();
    const before = rowsOf(lines);
    const picks = setCount(before[0]!, 2, new Set());

    const tidied = tidy(before, lines, null, picks, new Set(["c1"]));

    expect(sorted(tidied)).toEqual(["c2", "c3"]);
  });

  it("tidyPicks does not count a picked dish now paid against the room the floor leaves", () => {
    const lines = fourCañas();
    const before = rowsOf(lines);
    const picks = setCount(before[0]!, 2, new Set());
    const paid = balance("20.00", "10.00", [{ lineId: "c1", lineNo: 1, paidQuantity: "1.000" }]);

    const tidied = tidy(before, lines, paid, picks);

    expect(sorted(tidied)).toEqual(["c2", "c3"]);
  });

  it("a pick left on a paid dish does not lower another row's limit: €15.00 with the €5.00 Caña paid and picked leaves room for both Bravas", () => {
    const lines = [
      dish("c1", 1, "Caña", "5.00"),
      dish("b2", 2, "Bravas", "5.00"),
      dish("b3", 3, "Bravas", "5.00"),
    ];
    const paid = balance("15.00", "5.00", [{ lineId: "c1", lineNo: 1, paidQuantity: "1.000" }]);

    const [caña, bravas] = rowsOf(lines, paid, new Set(["c1"]));

    expect(caña!.blocked).toEqual({ reason: "paid" });
    expect(bravas!.limit).toBe(2);
    expect(bravas!.blocked).toBeNull();
  });

  it("tidyPicks keeps a ticked row of four to the two the re-read floor allows", () => {
    const lines = fourCañas();
    const before = rowsOf(lines);
    const picks = toggleRow(before[0]!, new Set());

    const tidied = tidy(before, lines, balance("20.00", "10.00"), picks);

    expect(sorted(tidied)).toEqual(["c1", "c2"]);
  });

  it("a vanished id is dropped", () => {
    const before = rowsOf([dish("gone", 1, "Flan", "4.00"), line("c2", 2)]);
    const picks = new Set(["gone", "c2", "never-a-row"]);

    expect(sorted(tidy(before, [line("c2", 2)], null, picks))).toEqual(["c2"]);
  });

  it("tidyPicks keeps the floor when two rows gain picks in one re-read: €30.00 with €15.00 received, after a1 and b4 are paid elsewhere, keeps a2, a3 and b5, and the Bravas row gives the floor reason", () => {
    const lines = [
      ...[1, 2, 3].map((n) => dish(`a${n}`, n, "Arroz", "5.00")),
      ...[4, 5, 6].map((n) => dish(`b${n}`, n, "Bravas", "5.00")),
    ];
    const before = rowsOf(lines);
    const picks = setCount(before[1]!, 2, setCount(before[0]!, 2, new Set()));
    const paid = balance("30.00", "15.00", [
      { lineId: "a1", lineNo: 1, paidQuantity: "1.000" },
      { lineId: "b4", lineNo: 4, paidQuantity: "1.000" },
    ]);

    const tidied = tidy(before, lines, paid, picks);

    expect(sorted(picks)).toEqual(["a1", "a2", "b4", "b5"]);
    expect(sorted(tidied)).toEqual(["a2", "a3", "b5"]);
    const rows = rowsOf(lines, paid, tidied);
    expect(rows.find((row) => ids(row).includes("b5"))!.blocked).toEqual({
      reason: "floor",
      kept: "15.00",
    });
  });

  it("tidyPicks drops only the picks the re-read floor cannot hold: 2 Arroz and 2 Bravas at €5.00, all picked, then €20.00 with €10.00 received, keeps the two Arroz", () => {
    const lines = [
      dish("a1", 1, "Arroz", "5.00"),
      dish("a2", 2, "Arroz", "5.00"),
      dish("b3", 3, "Bravas", "5.00"),
      dish("b4", 4, "Bravas", "5.00"),
    ];
    const before = rowsOf(lines);
    let picks: Picks = new Set();
    for (const row of before) picks = toggleRow(row, picks);

    expect(sorted(tidy(before, lines, balance("20.00", "10.00"), picks))).toEqual(["a1", "a2"]);
  });

  it("tidyPicks adds the counts of two rows read before that one row now holds: a served k1 and an unserved k2 picked, then all three served, keeps k1 and k2", () => {
    const served = { servedAt: "2026-11-01T12:00:00Z" };
    const croqueta = (n: number, over: Partial<TabLine> = {}) =>
      line(`k${n}`, n, {
        name: "Croqueta",
        productId: "croqueta",
        menuItemId: "croqueta",
        ...over,
      });
    const before = rowsOf([croqueta(1, served), croqueta(2), croqueta(3)]);
    expect(before.map(ids)).toEqual([["k1"], ["k2", "k3"]]);
    const picks = setCount(before[1]!, 1, setCount(before[0]!, 1, new Set()));

    const lines = [croqueta(1, served), croqueta(2, served), croqueta(3, served)];
    expect(rowsOf(lines).map(ids)).toEqual([["k1", "k2", "k3"]]);
    expect(sorted(tidy(before, lines, null, picks))).toEqual(["k1", "k2"]);
  });

  it("tidyPicks follows the row a pick was in, not the picked dish: the only picked Caña of four, c1, paid elsewhere, hands its count to c2", () => {
    const lines = fourCañas();
    const before = rowsOf(lines);
    const picks = setCount(before[0]!, 1, new Set());
    const paid = balance("20.00", "5.00", [{ lineId: "c1", lineNo: 1, paidQuantity: "1.000" }]);

    expect(sorted(picks)).toEqual(["c1"]);
    expect(sorted(tidy(before, lines, paid, picks))).toEqual(["c2"]);
  });

  it("tidyPicks never hands a count to a paid row: c1 of three picked, then c1 and c2 paid, keeps c3", () => {
    const lines = [line("c1", 1), line("c2", 2), line("c3", 3)];
    const before = rowsOf(lines);
    const picks = setCount(before[0]!, 1, new Set());
    const paid = balance("15.00", "10.00", [
      { lineId: "c1", lineNo: 1, paidQuantity: "1.000" },
      { lineId: "c2", lineNo: 2, paidQuantity: "1.000" },
    ]);

    expect(rowsOf(lines, paid).map(ids)).toEqual([["c1", "c2"], ["c3"]]);
    expect(sorted(tidy(before, lines, paid, picks))).toEqual(["c3"]);
  });

  it("tidyPicks hands a count to the first-drawn of two rows that hold equally many of its members: c1 and c2 picked of 4 Cañas, then c1 and c2 served, keeps c1 and c2", () => {
    const lines = [line("c1", 1), line("c2", 2), line("c3", 3), line("c4", 4)];
    const before = rowsOf(lines);
    const picks = setCount(before[0]!, 2, new Set());
    const served = lines.map((row) =>
      row.lineNo <= 2 ? { ...row, servedAt: "2026-11-01T12:00:00Z" } : row,
    );

    expect(rowsOf(served).map(ids)).toEqual([
      ["c1", "c2"],
      ["c3", "c4"],
    ]);
    expect(sorted(tidy(before, served, null, picks))).toEqual(["c1", "c2"]);
  });

  it("tidyPicks keeps a row's count when picked members leave the bill: c1 and c2 picked of 4 Cañas, then both moved off, picks c3 and c4", () => {
    const before = rowsOf(fourCañas());
    const picks = setCount(before[0]!, 2, new Set());

    expect(sorted(tidy(before, [line("c3", 3), line("c4", 4)], null, picks))).toEqual(["c3", "c4"]);
  });

  it("a row picked past its limit gives the floor reason: 4 Cañas all picked on €20.00 with €10.00 received, and one €10.00 dish picked on €10.00 with €5.00 received", () => {
    const lines = fourCañas();
    const all = new Set(lines.map((row) => row.id));
    const [cañas] = rowsOf(lines, balance("20.00", "10.00"), all);
    const flan = dish("f", 1, "Flan", "10.00");
    const [alone] = rowsOf([flan], balance("10.00", "5.00"), new Set(["f"]));

    expect(cañas!.limit).toBe(2);
    expect(cañas!.blocked).toEqual({ reason: "floor", kept: "10.00" });
    expect(alone!.limit).toBe(0);
    expect(alone!.blocked).toEqual({ reason: "floor", kept: "5.00" });
  });

  it("pickedLineIds leaves out a pick on a row now paid", () => {
    const croquetas = [1, 2, 3].map((n) => dish(`k${n}`, n, "Croqueta", "3.00"));
    const picks = new Set(["k1", "k2"]);
    const rows = rowsOf(
      croquetas,
      balance("9.00", "3.00", [{ lineId: "k1", lineNo: 1, paidQuantity: "1.000" }]),
      picks,
    );

    expect(rows[0]!.blocked).toEqual({ reason: "paid" });
    expect(pickedLineIds(rows, picks)).toEqual(["k2"]);
  });

  it("pickedLineIds is in line order", () => {
    const lines = [dish("p", 3, "Paella", "32.00"), line("c1", 1), line("c4", 4)];
    const rows = rowsOf(lines);
    let picks: Picks = new Set();
    for (const row of rows) picks = toggleRow(row, picks);

    expect(rows.map(ids)).toEqual([["p"], ["c1", "c4"]]);
    expect(pickedLineIds(rows, picks)).toEqual(["c1", "p", "c4"]);
  });
});
