import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  workOutBillDiscounts,
  type BillDiscountLine,
  type PendingBillDiscount,
} from "@waitron/adjustments";
import { workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { gatherBillDiscountInputs, readBillDiscounts } from "./bill-discounts-read.js";
import { readLockedLines } from "./stored-order-lines.js";
import { holdDiscount } from "./testing/bill-discounts.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { moveOrderLines } from "./working-order-transfer.js";

vi.mock("@waitron/adjustments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/adjustments")>();
  return { ...actual, workOutBillDiscounts: vi.fn(actual.workOutBillDiscounts) };
});

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

let worked: ReturnType<typeof vi.mocked<typeof workOutBillDiscounts>>;
beforeAll(() => {
  worked = vi.mocked(workOutBillDiscounts);
});

/** The bill's lines as PR 1 takes them, read here column by column; a bound line's group is any
 * string, which the cases compare between lines. */
async function linesOf(billId: string): Promise<BillDiscountLine[]> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({
        id: workingOrderLines.id,
        lineNo: workingOrderLines.lineNo,
        parentLineId: workingOrderLines.parentLineId,
        setMenuLineId: workingOrderLines.setMenuLineId,
        quantity: workingOrderLines.quantity,
        priceQuantity: workingOrderLines.priceQuantity,
        unit: workingOrderLines.unitPriceGross,
        unitPrecision: workingOrderLines.unitPrecision,
        lineTotal: workingOrderLines.lineTotal,
        cohortId: workingOrderLines.cohortId,
        ordinal: workingOrderLines.cohortOrdinal,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
  const bound = new Set(rows.filter((row) => row.cohortId !== null).map(({ id }) => id));
  return rows.map(({ cohortId, ordinal, ...line }) => ({
    ...line,
    portion:
      cohortId !== null
        ? { group: expect.any(String) as string, ordinal: ordinal! }
        : line.parentLineId !== null && bound.has(line.parentLineId)
          ? { group: expect.any(String) as string, ordinal: 0 }
          : null,
  }));
}

/** Each filed row's working lines, as the invoice groups them. */
async function filedTogether(billId: string): Promise<string[][]> {
  const filed = await inTx(venue, (tx) => readLockedLines(tx, billId));
  return filed.map(({ identity }) => identity.lineIds ?? [identity.id]);
}

/** The bill's lines that share a portion group, as sets of ids. */
function sameGroup(lines: readonly BillDiscountLine[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const line of lines) {
    const key = line.portion?.group ?? `line:${line.id}`;
    groups.set(key, [...(groups.get(key) ?? []), line.id]);
  }
  return [...groups.values()];
}

const tenPercent = { action: "discount_percent", percentBp: 1000, amount: null } as const;
const twoEuros = { action: "discount_amount", percentBp: null, amount: 200 } as const;

function pending(
  id: string,
  target: PendingBillDiscount["target"],
  value: Pick<PendingBillDiscount, "action" | "percentBp" | "amount">,
  position: number,
): PendingBillDiscount {
  return { id, target, ...value, origin: "given", position };
}

/** Two bills, each holding 10% off the bill and 2.00 off its first dish, the second also a set
 * menu's discount whose row is gone. The first's lines are portions; the second's, stored as an
 * order before portions is, are not. */
async function twoBills() {
  const first = await billWith(venue, [
    { name: "Burger", quantity: "2" },
    { name: "Pizza", olives: 1 },
  ]);
  const second = await billWith(venue, [{ name: "Steak" }, { name: "Pizza", olives: 1 }], {
    shape: "grouped",
  });
  const firstLines = await linesOf(first.billId);
  const secondLines = await linesOf(second.billId);
  const held = await inTx(venue, async (tx) => ({
    firstBill: await holdDiscount(tx, venue, { workingOrderId: first.billId, position: 1 }),
    firstDish: await holdDiscount(tx, venue, {
      lineId: firstLines[0]!.id,
      ...twoEuros,
      position: 2,
    }),
    secondBill: await holdDiscount(tx, venue, { workingOrderId: second.billId, position: 1 }),
    secondDish: await holdDiscount(tx, venue, {
      lineId: secondLines[0]!.id,
      ...twoEuros,
      position: 2,
    }),
    secondSetMenu: await holdDiscount(tx, venue, {
      workingOrderId: second.billId,
      setMenuId: randomUUID(),
      setMenuName: "Daily",
      position: 3,
    }),
  }));
  return { first: first.billId, second: second.billId, firstLines, secondLines, held };
}

describe("gatherBillDiscountInputs and readBillDiscounts", () => {
  it("hands over each bill's lines, portion groups and held discounts, and none of another bill's", async () => {
    const { first, second, firstLines, secondLines, held } = await twoBills();
    const inputs = await inTx(venue, (tx) => gatherBillDiscountInputs(tx, [first, second]));

    expect([...inputs.keys()]).toEqual([first, second]);
    expect(inputs.get(first)).toEqual({
      lines: firstLines,
      discounts: [
        pending(held.firstBill, { kind: "bill" }, tenPercent, 1),
        pending(held.firstDish, { kind: "line", lineId: firstLines[0]!.id }, twoEuros, 2),
      ],
    });
    expect(inputs.get(second)).toEqual({
      lines: secondLines,
      discounts: [
        pending(held.secondBill, { kind: "bill" }, tenPercent, 1),
        pending(held.secondDish, { kind: "line", lineId: secondLines[0]!.id }, twoEuros, 2),
        pending(held.secondSetMenu, { kind: "set_menu", lineId: null }, tenPercent, 3),
      ],
    });
    // The two burgers are bound portions the invoice files as one row; the groups say the same.
    expect(await filedTogether(first)).toContainEqual([firstLines[0]!.id, firstLines[1]!.id]);
    for (const bill of [first, second]) {
      const { lines } = inputs.get(bill)!;
      expect(sameGroup(lines).map((ids) => ids.sort())).toEqual(
        (await filedTogether(bill)).map((ids) => ids.sort()),
      );
    }
  });

  it("finds a dish's discount on the bill its line moved to", async () => {
    const from = await billWith(venue, [{ name: "Steak" }, { name: "Salad" }]);
    const to = await billWith(venue, [{ name: "Water" }]);
    const [steak] = await linesOf(from.billId);
    const id = await inTx(venue, (tx) =>
      holdDiscount(tx, venue, { lineId: steak!.id, ...twoEuros }),
    );
    const kept = await inTx(venue, (tx) =>
      holdDiscount(tx, venue, { workingOrderId: from.billId }),
    );
    await inTx(venue, (tx) =>
      moveOrderLines(tx, venue.cfg, from.billId, to.billId, [steak!.lineNo]),
    );

    const inputs = await inTx(venue, (tx) =>
      gatherBillDiscountInputs(tx, [from.billId, to.billId]),
    );
    expect(inputs.get(from.billId)!.discounts.map(({ id }) => id)).toEqual([kept]);
    expect(inputs.get(to.billId)!.discounts).toEqual([
      pending(id, { kind: "line", lineId: steak!.id }, twoEuros, 1),
    ]);
    expect(inputs.get(to.billId)!.lines.map(({ id }) => id)).toContain(steak!.id);
  });

  it("answers a bill holding no discount with nothing off, without working it out", async () => {
    const { first } = await twoBills();
    const plain = await billWith(venue, [{ name: "Steak" }]);
    worked.mockClear();

    const inputs = await inTx(venue, (tx) => gatherBillDiscountInputs(tx, [plain.billId, first]));
    expect([...inputs.keys()]).toEqual([first]);
    expect(await inTx(venue, (tx) => gatherBillDiscountInputs(tx, [plain.billId]))).toEqual(
      new Map(),
    );
    const answers = await inTx(venue, (tx) => readBillDiscounts(tx, [plain.billId, first]));
    expect(answers.get(plain.billId)).toEqual({ discounts: [], takes: 0 });
    expect(worked).toHaveBeenCalledTimes(1);
    expect(worked.mock.calls[0]![0]).toEqual(inputs.get(first)!.lines);
  });

  it("hands over a bill holding a discount and no lines with no lines", async () => {
    const empty = await billWith(venue, []);
    const id = await inTx(venue, (tx) => holdDiscount(tx, venue, { workingOrderId: empty.billId }));
    const inputs = await inTx(venue, (tx) => gatherBillDiscountInputs(tx, [empty.billId]));
    expect(inputs.get(empty.billId)).toEqual({
      lines: [],
      discounts: [pending(id, { kind: "bill" }, tenPercent, 1)],
    });
  });

  it("answers each bill what PR 1's working-out answers on that bill's input", async () => {
    const { first, second } = await twoBills();
    const inputs = await inTx(venue, (tx) => gatherBillDiscountInputs(tx, [first, second]));
    const answers = await inTx(venue, (tx) => readBillDiscounts(tx, [first, second]));
    expect([...answers.keys()]).toEqual([first, second]);
    for (const bill of [first, second]) {
      const { lines, discounts } = inputs.get(bill)!;
      expect(answers.get(bill)).toEqual(workOutBillDiscounts(lines, discounts));
    }
    expect(answers.get(first)!.takes).toBeGreaterThan(0);
  });
});
