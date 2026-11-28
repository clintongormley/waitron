import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { listAdjustmentReasons } from "@waitron/adjustments";
import {
  deviceProfiles,
  devices,
  invoiceCorrections,
  invoiceDeliveries,
  outgoingMail,
  printers,
  printJobs,
  taxpayer,
} from "@waitron/db";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readUndeliveredInvoices } from "./alert-sources.js";
import { refundProvidersOf } from "./bill-refunds.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import * as fixture from "./testing/full-invoice-give-back.js";
import { ask, type Part } from "./testing/full-invoice-give-back.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";

let venue: BillVenue;
let reasonId: string;
/** The administrator, holding every right, signed in on the first till. */
let adminCookie: string;
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
      officeId = await insertA4Printer(tx, { name: "Office", host: "10.0.0.9" });
      // The bill venue's tills cannot print receipts; these paths print on the receipt printer.
      for (const profile of await tx.select().from(deviceProfiles))
        await tx
          .update(deviceProfiles)
          .set({ capabilities: [...(profile.capabilities as string[]), "print-receipt"] })
          .where(eq(deviceProfiles.id, profile.id));
    });
  },
});

const giveBody = (saleId: string, amount: string, more: Parameters<typeof ask>[2] = {}) =>
  fixture.giveBackBody(venue, adminCookie, saleId, ask("goodwill", amount, more), reasonId);

const give = (saleId: string, body: unknown) =>
  send(venue.app, adminCookie, "POST", `/api/transactions/${saleId}/give-back`, body);

async function fullInvoice(part: Part) {
  return (await fixture.fullInvoice(venue, part)).saleId;
}

/** The original's earlier delivery by `medium`, marked sent. */
async function deliveredOriginal(
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

describe("a corrective full invoice is sent once, when it is filed, the way the original went", () => {
  it("given back in cash on a full invoice that went on paper, prints the R1 once on this till's receipt printer and says so", async () => {
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
            customer: "Harbour Foods",
            amount: "10.00",
            delivery: { medium: "receipt", status: "queued" },
          },
        },
      ],
    });
    const part = (answer.json as { parts: { corrective: { number: string } }[] }).parts[0]!;
    expect(part.corrective.number.replace(/[^0-9A-Z]/g, "")).toBe(
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

  it("raises an alert and keeps the filing when the original's A4 printer has been switched off since", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await deliveredOriginal(saleId, { medium: "a4", pagePrinterId: officeId });
    await venue.db.update(printers).set({ active: false }).where(eq(printers.id, officeId));
    onTestFinished(async () => {
      await venue.db.update(printers).set({ active: true }).where(eq(printers.id, officeId));
    });
    const answer = await give(saleId, await giveBody(saleId, "10.00"));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const correction = await correctionOf(answer);
    expect(correction.state).toBe("filed");
    const r1 = correction.correctiveSaleId!;
    expect(await deliveriesOf(r1)).toEqual([
      expect.objectContaining({
        requestKey: `corrective:${correction.id}`,
        medium: "a4",
        status: "failed",
        printerId: officeId,
        failureCode: "printer_disabled",
      }),
    ]);
    expect(await jobsOf(r1)).toEqual([]);
    const undelivered = await inTx(venue, (tx) =>
      readUndeliveredInvoices(tx, new Date(), { holdOn: () => null }),
    );
    expect(undelivered.map(({ sale }) => sale.id)).toContain(r1);
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
