import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lte, isNull, gt, sql } from "drizzle-orm";
import {
  invoiceDeliveries,
  printJobs,
  printers,
  sales,
  nodes,
  pagePrinters,
  type InvoiceEmailConsent,
  type Transaction,
} from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_DELETED } from "@waitron/printing";
import { AppError } from "@waitron/shared";

export type InvoiceDelivery = typeof invoiceDeliveries.$inferSelect;
export type EmailDeliveryRequest = {
  requestKey: string;
  personId: string;
  medium: "email";
  recipient: string;
  consent: InvoiceEmailConsent;
};

export type A4DeliveryRequest = {
  requestKey: string;
  personId: string;
  medium: "a4";
  pagePrinterId: string;
};

export type ReceiptDeliveryRequest = {
  requestKey: string;
  personId: string | null;
  medium: "receipt";
  printJobId: string;
};

export async function reserveInvoiceDelivery(
  tx: Transaction,
  saleId: string,
  input: EmailDeliveryRequest | ReceiptDeliveryRequest | A4DeliveryRequest,
  options: { allowInactivePagePrinter?: boolean } = {},
): Promise<InvoiceDelivery> {
  const [sale] = await tx
    .select({ recipient: sales.counterpartyTaxId, nodeId: sales.nodeId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale === undefined) throw new AppError("invoice_delivery.not_found", {});
  if (sale.recipient === null) throw new AppError("invoice_delivery.full_invoice_required", {});
  if (input.medium === "receipt") {
    const [target] = await tx
      .select({ id: printers.id, deletedAt: printers.deletedAt })
      .from(printJobs)
      .innerJoin(printers, eq(printers.id, printJobs.printerId))
      .where(eq(printJobs.id, input.printJobId));
    if (target !== undefined && target.deletedAt !== null) {
      throw new AppError("printer.not_found", { id: target.id });
    }
  }
  const [replay] = await tx
    .select()
    .from(invoiceDeliveries)
    .where(
      and(eq(invoiceDeliveries.saleId, saleId), eq(invoiceDeliveries.requestKey, input.requestKey)),
    );
  if (replay !== undefined) return replay;
  if (input.medium === "a4") {
    const [printer] = await tx
      .select({ id: pagePrinters.id })
      .from(pagePrinters)
      .innerJoin(nodes, eq(nodes.locationId, pagePrinters.locationId))
      .where(
        and(
          eq(nodes.id, sale.nodeId),
          eq(pagePrinters.id, input.pagePrinterId),
          options.allowInactivePagePrinter === true ? undefined : eq(pagePrinters.active, true),
        ),
      );
    if (printer === undefined) throw new AppError("invoice_delivery.printer_invalid", {});
  }
  const [receiptJob] =
    input.medium === "receipt"
      ? await tx.select().from(printJobs).where(eq(printJobs.id, input.printJobId))
      : [];
  if (input.medium === "receipt") {
    const [linked] = await tx
      .select({ id: invoiceDeliveries.id })
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.printJobId, input.printJobId));
    if (
      receiptJob === undefined ||
      receiptJob.saleId !== saleId ||
      receiptJob.kind !== "document" ||
      receiptJob.status !== "queued" ||
      linked !== undefined
    ) {
      throw new AppError("invoice_delivery.receipt_invalid", {});
    }
  }
  const [active] = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.saleId, saleId),
        inArray(invoiceDeliveries.status, ["queued", "sending"]),
      ),
    );
  if (active !== undefined) throw new AppError("invoice_delivery.active", {});
  const receiptJobs = await tx
    .select({ id: printJobs.id, status: printJobs.status, attempts: printJobs.attempts })
    .from(printJobs)
    .where(
      and(
        eq(printJobs.saleId, saleId),
        eq(printJobs.kind, "document"),
        eq(printJobs.receiptCopy, false),
      ),
    );
  if (
    receiptJobs.some(
      (job) =>
        !(input.medium === "receipt" && job.id === input.printJobId) &&
        (job.status === "queued" ||
          job.status === "printing" ||
          (job.status === "failed" && job.attempts < MAX_DELIVERY_ATTEMPTS)),
    )
  ) {
    throw new AppError("invoice_delivery.active", {});
  }
  const history = await tx
    .select()
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.saleId, saleId))
    .orderBy(desc(invoiceDeliveries.generation));
  const designation =
    receiptJobs.some((job) => job.status === "done") ||
    history.some((row) => row.designation === "original" && row.status === "sent")
      ? "duplicate"
      : "original";
  if (receiptJob !== undefined && receiptJob.receiptCopy !== (designation === "duplicate")) {
    throw new AppError("invoice_delivery.receipt_invalid", {});
  }
  const [delivery] = await tx
    .insert(invoiceDeliveries)
    .values({
      saleId,
      requestKey: input.requestKey,
      personId: input.personId,
      medium: input.medium,
      designation,
      generation: (history[0]?.generation ?? 0) + 1,
      ...(input.medium === "email"
        ? {
            recipient: input.recipient,
            consent: {
              ...input.consent,
              recordedAt: new Date(input.consent.recordedAt).toISOString(),
            },
          }
        : input.medium === "a4"
          ? { pagePrinterId: input.pagePrinterId }
          : { printJobId: input.printJobId }),
    })
    .returning();
  return delivery!;
}

