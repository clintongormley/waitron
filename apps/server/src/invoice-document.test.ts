import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  billPayments,
  invoiceSeries,
  locations,
  sales,
  tenants,
  tenantReceipts,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordSale, settleSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { decimal, jobOrigin, seriesId } from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import {
  billWith,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { applyAdjustment } from "./adjustments-apply.js";
import { setOrderInvoiceChoice } from "./working-order.js";
import { completeBillPayment } from "./bill-payments.js";
import { departments, departmentReceipts, saleReceiptHeaders } from "@waitron/venue-service";
import { buildReceiptDocument } from "./receipt-document.js";

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

  it("keeps the filed issuer, customer and issue-day facts after taxpayer and trim changes", async () => {
    const sale = await issue(venue.backend);
    const before = await read(venue.backend, sale.saleId);
    const [taxpayer] = await suite.db.select().from(tenants);
    try {
      await suite.db.update(tenants).set({
        legalName: "Changed issuer",
        taxId: "B87654321",
        taxpayerDomicile: "Changed domicile",
      });
      await suite.db
        .insert(tenantReceipts)
        .values({ receipt: { footerMessage: "Current footer", email: "current@example.test" } })
        .onConflictDoUpdate({
          target: tenantReceipts.id,
          set: { receipt: { footerMessage: "Current footer", email: "current@example.test" } },
        });
      const after = await read(venue.backend, sale.saleId);
      expect(after.result).toEqual(before.result);
      expect(after.issuer).toEqual({
        venueName: "Ajustes SL",
        nif: "62000003F",
        domicile: "Saved domicile",
      });
      expect(after.receipt).toMatchObject({
        footerMessage: "Current footer",
        email: "current@example.test",
      });
      expect(after.result.qr).toContain("nif=62000003F");
      expect(after.result.qrText).toEqual({ caption: "QR tributario:", legend: "VERI*FACTU" });
      const content = buildReceiptDocument(after);
      expect(content.elements).toContainEqual({ kind: "text", text: "Saved domicile", indent: 0 });
      expect(content.elements).not.toContainEqual({
        kind: "text",
        text: "Changed issuer",
        indent: 0,
      });
    } finally {
      await suite.db.update(tenants).set({
        legalName: taxpayer!.legalName,
        taxId: taxpayer!.taxId,
        taxpayerDomicile: taxpayer!.taxpayerDomicile,
      });
      await suite.db.delete(tenantReceipts);
    }
  });

  it("replays a paid discounted bill with its saved grouping, operation date and payment", async () => {
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
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
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
      await completeBillPayment(tx, venue, venue.cfg, payment!.id, new Date());
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      return sale!.id;
    });
    const document = await read(venue.backend, saleId);
    expect(document.result).toMatchObject({
      orderNumber: order!.orderNumber,
      operationDate: "2026-10-06",
      total: "16.80",
      lines: [
        {
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1",
          gross: "10.80",
          listGross: "12.00",
          net: {
            unitPrice: "8.93",
            priceQuantity: "1.000",
            base: "8.93",
            tax: "1.87",
            rate: "21.00",
          },
          adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.20" }],
        },
        {
          descriptions: { "es-ES": "Jamón ibérico" },
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
    const [saved] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    expect(document.result.orderLabel).toBe(saved!.label);
    expect(document.receiptHeader).toMatchObject({ tradingName: "Sala", printTradingName: true });
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
        parentLineNo: null,
        net: { unitPrice: "1.00", priceQuantity: "1.000", base: "1.00", rate: "0.00" },
      },
    ]);
    expect(document.result.vatBreakdown).toEqual([{ rate: "0", base: "1.00", tax: "0.00" }]);
  });

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
});

