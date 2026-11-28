import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { listAdjustmentReasons } from "@waitron/adjustments";
import {
  deviceProfiles,
  devices,
  invoiceCorrections,
  invoiceDeliveries,
  printers,
  printJobs,
  refunds,
  sales,
  taxpayer,
} from "@waitron/db";
import { insertA4Printer, setPrinterListsForTest } from "@waitron/db/testing/printers.js";
import { seedDepartmentReceipt } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { departments } from "@waitron/venue-service";
import type { Hono } from "hono";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import * as fixture from "./testing/full-invoice-give-back.js";
import { ask } from "./testing/full-invoice-give-back.js";

let venue: BillVenue;
let reasonId: string;
let adminCookie: string;
let officeId: string;
let backOfficeId: string;
let mailApp: Hono;

/** With `refuseOnce`, the next automatic filing throws, leaving its correction open; `before`
 * runs once, just ahead of the next automatic filing. */
const automaticFiling = vi.hoisted(() => ({
  refuseOnce: false,
  before: null as (() => Promise<void>) | null,
}));
vi.mock("./invoice-correction-alerts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./invoice-correction-alerts.js")>();
  return {
    ...real,
    fileCorrectionAutomatically: async (
      ...args: Parameters<typeof real.fileCorrectionAutomatically>
    ) => {
      const before = automaticFiling.before;
      automaticFiling.before = null;
      if (before !== null) await before();
      if (!automaticFiling.refuseOnce) return real.fileCorrectionAutomatically(...args);
      automaticFiling.refuseOnce = false;
      return Promise.reject(new Error("automatic filing refused"));
    },
  };
});

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      reasonId = (await listAdjustmentReasons(tx))[0]!.id;
      adminCookie = await fixture.adminTillCookie(tx, venue);
      officeId = await insertA4Printer(tx, { name: "Office", host: "10.0.0.9" });
      // Active, but not on this till's invoice list, so never offered to it.
      backOfficeId = await insertA4Printer(tx, { name: "Back office", host: "10.0.0.10" });
      for (const department of await tx.select().from(departments))
        await seedDepartmentReceipt(tx, department.id, {
          operationDescription: "Restaurante",
          email: "dining@example.test",
        });
      for (const profile of await tx.select().from(deviceProfiles))
        await tx
          .update(deviceProfiles)
          .set({ capabilities: [...(profile.capabilities as string[]), "print-receipt"] })
          .where(eq(deviceProfiles.id, profile.id));
      const [device] = await tx
        .select({ profileId: devices.deviceProfileId, receipt: devices.receiptPrinterId })
        .from(devices)
        .where(eq(devices.id, venue.deviceId));
      await setPrinterListsForTest(tx, device!.profileId, {
        invoice: { ids: [officeId, device!.receipt!], defaultId: null },
      });
    });
    mailApp = venue.appWith({ invoiceEmailAvailable: () => Promise.resolve(true) });
  },
});

const receiptPrinterId = () =>
  venue.db.all<{ id: string }>(
    sql`select receipt_printer_id as id from devices where id = ${venue.deviceId}`,
  )[0]!.id;
const printerName = (id: string) =>
  venue.db.all<{ name: string }>(sql`select name from printers where id = ${id}`)[0]!.name;

const preview = (saleId: string, request: object, app: Hono = mailApp) =>
  send(app, adminCookie, "POST", `/api/transactions/${saleId}/give-back/preview`, request);

async function pressBody(saleId: string, more: Parameters<typeof ask>[2] = {}, app = mailApp) {
  return fixture.giveBackBody(
    venue,
    adminCookie,
    saleId,
    ask("goodwill", "10.00", more),
    reasonId,
    app,
  );
}

const give = (saleId: string, body: unknown, app: Hono = mailApp) =>
  send(app, adminCookie, "POST", `/api/transactions/${saleId}/give-back`, body);