export type InvoiceDeliveryClaim = {
  deliveryId: string;
  generation: number;
  token: string;
  holder: string;
};
export type InvoiceDeliveryOutcome =
  | { status: "sent" }
  | { status: "failed" | "unknown"; failureCode: "transport_failed" | "timeout" };

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function claimInvoiceDelivery(
  tx: Transaction,
  deliveryId: string,
  holder: string,
  now = new Date(),
): Promise<InvoiceDeliveryClaim | undefined> {
  const [delivery] = await tx
    .select()
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.id, deliveryId));
  if (delivery === undefined) return undefined;
  if (delivery.medium === "receipt") {
    const [job] = await tx
      .select({ id: printJobs.id })
      .from(printJobs)
      .innerJoin(printers, eq(printers.id, printJobs.printerId))
      .where(
        and(
          eq(printJobs.id, delivery.printJobId!),
          eq(printJobs.status, "printing"),
          eq(printJobs.claimedBy, holder),
          isNull(printers.deletedAt),
        ),
      );
    if (job === undefined) return undefined;
  }
  const token = randomUUID();
  const [row] = await tx
    .update(invoiceDeliveries)
    .set({
      status: "sending",
      attempts: sql`${invoiceDeliveries.attempts} + 1`,
      claimTokenHash: tokenHash(token),
      claimedBy: holder,
      claimedAgentId: delivery.medium === "receipt" ? holder : null,
      claimedAt: now.toISOString(),
    })
    .where(
      and(
        eq(invoiceDeliveries.id, deliveryId),
        eq(invoiceDeliveries.status, "queued"),
        lte(invoiceDeliveries.nextAttemptAt, now.toISOString()),
      ),
    )
    .returning({ generation: invoiceDeliveries.generation });
  return row === undefined ? undefined : { deliveryId, generation: row.generation, token, holder };
}

export async function expireInvoiceDeliveryClaims(
  tx: Transaction,
  now = new Date(),
  restart = false,
): Promise<number> {
  const expired = await tx
    .update(invoiceDeliveries)
    .set({
      status: "unknown",
      expiredAt: now.toISOString(),
      failureCode: restart ? "restart" : "timeout",
    })
    .where(
      and(
        eq(invoiceDeliveries.status, "sending"),
        restart
          ? undefined
          : lte(invoiceDeliveries.claimedAt, new Date(now.getTime() - 60_000).toISOString()),
      ),
    )
    .returning({ id: invoiceDeliveries.id, printJobId: invoiceDeliveries.printJobId });
  const jobIds = expired.flatMap((row) => (row.printJobId === null ? [] : [row.printJobId]));
  if (jobIds.length > 0) {
    await tx
      .update(printJobs)
      .set({
        status: "failed",
        attempts: MAX_DELIVERY_ATTEMPTS,
        lastError: restart ? "restart" : "timeout",
      })
      .where(and(inArray(printJobs.id, jobIds), notEndedByDelete()));
  }
  return expired.length;
}

