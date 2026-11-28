import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { recordReplacement } from "@waitron/core";
import {
  deviceProfiles,
  devices,
  invoiceCorrections,
  invoiceDeliveries,
  outgoingMail,
  printers,
  printJobs,
  readLiveSeriesIdTx,
  sales,
  taxpayer,
} from "@waitron/db";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { seedDepartmentReceipt } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enqueuePrintJob } from "@waitron/printing";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { departments } from "@waitron/venue-service";
import type { Hono } from "hono";
import { refundProvidersOf } from "./bill-refunds.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import * as fixture from "./testing/full-invoice-give-back.js";
import { ask, type Part } from "./testing/full-invoice-give-back.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";

const fault = vi.hoisted(() => ({ readSentCorrective: false }));
vi.mock("./corrective-delivery.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./corrective-delivery.js")>();
  return {
    ...real,
    readSentCorrective: (...args: Parameters<typeof real.readSentCorrective>) =>
      fault.readSentCorrective
        ? Promise.reject(new Error("injected read fault"))
        : real.readSentCorrective(...args),
  };
});

let venue: BillVenue;
let reasonId: string;
/** The administrator, holding every right, signed in on the first till. */
let adminCookie: string;
let officeId: string;
/** The same routes on a box that can send invoice email now. */
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
      // An invoice email needs the department's contact address as well as working mail.
      for (const department of await tx.select().from(departments))
        await seedDepartmentReceipt(tx, department.id, {
          operationDescription: "Restaurante",
          email: "dining@example.test",
        });
      // The bill venue's tills cannot print receipts; these paths print on the receipt printer.
      for (const profile of await tx.select().from(deviceProfiles))
        await tx
          .update(deviceProfiles)
          .set({ capabilities: [...(profile.capabilities as string[]), "print-receipt"] })
          .where(eq(deviceProfiles.id, profile.id));
    });
    mailApp = venue.appWith({ invoiceEmailAvailable: () => Promise.resolve(true) });
  },
});

const giveBody = (
  saleId: string,
  amount: string,
  more: Parameters<typeof ask>[2] = {},
  app: Hono = mailApp,
) => fixture.giveBackBody(venue, adminCookie, saleId, ask("goodwill", amount, more), reasonId, app);

const give = (saleId: string, body: unknown, app: Hono = mailApp) =>
  send(app, adminCookie, "POST", `/api/transactions/${saleId}/give-back`, body);

async function fullInvoice(part: Part) {
  return (await fixture.fullInvoice(venue, part)).saleId;
}

/** The original's earlier delivery by `medium`, marked sent unless `failed`. */
async function deliveredOriginal(
  saleId: string,
  delivery: { medium: "email"; recipient: string } | { medium: "a4"; pagePrinterId: string },
  outcome: "sent" | "failed" = "sent",
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
    .set(
      outcome === "sent"
        ? { status: "sent" }
        : { status: "failed", failureCode: "transport_failed" },
    )
    .where(eq(invoiceDeliveries.id, row.id));
}

/** Replaces `saleId`, a full invoice AEAT refused, with an R4 naming the same customer; its sale. */
async function replacedByR4(saleId: string): Promise<string> {
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

/** The original printed on this till's receipt printer, with no delivery row tracking it. */
async function printedOriginal(saleId: string) {
  const job = await inTx(venue, (tx) =>
    enqueuePrintJob(tx, receiptPrinterId(), new Uint8Array([27, 64]), "document", {
      saleId,
      receiptCopy: false,
    }),
  );
  await venue.db
    .update(printJobs)
    .set({ status: "done", attempts: 1 })
    .where(eq(printJobs.id, job.jobId));
}

/** A copy of the already delivered original, printed on this till's receipt printer. */
async function printedCopy(saleId: string) {
  const row = await inTx(venue, async (tx) => {
    const job = await enqueuePrintJob(
      tx,
      receiptPrinterId(),
      new Uint8Array([27, 64]),
      "document",
      { saleId, receiptCopy: true },
    );
    return reserveInvoiceDelivery(tx, saleId, {
      requestKey: randomUUID(),
      personId: venue.adminId,
      medium: "receipt",
      printJobId: job.jobId,
    });
  });
  expect(row.designation).toBe("duplicate");
  await venue.db
    .update(printJobs)
    .set({ status: "done", attempts: 1 })
    .where(eq(printJobs.id, row.printJobId!));
  await venue.db
    .update(invoiceDeliveries)
    .set({ status: "sent" })
    .where(eq(invoiceDeliveries.id, row.id));
}

/** The R1's corrective part of a give-back answer. */
function correctivePart(answer: { json: unknown }) {
  return (answer.json as { parts: { corrective?: Record<string, unknown> }[] }).parts[0]!
    .corrective as
    | {
        delivery: { medium: string; invoiceRecipientEmail?: string } | null;
        printedOnReceiptNotA4: boolean;
      }
    | undefined;
}

/** Gives back 10.00 in cash on `saleId` and answers the filed R1's id with the answer. */
async function givenBackInCash(saleId: string, app: Hono = mailApp) {
  const answer = await give(saleId, await giveBody(saleId, "10.00", {}, app), app);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  const correction = await correctionOf(answer);
  expect(correction.state).toBe("filed");
  return { answer, correction, r1: correction.correctiveSaleId! };
}

/** The R1's one delivery's medium and recipient, and whether it printed on the receipt printer. */
async function wayOf(r1: string) {
  const sent = await deliveriesOf(r1);
  expect(sent).toHaveLength(1);
  const jobs = await jobsOf(r1);
  return {
    medium: sent[0]!.medium,
    recipient: sent[0]!.recipient,
    printerId: sent[0]!.printerId,
    receiptJobs: jobs.filter((job) => job.kind === "document").map((job) => job.printerId),
  };
}

const invoiceMails = async () =>
  (
    await venue.db
      .select({ id: outgoingMail.id })
      .from(outgoingMail)
      .where(eq(outgoingMail.kind, "invoice"))
  ).length;

const PAPER = (printerId: string) => ({
  medium: "receipt",
  recipient: null,
  printerId: null,
  receiptJobs: [printerId],
});
const EMAIL = {
  medium: "email",
  recipient: "accounts@harbour.example",
  printerId: null,
  receiptJobs: [],
};

async function correctionOf(answer: { json: Record<string, unknown> }) {
  const id = (answer.json as { parts: { correctionId?: string }[] }).parts.find(
    (part) => part.correctionId !== undefined,
  )!.correctionId!;
  const [row] = await venue.db
    .select()
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, id));
  return row!;
}

