import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceDeliveries, invoicePdfDownloads, invoiceSeries, sales, tenants } from "@waitron/db";
import { recordSale } from "@waitron/core";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { seriesId as brandSeriesId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { inTx } from "./testing/bill-venue.js";
import {
  parked,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { readInvoiceDeliveries } from "./invoice-delivery-status.js";

// The dashboard's PDF download of a full invoice, against synthetic full invoices written through
// the core (public F1 issuance stays disabled).
let venue: OrderVenue;
let managerDashboard = "";
let fullSeriesId = "";
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      const [manager] = await tx
        .insert(persons)
        .values({ displayName: "Marta", pinHash: hashPin("4444"), role: "manager" })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: manager!.id });
      managerDashboard = `${MANAGEMENT_COOKIE}=${session.token}`;
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "full")));
      fullSeriesId = series!.id;
    });
  },
});

/** A full invoice on a new open bill, in `seriesId` (the venue's full series by default). */
async function fullInvoice(seriesId = fullSeriesId): Promise<{ billId: string; saleId: string }> {
  const billId = await parked(venue, "Caña");
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(seriesId),
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

async function pdfText(bytes: Uint8Array): Promise<string> {
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const parts: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      for (const item of content.items) if ("str" in item) parts.push(item.str);
    }
    return parts.join(" ");
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
    const text = await pdfText(answer.bytes);
    expect(text).toContain("DUPLICADO");
    expect(text).toContain(`${series!.code}/${invoiceNumber}`);
    expect(text).toContain("Cliente Mayorista SL");
    const after = await rowCounts();
    expect(after).toEqual({ ...before, invoice_pdf_downloads: before.invoice_pdf_downloads! + 1 });
    const [manager] = await inTx(venue, (tx) =>
      tx.select({ id: persons.id }).from(persons).where(eq(persons.displayName, "Marta")),
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
    expect(await pdfText(answer.bytes)).toContain(`${code}/1`);
  });

  it("keeps a quote, a line break and a non-ASCII letter in a stored series code out of the header", async () => {
    // The column takes any non-empty text; the sale is recorded under a valid code first, because
    // the fiscal record refuses these characters, and the code is then changed underneath it.
    const [series] = await inTx(venue, (tx) =>
      tx
        .insert(invoiceSeries)
        .values({ nodeId: venue.cfg.nodeId, code: "Q", purpose: "full" })
        .returning({ id: invoiceSeries.id }),
    );
    const { billId } = await fullInvoice(series!.id);
    await inTx(venue, (tx) =>
      tx
        .update(invoiceSeries)
        .set({ code: 'Q"x\r\nSet-Cookie: a=ñ' })
        .where(eq(invoiceSeries.id, series!.id)),
    );
    const answer = await download(managerDashboard, billId);
    expect(answer.status).toBe(200);
    const disposition = answer.headers.get("content-disposition")!;
    expect(disposition).toBe('attachment; filename="Q_x__Set-Cookie__a__-1.pdf"');
    expect(answer.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a simplified invoice, writing nothing", async () => {
    const billId = await placedIssuedBill(venue, "Caña");
    const before = await rowCounts();
    expect(await download(managerDashboard, billId)).toMatchObject({
      status: 409,
      code: "invoice_delivery.full_invoice_required",
    });
    expect(await rowCounts()).toEqual(before);
  });

  it("refuses a bill with no invoice and an id that is not one", async () => {
    const billId = await parked(venue, "Caña");
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
