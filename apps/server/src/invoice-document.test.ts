import type { RecordSaleInput } from "@waitron/core";
import { payments } from "@waitron/payments";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { seedPhotoMetadata } from "@waitron/db/testing/seed.js";
import { readVenueSettings } from "@waitron/db";
import { seedVenueSettings, seedDepartmentReceipt } from "@waitron/db/testing/seed.js";
import { receiptLabelsFor } from "@waitron/country-packs";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { readBillEditState } from "./bill-editing.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  billPayments,
  invoiceSeries,
  parties,
  sales,
  saleLines,
  taxpayer,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { previewCorrectionAmounts, recordCorrection, recordSale, settleSale } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import {
  decimal,
  jobOrigin,
  negateDecimal,
  saleId as brandSaleId,
  seriesId,
  type PrintedReceiptTrim,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import {
  billWith,
  lineIdOf,
  PINS,
  provisionAdjustmentVenue,
  takeawayRates,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import {
  readCustomerInvoiceDocument,
  readInvoiceDocument,
  readReceiptEmailDocument,
} from "./invoice-document.js";
import { applyAdjustment } from "./adjustments-apply.js";

import { completeBillPayment } from "./bill-payments.js";
import { departments, setDepartmentSalePolicyField } from "@waitron/venue-service";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { CONTACT_SEPARATOR } from "./receipt-facts.js";
import { formatMoney } from "./receipt-money.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import type { TillSaleLine } from "./till-sale.js";
import { layoutA4Invoice } from "./invoice-layout.js";
import { pageRows } from "./testing/invoice-page-rows.js";
import { INVOICE_PAGE_WIDTH, invoiceTextWidth } from "./invoice-page.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import { clearThemes, putThemeInUse, THEME_LOGO, UNTRUSTED_CASES } from "./testing/theme-logo.js";

let venue: AdjustmentVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await db.update(taxpayer).set({ taxpayerDomicile: "Saved domicile" });
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
async function issue(
  backend: FiscalBackend,
  full = true,
  locale = "es-ES",
  receipt?: Omit<NonNullable<RecordSaleInput["receipt"]>, "guestCount">,
) {
  return withTransaction(suite.db, async (tx) => {
    await tx.update(taxpayer).set({ taxpayerDomicile: "Saved domicile" });
    const [series] = await tx
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.purpose, full ? "full" : "standard"));
    return recordSale(tx, backend, {
      ...(receipt === undefined ? {} : { receipt: { ...receipt, guestCount: null } }),
      operationDescription: "Restaurante",
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
/** Every line of text the printed A4 pages carry, in drawing order. */
const pageTexts = (document: ReceiptDocumentInput): string[] =>
  layoutA4Invoice(document).flatMap((page) =>
    page.elements.flatMap((element) => (element.kind === "text" ? [element.text] : [])),
  );

describe("stored invoice document projection", () => {
  it("rebuilds a no-regime full invoice from stored lines without a draft or filed receipt", async () => {
    const backend = none();
    const sale = await issue(backend);
    const document = await read(backend, sale.saleId);
    expect(document.invoiceLocale).toBe("es-ES");
    expect(document.namesLocale).toBe("es-ES");
    expect(document.result).toMatchObject({
      invoiceType: "F1",
      issuedAt: "2026-10-06T22:34:00.000Z",
      issuedOffsetMinutes: 120,
      total: "7.58",
      qr: "",
      tender: { method: "unpaid" },
      recipient: {
        taxId: "B12345674",
        legalName: "Saved customer",
        countryCode: "ES",
        address: "Saved customer address",
      },
      vatBreakdown: [
        { rate: "21", base: "5.00", tax: "1.05" },
        { rate: "10", base: "1.39", tax: "0.14" },
      ],
    });
    expect(document.result.lines).toEqual([
      {
        descriptions: { "es-ES": "Carne guardada (Ración guardada)" },
        optionSnapshots: [],
        quantity: "0.25",
        unitName: { "es-ES": "kg" },
        unitPrecision: 3,
        gross: "6.05",
        vatRate: "21.00",
        listGross: "7.26",
        parentLineNo: null,
        net: {
          unitPrice: "20.00",
          priceQuantity: "1.000",
          base: "5.00",
          rate: "21.00",
          tax: "1.05",
        },
        adjustments: [{ kind: "discount", amount: "1.21" }],
      },
      {
        descriptions: { "es-ES": "Extra guardado" },
        optionSnapshots: [],
        quantity: "1",
        unitName: null,
        unitPrecision: null,
        gross: "1.53",
        vatRate: "10.00",
        parentLineNo: 4,
        net: {
          unitPrice: "1.39",
          priceQuantity: "1.000",
          base: "1.39",
          rate: "10.00",
          tax: "0.14",
        },
      },
    ]);
    expect(document.result.qrText).toBeUndefined();
    expect(document.result.payments).toBeUndefined();
    expect(await suite.db.select().from(sales)).toHaveLength(1);
  });

  it("A965 labels keeps a saved Spanish invoice independent of the current English config", async () => {
    const backend = none();
    const sale = await issue(backend, true, "es-ES");
    const document = await withTransaction(suite.db, (tx) =>
      readInvoiceDocument(backend, tx, { ...venue.cfg, locale: "en-GB" }, sale.saleId),
    );
    expect(document.invoiceLocale).toBe("es-ES");
    expect(document.result.locale).toBe("es-ES");
    expect(document.namesLocale).toBe("es-ES");
    const [stored] = await suite.db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId))
      .orderBy(saleLines.lineNo);
    expect(document.result.lines[0]!.descriptions).toEqual({
      "es-ES": `${stored!.descriptions["es-ES"]} (${stored!.variantDescriptions!["es-ES"]})`,
    });
    expect(JSON.stringify(document.result.lines)).not.toContain("Staff meat");
    const text = pageTexts(document).join("\n");
    expect(text).toContain(receiptLabelsFor("es-ES").invoiceHeading);
    expect(text).toContain(receiptLabelsFor("es-ES").totalWithVatColumn);
    expect(text).not.toContain(receiptLabelsFor("en-GB").totalWithVatColumn);
  });

  it("keeps the filed issuer, customer and issue-day facts after taxpayer and trim changes", async () => {
    const sale = await issue(venue.backend);
    const before = await read(venue.backend, sale.saleId);
    const [taxpayerRow] = await suite.db.select().from(taxpayer);
    try {
      await suite.db.update(taxpayer).set({
        legalName: "Changed issuer",
        taxId: "B87654321",
        taxpayerDomicile: "Changed domicile",
      });

      const after = await read(venue.backend, sale.saleId);
      expect(after.result).toEqual(before.result);
      expect(after.issuer).toEqual({
        venueName: "Ajustes SL",
        nif: "62000003F",
        domicile: "Saved domicile",
      });
      expect(after.receipt).toEqual({});
      expect(after.result.qr).toContain("nif=62000003F");
      expect(after.result.qrText).toEqual({ caption: "QR tributario:", legend: "VERI*FACTU" });
      const content = pageTexts(after);
      expect(content).toContain("Saved domicile");
      expect(content.join("\n")).not.toContain("Changed issuer");
    } finally {
      await suite.db.update(taxpayer).set({
        legalName: taxpayerRow!.legalName,
        taxId: taxpayerRow!.taxId,
        taxpayerDomicile: taxpayerRow!.taxpayerDomicile,
      });
    }
  });

  it("types a replacement of a full invoice R4, naming the invoice it replaces in full", async () => {
    const sale = await issue(venue.backend);
    const replacement = await withTransaction(suite.db, (tx) =>
      insertCorrective(tx, sale.saleId, { replaces: true }),
    );
    const original = await read(venue.backend, sale.saleId);
    const document = await withTransaction(suite.db, (tx) =>
      readCustomerInvoiceDocument(venue.backend, tx, venue.cfg, replacement),
    );
    expect(document.result.invoiceType).toBe("R4");
    expect(document.result.recipient).toEqual(original.result.recipient);
    expect(document.result.corrects).toEqual({
      invoiceNumber: original.result.invoiceNumber,
      issuedAt: original.result.issuedAt,
      issuedOffsetMinutes: 120,
      inFull: true,
    });
  });

  it("replays a paid discounted bill with its saved grouping and payment", async () => {
    const { billId } = await billWith(venue, [
      { name: "Burger" },
      { name: "Ham", quantity: "0.250" },
    ]);
    const dishId = await lineIdOf(venue, billId, 1);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ openedAt: "2026-10-06T10:00:00Z" })
        .where(eq(workingOrders.id, billId));
      const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
      await applyAdjustment(
        tx,
        venue.cfg,
        {
          admission: testTradingAdmission(),
          expectedEdit: await readBillEditState(tx, billId),
          orderId: billId,
          submissionId: randomUUID(),
          expectedRevision: order!.revision,
          lineId: dishId,
          reasonId: venue.reasonId.house,
          action: "discount_percent",
          percentBp: 1000,
          note: null,
          operatorId: venue.supervisorId,
        },
        venue.venueLocale,
      );
    });
    const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    await setOrderInvoiceChoice(suite.db, venue.backend, venue.cfg, billId, {
      revision: order!.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Bill customer",
        countryCode: "ES",
        address: "2 Main Street, 28013 Madrid, Madrid",
      },
    });
    const saleId = await withTransaction(suite.db, async (tx) => {
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: "invoice-document-paid",
          kind: "contribution",
          method: "cash",
          applied: 1680,
          tendered: 2000,
          state: "pending",
          requestedBy: venue.supervisorId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
        })
        .returning();
      await completeBillPayment(
        tx,
        { ...venue, admission: testTradingAdmission() },
        venue.cfg,
        payment!.id,
        new Date(),
      );
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      return sale!.id;
    });
    const document = await read(venue.backend, saleId);
    expect(document.result).toMatchObject({
      orderNumber: order!.orderNumber,
      total: "16.80",
      lines: [
        {
          descriptions: { "es-ES": "Beef burger" },
          quantity: "1",
          gross: "10.80",
          listGross: "12.00",
          net: {
            unitPrice: "9.82",
            priceQuantity: "1.000",
            base: "9.82",
            tax: "0.98",
            rate: "10.00",
          },
          adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.20" }],
        },
        {
          descriptions: { "es-ES": "Iberian ham" },
          quantity: "0.25",
          gross: "6.00",
          net: {
            unitPrice: "21.82",
            priceQuantity: "1.000",
            base: "5.45",
            tax: "0.55",
            rate: "10.00",
          },
        },
      ],
      tender: { method: "cash", change: "3.20" },
      payments: [
        {
          method: "cash",
          amount: "16.80",
          tip: "0.00",
          tendered: "20.00",
          change: "3.20",
          refunds: [],
        },
      ],
    });
    expect(document.result.lines[0]).toHaveProperty("soldInEach", true);
    expect(document.result.lines[1]!.unitName).not.toBeNull();
    expect(document.result.lines[1]).not.toHaveProperty("soldInEach");
    const [saved] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    expect(document.result.orderLabel).toBe(saved!.label);
    expect(document.receiptHeader).toMatchObject({
      tradingName: "Dining room",
      printTradingName: true,
    });
    expect(document.simulated).toBe(venue.cfg.practiceMode);
  });

  it.each(["cash", "card"] as const)(
    "reads a %s settlement without a working order",
    async (method) => {
      const backend = none();
      const sale = await issue(backend);
      await withTransaction(suite.db, (tx) =>
        settleSale(tx, {
          saleId: sale.saleId,
          tenders: [
            {
              method,
              amount: method === "cash" ? "7.58" : "8.00",
              tipAmount: method === "cash" ? "0.00" : "0.42",
              ...(method === "cash" ? { cashTendered: "10.00" } : {}),
              settledAt: new Date(),
            },
          ],
        }),
      );
      const document = await read(backend, sale.saleId);
      expect(document.result.tender).toEqual(
        method === "cash"
          ? { method: "cash", change: "2.42" }
          : { method: "card", charged: "8.00", tip: "0.42", reference: null },
      );
      expect(document.result.total).toBe("7.58");
      expect(document.result).not.toHaveProperty("operationDate");
    },
  );

  it("uses the saved net facts when issuance recorded no line gross", async () => {
    const backend = none();
    const [series] = await suite.db
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.purpose, "full"));
    const sale = await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, {
        operationDescription: "Restaurante",
        origin: jobOrigin("operator_script"),
        nodeId: venue.cfg.nodeId,
        seriesId: seriesId(series!.id),
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        total: "1.00",
        clock,
        lines: [
          {
            lineNo: 1,
            name: "Staff name",
            descriptions: { "es-ES": "Nombre guardado" },
            quantity: "1",
            unitPrice: "1.00",
            vatRate: "0",
            lineTotal: "1.00",
          },
        ],
        settlement: { kind: "deferred" },
        counterparty: { taxId: "B12345674", legalName: "Saved customer", countryCode: "ES" },
        recipientAddress: "Saved address",
      }),
    );
    const document = await read(backend, sale.saleId);
    expect(document.result.lines).toEqual([
      {
        descriptions: { "es-ES": "Nombre guardado" },
        optionSnapshots: [],
        quantity: "1",
        unitName: null,
        unitPrecision: null,
        gross: "1.00",
        vatRate: "0.00",
        parentLineNo: null,
        net: { unitPrice: "1.00", priceQuantity: "1.000", base: "1.00", rate: "0.00" },
      },
    ]);
    expect(document.result.vatBreakdown).toEqual([{ rate: "0", base: "1.00", tax: "0.00" }]);
  });

  it("refuses a simplified invoice and an unknown sale without creating a document", async () => {
    const backend = none();
    const sale = await issue(backend, false);
    await expect(read(backend, sale.saleId)).rejects.toMatchObject({
      code: "invoice_delivery.full_invoice_required",
    });
    await expect(read(backend, randomUUID())).rejects.toMatchObject({
      code: "invoice_delivery.not_found",
    });
  });

  it("refuses a replacement of a full invoice, which names the customer but is a corrective", async () => {
    const sale = await issue(venue.backend);
    const replacement = await withTransaction(suite.db, (tx) =>
      insertCorrective(tx, sale.saleId, { replaces: true }),
    );
    await expect(read(venue.backend, replacement)).rejects.toMatchObject({
      code: "invoice_delivery.full_invoice_required",
    });
  });
  it("projects a simplified receipt for email without enabling its full-invoice document", async () => {
    const backend = none();
    const sale = await issue(backend, false);
    const document = await withTransaction(suite.db, (tx) =>
      readReceiptEmailDocument(backend, tx, venue.cfg, sale.saleId),
    );
    expect(document.result).toMatchObject({
      invoiceType: "F2",
      total: "7.58",
      issuedAt: "2026-10-06T22:34:00.000Z",
      issuedOffsetMinutes: 120,
      vatBreakdown: [
        { rate: "21", base: "5.00", tax: "1.05" },
        { rate: "10", base: "1.39", tax: "0.14" },
      ],
    });
    expect(document.result.recipient).toBeUndefined();
    expect(document.result.lines).toHaveLength(2);
    await expect(read(backend, sale.saleId)).rejects.toMatchObject({
      code: "invoice_delivery.full_invoice_required",
    });
  });
});