describe("current department A4 document", () => {
  it("composes a disabled recorded department with live defaults and skips the current address read", async () => {
    const backend = none();
    const issued = await issue(backend);
    const [department] = await suite.db
      .insert(departments)
      .values({
        locationId: venue.cfg.locationId,
        name: "A4 dining",
        tradingName: "Now renamed",
        active: false,
      })
      .returning();
    await suite.db.insert(saleReceiptHeaders).values({
      saleId: issued.saleId,
      departmentId: department!.id,
      tradingName: "Recorded dining",
      printTradingName: true,
    });
    const logo = `${"a".repeat(64)}.png`;
    const pair = {
      "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
      "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
    };
    const [original] = await suite.db.select().from(tenantReceipts);
    try {
      await suite.db
        .insert(tenantReceipts)
        .values({
          receipt: {
            logo,
            headerSubtitle: "Venue subtitle",
            footerMessage: "Venue footer",
            email: "venue@example.com",
            logoRasters: pair,
          },
        })
        .onConflictDoUpdate({
          target: tenantReceipts.id,
          set: {
            receipt: {
              logo,
              headerSubtitle: "Venue subtitle",
              footerMessage: "Venue footer",
              email: "venue@example.com",
              logoRasters: pair,
            },
          },
        });
      await suite.db.insert(departmentReceipts).values({
        departmentId: department!.id,
        receipt: {
          headerSubtitle: { "es-ES": "Department subtitle" },
          phone: "+34911234567",
          email: "dining@example.com",
        },
      });
      await suite.db
        .update(locations)
        .set({ addressLine1: "Current street differs from filed domicile" })
        .where(eq(locations.id, venue.cfg.locationId));
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
        footerMessage: "Venue footer",
        phone: "+34911234567",
        email: "dining@example.com",
        logo,
      });
      expect(document).toMatchObject({
        logo: { widthDots: 8, heightDots: 1, bits: new Uint8Array([64]) },
      });
      await suite.db
        .update(departmentReceipts)
        .set({ receipt: { footerMessage: { "es-ES": "Changed footer" } } })
        .where(eq(departmentReceipts.departmentId, department!.id));
      const reprint = await read(backend, issued.saleId);
      expect(reprint.receipt).toMatchObject({
        headerSubtitle: "Venue subtitle",
        footerMessage: "Changed footer",
      });
      expect(reprint.receipt.phone).toBeUndefined();
      expect(reprint.receipt.email).toBeUndefined();
    } finally {
      if (original) await suite.db.update(tenantReceipts).set({ receipt: original.receipt });
      else await suite.db.delete(tenantReceipts);
    }
  });
});