async function delivered(
  saleId: string,
  delivery: { medium: "email"; recipient: string } | { medium: "a4"; pagePrinterId: string },
) {
  const row = await inTx(venue, (tx) =>
    reserveInvoiceDelivery(tx, saleId, {
      requestKey: randomUUID(),
      personId: venue.adminId,
      ...delivery,
    }),
  );
  await venue.db
    .update(invoiceDeliveries)
    .set({ status: "sent" })
    .where(eq(invoiceDeliveries.id, row.id));
}

async function filedR1(answer: { json: Record<string, unknown> }) {
  const id = (answer.json as { parts: { correctionId?: string }[] }).parts.find(
    (part) => part.correctionId !== undefined,
  )!.correctionId!;
  const [row] = await venue.db
    .select()
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, id));
  expect(row!.state).toBe("filed");
  return row!.correctiveSaleId!;
}

const deliveriesOf = (saleId: string) =>
  venue.db
    .select({
      medium: invoiceDeliveries.medium,
      recipient: invoiceDeliveries.recipient,
      printerId: invoiceDeliveries.printerId,
    })
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.saleId, saleId));

const jobsOf = (saleId: string) =>
  venue.db
    .select({ printerId: printJobs.printerId, kind: printJobs.kind })
    .from(printJobs)
    .where(eq(printJobs.saleId, saleId));

/** What a refused press left on `saleId`: its correctives, refunds and corrections. */
async function writtenOn(saleId: string) {
  return {
    correctives: (
      await venue.db.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, saleId))
    ).length,
    refunds: (
      await venue.db.select({ id: refunds.id }).from(refunds).where(eq(refunds.saleId, saleId))
    ).length,
    corrections: (
      await venue.db
        .select({ id: invoiceCorrections.id })
        .from(invoiceCorrections)
        .where(eq(invoiceCorrections.originalSaleId, saleId))
    ).length,
  };
}

const NOTHING = { correctives: 0, refunds: 0, corrections: 0 };

function offers() {
  return [
    { id: officeId, name: "Office", kind: "a4" },
    { id: receiptPrinterId(), name: printerName(receiptPrinterId()), kind: "receipt" },
  ].sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function useOwnA4() {
  await venue.db
    .update(devices)
    .set({ invoicePrinterId: officeId })
    .where(eq(devices.id, venue.deviceId));
  onTestFinished(async () => {
    await venue.db
      .update(devices)
      .set({ invoicePrinterId: null })
      .where(eq(devices.id, venue.deviceId));
  });
}

describe("the give-back preview shows where the corrective full invoice will go", () => {
  it("shows email to the original's address when the original was emailed", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const shown = await preview(saleId, ask("goodwill", "10.00"));
    expect(shown.status, JSON.stringify(shown.json)).toBe(200);
    expect(shown.json.corrective).toEqual({
      default: { medium: "email", recipient: "accounts@harbour.example" },
      printers: offers(),
      emailAvailable: true,
      emailNeedsReceiptContact: false,
    });
  });

  it("asks once whether email can be sent when the original was emailed", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const asked = vi.fn(() => Promise.resolve(true));
    const shown = await preview(
      saleId,
      ask("goodwill", "10.00"),
      venue.appWith({ invoiceEmailAvailable: asked }),
    );
    expect(shown.status, JSON.stringify(shown.json)).toBe(200);
    expect(shown.json.corrective).toMatchObject({
      default: { medium: "email", recipient: "accounts@harbour.example" },
      emailAvailable: true,
    });
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("shows this till's A4 printer when the original went on A4", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "a4", pagePrinterId: officeId });
    await useOwnA4();
    const shown = await preview(saleId, ask("goodwill", "10.00"), venue.app);
    expect(shown.json.corrective).toEqual({
      default: { medium: "a4", printerId: officeId, printerName: "Office" },
      printers: [
        { id: officeId, name: "Office", kind: "a4" },
        ...offers().filter((printer) => printer.id !== officeId),
      ],
      emailAvailable: false,
      emailNeedsReceiptContact: false,
    });
  });

  it("shows this till's receipt printer when nothing of the original was sent", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    const shown = await preview(saleId, ask("goodwill", "10.00"));
    const receipt = receiptPrinterId();
    expect(shown.json.corrective).toEqual({
      default: { medium: "receipt", printerId: receipt, printerName: printerName(receipt) },
      printers: [
        { id: receipt, name: printerName(receipt), kind: "receipt" },
        ...offers().filter((printer) => printer.id !== receipt),
      ],
      emailAvailable: true,
      emailNeedsReceiptContact: false,
    });
  });

  it("shows nothing about a corrective full invoice on a simplified invoice", async () => {
    const billId = await tabWith(venue, "Steak");
    await fixture.payPart(venue, billId, { cash: "25.00" });
    const saleId = await fixture.saleOf(venue, billId);
    const shown = await preview(saleId, ask("goodwill", "10.00"));
    expect(shown.status, JSON.stringify(shown.json)).toBe(200);
    expect(shown.json).not.toHaveProperty("corrective");
  });
});

