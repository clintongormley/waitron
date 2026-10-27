import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  createExtraList,
  createProduct,
  grossLockedLines,
  rateLines,
  readContentLanguages,
  writeProductModifiers,
  type LockedLine,
  type VatClass,
} from "@waitron/catalogue";
import { createAdjustmentReason } from "@waitron/adjustments";
import { withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { addDecimal, decimal, sumDecimals } from "@waitron/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { withReceiptListPrices } from "./receipt-lines.js";
import { partyRevisionOfOrder } from "./parties.js";
import {
  projectPortionSale,
  type PortionBinding,
  type ProjectedLine,
} from "./portion-sale-projection.js";
import { transferItems } from "./testing/bill-action-fixture.js";
import { cancelLine } from "./testing/cancel-line.js";
import { createTableKitchenOrder } from "./testing/kitchen-table-order.js";
import { splitPartyBill } from "./testing/serve-line.js";
import { setupVenue, useSplitExtrasDb, type ProductLine } from "./testing/split-extras-venue.js";
import type { DeviceRequestConfig } from "./till-config.js";
import { readLockedLines, splitLinesWithinOrder, type StoredOrderLine } from "./working-order.js";

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

describe("A803 monetary comparison: portions of one cohort that differ stay apart", () => {
  const burgers = (extras: ExtraSpec[] = []) =>
    portions([{ name: "Burger", price: "9.50", count: 2, extras }]);
  const rowsOf = (projected: readonly ProjectedLine[]) =>
    projected.map((line) => [line.locked.name, line.locked.quantity, line.locked.parentLineNo]);

  it("A803 monetary comparison: a comped portion beside a full-price one", () => {
    const bill = burgers();
    const comped = bill.lines[1]!;
    bill.lines[1] = {
      identity: { ...comped.identity, listUnitGross: decimal("9.50") },
      locked: { ...comped.locked, grossUnitPrice: "0.00" },
    };
    const projected = projectPortionSale(bill.lines, bill.bindings);
    expect(rowsOf(projected)).toEqual([
      ["Burger", "1.000", null],
      ["Burger", "1.000", null],
    ]);
    expect(filed(projected).total).toBe("9.50");
  });

  it("A803 monetary comparison: a portion discounted to the price an undiscounted one sells at", () => {
    const bill = burgers();
    const [first, second] = [bill.lines[0]!, bill.lines[1]!];
    bill.lines[0] = { ...first, locked: { ...first.locked, grossUnitPrice: "9.00" } };
    bill.lines[1] = {
      identity: { ...second.identity, listUnitGross: decimal("9.50") },
      locked: { ...second.locked, grossUnitPrice: "9.00" },
    };
    const projected = projectPortionSale(bill.lines, bill.bindings);
    expect(projected.map((line) => line.identity.listUnitGross)).toEqual([null, "9.50"]);
  });

  it("A803 monetary comparison: a list price equal to the price groups with none, as both file none", () => {
    const bill = burgers();
    const second = bill.lines[1]!;
    bill.lines[1] = { ...second, identity: { ...second.identity, listUnitGross: decimal("9.50") } };
    const projected = projectPortionSale(bill.lines, bill.bindings);
    expect(rowsOf(projected)).toEqual([["Burger", "2.000", null]]);
    expect(filed(projected)).toEqual(filed(grouped([{ name: "Burger", price: "9.50", count: 2 }])));
  });

  it("A803 monetary comparison: portions recorded under different classifications", () => {
    const bill = burgers();
    const other = bill.lines[1]!;
    bill.lines[1] = {
      ...other,
      identity: {
        ...other.identity,
        classification: { reporting: [{ id: "drinks", name: "Drinks" }] },
      },
    };
    expect(projectPortionSale(bill.lines, bill.bindings)).toHaveLength(2);
  });

  it("A803 monetary comparison: the same number of extras, but different ones", () => {
    const bill = burgers([{ name: "Cheese", price: "1.00" }]);
    const second = bill.lines[3]!;
    bill.lines[3] = {
      identity: { ...second.identity, productId: "product-Bacon" },
      locked: {
        ...second.locked,
        name: "Bacon",
        descriptions: { en: "Bacon" },
        grossUnitPrice: "3.00",
      },
    };
    const projected = projectPortionSale(bill.lines, bill.bindings);
    expect(rowsOf(projected)).toEqual([
      ["Burger", "1.000", null],
      ["Cheese", "1.000", 1],
      ["Burger", "1.000", null],
      ["Bacon", "1.000", 3],
    ]);
    expect(filed(projected).total).toBe("23.00");
  });

  it("A803 monetary comparison: an extra taken once on one portion and twice on the other", () => {
    const bill = burgers([{ name: "Cheese", price: "1.00" }]);
    const second = bill.lines[3]!;
    bill.lines[3] = { ...second, locked: { ...second.locked, quantity: "2.000" } };
    expect(rowsOf(projectPortionSale(bill.lines, bill.bindings))).toEqual([
      ["Burger", "1.000", null],
      ["Cheese", "1.000", 1],
      ["Burger", "1.000", null],
      ["Cheese", "2.000", 3],
    ]);
  });

  it("A803 monetary comparison: an extra under another extra is refused as a bug", () => {
    const bill = burgers([{ name: "Cheese", price: "1.00" }]);
    const cheese = bill.lines[1]!;
    bill.lines.splice(2, 0, {
      identity: { ...cheese.identity, id: "line-under-extra" },
      locked: { ...cheese.locked, parentLineNo: 2 },
    });
    expect(() => projectPortionSale(bill.lines, bill.bindings)).toThrow(
      "extra line line-under-extra names no dish line",
    );
  });
});

const OPERATOR = "cccccccc-0000-4000-8000-0000000000f1";

/**
 * The same operations through the real writers (plan Task 3). Today's bills are written grouped by
 * `priceTabRound` + `insertTabRound`; the portion bills are the same round cut into one line per
 * dish with the existing unit split, their bindings kept in memory (cohort: the round's line;
 * ordinal: the order the lines were cut in).
 */
describe("A803 monetary comparison: operations on portions through the real paths", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  let db: Database;
  let cfg: DeviceRequestConfig;
  let ids: { croqueta: string; burger: string; cheese: string; toppings: string; reasonId: string };

  beforeAll(() => {
    db = suite.db;
    useSplitExtrasDb(db);
  });

  beforeEach(async () => {
    const venue = await setupVenue();
    cfg = venue.cfg;
    ids = await withTransaction(db, async (tx) => {
      const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
      const product = async (name: string, price: string) =>
        (
          await createProduct(tx, {
            catalogueId: venue.catalogueId,
            categoryId: null,
            name,
            customerName: { [defaultLanguage]: `${name} (customer)` },
            kitchenName: name.toUpperCase(),
            pricingUnit: "each",
            unitPrice: price,
            vatClass: "reduced",
          })
        ).id;
      const croqueta = await product("Croqueta", "3.33");
      const burger = await product("Burger", "3.33");
      const cheese = await product("Cheese", "0.35");
      const toppings = (
        await createExtraList(
          tx,
          {
            name: "Toppings",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: null,
            active: true,
            items: [{ productId: cheese, maxQuantity: 2, preselected: false, price: null }],
          },
          cfg.locale,
        )
      ).id;
      await writeProductModifiers(tx, burger, [{ kind: "extras", id: toppings }]);
      await tx.insert(persons).values({ id: OPERATOR, displayName: "Ana", role: "supervisor" });
      const reasonId = (
        await createAdjustmentReason(tx, {
          name: "House",
          names: {},
          kind: "comp",
          actions: ["comp", "discount_percent", "discount_amount"],
          maxPercentBp: null,
          maxAmount: null,
          applyRoles: ["staff", "supervisor", "manager", "admin"],
          approverRoles: ["staff", "supervisor", "manager", "admin"],
          noteRequired: false,
        })
      ).id;
      return { croqueta, burger, cheese, toppings, reasonId };
    });
  });

  const croquetas = (count: number): ProductLine => ({
    productId: ids.croqueta,
    quantity: String(count),
  });
  const burgersWithCheese = (count: number): ProductLine => ({
    productId: ids.burger,
    quantity: String(count),
    extras: [{ listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: 1 }] }],
  });
  const plainBurger = (): ProductLine => ({ productId: ids.burger, quantity: "1" });

  /** Today's shape: each round line one row, its extras at the line's quantity. */
  function groupedBill(tx: Transaction, lines: ProductLine[]): Promise<string> {
    return createTableKitchenOrder(tx, cfg, lines);
  }

  /** The same round, cut into one line per dish, each with its own extras. */
  async function portionBill(
    tx: Transaction,
    lines: ProductLine[],
  ): Promise<{ billId: string; bindings: Map<string, PortionBinding> }> {
    const billId = await createTableKitchenOrder(tx, cfg, lines);
    const bindings = new Map<string, PortionBinding>();
    const dishes = await tx
      .select({
        id: workingOrderLines.id,
        lineNo: workingOrderLines.lineNo,
        quantity: workingOrderLines.quantity,
      })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), isNull(workingOrderLines.parentLineId)),
      )
      .orderBy(asc(workingOrderLines.lineNo));
    for (const dish of dishes) {
      const members = [dish.id];
      for (let unit = 1; unit < dish.quantity / 1000; unit += 1) {
        const split = await splitLinesWithinOrder(
          tx,
          cfg,
          billId,
          [{ lineNo: dish.lineNo, quantity: "1" }],
          { splitExtras: true },
        );
        members.push(split.get(dish.id)!.id);
      }
      members.forEach((lineId, i) =>
        bindings.set(lineId, {
          lineId,
          portionId: randomUUID(),
          cohortId: dish.id,
          ordinal: i + 1,
        }),
      );
    }
    return { billId, bindings };
  }

  /** What the bill would file: grouped back when bindings are given, one row per line otherwise. */
  async function fileBill(
    tx: Transaction,
    billId: string,
    bindings?: ReadonlyMap<string, PortionBinding>,
  ) {
    const stored = await readLockedLines(tx, billId);
    return filed(bindings === undefined ? stored : projectPortionSale(stored, bindings));
  }

  /** The rows as every filing path hands them to `recordSale`, through `withReceiptListPrices`. */
  async function saleRowsOf(
    tx: Transaction,
    billId: string,
    bindings?: ReadonlyMap<string, PortionBinding>,
  ): Promise<string[]> {
    const stored = await readLockedLines(tx, billId);
    const lines = bindings === undefined ? stored : projectPortionSale(stored, bindings);
    const priced = rateLines(grossLockedLines(lines.map((line) => line.locked)), DAY);
    return withReceiptListPrices(
      priced.lines,
      lines.map((line) => line.identity),
    )
      .map(
        (row) =>
          `${row.name} ${row.quantity} gross ${row.lineGross} base ${row.lineTotal} @${row.vatRate} list ${row.listGross ?? "-"} each ${row.listUnitPriceGross ?? "-"}`,
      )
      .sort();
  }

  async function dishLineNos(tx: Transaction, billId: string): Promise<number[]> {
    const rows = await tx
      .select({ lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), isNull(workingOrderLines.parentLineId)),
      )
      .orderBy(asc(workingOrderLines.lineNo));
    return rows.map((row) => row.lineNo);
  }

  async function moveBack(tx: Transaction, from: string, into: string): Promise<void> {
    const party = await partyRevisionOfOrder(tx, from);
    await transferItems(
      tx,
      cfg,
      from,
      into,
      (await dishLineNos(tx, from)).map((lineNo) => ({ lineNo })),
      { expectedPartyRevision: party!.revision, operatorId: OPERATOR },
    );
  }

  async function discountLine(
    tx: Transaction,
    billId: string,
    lineNo: number,
    amount: string,
    quantity?: string,
  ): Promise<void> {
    const [line] = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
      );
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    await applyAdjustment(
      tx,
      cfg,
      {
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: line!.id,
        reasonId: ids.reasonId,
        action: "discount_amount",
        amount: decimal(amount),
        ...(quantity === undefined ? {} : { quantity }),
        note: null,
        operatorId: OPERATOR,
      },
      cfg.locale,
    );
  }

  /**
   * A projection that groups a cohort's dishes and ignores their extras: the control for a case in
   * which the ungrouped lines already equal today's.
   */
  function groupByDishAlone(
    stored: readonly StoredOrderLine[],
    bindings: ReadonlyMap<string, PortionBinding>,
  ): StoredOrderLine[] {
    const out: StoredOrderLine[] = [];
    const rowOfPosition = new Map<number, number>();
    const rowOfCohort = new Map<string, number>();
    stored.forEach((line, i) => {
      if (line.locked.parentLineNo != null) {
        out.push({
          ...line,
          locked: { ...line.locked, parentLineNo: rowOfPosition.get(line.locked.parentLineNo)! },
        });
        return;
      }
      const cohort = bindings.get(line.identity.id)?.cohortId;
      const row = cohort === undefined ? undefined : rowOfCohort.get(cohort);
      if (row === undefined) {
        out.push(line);
        rowOfPosition.set(i + 1, out.length);
        if (cohort !== undefined) rowOfCohort.set(cohort, out.length);
      } else {
        const merged = out[row - 1]!;
        out[row - 1] = {
          ...merged,
          locked: {
            ...merged.locked,
            quantity: addDecimal(decimal(merged.locked.quantity), decimal(line.locked.quantity)),
          },
        };
        rowOfPosition.set(i + 1, row);
      }
    });
    return out;
  }

  it("A803 monetary comparison: one of three €3.33 dishes moved to another bill", async () => {
    await withTransaction(db, async (tx) => {
      const todayBill = await groupedBill(tx, [croquetas(3)]);
      const todayMoved = await splitPartyBill(tx, cfg, todayBill, [{ lineNo: 1, quantity: "1" }]);
      const bill = await portionBill(tx, [croquetas(3)]);
      const moved = await splitPartyBill(tx, cfg, bill.billId, [{ lineNo: 3 }]);

      const staying = await fileBill(tx, bill.billId, bill.bindings);
      const leaving = await fileBill(tx, moved.billId, bill.bindings);
      expect(baseOf(await fileBill(tx, todayBill), "10.00")).toBe("6.05");
      expect(baseOf(await fileBill(tx, bill.billId), "10.00")).toBe("6.06");
      expect(staying).toEqual(await fileBill(tx, todayBill));
      expect(leaving).toEqual(await fileBill(tx, todayMoved.billId));
      expect(sumDecimals([decimal(staying.total), decimal(leaving.total)])).toBe("9.99");
    });
  });

  it("A803 monetary comparison: one of three €3.33 burgers with €0.35 cheese moved", async () => {
    await withTransaction(db, async (tx) => {
      // Today refuses to move part of a dish with extras, so the baselines are the two bills as
      // they would be written whole.
      const todayStaying = await groupedBill(tx, [burgersWithCheese(2)]);
      const todayLeaving = await groupedBill(tx, [burgersWithCheese(1)]);
      const bill = await portionBill(tx, [burgersWithCheese(3)]);
      const [, , third] = await dishLineNos(tx, bill.billId);
      const moved = await splitPartyBill(tx, cfg, bill.billId, [{ lineNo: third! }]);

      const staying = await fileBill(tx, bill.billId, bill.bindings);
      const leaving = await fileBill(tx, moved.billId, bill.bindings);
      expect(baseOf(await fileBill(tx, todayStaying), "10.00")).toBe("6.69");
      expect(baseOf(await fileBill(tx, bill.billId), "10.00")).toBe("6.70");
      expect(staying).toEqual(await fileBill(tx, todayStaying));
      expect(leaving).toEqual(await fileBill(tx, todayLeaving));
      expect(sumDecimals([decimal(staying.total), decimal(leaving.total)])).toBe("11.04");
    });
  });

  it("A803 monetary comparison: one of three €3.33 dishes cancelled", async () => {
    await withTransaction(db, async (tx) => {
      const todayBill = await groupedBill(tx, [croquetas(3)]);
      await cancelLine(tx, cfg, todayBill, 1, "1", OPERATOR);
      const bill = await portionBill(tx, [croquetas(3)]);
      await cancelLine(tx, cfg, bill.billId, 2, undefined, OPERATOR);

      const today = await fileBill(tx, todayBill);
      expect(baseOf(today, "10.00")).toBe("6.05");
      expect(baseOf(await fileBill(tx, bill.billId), "10.00")).toBe("6.06");
      expect(await fileBill(tx, bill.billId, bill.bindings)).toEqual(today);
    });
  });

  it("A803 monetary comparison: cheese cancelled on one of two €3.33 burgers", async () => {
    await withTransaction(db, async (tx) => {
      const todayBill = await groupedBill(tx, [burgersWithCheese(1), plainBurger()]);
      const bill = await portionBill(tx, [burgersWithCheese(2)]);
      // Line 2 is the first burger's cheese.
      await cancelLine(tx, cfg, bill.billId, 2, undefined, OPERATOR);

      const today = await fileBill(tx, todayBill);
      expect(await fileBill(tx, bill.billId, bill.bindings)).toEqual(today);
      const stored = await readLockedLines(tx, bill.billId);
      const control = filed(groupByDishAlone(stored, bill.bindings));
      expect(control.rows).toEqual([
        expect.stringMatching(/^Burger 2\.000 /),
        expect.stringMatching(/^Cheese 1\.000 .* under Burger 2\.000 /),
      ]);
      expect(control).not.toEqual(today);
    });
  });

  it("A803 monetary comparison: a discount on one of three €3.33 dishes", async () => {
    await withTransaction(db, async (tx) => {
      const todayBill = await groupedBill(tx, [croquetas(3)]);
      await discountLine(tx, todayBill, 1, "1.00", "1");
      const bill = await portionBill(tx, [croquetas(3)]);
      await discountLine(tx, bill.billId, 1, "1.00");

      const today = await fileBill(tx, todayBill);
      const candidate = await fileBill(tx, bill.billId, bill.bindings);
      expect(baseOf(await fileBill(tx, bill.billId), "10.00")).toBe("8.18");
      expect({ total: candidate.total, vat: candidate.vat }).toEqual({
        total: today.total,
        vat: today.vat,
      });
      // Today's carve stamps the list price on the whole line before it splits it
      // (`reprice`, adjustments-apply.ts), so the two undiscounted dishes keep a list price equal to
      // their price; portions the discount never touched keep none.
      expect(today.rows).toEqual([
        "Croqueta 1.000 gross 2.33 base 2.12 @10.00 list 3.33",
        "Croqueta 2.000 gross 6.66 base 6.05 @10.00 list 3.33",
      ]);
      expect(candidate.rows).toEqual([
        "Croqueta 1.000 gross 2.33 base 2.12 @10.00 list 3.33",
        "Croqueta 2.000 gross 6.66 base 6.05 @10.00 list null",
      ]);
      // What a sale row records: a list price only where it differs from what was charged.
      expect(await saleRowsOf(tx, todayBill)).toEqual([
        "Croqueta 1.000 gross 2.33 base 2.12 @10.00 list 3.33 each 3.33",
        "Croqueta 2.000 gross 6.66 base 6.05 @10.00 list - each -",
      ]);
      expect(await saleRowsOf(tx, bill.billId, bill.bindings)).toEqual(
        await saleRowsOf(tx, todayBill),
      );
    });
  });

  it("A803 monetary comparison: two €3.33 dishes, one moved out and back, file as the original row", async () => {
    await withTransaction(db, async (tx) => {
      const original = await fileBill(tx, await groupedBill(tx, [croquetas(2)]));
      const bill = await portionBill(tx, [croquetas(2)]);
      const moved = await splitPartyBill(tx, cfg, bill.billId, [{ lineNo: 2 }]);
      await moveBack(tx, moved.billId, bill.billId);

      expect(baseOf(original, "10.00")).toBe("6.05");
      expect(baseOf(await fileBill(tx, bill.billId), "10.00")).toBe("6.06");
      expect(await fileBill(tx, bill.billId, bill.bindings)).toEqual(original);
    });
  });

  it("A803 monetary comparison: today, a dish moved out and back stays a row of its own", async () => {
    await withTransaction(db, async (tx) => {
      const todayBill = await groupedBill(tx, [croquetas(2)]);
      const moved = await splitPartyBill(tx, cfg, todayBill, [{ lineNo: 1, quantity: "1" }]);
      await moveBack(tx, moved.billId, todayBill);

      const today = await fileBill(tx, todayBill);
      expect(today.rows).toEqual([
        expect.stringMatching(/^Croqueta 1\.000 gross 3\.33 base 3\.03 /),
        expect.stringMatching(/^Croqueta 1\.000 gross 3\.33 base 3\.03 /),
      ]);
      expect(baseOf(today, "10.00")).toBe("6.06");
    });
  });
});
