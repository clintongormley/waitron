import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { invoiceSeries, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordSale } from "@waitron/core";
import { prepareIssueClock, type TrustedClock } from "@waitron/fiscal";
import { seriesId, workingOrderId } from "@waitron/shared";
import { listAccountantExport, renderAccountantWorkbook } from "./accountant-export.js";
import { buildReceiptDocument } from "./receipt-document.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";

// 23:30 on 14 October in Madrid, then 01:30 on 15 October.
const OPENED = "2026-10-14T21:30:00.000Z";
const ISSUED = "2026-10-14T23:30:00.000Z";

let v: BillVenue;
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
beforeEach(async () => {
  v = await provisionBillVenue(suite.db);
  await v.db.update(tenants).set({ taxpayerDomicile: "1 Registered Street" });
});

async function fullInvoiceAcrossMidnight() {
  const [full] = await v.db
    .insert(invoiceSeries)
    .values({ nodeId: v.cfg.nodeId, code: "FULL", purpose: "full" })
    .returning();
  const order = await seedWorkingOrder(v.db, {
    ...v.cfg.origin,
    nodeId: v.cfg.nodeId,
    orderNumber: 100,
    openedAt: OPENED,
  });
  const source: TrustedClock = {
    ...v.clock,
    now: () => ({ ...v.clock.now(), instant: new Date(ISSUED), offsetMinutes: 0 }),
  };
  return withTransaction(v.db, async (tx) =>
    recordSale(tx, v.backend, {
      origin: v.cfg.origin,
      nodeId: v.cfg.nodeId,
      seriesId: seriesId(full!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant service",
      total: "12.10",
      lines: [
        {
          lineNo: 1,
          name: "Staff dish",
          descriptions: { "es-ES": "Plato" },
          quantity: "1",
          unitPrice: "10.00",
          vatRate: "21.00",
          lineTotal: "10.00",
        },
      ],
      settlement: { kind: "deferred" },
      clock: await prepareIssueClock(tx, v.cfg, source),
      counterparty: { taxId: "B12345674", legalName: "Business customer", countryCode: "ES" },
      recipientAddress: "1 Customer Street",
      workingOrderId: workingOrderId(order.id),
    }),
  );
}

describe("a full invoice for a bill opened before midnight carries only its creation date", () => {
  it("the receipt answer and the issuer facts name no second date", async () => {
    const { saleId } = await fullInvoiceAcrossMidnight();
    const [answer, facts] = await withTransaction(v.db, async (tx) => [
      await readTransactionReceipt(v.backend, tx, v.cfg, saleId),
      await readReceiptIssuer(v.backend, tx, saleId),
    ]);
    expect(answer).toMatchObject({ invoiceType: "F1", issuedAt: ISSUED });
    expect(answer).not.toHaveProperty("operationDate");
    expect(facts).toMatchObject({ invoiceType: "F1" });
    expect(facts).not.toHaveProperty("operationDate");
  });

  it("the printed document shows the creation date and no operation date", async () => {
    const { saleId } = await fullInvoiceAcrossMidnight();
    const result = await withTransaction(v.db, (tx) =>
      readTransactionReceipt(v.backend, tx, v.cfg, saleId),
    );
    const document = buildReceiptDocument({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      result,
      invoiceLocale: "es-ES",
    });
    const printed = JSON.stringify(document.elements);
    expect(printed).toContain("15 oct 2026");
    expect(printed).not.toContain("14 oct 2026");
  });

  it("the accountant export has no operation date column", async () => {
    await fullInvoiceAcrossMidnight();
    const data = await withTransaction(v.db, (tx) =>
      listAccountantExport(tx, { from: "2026-10-01", to: "2026-10-31" }),
    );
    expect(data.invoices).toHaveLength(1);
    expect(data.invoices[0]).not.toHaveProperty("operationDate");
    const sheet = strFromU8(
      unzipSync(await renderAccountantWorkbook(data, "es"))["xl/worksheets/sheet1.xml"]!,
    );
    expect(sheet).not.toContain("2026-10-14");
    expect(sheet).toContain("2026-10-15");
  });
});
