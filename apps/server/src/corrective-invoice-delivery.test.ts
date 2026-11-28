import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { recordReplacement } from "@waitron/core";
import {
  deviceProfiles,
  devices,
  invoiceCorrections,
  invoiceDeliveries,
  printJobs,
  readLiveSeriesIdTx,
  receiptReprints,
  sales,
  saveVenueFields,
  taxpayer,
} from "@waitron/db";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { loginWithPin, startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter, MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { AppError, saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { readUndeliveredInvoices } from "./alert-sources.js";
import { readDocumentOffers, type RoutingDeps } from "./document-printer-offers.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { readInvoiceDeliveries } from "./invoice-delivery-status.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { resendInvoicePrintJob } from "./invoice-print.js";
import { reprintJobOn } from "./print-job-reprint.js";
import { deletePrinter } from "./printer-delete.js";
import {
  enqueueOriginalReceipt,
  enqueueReceiptCopy,
  resolveReceiptPrinter,
  saleReceiptLayout,
} from "./receipt-print.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import * as fixture from "./testing/full-invoice-give-back.js";
import { ask } from "./testing/full-invoice-give-back.js";
import { readTransactionReceipt } from "./transaction-receipt.js";

let venue: BillVenue;
let reasonId: string;
/** The administrator, holding every right, signed in on the first till. */
let adminCookie: string;
let managementSessionId: string;
let officeId: string;

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
      managementSessionId = (
        await startManagementSession(tx, { method: "password", personId: venue.adminId })
      ).token;
      officeId = await insertA4Printer(tx, { name: "Office", host: "10.0.0.9" });
    });
  },
});

/** An R1: €10.00 of goodwill given back in cash on a full invoice; the corrective's sale. */
async function filedR1(): Promise<string> {
  const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
  const answer = await send(
    venue.app,
    adminCookie,
    "POST",
    `/api/transactions/${saleId}/give-back`,
    {
      ...(await fixture.giveBackBody(
        venue,
        adminCookie,
        saleId,
        ask("goodwill", "10.00"),
        reasonId,
      )),
    },
  );
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  const correctionId = (answer.json as { parts: { correctionId?: string }[] }).parts.find(
    (part) => part.correctionId !== undefined,
  )!.correctionId!;
  const [row] = await venue.db
    .select({ corrective: invoiceCorrections.correctiveSaleId })
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, correctionId));
  return row!.corrective!;
}

/** An R4: the replacement of a full invoice AEAT refused; its sale. Nothing prints it. */
async function filedR4(): Promise<string> {
  const { saleId } = await fixture.fullInvoice(venue, { cash: "37.00" });
  return inTx(venue, async (tx) => {
    await refusedByAeat(tx, saleId);
    const session = await loginWithPin(tx, {
      deviceId: venue.deviceId,
      personId: venue.adminId,
      pin: "1234",
    });
    const replaced = await recordReplacement(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "full_corrective")),
      correctsSaleId: brandSaleId(saleId),
      authz: { sessionId: session.id },
      clock: venue.clock,
    });
    return replaced.saleId as string;
  });
}

/** Queues the sale's original receipt with no person asking, as a corrective's filing does; its job. */
async function printedOriginal(saleId: string): Promise<string> {
  await inTx(venue, async (tx) =>
    enqueueOriginalReceipt(
      tx,
      venue.cfg,
      await readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
      saleId,
    ),
  );
  return originalJobOf(saleId);
}

function originalJobOf(saleId: string): string {
  return venue.db.all<{ id: string }>(
    sql`select id from print_jobs where sale_id = ${saleId} and kind = 'document'
        and receipt_copy = 0 and resend_of is null`,
  )[0]!.id;
}

const deliveriesOf = (saleId: string) =>
  venue.db
    .select({
      medium: invoiceDeliveries.medium,
      designation: invoiceDeliveries.designation,
      status: invoiceDeliveries.status,
    })
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.saleId, saleId));