describe("a give-back sends the corrective full invoice the way staff chose", () => {
  it("emails it to the address staff typed, not the original's", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const body = await pressBody(saleId, {
      correctiveDelivery: { medium: "email", recipient: "ana@example.com" },
    });
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "email", recipient: "ana@example.com", printerId: null },
    ]);
    expect(await jobsOf(r1)).toEqual([]);
  });

  it("prints it on the A4 printer staff chose, though the original was emailed", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const body = await pressBody(saleId, {
      correctiveDelivery: { medium: "print", printerId: officeId },
    });
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "a4", recipient: null, printerId: officeId },
    ]);
  });

  it("prints it on the receipt printer staff chose when the original went on A4, without saying it fell back", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "a4", pagePrinterId: officeId });
    await useOwnA4();
    const body = await pressBody(saleId, {
      correctiveDelivery: { medium: "print", printerId: receiptPrinterId() },
    });
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    expect(await jobsOf(r1)).toEqual([{ printerId: receiptPrinterId(), kind: "document" }]);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "receipt", recipient: null, printerId: null },
    ]);
    const part = (answer.json as { parts: { corrective?: Record<string, unknown> }[] }).parts[0]!;
    expect(part.corrective?.printedOnReceiptNotA4).toBe(false);
    // A resend of the same press answers the same, and sends nothing more.
    const again = await give(saleId, body);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const resent = (again.json as { parts: { corrective?: Record<string, unknown> }[] }).parts[0]!;
    expect(resent.corrective?.printedOnReceiptNotA4).toBe(false);
    expect(await jobsOf(r1)).toHaveLength(1);
  });

  it("lets Find a bill retry a failed chosen receipt print of the corrective only on the till's own invoice printer, as for any print request", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "a4", pagePrinterId: officeId });
    await useOwnA4();
    const receipt = receiptPrinterId();
    const answer = await give(
      saleId,
      await pressBody(saleId, { correctiveDelivery: { medium: "print", printerId: receipt } }),
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    const [job] = await venue.db
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(eq(printJobs.saleId, r1));
    await venue.db
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
      .where(eq(printJobs.id, job!.id));
    await venue.db
      .update(invoiceDeliveries)
      .set({
        status: "failed",
        failureCode: "transport_failed",
        reportedAt: new Date().toISOString(),
      })
      .where(eq(invoiceDeliveries.printJobId, job!.id));
    const findABill = (method: string, path: string, body?: unknown) =>
      send(mailApp, adminCookie, method, `/api/transactions/${r1}${path}`, body);

    // This till's invoice printer is the A4 one, so Find a bill prints no full invoice on the
    // receipt printer, the corrective's retry included, and offers the A4 printer instead.
    expect(
      await findABill("POST", "/deliveries", {
        medium: "print",
        requestKey: randomUUID(),
        printerId: receipt,
      }),
    ).toMatchObject({ status: 409, json: { code: "invoice_delivery.printer_invalid" } });
    expect((await findABill("GET", "/receipt-print")).json).toMatchObject({
      status: "failed",
      jobId: job!.id,
      canRetry: true,
      printerWithdrawn: true,
    });
    expect((await findABill("GET", "/deliveries")).json).toMatchObject({
      actions: { retryOriginal: null, print: { printers: [{ id: officeId }] } },
    });
    expect(await findABill("POST", "/receipt-print/retry", {})).toMatchObject({
      status: 409,
      json: { code: "invoice_delivery.printer_invalid" },
    });
    expect(await jobsOf(r1)).toHaveLength(1);

    // Once the receipt printer is the till's invoice printer again, the same retry is sent.
    await venue.db
      .update(devices)
      .set({ invoicePrinterId: receipt })
      .where(eq(devices.id, venue.deviceId));
    expect((await findABill("GET", "/receipt-print")).json).not.toHaveProperty("printerWithdrawn");
    const retried = await findABill("POST", "/receipt-print/retry", {});
    expect(retried.status, JSON.stringify(retried.json)).toBe(200);
    expect(await jobsOf(r1)).toEqual([
      { printerId: receipt, kind: "document" },
      { printerId: receipt, kind: "document" },
    ]);
  });

  it("still says it did not fall back from A4 when the same press is sent again without the choice", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "a4", pagePrinterId: officeId });
    await useOwnA4();
    const body = await pressBody(saleId, {
      correctiveDelivery: { medium: "print", printerId: receiptPrinterId() },
    });
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    const bare: Record<string, unknown> = { ...body };
    delete bare.correctiveDelivery;
    const again = await give(saleId, bare);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const resent = (again.json as { parts: { corrective?: Record<string, unknown> }[] }).parts[0]!;
    expect(resent.corrective?.printedOnReceiptNotA4).toBe(false);
    expect(await jobsOf(r1)).toHaveLength(1);
  });

  it("still says it fell back from A4 when the same press is sent again naming the receipt printer", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await delivered(saleId, { medium: "a4", pagePrinterId: officeId });
    const body = await pressBody(saleId);
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    const part = (answer.json as { parts: { corrective?: Record<string, unknown> }[] }).parts[0]!;
    expect(part.corrective?.printedOnReceiptNotA4).toBe(true);
    const again = await give(saleId, {
      ...body,
      correctiveDelivery: { medium: "print", printerId: receiptPrinterId() },
    });
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const resent = (again.json as { parts: { corrective?: Record<string, unknown> }[] }).parts[0]!;
    expect(resent.corrective?.printedOnReceiptNotA4).toBe(true);
    expect(await jobsOf(r1)).toHaveLength(1);
  });

  it("files a hand-keyed card's R1 after the press the way staff chose", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { card: "37.00" });
    const way = fixture.tenderOf(venue, saleId, "card");
    const body = await pressBody(saleId, {
      way,
      correctiveDelivery: { medium: "email", recipient: "ana@example.com" },
    });
    const answer = await give(saleId, {
      ...body,
      manualConfirmed: true,
      override: { personId: venue.adminId, pin: "1234" },
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "email", recipient: "ana@example.com", printerId: null },
    ]);
  });

  it("files a reader card's R1 the way staff chose", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { reader: "37.00" });
    const way = fixture.tenderOf(venue, saleId, "card");
    const body = await pressBody(saleId, {
      way,
      correctiveDelivery: { medium: "print", printerId: officeId },
    });
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "a4", recipient: null, printerId: officeId },
    ]);
  });
});

