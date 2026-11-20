import "./errors.js";
import { randomUUID } from "node:crypto";
import { and, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import {
  invoiceDeliveries,
  isReceiptPrinter,
  printers,
  printJobs,
  receiptRollColumns,
  sales,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  canResendPrintJob,
  claimPrintJobs,
  reportPrintJob,
  resendPrintJob,
  type ClaimedJob,
  type JobOutcome,
} from "@waitron/printing";
import type { InvoicePrintClaim } from "@waitron/print-agent";
import { deliversAsFullInvoice } from "./invoice-selection.js";
import type { LayOutSaleReceipt } from "./receipt-print.js";
import {
  invoicePrintDue,
  expireInvoiceDeliveryClaims,
  latestNextAttempt,
  reportInvoiceDelivery,
  reserveInvoiceDelivery,
  takeOverReceiptDelivery,
  tokenHash,
} from "./invoice-delivery.js";

export type InvoicePrintJob = ClaimedJob & { invoiceClaim?: InvoicePrintClaim };

export function assertPrintPayload(
  job: Pick<typeof printJobs.$inferSelect, "id" | "kind" | "saleId" | "payload">,
): void {
  if (job.kind === "document" && job.payload?.byteLength === 0) {
    throw new AppError(
      job.saleId === null ? "print_job.payload_expired" : "print_job.sale_payload_expired",
      { id: job.id },
    );
  }
}

/**
 * A sale's receipt, original or copy, resent on its own printer: laid out again from the sale with
 * the job's marking, so it lists every payment taken since. Anything else keeps its bytes.
 */
async function laidOutAgain(
  tx: Transaction,
  layOut: LayOutSaleReceipt,
  jobId: string,
): Promise<{ printerId: string; payload: Uint8Array } | undefined> {
  // Read now: an expired invoice claim may have ended the job since the caller read it.
  const job = (await tx.select().from(printJobs).where(eq(printJobs.id, jobId)))[0]!;
  const { saleId, receiptCopy, printerId } = job;
  if (saleId === null || receiptCopy === null || !canResendPrintJob(job)) return undefined;
  const [printer] = await tx
    .select({ ...receiptRollColumns })
    .from(printers)
    .where(and(isReceiptPrinter(), eq(printers.id, printerId)));
  return { printerId, payload: await layOut(tx, saleId, receiptCopy, printer!) };
}

/**
 * Resends a job, as {@link resendPrintJob} does, with a sale's receipt laid out again unless `to`
 * brings its bytes. A full invoice's resend takes over the delivery still waiting on the job, or
 * reserves a new one.
 */
export async function resendInvoicePrintJob(
  tx: Transaction,
  layOut: LayOutSaleReceipt,
  jobId: string,
  personId: string | null,
  now = new Date(),
  requestKey?: string,
  to?: { printerId: string; payload: Uint8Array },
): Promise<{ jobId: string }> {
  const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId));
  if (job === undefined || job.kind === "a4")
    throw new AppError("print_job.not_found", { id: jobId });
  assertPrintPayload(job);
  const resend = async () =>
    resendPrintJob(tx, jobId, to ?? (await laidOutAgain(tx, layOut, jobId)));
  const [invoice] = await tx
    .select({
      saleId: sales.id,
      counterpartyTaxId: sales.counterpartyTaxId,
      correctsSaleId: sales.correctsSaleId,
      receiptCopy: printJobs.receiptCopy,
    })
    .from(printJobs)
    .innerJoin(sales, eq(sales.id, printJobs.saleId))
    .where(eq(printJobs.id, jobId));
  const full = invoice !== undefined && deliversAsFullInvoice(invoice);
  if (invoice === undefined || (!full && invoice.receiptCopy !== false)) return resend();
  await expireInvoiceDeliveryClaims(tx, now);
  if (!full) {
    const emails = await tx
      .select({ status: invoiceDeliveries.status, designation: invoiceDeliveries.designation })
      .from(invoiceDeliveries)
      .where(
        and(eq(invoiceDeliveries.saleId, invoice.saleId), eq(invoiceDeliveries.medium, "email")),
      );
    if (
      emails.some(
        (email) =>
          email.status === "queued" ||
          email.status === "sending" ||
          (email.designation === "original" && email.status === "sent"),
      )
    )
      throw new AppError("print_job.not_resendable", { id: jobId });
    return resend();
  }
  const retry = await resend();
  if (await takeOverReceiptDelivery(tx, invoice.saleId, jobId, retry.jobId)) return retry;
  try {
    await reserveInvoiceDelivery(tx, invoice.saleId, {
      requestKey: requestKey ?? retry.jobId,
      personId,
      medium: "receipt",
      printJobId: retry.jobId,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "invoice_delivery.active" ||
        error.code === "invoice_delivery.receipt_invalid")
    ) {
      throw new AppError("print_job.not_resendable", { id: jobId });
    }
    throw error;
  }
  return retry;
}

