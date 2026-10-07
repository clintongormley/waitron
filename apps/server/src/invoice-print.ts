import "./errors.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { invoiceDeliveries, printJobs, sales, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  claimPrintJobs,
  MAX_DELIVERY_ATTEMPTS,
  reportPrintJob,
  resendPrintJob,
  type ClaimedJob,
  type JobOutcome,
} from "@waitron/printing";
import type { InvoicePrintClaim } from "@waitron/print-agent";
import {
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  reportInvoiceDelivery,
  reserveInvoiceDelivery,
} from "./invoice-delivery.js";

export type InvoicePrintJob = ClaimedJob & { invoiceClaim?: InvoicePrintClaim };

export async function resendInvoicePrintJob(
  tx: Transaction,
  jobId: string,
  personId: string,
  now = new Date(),
): Promise<{ jobId: string }> {
  const [invoice] = await tx
    .select({ saleId: sales.id, recipient: sales.counterpartyTaxId })
    .from(printJobs)
    .innerJoin(sales, eq(sales.id, printJobs.saleId))
    .where(eq(printJobs.id, jobId));
  if (invoice === undefined || invoice.recipient === null) return resendPrintJob(tx, jobId);
  await expireInvoiceDeliveryClaims(tx, now);
  const retry = await resendPrintJob(tx, jobId);
  try {
    await reserveInvoiceDelivery(tx, invoice.saleId, {
      requestKey: retry.jobId,
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

export async function claimInvoicePrintJobs(
  tx: Transaction,
  agentId: string,
  ctx: { locationId: string; visibleKeys: string[]; printerId?: string },
  now = new Date(),
): Promise<InvoicePrintJob[]> {
  await expireInvoiceDeliveryClaims(tx, now);
  const jobs = await claimPrintJobs(tx, agentId, { ...ctx, invoiceReceiptsAt: now.toISOString() });
  if (jobs.length === 0) return [];
  const deliveries = await tx
    .select()
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
    const claim = await claimInvoiceDelivery(tx, delivery.id, agentId, now);
    // The print claim and its token must commit together; a refused token rolls the batch back.
    if (claim === undefined) throw new AppError("invoice_delivery.receipt_invalid", {});
    out.push({
      ...job,
      invoiceClaim: {
        deliveryId: claim.deliveryId,
        generation: claim.generation,
        token: claim.token,
      },
    });
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
  if (input.invoiceClaim === undefined || input.invoiceClaim.deliveryId !== delivery.id) return;
  await expireInvoiceDeliveryClaims(tx, now);
  await reportInvoiceDelivery(
    tx,
    { ...input.invoiceClaim, holder: input.agentId },
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
  // A handed-out payload may have printed even when its agent later reports an unpairing.
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

export async function endDeactivatedInvoicePrintDeliveries(
  tx: Transaction,
  printerId: string,
  now = new Date(),
): Promise<void> {
  const ended = await tx
    .update(printJobs)
    .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: "transport_failed" })
    .where(
      and(
        eq(printJobs.printerId, printerId),
        sql`exists (select 1 from ${invoiceDeliveries} where ${invoiceDeliveries.printJobId} = ${printJobs.id}
        and ${invoiceDeliveries.medium} = 'receipt' and ${invoiceDeliveries.status} in ('queued', 'sending'))`,
      ),
    )
    .returning({ id: printJobs.id });
  await endInvoicePrintDeliveries(
    tx,
    ended.map(({ id }) => id),
    now,
  );
}