describe("current department A4 document", () => {
  it("composes a disabled recorded department with live defaults and skips the current address read", async () => {
    const backend = none();
    const [department] = await suite.db
      .insert(departments)
      .values({
        name: "A4 dining",
        tradingName: "Now renamed",
        active: false,
      })
      .returning();
    const issued = await issue(backend, true, "es-ES", {
      departmentId: department!.id,
      tradingName: "Recorded dining",
      printsTradingName: true,
    });

    {
      await seedDepartmentReceipt(suite.db, department!.id, {
        headerSubtitle: { "es-ES": "Department subtitle" },
        phone: "+34911234567",
        email: "dining@example.com",
      });
      await seedVenueSettings(suite.db, {
        addressLine1: "Current street differs from filed domicile",
      });
      const session = (
        suite.db as unknown as { session: { prepareQuery: (...args: unknown[]) => unknown } }
      ).session;
      const originalPrepare = session.prepareQuery.bind(session);
      const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
        const query = args[0] as { sql: string };
        if (query.sql.startsWith("select") && query.sql.includes('"address_line1"'))
          throw new Error("A4 current address read");
        return originalPrepare(...args);
      });
      let document;
      try {
        document = await read(backend, issued.saleId);
      } finally {
        spy.mockRestore();
      }
      expect(document.venueAddress).toEqual([]);
      expect(document.issuer.domicile).toBe("Saved domicile");
      expect(document.receiptHeader).toMatchObject({
        tradingName: "Recorded dining",
        printTradingName: true,
      });
      expect(document.receipt).toEqual({
        headerSubtitle: "Department subtitle",
        phone: "+34911234567",
        email: "dining@example.com",
      });
      expect(document.logo).toBeNull();
      await suite.db
        .update(departments)
        .set({ receiptText: { footerMessage: { "es-ES": "Changed footer" } } })
        .where(eq(departments.id, department!.id));
      const reprint = await read(backend, issued.saleId);
      expect(reprint.receipt).toEqual({ footerMessage: "Changed footer" });
      expect(reprint.receipt.phone).toBeUndefined();
      expect(reprint.receipt.email).toBeUndefined();
    }
  });
});

