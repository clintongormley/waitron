import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  drawerOpens,
  invoiceSeries,
  saleSettlements,
  sales,
  tenders,
  workingOrders,
} from "@waitron/db";
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
  // Tarta's 18.00 invoice (21% VAT), corrected by default by a credit note of -2.00 base (-2.42):
  // the customer owes 15.58.
  async function correctedTarta(
    credit: { base: string; total: string } = { base: "2.00", total: "-2.42" },
  ): Promise<{ billId: string; saleId: string }> {
    const billId = await placedTarta(invoiceFirstZone);
    return { billId, saleId: await correctBill(billId, credit) };
  }

  /** Records `credit` against the bill's issued invoice and returns that invoice's id. */
  async function correctBill(
    billId: string,
    credit: { base: string; total: string },
  ): Promise<string> {
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
        total: credit.total,
        lines: [
          {
            lineNo: 1,
            name: "Descuento",
            descriptions: { [venue.cfg.locale]: "Descuento" },
            quantity: "-1",
            unitPrice: credit.base,
            vatRate: "21.00",
            lineTotal: `-${credit.base}`,
          },
        ],
        clock: venue.clock,
        authz: { sessionId: session.id },
      });
    });
    return issued!.id;
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

    expect(await tendersOf(saleId)).toEqual([{ method: "cash", amount: 1558, cash: 2000 }]);
    expect(ticket.tender).toEqual({ method: "cash", change: "4.42" });
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

    expect(await tendersOf(saleId)).toEqual([{ method: "card", amount: 1558, cash: null }]);
    const paid = await inTx(venue, (tx) =>
      tx
        .select({ amount: payments.amount, saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.workingOrderId, billId)),
    );
    expect(paid).toEqual([{ amount: 1558, saleId }]);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(registroCount(venue, billId)).toBe(1);
  });

  function drawerOpensOf(saleId: string) {
    return inTx(venue, (tx) =>
      tx
        .select({ saleId: drawerOpens.saleId, reason: drawerOpens.reason })
        .from(drawerOpens)
        .where(eq(drawerOpens.saleId, saleId)),
    );
  }

  async function collectedAtOf(billId: string): Promise<string | null> {
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ collectedAt: workingOrders.collectedAt })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId)),
    );
    return row!.collectedAt;
  }

  // Tarta's 18.00 is a 14.88 base at 21%: a credit note of that base reverses the whole invoice.
  const wholeInvoice = { base: "14.88", total: "-18.00" };

  it("opens the cash drawer when a corrected bill is collected in cash", async () => {
    const { billId, saleId } = await correctedTarta();

    await collectCash(billId);

    expect(await drawerOpensOf(saleId)).toEqual([{ saleId, reason: "cash_sale" }]);
  });

  it("closes a cash collection of a bill that owes nothing, with no tender and no drawer", async () => {
    const { billId, saleId } = await correctedTarta(wholeInvoice);

    const ticket = await collectCash(billId);

    expect(await tendersOf(saleId)).toEqual([]);
    expect((await salesOf(billId))[0]!.settledAt).not.toBeNull();
    expect(await collectedAtOf(billId)).not.toBeNull();
    expect(await drawerOpensOf(saleId)).toEqual([]);
    expect(ticket.tender).toEqual({ method: "unpaid" });
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(registroCount(venue, billId)).toBe(1);
  });

  it("closes a card collection of a bill that owes nothing, with no tender and no payment row", async () => {
    const { billId, saleId } = await correctedTarta(wholeInvoice);

    await collectOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      { id: billId, lines: [], tender: { method: "card", amount: "18.00" } },
      venue.operatorId,
    );

    expect(await tendersOf(saleId)).toEqual([]);
    expect((await salesOf(billId))[0]!.settledAt).not.toBeNull();
    expect(await collectedAtOf(billId)).not.toBeNull();
    const paid = await inTx(venue, (tx) =>
      tx
        .select({ amount: payments.amount })
        .from(payments)
        .where(eq(payments.workingOrderId, billId)),
    );
    expect(paid).toEqual([]);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(registroCount(venue, billId)).toBe(1);
  });

  it("refuses a correction that would take the bill below zero, and the bill still collects in full", async () => {
    const billId = await placedTarta(invoiceFirstZone);
    const [issued] = await salesOf(billId);

    // A 16.53 base at 21% is 20.00, more than Tarta's 18.00 invoice.
    await expect(correctBill(billId, { base: "16.53", total: "-20.00" })).rejects.toMatchObject({
      code: "sale.correction_exceeds_total",
      params: { saleId: issued!.id, remaining: "18.00", correction: "-20.00" },
    });

    expect(await salesOf(billId)).toEqual([{ id: issued!.id, total: 1800, settledAt: null }]);
    expect(registroCount(venue, billId)).toBe(1);
    await collectCash(billId);
    expect(await tendersOf(issued!.id)).toEqual([{ method: "cash", amount: 1800, cash: 2000 }]);
    expect(await statusOf(venue, billId)).toBe("settled");
  });
});
