import { describe, expect, it } from "vitest";
import {
  lineGross,
  workOutBillDiscounts,
  type BillDiscountLine,
  type BillDiscountRow,
  type BillDiscountTarget,
  type PendingBillDiscount,
  type WorkedBillDiscount,
} from "@waitron/adjustments";
import { grossLockedLines } from "@waitron/menu";
import { centsToDecimal, decimalToCents, thousandthsToDecimal } from "@waitron/shared";
import { projectPortionSale, type PortionBinding } from "./portion-sale-projection.js";
import type { StoredOrderLine } from "./stored-order-lines.js";

// The calculator's filed rows are its own copy of `projectPortionSale`'s grouping. Each case works
// a bill's discounts out, writes every discount's rows into the stored lines in turn, and checks
// what the real projection files after each: what the discount says it takes is what the invoice
// total loses, and the invoice's rows show which of them took the cents.

interface Spec {
  id: string;
  lineNo: number;
  product: string;
  unit: number;
  quantity?: number;
  unitPrecision?: number;
  parent?: string;
  cohort?: { id: string; ordinal: number };
  list?: number;
}

interface Held {
  spec: Spec;
  rows: BillDiscountRow[];
  list: number | null;
}

function fields(spec: Spec) {
  return { product: spec.product, unitPrecision: spec.unitPrecision ?? 0 };
}

function stored(bill: ReadonlyMap<string, Held>): {
  lines: StoredOrderLine[];
  bindings: Map<string, PortionBinding>;
} {
  const rows = [...bill.values()]
    .flatMap((held) => held.rows.map((row) => ({ held, row })))
    .sort((a, b) => a.row.lineNo - b.row.lineNo);
  const position = new Map(rows.map(({ row }, at) => [row.id, at + 1]));
  const bindings = new Map<string, PortionBinding>();
  const lines = rows.map(({ held: { spec, list }, row }): StoredOrderLine => {
    if (spec.cohort !== undefined) {
      bindings.set(row.id, {
        lineId: row.id,
        cohortId: spec.cohort.id,
        ordinal: spec.cohort.ordinal,
      });
    }
    return {
      identity: {
        id: row.id,
        productId: spec.product,
        classification: null,
        listUnitGross: list === null ? null : centsToDecimal(list),
      },
      locked: {
        grossUnitPrice: centsToDecimal(row.unit),
        quantity: thousandthsToDecimal(row.quantity),
        priceQuantity: "1.000",
        name: spec.product,
        descriptions: { en: spec.product },
        category: null,
        unitName: null,
        unitPrecision: fields(spec).unitPrecision,
        parentLineNo: spec.parent === undefined ? null : position.get(spec.parent)!,
        optionSnapshots: [],
        variantName: null,
        variantDescriptions: null,
        variantKitchenName: null,
        kitchenName: null,
      },
    };
  });
  return { lines, bindings };
}

/** What the bill files: each row as `its lines quantity@price = total`, and the total in cents. */
function invoice(bill: ReadonlyMap<string, Held>): { rows: string[]; total: number } {
  const { lines, bindings } = stored(bill);
  const projected = projectPortionSale(lines, bindings);
  const gross = grossLockedLines(projected.map(({ locked }) => locked));
  return {
    rows: projected.map(
      ({ identity, locked }, at) =>
        `${identity.lineIds.join("+")} ${locked.quantity}@${locked.grossUnitPrice} = ${gross.lines[at]!.lineGross}`,
    ),
    total: decimalToCents(gross.total),
  };
}

/**
 * The bill's discounts worked out, and what it files before any and after each: every discount
 * checked to take what the invoice total loses. A bound line's group is what the invoice compares
 * but the prices and the quantity, as `BillDiscountLine` asks of its caller.
 */
