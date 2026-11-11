import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  kitchenPrintJobs,
  kitchenStations,
  parties,
  printJobs,
  printers,
  receiptReprints,
  sales,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  MAX_DELIVERY_ATTEMPTS,
  createPrinter,
  enqueuePrintJob,
  esc,
  readPrintArea,
  textGrid,
  updatePrinter,
  type EscSetting,
} from "@waitron/printing";
import { AppError } from "@waitron/shared";
import { setZoneSalePolicyOverride } from "@waitron/venue-service";
import { deletePrinter } from "./printer-delete.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountPrintApi } from "./print-api.js";
import { reprintJobOn } from "./print-job-reprint.js";
import {
  enqueueSaleReceipt,
  layOutSaleReceipt,
  readOriginalReceiptPrint,
} from "./receipt-print.js";
import { readSettledTicket } from "./till-sale.js";
import { attachPrinterToStation } from "./station-printers.js";
import { inTx, send as rawGroupSend } from "./testing/bill-venue.js";
import { observedGroupSender } from "./testing/group-composition-fixture.js";
import { createTable } from "./testing/live-table.js";
import {
  billlessSale,
  collect,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import "./errors.js";

let venue: OrderVenue;
let kitchenPrinterId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, (tx) =>
      setZoneSalePolicyOverride(tx, venue.counterZone, "receiptPrintMode", "auto"),
    );
    kitchenPrinterId = await inTx(venue, async (tx) => {
      const [station] = await tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true));
      const { id } = await createPrinter(tx, {
        name: "Kitchen",
        transport: "network_tcp",
        host: "kitchen.test",
      });
      await attachPrinterToStation(tx, { stationId: station!.id, printerId: id });
      return id;
    });
  },
});

const send = observedGroupSender(() => venue.db, rawGroupSend);

const at58: EscSetting = { paperWidth: "58mm", resolution: "180dpi" };
const at80: EscSetting = { paperWidth: "80mm", resolution: "180dpi" };
const at80fine: EscSetting = { paperWidth: "80mm", resolution: "203dpi" };
const dots = (setting: EscSetting) => textGrid(setting.paperWidth, setting.resolution).widthDots;

const layOut = (tx: Transaction, saleId: string, duplicate: boolean, printer: EscSetting) =>
  layOutSaleReceipt(venue.backend, tx, venue.cfg, saleId, duplicate, printer);

function reprint(jobId: string, printerId: string, ownPrinterUnseen = false) {
  return inTx(venue, (tx) =>
    reprintJobOn(tx, layOut, jobId, printerId, venue.adminId, undefined, {
      seen: () => !ownPrinterUnseen,
    }),
  );
}

