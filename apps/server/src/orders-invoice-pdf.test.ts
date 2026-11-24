import { withInvoiceSeriesGuardDropped } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  invoiceDeliveries,
  invoicePdfDownloads,
  invoiceSeries,
  printers,
  sales,
  taxpayer,
} from "@waitron/db";
import { recordSale, recordSubstitution } from "@waitron/core";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { Hono } from "hono";
import {
  jobOrigin,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { inTx } from "./testing/bill-venue.js";
import {
  billlessSale,
  credit,
  parked,
  placedIssuedBill,
  provisionOrderVenue,
  voidInvoice,
  type OrderVenue,
} from "./testing/order-venue.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { readInvoiceDeliveries } from "./invoice-delivery-status.js";
import { previewPrintJob } from "./print-job-preview.js";
import { DEFAULT_PRINTER, layOutSaleReceipt } from "./receipt-print.js";
import { mountTaxOfficeApi } from "./tax-office-api.js";
import type { TaxOfficeMonthBuilds } from "./tax-office-month-builds.js";
import { sessionHolding } from "./testing/session-holding.js";

let venue: OrderVenue;
let managerDashboard = "";
let fullSeriesId = "";
let taxOffice: Hono;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      const [manager] = await seedPersons(tx, {
        displayName: "Martha",
        pinHash: hashPin("4444"),
        role: "manager",
      });
      const session = await startManagementSession(tx, {
        method: "password",
        personId: manager!.id,
      });
      managerDashboard = `${MANAGEMENT_COOKIE}=${session.token}`;
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "full")));
      fullSeriesId = series!.id;
    });
    taxOffice = new Hono();
    mountTaxOfficeApi(
      taxOffice,
      {
        db,
        cfg: { nodeId: venue.cfg.nodeId },
        backend: venue.backend,
        tradingContext: venue.cfg,
        venueLocale: "es-ES",
        // The invoice PDF route never reads the month builds.
        builds: {} as TaxOfficeMonthBuilds,
        freeBytes: () => Promise.resolve(null),
      },
      () => {},
    );
  },
});