describe("A4 current optional source matrix", () => {
  it.each([true, false, undefined])(
    "ignores venue defaults and keeps filed domicile with printAddress %s",
    async () => {
      const backend = none();
      const issued = await issue(backend);

      {
        const document = await read(backend, issued.saleId);
        expect(document.venueAddress).toEqual([]);
        expect(document.receiptHeader).toBeUndefined();
        expect(document.receipt).toEqual({});
        const text = pageTexts(document).join("\n");
        expect(text).toContain("Saved domicile");
        expect(text).not.toContain("Current street differs");
      }
    },
  );
  it("selects an explicit department picture and never substitutes a global picture for a corrupt explicit one", async () => {
    const backend = none();
    const [department] = await suite.db
      .insert(departments)
      .values({ name: "A4 explicit", tradingName: "A4 explicit" })
      .returning();
    const issued = await issue(backend, true, "es-ES", {
      departmentId: department!.id,
      tradingName: "Saved explicit",
      printsTradingName: true,
    });

    const own = { logo: `${"c".repeat(64)}.png` };
    await seedPhotoMetadata(suite.db, { filename: own.logo, names: {} });
    {
      await seedDepartmentReceipt(suite.db, department!.id, own, {
        "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
        "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
      });
      expect(await read(backend, issued.saleId)).toMatchObject({
        logo: { bits: new Uint8Array([64]) },
      });
      await suite.db
        .update(departments)
        .set({
          receiptLogoRasters: {
            "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
            "80mm": { widthDots: 8, heightDots: 1, data: "broken" },
          },
        })
        .where(eq(departments.id, department!.id));
      expect((await read(backend, issued.saleId)).logo).toBeNull();
      await suite.db
        .update(departments)
        .set({ receiptText: {}, receiptLogoRasters: null })
        .where(eq(departments.id, department!.id));
      expect((await read(backend, issued.saleId)).logo).toBeNull();
    }
  });
  it("resolves only the printed and current department languages", async () => {
    const backend = none();
    const [department] = await suite.db
      .insert(departments)
      .values({ name: "A4 language", tradingName: "A4 language" })
      .returning();
    const issued = await issue(backend, true, "ca-ES", {
      departmentId: department!.id,
      tradingName: "Saved language",
      printsTradingName: true,
    });

    {
      await seedDepartmentReceipt(suite.db, department!.id, {
        headerSubtitle: { "ca-ES": "Bon dia", "es-ES": "Buenos días" },
        footerMessage: { "es-ES": "Gracias", "gl-ES": "Never third language" },
      });
      const document = await read(backend, issued.saleId);
      expect(document.invoiceLocale).toBe("ca-ES");
      expect(document.receipt).toEqual({ headerSubtitle: "Bon dia", footerMessage: "Gracias" });
      await suite.db
        .update(departments)
        .set({
          receiptText: {
            headerSubtitle: { "es-ES": "Buenos días" },
            footerMessage: { "gl-ES": "Never third language" },
          },
        })
        .where(eq(departments.id, department!.id));
      expect((await read(backend, issued.saleId)).receipt).toEqual({
        headerSubtitle: "Buenos días",
      });
    }
  });
});

describe("A4 recorded null department", () => {
  it("prints no optional decoration or stray trading name in an explicit null header", async () => {
    const backend = none();
    const issued = await issue(backend, true, "es-ES", {
      departmentId: null,
      tradingName: "Stray department name",
      printsTradingName: true,
    });
    const document = await read(backend, issued.saleId);
    expect(document.receiptHeader).toBeUndefined();
    expect(document.venueAddress).toEqual([]);
    const text = pageTexts(document).join("\n");
    expect(text).not.toContain("Stray department name");
    expect(text).toContain("Saved domicile");
  });
});

