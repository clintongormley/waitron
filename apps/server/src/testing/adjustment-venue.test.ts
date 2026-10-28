import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrderLines } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertTabRound, priceTabRound, type TabRoundLine } from "../working-order.js";
import {
  inTx,
  provisionAdjustmentVenue,
  todayLine,
  todayLineNos,
  type AdjustmentVenue,
  type RoundLine,
} from "./adjustment-venue.js";
import { createTable } from "./live-table.js";
import { cancelPortions } from "../order-portions.js";
import { addPortionRound } from "./portion-bill.js";
import { openPartyTab } from "./serve-line.js";
import "../errors.js";

let venue: AdjustmentVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

function roundOf(lines: RoundLine[]): TabRoundLine[] {
  return lines.map((line) => ({
    menuItemId: venue.item(line.name),
    quantity: line.quantity ?? "1",
    ...(line.olives === undefined
      ? {}
      : {
          extras: [
            {
              listId: venue.pizzaExtras,
              picks: [{ productId: venue.olivesId, quantity: line.olives }],
            },
          ],
        }),
  }));
}

/** A bill holding `rounds` in turn, each written as today's grouped lines or as portions. */
function billOf(rounds: { shape: "grouped" | "portions"; lines: RoundLine[] }[]) {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `L-${randomUUID().slice(0, 8)}`,
      zoneId: venue.tables.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
    for (const round of rounds) {
      if (round.shape === "portions") {
        await addPortionRound(tx, venue.cfg, tabId, roundOf(round.lines));
      } else {
        const priced = await priceTabRound(tx, venue.cfg, tabId, roundOf(round.lines), "checked");
        await insertTabRound(tx, venue.cfg, priced, priced.rows);
      }
    }
    const rows = await tx
      .select({ id: workingOrderLines.id, name: workingOrderLines.name })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(asc(workingOrderLines.lineNo));
    return { billId: tabId, ids: rows.map((row) => row.id), names: rows.map((row) => row.name) };
  });
}