async function refusal(jobId: string, printerId: string): Promise<AppError> {
  const error = await reprint(jobId, printerId).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

function printerAt(setting: EscSetting, name = `Recibos ${randomUUID().slice(0, 8)}`) {
  return inTx(
    venue,
    async (tx) =>
      (
        await createPrinter(tx, {
          name,
          transport: "network_tcp",
          host: "receipt.test",
          ...setting,
        })
      ).id,
  );
}

async function jobRow(id: string) {
  return (await inTx(venue, (tx) => tx.select().from(printJobs).where(eq(printJobs.id, id))))[0]!;
}

function setJob(id: string, values: Partial<typeof printJobs.$inferInsert>) {
  return inTx(venue, (tx) => tx.update(printJobs).set(values).where(eq(printJobs.id, id)));
}

const exhausted = { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS } as const;

/** Moves a job onto a new printer at `setting` that is then switched off. */
async function onDisabledPrinter(
  jobId: string,
  setting: EscSetting,
  status: "queued" | "printing" = "queued",
) {
  const disabled = await printerAt(setting);
  await setJob(jobId, { printerId: disabled, status });
  await inTx(venue, (tx) => updatePrinter(tx, disabled, { active: false }));
  return disabled;
}

/** A counter bill paid in cash on the till's receipt printer at `setting`, and its original receipt. */
async function paidSale(setting: EscSetting) {
  await inTx(venue, (tx) =>
    tx.update(printers).set(setting).where(eq(printers.id, venue.printerId)),
  );
  try {
    const billId = await placedIssuedBill(venue, "Paella");
    expect((await collect(venue, billId, "35.00")).status).toBe(200);
    const [sale] = await inTx(venue, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
    );
    // As a bill paid after its invoice is issued prints its original (bill-payments.ts).
    await inTx(venue, async (tx) =>
      enqueueSaleReceipt(
        tx,
        venue.cfg,
        await readSettledTicket(venue.backend, tx, venue.cfg, billId),
        sale!.id,
      ),
    );
    const [original] = await inTx(venue, (tx) =>
      tx
        .select()
        .from(printJobs)
        .where(
          and(
            eq(printJobs.saleId, sale!.id),
            eq(printJobs.receiptCopy, false),
            eq(printJobs.kind, "document"),
          ),
        ),
    );
    return { saleId: sale!.id, original: original! };
  } finally {
    await inTx(venue, (tx) =>
      tx.update(printers).set(at80).where(eq(printers.id, venue.printerId)),
    );
  }
}

/** A seated table with one fired dish, its kitchen ticket printed on the kitchen printer at `setting`. */
async function kitchenTicket(setting: EscSetting): Promise<string> {
  await inTx(venue, (tx) =>
    tx.update(printers).set(setting).where(eq(printers.id, kitchenPrinterId)),
  );
  const { id: tableId } = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `P-${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  const seat = await send(venue.app, venue.cookie, "POST", `/api/tables/${tableId}/seat`, {});
  expect(seat.status).toBe(200);
  const { partyId, tabId } = seat.json as unknown as { partyId: string; tabId: string };
  const [party] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  const submitted = await send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/groups`, {
    allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
    groups: [{ lines: [{ menuItemId: venue.offerFor("Pulpo"), quantity: "1" }], release: "fire" }],
  });
  expect(submitted.status).toBe(200);
  const [link] = await inTx(venue, (tx) =>
    tx
      .select({ jobId: kitchenPrintJobs.printJobId })
      .from(kitchenPrintJobs)
      .where(eq(kitchenPrintJobs.workingOrderId, tabId)),
  );
  await setJob(link!.jobId, { status: "done" });
  return link!.jobId;
}

/** A printed document job with no sale, recorded only in `receipt_reprints`, as a refund receipt is. */
async function refundReceipt(payload: Uint8Array): Promise<string> {
  const saleId = await billlessSale(venue);
  return inTx(venue, async (tx) => {
    const { jobId } = await enqueuePrintJob(tx, venue.printerId, payload, "document");
    await tx.insert(receiptReprints).values({ saleId, printJobId: jobId, personId: venue.adminId });
    await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
    return jobId;
  });
}

const ticketAt = (setting: EscSetting) =>
  esc(setting).init().printArea(dots(setting)).line("Refund").feedAndCut().bytes();

