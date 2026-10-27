import { grossLockedLines, rateLines, type LockedLine, type VatClass } from "@waitron/catalogue";
import { decimal, sumDecimals } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import {
  projectPortionSale,
  type PortionBinding,
  type ProjectedLine,
} from "./portion-sale-projection.js";
import type { StoredOrderLine } from "./working-order.js";

const DAY = "2026-10-27";

interface ExtraSpec {
  name: string;
  price: string;
  vatClass?: VatClass;
  /** Taken per dish, in the selected unit. */
  perDish?: string;
  priceQuantity?: string;
}

interface DishSpec {
  name: string;
  price: string;
  vatClass?: VatClass;
  count: number;
  extras?: ExtraSpec[];
}

let nextId = 0;
const newId = (prefix: string) => `${prefix}-${++nextId}`;

function locked(
  name: string,
  price: string,
  quantity: string,
  vatClass: VatClass,
  priceQuantity = "1.000",
): LockedLine {
  return {
    grossUnitPrice: price,
    quantity,
    priceQuantity,
    vatClass,
    name,
    descriptions: { en: name },
    category: null,
    unitName: null,
    unitPrecision: 0,
    parentLineNo: null,
    optionSnapshots: [],
    variantName: null,
    variantDescriptions: null,
    variantKitchenName: null,
    kitchenName: null,
  };
}

function identity(id: string, productId: string): StoredOrderLine["identity"] {
  return { id, productId, classification: null, listUnitGross: null };
}

function thousandths(value: string, times: number): string {
  return (Number(value) * times).toFixed(3);
}

/** Today's shape: one dish line of `count`, each extra at `count` × its per-dish quantity. */
function grouped(dishes: readonly DishSpec[]): StoredOrderLine[] {
  const lines: StoredOrderLine[] = [];
  for (const dish of dishes) {
    const dishNo = lines.length + 1;
    lines.push({
      identity: identity(newId("line"), `product-${dish.name}`),
      locked: locked(dish.name, dish.price, `${dish.count}.000`, dish.vatClass ?? "reduced"),
    });
    for (const extra of dish.extras ?? []) {
      lines.push({
        identity: identity(newId("line"), `product-${extra.name}`),
        locked: {
          ...locked(
            extra.name,
            extra.price,
            thousandths(extra.perDish ?? "1", dish.count),
            extra.vatClass ?? "reduced",
            extra.priceQuantity,
          ),
          parentLineNo: dishNo,
        },
      });
    }
  }
  return lines;
}

/** The same dishes as portions: one dish line of 1 each, with its own extras, and its binding. */
function portions(
  dishes: readonly DishSpec[],
  bindings: Map<string, PortionBinding> = new Map(),
): { lines: StoredOrderLine[]; bindings: Map<string, PortionBinding> } {
  const lines: StoredOrderLine[] = [];
  for (const dish of dishes) {
    const cohortId = newId("cohort");
    for (let ordinal = 1; ordinal <= dish.count; ordinal++) {
      const dishNo = lines.length + 1;
      const lineId = newId("line");
      lines.push({
        identity: identity(lineId, `product-${dish.name}`),
        locked: locked(dish.name, dish.price, "1.000", dish.vatClass ?? "reduced"),
      });
      bindings.set(lineId, { lineId, portionId: newId("portion"), cohortId, ordinal });
      for (const extra of dish.extras ?? []) {
        lines.push({
          identity: identity(newId("line"), `product-${extra.name}`),
          locked: {
            ...locked(
              extra.name,
              extra.price,
              thousandths(extra.perDish ?? "1", 1),
              extra.vatClass ?? "reduced",
              extra.priceQuantity,
            ),
            parentLineNo: dishNo,
          },
        });
      }
    }
  }
  return { lines, bindings };
}

/**
 * What would be filed, compared as a multiset of rows (decision D8: row order is not compared),
 * with each extra paired to its dish, and the total and VAT breakdown.
 */
function filed(lines: readonly (StoredOrderLine | ProjectedLine)[]) {
  const priced = rateLines(grossLockedLines(lines.map((line) => line.locked)), DAY);
  const describe = (i: number): string => {
    const row = priced.lines[i]!;
    const parent = row.parentLineNo == null ? "" : ` under ${describe(row.parentLineNo - 1)}`;
    return `${row.name} ${row.quantity} gross ${row.lineGross} base ${row.lineTotal} @${row.vatRate} list ${lines[i]!.identity.listUnitGross}${parent}`;
  };
  return {
    rows: priced.lines.map((_, i) => describe(i)).sort(),
    total: priced.total,
    vat: [...priced.vatBreakdown].sort((a, b) => a.rate.localeCompare(b.rate)),
  };
}

/** Today's result, the portions grouped back, and the portions with no grouping at all. */
function compare(dishes: readonly DishSpec[]) {
  const today = filed(grouped(dishes));
  const bill = portions(dishes);
  const candidate = filed(projectPortionSale(bill.lines, bill.bindings));
  const naive = filed(bill.lines);
  return { today, candidate, naive };
}

function baseOf(result: ReturnType<typeof filed>, rate: string): string | undefined {
  return result.vat.find((line) => line.rate === rate)?.base;
}

