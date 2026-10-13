import { and, asc, eq, inArray, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import {
  invoiceDeliveries,
  pagePrinters,
  type A4FailureCode,
  type A4HoldCode,
  type Transaction,
} from "@waitron/db";
import {
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  reportInvoiceDelivery,
  tokenHash,
  type InvoiceDeliveryClaim,
} from "./invoice-delivery.js";

export type A4DeliveryOutcome =
  { status: "sent" } | { status: "failed" | "unknown"; failureCode: A4FailureCode };

export type PagePrintJob = {
  claim: InvoiceDeliveryClaim;
  saleId: string;
  designation: "original" | "duplicate";
  printer: {
    id: string;
    host: string;
    port: number;
    resourcePath: string;
    documentFormat: (typeof pagePrinters.$inferSelect)["documentFormat"];
    media: (typeof pagePrinters.$inferSelect)["media"];
    resolutionDpi: number;
  };
};

/**
 * Claims the oldest due A4 delivery whose printer is active, in the server's location and records
 * this agent, skipping a printer with an A4 delivery out (returned as `busyPrinterIds`) or listed in
 * `exceptPrinterIds`. A due delivery whose printer is disabled is failed instead of handed out.
 */
export async function claimInvoicePagePrint(
  tx: Transaction,
  agentId: string,
  ctx: { locationId: string; exceptPrinterIds?: readonly string[] },
  now = new Date(),
): Promise<{ job: PagePrintJob | undefined; busyPrinterIds: string[] }> {
  // After the expiry, so a lapsed claim frees its printer on this same call.
  await expireInvoiceDeliveryClaims(tx, now);
  const busyPrinterIds = (
    await tx
      .selectDistinct({ id: pagePrinters.id })
      .from(invoiceDeliveries)
      .innerJoin(pagePrinters, eq(pagePrinters.id, invoiceDeliveries.pagePrinterId))
      .where(
        and(
          eq(invoiceDeliveries.medium, "a4"),
          eq(invoiceDeliveries.status, "sending"),
          eq(pagePrinters.locationId, ctx.locationId),
        ),
      )
  ).map(({ id }) => id);
  const skipped = [...busyPrinterIds, ...(ctx.exceptPrinterIds ?? [])];
  const due = and(
    eq(invoiceDeliveries.status, "queued"),
    lte(invoiceDeliveries.nextAttemptAt, now.toISOString()),
  );
  await tx
    .update(invoiceDeliveries)
    .set({ status: "failed", failureCode: "printer_disabled" })
    .where(
      and(
        due,
        inArray(
          invoiceDeliveries.pagePrinterId,
          tx
            .select({ id: pagePrinters.id })
            .from(pagePrinters)
            .where(
              and(eq(pagePrinters.locationId, ctx.locationId), eq(pagePrinters.active, false)),
            ),
        ),
      ),
    );
  const [next] = await tx
    .select({ delivery: invoiceDeliveries, printer: pagePrinters })
    .from(invoiceDeliveries)
    .innerJoin(pagePrinters, eq(pagePrinters.id, invoiceDeliveries.pagePrinterId))
    .where(
      and(
        due,
        eq(pagePrinters.locationId, ctx.locationId),
        eq(pagePrinters.agentId, agentId),
        eq(pagePrinters.active, true),
        skipped.length === 0 ? undefined : notInArray(pagePrinters.id, skipped),
      ),
    )
    .orderBy(asc(invoiceDeliveries.createdAt), sql`${invoiceDeliveries}.rowid`)
    .limit(1);
  if (next === undefined) return { job: undefined, busyPrinterIds };
  const claim = await claimInvoiceDelivery(tx, next.delivery.id, agentId, now);
  const { printer } = next;
  return {
    job: {
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
  const renewed = await tx
    .update(invoiceDeliveries)
    .set({ claimedAt: now.toISOString(), printerHold: hold })
    .where(
      and(
        eq(invoiceDeliveries.id, claim.deliveryId),
        eq(invoiceDeliveries.medium, "a4"),
        eq(invoiceDeliveries.status, "sending"),
        eq(invoiceDeliveries.generation, claim.generation),
        eq(invoiceDeliveries.claimTokenHash, tokenHash(claim.token)),
        eq(invoiceDeliveries.claimedBy, claim.holder),
      ),
    )
    .returning({ id: invoiceDeliveries.id });
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
    .where(
      and(
        eq(invoiceDeliveries.id, claim.deliveryId),
        eq(invoiceDeliveries.generation, claim.generation),
        eq(invoiceDeliveries.claimTokenHash, tokenHash(claim.token)),
        eq(invoiceDeliveries.claimedBy, claim.holder),
        isNotNull(invoiceDeliveries.reportedAt),
      ),
    );
  return { updated: false, historical: false, repeated: reported !== undefined };
}