describe("A4 filed language outside the current pack choices", () => {
  it.each(["en-GB", "fr-FR"])("retains filed %s department text", async (printed) => {
    const backend = none();
    const [department] = await suite.db
      .insert(departments)
      .values({
        name: `Filed ${printed}`,
        tradingName: "Filed language",
      })
      .returning();
    const issued = await issue(backend, true, printed, {
      departmentId: department!.id,
      tradingName: "Saved language",
      printsTradingName: true,
    });
    await seedDepartmentReceipt(suite.db, department!.id, {
      headerSubtitle: { [printed]: "Printed subtitle", "es-ES": "Current subtitle" },
      footerMessage: { [printed]: "Printed footer", "es-ES": "Current footer" },
    });
    const { doc: venueDoc } = await readVenueSettings(suite.db);
    try {
      await seedVenueSettings(suite.db, { invoiceLocales: ["es-ES"] });
      const document = await read(backend, issued.saleId);
      expect(document.receipt).toEqual({
        headerSubtitle: "Printed subtitle",
        footerMessage: "Printed footer",
      });
      expect(document.invoiceLocale).toBe(printed);
    } finally {
      await seedVenueSettings(suite.db, { invoiceLocales: venueDoc.invoiceLocales });
    }
  });
});

describe("A4 invoice of a sale filed in a chosen receipt language", () => {
  it("prints Spanish fixed words and looks the goods up under the sale's first receipt language", async () => {
    const backend = none();
    const { saleId } = await withTransaction(suite.db, async (tx) => {
      const [series] = await tx
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.purpose, "full"));
      return recordSale(tx, backend, {
        operationDescription: "Restaurante",
        origin: jobOrigin("operator_script"),
        nodeId: venue.cfg.nodeId,
        seriesId: seriesId(series!.id),
        locale: "es-ES",
        invoiceLocales: ["ca-ES", "es-ES"],
        clock,
        total: "4.00",
        vatBreakdown: [{ rate: decimal("10"), base: decimal("3.64"), tax: decimal("0.36") }],
        lines: [
          {
            lineNo: 1,
            name: "STAFF Torrada",
            descriptions: { "ca-ES": "CA Torrada", "es-ES": "ES Tostada" },
            quantity: "2",
            unitName: { "ca-ES": "CA-rac", "es-ES": "ES-rac" },
            unitPrecision: 0,
            unitPrice: "1.82",
            vatRate: "10",
            lineTotal: "3.64",
            lineGross: "4.00",
            optionSnapshots: [
              {
                listName: { es: "STAFF Pa" },
                listCustomerName: { "ca-ES": "CA Tipus de pa", "es-ES": "ES Tipo de pan" },
                listKitchenName: "KITCHEN Pa",
                labelName: { es: "STAFF Segol" },
                labelCustomerName: { "ca-ES": "CA Sègol", "es-ES": "ES Centeno" },
                labelKitchenName: "KITCHEN Segol",
              },
            ],
          },
        ],
        settlement: { kind: "deferred" },
        counterparty: { taxId: "B12345674", legalName: "Saved customer", countryCode: "ES" },
        recipientAddress: "Saved customer address",
      });
    });

    const document = await read(backend, saleId);

    expect(document.invoiceLocale).toBe("es-ES");
    expect(document.namesLocale).toBe("ca-ES");
    expect(document.result.locale).toBe("es-ES");
    expect(document.result.namesLocale).toBe("ca-ES");
    const labels = receiptLabelsFor("es-ES");
    const lines = pageTexts(document);
    const text = lines.join("\n");
    expect(lines).not.toContain(labels.order);
    expect(lines).toContain(labels.date);
    expect(text).not.toContain("Comanda");
    expect(text).not.toContain("Data");
    const dish = lines.indexOf("CA Torrada");
    expect(lines.slice(dish, dish + 2)).toEqual(["CA Torrada", "2 CA-rac"]);
    expect(text).toContain("CA Tipus de pa: CA Sègol");
    for (const other of ["ES Tostada", "ES-rac", "ES Tipo de pan", "ES Centeno"]) {
      expect(text, other).not.toContain(other);
    }
  });
});

describe("A4 department-only decoration", () => {
  it("reads no global receipt table and retains the recorded department after deactivation", async () => {
    const backend = none();
    const [department] = await suite.db
      .insert(departments)
      .values({
        name: "A4 isolated",
        tradingName: "Mutable trading name",
      })
      .returning();
    const issued = await issue(backend, true, "es-ES", {
      departmentId: department!.id,
      tradingName: "Recorded brand",
      printsTradingName: true,
    });
    await seedPhotoMetadata(suite.db, { filename: `${"d".repeat(64)}.png`, names: {} });
    await seedDepartmentReceipt(
      suite.db,
      department!.id,
      {
        printAddress: true,
        operationDescription: "Never printed description",
        headerSubtitle: { "es-ES": "Own subtitle" },
        footerMessage: { "es-ES": "Own footer" },
        logo: `${"d".repeat(64)}.png`,
      },
      {
        "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
        "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
      },
    );
    const before = await read(backend, issued.saleId);

    {
      await suite.db
        .update(departments)
        .set({ active: false, tradingName: "Changed brand" })
        .where(eq(departments.id, department!.id));
      const document = await read(backend, issued.saleId);
      expect(document.result).toEqual(before.result);
      expect(document.receipt).toEqual({
        headerSubtitle: "Own subtitle",
        footerMessage: "Own footer",
        logo: `${"d".repeat(64)}.png`,
      });
      expect(document.logo).toEqual({ widthDots: 8, heightDots: 1, bits: new Uint8Array([64]) });
      expect(document.receiptHeader).toEqual({
        departmentId: department!.id,
        tradingName: "Recorded brand",
        printTradingName: true,
      });
      expect(document.venueAddress).toEqual([]);
      const text = pageTexts(document).join("\n");
      expect(text).toContain("Own subtitle");
      expect(text).toContain("Own footer");
      expect(text).not.toContain("Never printed description");
    }
  });
});

describe("the guests a full invoice prints", () => {
  /** A paid full invoice for one Burger, on a bill whose party was seated with `guests`, or with no count. */
  async function paidFullInvoice(guests: number | null): Promise<string> {
    const { partyId, billId } = await billWith(venue, [{ name: "Burger" }]);
    if (guests !== null) {
      await suite.db.update(parties).set({ guestCount: guests }).where(eq(parties.id, partyId));
    }
    const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    await setOrderInvoiceChoice(suite.db, venue.backend, venue.cfg, billId, {
      revision: order!.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Bill customer",
        countryCode: "ES",
        address: "2 Main Street, 28013 Madrid, Madrid",
      },
    });
    return withTransaction(suite.db, async (tx) => {
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: `invoice-document-guests-${billId}`,
          kind: "contribution",
          method: "cash",
          applied: 1200,
          tendered: 1200,
          state: "pending",
          requestedBy: venue.supervisorId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
        })
        .returning();
      await completeBillPayment(
        tx,
        { ...venue, admission: testTradingAdmission() },
        venue.cfg,
        payment!.id,
        new Date(),
      );
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      return sale!.id;
    });
  }

  it("reads the guests of the bill's party", async () => {
    const document = await read(venue.backend, await paidFullInvoice(4));
    expect(document.guests).toBe(4);
  });

  it("reads no guests for a party seated with no count", async () => {
    const document = await read(venue.backend, await paidFullInvoice(null));
    expect(document).not.toHaveProperty("guests");
  });
});