function workedAndFiled(specs: readonly Spec[], discounts: readonly PendingBillDiscount[]) {
  const bill = new Map<string, Held>(
    specs.map((spec) => {
      const quantity = spec.quantity ?? 1000;
      const total = decimalToCents(lineGross({ unit: spec.unit, priceQuantity: 1000 }, quantity));
      const row = { id: spec.id, lineNo: spec.lineNo, quantity, unit: spec.unit, total };
      return [spec.id, { spec, rows: [row], list: spec.list ?? null }];
    }),
  );
  const boundDish = (id: string | undefined) => id !== undefined && bill.get(id)!.spec.cohort;
  const lines = specs.map((spec): BillDiscountLine => {
    const { quantity, unit, total } = bill.get(spec.id)!.rows[0]!;
    const filed = JSON.stringify(fields(spec));
    return {
      id: spec.id,
      lineNo: spec.lineNo,
      parentLineId: spec.parent ?? null,
      setMenuLineId: null,
      quantity,
      priceQuantity: 1000,
      unit,
      unitPrecision: spec.unitPrecision ?? 0,
      lineTotal: total,
      portion: spec.cohort
        ? { group: JSON.stringify([spec.cohort.id, filed]), ordinal: spec.cohort.ordinal }
        : boundDish(spec.parent)
          ? { group: filed, ordinal: 0 }
          : null,
    };
  });
  const result = workOutBillDiscounts(lines, discounts);
  const filed = [invoice(bill)];
  for (const discount of result.discounts) {
    for (const { lineId, rows } of discount.lines) {
      const held = bill.get(lineId)!;
      held.list ??= held.rows[0]!.unit;
      held.rows = rows;
    }
    filed.push(invoice(bill));
    expect(discount.takes).toBe(filed.at(-2)!.total - filed.at(-1)!.total);
    expect(discount.takes).toBeGreaterThanOrEqual(0);
  }
  return { result, filed: filed.map(({ rows }) => rows) };
}

const bill: BillDiscountTarget = { kind: "bill" };

function discount(
  id: string,
  target: BillDiscountTarget,
  value: { percentBp: number } | { amount: number },
  position: number,
): PendingBillDiscount {
  return {
    id,
    target,
    action: "percentBp" in value ? "discount_percent" : "discount_amount",
    percentBp: "percentBp" in value ? value.percentBp : null,
    amount: "amount" in value ? value.amount : null,
    origin: "given",
    position,
  };
}

function worked(discounts: readonly WorkedBillDiscount[], id: string): WorkedBillDiscount {
  return discounts.find((one) => one.id === id)!;
}

