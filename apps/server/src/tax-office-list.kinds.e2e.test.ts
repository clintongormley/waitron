import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { invoiceSeries, sales, saleSubstitutions, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { Counterparty, SaleForFiscalRecord } from "@waitron/fiscal";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { seedTaxpayerWithSif } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { filedKindsBySale, refuseRecord } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, jobOrigin, saleId, stringToCents, type SaleId } from "@waitron/shared";
import { listTaxOfficeInvoices } from "./tax-office-list.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let seeded: Awaited<ReturnType<typeof seedTaxpayerWithSif>>;
let seriesCode: string;
let backend: VerifactuBackend;

beforeEach(async () => {
  seeded = await seedTaxpayerWithSif(suite.db);
  const [series] = await suite.db
    .select({ code: invoiceSeries.code })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.id, seeded.seriesId));
  seriesCode = series!.code;
  backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    deploymentEnvironment: "production",
  });
});

const customer: Counterparty = {
  taxId: "B12345674",
  legalName: "Harbour Foods",
  countryCode: "ES",
};
let nextNumber = 1;

/** Inserts a `sales` row and returns the input that files it through the Verifactu backend. */
async function sale(
  counterparty: Counterparty | null,
  total: string,
  correction?: { correctsSaleId: SaleId; replaces?: true },
): Promise<SaleForFiscalRecord> {
  const id = saleId(randomUUID());
  const invoiceNumber = nextNumber++;
  const issuedAt = new Date(Date.parse("2026-03-01T12:00:00.000Z") + invoiceNumber * 60_000);
  const base = decimal(total.startsWith("-") ? "-10.00" : "10.00");
  const tax = decimal(total.startsWith("-") ? "-2.10" : "2.10");
  await suite.db.insert(sales).values({
    id,
    ...jobOrigin("readiness_test"),
    nodeId: seeded.nodeId,
    seriesId: seeded.seriesId,
    invoiceNumber,
    issuedAt: issuedAt.toISOString(),
    issuedOffsetMinutes: 60,
    total: stringToCents(total),
    vatBreakdown: [{ rate: "21.00", base, tax }],
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
    counterpartyTaxId: counterparty?.taxId ?? null,
    counterpartyLegalName: counterparty?.legalName ?? null,
    counterpartyCountryCode: counterparty?.countryCode ?? null,
    correctsSaleId: correction?.correctsSaleId ?? null,
    replacesOriginal: correction?.replaces ?? false,
  });
  return {
    origin: jobOrigin("readiness_test"),
    nodeId: seeded.nodeId,
    saleId: id,
    seriesId: seeded.seriesId,
    seriesCode,
    invoiceNumber,
    issuedAt,
    offsetMinutes: 60,
    descriptionOfOperation: "Restaurant meal",
    total: decimal(total),
    vatBreakdown: [{ rate: decimal("21.00"), base, tax }],
    counterparty,
  };
}

const file = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, fn);

it("lists each sale with the kind its fiscal record was filed as", async () => {
  const f1 = await sale(customer, "12.10");
  await file((tx) => backend.recordSale(tx, f1));
  const f2 = await sale(null, "12.10");
  await file((tx) => backend.recordSale(tx, f2));
  const ticket = await sale(null, "12.10");
  await file((tx) => backend.recordSale(tx, ticket));
  const f3 = await sale(customer, "12.10");
  await suite.db
    .insert(saleSubstitutions)
    .values({ substitutionSaleId: f3.saleId, substitutedSaleId: ticket.saleId });
  await file((tx) => backend.recordSubstitution(tx, f3, { substitutedSaleIds: [ticket.saleId] }));
  const r5 = await sale(null, "-12.10", { correctsSaleId: f2.saleId });
  await file((tx) => backend.recordCorrection(tx, r5, { correctsSaleId: f2.saleId }));

  // A full invoice is replaced only once AEAT has refused every record of it.
  const refused = await sale(customer, "12.10");
  const { recordId } = await file((tx) => backend.recordSale(tx, refused));
  await refuseRecord(suite.db, recordId, "1100");
  const r4 = await sale(customer, "12.10", { correctsSaleId: refused.saleId, replaces: true });
  await file((tx) =>
    backend.recordCorrection(tx, r4, { correctsSaleId: refused.saleId, replaces: true }),
  );

  const page = await file((tx) =>
    listTaxOfficeInvoices(tx, {
      issued: { from: "2026-03-01", to: "2026-03-01", timeZone: "Europe/Madrid" },
      limit: 50,
    }),
  );
  const filed = await filedKindsBySale(
    suite.db,
    page.rows.map((row) => row.id),
  );
  expect(page.rows.map((row) => [row.kind, filed.get(row.id)])).toEqual(
    page.rows.map((row) => [row.kind, row.kind]),
  );
  expect(new Set(page.rows.map((row) => row.kind))).toEqual(
    new Set(["F1", "F2", "F3", "R4", "R5"]),
  );
  expect(page.rows).toHaveLength(7);
});