describe("the theme's logo on the A4 invoice", () => {
  const THEME_80MM = { widthDots: 16, heightDots: 1, bits: new Uint8Array([0xf0, 0x0f]) };

  async function department(): Promise<string> {
    const [row] = await suite.db
      .insert(departments)
      .values({
        name: `A4 logo ${randomUUID()}`,
        tradingName: "A4 dining",
      })
      .returning({ id: departments.id });
    return row!.id;
  }

  async function saleIn(backend: FiscalBackend, departmentId: string | null): Promise<string> {
    const issued = await issue(backend, true, "es-ES", {
      departmentId,
      tradingName: "Recorded dining",
      printsTradingName: true,
    });
    return issued.saleId;
  }

  async function ownLogo(departmentId: string): Promise<void> {
    await seedPhotoMetadata(suite.db, { filename: `${"b".repeat(64)}.png`, names: {} });
    await seedDepartmentReceipt(
      suite.db,
      departmentId,
      { logo: `${"b".repeat(64)}.png` },
      {
        "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
        "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
      },
    );
  }

  /** `resolveReceiptTrim` keeps the logo's name; the document input's type does not name it. */
  function trimLogo(document: Awaited<ReturnType<typeof read>>): string | undefined {
    return (document.receipt as PrintedReceiptTrim).logo;
  }

  function printedOf(document: Awaited<ReturnType<typeof read>>): string[] {
    return pageTexts(document);
  }

  it("a department with no receipt logo prints the theme's 80 mm logo, and its trim names it", async () => {
    const backend = none();
    const saleId = await saleIn(backend, await department());
    await putThemeInUse(suite.db);
    try {
      const document = await read(backend, saleId);
      expect(document.logo).toEqual(THEME_80MM);
      expect(trimLogo(document)).toBe(THEME_LOGO);
    } finally {
      await clearThemes(suite.db);
    }
  });

  it("a department's own receipt logo wins", async () => {
    const backend = none();
    const departmentId = await department();
    await ownLogo(departmentId);
    const saleId = await saleIn(backend, departmentId);
    await putThemeInUse(suite.db);
    try {
      const document = await read(backend, saleId);
      expect(document.logo).toEqual({ widthDots: 8, heightDots: 1, bits: new Uint8Array([64]) });
      expect(trimLogo(document)).toBe(`${"b".repeat(64)}.png`);
    } finally {
      await clearThemes(suite.db);
    }
  });

  it("a sale with no department prints the theme's logo", async () => {
    const backend = none();
    const saleId = await saleIn(backend, null);
    await putThemeInUse(suite.db);
    try {
      const document = await read(backend, saleId);
      expect(document.logo).toEqual(THEME_80MM);
      expect(trimLogo(document)).toBe(THEME_LOGO);
    } finally {
      await clearThemes(suite.db);
    }
  });

  it("a sale with no receipt header prints the theme's logo", async () => {
    const backend = none();
    const { saleId } = await issue(backend);
    await putThemeInUse(suite.db);
    try {
      const document = await read(backend, saleId);
      expect(document.logo).toEqual(THEME_80MM);
      expect(trimLogo(document)).toBe(THEME_LOGO);
    } finally {
      await clearThemes(suite.db);
    }
  });

  it("no theme in use prints none", async () => {
    const backend = none();
    await clearThemes(suite.db);
    const saleId = await saleIn(backend, await department());
    const document = await read(backend, saleId);
    expect(document.logo).toBeNull();
    expect(trimLogo(document)).toBeUndefined();
  });

  async function expectNoLogoOnceUntrusted(
    untrusted: (typeof UNTRUSTED_CASES)[number],
    own: boolean,
  ): Promise<void> {
    const backend = none();
    const departmentId = await department();
    if (own) await ownLogo(departmentId);
    const saleId = await saleIn(backend, departmentId);
    const at = { departmentId };
    await putThemeInUse(suite.db);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const control = await read(backend, saleId);
      expect(control.logo).toEqual(
        own ? { widthDots: 8, heightDots: 1, bits: new Uint8Array([64]) } : THEME_80MM,
      );
      const invoiceNumber = control.result.invoiceNumber;
      expect(invoiceNumber).not.toBe("");
      await untrusted.apply(suite.db, at);
      let document;
      try {
        document = await read(backend, saleId);
      } finally {
        await untrusted.undo(suite.db, at);
      }
      expect(document.logo).toBeNull();
      expect(trimLogo(document)).toBeUndefined();
      expect(printedOf(document)).toContain(
        `${receiptLabelsFor(document.invoiceLocale).invoiceHeading} ${invoiceNumber}`,
      );
    } finally {
      warning.mockRestore();
      await clearThemes(suite.db);
    }
  }

  it.each(UNTRUSTED_CASES.map((c) => [c.name, c] as const))(
    "prints no logo when the department cannot be trusted: %s",
    async (_name, untrusted) => {
      await expectNoLogoOnceUntrusted(untrusted, false);
    },
  );

  it.each(UNTRUSTED_CASES.map((c) => [c.name, c] as const))(
    "a department's own logo prints until it cannot be trusted, then no logo prints: %s",
    async (_name, untrusted) => {
      await expectNoLogoOnceUntrusted(untrusted, true);
    },
  );

  it("the page draws the theme's dots at the right edge, above the department's trading name", async () => {
    const backend = none();
    const saleId = await saleIn(backend, await department());
    await putThemeInUse(suite.db);
    try {
      const [first] = layoutA4Invoice(await read(backend, saleId));
      const logos = first!.elements.filter((element) => element.kind === "logo");
      expect(logos).toHaveLength(1);
      const [logo] = logos;
      expect(logo).toMatchObject({ raster: THEME_80MM });
      expect(logo!.x + logo!.width).toBeCloseTo(INVOICE_PAGE_WIDTH - 36);
      const name = first!.elements.find(
        (element) => element.kind === "text" && element.text === "Recorded dining",
      );
      expect(name!.y).toBeGreaterThan(logo!.y);
    } finally {
      await clearThemes(suite.db);
    }
  });
});