const printsOf = (saleId: string) =>
  venue.db
    .select({ id: printJobs.id, receiptCopy: printJobs.receiptCopy, status: printJobs.status })
    .from(printJobs)
    .where(eq(printJobs.saleId, saleId));

const reprintsOf = (saleId: string) =>
  venue.db
    .select({ printJobId: receiptReprints.printJobId })
    .from(receiptReprints)
    .where(eq(receiptReprints.saleId, saleId));

/** The till's Reprint in Find a bill, sent while the till's profile may print receipts. */
async function tillReprint(saleId: string, body: { language?: string } = {}) {
  const [device] = await venue.db
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, venue.deviceId));
  const [profile] = await venue.db
    .select({ capabilities: deviceProfiles.capabilities })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, device!.profileId!));
  const capabilities = profile!.capabilities as string[];
  await venue.db
    .update(deviceProfiles)
    .set({ capabilities: [...capabilities, "print-receipt"] })
    .where(eq(deviceProfiles.id, device!.profileId!));
  try {
    return await send(venue.app, adminCookie, "POST", `/api/transactions/${saleId}/reprint`, body);
  } finally {
    await venue.db
      .update(deviceProfiles)
      .set({ capabilities })
      .where(eq(deviceProfiles.id, device!.profileId!));
  }
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

const reserveA4 = (saleId: string) =>
  inTx(venue, (tx) =>
    reserveInvoiceDelivery(tx, saleId, {
      requestKey: randomUUID(),
      personId: venue.adminId,
      medium: "a4",
      pagePrinterId: officeId,
    }),
  );

