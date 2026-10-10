// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { printJobs, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { PrintConfig } from "./printers.js";
import { MAX_DELIVERY_ATTEMPTS } from "./runtime.js";
import { PRINTER_DELETED } from "./printer-delete-jobs.js";

/**
 * The whole of what a caller does to print: one read and one insert, with no socket and no wait on
 * hardware, so a slow, broken or absent printer can never delay the caller (CLAUDE.md §5).
 * `saleId` names the sale a receipt prints.
 */
export async function enqueuePrintJob(
  tx: Transaction,
  cfg: PrintConfig,
  printerId: string,
  payload: Uint8Array,
  kind: "document" | "drawer" = "document",
  {
    saleId = null,
    receiptCopy = null,
  }: { saleId?: string | null; receiptCopy?: boolean | null } = {},
): Promise<{ jobId: string }> {
  return insertPrintJob(tx, cfg, printerId, payload, kind, { resendOf: null, saleId, receiptCopy });
}

async function insertPrintJob(
  tx: Transaction,
  cfg: PrintConfig,
  printerId: string,
  payload: Uint8Array,
  kind: "document" | "drawer",
  {
    resendOf,
    saleId,
    receiptCopy,
  }: {
    resendOf: string | null;
    saleId: string | null;
    receiptCopy: boolean | null;
  },
): Promise<{ jobId: string }> {
  // A deactivated or deleted printer is reported as `printer.not_found`, not a code of its own.
  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.active, true), isNull(printers.deletedAt)));
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });

  const [job] = await tx
    .insert(printJobs)
    .values({
      locationId: cfg.locationId,
      printerId,
      payload,
      kind,
      resendOf,
      saleId,
      receiptCopy,
    })
    .returning({ id: printJobs.id });
  return { jobId: job!.id };
}

/** Only documents whose automatic delivery has ended can be resent; a drawer job never can, nor a
 * job its printer's deletion ended. */
export function canResendPrintJob(job: {
  kind: "document" | "drawer";
  status: string;
  attempts: number;
  lastError?: string | null;
}): boolean {
  return (
    job.kind === "document" &&
    job.lastError !== PRINTER_DELETED &&
    (job.status === "done" || (job.status === "failed" && job.attempts >= MAX_DELIVERY_ATTEMPTS))
  );
}

/**
 * Resend the opaque document to its original printer and location, preserving delivery history. The
 * copy names the first job of its chain, which `printJobInTrouble` (apps/server/src/print-job-trouble.ts)
 * reads to clear a failed job once a later copy has printed, and carries the receipt's sale.
 */
export async function resendPrintJob(tx: Transaction, jobId: string): Promise<{ jobId: string }> {
  const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId));
  if (job === undefined) throw new AppError("print_job.not_found", { id: jobId });
  const [target] = await tx
    .select({ deletedAt: printers.deletedAt })
    .from(printers)
    .where(eq(printers.id, job.printerId));
  if (target!.deletedAt !== null) throw new AppError("printer.not_found", { id: job.printerId });
  if (!canResendPrintJob(job)) throw new AppError("print_job.not_resendable", { id: jobId });
  return insertPrintJob(
    tx,
    { locationId: job.locationId },
    job.printerId,
    job.payload,
    "document",
    { resendOf: job.resendOf ?? job.id, saleId: job.saleId, receiptCopy: job.receiptCopy },
  );
}
