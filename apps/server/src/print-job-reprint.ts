import "./errors.js";
import { and, eq, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  kitchenPrintJobs,
  printJobs,
  printers,
  receiptReprints,
  type Transaction,
} from "@waitron/db";
import {
  canResendPrintJob,
  endMovedPrintJob,
  MAX_DELIVERY_ATTEMPTS,
  printArea,
  textGrid,
} from "@waitron/printing";
import { AppError } from "@waitron/shared";
import { endInvoicePrintDeliveries, resendInvoicePrintJob } from "./invoice-print.js";
import type { LayOutSaleReceipt } from "./receipt-print.js";

/** Whether an agent can reach `printer` now. */
export type PrinterSeen = (printer: { transport: string; localKey: string | null }) => boolean;

/** Queued, or a document whose failed delivery will be tried again. */
export function isWaiting(job: { kind: string; status: string; attempts: number }): boolean {
  return (
    job.status === "queued" ||
    (job.kind === "document" && job.status === "failed" && job.attempts < MAX_DELIVERY_ATTEMPTS)
  );
}

/**
 * A document waiting, not held by an agent, on a printer not deleted that is switched off or that
 * no agent sees: it may be reprinted elsewhere, and is ended where it was stuck.
 */
export function isStuckJob(
  job: { kind: string; status: string; attempts: number },
  printer: {
    active: boolean;
    deletedAt: string | null;
    transport: string;
    localKey: string | null;
  },
  seen: PrinterSeen,
): boolean {
  return (
    job.kind === "document" &&
    isWaiting(job) &&
    printer.deletedAt === null &&
    (!printer.active || !seen(printer))
  );
}

export type ReprintRule = "any" | "wide_enough" | "own";

/**
 * Which other printers a printout may go to: a sale's receipt or invoice, laid out again, any; a
 * kitchen ticket or refund receipt whose bytes name `widthDots`, one at least as wide; anything
 * else none.
 */
export function reprintRule(
  saleId: string | null,
  widthDots: number | null,
): { rule: ReprintRule; fits: (printerDots: number) => boolean } {
  if (saleId !== null) return { rule: "any", fits: () => true };
  if (widthDots === null) return { rule: "own", fits: () => false };
  return { rule: "wide_enough", fits: (printerDots) => printerDots >= widthDots };
}

/** Whether the chain starting at job `head` is a kitchen ticket or a refund receipt. */
export function linkedPrintoutSql(head: SQLWrapper | string): SQL<number> {
  return sql<number>`(exists (select 1 from ${kitchenPrintJobs} where ${kitchenPrintJobs.printJobId} = ${head}) or exists (select 1 from ${receiptReprints} where ${receiptReprints.printJobId} = ${head}))`;
}

/**
 * Resend a job on `printerId`, as {@link reprintRule} allows: a receipt or full invoice laid out
 * again for it, keeping the job's own original-or-copy marking; a kitchen ticket or refund receipt
 * centred on it. A job {@link isStuckJob} says is stuck is ended there so it never prints twice.
 */
export async function reprintJobOn(
  tx: Transaction,
  layOut: LayOutSaleReceipt,
  jobId: string,
  printerId: string,
  personId: string,
  now = new Date(),
  { seen }: { seen: PrinterSeen },
): Promise<{ jobId: string }> {
  const [found] = await tx
    .select({
      job: printJobs,
      printer: {
        active: printers.active,
        deletedAt: printers.deletedAt,
        transport: printers.transport,
        localKey: printers.localKey,
      },
    })
    .from(printJobs)
    .innerJoin(printers, eq(printers.id, printJobs.printerId))
    .where(eq(printJobs.id, jobId));
  if (found === undefined) throw new AppError("print_job.not_found", { id: jobId });
  const { job } = found;
  if (printerId === job.printerId) return resendInvoicePrintJob(tx, jobId, personId, now);
  const resendable = canResendPrintJob(job);
  const stuck = !resendable && isStuckJob(job, found.printer, seen);
  if (!resendable && !stuck) throw new AppError("print_job.not_resendable", { id: jobId });
  const [target] = await tx
    .select({ paperWidth: printers.paperWidth, resolution: printers.resolution })
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.active, true), isNull(printers.deletedAt)));
  if (target === undefined)
    throw new AppError("print_job.printer_unsuitable", { id: jobId, printerId });
  const printerDots = textGrid(target.paperWidth, target.resolution).widthDots;
  let payload: Uint8Array;
  if (job.saleId !== null) {
    payload = await layOut(tx, job.saleId, job.receiptCopy === true, target);
  } else {
    const {
      rows: [linked],
    } = await tx.execute<{ linked: number }>(
      sql`select ${linkedPrintoutSql(job.resendOf ?? job.id)} as linked`,
    );
    const area = linked?.linked ? printArea(job.payload) : null;
    const { rule, fits } = reprintRule(null, area?.widthDots ?? null);
    if (rule === "own" || area === null)
      throw new AppError("print_job.own_printer_only", { id: jobId });
    if (!fits(printerDots))
      throw new AppError("print_job.printer_unsuitable", { id: jobId, printerId });
    payload = area.centredOn(printerDots);
  }
  // The resend below refuses the job unless this ended it.
  if (stuck) {
    await endMovedPrintJob(tx, jobId);
    await endInvoicePrintDeliveries(tx, [jobId], now);
  }
  return resendInvoicePrintJob(tx, jobId, personId, now, undefined, { printerId, payload });
}