describe("a corrective full invoice (R1) is delivered as a full invoice; a replacement (R4) is not", () => {
  it("reserves an A4 delivery for an R1, and refuses one for an R4", async () => {
    const r1 = await filedR1();
    const r4 = await filedR4();
    await expect(reserveA4(r1)).resolves.toMatchObject({ medium: "a4", designation: "original" });
    expect(await refusal(reserveA4(r4))).toBe("invoice_delivery.full_invoice_required");
    expect(await deliveriesOf(r4)).toEqual([]);
  });

  it("reads an R1's delivery status, and none for an R4", async () => {
    const r1 = await filedR1();
    const r4 = await filedR4();
    const read = (saleId: string) =>
      inTx(venue, (tx) => readInvoiceDeliveries(tx, saleId, { emailAvailable: false }));
    expect(await read(r1)).not.toBeNull();
    expect(await read(r4)).toBeNull();
  });

  it("lays out an R1's A4 document, and refuses an R4's", async () => {
    const r1 = await filedR1();
    const r4 = await filedR4();
    const read = (saleId: string) =>
      inTx(venue, (tx) => readInvoiceDocument(venue.backend, tx, venue.cfg, saleId));
    await expect(read(r1)).resolves.toMatchObject({ result: { invoiceType: "R1" } });
    expect(await refusal(read(r4))).toBe("invoice_delivery.full_invoice_required");
  });

  it("offers the invoice document on an R1, and only the receipt on an R4", async () => {
    const r1 = await filedR1();
    const r4 = await filedR4();
    const deps: RoutingDeps = {
      backend: venue.backend,
      cfg: { ...venue.cfg, locale: "en" },
      emailAvailable: true,
      originSource: {
        current: () => ({
          applianceId: venue.cfg.nodeId,
          nodeId: venue.cfg.nodeId,
          recoveryEpoch: "aaaaaaaa-bbbb-cccc-dddd-000000000001",
        }),
      },
    };
    const offers = (saleId: string, document: "receipt" | "invoice") =>
      inTx(venue, (tx) =>
        readDocumentOffers(
          tx,
          deps,
          { surface: "dashboard", managementSessionId, deviceProof: null },
          saleId,
          document,
        ),
      );
    await expect(offers(r1, "invoice")).resolves.toMatchObject({
      documents: ["receipt", "invoice"],
    });
    await expect(offers(r4, "receipt")).resolves.toMatchObject({ documents: ["receipt"] });
    expect(await refusal(offers(r4, "invoice"))).toBe("management.request_invalid");
  });

  it("tracks an R1's resent original receipt as its delivery, and leaves an R4's untracked", async () => {
    const r1 = await filedR1();
    const r4 = await filedR4();
    const jobs = [await printedOriginal(r1), await printedOriginal(r4)];
    for (const jobId of jobs)
      await venue.db
        .update(printJobs)
        .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
        .where(eq(printJobs.id, jobId));
    for (const jobId of jobs)
      await inTx(venue, (tx) =>
        resendInvoicePrintJob(
          tx,
          saleReceiptLayout(venue.backend, venue.cfg),
          jobId,
          venue.adminId,
        ),
      );
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "receipt", designation: "original", status: "queued" },
    ]);
    expect(await deliveriesOf(r4)).toEqual([]);
  });

  it("alerts an R1 whose original receipt failed for good, and not an R4", async () => {
    const r1 = await filedR1();
    const r4 = await filedR4();
    for (const jobId of [await printedOriginal(r1), await printedOriginal(r4)])
      await venue.db
        .update(printJobs)
        .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
        .where(eq(printJobs.id, jobId));
    const undelivered = await inTx(venue, (tx) =>
      readUndeliveredInvoices(tx, new Date(), { holdOn: () => null }),
    );
    const ids = undelivered.map(({ sale }) => sale.id);
    expect(ids).toContain(r1);
    expect(ids).not.toContain(r4);
  });

  it("reprints a printed R1 as its duplicate delivery, and an R4 as an untracked copy", async () => {
    const r1 = await filedR1();
    const r4 = await filedR4();
    const jobs = [await printedOriginal(r1), await printedOriginal(r4)];
    for (const jobId of jobs)
      await venue.db
        .update(printJobs)
        .set({ status: "done", deliveredAt: new Date().toISOString() })
        .where(eq(printJobs.id, jobId));
    for (const jobId of jobs)
      await inTx(venue, (tx) =>
        reprintJobOn(
          tx,
          saleReceiptLayout(venue.backend, venue.cfg),
          jobId,
          undefined,
          venue.adminId,
          new Date(),
          { seen: () => true },
        ),
      );
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "receipt", designation: "duplicate", status: "queued" },
    ]);
    expect(await deliveriesOf(r4)).toEqual([]);
    expect(
      await venue.db
        .select({ receiptCopy: printJobs.receiptCopy })
        .from(printJobs)
        .where(eq(printJobs.saleId, r4)),
    ).toContainEqual({ receiptCopy: true });
  });

  it("tracks a copy a person asks for of a printed R1 as its delivery, and not an R4's", async () => {
    const r1 = await filedR1();
    const r4 = await filedR4();
    for (const jobId of [await printedOriginal(r1), await printedOriginal(r4)])
      await venue.db
        .update(printJobs)
        .set({ status: "done", deliveredAt: new Date().toISOString() })
        .where(eq(printJobs.id, jobId));
    for (const saleId of [r1, r4])
      await inTx(venue, async (tx) => {
        const printer = await resolveReceiptPrinter(tx, venue.cfg.origin);
        await enqueueReceiptCopy(
          tx,
          venue.cfg,
          await readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
          saleId,
          printer!,
          undefined,
          venue.adminId,
        );
      });
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "receipt", designation: "duplicate", status: "queued" },
    ]);
    expect(await deliveriesOf(r4)).toEqual([]);
  });

  it("prints an R1 already emailed as a copy, tracked as its duplicate delivery", async () => {
    const r1 = await filedR1();
    const email = await inTx(venue, (tx) =>
      reserveInvoiceDelivery(tx, r1, {
        requestKey: randomUUID(),
        personId: venue.adminId,
        medium: "email",
        recipient: "accounts@harbour.example",
      }),
    );
    await venue.db
      .update(invoiceDeliveries)
      .set({ status: "sent" })
      .where(eq(invoiceDeliveries.id, email.id));
    const made = await inTx(venue, async (tx) =>
      enqueueOriginalReceipt(
        tx,
        venue.cfg,
        await readTransactionReceipt(venue.backend, tx, venue.cfg, r1),
        r1,
        { personId: venue.adminId },
      ),
    );
    expect(made).toMatchObject({ receiptCopy: true });
    expect(await deliveriesOf(r1)).toEqual(
      expect.arrayContaining([
        { medium: "email", designation: "original", status: "sent" },
        { medium: "receipt", designation: "duplicate", status: "queued" },
      ]),
    );
  });

  it("files the R1 with no department of its own, so its email contact comes from the invoice it corrects", async () => {
    const r1 = await filedR1();
    const [row] = await venue.db
      .select({ department: sales.receiptDepartmentId, corrects: sales.correctsSaleId })
      .from(sales)
      .where(eq(sales.id, r1));
    const [original] = await venue.db
      .select({ department: sales.receiptDepartmentId })
      .from(sales)
      .where(eq(sales.id, row!.corrects!));
    expect(row!.department).toBeNull();
    expect(original!.department).not.toBeNull();
  });

  it("files the R4 with no department of its own, so an R1 against it reaches past it for a contact", async () => {
    const r4 = await filedR4();
    const [row] = await venue.db
      .select({ department: sales.receiptDepartmentId })
      .from(sales)
      .where(eq(sales.id, r4));
    expect(row!.department).toBeNull();
  });

  it("prints an R1 that never printed as its original from the till's Reprint, tracked as its delivery", async () => {
    const r1 = await filedR1();
    expect(await printsOf(r1)).toEqual([]);
    const answer = await tillReprint(r1);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await printsOf(r1)).toEqual([
      { id: expect.any(String), receiptCopy: false, status: "queued" },
    ]);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "receipt", designation: "original", status: "queued" },
    ]);
    expect(await reprintsOf(r1)).toEqual([]);
  });

  it("prints a new original of an R1 whose original failed for good from the till's Reprint", async () => {
    const r1 = await filedR1();
    const failed = await printedOriginal(r1);
    await venue.db
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
      .where(eq(printJobs.id, failed));
    const answer = await tillReprint(r1);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((await printsOf(r1)).filter((job) => job.id !== failed)).toEqual([
      { id: expect.any(String), receiptCopy: false, status: "queued" },
    ]);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "receipt", designation: "original", status: "queued" },
    ]);
    expect(await reprintsOf(r1)).toEqual([]);
  });

  it("prints a printed R1 as a copy from the till's Reprint, tracked as its duplicate and recorded as a reprint", async () => {
    const r1 = await filedR1();
    const printed = await printedOriginal(r1);
    await venue.db
      .update(printJobs)
      .set({ status: "done", deliveredAt: new Date().toISOString() })
      .where(eq(printJobs.id, printed));
    const answer = await tillReprint(r1);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const copies = (await printsOf(r1)).filter((job) => job.id !== printed);
    expect(copies).toEqual([{ id: expect.any(String), receiptCopy: true, status: "queued" }]);
    expect(await deliveriesOf(r1)).toEqual([
      { medium: "receipt", designation: "duplicate", status: "queued" },
    ]);
    expect(await reprintsOf(r1)).toEqual([{ printJobId: copies[0]!.id }]);
  });

  it("prints an R1 emailed but never printed as a copy from the till's Reprint", async () => {
    const r1 = await filedR1();
    const email = await inTx(venue, (tx) =>
      reserveInvoiceDelivery(tx, r1, {
        requestKey: randomUUID(),
        personId: venue.adminId,
        medium: "email",
        recipient: "accounts@harbour.example",
      }),
    );
    await venue.db
      .update(invoiceDeliveries)
      .set({ status: "sent" })
      .where(eq(invoiceDeliveries.id, email.id));
    const answer = await tillReprint(r1);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const [copy] = await printsOf(r1);
    expect(copy).toEqual({ id: expect.any(String), receiptCopy: true, status: "queued" });
    expect(await deliveriesOf(r1)).toEqual(
      expect.arrayContaining([{ medium: "receipt", designation: "duplicate", status: "queued" }]),
    );
    expect(await reprintsOf(r1)).toEqual([{ printJobId: copy!.id }]);
  });

  it("expires an R1's lapsed print claim from the till's Reprint, then prints it", async () => {
    const r1 = await filedR1();
    const made = await inTx(venue, async (tx) =>
      enqueueOriginalReceipt(
        tx,
        venue.cfg,
        await readTransactionReceipt(venue.backend, tx, venue.cfg, r1),
        r1,
        { personId: venue.adminId },
      ),
    );
    if (typeof made !== "object") throw new Error(`no original queued: ${made}`);
    const stuck = made.jobId;
    await venue.db
      .update(printJobs)
      .set({ status: "printing", claimedAt: new Date(Date.now() - 24 * 3_600_000).toISOString() })
      .where(eq(printJobs.id, stuck));
    await venue.db
      .update(invoiceDeliveries)
      .set({ status: "sending" })
      .where(eq(invoiceDeliveries.printJobId, stuck));
    const answer = await tillReprint(r1);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await deliveriesOf(r1)).toEqual(
      expect.arrayContaining([{ medium: "receipt", designation: "original", status: "unknown" }]),
    );
  });

  // Last in the file: it deletes the receipt printer every till shares and changes the venue's
  // receipt language.
  it("prints a new original of an R1 whose printer was deleted, on the new printer and in the chosen language", async () => {
    const r1 = await filedR1();
    const lost = await printedOriginal(r1);
    const [old] = await venue.db
      .select({ printerId: printJobs.printerId })
      .from(printJobs)
      .where(eq(printJobs.id, lost));
    const replacement = await inTx(venue, async (tx) => {
      await deletePrinter(tx, old!.printerId);
      const printer = await createPrinter(tx, {
        name: "New receipt printer",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
        hasCashDrawer: true,
      });
      await tx.update(devices).set({
        receiptPrinterId: printer.id,
        paymentSlipPrinterId: printer.id,
        cashDrawerPrinterId: printer.id,
      });
      return printer.id;
    });
    const [ended] = await venue.db
      .select({ status: printJobs.status, lastError: printJobs.lastError })
      .from(printJobs)
      .where(eq(printJobs.id, lost));
    expect(ended).toEqual({ status: "failed", lastError: "printer.deleted" });
    // A language other than the R1's own: the venue's receipt language, changed since it was filed.
    const language = "en-GB";
    await inTx(venue, (tx) => saveVenueFields(tx, { invoiceLocales: [language, "es-ES"] }, null));
    const answer = await tillReprint(r1, { language });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const fresh = await venue.db
      .select({
        printerId: printJobs.printerId,
        receiptCopy: printJobs.receiptCopy,
        pageLanguage: printJobs.pageLanguage,
      })
      .from(printJobs)
      .where(eq(printJobs.saleId, r1));
    expect(fresh).toEqual(
      expect.arrayContaining([
        { printerId: replacement, receiptCopy: false, pageLanguage: language },
      ]),
    );
    expect(await reprintsOf(r1)).toEqual([]);
    const { decodeTicket } = await import("./testing/decode-ticket.js");
    const [printed] = venue.db.all<{ payload: Uint8Array }>(
      sql`select payload from print_jobs where sale_id = ${r1} and printer_id = ${replacement}`,
    );
    expect(decodeTicket(printed!.payload)).toContain("Corrective invoice");
  });
});
