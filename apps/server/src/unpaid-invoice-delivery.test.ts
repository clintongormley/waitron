import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invoiceDeliveries,
  invoiceSeries,
  pagePrinters,
  printJobs,
  sales,
  saleSettlements,
  tenantReceipts,
  tenants,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal } from "@waitron/shared";
import * as selection from "./invoice-selection.js";
import {
  issueUnpaidInvoice,
  priceForIssuance,
  readOrderRevision,
  setOrderInvoiceChoice,
} from "./working-order.js";
import { provisionBillVenue, tabWith, type BillVenue } from "./testing/bill-venue.js";

let venue: BillVenue;
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
  await withTransaction(suite.db, async (tx) => {
    await tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
    await tx.insert(tenantReceipts).values({ receipt: { email: "venue@example.test" } });
  });
});

afterEach(() => vi.restoreAllMocks());

async function bill(kind: "email" | "a4" | "disabled-a4" | "receipt" | "unset") {
  const orderId = await tabWith(venue, "Caña");
  const pagePrinterId = randomUUID();
  await withTransaction(suite.db, (tx) =>
    tx.insert(pagePrinters).values({
      id: pagePrinterId,
      locationId: venue.cfg.locationId,
      name: "Office",
      host: pagePrinterId,
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
    }),
  );
  await setOrderInvoiceChoice(
    suite.db,
    venue.backend,
    venue.cfg,
    orderId,
    {
      revision: await withTransaction(suite.db, (tx) => readOrderRevision(tx, orderId)),
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
      ...(kind === "unset"
        ? {}
        : {
            delivery:
              kind === "email"
                ? {
                    medium: "email",
                    recipient: "customer@example.test",
                    consent: {
                      accepted: true,
                      statementVersion: "invoice-email-v1",
                      language: "es-ES",
                      contactEmail: "venue@example.test",
                    },
                  }
                : kind === "receipt"
                  ? { medium: "receipt" }
                  : { medium: "a4", pagePrinterId },
          }),
    },
    {
      personId: venue.adminId,
      emailAvailable: true,
      now: new Date("2026-10-07T17:00:00Z"),
    },
  );
  if (kind === "disabled-a4") {
    await withTransaction(suite.db, (tx) =>
      tx.update(pagePrinters).set({ active: false }).where(eq(pagePrinters.id, pagePrinterId)),
    );
  }
  return { orderId, pagePrinterId };
}

async function state(tx: Transaction) {
  return {
    sales: await tx.select().from(sales),
    settlements: await tx.select().from(saleSettlements),
    series: await tx.select().from(invoiceSeries),
    deliveries: await tx.select().from(invoiceDeliveries),
    jobs: await tx.select().from(printJobs),
    orders: await tx.select().from(workingOrders),
  };
}

// Select a synthetic F1 after the unchanged public gate; the core still writes the real invoice.
async function syntheticSelection(orderId: string) {
  const selected = await withTransaction(suite.db, (tx) =>
    selection.selectOrderInvoice(tx, venue.backend, venue.cfg, orderId, decimal("3.00")),
  );
  await withTransaction(suite.db, (tx) =>
    tx.update(workingOrders).set({ invoiceType: "F2" }).where(eq(workingOrders.id, orderId)),
  );
  vi.spyOn(selection, "selectOrderInvoice").mockResolvedValue(selected);
}

function issue(tx: Transaction, orderId: string) {
  return priceForIssuance(tx, venue.clock, venue.cfg, orderId).then((invoice) =>
    issueUnpaidInvoice(tx, venue.backend, venue.cfg, invoice, venue.operatorId),
  );
}

describe("unpaid invoice delivery", () => {
  it.each(["email", "a4", "disabled-a4"] as const)(
    "reserves a synthetic %s original in the unpaid issuance transaction",
    async (kind) => {
      const { orderId, pagePrinterId } = await bill(kind);
      await syntheticSelection(orderId);
      const before = await withTransaction(suite.db, state);
      const rollback = new Error("rollback unpaid issuance");
      const medium = kind === "email" ? "email" : "a4";
      async function assertIssued(tx: Transaction) {
        const result = await issue(tx, orderId);
        expect(await tx.select().from(invoiceDeliveries)).toEqual([
          expect.objectContaining({
            saleId: result.saleId,
            requestKey: `issuance:${result.saleId}`,
            medium,
            designation: "original",
            status: "queued",
            personId: venue.operatorId,
            ...(medium === "email"
              ? {
                  recipient: "customer@example.test",
                  consent: {
                    statementVersion: "invoice-email-v1",
                    language: "es-ES",
                    recordedAt: "2026-10-07T17:00:00.000Z",
                    personId: venue.adminId,
                    contactEmail: "venue@example.test",
                  },
                }
              : { pagePrinterId }),
          }),
        ]);
        expect(await tx.select().from(saleSettlements)).toEqual([]);
        expect(await tx.select().from(printJobs)).toEqual(before.jobs);
        const rows = await tx.select().from(sales).where(eq(sales.id, result.saleId));
        expect(rows).toEqual([
          expect.objectContaining({
            workingOrderId: orderId,
            counterpartyTaxId: "B12345674",
            total: 300,
            operatorId: venue.operatorId,
          }),
        ]);
      }
      await expect(
        withTransaction(suite.db, async (tx) => {
          await assertIssued(tx);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(await withTransaction(suite.db, state)).toEqual(before);
      await withTransaction(suite.db, assertIssued);
    },
  );

  it.each(["receipt", "unset"] as const)(
    "keeps synthetic %s unpaid invoices free of automatic print jobs",
    async (kind) => {
      const { orderId } = await bill(kind);
      await syntheticSelection(orderId);
      const before = await withTransaction(suite.db, state);
      await withTransaction(suite.db, (tx) => issue(tx, orderId));
      const after = await withTransaction(suite.db, state);
      expect(after.sales).toHaveLength(before.sales.length + 1);
      expect(after.deliveries).toEqual(before.deliveries);
      expect(after.jobs).toEqual(before.jobs);
      expect(after.settlements).toEqual(before.settlements);
    },
  );

  it("ignores a stale email draft on a simplified unpaid invoice", async () => {
    const { orderId } = await bill("email");
    await withTransaction(suite.db, (tx) =>
      tx.update(workingOrders).set({ invoiceType: "F2" }).where(eq(workingOrders.id, orderId)),
    );
    const result = await withTransaction(suite.db, (tx) => issue(tx, orderId));
    const after = await withTransaction(suite.db, state);
    expect(after.sales).toEqual([
      expect.objectContaining({ id: result.saleId, counterpartyTaxId: null, total: 300 }),
    ]);
    expect(after.deliveries).toEqual([]);
    expect(after.settlements).toEqual([]);
  });

  it.each(["email", "a4"] as const)(
    "retains the public F1 refusal for %s without writing an invoice or delivery",
    async (kind) => {
      const { orderId } = await bill(kind);
      const before = await withTransaction(suite.db, state);
      await expect(withTransaction(suite.db, (tx) => issue(tx, orderId))).rejects.toMatchObject({
        code: "sale.full_invoice_unavailable",
        params: {},
      });
      expect(await withTransaction(suite.db, state)).toEqual(before);
    },
  );
});