describe("a takeaway sale's A4 invoice", () => {
  async function paidBill(dining: "eat_in" | "takeaway"): Promise<string> {
    await withTransaction(suite.db, async (tx) => {
      for (const { id } of await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.active, true)))
        await setDepartmentSalePolicyField(tx, id, "dining", dining);
    });
    const { billId } = await billWith(venue, [{ name: "Burger" }]);
    const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    await setOrderInvoiceChoice(suite.db, venue.backend, venue.cfg, billId, {
      revision: order!.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Bill customer",
        countryCode: "ES",
        address: "2 Main Street, 28013 Madrid, Madrid",
      },
    });
    return withTransaction(suite.db, async (tx) => {
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: `invoice-document-${dining}`,
          kind: "contribution",
          method: "cash",
          applied: 1200,
          tendered: 2000,
          state: "pending",
          requestedBy: venue.supervisorId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
        })
        .returning();
      await completeBillPayment(
        tx,
        { ...venue, admission: testTradingAdmission() },
        venue.cfg,
        payment!.id,
        new Date(),
      );
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      return sale!.id;
    });
  }
  const texts = pageTexts;

  // Fails if the A4 invoice of a takeaway sale stops saying so, or an eat-in one starts to.
  it("says Para llevar on a takeaway sale's invoice, and nothing on an eat-in one", async () => {
    const takeaway = await read(venue.backend, await paidBill("takeaway"));
    const eatIn = await read(venue.backend, await paidBill("eat_in"));
    expect(takeaway.result.takeAway).toBe(true);
    expect(texts(takeaway)).toContain("Para llevar");
    expect(eatIn.result).not.toHaveProperty("takeAway");
    expect(texts(eatIn)).not.toContain("Para llevar");
  });

  // Pins today's split, so changing it is deliberate: a replacement of a takeaway sale reads Take
  // away on the till's receipt through the original sale's order; its A4 page reads only the
  // replacement's own order link, which it has none of.
  async function replacementOfTakeaway(): Promise<string> {
    const original = await paidBill("takeaway");
    return withTransaction(suite.db, (tx) => insertCorrective(tx, original, { replaces: true }));
  }

  it("says Take away on a takeaway sale's replacement receipt on the till", async () => {
    const replacement = await replacementOfTakeaway();
    const receipt = await withTransaction(suite.db, (tx) =>
      readTransactionReceipt(venue.backend, tx, venue.cfg, replacement),
    );
    expect(receipt.takeAway).toBe(true);
  });

  it("does not say Take away on a takeaway sale's replacement A4 page", async () => {
    const replacement = await replacementOfTakeaway();
    const page = await withTransaction(suite.db, (tx) =>
      readCustomerInvoiceDocument(venue.backend, tx, venue.cfg, replacement),
    );
    expect(page.result.invoiceType).toBe("R4");
    expect(page.result).not.toHaveProperty("takeAway");
    expect(texts(page)).not.toContain("Para llevar");
  });
});

describe("a card payment on the A4 page", () => {
  it("the A4 page names the card", () => {
    const [page] = layoutA4Invoice({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      result: {
        ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
        tender: {
          method: "card",
          charged: "19.69",
          tip: "0.00",
          reference: null,
          card: { scheme: "VISA", last4: "4034", entryMode: "contactless", authCode: "354739" },
        },
      },
    });
    const labels = receiptLabelsFor("es-ES");
    const texts = page!.elements.flatMap((element) => (element.kind === "text" ? [element] : []));
    const heading = texts.find(({ text }) => text === labels.paymentMethodHeading)!;
    const footer = texts.filter(({ y }) => y > heading.y && y < heading.y + 20);
    expect(footer.map(({ text }) => text)).toEqual([
      [
        labels.paid,
        `Visa ****4034 (${labels.paymentContactless}) 19,69 €`,
        `${labels.paymentAuthorization} 354739`,
      ].join(CONTACT_SEPARATOR),
    ]);
  });
});

describe("what is still owed on the A4 page", () => {
  it("the A4 page prints Pendiente in bold after the payments, and no Pagado", () => {
    const [page] = layoutA4Invoice({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      result: {
        ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
        tender: { method: "unpaid" },
        payments: [
          {
            method: "cash",
            amount: "10.00",
            tip: "0.00",
            tendered: "10.00",
            change: "0.00",
            refunds: [],
          },
        ],
        owed: "9.69",
      },
    });
    const labels = receiptLabelsFor("es-ES");
    const texts = page!.elements.flatMap((element) => (element.kind === "text" ? [element] : []));
    const cash = texts.find(({ text }) => text === `${labels.cash} 10,00 €`)!;
    const owed = texts.find(({ text }) => text === `${labels.owed} 9,69 €`)!;
    expect(owed.y).toBeGreaterThan(cash.y);
    expect([cash.weight, owed.weight]).toEqual(["regular", "bold"]);
    expect(texts.some(({ text }) => text.startsWith(labels.paid))).toBe(false);
  });
});

describe("the simplified receipt's A4 tax table", () => {
  it("draws the simplified tax table on A4", () => {
    const [page] = layoutA4Invoice({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      result: {
        ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
        invoiceType: "F2",
        recipient: undefined,
        lines: FULL_INVOICE_DOCUMENT_FIXTURE.result.lines.map(({ net, ...line }) => ({
          ...line,
          vatRate: `${net!.rate}.00`,
        })),
      },
    });
    const labels = receiptLabelsFor("es-ES");
    const texts = page!.elements.flatMap((element) => (element.kind === "text" ? [element] : []));
    const right = (cell: (typeof texts)[number]): number =>
      cell.x + invoiceTextWidth(cell.text, cell.size, cell.weight);
    const heading = texts.find(({ text }) => text === labels.taxRateColumn)!;
    const firstRow = texts.find(({ text, y }) => y > heading.y && text === "A 21%")!;
    const headingLines = texts.filter(({ y }) => y >= heading.y && y < firstRow.y);
    const headings = headingLines.filter(({ y }) => y === heading.y);
    expect(
      headings.map((top) =>
        headingLines
          .filter((line) => Math.abs(right(line) - right(top)) < 0.01)
          .map(({ text }) => text)
          .join(" "),
      ),
    ).toEqual([
      labels.taxRateColumn,
      labels.vatSummaryBaseColumn,
      labels.vatSummaryAmountColumn,
      labels.taxTotalColumn,
    ]);
    expect(headingLines.every(({ weight, tone }) => weight === "regular" && tone === "muted")).toBe(
      true,
    );
    const rows = [
      ["A 21%", "9,00 €", "1,89 €", "10,89 €"],
      ["B 10%", "8,00 €", "0,80 €", "8,80 €"],
    ];
    for (const row of rows) {
      const first = texts.findIndex(({ text, y }) => y > heading.y && text === row[0]);
      const cells = texts.slice(first, first + 4);
      expect(cells.map(({ text }) => text)).toEqual(row);
      expect(new Set(cells.map(({ y }) => y)).size).toBe(1);
      for (const [index, cell] of cells.entries())
        expect(right(cell)).toBeCloseTo(right(headings[index]!));
    }
  });

  it.each(["en-GB", "es-ES", "ca-ES", "gl-ES", "eu-ES"])(
    "keeps a mixed-rate refund of 3,000 a rate inside the page, no cell over another (%s)",
    (invoiceLocale) => {
      const result = {
        ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
        invoiceType: "R5" as const,
        recipient: undefined,
        total: "-6000.00",
        vatBreakdown: [
          { rate: "10", base: "-2727.27", tax: "-272.73" },
          { rate: "21", base: "-2479.34", tax: "-520.66" },
        ],
        lines: FULL_INVOICE_DOCUMENT_FIXTURE.result.lines.map(({ net, ...line }) => ({
          ...line,
          quantity: "-1",
          gross: "-3000.00",
          vatRate: `${net!.rate}.00`,
        })),
      };
      const [page] = layoutA4Invoice({
        ...FULL_INVOICE_DOCUMENT_FIXTURE,
        result,
        invoiceLocale,
      });
      const texts = page!.elements.flatMap((element) => (element.kind === "text" ? [element] : []));
      const right = (cell: (typeof texts)[number]): number =>
        cell.x + invoiceTextWidth(cell.text, cell.size, cell.weight);
      const heading = texts.find(
        ({ text }) => text === receiptLabelsFor(invoiceLocale).taxRateColumn,
      )!;
      const below = [...new Set(texts.map(({ y }) => y))]
        .filter((y) => y >= heading.y)
        .sort((first, second) => first - second);
      const amounts = ["-2727.27", "-272.73", "-2479.34", "-520.66", "-3000.00"].map((amount) =>
        formatMoney(amount, invoiceLocale),
      );
      const isHeading = (y: number) =>
        texts.some((cell) => cell.y === y && cell.size === heading.size);
      const headingLines = below.slice(
        0,
        below.findIndex((y) => !isHeading(y)),
      );
      const rateRows = below.slice(headingLines.length, headingLines.length + 2);
      const table = texts.filter(({ y }) => rateRows.includes(y));
      for (const amount of amounts) expect(table.map(({ text }) => text)).toContain(amount);
      for (const y of [...headingLines, ...rateRows]) {
        const cells = texts.filter((cell) => cell.y === y);
        if (y === heading.y || rateRows.includes(y)) expect(cells).toHaveLength(4);
        expect(cells[0]!.x).toBeGreaterThanOrEqual(36);
        for (let at = 1; at < cells.length; at++)
          expect(cells[at]!.x).toBeGreaterThan(right(cells[at - 1]!));
        expect(right(cells.at(-1)!)).toBeLessThanOrEqual(INVOICE_PAGE_WIDTH - 36 + 0.01);
      }
    },
  );
});

