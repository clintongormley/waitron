import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invoiceSeries, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { decimal, jobOrigin, seriesId } from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { provisionAdjustmentVenue, type AdjustmentVenue } from "./testing/adjustment-venue.js";
import { readInvoiceDocument } from "./invoice-document.js";

// These cases issue invoices on a fixed past clock, so their database holds no record from a later
// clock: the chain refuses a record more than a minute earlier than the latest one.

let venue: AdjustmentVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  },
});
const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-10-06T22:34:00Z"),
    offsetMinutes: 120,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};
function none() {
  return fiscalSlot(
    enabledModules(ALL_MODULES, venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat")),
    null,
  ).makeBackend({ db: suite.db, clock, environment: "preproduction" });
}
async function issue(backend: FiscalBackend, full = true, locale = "es-ES") {
  return withTransaction(suite.db, async (tx) => {
    await tx.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
    const [series] = await tx
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.purpose, full ? "full" : "standard"));
    return recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: venue.cfg.nodeId,
      seriesId: seriesId(series!.id),
      locale,
      invoiceLocales: [locale],
      clock,
      total: "7.58",
      vatBreakdown: [
        { rate: decimal("21"), base: decimal("5.00"), tax: decimal("1.05") },
        { rate: decimal("10"), base: decimal("1.39"), tax: decimal("0.14") },
      ],
      lines: [
        {
          lineNo: 4,
          name: "Staff meat",
          descriptions: { "es-ES": "Carne guardada" },
          variantName: "Staff portion",
          variantDescriptions: { "es-ES": "Ración guardada" },
          quantity: "0.250",
          priceQuantity: "1.000",
          unitName: { "es-ES": "kg" },
          unitPrecision: 3,
          unitPrice: "20.00",
          vatRate: "21",
          lineTotal: "5.00",
          lineGross: "6.05",
          listGross: "7.26",
        },
        {
          lineNo: 9,
          parentLineNo: 4,
          name: "Staff extra",
          descriptions: { "es-ES": "Extra guardado" },
          quantity: "1",
          unitPrice: "1.39",
          vatRate: "10",
          lineTotal: "1.39",
          lineGross: "1.53",
        },
      ],
      settlement: { kind: "deferred" },
      ...(full
        ? {
            counterparty: { taxId: "B12345674", legalName: "Saved customer", countryCode: "ES" },
            recipientAddress: "Saved customer address",
          }
        : {}),
    });
  });
}
const read = (backend: FiscalBackend, saleId: string) =>
  withTransaction(suite.db, (tx) => readInvoiceDocument(backend, tx, venue.cfg, saleId));

describe("stored invoice document projection", () => {
  it("requires the current taxpayer only when the backend has no saved issuer", async () => {
    const backend = none();
    const noRecord = await issue(backend);
    const filed = await issue(venue.backend);
    const [taxpayer] = await suite.db.select().from(tenants);
    try {
      await suite.db.delete(tenants);
      await expect(read(backend, noRecord.saleId)).rejects.toThrow("Invoice has no taxpayer");
      const document = await read(venue.backend, filed.saleId);
      expect(document.issuer).toEqual({
        venueName: "Ajustes SL",
        nif: "62000003F",
        domicile: "Saved domicile",
      });
    } finally {
      await suite.db.insert(tenants).values(taxpayer!);
    }
  });
});

describe("the guests a full invoice prints", () => {
  it("reads no guests for a sale with no bill", async () => {
    const issued = await issue(venue.backend);
    const document = await read(venue.backend, issued.saleId);
    expect(document).not.toHaveProperty("guests");
  });
});
