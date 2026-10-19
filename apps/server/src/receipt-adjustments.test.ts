import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPayments,
  sales,
  saleLines,
  tenants,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import type { AdjustmentAction } from "@waitron/adjustments";
import { decimal, decimalToCents, sumDecimals } from "@waitron/shared";
import { applyAdjustment, type AdjustmentArgs } from "./adjustments-apply.js";
import { receiptLines } from "./receipt-adjustments.js";
import { beforeVatFigures, isFiled } from "./receipt-figures.js";
import { ticketLinesFrom } from "./receipt-lines.js";
import { formatReceipt } from "./receipt-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  billWith,
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { payWorkingOrder, readSettledTicket } from "./till-sale.js";
import { readStoredOrder, setOrderInvoiceChoice } from "./working-order.js";
import { completeBillPayment } from "./bill-payments.js";
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
    return receiptLines(tx, billId, stored.gross, stored.identities);
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

/** Files the bill as a full invoice to a business, paid by card, and returns the invoice's lines. */
async function invoiceOf(billId: string) {
  const [taxpayer] = await inTx(venue, (tx) => tx.select().from(tenants));
  try {
    await inTx(venue, (tx) =>
      tx
        .update(tenants)
        .set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" })
        .where(eq(tenants.id, 1)),
    );
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
    );
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, billId, {
      revision: order!.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    return await inTx(venue, async (tx) => {
      const stored = await readStoredOrder(tx, billId);
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: `receipt-f1-family-${billId}`,
          kind: "contribution",
          method: "card",
          applied: decimalToCents(sumDecimals(stored.gross.lines.map((line) => line.lineGross))),
          state: "pending",
          requestedBy: venue.supervisorId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
        })
        .returning();
      return (await completeBillPayment(tx, venue, venue.cfg, payment!.id, new Date())).invoice!
        .lines;
    });
  } finally {
    await inTx(venue, (tx) =>
      tx
        .update(tenants)
        .set({ taxpayerDomicile: taxpayer!.taxpayerDomicile })
        .where(eq(tenants.id, 1)),
    );
  }
}

/** `[name, quantity, dishFamily]` per line. */
const families = (
  lines: readonly { descriptions: Record<string, string>; quantity: string; dishFamily?: number }[],
) => lines.map((line) => [line.descriptions["es-ES"], line.quantity, line.dishFamily]);

