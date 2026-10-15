import "./errors.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { invoiceDeliveries, nodes, printJobs, sales, type Transaction } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_DELETED } from "@waitron/printing";
import { AppError } from "@waitron/shared";
import type { InvoiceDelivery } from "./invoice-delivery.js";
import { type OriginalReceiptPrint, readOriginalReceiptPrints } from "./receipt-print.js";

export type InvoiceDeliveryMedium = InvoiceDelivery["medium"];

export interface InvoiceDeliveryAttempt {
  /** Null for a receipt original that no delivery row tracks. */
  id: string | null;
  medium: InvoiceDeliveryMedium;
  designation: InvoiceDelivery["designation"];
  status: InvoiceDelivery["status"];
  failureCode: NonNullable<InvoiceDelivery["failureCode"]> | typeof PRINTER_DELETED | null;
  requestedAt: string;
  /**
   * When the attempt reached its status: queued, when it is due; sending, when it was claimed or
   * last renewed; sent, when it completed; failed, when the failure was reported; unknown, when
   * its claim ended, else when it was reported. Null where nothing records that time; an untracked receipt
   * original has one only once printed.
   */
  at: string | null;
  personId: string | null;
  /**
   * What the office printer is holding an A4 for while it is sending, or last held it for before
   * an unknown ended it; null otherwise. A held A4 may still print by itself.
   */
  printerHold: InvoiceDelivery["printerHold"];
  /**
   * The agent reported success but the attempt kept its status: a newer attempt had started, or
   * its receipt printer had been deleted.
   */
  lateSuccess: boolean;
}

/** A printer the caller offers to print the full invoice on. */
export interface OfferedPrinter {
  id: string;
  name: string;
  kind: "a4" | "receipt";
}

export interface InvoiceDeliveryStatus {
  current: InvoiceDeliveryAttempt | null;
  originalCompleted: boolean;
  /**
   * The printer of the original that was sent, else of the newest original attempt; null when that
   * attempt was an email, or there is none.
   */
  originalPrinterId: string | null;
  actions: {
    retryOriginal: { medium: InvoiceDeliveryMedium } | null;
    print: {
      printers: OfferedPrinter[];
      designation: InvoiceDelivery["designation"];
    } | null;
    /** A waiting A4 or email original, not yet claimed, that paper may replace. */
    receiptInstead: { deliveryId: string } | null;
    email: { designation: InvoiceDelivery["designation"] } | null;
  };
  /** Newest first, the current attempt included. */
  history: InvoiceDeliveryAttempt[];
}

/**
 * Whether an invoice email can be sent now; when not, no action offers email. The reader cannot
 * tell by itself: the mail transport lives outside the database.
 */
export type InvoiceDeliveryReadOptions = { emailAvailable: boolean; printers?: PrinterOffer };

/** A full invoice's sale, as the status reader found it. */
export type InvoiceDeliverySale = { id: string; locationId: string };

/**
 * The printers a full invoice may be printed on, which depend on who asks; none when omitted, so
 * nothing is offered to print.
 */
export type PrinterOffer = (sale: InvoiceDeliverySale) => Promise<OfferedPrinter[]>;

/** For one sale, `emailAvailable` may be asked of it once it is known to be a full invoice. */
export type InvoiceDeliverySaleReadOptions = {
  emailAvailable: boolean | ((sale: InvoiceDeliverySale) => Promise<boolean>);
  printers?: PrinterOffer;
};

/** The status, with what the reader read on the way that an action deciding on it needs again. */
export interface InvoiceDeliveryState {
  status: InvoiceDeliveryStatus;
  locationId: string;
  printers: OfferedPrinter[];
  receipt: OriginalReceiptPrint;
}

/** Null for a sale that is not a full invoice. */
export async function readInvoiceDeliveries(
  tx: Transaction,
  saleId: string,
  options: InvoiceDeliverySaleReadOptions,
): Promise<InvoiceDeliveryStatus | null> {
  return (await readInvoiceDeliveryState(tx, saleId, options))?.status ?? null;
}