/** A print job neither ended by its printer's delete nor belonging to a deleted printer. */
function notEndedByDelete() {
  return and(
    sql`${printJobs.lastError} is not ${PRINTER_DELETED}`,
    sql`not exists (select 1 from ${printers} where ${printers.id} = ${printJobs.printerId}
      and ${printers.deletedAt} is not null)`,
  );
}

function reportedFacts(outcome: InvoiceDeliveryOutcome, now: Date) {
  return {
    reportedOutcome: outcome.status,
    reportedAt: now.toISOString(),
    reportedFailureCode: outcome.status === "sent" ? null : outcome.failureCode,
  };
}

export async function reportInvoiceDelivery(
  tx: Transaction,
  claim: InvoiceDeliveryClaim,
  outcome: InvoiceDeliveryOutcome,
  now = new Date(),
): Promise<{ updated: boolean; historical: boolean }> {
  const [delivery] = await tx
    .select()
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.id, claim.deliveryId),
        eq(invoiceDeliveries.generation, claim.generation),
        eq(invoiceDeliveries.claimTokenHash, tokenHash(claim.token)),
        eq(invoiceDeliveries.claimedBy, claim.holder),
        isNull(invoiceDeliveries.reportedAt),
        inArray(invoiceDeliveries.status, ["sending", "unknown"]),
      ),
    );
  if (delivery === undefined) return { updated: false, historical: false };
  const [newer] = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.saleId, delivery.saleId),
        gt(invoiceDeliveries.generation, delivery.generation),
      ),
    )
    .limit(1);
  const historical = newer !== undefined;
  if (delivery.printJobId !== null) {
    const [live] = await tx
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(and(eq(printJobs.id, delivery.printJobId), notEndedByDelete()));
    if (live === undefined) {
      // A deleted printer's receipt keeps the state its delete gave it; the report is history only.
      await tx
        .update(invoiceDeliveries)
        .set(reportedFacts(outcome, now))
        .where(eq(invoiceDeliveries.id, delivery.id));
      return { updated: false, historical };
    }
  }
  // Retain the expired token's hash for authenticated late reports; its state ends claim eligibility.
  const status = historical
    ? delivery.status
    : delivery.status === "unknown" && outcome.status !== "sent"
      ? "unknown"
      : outcome.status;
  await tx
    .update(invoiceDeliveries)
    .set({
      ...reportedFacts(outcome, now),
      ...(historical
        ? {}
        : {
            status,
            completedAt: status === "sent" ? now.toISOString() : null,
            failureCode:
              outcome.status === "sent"
                ? null
                : delivery.status === "unknown"
                  ? delivery.failureCode
                  : outcome.failureCode,
          }),
    })
    .where(eq(invoiceDeliveries.id, delivery.id));
  if (!historical && delivery.printJobId !== null) {
    await tx
      .update(printJobs)
      .set(
        outcome.status === "sent"
          ? { status: "done", deliveredAt: now.toISOString(), lastError: null }
          : { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: outcome.failureCode },
      )
      .where(and(eq(printJobs.id, delivery.printJobId), eq(printJobs.claimedBy, claim.holder)));
  }
  return { updated: !historical, historical };
}

export async function reportInvoiceEmailDelivery(
  tx: Transaction,
  claim: InvoiceDeliveryClaim,
  outcome: InvoiceDeliveryOutcome,
  now = new Date(),
): Promise<{ updated: boolean; historical: boolean }> {
  const result = await reportInvoiceDelivery(tx, claim, outcome, now);
  if (!result.updated || outcome.status !== "failed") return result;
  const [delivery] = await tx
    .select()
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.id, claim.deliveryId));
  if (delivery!.medium !== "email" || delivery!.status !== "failed" || delivery!.attempts >= 5) {
    return result;
  }
  const delays = [5_000, 30_000, 120_000, 600_000];
  // Each automatic retry keeps the completed refusal and its authenticated claim in history.
  await tx.insert(invoiceDeliveries).values({
    saleId: delivery!.saleId,
    requestKey: randomUUID(),
    medium: "email",
    designation: delivery!.designation,
    generation: delivery!.generation + 1,
    attempts: delivery!.attempts,
    recipient: delivery!.recipient,
    consent: delivery!.consent,
    personId: delivery!.personId,
    createdAt: now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + delays[delivery!.attempts - 1]!).toISOString(),
  });
  return result;
}