describe("a give-back refuses a corrective way that is no longer there, before anything is filed or money moves", () => {
  it("refuses a printer switched off since the preview, under its field", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    const body = await pressBody(saleId, {
      correctiveDelivery: { medium: "print", printerId: officeId },
    });
    await venue.db.update(printers).set({ active: false }).where(eq(printers.id, officeId));
    onTestFinished(async () => {
      await venue.db.update(printers).set({ active: true }).where(eq(printers.id, officeId));
    });
    const answer = await give(saleId, body);
    expect(answer.status).toBe(409);
    expect(answer.json).toEqual({
      code: "invoice_delivery.printer_invalid",
      params: { field: "correctiveDelivery.printerId" },
    });
    expect(await writtenOn(saleId)).toEqual(NOTHING);
  });

  it("refuses email when this box cannot send it", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    const body = await pressBody(saleId, {}, venue.app);
    const answer = await give(
      saleId,
      { ...body, correctiveDelivery: { medium: "email", recipient: "ana@example.com" } },
      venue.app,
    );
    expect(answer.status).toBe(409);
    expect(answer.json).toEqual({
      code: "invoice_delivery.email_unavailable",
      params: { field: "correctiveDelivery.recipient" },
    });
    expect(await writtenOn(saleId)).toEqual(NOTHING);
  });

  it("refuses an address that is not one", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    const body = await pressBody(saleId);
    const answer = await give(saleId, {
      ...body,
      correctiveDelivery: { medium: "email", recipient: "not an address" },
    });
    expect(answer.status).toBe(400);
    expect(answer.json).toEqual({
      code: "management.request_invalid",
      params: { field: "correctiveDelivery.recipient" },
    });
    expect(await writtenOn(saleId)).toEqual(NOTHING);
  });

  it("refuses a way for a give-back that files no corrective full invoice", async () => {
    const billId = await tabWith(venue, "Steak");
    await fixture.payPart(venue, billId, { cash: "25.00" });
    const saleId = await fixture.saleOf(venue, billId);
    const body = await pressBody(saleId);
    const answer = await give(saleId, {
      ...body,
      correctiveDelivery: { medium: "print", printerId: officeId },
    });
    expect(answer.status).toBe(400);
    expect(answer.json).toEqual({
      code: "management.request_invalid",
      params: { field: "correctiveDelivery" },
    });
    expect(await writtenOn(saleId)).toEqual(NOTHING);
  });
});