describe("receiptLines", () => {
  it("keeps filed net figures with discounted and weighted F1 lines in either display order", async () => {
    const billId = await bill([{ name: "Burger" }, { name: "Ham", quantity: "0.250" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });
    const [taxpayer] = await inTx(venue, (tx) => tx.select().from(tenants));
    try {
      await inTx(venue, (tx) =>
        tx
          .update(tenants)
          .set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" })
          .where(eq(tenants.id, 1)),
      );
      const [order] = await inTx(venue, (tx) =>
        tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
      );
      await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, billId, {
        revision: order!.revision,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const receipt = await inTx(venue, async (tx) => {
        const [payment] = await tx
          .insert(billPayments)
          .values({
            workingOrderId: billId,
            submissionId: randomUUID(),
            fingerprint: "receipt-f1-net",
            kind: "contribution",
            method: "card",
            applied: 1680,
            state: "pending",
            requestedBy: venue.supervisorId,
            source: venue.cfg.origin.source,
            deviceId: venue.cfg.origin.deviceId,
          })
          .returning();
        return (await completeBillPayment(tx, venue, venue.cfg, payment!.id, new Date())).invoice!;
      });
      const replay = await inTx(venue, (tx) =>
        readSettledTicket(venue.backend, tx, venue.cfg, billId),
      );
      const expected = [
        {
          quantity: "1",
          gross: "10.80",
          listGross: "12.00",
          listUnitPriceGross: "12.00",
          net: { unitPrice: "8.93", priceQuantity: "1.000", base: "8.93", rate: "21.00" },
          adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.20" }],
        },
        {
          quantity: "0.25",
          gross: "6.00",
          net: { unitPrice: "21.82", priceQuantity: "1.000", base: "5.45", rate: "10.00" },
        },
      ];
      expect(receipt.lines).toMatchObject(expected);
      expect(replay.lines).toMatchObject(expected);
      expect(receipt.lines[1]).not.toHaveProperty("listUnitPriceGross");
      expect(replay.lines[1]).not.toHaveProperty("listUnitPriceGross");
      expect(replay.vatBreakdown).toEqual([
        { rate: "21.00", base: "8.93", tax: "1.87" },
        { rate: "10.00", base: "5.45", tax: "0.55" },
      ]);
      expect(replay.total).toBe("16.80");
      const reordered = await inTx(venue, async (tx) => {
        const stored = await readStoredOrder(tx, billId);
        const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
        return receiptLines(
          tx,
          billId,
          { lines: [...stored.gross.lines].reverse() },
          [...stored.identities].reverse(),
          sale!.id,
        );
      });
      expect(reordered.lines).toMatchObject([...expected].reverse());
      expect(receipt.lines).toMatchObject([{ net: { tax: "1.87" } }, { net: { tax: "0.55" } }]);
      expect(replay.lines).toMatchObject([{ net: { tax: "1.87" } }, { net: { tax: "0.55" } }]);
      const changedDisplay = await inTx(venue, async (tx) => {
        const stored = await readStoredOrder(tx, billId);
        const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
        return receiptLines(
          tx,
          billId,
          {
            lines: stored.gross.lines.map((line) => ({ ...line, lineGross: decimal("99.99") })),
          },
          stored.identities,
          sale!.id,
        );
      });
      expect(changedDisplay.lines).toMatchObject([
        { gross: "99.99", net: { base: "8.93", tax: "1.87" } },
        { gross: "99.99", net: { base: "5.45", tax: "0.55" } },
      ]);
    } finally {
      await inTx(venue, (tx) =>
        tx
          .update(tenants)
          .set({ taxpayerDomicile: taxpayer!.taxpayerDomicile })
          .where(eq(tenants.id, 1)),
      );
    }
  });

  it("reads back a weighed F1 line's stored price before its discount", async () => {
    const billId = await bill([{ name: "Ham", quantity: "0.123" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });
    const [line] = await invoiceOf(billId);
    expect(line).toMatchObject({
      quantity: "0.123",
      gross: "2.65",
      listGross: "2.95",
      listUnitPriceGross: "24.00",
      net: { base: "2.41", rate: "10.00" },
    });
    if (!isFiled(line!)) throw new Error("the F1 line carries no filed figures");
    expect(beforeVatFigures(line)).toEqual({ price: "21.82", amount: "2.68", discount: "0.27" });
  });

  it("replays an F1 discount from the filed list price rather than the display identity", async () => {
    const billId = await bill([{ name: "Burger" }, { name: "Ham", quantity: "0.250" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });
    const [taxpayer] = await inTx(venue, (tx) => tx.select().from(tenants));
    try {
      await inTx(venue, (tx) =>
        tx
          .update(tenants)
          .set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" })
          .where(eq(tenants.id, 1)),
      );
      const [order] = await inTx(venue, (tx) =>
        tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
      );
      await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, billId, {
        revision: order!.revision,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const original = await inTx(venue, async (tx) => {
        const [payment] = await tx
          .insert(billPayments)
          .values({
            workingOrderId: billId,
            submissionId: randomUUID(),
            fingerprint: "receipt-f1-list-snapshot",
            kind: "contribution",
            method: "card",
            applied: 1680,
            state: "pending",
            requestedBy: venue.supervisorId,
            source: venue.cfg.origin.source,
            deviceId: venue.cfg.origin.deviceId,
          })
          .returning();
        return (await completeBillPayment(tx, venue, venue.cfg, payment!.id, new Date())).invoice!;
      });
      const changedIdentity = await inTx(venue, async (tx) => {
        const stored = await readStoredOrder(tx, billId);
        const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
        const saved = await tx
          .select({
            listGross: saleLines.listGross,
            listUnitPriceGross: saleLines.listUnitPriceGross,
          })
          .from(saleLines)
          .where(eq(saleLines.saleId, sale!.id))
          .orderBy(saleLines.lineNo);
        expect(saved).toEqual([
          { listGross: 1200, listUnitPriceGross: 1200 },
          { listGross: null, listUnitPriceGross: null },
        ]);
        const identities = stored.identities.map((identity) => ({
          ...identity,
          listUnitGross: decimal("99.00"),
        }));
        const preview = await receiptLines(tx, billId, stored.gross, identities);
        expect(preview.lines[0]!.listGross).toBe("99.00");
        return receiptLines(
          tx,
          billId,
          { lines: stored.gross.lines.map((line) => ({ ...line, lineGross: decimal("99.99") })) },
          identities,
          sale!.id,
        );
      });
      for (const receipt of [original, changedIdentity]) {
        expect(receipt.lines[0]).toMatchObject({
          listGross: "12.00",
          adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.20" }],
          net: { base: "8.93", tax: "1.87" },
        });
        expect(receipt.lines[1]).not.toHaveProperty("listGross");
        expect(receipt.lines[1]).not.toHaveProperty("adjustments");
      }
      const [sale] = await inTx(venue, (tx) =>
        tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
      );
      await expect(
        inTx(venue, (tx) =>
          tx.update(saleLines).set({ listGross: 9900 }).where(eq(saleLines.saleId, sale!.id)),
        ),
      ).rejects.toThrow("sale_lines is append-only");
      const replay = await inTx(venue, (tx) =>
        readSettledTicket(venue.backend, tx, venue.cfg, billId),
      );
      expect(replay.lines[0]!.listGross).toBe("12.00");
    } finally {
      await inTx(venue, (tx) =>
        tx
          .update(tenants)
          .set({ taxpayerDomicile: taxpayer!.taxpayerDomicile })
          .where(eq(tenants.id, 1)),
      );
    }
  });

  it("carries an Each context flag to the filed extra's display line", async () => {
    const billId = await bill([{ name: "Pizza", olives: 1 }]);
    const childId = await lineIdOf(venue, billId, 2);
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ unitName: { es: "pzas" }, unitPrecision: 0 })
        .where(eq(workingOrderLines.id, childId));
    });

    const receipt = await receiptOf(billId);
    expect(receipt.lines[1]).toMatchObject({ quantity: "1", soldInEach: true });
  });

  it("carries the Each context flag to a dish's line, and not to a dish sold by weight", async () => {
    const billId = await bill([{ name: "Burger" }, { name: "Ham", quantity: "0.350" }]);
    const dishId = await lineIdOf(venue, billId, 1);
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ unitName: { es: "pzas" }, unitPrecision: 0 })
        .where(eq(workingOrderLines.id, dishId));
    });

    const receipt = await receiptOf(billId);
    expect(receipt.lines[0]).toMatchObject({ unitName: { es: "pzas" }, soldInEach: true });
    expect(receipt.lines[1]!.unitName).not.toBeNull();
    expect(receipt.lines[1]).not.toHaveProperty("soldInEach");
  });

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
      return receiptLines(tx, billId, stored.gross, elsewhere);
    });

    expect(shown(receipt)).toEqual([
      ["Hamburguesa", "1", "0.00", "12.00", [{ kind: "comp", amount: "12.00" }]],
    ]);
  });

  it("reads nothing when no line was comped or discounted", async () => {
    const billId = await bill([{ name: "Burger" }]);
    const stored = await inTx(venue, (tx) => readStoredOrder(tx, billId));
    // A line with a unit name reads whether it was sold in Each; this case is about adjustments.
    const gross = { lines: stored.gross.lines.map((line) => ({ ...line, unitName: null })) };
    const unreadable = new Proxy({} as Transaction, {
      get: () => {
        throw new Error("the bill's adjustments were read");
      },
    });

    await expect(receiptLines(unreadable, billId, gross, stored.identities)).resolves.toEqual({
      lines: ticketLinesFrom(gross, stored.identities),
    });
  });

  it("prints a paid bill's comp, percentage off a line and discount on the bill, adding up", async () => {
    const billId = await bill([{ name: "Burger" }, { name: "Bottle" }, { name: "Bread" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 2),
      action: "discount_percent",
      percentBp: 2000,
    });
    await adjust(billId, { action: "discount_percent", percentBp: 1000 });
    const result = await payWorkingOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      { id: billId, tender: { method: "cash", amount: "23.85" }, lines: [] },
    );

    const printed = printedLines(
      formatReceipt({
        result,
        issuer: { venueName: "Ajustes SL", nif: "62000003K" },
        receipt: {},
        invoiceLocale: "es-ES",
        printer: {
          paperWidth: "80mm",
          resolution: "180dpi",
        },
      }),
    );
    const start = printed.findIndex((line) => line.startsWith(`${result.invoiceNumber} `)) + 2;

    const at80 = (label: string, amount: string) =>
      label + " ".repeat(42 - label.length - amount.length) + amount;
    const rule = printed.findIndex((line, at) => at > start && /^-+$/.test(line));
    expect(printed.slice(start, rule)).toEqual([
      at80("1  Hamburguesa", "12,00"),
      at80("  Invitación", "-12,00"),
      at80("1  Rioja crianza", "30,00"),
      at80("  Descuento 20%", "-6,00"),
      at80("1  Pan de pueblo", "2,50"),
      at80("Descuento 10%", "-2,65"),
    ]);
    expect(printed).toContain(`TOTAL${" ".repeat(9)}23,85 €`);
  });

  it("stores the unit price before a discount on a bill paid at once, and nothing on an untouched line", async () => {
    const billId = await bill([{ name: "Burger" }, { name: "Bread" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });
    await payWorkingOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
      id: billId,
      tender: { method: "cash", amount: "13.30" },
      lines: [],
    });

    const saved = await inTx(venue, async (tx) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      return tx
        .select({
          listGross: saleLines.listGross,
          listUnitPriceGross: saleLines.listUnitPriceGross,
        })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
    });
    expect(saved).toEqual([
      { listGross: 1200, listUnitPriceGross: 1200 },
      { listGross: null, listUnitPriceGross: null },
    ]);
  });

  it("prints a whole-line discount that split the line in two beneath the line it was made on", async () => {
    // €1.00 off three Croquetas at €3.33 leaves unit prices in whole cents only as two rows, and the
    // second is numbered after the Bread.
    const billId = await bill([{ name: "Croquetas", quantity: "3" }, { name: "Bread" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_amount",
      amount: "1.00",
    });
    const result = await payWorkingOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      { id: billId, tender: { method: "cash", amount: "11.49" }, lines: [] },
    );

    const printed = printedLines(
      formatReceipt({
        result,
        issuer: { venueName: "Ajustes SL", nif: "62000003K" },
        receipt: {},
        invoiceLocale: "es-ES",
        printer: {
          paperWidth: "80mm",
          resolution: "180dpi",
        },
      }),
    );
    const start = printed.findIndex((line) => line.startsWith(`${result.invoiceNumber} `)) + 2;
    const at80 = (label: string, amount: string) =>
      label + " ".repeat(42 - label.length - amount.length) + amount;
    const rule = printed.findIndex((line, at) => at > start && /^-+$/.test(line));
    expect(printed.slice(start, rule)).toEqual([
      at80("2  Croquetas de jamón", "6,66"),
      at80("  Descuento", "-1,00"),
      at80("1  Pan de pueblo", "2,50"),
      at80("1  Croquetas de jamón", "3,33"),
    ]);
  });

  it("marks both rows of a full invoice's line its own discount split into two prices as one family", async () => {
    const billId = await bill([{ name: "Croquetas", quantity: "3" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });

    expect(families(await invoiceOf(billId))).toEqual([
      ["Croquetas de jamón", "2", 0],
      ["Croquetas de jamón", "1", 0],
    ]);
  });

  it("marks a family whose rows another dish sits between, and leaves that dish unmarked", async () => {
    const billId = await bill([{ name: "Croquetas", quantity: "3" }, { name: "Burger" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });
    await adjust(billId, { action: "discount_percent", percentBp: 1000 });

    const lines = await invoiceOf(billId);
    expect(families(lines)).toEqual([
      ["Croquetas de jamón", "2", 0],
      ["Hamburguesa", "1", undefined],
      ["Croquetas de jamón", "1", 0],
    ]);
    expect(lines[1]).not.toHaveProperty("dishFamily");
  });

  it("marks a family the discount on the bill split, and not a dish only its own discount touched", async () => {
    const billId = await bill([{ name: "Burger" }, { name: "Croquetas", quantity: "3" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });
    await adjust(billId, { action: "discount_percent", percentBp: 1000 });

    const lines = await invoiceOf(billId);
    expect(families(lines)).toEqual([
      ["Hamburguesa", "1", undefined],
      ["Croquetas de jamón", "2", 1],
      ["Croquetas de jamón", "1", 1],
    ]);
    expect(lines[0]).not.toHaveProperty("dishFamily");
  });

  it("marks a dish's extras rows with the family's number when a discount carves part of the dish off", async () => {
    const billId = await bill([{ name: "Pizza", quantity: "3", olives: 1 }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
      quantity: "1",
    });

    const lines = await invoiceOf(billId);
    expect(families(lines)).toEqual([
      ["Pizza margarita", "2", 0],
      ["Aceitunas", "2", 0],
      ["Pizza margarita", "1", 0],
      ["Aceitunas", "1", 0],
    ]);
  });

  it("marks no family on a simplified receipt", async () => {
    const billId = await bill([{ name: "Croquetas", quantity: "3" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });
    const result = await payWorkingOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      { id: billId, tender: { method: "cash", amount: "9.00" }, lines: [] },
    );

    expect(result.lines).toHaveLength(2);
    for (const line of result.lines) expect(line).not.toHaveProperty("dishFamily");
  });

  it("marks no family when the records no longer add up to the bill", async () => {
    const billId = await bill([{ name: "Croquetas", quantity: "3" }]);
    const croquetas = await lineIdOf(venue, billId, 1);
    await adjust(billId, { lineId: croquetas, action: "discount_percent", percentBp: 1000 });
    await adjust(billId, { lineId: croquetas, action: "cancel", quantity: "1" });

    const lines = await invoiceOf(billId);
    expect(lines.some((line) => line.adjustments?.some((entry) => "percentBp" in entry))).toBe(
      false,
    );
    for (const line of lines) expect(line).not.toHaveProperty("dishFamily");
  });
});
