import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceSeries, saleSettlements, sales, tenders } from "@waitron/db";
import { recordCorrection } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import { parkOrder, placeOrder } from "./working-order.js";
import { collectOrder } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// Collecting a presented bill follows its issuance history, not its zone's service mode (spec §9).
// Each case retargets its placed bill's zone directly, and opens its own bill.
let venue: BillVenue;
let invoiceFirstZone: string;
let issueAtPaymentZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    invoiceFirstZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "invoice_first" }),
      )
    ).zoneId;
    issueAtPaymentZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "tables", serviceMode: "prepay" }),
      )
    ).zoneId;
  },
});

async function placedTarta(zoneId: string): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    zoneId,
    operatorId: venue.operatorId,
  });
  await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
  return id;
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: sales.id, total: sales.total, settledAt: saleSettlements.settledAt })
      .from(sales)
      .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
      .where(eq(sales.workingOrderId, billId)),
  );
}

async function retarget(billId: string, zoneId: string): Promise<void> {
  await inTx(venue, (tx) => VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, billId, zoneId));
  const context = await inTx(venue, (tx) => VENUE_SERVICE.findOrderContext(tx, venue.cfg, billId));
  expect(context?.zoneId).toBe(zoneId);
}

function collectCash(billId: string) {
  return collectOrder(
    { db: venue.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    { id: billId, lines: [], tender: { method: "cash", amount: "20.00" } },
    venue.operatorId,
  );
}

describe("collecting a presented bill follows its invoice, not its zone (spec §9)", () => {
  it("settles the invoice issued at placing, even once the bill's zone says to issue at payment", async () => {
    const id = await placedTarta(invoiceFirstZone);
    const issued = await salesOf(id);
    expect(issued).toEqual([{ id: expect.any(String), total: 1800, settledAt: null }]);
    await retarget(id, issueAtPaymentZone);

    await collectCash(id);

    const after = await salesOf(id);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(issued[0]!.id);
    expect(after[0]!.settledAt).not.toBeNull();
    expect(registroCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
  });

  it("issues the invoice at payment for a bill placed without one, even once its zone says invoice first", async () => {
    const id = await placedTarta(issueAtPaymentZone);
    expect(await salesOf(id)).toEqual([]);
    await retarget(id, invoiceFirstZone);

    await collectCash(id);

    const after = await salesOf(id);
    expect(after).toHaveLength(1);
    expect(after[0]!.total).toBe(1800);
    expect(after[0]!.settledAt).not.toBeNull();
    expect(registroCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
  });
});

describe("collecting an invoice that carries a corrective invoice", () => {
  // Tarta's 18.00 invoice, corrected by a credit note of -2.00 base at 10% VAT (-2.20): the
  // customer owes 15.80.
  async function correctedTarta(): Promise<{ billId: string; saleId: string }> {
    const billId = await placedTarta(invoiceFirstZone);
    const [issued] = await salesOf(billId);
    await inTx(venue, async (tx) => {
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(
          and(
            eq(invoiceSeries.nodeId, venue.cfg.nodeId),
            eq(invoiceSeries.purpose, "rectificative"),
          ),
        );
      const session = await loginWithPin(tx, {
        tillId: venue.cfg.tillId,
        personId: venue.adminId,
        pin: "1234",
      });
      await recordCorrection(tx, venue.backend, {
        tillId: venue.cfg.tillId,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(series!.id),
        correctsSaleId: brandSaleId(issued!.id),
        total: "-2.20",
        lines: [
          {
            lineNo: 1,
            name: "Descuento",
            descriptions: { [venue.cfg.locale]: "Descuento" },
            quantity: "1",
            unitPrice: "-2.00",
            vatRate: "10.00",
            lineTotal: "-2.00",
          },
        ],
        clock: venue.clock,
        authz: { sessionId: session.id },
      });
    });
    return { billId, saleId: issued!.id };
  }

  function tendersOf(saleId: string) {
    return inTx(venue, (tx) =>
      tx
        .select({ method: tenders.method, amount: tenders.amount, cash: tenders.cashTendered })
        .from(tenders)
        .where(eq(tenders.saleId, saleId)),
    );
  }

  it("settles a cash collection at the corrected amount the customer owes", async () => {
    const { billId, saleId } = await correctedTarta();

    const ticket = await collectCash(billId);

    expect(await tendersOf(saleId)).toEqual([{ method: "cash", amount: 1580, cash: 2000 }]);
    expect(ticket.tender).toEqual({ method: "cash", change: "4.20" });
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(registroCount(venue, billId)).toBe(1);
  });

  it("settles a manual card collection, and its payment row, at the corrected amount", async () => {
    const { billId, saleId } = await correctedTarta();

    await collectOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      { id: billId, lines: [], tender: { method: "card", amount: "18.00" } },
      venue.operatorId,
    );

    expect(await tendersOf(saleId)).toEqual([{ method: "card", amount: 1580, cash: null }]);
    const paid = await inTx(venue, (tx) =>
      tx
        .select({ amount: payments.amount, saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.workingOrderId, billId)),
    );
    expect(paid).toEqual([{ amount: 1580, saleId }]);
    expect(await statusOf(venue, billId)).toBe("settled");
  });
});
