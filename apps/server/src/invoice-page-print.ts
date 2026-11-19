import { and, asc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  invoiceDeliveries,
  isA4Printer,
  printers,
  printJobs,
  type A4FailureCode,
  type A4HoldCode,
  type Transaction,
} from "@waitron/db";
import {
  a4DeliveryClaim,
  claimInvoiceDelivery,
  dueA4Print,
  endA4PrintJobs,
  expireInvoiceDeliveryClaims,
  reportInvoiceDelivery,
  type InvoiceDeliveryClaim,
} from "./invoice-delivery.js";

import { pagePrinterColumns, type PagePrinter } from "./page-printers.js";

export type A4DeliveryOutcome =
  { status: "sent" } | { status: "failed" | "unknown"; failureCode: A4FailureCode };

export type PagePrintJob = {
  jobId: string;
  claim: InvoiceDeliveryClaim;
  saleId: string;
  designation: "original" | "duplicate";
  printer: {
    id: string;
    host: string;
    port: number;
    resourcePath: string;
    documentFormat: PagePrinter["documentFormat"];
    media: PagePrinter["media"];
    resolutionDpi: number;
  };
};

/**
 * Claims the oldest due A4 delivery whose printer is active and records
 * this agent, skipping a printer with an A4 delivery out (returned as `busyPrinterIds`) or listed in
 * `exceptPrinterIds`. A due delivery whose printer is disabled is failed instead of handed out.
 */
export async function claimInvoicePagePrint(
  tx: Transaction,
  agentId: string,
  ctx: { exceptPrinterIds?: readonly string[] },
  now = new Date(),
): Promise<{ job: PagePrintJob | undefined; busyPrinterIds: string[] }> {
  // After the expiry, so a lapsed claim frees its printer on this same call.
  await expireInvoiceDeliveryClaims(tx, now);
  const busyPrinterIds = (
    await tx
      .selectDistinct({ id: printers.id })
      .from(printJobs)
      .innerJoin(printers, and(isA4Printer(), eq(printers.id, printJobs.printerId)))
      .where(and(eq(printJobs.kind, "a4"), eq(printJobs.status, "printing")))
  ).map(({ id }) => id);
  const skipped = [...busyPrinterIds, ...(ctx.exceptPrinterIds ?? [])];
  const due = dueA4Print(now);
  const disabled = tx
    .select({ id: printJobs.id })
    .from(printJobs)
    .innerJoin(printers, and(isA4Printer(), eq(printers.id, printJobs.printerId)))
    .where(and(due, eq(printers.active, false)));
  const ended = await tx
    .update(invoiceDeliveries)
    .set({ status: "failed", failureCode: "printer_disabled" })
    .where(
      and(eq(invoiceDeliveries.status, "queued"), inArray(invoiceDeliveries.printJobId, disabled)),
    )
    .returning({ printJobId: invoiceDeliveries.printJobId });
  await endA4PrintJobs(tx, ended, "printer_disabled");
  const [next] = await tx
    .select({ jobId: printJobs.id, delivery: invoiceDeliveries, printer: pagePrinterColumns })
    .from(printJobs)
    .innerJoin(invoiceDeliveries, eq(invoiceDeliveries.printJobId, printJobs.id))
    .innerJoin(printers, and(isA4Printer(), eq(printers.id, printJobs.printerId)))
    .where(
      and(
        due,
        eq(invoiceDeliveries.status, "queued"),
        eq(printers.agentId, agentId),
        eq(printers.active, true),
        skipped.length === 0 ? undefined : notInArray(printers.id, skipped),
      ),
    )
    .orderBy(asc(printJobs.createdAt), sql`${printJobs}.rowid`)
    .limit(1);
  if (next === undefined) return { job: undefined, busyPrinterIds };
  const claim = await claimInvoiceDelivery(tx, next.delivery.id, agentId, now);
  const printer = next.printer as PagePrinter;
  return {
    job: {
      jobId: next.jobId,
      claim: claim!,
      saleId: next.delivery.saleId,
      designation: next.delivery.designation,
      printer: {
        id: printer.id,
        host: printer.host,
        port: printer.port,
        resourcePath: printer.resourcePath,
        documentFormat: printer.documentFormat,
        media: printer.media,
        resolutionDpi: printer.resolutionDpi,
      },
    },
    busyPrinterIds,
  };
}

/**
 * Moves the lease forward for the current holder of a claim still being sent, and records what the
 * printer is holding the job for, or `null` when it is not holding it.
 */
export async function renewInvoicePagePrint(
  tx: Transaction,
  claim: InvoiceDeliveryClaim,
  hold: A4HoldCode | null,
  now = new Date(),
): Promise<"renewed" | "lost"> {
  await expireInvoiceDeliveryClaims(tx, now);
  const activeClaim = tx
    .select({ id: invoiceDeliveries.printJobId })
    .from(invoiceDeliveries)
    .where(and(a4DeliveryClaim(claim), eq(invoiceDeliveries.status, "sending")));
  const renewed = await tx
    .update(printJobs)
    .set({ claimedAt: now.toISOString(), printerHold: hold })
    .where(and(eq(printJobs.status, "printing"), inArray(printJobs.id, activeClaim)))
    .returning({ id: printJobs.id });
  return renewed.length === 0 ? "lost" : "renewed";
}

/**
 * `repeated`: the claim matches its row, whose report is already recorded, so this one changes
 * nothing whatever it says.
 */
export async function reportInvoicePagePrint(
  tx: Transaction,
  claim: InvoiceDeliveryClaim,
  outcome: A4DeliveryOutcome,
  now = new Date(),
): Promise<{ updated: boolean; historical: boolean; repeated: boolean }> {
  const [delivery] = await tx
    .select({ medium: invoiceDeliveries.medium })
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.id, claim.deliveryId));
  if (delivery?.medium !== "a4") return { updated: false, historical: false, repeated: false };
  await expireInvoiceDeliveryClaims(tx, now);
  const result = await reportInvoiceDelivery(tx, claim, outcome, now);
  if (result.updated || result.historical) return { ...result, repeated: false };
  const [reported] = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(and(a4DeliveryClaim(claim), isNotNull(invoiceDeliveries.reportedAt)));
  return { updated: false, historical: false, repeated: reported !== undefined };
}
