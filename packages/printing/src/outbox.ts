// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { printJobs, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { PrintConfig } from "./printers.js";
import { MAX_DELIVERY_ATTEMPTS } from "./runtime.js";

/**
 * The whole of what a caller does to print: one read and one insert, with no socket and no wait on
 * hardware, so a slow, broken or absent printer can never delay the caller (CLAUDE.md §5).
 */
export async function enqueuePrintJob(
  tx: Transaction,
  cfg: PrintConfig,
  printerId: string,
  payload: Uint8Array,
  kind: "document" | "drawer" = "document",
): Promise<{ jobId: string }> {
  // A deactivated printer is reported as `printer.not_found`, not a code of its own.
  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.active, true)));
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });

  const [job] = await tx
    .insert(printJobs)
    .values({
      locationId: cfg.locationId,
      printerId,
      payload,
      kind,
    })
    .returning({ id: printJobs.id });
  return { jobId: job!.id };
}

/** Only documents whose automatic delivery has ended can be resent; a drawer job never can. */
export function canResendPrintJob(job: {
  kind: "document" | "drawer";
  status: string;
  attempts: number;
}): boolean {
  return (
    job.kind === "document" &&
    (job.status === "done" || (job.status === "failed" && job.attempts >= MAX_DELIVERY_ATTEMPTS))
  );
}

/** Resend the opaque document to its original printer and location, preserving delivery history. */
export async function resendPrintJob(tx: Transaction, jobId: string): Promise<{ jobId: string }> {
  const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId));
  if (job === undefined) throw new AppError("print_job.not_found", { id: jobId });
  if (!canResendPrintJob(job)) throw new AppError("print_job.not_resendable", { id: jobId });
  return enqueuePrintJob(tx, { locationId: job.locationId }, job.printerId, job.payload);
}
