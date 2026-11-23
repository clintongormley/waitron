import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readVenueClock, saleLines, sales, workingOrders, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, type AdjustmentAction } from "@waitron/shared";
import { applyAdjustment, type AdjustmentArgs } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { cancellationRefundValue, rowRefundValue } from "./cancellation-refund-value.js";
import { closeOfDayConfig, issueBillAtClose } from "./close-of-day.js";
import {
  billWith,
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  takeawayRates,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { paySavedBillInCash } from "./testing/bill-payment-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { openTillSession } from "./testing/session-device.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

// A445: a free item on a takeaway ticket mixing VAT rates files its share of the price paid at its
// own rate, through the till's real writers in a venue that files real Veri*Factu records.
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

async function adjust(billId: string, ask: Ask) {
  return inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    const { amount, ...rest } = ask;
    return applyAdjustment(
      tx,
      venue.cfg,
      {
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: null,
        reasonId: venue.reasonId.house,
        note: null,
        operatorId: venue.staffId,
        admission: testTradingAdmission(),
        ...rest,
        ...(amount === undefined ? {} : { amount: decimal(amount) }),
      },
      venue.venueLocale,
    );
  });
}

/** Pays what is left on the bill in cash, issuing its invoice; answers the receipt. */
async function pay(billId: string) {
  const sessionId = await openTillSession(venue.db, {
    deviceId: venue.cfg.origin.deviceId,
    personId: venue.staffId,
  });
  return paySavedBillInCash(
    { admission: testTradingAdmission(), db: venue.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    { personId: venue.staffId, sessionId },
    billId,
    "1000.00",
  );
}

/** A salad (menu €10.00) and a water (menu €2.00) with the water comped; takeaway unless eaten here. */
async function saladWithFreeWater(dining: "takeaway" | "here" = "takeaway") {
  if (dining === "takeaway") await takeawayRates(venue, { Salad: "4.00", Water: "21.00" });
  const { billId } = await billWith(
    venue,
    [{ name: "Salad" }, { name: "Water" }],
    dining === "takeaway" ? { dining: "takeaway" } : {},
  );
  await adjust(billId, { lineId: await lineIdOf(venue, billId, 2), action: "comp" });
  return billId;
}

/** What was filed for the bill's sale: the sale's breakdown, the record's, and each line's columns. */
async function filed(billId: string) {
  return inTx(venue, async (tx: Transaction) => {
    const [sale] = await tx
      .select({ id: sales.id, vatBreakdown: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.workingOrderId, billId));
    const records = venue.db.all<{ desglose: string }>(
      sql`select desglose from verifactu_records where sale_id = ${sale!.id}`,
    );
    const lines = await tx
      .select({
        gross: saleLines.lineGross,
        base: saleLines.lineTotal,
        list: saleLines.listGross,
        listUnit: saleLines.listUnitPriceGross,
      })
      .from(saleLines)
      .where(eq(saleLines.saleId, sale!.id))
      .orderBy(asc(saleLines.lineNo));
    return {
      saleId: sale!.id,
      vatBreakdown: sale!.vatBreakdown,
      record: records.map((row) =>
        (
          JSON.parse(row.desglose) as {
            BaseImponibleOimporteNoSujeto: string;
            TipoImpositivo: string;
            CuotaRepercutida: string;
          }[]
        ).map((d) => ({
          rate: d.TipoImpositivo,
          base: d.BaseImponibleOimporteNoSujeto,
          tax: d.CuotaRepercutida,
        })),
      ),
      lines,
      integrity: await venue.backend.checkIntegrity(tx, venue.cfg.nodeId),
    };
  });
}

const WATER_COMPED = [
  { rate: "4.00", base: "8.01", tax: "0.32" },
  { rate: "21.00", base: "1.38", tax: "0.29" },
];
const WATER_COMPED_LINES = [
  { gross: 833, base: 801, list: 1000, listUnit: 1000 },
  { gross: 167, base: 138, list: 200, listUnit: 200 },
];

describe("a free item on a takeaway ticket mixing VAT rates", () => {
  it("files the water's share of the price paid at 21%, and the receipt still shows the dishes as sold", async () => {
    const billId = await saladWithFreeWater();
    const invoice = await pay(billId);

    const got = await filed(billId);
    expect(got.vatBreakdown).toEqual(WATER_COMPED);
    expect(got.record).toEqual([WATER_COMPED]);
    expect(got.integrity.issues).toEqual([]);
    expect(got.lines).toEqual(WATER_COMPED_LINES);

    expect(
      invoice.lines.map((line) => ({
        gross: line.gross,
        listGross: line.listGross,
        adjustments: line.adjustments,
      })),
    ).toEqual([
      { gross: "10.00", listGross: undefined, adjustments: undefined },
      {
        gross: "0.00",
        listGross: "2.00",
        adjustments: [expect.objectContaining({ kind: "comp", amount: "2.00" })],
      },
    ]);
    expect(invoice.vatBreakdown).toEqual(WATER_COMPED);
  });

  it("shares a whole-bill discount taken after the comp by menu price too", async () => {
    const billId = await saladWithFreeWater();
    await adjust(billId, { action: "discount_amount", amount: "1.00" });
    await pay(billId);

    const got = await filed(billId);
    const breakdown = [
      { rate: "4.00", base: "7.21", tax: "0.29" },
      { rate: "21.00", base: "1.24", tax: "0.26" },
    ];
    expect(got.vatBreakdown).toEqual(breakdown);
    expect(got.record).toEqual([breakdown]);
    expect(got.integrity.issues).toEqual([]);
    expect(got.lines).toEqual([
      { gross: 750, base: 721, list: 1000, listUnit: 1000 },
      { gross: 150, base: 124, list: 200, listUnit: 200 },
    ]);
  });

  it("leaves a ticket eaten here, at one rate, as it is", async () => {
    const billId = await saladWithFreeWater("here");
    await pay(billId);

    const got = await filed(billId);
    const breakdown = [{ rate: "10.00", base: "9.09", tax: "0.91" }];
    expect(got.vatBreakdown).toEqual(breakdown);
    expect(got.record).toEqual([breakdown]);
    expect(got.lines).toEqual([
      { gross: 1000, base: 909, list: null, listUnit: null },
      { gross: 0, base: 0, list: 200, listUnit: 200 },
    ]);
  });

  it("files the same split when the ticket is issued unpaid (Print the bill)", async () => {
    const billId = await saladWithFreeWater();
    await issueOrderInvoice(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      billId,
      venue.staffId,
    );

    const got = await filed(billId);
    expect(got.vatBreakdown).toEqual(WATER_COMPED);
    expect(got.record).toEqual([WATER_COMPED]);
    expect(got.lines).toEqual(WATER_COMPED_LINES);
  });

  it("files the same split when the close of day issues the ticket", async () => {
    const billId = await saladWithFreeWater();
    const outcome = await inTx(venue, async (tx) =>
      issueBillAtClose(
        tx,
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
        },
        closeOfDayConfig(venue.cfg),
        billId,
        // Every bill opened so far counts as due.
        { dayStartedAt: new Date("2999-01-01T00:00:00Z"), venueClock: await readVenueClock(tx) },
      ),
    );
    expect(outcome.kind).toBe("issued");

    const got = await filed(billId);
    expect(got.vatBreakdown).toEqual(WATER_COMPED);
    expect(got.record).toEqual([WATER_COMPED]);
    expect(got.lines).toEqual(WATER_COMPED_LINES);
  });

  it("values each dish for Cancel and refund at its filed share", async () => {
    const billId = await saladWithFreeWater();
    await pay(billId);
    const { saleId } = await filed(billId);
    const salad = await lineIdOf(venue, billId, 1);
    const water = await lineIdOf(venue, billId, 2);

    const values = await inTx(venue, async (tx) => ({
      salad: await cancellationRefundValue(tx, billId, saleId, salad),
      water: await cancellationRefundValue(tx, billId, saleId, water),
      saladRow: await rowRefundValue(tx, billId, saleId, [salad]),
      waterRow: await rowRefundValue(tx, billId, saleId, [water]),
    }));
    expect(values).toEqual({
      salad: { quantity: "1.000", gross: "8.33" },
      water: { quantity: "1.000", gross: "1.67" },
      saladRow: { quantity: "1.000", gross: "8.33" },
      waterRow: { quantity: "1.000", gross: "1.67" },
    });
  });
});