it.each(["sumup", "simulator"] as const)(
  "splits marks on a saved %s Prepare invoice",
  async (provider) => {
    const backend = none();
    const sale = await issue(backend);
    const order = await seedWorkingOrder(suite.db);
    await suite.db.insert(payments).values({
      workingOrderId: order.id,
      source: "readiness_test",
      saleId: sale.saleId,
      provider,
      state: "captured",
      paymentRef: randomUUID(),
      amount: 758,
    });
    const document = await withTransaction(suite.db, (tx) =>
      readInvoiceDocument(backend, tx, { ...venue.cfg, practiceMode: true }, sale.saleId),
    );
    const ticket = await withTransaction(suite.db, (tx) =>
      readTransactionReceipt(backend, tx, { ...venue.cfg, practiceMode: true }, sale.saleId),
    );
    expect(ticket.simulatedCardPayment).toBe(provider === "simulator");
    expect(document.simulated).toBe(true);
    expect(pageTexts(document).includes("SIN COBRO REAL")).toBe(provider === "simulator");
    expect(pageTexts(document)).toContain("DOCUMENTO DE PRUEBA");
  },
);

// A445 D3a and D3b: a free item on a takeaway ticket mixing VAT rates files its share of the price
// paid (salad €10.00 at 4% files 8.33, the comped water €2.00 at 21% files 1.67).
describe("a free item holding its share of the price paid", () => {
  /** The water comped beside a €10.00 salad, or with `also`: the €9.00 pizza in its place, a
   *  percentage off it, a percentage off the whole bill and the price paid in cents. */
  async function comped(
    dining: "takeaway" | "here",
    full: boolean,
    also: { dish?: "Salad" | "Pizza"; dishOffBp?: number; billOffBp?: number; paid?: number } = {},
  ): Promise<string> {
    const dish = also.dish ?? "Salad";
    if (dining === "takeaway")
      await takeawayRates(venue, { [dish]: dish === "Salad" ? "4.00" : "10.00", Water: "21.00" });
    const { billId } = await billWith(
      venue,
      [{ name: dish }, { name: "Water" }],
      dining === "takeaway" ? { dining: "takeaway" } : {},
    );
    const dishId = await lineIdOf(venue, billId, 1);
    const waterId = await lineIdOf(venue, billId, 2);
    const adjust = (ask: {
      lineId: string | null;
      action: "comp" | "discount_percent";
      percentBp?: number;
    }) =>
      withTransaction(suite.db, async (tx) => {
        const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
        await applyAdjustment(
          tx,
          venue.cfg,
          {
            admission: testTradingAdmission(),
            expectedEdit: await readBillEditState(tx, billId),
            orderId: billId,
            submissionId: randomUUID(),
            expectedRevision: order!.revision,
            reasonId: venue.reasonId.house,
            note: null,
            operatorId: venue.supervisorId,
            ...ask,
          },
          venue.venueLocale,
        );
      });
    await adjust({ lineId: waterId, action: "comp" });
    if (also.dishOffBp !== undefined)
      await adjust({ lineId: dishId, action: "discount_percent", percentBp: also.dishOffBp });
    if (also.billOffBp !== undefined)
      await adjust({ lineId: null, action: "discount_percent", percentBp: also.billOffBp });
    if (full) {
      const [order] = await suite.db
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, billId));
      await setOrderInvoiceChoice(suite.db, venue.backend, venue.cfg, billId, {
        revision: order!.revision,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Bill customer",
          countryCode: "ES",
          address: "2 Main Street, 28013 Madrid, Madrid",
        },
      });
    }
    return withTransaction(suite.db, async (tx) => {
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: `invoice-document-free-${dining}-${full}-${randomUUID()}`,
          kind: "contribution",
          method: "cash",
          applied: also.paid ?? 1000,
          tendered: also.paid ?? 1000,
          state: "pending",
          requestedBy: venue.supervisorId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
        })
        .returning();
      await completeBillPayment(
        tx,
        { ...venue, admission: testTradingAdmission() },
        venue.cfg,
        payment!.id,
        new Date(),
      );
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      return sale!.id;
    });
  }
  const shown = (lines: readonly TillSaleLine[]) =>
    lines.map((line) => ({
      gross: line.gross,
      listGross: line.listGross,
      adjustments: line.adjustments?.map(({ kind, amount }) => ({ kind, amount })),
    }));
  const SOLD = [
    { gross: "8.33", listGross: "10.00", adjustments: undefined },
    { gross: "1.67", listGross: "2.00", adjustments: [{ kind: "comp", amount: "2.00" }] },
  ];

  // Fails if Find a bill's reprint drops the filed list price: it then prints 8.33 and 1.67, no comp.
  it("Find a bill reprints the dishes as sold, with the comp beneath the water", async () => {
    const saleId = await comped("takeaway", false);
    const receipt = await withTransaction(suite.db, (tx) =>
      readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
    );
    expect(shown(receipt.lines)).toEqual(SOLD);
  });

  it("the A4 page of the simplified ticket shows the dishes as sold, with the comp", async () => {
    const saleId = await comped("takeaway", false);
    const document = await withTransaction(suite.db, (tx) =>
      readReceiptEmailDocument(venue.backend, tx, venue.cfg, saleId),
    );
    expect(shown(document.result.lines)).toEqual(SOLD);
  });

  it("a comped ticket eaten here reprints with its comp", async () => {
    const saleId = await comped("here", false);
    const receipt = await withTransaction(suite.db, (tx) =>
      readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
    );
    expect(shown(receipt.lines)).toEqual([
      { gross: "10.00", listGross: undefined, adjustments: undefined },
      { gross: "0.00", listGross: "2.00", adjustments: [{ kind: "comp", amount: "2.00" }] },
    ]);
  });

  // The full invoice's rows on the page: description, unit price and total before VAT, VAT rate.
  const tableRows = (document: ReceiptDocumentInput) =>
    pageRows(document).map(([item, , price, amount, rate]) => ({
      item,
      price: price!.replace(/ €$/u, ""),
      amount: amount!.replace(/ €$/u, ""),
      rate,
    }));
  const DISCOUNT = receiptLabelsFor("es-ES").discount;

  // D3b: each line comes to its filed base. The water's 0,27 is a bare discount like the salad's
  // 1,61: its comp's "100%" would contradict the amount.
  it("the full invoice's table comes to the filed bases, a discount under each dish", async () => {
    const saleId = await comped("takeaway", true);
    const document = await read(venue.backend, saleId);
    expect(tableRows(document)).toEqual([
      { item: "House salad", price: "9,62", amount: "9,62", rate: "4%" },
      { item: DISCOUNT, price: "", amount: "-1,61", rate: "4%" },
      { item: "Mineral water", price: "1,65", amount: "1,65", rate: "21%" },
      { item: DISCOUNT, price: "", amount: "-0,27", rate: "21%" },
    ]);
    expect(tableRows({ ...document, invoiceLocale: "en-GB" }).map(({ item }) => item)).toEqual([
      "House salad",
      receiptLabelsFor("en-GB").discount,
      "Mineral water",
      receiptLabelsFor("en-GB").discount,
    ]);
  });

  // A dish beside a free item that holds a share loses more than its own adjustment: it also carries
  // part of the free item's price. Its row names no percentage the amount does not match.
  it("a takeaway salad's 50% off prints as a bare discount when it also carries the water's share", async () => {
    const saleId = await comped("takeaway", true, { dishOffBp: 5000, paid: 500 });
    expect(tableRows(await read(venue.backend, saleId))).toEqual([
      { item: "House salad", price: "9,62", amount: "9,62", rate: "4%" },
      { item: DISCOUNT, price: "", amount: "-5,61", rate: "4%" },
      { item: "Mineral water", price: "1,65", amount: "1,65", rate: "21%" },
      { item: DISCOUNT, price: "", amount: "-0,96", rate: "21%" },
    ]);
  });

  it("a takeaway pizza's 10% off prints as a bare discount when it also carries the water's share", async () => {
    const saleId = await comped("takeaway", true, { dish: "Pizza", dishOffBp: 1000, paid: 810 });
    expect(tableRows(await read(venue.backend, saleId))).toEqual([
      { item: "Margherita pizza", price: "8,18", amount: "8,18", rate: "10%" },
      { item: DISCOUNT, price: "", amount: "-2,15", rate: "10%" },
      { item: "Mineral water", price: "1,65", amount: "1,65", rate: "21%" },
      { item: DISCOUNT, price: "", amount: "-0,44", rate: "21%" },
    ]);
  });

  it("10% off the bill prints as a bare discount at the end when the water holds a share", async () => {
    const saleId = await comped("takeaway", true, { billOffBp: 1000, paid: 900 });
    expect(tableRows(await read(venue.backend, saleId))).toEqual([
      { item: "House salad", price: "9,62", amount: "9,62", rate: "4%" },
      { item: "Mineral water", price: "1,65", amount: "1,65", rate: "21%" },
      { item: DISCOUNT, price: "", amount: "-0,41", rate: "21%" },
      { item: DISCOUNT, price: "", amount: "-2,41", rate: "4%" },
    ]);
  });

  it("a full invoice eaten here still names the water's comp, which takes off all of it", async () => {
    const saleId = await comped("here", true);
    const document = await read(venue.backend, saleId);
    expect(tableRows(document)).toEqual([
      { item: "House salad", price: "9,09", amount: "9,09", rate: "10%" },
      { item: "Mineral water", price: "1,82", amount: "1,82", rate: "10%" },
      { item: `${DISCOUNT} 100%`, price: "", amount: "-1,82", rate: "10%" },
    ]);
  });
});