describe("a way chosen at the press that is gone when a reader's refund is filed sends nothing, keeping the money and the filing", () => {
  /** Gives back on a reader-paid full invoice choosing `chosen`, running `meanwhile` after the
   * reader refunded and before the R1 is filed; checks the send was refused with the press check's
   * `code`, and answers the filed R1. */
  async function readerPress(
    chosen: object,
    code: string,
    meanwhile: () => Promise<void>,
    app: Hono = mailApp,
  ) {
    const { saleId } = await fixture.fullInvoice(venue, { reader: "37.00" });
    const way = fixture.tenderOf(venue, saleId, "card");
    const body = await pressBody(saleId, { way, correctiveDelivery: chosen as never }, app);
    automaticFiling.before = meanwhile;
    onTestFinished(() => {
      automaticFiling.before = null;
    });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    onTestFinished(() => warned.mockRestore());
    const answer = await give(saleId, body, app);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(automaticFiling.before).toBeNull();
    const r1 = await filedR1(answer);
    expect(warned).toHaveBeenCalledWith("receipt.optional_document_failed", {
      operation: "sendFiledCorrective",
      saleId: r1,
      code,
    });
    expect(
      await venue.db
        .select({ state: refunds.state })
        .from(refunds)
        .where(eq(refunds.saleId, saleId)),
    ).toEqual([{ state: "completed" }]);
    return r1;
  }

  it("sends nothing to a printer taken off this till's list meanwhile, though it is still on", async () => {
    const [device] = await venue.db
      .select({ profileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, venue.deviceId));
    const r1 = await readerPress(
      { medium: "print", printerId: officeId },
      "invoice_delivery.printer_invalid",
      async () => {
        await inTx(venue, (tx) =>
          setPrinterListsForTest(tx, device!.profileId, {
            invoice: { ids: [receiptPrinterId()], defaultId: null },
          }),
        );
        onTestFinished(async () => {
          await inTx(venue, (tx) =>
            setPrinterListsForTest(tx, device!.profileId, {
              invoice: { ids: [officeId, receiptPrinterId()], defaultId: null },
            }),
          );
        });
      },
    );
    expect(await deliveriesOf(r1)).toEqual([]);
    expect(await jobsOf(r1)).toEqual([]);
  });

  it("sends nothing to a receipt printer switched off meanwhile", async () => {
    const receipt = receiptPrinterId();
    const r1 = await readerPress(
      { medium: "print", printerId: receipt },
      "invoice_delivery.printer_invalid",
      async () => {
        await venue.db.update(printers).set({ active: false }).where(eq(printers.id, receipt));
        onTestFinished(async () => {
          await venue.db.update(printers).set({ active: true }).where(eq(printers.id, receipt));
        });
      },
    );
    expect(await deliveriesOf(r1)).toEqual([]);
    expect(await jobsOf(r1)).toEqual([]);
  });

  it("sends nothing by email when this box stopped being able to send it meanwhile", async () => {
    let mailUp = true;
    const app = venue.appWith({ invoiceEmailAvailable: () => Promise.resolve(mailUp) });
    const r1 = await readerPress(
      { medium: "email", recipient: "ana@example.com" },
      "invoice_delivery.email_unavailable",
      () => {
        mailUp = false;
        return Promise.resolve();
      },
      app,
    );
    expect(await deliveriesOf(r1)).toEqual([]);
    expect(await jobsOf(r1)).toEqual([]);
  });
});

