// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { printJobs, isA4Printer, isReceiptPrinter, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS } from "./runtime.js";
import { PRINTER_DELETED } from "./printer-delete-jobs.js";

/** Keep hardware I/O in the worker so enqueueing a job does not wait for the printer. */
export async function enqueuePrintJob(
  tx: Transaction,
  printerId: string,
  payload: Uint8Array,
  kind: "document" | "drawer" = "document",
  {
    saleId = null,
    receiptCopy = null,
    tenderRefundId = null,
  }: {
    saleId?: string | null;
    receiptCopy?: boolean | null;
    tenderRefundId?: string | null;
  } = {},
): Promise<{ jobId: string }> {
  return insertPrintJob(tx, printerId, payload, kind, {
    resendOf: null,
    saleId,
    receiptCopy,
    tenderRefundId,
  });
}

export function enqueueA4PrintJob(
  tx: Transaction,
  printerId: string,
  saleId: string,
  createdAt: string,
): Promise<{ jobId: string }> {
  return insertPrintJob(tx, printerId, null, "a4", {
    resendOf: null,
    saleId,
    receiptCopy: null,
    tenderRefundId: null,
    createdAt,
  });
}

async function insertPrintJob(
  tx: Transaction,
  printerId: string,
  payload: Uint8Array | null,
  kind: typeof printJobs.$inferSelect.kind,
  {
    resendOf,
    saleId,
    receiptCopy,
    tenderRefundId,
    createdAt,
  }: {
    resendOf: string | null;
    saleId: string | null;
    receiptCopy: boolean | null;
    tenderRefundId: string | null;
    createdAt?: string;
  },
): Promise<{ jobId: string }> {
  // A deactivated or deleted printer is reported as `printer.not_found`, not a code of its own.
  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(
      and(
        kind === "a4" ? isA4Printer() : isReceiptPrinter(),
        eq(printers.id, printerId),
        eq(printers.active, true),
        isNull(printers.deletedAt),
      ),
    );
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });

  const [job] = await tx
    .insert(printJobs)
    .values({
      printerId,
      payload,
      kind,
      resendOf,
      saleId,
      receiptCopy,
      tenderRefundId,
      createdAt,
    })
    .returning({ id: printJobs.id });
  return { jobId: job!.id };
}

/** Completed receipt originals need a marked copy; a job out of delivery attempts may be resent. */
export function canResendPrintJob(job: {
  kind: typeof printJobs.$inferSelect.kind;
  status: string;
  attempts: number;
  lastError?: string | null;
  receiptCopy?: boolean | null;
}): boolean {
  return (
    job.kind === "document" &&
    job.lastError !== PRINTER_DELETED &&
    ((job.status === "done" && job.receiptCopy !== false) ||
      (job.status === "failed" && job.attempts >= MAX_DELIVERY_ATTEMPTS))
  );
}

/** The `last_error` of a job {@link endMovedPrintJob} ended: a code the dashboard words. */
export const PRINT_JOB_MOVED = "print_job.moved";

/**
 * Ends a document job still waiting on its printer, so it never prints there once it is reprinted
 * elsewhere. A job an agent claimed meanwhile is left alone; `false` says nothing was ended.
 */
export async function endMovedPrintJob(tx: Transaction, jobId: string): Promise<boolean> {
  const ended = await tx.execute<{ id: string }>(sql`
    update print_jobs set status = 'failed', attempts = ${MAX_DELIVERY_ATTEMPTS},
      last_error = ${PRINT_JOB_MOVED}, next_attempt_at = null
    where id = ${jobId} and kind = 'document'
      and (status = 'queued' or (status = 'failed' and attempts < ${MAX_DELIVERY_ATTEMPTS}))
    returning id`);
  return ended.rows.length > 0;
}

/**
 * Resend the opaque document to its original printer, or `to` another with the bytes given,
 * preserving delivery history. The
 * copy names the first job of its chain, which `printJobInTrouble` (apps/server/src/print-job-trouble.ts)
 * reads to clear a failed job once a later copy has printed.
 */
export async function resendPrintJob(
  tx: Transaction,
  jobId: string,
  to?: { printerId: string; payload: Uint8Array },
): Promise<{ jobId: string }> {
  const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId));
  if (job === undefined) throw new AppError("print_job.not_found", { id: jobId });
  const [target] = await tx
    .select({ deletedAt: printers.deletedAt })
    .from(printers)
    .where(and(isReceiptPrinter(), eq(printers.id, job.printerId)));
  if (target === undefined || target.deletedAt !== null)
    throw new AppError("printer.not_found", { id: job.printerId });
  if (!canResendPrintJob(job)) throw new AppError("print_job.not_resendable", { id: jobId });
  if (job.receiptCopy === false && job.saleId !== null) {
    const [reserved] = await tx
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(
        and(
          eq(printJobs.saleId, job.saleId),
          eq(printJobs.receiptCopy, false),
          or(
            eq(printJobs.status, "done"),
            eq(printJobs.status, "queued"),
            eq(printJobs.status, "printing"),
            and(eq(printJobs.status, "failed"), lt(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
          ),
        ),
      )
      .limit(1);
    if (reserved !== undefined) throw new AppError("print_job.not_resendable", { id: jobId });
  }
  return insertPrintJob(
    tx,
    to?.printerId ?? job.printerId,
    to?.payload ?? job.payload,
    "document",
    {
      resendOf: job.resendOf ?? job.id,
      saleId: job.saleId,
      receiptCopy: job.receiptCopy,
      tenderRefundId: job.tenderRefundId,
    },
  );
}