/** A full invoice on a new open bill, in `seriesId` (the venue's full series by default). */
async function fullInvoice(seriesId = fullSeriesId): Promise<{ billId: string; saleId: string }> {
  const billId = await parked(venue, "Small beer");
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(seriesId),
      workingOrderId: brandWorkingOrderId(billId),
      locale: venue.cfg.locale,
      invoiceLocales: [venue.cfg.locale],
      counterparty: { taxId: "12345678Z", legalName: "Cliente Mayorista SL", countryCode: "ES" },
      recipientAddress: "Calle Cliente 9, Madrid",
      total: "3.00",
      lines: [
        {
          lineNo: 1,
          name: "Small beer",
          descriptions: { [venue.cfg.locale]: "Glass of lager" },
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

async function download(cookie: string, billId: string) {
  const response = await venue.orders.request(`/management-api/orders/${billId}/invoice-pdf`, {
    method: "POST",
    headers: { cookie },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const json = response.headers.get("content-type")?.includes("json")
    ? (JSON.parse(new TextDecoder().decode(bytes)) as { error: { code: string } })
    : undefined;
  return { status: response.status, headers: response.headers, bytes, code: json?.error.code };
}

/** The first page's width in points and every page's text, from one opening of the PDF. */
async function readPdf(bytes: Uint8Array): Promise<{ width: number; text: string }> {
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const parts: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      for (const item of content.items) if ("str" in item) parts.push(item.str);
    }
    const width = Math.round((await pdf.getPage(1)).view[2]! * 100) / 100;
    return { width, text: parts.join(" ") };
  } finally {
    await loading.destroy();
  }
}

/** Every table's row count, drizzle's bookkeeping and the engine's own tables aside. */
async function rowCounts(): Promise<Record<string, number>> {
  const tables = venue.db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name`,
  );
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      venue.db.all<{ n: number }>(sql.raw(`select count(*) as n from "${name}"`))[0]!.n,
    ]),
  );
}

const downloadsOf = (saleId: string) =>
  inTx(venue, (tx) =>
    tx.select().from(invoicePdfDownloads).where(eq(invoicePdfDownloads.saleId, saleId)),
  );

describe("dashboard invoice PDF download", () => {
  it("refuses a supervisor and a staff member, writing nothing", async () => {
    const { billId, saleId } = await fullInvoice();
    const before = await rowCounts();
    for (const cookie of [venue.supervisorDashboard, venue.staffDashboard]) {
      expect(await download(cookie, billId)).toMatchObject({
        status: 403,
        code: "authorization.not_permitted",
      });
    }
    expect(await rowCounts()).toEqual(before);
    expect(await downloadsOf(saleId)).toEqual([]);
  });

  it("refuses a request without a dashboard session", async () => {
    const { billId } = await fullInvoice();
    expect(await download("", billId)).toMatchObject({
      status: 401,
      code: "management_session.required",
    });
  });

  it("gives a manager the duplicate PDF and writes only the audit row", async () => {
    const { billId, saleId } = await fullInvoice();
    const before = await rowCounts();
    const answer = await download(managerDashboard, billId);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("application/pdf");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    const [series] = await inTx(venue, (tx) =>
      tx
        .select({ code: invoiceSeries.code })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, fullSeriesId)),
    );
    const [{ invoiceNumber }] = (await inTx(venue, (tx) =>
      tx.select({ invoiceNumber: sales.invoiceNumber }).from(sales).where(eq(sales.id, saleId)),
    )) as [{ invoiceNumber: number }];
    expect(answer.headers.get("content-disposition")).toBe(
      `attachment; filename="${series!.code}-${invoiceNumber}.pdf"`,
    );
    const { text } = await readPdf(answer.bytes);
    expect(text).toContain("DUPLICADO");
    expect(text).toContain(`${series!.code}/${invoiceNumber}`);
    expect(text).toContain("Cliente Mayorista SL");
    const after = await rowCounts();
    expect(after).toEqual({ ...before, invoice_pdf_downloads: before.invoice_pdf_downloads! + 1 });
    const [manager] = await inTx(venue, (tx) =>
      tx.select({ id: persons.id }).from(persons).where(eq(persons.displayName, "Martha")),
    );
    expect(await downloadsOf(saleId)).toEqual([
      expect.objectContaining({ saleId, personId: manager!.id }),
    ]);
  });

  it("gives an administrator the PDF too, one audit row per download", async () => {
    const { billId, saleId } = await fullInvoice();
    expect((await download(venue.adminDashboard, billId)).status).toBe(200);
    expect((await download(venue.adminDashboard, billId)).status).toBe(200);
    const rows = await downloadsOf(saleId);
    expect(rows.map((row) => row.personId)).toEqual([venue.adminId, venue.adminId]);
  });

  it("names the file safely for the widest series code a venue can hold", async () => {
    // The base charset and length `validateVenueFiscalFields` allows (38 characters), plus the
    // `-<installation number>` suffix a restore appends.
    const code = `./Az09_.-/${"x".repeat(28)}-4294967295`;
    const [series] = await inTx(venue, (tx) =>
      tx
        .insert(invoiceSeries)
        .values({ nodeId: venue.cfg.nodeId, code, purpose: "full" })
        .returning({ id: invoiceSeries.id }),
    );
    const { billId } = await fullInvoice(series!.id);
    const answer = await download(managerDashboard, billId);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-disposition")).toBe(
      `attachment; filename="._Az09_.-_${"x".repeat(28)}-4294967295-1.pdf"`,
    );
    expect((await readPdf(answer.bytes)).text).toContain(`${code}/1`);
  });

  it("keeps a quote, a line break and a non-ASCII letter in a stored series code out of the header", async () => {
    // Corrupt the stored code after issuance to exercise PDF download with damaged data.
    const [series] = await inTx(venue, (tx) =>
      tx
        .insert(invoiceSeries)
        .values({ nodeId: venue.cfg.nodeId, code: "Q", purpose: "full" })
        .returning({ id: invoiceSeries.id }),
    );
    const { billId } = await fullInvoice(series!.id);
    await inTx(venue, (tx) =>
      withInvoiceSeriesGuardDropped(tx, () =>
        tx
          .update(invoiceSeries)
          .set({ code: 'Q"x\r\nSet-Cookie: a=ñ' })
          .where(eq(invoiceSeries.id, series!.id)),
      ),
    );
    const answer = await download(managerDashboard, billId);
    expect(answer.status).toBe(200);
    const disposition = answer.headers.get("content-disposition")!;
    expect(disposition).toBe('attachment; filename="Q_x__Set-Cookie__a__-1.pdf"');
    expect(answer.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a simplified invoice, writing nothing", async () => {
    const billId = await placedIssuedBill(venue, "Small beer");
    const before = await rowCounts();
    expect(await download(managerDashboard, billId)).toMatchObject({
      status: 409,
      code: "invoice_delivery.full_invoice_required",
    });
    expect(await rowCounts()).toEqual(before);
  });

  it("refuses a bill with no invoice and an id that is not one", async () => {
    const billId = await parked(venue, "Small beer");
    for (const id of [billId, randomUUID(), "not-a-bill"]) {
      expect(await download(managerDashboard, id)).toMatchObject({
        status: 404,
        code: "working_order.not_found",
      });
    }
  });

  it("leaves a queued original queued and still pending", async () => {
    const { billId, saleId } = await fullInvoice();
    const queued = await inTx(venue, (tx) =>
      reserveInvoiceDelivery(tx, saleId, {
        requestKey: randomUUID(),
        personId: venue.operatorId,
        medium: "email",
        recipient: "cliente@example.test",
      }),
    );
    expect(queued).toMatchObject({ status: "queued", designation: "original" });
    expect((await download(managerDashboard, billId)).status).toBe(200);
    const [after] = await inTx(venue, (tx) =>
      tx.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, queued.id)),
    );
    expect(after).toEqual(queued);
    const status = await inTx(venue, (tx) =>
      readInvoiceDeliveries(tx, saleId, { emailAvailable: false }),
    );
    expect(status).toMatchObject({ originalCompleted: false, current: { status: "queued" } });
  });
});

const saleOfBill = async (billId: string) => {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return row!.id;
};

const numberOf = async (saleId: string) => {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
      .from(sales)
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
      .where(eq(sales.id, saleId)),
  );
  return row!;
};

async function saleDownload(cookie: string, saleId: string) {
  const response = await taxOffice.request(`/management-api/tax-office/invoices/${saleId}/pdf`, {
    method: "POST",
    headers: { cookie },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const json = response.headers.get("content-type")?.includes("json")
    ? (JSON.parse(new TextDecoder().decode(bytes)) as { error: { code: string } })
    : undefined;
  return { status: response.status, headers: response.headers, bytes, code: json?.error.code };
}

/** Issues one invoice of each kind and answers its sale's id. */
const kinds = {
  F2: async () => saleOfBill(await placedIssuedBill(venue, "Small beer")),
  F1: async () => (await fullInvoice()).saleId,
  F3: async () => {
    const ticket = await saleOfBill(await placedIssuedBill(venue, "Small beer"));
    const { saleId } = await inTx(venue, (tx) =>
      recordSubstitution(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(fullSeriesId),
        substitutedSaleIds: [brandSaleId(ticket)],
        counterparty: {
          taxId: "12345678Z",
          legalName: "Cliente Mayorista SL",
          countryCode: "ES",
        },
        recipientAddress: "Calle Cliente 9, Madrid",
        total: "3.00",
        lines: [
          {
            lineNo: 1,
            name: "Small beer",
            descriptions: { [venue.cfg.locale]: "Glass of lager" },
            quantity: "1",
            unitPrice: "3.00",
            vatRate: "10",
            lineTotal: "3.00",
          },
        ],
        locale: venue.cfg.locale,
        invoiceLocales: [venue.cfg.locale],
        clock: venue.clock,
      }),
    );
    return saleId;
  },
  R5: async () => {
    const billId = await placedIssuedBill(venue, "Small beer");
    const ticket = await saleOfBill(billId);
    await credit(venue, billId, "1.00", "-1.10");
    const [corrective] = await inTx(venue, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, ticket)),
    );
    return corrective!.id;
  },
} satisfies Record<string, () => Promise<string>>;

describe("tax office invoice PDF", () => {
  for (const [kind, issue] of Object.entries(kinds)) {
    it(`gives an ${kind} as a duplicate PDF named by its number, recording one download`, async () => {
      const saleId = await issue();
      const { code, number } = await numberOf(saleId);
      const answer = await saleDownload(managerDashboard, saleId);
      expect(answer.status).toBe(200);
      expect(answer.headers.get("content-type")).toBe("application/pdf");
      expect(answer.headers.get("cache-control")).toBe("no-store");
      expect(answer.headers.get("content-disposition")).toBe(
        `attachment; filename="${code}-${number}.pdf"`,
      );
      expect(new TextDecoder().decode(answer.bytes.subarray(0, 4))).toBe("%PDF");
      const { text } = await readPdf(answer.bytes);
      expect(text).toContain(`${code}/${number}`);
      expect(text).toContain("DUPLICADO");
      const [manager] = await inTx(venue, (tx) =>
        tx.select({ id: persons.id }).from(persons).where(eq(persons.displayName, "Martha")),
      );
      expect(await downloadsOf(saleId)).toEqual([
        expect.objectContaining({ saleId, personId: manager!.id }),
      ]);
    });
  }

  it("writes only the download row", async () => {
    const saleId = await kinds.F2();
    const before = await rowCounts();
    expect((await saleDownload(managerDashboard, saleId)).status).toBe(200);
    expect(await rowCounts()).toEqual({
      ...before,
      invoice_pdf_downloads: before.invoice_pdf_downloads! + 1,
    });
  });

  it("answers an unknown sale with invoice_delivery.not_found, writing nothing", async () => {
    const before = await rowCounts();
    expect(await saleDownload(managerDashboard, randomUUID())).toMatchObject({
      status: 404,
      code: "invoice_delivery.not_found",
    });
    expect(await rowCounts()).toEqual(before);
  });

  it("refuses an id that is not a sale's shape before reading the session, writing nothing", async () => {
    const before = await rowCounts();
    // A cookie naming no session: refused 401 only if the id check came after the session read.
    const ended = `waitron_management_session=${randomUUID()}`;
    for (const cookie of [managerDashboard, ended])
      expect(await saleDownload(cookie, "not-a-uuid")).toMatchObject({
        status: 404,
        code: "invoice_delivery.not_found",
      });
    expect(await rowCounts()).toEqual(before);
  });

  it("gives a session holding only invoice.inspect the PDF, recording that person", async () => {
    const saleId = await kinds.F2();
    const inspector = await sessionHolding(venue.db, ["invoice.inspect"]);
    expect((await saleDownload(inspector.cookie, saleId)).status).toBe(200);
    expect(await downloadsOf(saleId)).toEqual([
      expect.objectContaining({ saleId, personId: inspector.personId }),
    ]);
  });

  it("refuses a session holding the report permissions but not invoice.inspect", async () => {
    const saleId = await kinds.F2();
    const reporter = await sessionHolding(venue.db, ["report.view", "report.export"]);
    const before = await rowCounts();
    expect(await saleDownload(reporter.cookie, saleId)).toMatchObject({
      status: 403,
      code: "authorization.not_permitted",
    });
    expect(await rowCounts()).toEqual(before);
  });

  it("refuses a session without invoice.inspect, writing nothing", async () => {
    const saleId = await kinds.F2();
    const before = await rowCounts();
    for (const cookie of [venue.supervisorDashboard, venue.staffDashboard]) {
      expect(await saleDownload(cookie, saleId)).toMatchObject({
        status: 403,
        code: "authorization.not_permitted",
      });
    }
    expect(await rowCounts()).toEqual(before);
    expect(await downloadsOf(saleId)).toEqual([]);
  });
});

/** An F2 of `lineCount` lines with no bill, from the demo seed's job origin (no device), under the simplified limit. */
const seededTicket = (lineCount: number) =>
  billlessSale(venue, { origin: jobOrigin("demo_seed"), lineCount, unitPrice: "1.00" });

const TICKET_80MM = 226.77;
const A4 = 595.28;

describe("tax office copy: a ticket at ticket width, a full invoice on A4", () => {
  async function opened(saleId: string) {
    const answer = await saleDownload(managerDashboard, saleId);
    expect(answer.status).toBe(200);
    expect(await downloadsOf(saleId)).toHaveLength(1);
    return readPdf(answer.bytes);
  }

  const tickets: Record<string, () => Promise<string>> = {
    F2: kinds.F2,
    R5: kinds.R5,
    "voided F2": async () => {
      const billId = await placedIssuedBill(venue, "Small beer");
      await voidInvoice(venue, billId);
      return saleOfBill(billId);
    },
  };
  for (const [kind, issue] of Object.entries(tickets)) {
    it(`draws an ${kind} one 80 mm ticket wide, numbered and marked as a copy`, async () => {
      const saleId = await issue();
      const { code, number } = await numberOf(saleId);
      const { width, text } = await opened(saleId);
      expect(width).toBe(TICKET_80MM);
      expect(text).toContain(`${code}/${number}`);
      expect(text).toContain("DUPLICADO");
    });
  }

  const invoices: Record<string, () => Promise<string>> = {
    F1: kinds.F1,
    F3: kinds.F3,
    R4: async () => {
      const { saleId } = await fullInvoice();
      return inTx(venue, (tx) => insertCorrective(tx, saleId, { replaces: true }));
    },
  };
  for (const [kind, issue] of Object.entries(invoices)) {
    it(`draws an ${kind}, which names a customer, on an A4 page`, async () => {
      expect((await opened(await issue())).width).toBe(A4);
    });
  }

  it("lays a ticket out for its device's receipt printer as it is now", async () => {
    const saleId = await kinds.F2();
    await inTx(venue, (tx) =>
      tx.update(printers).set({ paperWidth: "58mm" }).where(eq(printers.id, venue.printerId)),
    );
    try {
      expect((await opened(saleId)).width).toBe(164.41);
    } finally {
      await inTx(venue, (tx) =>
        tx.update(printers).set({ paperWidth: "80mm" }).where(eq(printers.id, venue.printerId)),
      );
    }
  });

  it("lays a ticket sold on no device out for an 80 mm printer", async () => {
    const saleId = await seededTicket(1);
    const { code, number } = await numberOf(saleId);
    const { width, text } = await opened(saleId);
    expect(width).toBe(TICKET_80MM);
    expect(text).toContain(`${code}/${number}`);
  });

  it("dates a ticket's copy when the sale was issued", async () => {
    const saleId = await kinds.F2();
    const [row] = await inTx(venue, (tx) =>
      tx.select({ issuedAt: sales.issuedAt }).from(sales).where(eq(sales.id, saleId)),
    );
    const stamp = `D:${new Date(row!.issuedAt).toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`;
    const answer = await saleDownload(managerDashboard, saleId);
    const loading = getDocument({ data: Uint8Array.from(answer.bytes), useSystemFonts: false });
    try {
      const { info } = await (await loading.promise).getMetadata();
      expect(info).toMatchObject({ CreationDate: stamp, ModDate: stamp });
    } finally {
      await loading.destroy();
    }
  });

  it("draws a ticket read back whole but taller than a PDF page may be on an A4 page", async () => {
    const saleId = await seededTicket(1_400);
    const bytes = await inTx(venue, (tx) =>
      layOutSaleReceipt(venue.backend, tx, venue.cfg, saleId, true, DEFAULT_PRINTER, null),
    );
    expect(previewPrintJob(bytes, { widthDots: 512 }).truncated).toBe(false);
    const { code, number } = await numberOf(saleId);
    const { width, text } = await opened(saleId);
    expect(width).toBe(A4);
    expect(text).toContain(`${code}/${number}`);
  }, 60_000);

  it("draws a ticket too long to read back whole on an A4 page", async () => {
    const saleId = await seededTicket(2_100);
    const { code, number } = await numberOf(saleId);
    const { width, text } = await opened(saleId);
    expect(width).toBe(A4);
    expect(text).toContain(`${code}/${number}`);
  }, 60_000);
});