describe("a box that cannot read whether it can send email offers no email", () => {
  const brokenMail = () =>
    venue.appWith({
      invoiceEmailAvailable: () => Promise.reject(new Error("email settings unreadable")),
    });

  it("refuses an email choice as email that cannot be sent, writing nothing", async () => {
    const app = brokenMail();
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    const body = await pressBody(saleId, {}, app);
    const answer = await give(
      saleId,
      { ...body, correctiveDelivery: { medium: "email", recipient: "ana@example.com" } },
      app,
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(409);
    expect(answer.json).toEqual({
      code: "invoice_delivery.email_unavailable",
      params: { field: "correctiveDelivery.recipient" },
    });
    expect(await writtenOn(saleId)).toEqual(NOTHING);
  });

  it("prints it on the A4 printer staff chose", async () => {
    const app = brokenMail();
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    const body = await pressBody(
      saleId,
      { correctiveDelivery: { medium: "print", printerId: officeId } },
      app,
    );
    const answer = await give(saleId, body, app);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await deliveriesOf(await filedR1(answer))).toEqual([
      { medium: "a4", recipient: null, printerId: officeId },
    ]);
  });
});

describe("a box that can send email but has no receipt contact address offers no email, and says why", () => {
  /** Takes every department's receipt contact address away for the rest of the test. */
  async function withoutReceiptContact() {
    const all = await venue.db.select({ id: departments.id }).from(departments);
    await inTx(venue, async (tx) => {
      for (const department of all)
        await seedDepartmentReceipt(tx, department.id, { operationDescription: "Restaurante" });
    });
    onTestFinished(async () => {
      await inTx(venue, async (tx) => {
        for (const department of all)
          await seedDepartmentReceipt(tx, department.id, {
            operationDescription: "Restaurante",
            email: "dining@example.test",
          });
      });
    });
  }

  it("previews email as needing a receipt contact address", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await withoutReceiptContact();
    const shown = await preview(saleId, ask("goodwill", "10.00"));
    expect(shown.status, JSON.stringify(shown.json)).toBe(200);
    expect(shown.json.corrective).toMatchObject({
      emailAvailable: false,
      emailNeedsReceiptContact: true,
    });
  });

  it("refuses an address staff typed as email that cannot be sent, writing nothing", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await withoutReceiptContact();
    const body = await pressBody(saleId);
    const answer = await give(saleId, {
      ...body,
      correctiveDelivery: { medium: "email", recipient: "ana@example.com" },
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(409);
    expect(answer.json).toEqual({
      code: "invoice_delivery.email_unavailable",
      params: { field: "correctiveDelivery.recipient" },
    });
    expect(await writtenOn(saleId)).toEqual(NOTHING);
  });

  it("does not say a receipt contact address is needed when the box cannot send email at all", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
    await withoutReceiptContact();
    const shown = await preview(saleId, ask("goodwill", "10.00"), venue.app);
    expect(shown.json.corrective).toMatchObject({
      emailAvailable: false,
      emailNeedsReceiptContact: false,
    });
  });
});