/** {@link readInvoiceDeliveries}, with what an action needs again. */
export async function readInvoiceDeliveryState(
  tx: Transaction,
  saleId: string,
  options: InvoiceDeliverySaleReadOptions,
): Promise<InvoiceDeliveryState | null> {
  const state = (await readStates(tx, [saleId], options)).get(saleId);
  if (state === undefined) throw new AppError("invoice_delivery.not_found", {});
  return state;
}

/**
 * {@link readInvoiceDeliveries} for several sales in a fixed number of queries, whatever their
 * count. A sale that does not exist has no entry.
 */
export async function readInvoiceDeliveriesFor(
  tx: Transaction,
  saleIds: readonly string[],
  options: InvoiceDeliveryReadOptions,
): Promise<Map<string, InvoiceDeliveryStatus | null>> {
  const states = await readStates(tx, saleIds, options);
  return new Map([...states].map(([id, state]) => [id, state?.status ?? null]));
}

async function readStates(
  tx: Transaction,
  saleIds: readonly string[],
  options: InvoiceDeliverySaleReadOptions,
): Promise<Map<string, InvoiceDeliveryState | null>> {
  const { emailAvailable, printers: offer = async () => [] } = options;
  const ids = [...saleIds];
  const found = await tx
    .select({ id: sales.id, recipient: sales.counterpartyTaxId, locationId: nodes.locationId })
    .from(sales)
    .innerJoin(nodes, eq(nodes.id, sales.nodeId))
    .where(inArray(sales.id, ids));
  const rows = await tx
    .select()
    .from(invoiceDeliveries)
    .where(inArray(invoiceDeliveries.saleId, ids))
    .orderBy(desc(invoiceDeliveries.generation));
  const jobs = await tx
    .select({
      saleId: printJobs.saleId,
      id: printJobs.id,
      printerId: printJobs.printerId,
      status: printJobs.status,
      attempts: printJobs.attempts,
      createdAt: printJobs.createdAt,
      deliveredAt: printJobs.deliveredAt,
    })
    .from(printJobs)
    .where(
      and(
        inArray(printJobs.saleId, ids),
        eq(printJobs.kind, "document"),
        eq(printJobs.receiptCopy, false),
      ),
    );
  const receipts = await readOriginalReceiptPrints(tx, ids);
  const rowsOf = bySale(rows);
  const jobsOf = bySale(jobs);
  const states = new Map<string, InvoiceDeliveryState | null>();
  for (const sale of found) {
    if (sale.recipient === null) {
      states.set(sale.id, null);
      continue;
    }
    const receipt = receipts.get(sale.id)!;
    const located = { id: sale.id, locationId: sale.locationId };
    const printers = await offer(located);
    const emailable =
      typeof emailAvailable === "boolean" ? emailAvailable : await emailAvailable(located);
    states.set(sale.id, {
      status: deliveryStatus(
        rowsOf.get(sale.id) ?? [],
        jobsOf.get(sale.id) ?? [],
        receipt,
        printers,
        emailable,
      ),
      locationId: sale.locationId,
      printers,
      receipt,
    });
  }
  return states;
}

/** Keeps each sale's items in their order. */
function bySale<T extends { saleId: string | null }>(items: readonly T[]): Map<string | null, T[]> {
  const grouped = new Map<string | null, T[]>();
  for (const item of items) {
    const group = grouped.get(item.saleId);
    if (group === undefined) grouped.set(item.saleId, [item]);
    else group.push(item);
  }
  return grouped;
}