describe("workOutBillDiscounts against the rows projectPortionSale files", () => {
  it("files a bound pair apart once one portion's own discount moves its price", () => {
    const croquettes = (id: string, lineNo: number, ordinal: number): Spec => ({
      id,
      lineNo,
      product: "Croquettes",
      unit: 1000,
      cohort: { id: "c", ordinal },
    });
    const { result, filed } = workedAndFiled(
      [
        croquettes("p1", 1, 1),
        croquettes("p2", 2, 2),
        { id: "wine", lineNo: 3, product: "Wine", unit: 800 },
      ],
      [
        discount("half", { kind: "line", lineId: "p1" }, { percentBp: 5000 }, 1),
        discount("ten", bill, { percentBp: 1000 }, 2),
      ],
    );
    expect(filed).toEqual([
      ["p1+p2 2.000@10.00 = 20.00", "wine 1.000@8.00 = 8.00"],
      ["p1 1.000@5.00 = 5.00", "p2 1.000@10.00 = 10.00", "wine 1.000@8.00 = 8.00"],
      ["p1 1.000@4.50 = 4.50", "p2 1.000@9.00 = 9.00", "wine 1.000@7.20 = 7.20"],
    ]);
    expect(result.takes).toBe(730);
  });

  it("files bound portions together again once a discount brings them to one price", () => {
    const croquettes = (id: string, lineNo: number, unit: number, ordinal: number): Spec => ({
      id,
      lineNo,
      product: "Croquettes",
      unit,
      cohort: { id: "c", ordinal },
      list: 1000,
    });
    const { filed } = workedAndFiled(
      [
        croquettes("p1", 1, 1000, 1),
        croquettes("p2", 2, 500, 2),
        { id: "wine", lineNo: 3, product: "Wine", unit: 500 },
      ],
      [
        discount("half", { kind: "line", lineId: "p1" }, { percentBp: 5000 }, 1),
        discount("two", bill, { amount: 2 }, 2),
      ],
    );
    expect(filed).toEqual([
      ["p1 1.000@10.00 = 10.00", "p2 1.000@5.00 = 5.00", "wine 1.000@5.00 = 5.00"],
      ["p1+p2 2.000@5.00 = 10.00", "wine 1.000@5.00 = 5.00"],
      // The pair's 10.00 took one cent and the wine, by its larger remainder, the other.
      ["p1 1.000@5.00 = 5.00", "p2 1.000@4.99 = 4.99", "wine 1.000@4.99 = 4.99"],
    ]);
  });

  it("files bound portions' extras by their dishes, whatever their own line numbers", () => {
    const dish = (id: string, lineNo: number, ordinal: number): Spec => ({
      id,
      lineNo,
      product: "Croquettes",
      unit: 0,
      cohort: { id: "c", ordinal },
    });
    const sauce = (id: string, lineNo: number, parent: string): Spec => ({
      id,
      lineNo,
      product: "Sauce",
      unit: 1000,
      parent,
    });
    const { filed } = workedAndFiled(
      [dish("d1", 1, 1), dish("d2", 2, 2), sauce("e2", 3, "d2"), sauce("e1", 4, "d1")],
      [discount("one", bill, { amount: 1 }, 1)],
    );
    expect(filed).toEqual([
      ["d1+d2 2.000@0.00 = 0.00", "e1+e2 2.000@10.00 = 20.00"],
      [
        "d1 1.000@0.00 = 0.00",
        "e1 1.000@10.00 = 10.00",
        "d2 1.000@0.00 = 0.00",
        "e2 1.000@9.99 = 9.99",
      ],
    ]);
  });

  it("takes what a filed row of measured extras loses, and cuts an amount down to it", () => {
    const dish = (id: string, lineNo: number, ordinal: number): Spec => ({
      id,
      lineNo,
      product: "Croquettes",
      unit: 100,
      cohort: { id: "c", ordinal },
    });
    const sauce = (id: string, lineNo: number, parent: string): Spec => ({
      id,
      lineNo,
      product: "Sauce",
      unit: 1008,
      quantity: 125,
      unitPrecision: 3,
      parent,
    });
    const { result, filed } = workedAndFiled(
      [dish("d1", 1, 1), dish("d2", 2, 2), sauce("s1", 3, "d1"), sauce("s2", 4, "d2")],
      [discount("five", bill, { amount: 5 }, 1), discount("rest", bill, { amount: 448 }, 2)],
    );
    expect(filed).toEqual([
      ["d1+d2 2.000@1.00 = 2.00", "s1+s2 0.250@10.08 = 2.52"],
      ["d1+d2 2.000@0.99 = 1.98", "s1+s2 0.250@9.97 = 2.49"],
      ["d1+d2 2.000@0.00 = 0.00", "s1+s2 0.250@0.01 = 0.00"],
    ]);
    expect(worked(result.discounts, "five")).toMatchObject({ holds: "yes", takes: 5 });
    expect(worked(result.discounts, "rest")).toMatchObject({ holds: "cut_down", takes: 447 });
  });

  // Bound dishes filed apart file their measured extras apart too, and those round row by row:
  // 0.250 at 10.04 files as 2.51 but two 0.125 as 1.26 each, 0.666 at 1.01 as 0.67 but two 0.333
  // as 0.34 each.
  const steak = (id: string, lineNo: number, unit: number, ordinal: number): Spec => ({
    id,
    lineNo,
    product: "Steak",
    unit,
    cohort: { id: "c", ordinal },
  });
  const measured =
    (id: string, lineNo: number, product: string, unit: number, quantity: number) =>
    (parent: string): Spec => ({ id, lineNo, product, unit, quantity, unitPrecision: 3, parent });

  it("keeps a bound pair at one price where splitting it would refile its extras higher", () => {
    const { result, filed } = workedAndFiled(
      [
        steak("d1", 1, 1250, 1),
        steak("d2", 2, 1250, 2),
        measured("s1", 3, "Sauce", 1004, 125)("d1"),
        measured("o1", 4, "Oil", 101, 333)("d1"),
        measured("s2", 5, "Sauce", 1004, 125)("d2"),
        measured("o2", 6, "Oil", 101, 333)("d2"),
        { id: "wine", lineNo: 7, product: "Wine", unit: 699 },
      ],
      [discount("one", bill, { amount: 1 }, 1)],
    );
    const rows = [
      "d1+d2 2.000@12.50 = 25.00",
      "s1+s2 0.250@10.04 = 2.51",
      "o1+o2 0.666@1.01 = 0.67",
    ];
    expect(filed).toEqual([
      [...rows, "wine 1.000@6.99 = 6.99"],
      [...rows, "wine 1.000@6.98 = 6.98"],
    ]);
    expect(worked(result.discounts, "one")).toMatchObject({ holds: "yes", takes: 1 });
  });

  it("leaves a bound dish as it is where its own discount would refile its extras higher", () => {
    const { result, filed } = workedAndFiled(
      [
        steak("d1", 1, 100, 1),
        steak("d2", 2, 100, 2),
        measured("s1", 3, "Sauce", 101, 333)("d1"),
        measured("o1", 4, "Oil", 101, 333)("d1"),
        measured("s2", 5, "Sauce", 101, 333)("d2"),
        measured("o2", 6, "Oil", 101, 333)("d2"),
      ],
      [discount("half", { kind: "line", lineId: "d1" }, { percentBp: 50 }, 1)],
    );
    const rows = ["d1+d2 2.000@1.00 = 2.00", "s1+s2 0.666@1.01 = 0.67", "o1+o2 0.666@1.01 = 0.67"];
    expect(filed).toEqual([rows, rows]);
    expect(worked(result.discounts, "half")).toMatchObject({ holds: "yes", takes: 0, lines: [] });
  });

  it("leaves bound portions apart where one price would refile their extras higher", () => {
    const { result, filed } = workedAndFiled(
      [
        { ...steak("d1", 1, 100, 1), list: 101 },
        steak("d2", 2, 101, 2),
        measured("s1", 3, "Sauce", 1003, 125)("d1"),
        measured("o1", 4, "Oil", 1003, 125)("d1"),
        measured("s2", 5, "Sauce", 1003, 125)("d2"),
        measured("o2", 6, "Oil", 1003, 125)("d2"),
      ],
      [
        {
          ...discount("share", { kind: "line", lineId: "d2" }, { amount: 1 }, 1),
          origin: "bill_share",
        },
      ],
    );
    const rows = [
      "d1 1.000@1.00 = 1.00",
      "s1 0.125@10.03 = 1.25",
      "o1 0.125@10.03 = 1.25",
      "d2 1.000@1.01 = 1.01",
      "s2 0.125@10.03 = 1.25",
      "o2 0.125@10.03 = 1.25",
    ];
    expect(filed).toEqual([rows, rows]);
    expect(worked(result.discounts, "share")).toMatchObject({ holds: "yes", takes: 0, lines: [] });
  });

  it("moves bound extras' price where their filed row takes a cent neither extra's total loses", () => {
    const dish = (id: string, lineNo: number, ordinal: number): Spec => ({
      id,
      lineNo,
      product: "Croquettes",
      unit: 0,
      cohort: { id: "c", ordinal },
    });
    const { result, filed } = workedAndFiled(
      [
        dish("d1", 1, 1),
        dish("d2", 2, 2),
        measured("s1", 3, "Sauce", 1003, 125)("d1"),
        measured("s2", 4, "Sauce", 1003, 125)("d2"),
      ],
      [discount("one", bill, { amount: 1 }, 1)],
    );
    expect(filed).toEqual([
      ["d1+d2 2.000@0.00 = 0.00", "s1+s2 0.250@10.03 = 2.51"],
      ["d1+d2 2.000@0.00 = 0.00", "s1+s2 0.250@10.01 = 2.50"],
    ]);
    expect(worked(result.discounts, "one")).toMatchObject({ holds: "yes", takes: 1 });
  });
});