describe("a resend that files the correction its first press left open checks the way it carries first", () => {
  const correctionsOf = (saleId: string) =>
    venue.db
      .select({
        state: invoiceCorrections.state,
        correctiveSaleId: invoiceCorrections.correctiveSaleId,
      })
      .from(invoiceCorrections)
      .where(eq(invoiceCorrections.originalSaleId, saleId));

  /** A hand-keyed card press choosing Office whose automatic filing is refused once. */
  async function leftOpen(saleId: string) {
    const way = fixture.tenderOf(venue, saleId, "card");
    const body = await pressBody(saleId, {
      way,
      correctiveDelivery: { medium: "print", printerId: officeId },
    });
    const full = {
      ...body,
      manualConfirmed: true,
      override: { personId: venue.adminId, pin: "1234" },
    };
    automaticFiling.refuseOnce = true;
    onTestFinished(() => {
      automaticFiling.refuseOnce = false;
    });
    const first = await give(saleId, full);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(await correctionsOf(saleId)).toEqual([{ state: "open", correctiveSaleId: null }]);
    return full;
  }

  it("refuses a printer this till is not offered, filing nothing", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { card: "37.00" });
    const full = await leftOpen(saleId);
    const before = await writtenOn(saleId);
    const resend = await give(saleId, {
      ...full,
      correctiveDelivery: { medium: "print", printerId: backOfficeId },
    });
    expect(resend.status, JSON.stringify(resend.json)).toBe(409);
    expect(resend.json).toEqual({
      code: "invoice_delivery.printer_invalid",
      params: { field: "correctiveDelivery.printerId" },
    });
    expect(await correctionsOf(saleId)).toEqual([{ state: "open", correctiveSaleId: null }]);
    expect(await writtenOn(saleId)).toEqual(before);
  });

  it("refuses email on a box that cannot send it, filing nothing", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { card: "37.00" });
    const full = await leftOpen(saleId);
    const before = await writtenOn(saleId);
    const resend = await give(
      saleId,
      { ...full, correctiveDelivery: { medium: "email", recipient: "someone@else.example" } },
      venue.app,
    );
    expect(resend.status, JSON.stringify(resend.json)).toBe(409);
    expect(resend.json).toEqual({
      code: "invoice_delivery.email_unavailable",
      params: { field: "correctiveDelivery.recipient" },
    });
    expect(await correctionsOf(saleId)).toEqual([{ state: "open", correctiveSaleId: null }]);
    expect(await writtenOn(saleId)).toEqual(before);
  });

  it("files it the way a resend's offered choice names", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { card: "37.00" });
    const full = await leftOpen(saleId);
    const resend = await give(saleId, {
      ...full,
      correctiveDelivery: { medium: "email", recipient: "ana@example.com" },
    });
    expect(resend.status, JSON.stringify(resend.json)).toBe(200);
    const [row] = await correctionsOf(saleId);
    expect(row!.state).toBe("filed");
    expect(await deliveriesOf(row!.correctiveSaleId!)).toEqual([
      { medium: "email", recipient: "ana@example.com", printerId: null },
    ]);
  });

  it("files it the default way when the resend carries no choice", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { card: "37.00" });
    const full: Record<string, unknown> = { ...(await leftOpen(saleId)) };
    delete full.correctiveDelivery;
    const resend = await give(saleId, full);
    expect(resend.status, JSON.stringify(resend.json)).toBe(200);
    const [row] = await correctionsOf(saleId);
    expect(row!.state).toBe("filed");
    expect(await jobsOf(row!.correctiveSaleId!)).toEqual([
      { printerId: receiptPrinterId(), kind: "document" },
    ]);
    expect(await deliveriesOf(row!.correctiveSaleId!)).toEqual([
      { medium: "receipt", recipient: null, printerId: null },
    ]);
  });
});
