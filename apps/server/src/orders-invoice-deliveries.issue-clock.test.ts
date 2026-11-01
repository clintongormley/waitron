import { testTradingAdmission } from "./testing/trading-admission.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceDeliveries, invoiceSeries, pagePrinters, printAgents, tenants } from "@waitron/db";
import { recordSale } from "@waitron/core";
import { seriesId as brandSeriesId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { inTx, send } from "./testing/bill-venue.js";
import { collect, parked, provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";
import { departmentReceipts, departments } from "@waitron/venue-service";

// These cases issue invoices on a fixed past clock, so their database holds no record from a later
// clock: the chain refuses a record more than a minute earlier than the latest one.

let venue: OrderVenue;
let fullSeriesId = "";
let officeId = "";
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "full")));
      fullSeriesId = series!.id;
      const [agent] = await tx
        .insert(printAgents)
        .values({ locationId: venue.cfg.locationId, name: "Back office agent", tokenHash: "x" })
        .returning({ id: printAgents.id });
      const [office] = await tx
        .insert(pagePrinters)
        .values({
          locationId: venue.cfg.locationId,
          name: "Oficina",
          host: "192.0.2.20",
          port: 631,
          resourcePath: "/ipp/print",
          documentFormat: "application/pdf",
          supportedFormats: ["application/pdf"],
          media: "iso_a4_210x297mm",
          resolutionDpi: 600,
          agentId: agent!.id,
        })
        .returning({ id: pagePrinters.id });
      officeId = office!.id;
      const receipt = { operationDescription: "Restaurante", email: "facturas@example.test" };
      for (const { id } of await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.locationId, venue.cfg.locationId))) {
        await tx
          .insert(departmentReceipts)
          .values({ departmentId: id, receipt })
          .onConflictDoUpdate({ target: departmentReceipts.departmentId, set: { receipt } });
      }
    });
  },
});

/** A full invoice on a new open bill (sent to the kitchen when `placed`), written through the core. */
async function fullInvoice(placed = false): Promise<{ billId: string; saleId: string }> {
  const billId = await parked(venue, "Caña");
  if (placed)
    await placeOrder(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      billId,
      venue.operatorId,
    );
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(fullSeriesId),
      workingOrderId: brandWorkingOrderId(billId),
      locale: venue.cfg.locale,
      invoiceLocales: venue.cfg.invoiceLocales,
      counterparty: { taxId: "12345678Z", legalName: "Cliente Mayorista SL", countryCode: "ES" },
      recipientAddress: "Calle Cliente 9, Madrid",
      total: "3.00",
      lines: [
        {
          lineNo: 1,
          name: "Caña",
          descriptions: { [venue.cfg.locale]: "Caña de cerveza" },
          quantity: "1",
          unitPrice: "3.00",
          vatRate: "10",
          lineTotal: "3.00",
        },
      ],
      clock: venue.clock,
      settlement: { kind: "deferred" },
      operatorId: venue.operatorId,
    }),
  );
  return { billId, saleId };
}

const printInvoice = (cookie: string, billId: string, body: Record<string, unknown>) =>
  send(venue.orders, cookie, "POST", `/management-api/orders/${billId}/invoice-deliveries`, body);

const printBody = (requestKey: string = randomUUID(), printerId: string = officeId) => ({
  medium: "print",
  printerId,
  requestKey,
});

const deliveriesOf = (saleId: string) =>
  inTx(venue, (tx) =>
    tx.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.saleId, saleId)),
  );

describe("dashboard Print invoice", () => {
  it("does not let staff print an older finished invoice hidden from their Orders detail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    let old: { billId: string; saleId: string };
    try {
      old = await fullInvoice(true);
      expect((await collect(venue, old.billId, "3.00")).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    expect(await printInvoice(venue.staffDashboard, old.billId, printBody())).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect(await deliveriesOf(old.saleId)).toEqual([]);
    expect((await printInvoice(venue.supervisorDashboard, old.billId, printBody())).status).toBe(
      200,
    );
  });
});