describe("a correction's receipts", () => {
  // Salad €10.00 with 10% off and a water €2.00, eaten here and paid €11.00; then €3.00 given back,
  // corrected as `fileCorrectionIn` files it.
  async function corrected(): Promise<string> {
    const { billId } = await billWith(venue, [{ name: "Salad" }, { name: "Water" }]);
    const saladId = await lineIdOf(venue, billId, 1);
    return withTransaction(suite.db, async (tx) => {
      const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
      await applyAdjustment(
        tx,
        venue.cfg,
        {
          admission: testTradingAdmission(),
          expectedEdit: await readBillEditState(tx, billId),
          orderId: billId,
          submissionId: randomUUID(),
          expectedRevision: order!.revision,
          lineId: saladId,
          reasonId: venue.reasonId.house,
          action: "discount_percent",
          percentBp: 1000,
          note: null,
          operatorId: venue.supervisorId,
        },
        venue.venueLocale,
      );
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: "invoice-document-corrected",
          kind: "contribution",
          method: "cash",
          applied: 1100,
          tendered: 1100,
          state: "pending",
          requestedBy: venue.supervisorId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
        })
        .returning();
      await completeBillPayment(
        tx,
        { ...venue, admission: testTradingAdmission() },
        venue.cfg,
        payment!.id,
        new Date(),
      );
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      const original = brandSaleId(sale!.id);
      const preview = await previewCorrectionAmounts(
        tx,
        venue.backend,
        original,
        venue.cfg.nodeId,
        {
          gross: decimal("3.00"),
        },
      );
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.purpose, "corrective"));
      const session = await loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: venue.managerId,
        pin: PINS.manager,
      });
      const { saleId } = await recordCorrection(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: seriesId(series!.id),
        correctsSaleId: original,
        total: negateDecimal(preview.gross),
        lines: preview.lines,
        partialVatBreakdown: preview.vatBreakdown.map(({ rate, base, tax }) => ({
          rate,
          base: negateDecimal(base),
          tax: negateDecimal(tax),
        })),
        authz: { sessionId: session.id },
        clock: venue.clock,
      });
      return saleId;
    });
  }
  const shown = (lines: readonly TillSaleLine[]) =>
    lines.map((line) => ({
      gross: line.gross,
      listGross: line.listGross,
      adjustments: line.adjustments?.map(({ kind, amount }) => ({ kind, amount })),
    }));
  const FILED = [
    { gross: "-2.45", listGross: undefined, adjustments: undefined },
    { gross: "-0.55", listGross: undefined, adjustments: undefined },
  ];
  // The simplified page's rows: description, quantity, price and amount.
  const itemRows = (document: ReceiptDocumentInput) =>
    pageRows(document).map((cells) => cells.map((cell) => cell.replace(/ €$/u, "")));

  // Fails if the corrective's lines take the list prices they copied from the original: the page
  // then prints the salad at -10,00 and a discount row of 7,55 beneath it.
  it("the A4 page of a correction shows the filed figures and no discount", async () => {
    const saleId = await corrected();
    const document = await withTransaction(suite.db, (tx) =>
      readReceiptEmailDocument(venue.backend, tx, venue.cfg, saleId),
    );
    expect(shown(document.result.lines)).toEqual(FILED);
    expect(itemRows(document)).toEqual([
      ["House salad", "-1", "", "-2,45"],
      ["Mineral water", "-1", "", "-0,55"],
    ]);
  });

  it("Find a bill's reprint of a correction shows the filed figures and no discount", async () => {
    const saleId = await corrected();
    const receipt = await withTransaction(suite.db, (tx) =>
      readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
    );
    expect(shown(receipt.lines)).toEqual(FILED);
  });
});
