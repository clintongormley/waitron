import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import {
  kitchenPrintJobs,
  printJobs,
  printers,
  receiptReprints,
  type Transaction,
} from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  canResendPrintJob,
  centredForPrinter,
  endMovedPrintJob,
  jobWidthDots,
  MAX_DELIVERY_ATTEMPTS,
  textGrid,
  type EscSetting,
} from "@waitron/printing";
import { AppError } from "@waitron/shared";
import { endInvoicePrintDeliveries, resendInvoicePrintJob } from "./invoice-print.js";
import { buildReceiptBytes } from "./receipt-print.js";
import type { TradingContext } from "./trading-context.js";
import { readTransactionReceipt } from "./transaction-receipt.js";

export type LayOutSaleReceipt = (
  tx: Transaction,
  saleId: string,
  duplicate: boolean,
  printer: EscSetting,
) => Promise<Uint8Array>;

/** A filed sale's receipt laid out for `printer`, with today's trim, logo and address. */
export async function layOutSaleReceipt(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TradingContext,
  saleId: string,
  duplicate: boolean,
  printer: EscSetting,
): Promise<Uint8Array> {
  const ticket = await readTransactionReceipt(backend, tx, cfg, saleId);
  const bytes = await buildReceiptBytes(tx, cfg, ticket, saleId, duplicate, printer);
  /* v8 ignore start -- issuer row structurally always present (buildReceiptBytes) */
  if (bytes === undefined) throw new Error("Cannot build a receipt without the taxpayer");
  /* v8 ignore stop */
  return bytes;
}

/**
 * Resend a job on `printerId`: a receipt or full invoice laid out again for it, keeping the job's
 * own original-or-copy marking; a kitchen ticket or refund receipt centred on a printer at least as
 * wide; anything else only on its own printer. A document still waiting on a disabled printer, or
 * on one `ownPrinterUnseen` says no agent sees, is ended there so it never prints twice.
 */
export async function reprintJobOn(
  tx: Transaction,
  layOut: LayOutSaleReceipt,
  jobId: string,
  printerId: string,
  personId: string,
  now = new Date(),
  { ownPrinterUnseen = false }: { ownPrinterUnseen?: boolean } = {},
): Promise<{ jobId: string }> {
  const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId));
  if (job === undefined) throw new AppError("print_job.not_found", { id: jobId });
  if (printerId === job.printerId) return resendInvoicePrintJob(tx, jobId, personId, now);
  const resendable = canResendPrintJob(job);
  const stuck = !resendable && (await isStuck(tx, job, ownPrinterUnseen));
  if (!resendable && !stuck) throw new AppError("print_job.not_resendable", { id: jobId });
  const [target] = await tx
    .select({ paperWidth: printers.paperWidth, resolution: printers.resolution })
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.active, true), isNull(printers.deletedAt)));
  if (target === undefined)
    throw new AppError("print_job.printer_unsuitable", { id: jobId, printerId });
  const payload =
    job.saleId !== null
      ? await layOut(tx, job.saleId, job.receiptCopy === true, target)
      : await centredCopy(
          tx,
          job,
          printerId,
          textGrid(target.paperWidth, target.resolution).widthDots,
        );
  // The resend below refuses the job unless this ended it.
  if (stuck) {
    await endMovedPrintJob(tx, jobId);
    await endInvoicePrintDeliveries(tx, [jobId], now);
  }
  return resendInvoicePrintJob(tx, jobId, personId, now, undefined, { printerId, payload });
}

/** Waiting, not held by an agent, on a printer that is switched off or that no agent sees. */
async function isStuck(
  tx: Transaction,
  job: { kind: string; status: string; attempts: number; printerId: string },
  ownPrinterUnseen: boolean,
): Promise<boolean> {
  const waiting =
    job.status === "queued" || (job.status === "failed" && job.attempts < MAX_DELIVERY_ATTEMPTS);
  if (job.kind !== "document" || !waiting) return false;
  const [printer] = await tx
    .select({ active: printers.active })
    .from(printers)
    .where(and(eq(printers.id, job.printerId), isNull(printers.deletedAt)));
  return printer !== undefined && (!printer.active || ownPrinterUnseen);
}

/** A kitchen ticket or refund receipt is known by its chain's first job's link row. */
async function centredCopy(
  tx: Transaction,
  job: { id: string; resendOf: string | null; payload: Uint8Array },
  printerId: string,
  printerDots: number,
): Promise<Uint8Array> {
  const head = job.resendOf ?? job.id;
  const [kitchen] = await tx
    .select({ id: kitchenPrintJobs.id })
    .from(kitchenPrintJobs)
    .where(eq(kitchenPrintJobs.printJobId, head))
    .limit(1);
  const linked =
    kitchen ??
    (
      await tx
        .select({ id: receiptReprints.id })
        .from(receiptReprints)
        .where(eq(receiptReprints.printJobId, head))
    )[0];
  const width = linked === undefined ? null : jobWidthDots(job.payload);
  if (width === null) throw new AppError("print_job.own_printer_only", { id: job.id });
  if (width > printerDots)
    throw new AppError("print_job.printer_unsuitable", { id: job.id, printerId });
  return centredForPrinter(job.payload, printerDots);
}
