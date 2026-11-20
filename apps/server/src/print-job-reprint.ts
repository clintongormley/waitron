import "./errors.js";
import { and, eq, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  receiptRollColumns,
  kitchenPrintJobs,
  printJobs,
  isReceiptPrinter,
  printers,
  receiptReprints,
  sales,
  type Transaction,
} from "@waitron/db";
import {
  canResendPrintJob,
  endMovedPrintJob,
  enqueuePrintJob,
  MAX_DELIVERY_ATTEMPTS,
  readPrintArea,
  textGrid,
  type EscSetting,
} from "@waitron/printing";
import { AppError } from "@waitron/shared";
import {
  assertPrintPayload,
  endInvoicePrintDeliveries,
  resendInvoicePrintJob,
} from "./invoice-print.js";
import { expireInvoiceDeliveryClaims } from "./invoice-delivery.js";
import { deliversAsFullInvoiceSql } from "./invoice-selection.js";
import { enqueueInvoiceReceipt, type LayOutSaleReceipt } from "./receipt-print.js";

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

/** Kitchen tickets link to the first job in the chain. */
export function linkedKitchenPrintoutSql(head: SQLWrapper | string): SQL<number> {
  return sql<number>`exists (select 1 from ${kitchenPrintJobs} where ${kitchenPrintJobs.printJobId} = ${head})`;
}

export function isCompletedReceiptOriginal(job: {
  kind: string;
  status: string;
  receiptCopy: boolean | null;
  saleId: string | null;
}): job is typeof job & { saleId: string } {
  return (
    job.kind === "document" &&
    job.status === "done" &&
    job.receiptCopy === false &&
    job.saleId !== null
  );
}

/**
 * Resend a job on `printerId`, as {@link reprintRule} allows: a receipt or full invoice laid out
 * again for it, as a marked copy if its original printed; a kitchen ticket or refund receipt
 * centred on it. A job {@link isStuckJob} says is stuck is ended there so it never prints twice.
 */
export async function reprintJobOn(
  tx: Transaction,
  layOut: LayOutSaleReceipt,
  jobId: string,
  printerId: string | undefined,
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
    .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
    .where(eq(printJobs.id, jobId));
  if (found === undefined) throw new AppError("print_job.not_found", { id: jobId });
  const { job } = found;
  assertPrintPayload(job);
  const completedOriginal = isCompletedReceiptOriginal(job);
  const targetId = printerId ?? job.printerId;
  if (!completedOriginal && targetId === job.printerId)
    return resendInvoicePrintJob(tx, layOut, jobId, personId, now);
  if (completedOriginal && found.printer.deletedAt !== null)
    throw new AppError("printer.not_found", { id: job.printerId });
  const resendable = completedOriginal || canResendPrintJob(job);
  const stuck = !resendable && isStuckJob(job, found.printer, seen);
  if (!resendable && !stuck) throw new AppError("print_job.not_resendable", { id: jobId });
  const [target] = await tx
    .select({ id: printers.id, ...receiptRollColumns })
    .from(printers)
    .where(
      and(
        isReceiptPrinter(),
        eq(printers.id, targetId),
        eq(printers.active, true),
        isNull(printers.deletedAt),
      ),
    );
  if (target === undefined)
    throw new AppError("print_job.printer_unsuitable", { id: jobId, printerId: targetId });
  if (completedOriginal)
    return enqueueCompletedReceiptCopy(tx, layOut, job.saleId, target, personId, now);
  const printerDots = textGrid(target.paperWidth, target.resolution).widthDots;
  let payload: Uint8Array;
  if (job.saleId !== null) {
    payload = await layOut(tx, job.saleId, job.receiptCopy === true, target);
  } else {
    const linked =
      job.tenderRefundId !== null ||
      (
        await tx.execute<{ linked: number }>(
          sql`select ${linkedKitchenPrintoutSql(job.resendOf ?? job.id)} as linked`,
        )
      ).rows[0]?.linked === 1;
    const area = linked && job.payload !== null ? readPrintArea(job.payload) : null;
    const { rule, fits } = reprintRule(null, area?.widthDots ?? null);
    if (rule === "own" || area === null)
      throw new AppError("print_job.own_printer_only", { id: jobId });
    if (!fits(printerDots))
      throw new AppError("print_job.printer_unsuitable", { id: jobId, printerId: targetId });
    payload = area.centredOn(printerDots);
  }
  // The resend below refuses the job unless this ended it.
  if (stuck) {
    await endMovedPrintJob(tx, jobId);
    await endInvoicePrintDeliveries(tx, [jobId], now);
  }
  return resendInvoicePrintJob(tx, layOut, jobId, personId, now, undefined, {
    printerId: targetId,
    payload,
  });
}

async function enqueueCompletedReceiptCopy(
  tx: Transaction,
  layOut: LayOutSaleReceipt,
  saleId: string,
  printer: { id: string } & EscSetting,
  personId: string,
  now: Date,
): Promise<{ jobId: string }> {
  const bytes = await layOut(tx, saleId, true, printer);
  const [full] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.id, saleId), deliversAsFullInvoiceSql()));
  let jobId: string;
  if (full === undefined) {
    ({ jobId } = await enqueuePrintJob(tx, printer.id, bytes, "document", {
      saleId,
      receiptCopy: true,
    }));
  } else {
    await expireInvoiceDeliveryClaims(tx, now);
    const delivery = await enqueueInvoiceReceipt(tx, saleId, printer.id, bytes, "duplicate", {
      personId,
    });
    jobId = delivery.printJobId!;
  }
  await tx.insert(receiptReprints).values({ saleId, printJobId: jobId, personId });
  return { jobId };
}
