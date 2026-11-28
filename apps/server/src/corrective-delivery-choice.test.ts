import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
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
let mailApp: Hono;

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
    });
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
      correctiveDelivery: { medium: "email", recipient: "ana@empresa.es" },
    });
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "email", recipient: "ana@empresa.es", printerId: null },
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

  it("files a hand-keyed card's R1 after the press the way staff chose", async () => {
    const { saleId } = await fixture.fullInvoice(venue, { card: "37.00" });
    const way = fixture.tenderOf(venue, saleId, "card");
    const body = await pressBody(saleId, {
      way,
      correctiveDelivery: { medium: "email", recipient: "ana@empresa.es" },
    });
    const answer = await give(saleId, {
      ...body,
      manualConfirmed: true,
      override: { personId: venue.adminId, pin: "1234" },
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const r1 = await filedR1(answer);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "email", recipient: "ana@empresa.es", printerId: null },
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
      { ...body, correctiveDelivery: { medium: "email", recipient: "ana@empresa.es" } },
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
