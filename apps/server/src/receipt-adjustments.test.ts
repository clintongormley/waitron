import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrders, type Transaction } from "@waitron/db";
import type { AdjustmentAction } from "@waitron/adjustments";
import { decimal } from "@waitron/shared";
import { applyAdjustment, type AdjustmentArgs } from "./adjustments-apply.js";
import { withReceiptAdjustments } from "./receipt-adjustments.js";
import { ticketLinesFrom } from "./receipt-lines.js";
import {
  billWith,
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { readStoredOrder } from "./working-order.js";
import "./errors.js";

// What a receipt prints beneath a comped or discounted dish, and after the goods for a discount on
// the whole bill, read from the bill's adjustment records.
let venue: AdjustmentVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

type Ask = Partial<Omit<AdjustmentArgs, "amount">> & { action: AdjustmentAction; amount?: string };

/** Apply `ask` to the bill at its current revision, as the supervisor, under House. */
async function adjust(billId: string, ask: Ask): Promise<void> {
  await inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    const { amount, ...rest } = ask;
    await applyAdjustment(
      tx,
      venue.cfg,
      {
        orderId: billId,
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: null,
        reasonId: venue.reasonId.house,
        note: null,
        operatorId: venue.supervisorId,
        ...rest,
        ...(amount === undefined ? {} : { amount: decimal(amount) }),
      },
      venue.venueLocale,
    );
  });
}

const bill = async (lines: RoundLine[]) => (await billWith(venue, lines)).billId;

/** The receipt's lines for the bill as it stands, with what each prints beneath it. */
function receiptOf(billId: string) {
  return inTx(venue, async (tx) => {
    const stored = await readStoredOrder(tx, billId);
    return withReceiptAdjustments(
      tx,
      billId,
      ticketLinesFrom(stored.gross, stored.identities),
      stored.identities,
    );
  });
}

/** `[name, quantity, gross, listGross, adjustments]` per line. */
function shown(receipt: Awaited<ReturnType<typeof receiptOf>>) {
  return receipt.lines.map((line) => [
    line.descriptions["es-ES"],
    line.quantity,
    line.gross,
    line.listGross,
    line.adjustments,
  ]);
}

describe("withReceiptAdjustments", () => {
  it("puts a comp of one of three units under the unit it split off", async () => {
    const billId = await bill([{ name: "Burger", quantity: "3" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      quantity: "1",
    });

    const receipt = await receiptOf(billId);

    expect(shown(receipt)).toEqual([
      ["Hamburguesa", "2", "24.00", undefined, undefined],
      ["Hamburguesa", "1", "0.00", "12.00", [{ kind: "comp", amount: "12.00" }]],
    ]);
    expect(receipt).not.toHaveProperty("billAdjustments");
    expect(receipt.lines[0]).not.toHaveProperty("adjustments");
  });

  it("names a line's percentage discount and what it took off", async () => {
    const billId = await bill([{ name: "Bottle" }, { name: "Bread" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });

    expect(shown(await receiptOf(billId))).toEqual([
      [
        "Rioja crianza",
        "1",
        "27.00",
        "30.00",
        [{ kind: "discount", percentBp: 1000, amount: "3.00" }],
      ],
      ["Pan de pueblo", "1", "2.50", undefined, undefined],
    ]);
  });

  it("lists a discount on the whole bill apart from every line", async () => {
    const billId = await bill([{ name: "Bottle" }, { name: "Bread" }]);
    await adjust(billId, { action: "discount_percent", percentBp: 1000 });

    const receipt = await receiptOf(billId);

    expect(receipt.billAdjustments).toEqual([
      { kind: "discount", percentBp: 1000, amount: "3.25" },
    ]);
    expect(receipt.lines.map((line) => line.adjustments)).toEqual([undefined, undefined]);
  });

  it("keeps a line's comp and a later amount off the bill each where it was made", async () => {
    const billId = await bill([{ name: "Burger" }, { name: "Bottle" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    await adjust(billId, { action: "discount_amount", amount: "5.00" });

    const receipt = await receiptOf(billId);

    expect(receipt.lines.map((line) => line.adjustments)).toEqual([
      [{ kind: "comp", amount: "12.00" }],
      undefined,
    ]);
    expect(receipt.billAdjustments).toEqual([{ kind: "discount", amount: "5.00" }]);
  });

  it("falls back to what each dish lost when the records no longer add up to the bill", async () => {
    // €3.00 off three Burgers, then one of them cancelled: the record still says €3.00, but the two
    // Burgers left lost €2.00.
    const billId = await bill([{ name: "Burger", quantity: "3" }, { name: "Bottle" }]);
    const burgers = await lineIdOf(venue, billId, 1);
    await adjust(billId, { lineId: burgers, action: "discount_amount", amount: "3.00" });
    await adjust(billId, { action: "discount_percent", percentBp: 1000 });
    await adjust(billId, { lineId: burgers, action: "cancel", quantity: "1" });

    const receipt = await receiptOf(billId);

    expect(receipt).not.toHaveProperty("billAdjustments");
    expect(shown(receipt)).toEqual([
      ["Hamburguesa", "2", "19.80", "24.00", [{ kind: "discount", amount: "4.20" }]],
      ["Rioja crianza", "1", "27.00", "30.00", [{ kind: "discount", amount: "3.00" }]],
    ]);
  });

  it("falls back to one line per dish, its extras included, and none for an untouched dish", async () => {
    const billId = await bill([
      { name: "Burger", quantity: "3" },
      { name: "Bread" },
      { name: "Pizza", olives: 1 },
    ]);
    const burgers = await lineIdOf(venue, billId, 1);
    await adjust(billId, { lineId: burgers, action: "discount_amount", amount: "3.00" });
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 3), action: "comp" });
    await adjust(billId, { lineId: burgers, action: "cancel", quantity: "1" });

    expect(shown(await receiptOf(billId))).toEqual([
      ["Hamburguesa", "2", "22.00", "24.00", [{ kind: "discount", amount: "2.00" }]],
      ["Pan de pueblo", "1", "2.50", undefined, undefined],
      ["Pizza margarita", "1", "0.00", "9.00", [{ kind: "comp", amount: "10.50" }]],
      ["Aceitunas", "1", "0.00", "1.50", undefined],
    ]);
  });

  it("falls back when a record names a row that is not on this receipt, even if the sums agree", async () => {
    const billId = await bill([{ name: "Burger" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });

    const receipt = await inTx(venue, async (tx) => {
      const stored = await readStoredOrder(tx, billId);
      // The same row under another id: the €12.00 record still adds up, but names no row here.
      const elsewhere = stored.identities.map((identity) => ({ ...identity, id: randomUUID() }));
      return withReceiptAdjustments(
        tx,
        billId,
        ticketLinesFrom(stored.gross, elsewhere),
        elsewhere,
      );
    });

    expect(shown(receipt)).toEqual([
      ["Hamburguesa", "1", "0.00", "12.00", [{ kind: "comp", amount: "12.00" }]],
    ]);
  });

  it("reads nothing when no line was comped or discounted", async () => {
    const billId = await bill([{ name: "Burger" }]);
    const { lines, identities } = await inTx(venue, async (tx) => {
      const stored = await readStoredOrder(tx, billId);
      return {
        lines: ticketLinesFrom(stored.gross, stored.identities),
        identities: stored.identities,
      };
    });
    const unreadable = new Proxy({} as Transaction, {
      get: () => {
        throw new Error("the bill's adjustments were read");
      },
    });

    await expect(withReceiptAdjustments(unreadable, billId, lines, identities)).resolves.toEqual({
      lines,
    });
  });
});