describe("A4 current optional source matrix", () => {
  it.each([true, false, undefined])(
    "keeps venue-only defaults and filed domicile with printAddress %s",
    async (printAddress) => {
      const backend = none();
      const issued = await issue(backend);
      const [previous] = await suite.db.select().from(tenantReceipts);
      try {
        const receipt = {
          headerSubtitle: "Venue only subtitle",
          footerMessage: "Venue only footer",
          email: "venue@example.com",
          printAddress,
        };
        await suite.db
          .insert(tenantReceipts)
          .values({ receipt })
          .onConflictDoUpdate({ target: tenantReceipts.id, set: { receipt } });
        const document = await read(backend, issued.saleId);
        expect(document.venueAddress).toEqual([]);
        expect(document.receiptHeader).toBeUndefined();
        expect(document.receipt).toEqual({
          headerSubtitle: "Venue only subtitle",
          footerMessage: "Venue only footer",
          email: "venue@example.com",
        });
        const text = buildReceiptDocument(document)
          .elements.flatMap((element) => (element.kind === "text" ? [element.text] : []))
          .join("\n");
        expect(text).toContain("Saved domicile");
        expect(text).not.toContain("Current street differs");
      } finally {
        if (previous) await suite.db.update(tenantReceipts).set({ receipt: previous.receipt });
        else await suite.db.delete(tenantReceipts);
      }
    },
  );
  it("selects an explicit department picture and never substitutes a global picture for a corrupt explicit one", async () => {
    const backend = none();
    const issued = await issue(backend);
    const [department] = await suite.db
      .insert(departments)
      .values({ locationId: venue.cfg.locationId, name: "A4 explicit", tradingName: "A4 explicit" })
      .returning();
    await suite.db.insert(saleReceiptHeaders).values({
      saleId: issued.saleId,
      departmentId: department!.id,
      tradingName: "Saved explicit",
      printTradingName: true,
    });
    const [previous] = await suite.db.select().from(tenantReceipts);
    const global = {
      logo: `${"b".repeat(64)}.png`,
      logoRasters: { "80mm": { widthDots: 8, heightDots: 1, data: "gA==" } },
    };
    const own = { logo: `${"c".repeat(64)}.png` };
    try {
      await suite.db
        .insert(tenantReceipts)
        .values({ receipt: global })
        .onConflictDoUpdate({ target: tenantReceipts.id, set: { receipt: global } });
      await suite.db.insert(departmentReceipts).values({
        departmentId: department!.id,
        receipt: own,
        logoRasters: {
          "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
          "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
        },
      });
      expect(await read(backend, issued.saleId)).toMatchObject({
        logo: { bits: new Uint8Array([64]) },
      });
      await suite.db
        .update(departmentReceipts)
        .set({
          logoRasters: {
            "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
            "80mm": { widthDots: 8, heightDots: 1, data: "broken" },
          },
        })
        .where(eq(departmentReceipts.departmentId, department!.id));
      expect((await read(backend, issued.saleId)).logo).toBeNull();
      await suite.db
        .update(departmentReceipts)
        .set({ receipt: {}, logoRasters: null })
        .where(eq(departmentReceipts.departmentId, department!.id));
      expect(await read(backend, issued.saleId)).toMatchObject({
        logo: { bits: new Uint8Array([128]) },
      });
    } finally {
      if (previous) await suite.db.update(tenantReceipts).set({ receipt: previous.receipt });
      else await suite.db.delete(tenantReceipts);
    }
  });
  it("resolves each department language candidate before a live venue default", async () => {
    const backend = none();
    const issued = await issue(backend, true, "ca-ES");
    const [department] = await suite.db
      .insert(departments)
      .values({ locationId: venue.cfg.locationId, name: "A4 language", tradingName: "A4 language" })
      .returning();
    await suite.db.insert(saleReceiptHeaders).values({
      saleId: issued.saleId,
      departmentId: department!.id,
      tradingName: "Saved language",
      printTradingName: true,
    });
    const [previous] = await suite.db.select().from(tenantReceipts);
    try {
      const receipt = { headerSubtitle: "Global subtitle", footerMessage: "Global footer" };
      await suite.db
        .insert(tenantReceipts)
        .values({ receipt })
        .onConflictDoUpdate({ target: tenantReceipts.id, set: { receipt } });
      await suite.db.insert(departmentReceipts).values({
        departmentId: department!.id,
        receipt: {
          headerSubtitle: { "ca-ES": "Bon dia", "es-ES": "Buenos días" },
          footerMessage: { "es-ES": "Gracias", "gl-ES": "Never third language" },
        },
      });
      const document = await read(backend, issued.saleId);
      expect(document.invoiceLocale).toBe("ca-ES");
      expect(document.receipt).toEqual({ headerSubtitle: "Bon dia", footerMessage: "Gracias" });
      await suite.db
        .update(departmentReceipts)
        .set({
          receipt: {
            headerSubtitle: { "es-ES": "Buenos días" },
            footerMessage: { "gl-ES": "Never third language" },
          },
        })
        .where(eq(departmentReceipts.departmentId, department!.id));
      expect((await read(backend, issued.saleId)).receipt).toEqual({
        headerSubtitle: "Buenos días",
        footerMessage: "Global footer",
      });
    } finally {
      if (previous) await suite.db.update(tenantReceipts).set({ receipt: previous.receipt });
      else await suite.db.delete(tenantReceipts);
    }
  });
});