describe("reprintJobOn", () => {
  it("lays a receipt out again for a printer of the same setting as the bytes it first printed", async () => {
    const { original } = await paidSale(at80);
    await setJob(original.id, exhausted);
    const target = await printerAt(at80);
    const { jobId } = await reprint(original.id, target);
    const job = await jobRow(jobId);
    expect(job.printerId).toBe(target);
    expect(job.payload).toEqual(original.payload);
  });

  it("lays a failed original receipt out again for a printer of another width, still as the original", async () => {
    const { saleId, original } = await paidSale(at58);
    await setJob(original.id, exhausted);
    const target = await printerAt(at80fine);
    const { jobId } = await reprint(original.id, target);
    const job = await jobRow(jobId);
    const expected = await inTx(venue, (tx) => layOut(tx, saleId, false, at80fine));
    expect(job).toMatchObject({
      printerId: target,
      resendOf: original.id,
      saleId,
      receiptCopy: false,
      status: "queued",
    });
    expect(job.payload).toEqual(expected);
    expect(job.payload).not.toEqual(original.payload);
    expect(await inTx(venue, (tx) => readOriginalReceiptPrint(tx, saleId))).toMatchObject({
      status: "queued",
      jobId,
    });
  });

  it("keeps a receipt copy marked as a copy when it is laid out again", async () => {
    const { saleId } = await paidSale(at80);
    const copy = await inTx(venue, async (tx) => {
      const { jobId } = await enqueuePrintJob(tx, venue.printerId, Uint8Array.of(1), "document", {
        saleId,
        receiptCopy: true,
      });
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
      return jobId;
    });
    const target = await printerAt(at58);
    const { jobId } = await reprint(copy, target);
    const job = await jobRow(jobId);
    const expected = await inTx(venue, (tx) => layOut(tx, saleId, true, at58));
    expect(job).toMatchObject({ printerId: target, resendOf: copy, receiptCopy: true });
    expect(job.payload).toEqual(expected);
  });

  it("centres a kitchen ticket on a wider printer", async () => {
    const ticket = await kitchenTicket(at58);
    const stored = (await jobRow(ticket)).payload;
    const target = await printerAt(at80);
    const first = await reprint(ticket, target);
    expect(await jobRow(first.jobId)).toMatchObject({
      printerId: target,
      resendOf: ticket,
      payload: readPrintArea(stored)!.centredOn(dots(at80)),
    });
    await setJob(first.jobId, { status: "done" });
    const wider = await printerAt(at80fine);
    const second = await reprint(first.jobId, wider);
    expect(await jobRow(second.jobId)).toMatchObject({
      printerId: wider,
      resendOf: ticket,
      payload: readPrintArea(stored)!.centredOn(dots(at80fine)),
    });
  });

  it("centres a refund receipt, recorded only in receipt_reprints, on a wider printer", async () => {
    const stored = ticketAt(at58);
    const refund = await refundReceipt(stored);
    const target = await printerAt(at80);
    const { jobId } = await reprint(refund, target);
    expect(await jobRow(jobId)).toMatchObject({
      printerId: target,
      saleId: null,
      payload: readPrintArea(stored)!.centredOn(dots(at80)),
    });
  });

  it("refuses a kitchen ticket on a narrower printer", async () => {
    const ticket = await kitchenTicket(at80);
    const target = await printerAt(at58);
    expect(await refusal(ticket, target)).toMatchObject({
      code: "print_job.printer_unsuitable",
      params: { id: ticket, printerId: target },
    });
  });

  it("reads a kitchen ticket's width from the job, not from its printer's setting now", async () => {
    const ticket = await kitchenTicket(at80fine);
    await inTx(venue, (tx) =>
      tx.update(printers).set(at80).where(eq(printers.id, kitchenPrinterId)),
    );
    const narrower = await printerAt(at80);
    expect((await refusal(ticket, narrower)).code).toBe("print_job.printer_unsuitable");
    const asWide = await printerAt(at80fine);
    const { jobId } = await reprint(ticket, asWide);
    expect((await jobRow(jobId)).printerId).toBe(asWide);
  });

  it("refuses a refund receipt whose bytes the walk does not recognise on another printer", async () => {
    const refund = await refundReceipt(Uint8Array.of(0x1b, 0x74, 0));
    const target = await printerAt(at80);
    expect(await refusal(refund, target)).toMatchObject({
      code: "print_job.own_printer_only",
      params: { id: refund },
    });
  });

  it("refuses a test page on another printer", async () => {
    const page = await inTx(venue, async (tx) => {
      const { jobId } = await enqueuePrintJob(tx, venue.printerId, ticketAt(at80), "document");
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
      return jobId;
    });
    const target = await printerAt(at80);
    expect(await refusal(page, target)).toMatchObject({
      code: "print_job.own_printer_only",
      params: { id: page },
    });
  });

  it("refuses a disabled and a deleted printer", async () => {
    const { original } = await paidSale(at80);
    await setJob(original.id, exhausted);
    const disabled = await printerAt(at80);
    await inTx(venue, (tx) => updatePrinter(tx, disabled, { active: false }));
    const deleted = await printerAt(at80);
    await inTx(venue, (tx) => deletePrinter(tx, deleted));
    for (const target of [disabled, deleted])
      expect(await refusal(original.id, target)).toMatchObject({
        code: "print_job.printer_unsuitable",
        params: { id: original.id, printerId: target },
      });
  });

  it("moves a queued original receipt off a disabled printer, ending it there", async () => {
    const { saleId, original } = await paidSale(at80);
    await onDisabledPrinter(original.id, at80);
    const target = await printerAt(at58);
    const { jobId } = await reprint(original.id, target);
    expect(await jobRow(original.id)).toMatchObject({
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
      lastError: "print_job.moved",
    });
    expect(await jobRow(jobId)).toMatchObject({
      printerId: target,
      resendOf: original.id,
      receiptCopy: false,
    });
    expect(await inTx(venue, (tx) => readOriginalReceiptPrint(tx, saleId))).toMatchObject({
      jobId,
    });
  });

  it("never moves a job an agent is printing, even on a disabled printer", async () => {
    const refund = await refundReceipt(ticketAt(at58));
    await onDisabledPrinter(refund, at58, "printing");
    expect(await refusal(refund, await printerAt(at80))).toMatchObject({
      code: "print_job.not_resendable",
      params: { id: refund },
    });
  });

  it("leaves a stuck kitchen ticket waiting when the printer chosen is narrower", async () => {
    const ticket = await kitchenTicket(at80);
    await onDisabledPrinter(ticket, at80);
    expect((await refusal(ticket, await printerAt(at58))).code).toBe(
      "print_job.printer_unsuitable",
    );
    expect((await jobRow(ticket)).status).toBe("queued");
  });

  it("refuses a drawer job on another printer as on its own", async () => {
    const drawer = await inTx(venue, async (tx) => {
      const { jobId } = await enqueuePrintJob(tx, venue.printerId, Uint8Array.of(1), "drawer");
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
      return jobId;
    });
    const target = await printerAt(at80);
    expect(await refusal(drawer, target)).toMatchObject({
      code: "print_job.not_resendable",
      params: { id: drawer },
    });
  });

  it("refuses a job that does not exist", async () => {
    const id = randomUUID();
    expect(await refusal(id, venue.printerId)).toMatchObject({
      code: "print_job.not_found",
      params: { id },
    });
  });

  it("resends the same bytes when the target is the job's own printer", async () => {
    const page = await inTx(venue, async (tx) => {
      const { jobId } = await enqueuePrintJob(tx, venue.printerId, Uint8Array.of(7, 8), "document");
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
      return jobId;
    });
    const { jobId } = await reprint(page, venue.printerId);
    expect(await jobRow(jobId)).toMatchObject({
      printerId: venue.printerId,
      resendOf: page,
      payload: Uint8Array.of(7, 8),
    });
  });
});