describe("todayLine", () => {
  it("on a bill of grouped lines answers the line of that number", async () => {
    const bill = await billOf([
      { shape: "grouped", lines: [{ name: "Croquetas", quantity: "3" }, { name: "Burger" }] },
    ]);

    expect(bill.names).toEqual(["Croquetas", "Burger"]);
    expect(await todayLine(venue, bill.billId, 1)).toEqual({ lineId: bill.ids[0] });
    expect(await todayLine(venue, bill.billId, 2)).toEqual({ lineId: bill.ids[1] });
  });

  it("on a bill of portions answers a row's dishes as today's one line, and a lone dish alone", async () => {
    const bill = await billOf([
      { shape: "portions", lines: [{ name: "Croquetas", quantity: "3" }, { name: "Burger" }] },
    ]);

    expect(bill.names).toEqual(["Croquetas", "Croquetas", "Croquetas", "Burger"]);
    expect(await todayLine(venue, bill.billId, 1)).toEqual({
      lineId: bill.ids[0],
      lineIds: bill.ids.slice(0, 3),
    });
    expect(await todayLine(venue, bill.billId, 2)).toEqual({ lineId: bill.ids[3] });
  });

  it("numbers a row's extras as one line after its dishes, naming each portion's extra", async () => {
    const bill = await billOf([
      {
        shape: "portions",
        lines: [{ name: "Pizza", quantity: "2", olives: 1 }, { name: "Burger" }],
      },
    ]);

    expect(bill.names).toEqual(["Pizza", "Olives", "Pizza", "Olives", "Burger"]);
    expect(await todayLine(venue, bill.billId, 1)).toEqual({
      lineId: bill.ids[0],
      lineIds: [bill.ids[0], bill.ids[2]],
    });
    expect(await todayLine(venue, bill.billId, 2)).toEqual({
      lineId: bill.ids[1],
      lineIds: [bill.ids[1], bill.ids[3]],
    });
    expect(await todayLine(venue, bill.billId, 3)).toEqual({ lineId: bill.ids[4] });
  });

  it("answers a lone portion's extra, and a weighed portion, by its own line", async () => {
    const bill = await billOf([
      {
        shape: "portions",
        lines: [
          { name: "Pizza", olives: 2 },
          { name: "Ham", quantity: "0.350" },
        ],
      },
    ]);

    expect(bill.names).toEqual(["Pizza", "Olives", "Ham"]);
    expect(await todayLine(venue, bill.billId, 1)).toEqual({ lineId: bill.ids[0] });
    expect(await todayLine(venue, bill.billId, 2)).toEqual({ lineId: bill.ids[1] });
    expect(await todayLine(venue, bill.billId, 3)).toEqual({ lineId: bill.ids[2] });
  });

  it("numbers grouped and portion rounds on one bill in turn", async () => {
    const bill = await billOf([
      { shape: "grouped", lines: [{ name: "Burger", quantity: "2" }] },
      { shape: "portions", lines: [{ name: "Croquetas", quantity: "2" }] },
      { shape: "grouped", lines: [{ name: "Bread" }] },
    ]);

    expect(bill.names).toEqual(["Burger", "Croquetas", "Croquetas", "Bread"]);
    expect(await todayLine(venue, bill.billId, 1)).toEqual({ lineId: bill.ids[0] });
    expect(await todayLine(venue, bill.billId, 2)).toEqual({
      lineId: bill.ids[1],
      lineIds: bill.ids.slice(1, 3),
    });
    expect(await todayLine(venue, bill.billId, 3)).toEqual({ lineId: bill.ids[3] });
  });

  it("numbers portions a split set apart as the line today's split appends after the bill's others", async () => {
    const bill = await billOf([
      {
        shape: "portions",
        lines: [{ name: "Pizza", quantity: "3", olives: 1 }, { name: "Bread" }],
      },
    ]);
    // Rows: Pizza, Olives, Pizza, Olives, Pizza, Olives, Bread; the last pizza and its olive comped.
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ unitPriceGross: 0, lineTotal: 0 })
        .where(inArray(workingOrderLines.id, [bill.ids[4]!, bill.ids[5]!])),
    );

    expect(await todayLine(venue, bill.billId, 1)).toEqual({
      lineId: bill.ids[0],
      lineIds: [bill.ids[0], bill.ids[2]],
    });
    expect(await todayLine(venue, bill.billId, 2)).toEqual({
      lineId: bill.ids[1],
      lineIds: [bill.ids[1], bill.ids[3]],
    });
    expect(await todayLine(venue, bill.billId, 3)).toEqual({ lineId: bill.ids[6] });
    expect(await todayLine(venue, bill.billId, 4)).toEqual({ lineId: bill.ids[4] });
    expect(await todayLine(venue, bill.billId, 5)).toEqual({ lineId: bill.ids[5] });
    await expect(todayLine(venue, bill.billId, 6)).rejects.toThrow("no line 6");
  });

  it("keeps a grouped bill's line numbers past a deleted line", async () => {
    const bill = await billOf([
      { shape: "grouped", lines: [{ name: "Burger" }, { name: "Bread" }, { name: "Water" }] },
    ]);
    await inTx(venue, (tx) =>
      tx.delete(workingOrderLines).where(eq(workingOrderLines.id, bill.ids[0]!)),
    );

    expect(await todayLine(venue, bill.billId, 2)).toEqual({ lineId: bill.ids[1] });
    expect(await todayLine(venue, bill.billId, 3)).toEqual({ lineId: bill.ids[2] });
    await expect(todayLine(venue, bill.billId, 1)).rejects.toThrow("no line 1");
  });

  it("todayLineNos answers the stored line numbers standing for today's line", async () => {
    const grouped = await billOf([
      { shape: "grouped", lines: [{ name: "Croquetas", quantity: "3" }, { name: "Burger" }] },
    ]);
    const portions = await billOf([
      { shape: "portions", lines: [{ name: "Croquetas", quantity: "3" }, { name: "Burger" }] },
    ]);

    expect(await todayLineNos(venue, grouped.billId, 1)).toEqual([1]);
    expect(await todayLineNos(venue, grouped.billId, 2)).toEqual([2]);
    expect(await todayLineNos(venue, portions.billId, 1)).toEqual([1, 2, 3]);
    expect(await todayLineNos(venue, portions.billId, 2)).toEqual([4]);
  });

  describe("on a bill some portions left", () => {
    /** Cancel each of `lineIds` with its extras, as a cancel path does: unbound, then deleted. */
    const remove = (billId: string, lineIds: string[]) =>
      inTx(venue, async (tx) => {
        await cancelPortions(tx, billId, lineIds, null);
        await tx.delete(workingOrderLines).where(inArray(workingOrderLines.parentLineId, lineIds));
        await tx.delete(workingOrderLines).where(inArray(workingOrderLines.id, lineIds));
      });

    it("keeps today's numbers for the lines after a row that lost its last dish", async () => {
      const bill = await billOf([
        {
          shape: "portions",
          lines: [{ name: "Croquetas", quantity: "3" }, { name: "Bread" }, { name: "Water" }],
        },
      ]);
      await remove(bill.billId, [bill.ids[2]!]);

      expect(await todayLine(venue, bill.billId, 1)).toEqual({
        lineId: bill.ids[0],
        lineIds: bill.ids.slice(0, 2),
      });
      expect(await todayLine(venue, bill.billId, 2)).toEqual({ lineId: bill.ids[3] });
      expect(await todayLine(venue, bill.billId, 3)).toEqual({ lineId: bill.ids[4] });
    });

    it("keeps them after a row that lost its first dish", async () => {
      const bill = await billOf([
        { shape: "portions", lines: [{ name: "Croquetas", quantity: "3" }, { name: "Bread" }] },
      ]);
      await remove(bill.billId, [bill.ids[0]!]);

      expect(await todayLine(venue, bill.billId, 1)).toEqual({
        lineId: bill.ids[1],
        lineIds: bill.ids.slice(1, 3),
      });
      expect(await todayLine(venue, bill.billId, 2)).toEqual({ lineId: bill.ids[3] });
    });

    it("keeps them after a dish left with its extra", async () => {
      const bill = await billOf([
        {
          shape: "portions",
          lines: [{ name: "Pizza", quantity: "3", olives: 1 }, { name: "Bread" }],
        },
      ]);
      await remove(bill.billId, [bill.ids[4]!]);

      expect(await todayLine(venue, bill.billId, 2)).toEqual({
        lineId: bill.ids[1],
        lineIds: [bill.ids[1], bill.ids[3]],
      });
      expect(await todayLine(venue, bill.billId, 3)).toEqual({ lineId: bill.ids[6] });
    });

    it("keeps them after a lone dish left", async () => {
      const bill = await billOf([
        { shape: "portions", lines: [{ name: "Steak" }, { name: "Bread" }] },
      ]);
      await remove(bill.billId, [bill.ids[0]!]);

      expect(await todayLine(venue, bill.billId, 2)).toEqual({ lineId: bill.ids[1] });
    });

    it("refuses to number a bill a whole row of several dishes left", async () => {
      const bill = await billOf([
        { shape: "portions", lines: [{ name: "Croquetas", quantity: "2" }, { name: "Bread" }] },
      ]);
      await remove(bill.billId, bill.ids.slice(0, 2));

      await expect(todayLine(venue, bill.billId, 2)).rejects.toThrow(
        `a row of several dishes left bill ${bill.billId}`,
      );
    });
  });

  it("refuses a line number the bill does not reach", async () => {
    const bill = await billOf([
      { shape: "portions", lines: [{ name: "Croquetas", quantity: "2" }] },
    ]);

    await expect(todayLine(venue, bill.billId, 2)).rejects.toThrow(
      `no line 2 on bill ${bill.billId}`,
    );
  });
});