function deliveryStatus(
  rows: InvoiceDelivery[],
  jobs: {
    id: string;
    printerId: string;
    status: string;
    attempts: number;
    createdAt: string;
    deliveredAt: string | null;
  }[],
  receipt: OriginalReceiptPrint,
  printers: OfferedPrinter[],
  emailAvailable: boolean,
): InvoiceDeliveryStatus {
  const history = rows.map(rowAttempt);
  const jobPrinter = (jobId: string | null) =>
    jobs.find((candidate) => candidate.id === jobId)?.printerId ?? null;
  const originals = rows
    .filter((row) => row.designation === "original")
    .map((row) => ({
      sent: row.status === "sent",
      printerId:
        row.medium === "a4"
          ? row.pagePrinterId
          : row.medium === "receipt"
            ? jobPrinter(row.printJobId)
            : null,
    }));
  if (receipt.status !== "not_queued" && !rows.some((row) => row.printJobId === receipt.jobId)) {
    const job = jobs.find((candidate) => candidate.id === receipt.jobId)!;
    originals.push({ sent: receipt.status === "done", printerId: job.printerId });
    // Listed as the oldest attempt: an untracked receipt original predates delivery rows.
    history.push({
      id: null,
      medium: "receipt",
      designation: "original",
      status: inFlight(job) ? (job.status === "printing" ? "sending" : "queued") : receiptSent(job),
      failureCode: receipt.failureCode ?? null,
      requestedAt: job.createdAt,
      at: job.deliveredAt,
      personId: null,
      printerHold: null,
      lateSuccess: false,
    });
  }
  const current = history[0] ?? null;
  const originalCompleted =
    receipt.status === "done" ||
    rows.some((row) => row.designation === "original" && row.status === "sent");
  // The same rule `reserveInvoiceDelivery` refuses a new attempt by.
  const busy =
    rows.some((row) => row.status === "queued" || row.status === "sending") || jobs.some(inFlight);
  const receiptRetryable = receipt.status !== "not_queued" && receipt.canRetry;
  const retryMedium =
    current === null ||
    !(current.status === "failed" || current.status === "unknown") ||
    originalCompleted ||
    busy
      ? null
      : (
            current.medium === "email"
              ? emailAvailable
              : current.medium === "a4"
                ? printers.some((printer) => printer.kind === "a4")
                : receiptRetryable
          )
        ? current.medium
        : receiptRetryable
          ? "receipt"
          : null;
  const latest = rows[0];
  const designation = originalCompleted ? "duplicate" : "original";
  const original = originals.find((attempt) => attempt.sent) ?? originals[0];
  return {
    current,
    originalCompleted,
    originalPrinterId: original?.printerId ?? null,
    actions: {
      retryOriginal: retryMedium === null ? null : { medium: retryMedium },
      print: printers.length === 0 || busy ? null : { printers, designation },
      receiptInstead:
        latest !== undefined &&
        (latest.medium === "a4" || latest.medium === "email") &&
        latest.status === "queued" &&
        latest.designation === "original" &&
        // `enqueueOriginalReceipt` adds no job once an F1 has a receipt original; that one is resent.
        (receipt.status === "not_queued" || receiptRetryable)
          ? { deliveryId: latest.id }
          : null,
      email: emailAvailable && !busy ? { designation } : null,
    },
    history,
  };
}

export function rowAttempt(row: InvoiceDelivery): InvoiceDeliveryAttempt {
  const at = {
    queued: row.nextAttemptAt,
    sending: row.claimedAt,
    sent: row.completedAt,
    failed: row.reportedAt,
    unknown: row.expiredAt ?? row.reportedAt,
  }[row.status];
  return {
    id: row.id,
    medium: row.medium,
    designation: row.designation,
    status: row.status,
    failureCode: row.failureCode,
    requestedAt: row.createdAt,
    at,
    personId: row.personId,
    printerHold:
      row.medium === "a4" && (row.status === "sending" || row.status === "unknown")
        ? row.printerHold
        : null,
    lateSuccess: row.reportedOutcome === "sent" && row.status !== "sent",
  };
}

function inFlight(job: { status: string; attempts: number }): boolean {
  return (
    job.status === "queued" ||
    job.status === "printing" ||
    (job.status === "failed" && job.attempts < MAX_DELIVERY_ATTEMPTS)
  );
}

function receiptSent(job: { status: string }): "sent" | "failed" {
  return job.status === "done" ? "sent" : "failed";
}