describe("the print queue's resend to another printer", () => {
  function printApi(): Hono {
    const app = new Hono();
    mountPrintApi(
      app,
      {
        db: venue.db,
        cfg: venue.cfg,
        pairingMode: createPairingMode(),
        readMembership: async () => null,
        readInvoiceDocument: () => Promise.reject(new Error("No invoice is read here")),
        layOutSaleReceipt: layOut,
        venueLocale: "es-ES",
      },
      () => {},
    );
    return app;
  }

  function resend(jobId: string, printerId: string) {
    return printApi().request(`/management-api/print-jobs/${jobId}/resend`, {
      method: "POST",
      headers: { cookie: venue.adminDashboard, "content-type": "application/json" },
      body: JSON.stringify({ printerId }),
    });
  }

  it("queues a receipt laid out on the printer the request names", async () => {
    const { saleId, original } = await paidSale(at80);
    await setJob(original.id, exhausted);
    const target = await printerAt(at58);
    const response = await resend(original.id, target);
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    const expected = await inTx(venue, (tx) => layOut(tx, saleId, false, at58));
    expect(await jobRow(jobId)).toMatchObject({
      printerId: target,
      resendOf: original.id,
      payload: expected,
    });
  });

  it("answers a printout's or a printer's refusal as a conflict", async () => {
    const page = await inTx(venue, async (tx) => {
      const { jobId } = await enqueuePrintJob(tx, venue.printerId, ticketAt(at80), "document");
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
      return jobId;
    });
    const ownOnly = await resend(page, await printerAt(at80));
    expect(ownOnly.status).toBe(409);
    expect(await ownOnly.json()).toMatchObject({ error: { code: "print_job.own_printer_only" } });
    const narrower = await resend(await kitchenTicket(at80), await printerAt(at58));
    expect(narrower.status).toBe(409);
    expect(await narrower.json()).toMatchObject({
      error: { code: "print_job.printer_unsuitable" },
    });
  });

  it("lists which printers each printout may go to", async () => {
    const { original: receipt } = await paidSale(at80);
    const ticket = await kitchenTicket(at80);
    const refund = await refundReceipt(ticketAt(at80fine));
    const page = await inTx(venue, async (tx) => {
      const { jobId } = await enqueuePrintJob(tx, venue.printerId, ticketAt(at58), "document");
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
      return jobId;
    });
    const narrow = await printerAt(at58);
    const wide = await printerAt(at80);
    const wider = await printerAt(at80fine);
    const disabled = await printerAt(at80fine);
    await inTx(venue, (tx) => updatePrinter(tx, disabled, { active: false }));

    const response = await printApi().request("/management-api/print-jobs", {
      headers: { cookie: venue.adminDashboard },
    });
    expect(response.status).toBe(200);
    const rows = (await response.json()) as {
      id: string;
      reprintRule: string;
      reprintPrinterIds: string[];
    }[];
    const row = (id: string) => rows.find((each) => each.id === id)!;

    expect(row(receipt.id).reprintRule).toBe("any");
    expect(row(receipt.id).reprintPrinterIds).toEqual(
      expect.arrayContaining([narrow, wide, wider, kitchenPrinterId]),
    );
    expect(row(ticket).reprintRule).toBe("wide_enough");
    expect(row(ticket).reprintPrinterIds).toEqual(expect.arrayContaining([wide, wider]));
    expect(row(refund).reprintRule).toBe("wide_enough");
    expect(row(refund).reprintPrinterIds).toContain(wider);
    for (const id of [narrow, wide]) expect(row(refund).reprintPrinterIds).not.toContain(id);
    expect(row(ticket).reprintPrinterIds).not.toContain(narrow);
    for (const [id, own] of [
      [receipt.id, venue.printerId],
      [ticket, kitchenPrinterId],
      [refund, venue.printerId],
    ] as const) {
      expect(row(id).reprintPrinterIds).not.toContain(own);
      expect(row(id).reprintPrinterIds).not.toContain(disabled);
    }
    expect(row(page)).toMatchObject({ reprintRule: "own", reprintPrinterIds: [] });
  });

  it("lists a job stuck on a disabled or unseen printer as movable, and moves the unseen one", async () => {
    const offDisabled = await refundReceipt(ticketAt(at58));
    await onDisabledPrinter(offDisabled, at58);
    const unseen = await inTx(
      venue,
      async (tx) =>
        (
          await createPrinter(tx, {
            name: `BT ${randomUUID().slice(0, 8)}`,
            transport: "bluetooth",
            localKey: `5A:4A:45:${randomUUID().slice(0, 2).toUpperCase()}:FB:BB`,
          })
        ).id,
    );
    const offUnseen = await refundReceipt(ticketAt(at58));
    await setJob(offUnseen, { printerId: unseen, status: "queued" });
    const waiting = await refundReceipt(ticketAt(at58));
    await setJob(waiting, { status: "queued" });
    await printerAt(at80);

    const response = await printApi().request("/management-api/print-jobs", {
      headers: { cookie: venue.adminDashboard },
    });
    const rows = (await response.json()) as { id: string; stuck: boolean; canResend: boolean }[];
    const row = (id: string) => rows.find((each) => each.id === id)!;
    for (const id of [offDisabled, offUnseen])
      expect(row(id)).toMatchObject({ stuck: true, canResend: true });
    expect(row(waiting)).toMatchObject({ stuck: false, canResend: false });

    const moved = await resend(offUnseen, await printerAt(at80));
    expect(moved.status).toBe(202);
    expect((await jobRow(offUnseen)).lastError).toBe("print_job.moved");
  });
});