describe("A803 monetary comparison: pricing portions grouped back by their order line", () => {
  it("A803 monetary comparison: 2 × €0.05 at 10%", () => {
    const { today, candidate, naive } = compare([{ name: "Olive", price: "0.05", count: 2 }]);
    expect(baseOf(today, "10.00")).toBe("0.09");
    expect(baseOf(naive, "10.00")).toBe("0.10");
    expect(candidate).toEqual(today);
  });

  it("A803 monetary comparison: 3 × €3.33 at 10%", () => {
    const { today, candidate, naive } = compare([{ name: "Wine", price: "3.33", count: 3 }]);
    expect(baseOf(today, "10.00")).toBe("9.08");
    expect(baseOf(naive, "10.00")).toBe("9.09");
    expect(candidate).toEqual(today);
  });

  it("A803 monetary comparison: a €3.33 dish at 10% with a €0.35 extra at 21%, two portions", () => {
    const { today, candidate, naive } = compare([
      {
        name: "Toast",
        price: "3.33",
        count: 2,
        extras: [{ name: "Cheese", price: "0.35", vatClass: "general" }],
      },
    ]);
    expect(baseOf(today, "10.00")).toBe("6.05");
    expect(baseOf(naive, "10.00")).toBe("6.06");
    // The 21% extra rounds the same either way (0.58 grouped, 0.29 + 0.29 apart).
    expect(baseOf(naive, "21.00")).toBe(baseOf(today, "21.00"));
    expect(candidate).toEqual(today);
  });

  it("A803 monetary comparison: a free extra and a doubled €0.35 extra on a €3.33 dish at 10%, two dishes", () => {
    const { today, candidate, naive } = compare([
      {
        name: "Toast",
        price: "3.33",
        count: 2,
        extras: [
          { name: "Salt", price: "0.00" },
          { name: "Cheese", price: "0.35", perDish: "2" },
        ],
      },
    ]);
    expect(today.rows.filter((row) => row.startsWith("Salt"))).toHaveLength(1);
    expect(naive.rows.filter((row) => row.startsWith("Salt"))).toHaveLength(2);
    expect(today.rows.find((row) => row.startsWith("Cheese"))).toContain("base 1.27");
    expect(naive.rows.filter((row) => row.startsWith("Cheese"))).toEqual([
      expect.stringContaining("base 0.64"),
      expect.stringContaining("base 0.64"),
    ]);
    expect(candidate).toEqual(today);
  });

  it("A803 monetary comparison: an extra priced at €0.35 per 0.050 portion, 0.100 taken, on a €3.33 dish at 10%, two dishes", () => {
    const { today, candidate, naive } = compare([
      {
        name: "Toast",
        price: "3.33",
        count: 2,
        extras: [{ name: "Ham", price: "0.35", perDish: "0.1", priceQuantity: "0.050" }],
      },
    ]);
    expect(today.rows.find((row) => row.startsWith("Ham"))).toContain("base 1.27");
    expect(naive.rows.filter((row) => row.startsWith("Ham"))).toEqual([
      expect.stringContaining("base 0.64"),
      expect.stringContaining("base 0.64"),
    ]);
    expect(candidate).toEqual(today);
  });

  it("A803 monetary comparison: two identical cohorts priced separately stay two rows", () => {
    const olives: DishSpec = { name: "Olive", price: "0.05", count: 2 };
    const today = filed(grouped([olives, olives]));
    const bill = portions([olives, olives]);
    const candidate = filed(projectPortionSale(bill.lines, bill.bindings));
    expect(today.rows).toHaveLength(2);
    expect(filed(bill.lines).rows).toHaveLength(4);
    expect(candidate).toEqual(today);
  });

  it("A803 monetary comparison: item payment amounts", () => {
    // Each portion's own rows, as an item payment takes them, add up to the grouped row's gross.
    const perPortion = (dishes: readonly DishSpec[]) => {
      const { lines } = portions(dishes);
      const gross = grossLockedLines(lines.map((line) => line.locked)).lines;
      const sums: string[] = [];
      gross.forEach((row) => {
        if (row.parentLineNo == null) sums.push(row.lineGross);
        else sums[sums.length - 1] = sumDecimals([decimal(sums.at(-1)!), row.lineGross]);
      });
      return sums;
    };
    const wine = perPortion([{ name: "Wine", price: "3.33", count: 3 }]);
    expect(sumDecimals(wine.map(decimal))).toBe("9.99");
    const toast = perPortion([
      {
        name: "Toast",
        price: "3.33",
        count: 2,
        extras: [
          { name: "Salt", price: "0.00" },
          { name: "Cheese", price: "0.35", perDish: "2" },
        ],
      },
    ]);
    expect(toast).toEqual(["4.03", "4.03"]);
    expect(sumDecimals(toast.map(decimal))).toBe("8.06");
  });

  it("A803 monetary comparison: extras point at their own dish", () => {
    const bill = portions([
      { name: "Burger", price: "9.50", count: 2, extras: [{ name: "Cheese", price: "1.00" }] },
      { name: "Salad", price: "7.00", count: 1, extras: [{ name: "Dressing", price: "0.50" }] },
      { name: "Steak", price: "18.00", count: 2, extras: [{ name: "Sauce", price: "2.00" }] },
    ]);
    const projected = projectPortionSale(bill.lines, bill.bindings);
    const parentName = (name: string) => {
      const child = projected.find((line) => line.locked.name === name)!;
      return projected[child.locked.parentLineNo! - 1]!.locked.name;
    };
    expect(projected.map((line) => [line.locked.name, line.locked.quantity])).toEqual([
      ["Burger", "2.000"],
      ["Cheese", "2.000"],
      ["Salad", "1.000"],
      ["Dressing", "1.000"],
      ["Steak", "2.000"],
      ["Sauce", "2.000"],
    ]);
    expect(parentName("Cheese")).toBe("Burger");
    expect(parentName("Dressing")).toBe("Salad");
    expect(parentName("Sauce")).toBe("Steak");
  });
});