/** Every original print job of `saleId`, read from the print-job table. */
const jobsOf = (saleId: string) =>
  venue.db
    .select({ printerId: printJobs.printerId, copy: printJobs.receiptCopy, kind: printJobs.kind })
    .from(printJobs)
    .where(eq(printJobs.saleId, saleId));

const deliveriesOf = (saleId: string) =>
  venue.db
    .select({
      requestKey: invoiceDeliveries.requestKey,
      personId: invoiceDeliveries.personId,
      medium: invoiceDeliveries.medium,
      designation: invoiceDeliveries.designation,
      status: invoiceDeliveries.status,
      recipient: invoiceDeliveries.recipient,
      printerId: invoiceDeliveries.printerId,
      failureCode: invoiceDeliveries.failureCode,
    })
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.saleId, saleId));

const receiptPrinterId = () =>
  venue.db.all<{ id: string }>(
    sql`select receipt_printer_id as id from devices where id = ${venue.deviceId}`,
  )[0]!.id;

describe("a corrective full invoice is sent once, when it is filed, the way the invoice it corrects went", () => {
  it("given back in cash on a full invoice of which nothing was ever sent, prints the R1 once on this till's receipt printer and says so", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    const answer = await give(saleId, await giveBody(saleId, "10.00"));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const correction = await correctionOf(answer);
    expect(correction.state).toBe("filed");
    const r1 = correction.correctiveSaleId!;
    expect(await jobsOf(r1)).toEqual([
      { printerId: receiptPrinterId(), copy: false, kind: "document" },
    ]);
    expect(await deliveriesOf(r1)).toEqual([
      {
        requestKey: `corrective:${correction.id}`,
        personId: venue.adminId,
        medium: "receipt",
        designation: "original",
        status: "queued",
        recipient: null,
        printerId: null,
        failureCode: null,
      },
    ]);
    const [number] = venue.db.all<{ number: string }>(
      sql`select s.code || '-' || sa.invoice_number as number from sales sa
          join invoice_series s on s.id = sa.series_id where sa.id = ${r1}`,
    );
    expect(answer.json).toMatchObject({
      parts: [
        {
          kind: "correction",
          state: "completed",
          corrective: {
            saleId: r1,
            customerName: "Harbour Foods",
            amount: "10.00",
            delivery: { medium: "receipt", status: "queued" },
          },
        },
      ],
    });
    const part = (answer.json as { parts: { corrective: { invoiceNumber: string } }[] }).parts[0]!;
    expect(part.corrective.invoiceNumber.replace(/[^0-9A-Z]/g, "")).toBe(
      number!.number.replace(/[^0-9A-Z]/g, ""),
    );
  });

  it("files a late card answer's R1 by email when the original was emailed, under the person who opened the give-back", async () => {
    const saleId = await fullInvoice({ reader: "37.00" });
    await deliveredOriginal(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const reader = fixture.tenderOf(venue, saleId, "card");
    // The card company makes the refund but its answer is lost; the recovery pass finds it later.
    venue.card.scriptNextRefund({
      made: "completed",
      answer: { kind: "uncertain", reason: "network" },
    });
    const answer = await give(saleId, await giveBody(saleId, "10.00", { way: reader }));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({ parts: [{ kind: "correction", state: "pending" }] });
    expect((await correctionOf(answer)).state).toBe("open");
    await recoverTenderRefunds({
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      admission: testTradingAdmission(),
      cfg: venue.cfg,
      refundProviderFor: refundProvidersOf({ pool: venue.pool }),
      invoiceEmailAvailable: () => Promise.resolve(true),
    });
    const correction = await correctionOf(answer);
    expect(correction.state).toBe("filed");
    const r1 = correction.correctiveSaleId!;
    const sent = await deliveriesOf(r1);
    expect(sent).toEqual([
      {
        requestKey: `corrective:${correction.id}`,
        personId: venue.adminId,
        medium: "email",
        designation: "original",
        status: "queued",
        recipient: "accounts@harbour.example",
        printerId: null,
        failureCode: null,
      },
    ]);
    const [delivery] = await venue.db
      .select({ id: invoiceDeliveries.id })
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.saleId, r1));
    expect(
      await venue.db
        .select({ kind: outgoingMail.kind })
        .from(outgoingMail)
        .where(eq(outgoingMail.dedupeKey, `invoice:${delivery!.id}`)),
    ).toEqual([{ kind: "invoice" }]);
    expect(await jobsOf(r1)).toEqual([]);
  });

  it("prints the R1 on this till's receipt printer when the original went on an A4 printer that is not this till's own", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "a4", pagePrinterId: officeId });
    await venue.db.update(printers).set({ active: false }).where(eq(printers.id, officeId));
    onTestFinished(async () => {
      await venue.db.update(printers).set({ active: true }).where(eq(printers.id, officeId));
    });
    const { answer, correction, r1 } = await givenBackInCash(saleId);
    expect(correctivePart(answer)?.printedOnReceiptNotA4).toBe(true);
    expect(await deliveriesOf(r1)).toEqual([
      expect.objectContaining({
        requestKey: `corrective:${correction.id}`,
        medium: "receipt",
        status: "queued",
        printerId: null,
      }),
    ]);
    expect(await jobsOf(r1)).toEqual([
      { printerId: receiptPrinterId(), copy: false, kind: "document" },
    ]);
  });

  it("sends the R1 to this till's own A4 printer when the original went on A4", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "a4", pagePrinterId: officeId });
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
    const { answer, r1 } = await givenBackInCash(saleId);
    expect(correctivePart(answer)?.printedOnReceiptNotA4).toBe(false);
    expect(await wayOf(r1)).toEqual({
      medium: "a4",
      recipient: null,
      printerId: officeId,
      receiptJobs: [],
    });
  });

  it("emails the R1 when the original was emailed", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const { answer, r1 } = await givenBackInCash(saleId);
    expect(await wayOf(r1)).toEqual(EMAIL);
    expect(correctivePart(answer)?.printedOnReceiptNotA4).toBe(false);
    expect(correctivePart(answer)?.delivery).toMatchObject({
      medium: "email",
      status: "queued",
      invoiceRecipientEmail: "accounts@harbour.example",
    });
  });

  it("prints the R1 on paper when the original was printed on paper", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await printedOriginal(saleId);
    const { answer, r1 } = await givenBackInCash(saleId);
    expect(correctivePart(answer)?.printedOnReceiptNotA4).toBe(false);
    expect(await wayOf(r1)).toEqual(PAPER(receiptPrinterId()));
  });

  it("emails the R1 to the address its replacement went to, when the invoice given back on was replaced", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "email", recipient: "old@harbour.example" });
    const r4 = await replacedByR4(saleId);
    await deliveredOriginal(r4, { medium: "email", recipient: "current@harbour.example" });
    const { r1 } = await givenBackInCash(saleId);
    const [filed] = await venue.db
      .select({ corrects: sales.correctsSaleId })
      .from(sales)
      .where(eq(sales.id, r1));
    expect(filed!.corrects).toBe(r4);
    expect(await wayOf(r1)).toEqual({ ...EMAIL, recipient: "current@harbour.example" });
  });

  it("emails the R1 to the address the replaced invoice went to, when its replacement was never sent", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const r4 = await replacedByR4(saleId);
    const { r1 } = await givenBackInCash(saleId);
    const [filed] = await venue.db
      .select({ corrects: sales.correctsSaleId })
      .from(sales)
      .where(eq(sales.id, r1));
    expect(filed!.corrects).toBe(r4);
    expect(await wayOf(r1)).toEqual(EMAIL);
  });

  it("prints the R1 on paper when the replacement of the invoice given back on was printed on paper, though that invoice was emailed", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "email", recipient: "old@harbour.example" });
    const r4 = await replacedByR4(saleId);
    await printedOriginal(r4);
    const { r1 } = await givenBackInCash(saleId);
    expect(await wayOf(r1)).toEqual(PAPER(receiptPrinterId()));
  });

  it("emails the R1 when the original was emailed and a paper copy printed afterwards", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    await printedCopy(saleId);
    const { r1 } = await givenBackInCash(saleId);
    expect(await wayOf(r1)).toEqual(EMAIL);
  });

  it("prints the R1 on paper when the original's email failed and it was then printed on paper", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(
      saleId,
      { medium: "email", recipient: "accounts@harbour.example" },
      "failed",
    );
    await printedOriginal(saleId);
    const { r1 } = await givenBackInCash(saleId);
    expect(await wayOf(r1)).toEqual(PAPER(receiptPrinterId()));
  });

  it("follows the original's newest attempt when it never went out: a failed email is emailed again", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(
      saleId,
      { medium: "email", recipient: "accounts@harbour.example" },
      "failed",
    );
    const { r1 } = await givenBackInCash(saleId);
    expect(await wayOf(r1)).toEqual(EMAIL);
  });

  it("prints the R1 on the receipt printer when this box cannot send invoice email, and does not say it is being emailed", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const mailsBefore = await invoiceMails();
    const { answer, r1 } = await givenBackInCash(saleId, venue.app);
    expect(await wayOf(r1)).toEqual(PAPER(receiptPrinterId()));
    expect(await invoiceMails()).toBe(mailsBefore);
    expect(correctivePart(answer)?.delivery).toMatchObject({ medium: "receipt" });
  });

  it("does not show the email address to a till that may not print receipts", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "email", recipient: "accounts@harbour.example" });
    const [device] = await venue.db
      .select({ profileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, venue.deviceId));
    const [profile] = await venue.db
      .select({ capabilities: deviceProfiles.capabilities })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, device!.profileId));
    const capabilities = profile!.capabilities as string[];
    await venue.db
      .update(deviceProfiles)
      .set({ capabilities: capabilities.filter((name) => name !== "print-receipt") })
      .where(eq(deviceProfiles.id, device!.profileId));
    onTestFinished(async () => {
      await venue.db
        .update(deviceProfiles)
        .set({ capabilities })
        .where(eq(deviceProfiles.id, device!.profileId));
    });
    const { answer, r1 } = await givenBackInCash(saleId);
    expect(await wayOf(r1)).toEqual(EMAIL);
    const delivery = correctivePart(answer)!.delivery!;
    expect(delivery.medium).toBe("email");
    expect(delivery).not.toHaveProperty("invoiceRecipientEmail");
    expect(JSON.stringify(answer.json)).not.toContain("accounts@harbour.example");
  });

  it("keeps the cash given back and the filing when reading the corrective for the answer fails", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    fault.readSentCorrective = true;
    onTestFinished(() => {
      fault.readSentCorrective = false;
    });
    const { answer, correction, r1 } = await givenBackInCash(saleId);
    expect(correctivePart(answer)).toBeUndefined();
    expect(await jobsOf(r1)).toHaveLength(1);
    const [given] = venue.db.all<{ total: number }>(
      sql`select coalesce(sum(r.applied_amount), 0) as total from refunds r
          join invoice_correction_refunds l on l.tender_refund_id = r.id
          where l.invoice_correction_id = ${correction.id} and r.state = 'completed'`,
    );
    expect(given!.total).toBe(1000);
  });

  it("queues nothing and keeps the filing when the till that opened it has no receipt printer", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    const printerId = receiptPrinterId();
    await venue.db
      .update(devices)
      .set({ receiptPrinterId: null })
      .where(eq(devices.id, venue.deviceId));
    onTestFinished(async () => {
      await venue.db
        .update(devices)
        .set({ receiptPrinterId: printerId })
        .where(eq(devices.id, venue.deviceId));
    });
    const answer = await give(saleId, await giveBody(saleId, "10.00"));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const correction = await correctionOf(answer);
    expect(correction.state).toBe("filed");
    const r1 = correction.correctiveSaleId!;
    expect(await jobsOf(r1)).toEqual([]);
    expect(await deliveriesOf(r1)).toEqual([]);
    expect(answer.json).toMatchObject({
      parts: [{ kind: "correction", corrective: { saleId: r1, delivery: null } }],
    });
  });

  it("sends nothing again when the same press is sent again", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    const body = await giveBody(saleId, "10.00");
    const first = await give(saleId, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const r1 = (await correctionOf(first)).correctiveSaleId!;
    const again = await give(saleId, body);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await jobsOf(r1)).toHaveLength(1);
    expect(await deliveriesOf(r1)).toHaveLength(1);
    expect(
      await venue.db
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(and(eq(printJobs.saleId, r1), eq(printJobs.receiptCopy, true))),
    ).toEqual([]);
  });
});
