import "./errors.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { invoiceDeliveries, nodes, printJobs, sales, type Transaction } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_DELETED } from "@waitron/printing";
import { AppError } from "@waitron/shared";
import type { InvoiceDelivery } from "./invoice-delivery.js";
import { readInvoicePrinters } from "./page-printers.js";
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

export interface InvoiceDeliveryStatus {
  current: InvoiceDeliveryAttempt | null;
  originalCompleted: boolean;
  actions: {
    retryOriginal: { medium: InvoiceDeliveryMedium } | null;
    printOnA4: {
      printer: { id: string; name: string };
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
export type InvoiceDeliveryReadOptions = { emailAvailable: boolean };

/** Null for a sale that is not a full invoice. */
export async function readInvoiceDeliveries(
  tx: Transaction,
  saleId: string,
  options: InvoiceDeliveryReadOptions,
): Promise<InvoiceDeliveryStatus | null> {
  const status = (await readInvoiceDeliveriesFor(tx, [saleId], options)).get(saleId);
  if (status === undefined) throw new AppError("invoice_delivery.not_found", {});
  return status;
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
  const printers = await readInvoicePrinters(tx, [
    ...new Set(found.map((sale) => sale.locationId)),
  ]);
  const rowsOf = bySale(rows);
  const jobsOf = bySale(jobs);
  return new Map(
    found.map((sale) => [
      sale.id,
      sale.recipient === null
        ? null
        : deliveryStatus(
            rowsOf.get(sale.id) ?? [],
            jobsOf.get(sale.id) ?? [],
            receipts.get(sale.id)!,
            printers.get(sale.locationId) ?? null,
            options.emailAvailable,
          ),
    ]),
  );
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
    status: string;
    attempts: number;
    createdAt: string;
    deliveredAt: string | null;
  }[],
  receipt: OriginalReceiptPrint,
  printer: { id: string; name: string } | null,
  emailAvailable: boolean,
): InvoiceDeliveryStatus {
  const history = rows.map(rowAttempt);
  if (receipt.status !== "not_queued" && !rows.some((row) => row.printJobId === receipt.jobId)) {
    const job = jobs.find((candidate) => candidate.id === receipt.jobId)!;
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
                ? printer !== null
                : receiptRetryable
          )
        ? current.medium
        : receiptRetryable
          ? "receipt"
          : null;
  const latest = rows[0];
  const designation = originalCompleted ? "duplicate" : "original";
  return {
    current,
    originalCompleted,
    actions: {
      retryOriginal: retryMedium === null ? null : { medium: retryMedium },
      printOnA4: printer === null || busy ? null : { printer, designation },
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