export async function claimInvoiceReceipt(
  tx: Transaction,
  printJobId: string,
  agentId: string,
  now: Date,
): Promise<InvoicePrintClaim | undefined> {
  const claimedJob = tx
    .select({ id: printJobs.id })
    .from(printJobs)
    .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
    .where(
      and(
        eq(printJobs.id, printJobId),
        eq(printJobs.status, "printing"),
        eq(printJobs.claimedBy, agentId),
        isNull(printers.deletedAt),
        invoicePrintDue(now),
      ),
    );
  const [delivery] = await tx
    .update(invoiceDeliveries)
    .set({ status: "sending" })
    .where(
      and(
        eq(invoiceDeliveries.printJobId, printJobId),
        eq(invoiceDeliveries.medium, "receipt"),
        eq(invoiceDeliveries.status, "queued"),
        exists(claimedJob),
      ),
    )
    .returning({ id: invoiceDeliveries.id });
  if (delivery === undefined) return undefined;
  const token = randomUUID();
  await tx
    .update(printJobs)
    .set({ claimTokenHash: tokenHash(token), claimedAt: now.toISOString() })
    .where(eq(printJobs.id, printJobId));
  return { token };
}

export async function claimInvoicePrintJobs(
  tx: Transaction,
  agentId: string,
  ctx: { visibleKeys: string[]; printerId?: string },
  now = new Date(),
): Promise<InvoicePrintJob[]> {
  await expireInvoiceDeliveryClaims(tx, now);
  const jobs = await claimPrintJobs(tx, agentId, {
    ...ctx,
    invoiceReceiptsAt: now.toISOString(),
    invoiceReceiptsAheadAt: latestNextAttempt(now),
  });
  if (jobs.length === 0) return [];
  const deliveries = await tx
    .select({ printJobId: invoiceDeliveries.printJobId })
    .from(invoiceDeliveries)
    .where(
      inArray(
        invoiceDeliveries.printJobId,
        jobs.map((job) => job.id),
      ),
    );
  const out: InvoicePrintJob[] = [];
  for (const job of jobs) {
    const delivery = deliveries.find((row) => row.printJobId === job.id);
    if (delivery === undefined) {
      out.push(job);
      continue;
    }
    const claim = await claimInvoiceReceipt(tx, job.id, agentId, now);
    // The print claim and its token must commit together; a refused token rolls the batch back.
    if (claim === undefined) throw new AppError("invoice_delivery.receipt_invalid", {});
    out.push({ ...job, invoiceClaim: claim });
  }
  return out;
}

export async function reportInvoicePrintJob(
  tx: Transaction,
  input: { agentId: string; jobId: string; outcome: JobOutcome; invoiceClaim?: InvoicePrintClaim },
  now = new Date(),
): Promise<void> {
  const [delivery] = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.printJobId, input.jobId));
  if (delivery === undefined) {
    if (input.invoiceClaim === undefined) await reportPrintJob(tx, input);
    return;
  }
  if (input.invoiceClaim === undefined) return;
  await expireInvoiceDeliveryClaims(tx, now);
  await reportInvoiceDelivery(
    tx,
    { printJobId: input.jobId, token: input.invoiceClaim.token, holder: input.agentId },
    input.outcome.status === "done"
      ? { status: "sent" }
      : { status: "failed", failureCode: "transport_failed" },
    now,
  );
}

export async function endInvoicePrintDeliveries(
  tx: Transaction,
  jobIds: string[],
  now = new Date(),
): Promise<void> {
  if (jobIds.length === 0) return;
  // A handed-out payload may already have reached the printer.
  await tx
    .update(invoiceDeliveries)
    .set({
      status: sql`case when ${invoiceDeliveries.status} = 'sending' then 'unknown' else 'failed' end`,
      failureCode: "transport_failed",
      expiredAt: sql`case when ${invoiceDeliveries.status} = 'sending' then ${now.toISOString()} else ${invoiceDeliveries.expiredAt} end`,
    })
    .where(
      and(
        eq(invoiceDeliveries.medium, "receipt"),
        inArray(invoiceDeliveries.printJobId, jobIds),
        inArray(invoiceDeliveries.status, ["queued", "sending"]),
      ),
    );
}
