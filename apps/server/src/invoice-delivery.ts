import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lte, isNull, gt, ne, or, sql, type SQL } from "drizzle-orm";
import {
  enqueueMail,
  invoiceDeliveries,
  MAIL_LIFETIME_MS,
  printJobs,
  isReceiptPrinter,
  printers,
  sales,
  isA4Printer,
  type A4FailureCode,
  type Transaction,
} from "@waitron/db";
import { enqueueA4PrintJob, MAX_DELIVERY_ATTEMPTS, PRINTER_DELETED } from "@waitron/printing";
import { AppError } from "@waitron/shared";
import { deliversAsFullInvoice } from "./invoice-selection.js";

export type InvoiceDelivery = typeof invoiceDeliveries.$inferSelect;
export type EmailDeliveryRequest = {
  requestKey: string;
  personId: string;
  medium: "email";
  recipient: string;
  madeByRetry?: boolean;
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
  /** A print request chose the job's printer, rather than the device's receipt role. */
  printerChosen?: boolean;
};

export async function reserveInvoiceDelivery(
  tx: Transaction,
  saleId: string,
  input: EmailDeliveryRequest | ReceiptDeliveryRequest | A4DeliveryRequest,
  options: { allowInactivePagePrinter?: boolean } = {},
): Promise<InvoiceDelivery> {
  const [sale] = await tx
    .select({ counterpartyTaxId: sales.counterpartyTaxId, correctsSaleId: sales.correctsSaleId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale === undefined) throw new AppError("invoice_delivery.not_found", {});
  if (!deliversAsFullInvoice(sale) && input.medium !== "email")
    throw new AppError("invoice_delivery.full_invoice_required", {});
  if (input.medium === "receipt") {
    const [target] = await tx
      .select({ id: printers.id, deletedAt: printers.deletedAt })
      .from(printJobs)
      .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
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
  // Issuance does not wait for a destination disabled after staging; it records the original failed.
  let disabledDestination = false;
  if (input.medium === "a4") {
    const [printer] = await tx
      .select({ active: printers.active })
      .from(printers)
      .where(
        and(
          isA4Printer(),
          eq(printers.id, input.pagePrinterId),
          options.allowInactivePagePrinter === true ? undefined : eq(printers.active, true),
        ),
      );
    if (printer === undefined) throw new AppError("invoice_delivery.printer_invalid", {});
    disabledDestination = !printer.active;
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
  const receiptJobs = await receiptOriginalJobs(tx, saleId);
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
  const designation = originalCompleted(receiptJobs, history) ? "duplicate" : "original";
  if (receiptJob !== undefined && receiptJob.receiptCopy !== (designation === "duplicate")) {
    throw new AppError("invoice_delivery.receipt_invalid", {});
  }
  const a4CreatedAt = input.medium === "a4" ? new Date().toISOString() : undefined;
  const a4Job =
    input.medium === "a4" && !disabledDestination
      ? await enqueueA4PrintJob(tx, input.pagePrinterId, saleId, a4CreatedAt!)
      : undefined;
  const [delivery] = await tx
    .insert(invoiceDeliveries)
    .values({
      saleId,
      requestKey: input.requestKey,
      personId: input.personId,
      medium: input.medium,
      designation,
      generation: (history[0]?.generation ?? 0) + 1,
      ...(disabledDestination ? { status: "failed", failureCode: "printer_disabled" } : {}),
      ...(input.medium === "email"
        ? { recipient: input.recipient, madeByRetry: input.madeByRetry }
        : input.medium === "a4"
          ? {
              printerId: input.pagePrinterId,
              printJobId: a4Job?.jobId,
              createdAt: a4CreatedAt,
            }
          : {
              printJobId: input.printJobId,
              printerChosen: input.printerChosen,
              createdAt: receiptJob?.createdAt,
            }),
    })
    .returning();
  if (delivery!.medium === "email") {
    await queueInvoiceEmail(tx, delivery!.id, new Date(delivery!.createdAt), 1);
  }
  return delivery!;
}

/** Whether the sale's original went out: a printed receipt original or a sent original delivery. */
function originalCompleted(
  receiptJobs: readonly { status: string }[],
  deliveries: readonly { designation: string; status: string }[],
): boolean {
  return (
    receiptJobs.some((job) => job.status === "done") ||
    deliveries.some((row) => row.designation === "original" && row.status === "sent")
  );
}

/**
 * Moves the receipt delivery still waiting on `fromJobId` onto its resend `toJobId`, only while its
 * original-or-duplicate marking still holds as {@link reserveInvoiceDelivery} would decide it now;
 * `false` moves nothing.
 */
export async function takeOverReceiptDelivery(
  tx: Transaction,
  saleId: string,
  fromJobId: string,
  toJobId: string,
): Promise<boolean> {
  const rows = await tx
    .select()
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.saleId, saleId));
  const moved = rows.find(
    (row) => row.printJobId === fromJobId && row.medium === "receipt" && row.status === "queued",
  );
  if (moved === undefined) return false;
  // `invoice_deliveries_active_uq` leaves it the sale's only queued or sending row.
  const others = rows.filter((row) => row.id !== moved.id);
  const completed = originalCompleted(await receiptOriginalJobs(tx, saleId), others);
  if (completed !== (moved.designation === "duplicate")) return false;
  await tx
    .update(invoiceDeliveries)
    .set({ printJobId: toJobId })
    .where(eq(invoiceDeliveries.id, moved.id));
  return true;
}

function receiptOriginalJobs(tx: Transaction, saleId: string) {
  return tx
    .select({ id: printJobs.id, status: printJobs.status, attempts: printJobs.attempts })
    .from(printJobs)
    .where(
      and(
        eq(printJobs.saleId, saleId),
        eq(printJobs.kind, "document"),
        eq(printJobs.receiptCopy, false),
      ),
    );
}

async function saleOriginalCompleted(tx: Transaction, saleId: string): Promise<boolean> {
  const receiptJobs = await receiptOriginalJobs(tx, saleId);
  const deliveries = await tx
    .select({ designation: invoiceDeliveries.designation, status: invoiceDeliveries.status })
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.saleId, saleId));
  return originalCompleted(receiptJobs, deliveries);
}

function queueInvoiceEmail(
  tx: Transaction,
  deliveryId: string,
  now: Date,
  attempt: number,
  nextAttemptAt = now,
) {
  return enqueueMail(tx, {
    kind: "invoice",
    dedupeKey: `invoice:${deliveryId}`,
    subjectId: deliveryId,
    personId: null,
    notAfter: new Date(now.getTime() + MAIL_LIFETIME_MS.invoice),
    nextAttemptAt,
    now,
    params: { attempt },
  });
}

export type InvoiceDeliveryClaim = {
  deliveryId: string;
  generation: number;
  token: string;
  holder: string;
};
type InvoiceReceiptClaim = { printJobId: string; token: string; holder: string };

export type InvoiceDeliveryOutcome =
  | { status: "sent" }
  | { status: "failed" | "unknown"; failureCode: "transport_failed" | A4FailureCode };

/** How long a claim stays current without a renewal or a report. */
export const INVOICE_DELIVERY_LEASE_MS = 60_000;

const shifted = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

/** The waits before each automatic retry of a refused email. */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];
export const LONGEST_RETRY_WAIT_MS = Math.max(...RETRY_DELAYS_MS);

/** The latest a queued delivery's next attempt can lie ahead of `now` without a backward step. */
export const latestNextAttempt = (now: Date) => shifted(now, LONGEST_RETRY_WAIT_MS);

function claimLapsed(now: Date): SQL {
  return or(
    lte(printJobs.claimedAt, shifted(now, -INVOICE_DELIVERY_LEASE_MS)),
    gt(printJobs.claimedAt, shifted(now, INVOICE_DELIVERY_LEASE_MS)),
  )!;
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A job stamped further ahead than the longest retry wait predates a backward clock step. */
export function invoicePrintDue(now: Date): SQL {
  return or(
    lte(printJobs.createdAt, now.toISOString()),
    gt(printJobs.createdAt, latestNextAttempt(now)),
  )!;
}

export function dueA4Print(now: Date): SQL {
  return and(eq(printJobs.kind, "a4"), eq(printJobs.status, "queued"), invoicePrintDue(now))!;
}

export async function endA4PrintJobs(
  tx: Transaction,
  deliveries: { printJobId: string | null }[],
  reason: "printer_disabled" | "switched",
) {
  const ids = deliveries.flatMap(({ printJobId }) => (printJobId === null ? [] : [printJobId]));
  if (ids.length === 0) return;
  await tx
    .update(printJobs)
    .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: reason })
    .where(and(eq(printJobs.kind, "a4"), inArray(printJobs.id, ids)));
}

export function a4DeliveryClaim(claim: InvoiceDeliveryClaim): SQL {
  return and(
    eq(invoiceDeliveries.medium, "a4"),
    eq(invoiceDeliveries.id, claim.deliveryId),
    eq(invoiceDeliveries.generation, claim.generation),
    sql`exists (select 1 from ${printJobs} where ${printJobs.id} = ${invoiceDeliveries.printJobId}
      and ${printJobs.kind} = 'a4' and ${printJobs.claimedBy} = ${claim.holder}
      and ${printJobs.claimTokenHash} = ${tokenHash(claim.token)})`,
  )!;
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
  if (delivery?.medium !== "a4" || delivery.status !== "queued" || delivery.printJobId === null)
    return undefined;
  const token = randomUUID();
  const [job] = await tx
    .update(printJobs)
    .set({
      status: "printing",
      attempts: sql`${printJobs.attempts} + 1`,
      claimTokenHash: tokenHash(token),
      claimedBy: holder,
      claimedAt: now.toISOString(),
    })
    .where(and(eq(printJobs.id, delivery.printJobId), dueA4Print(now)))
    .returning({ id: printJobs.id });
  if (job === undefined) return undefined;
  await tx
    .update(invoiceDeliveries)
    .set({ status: "sending" })
    .where(eq(invoiceDeliveries.id, deliveryId));
  return { deliveryId, generation: delivery.generation, token, holder };
}

function expiringClaims(now: Date, restart = false) {
  return and(
    eq(invoiceDeliveries.status, "sending"),
    ne(invoiceDeliveries.medium, "email"),
    restart
      ? undefined
      : sql`exists (select 1 from ${printJobs}
          where ${printJobs.id} = ${invoiceDeliveries.printJobId} and ${claimLapsed(now)})`,
  );
}

export async function invoiceDeliveryClaimsDue(tx: Transaction, now: Date): Promise<boolean> {
  const [row] = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(expiringClaims(now))
    .limit(1);
  return row !== undefined;
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
    .where(expiringClaims(now, restart))
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

export async function startInvoiceEmail(tx: Transaction, deliveryId: string) {
  const [delivery] = await tx
    .select()
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.id, deliveryId),
        eq(invoiceDeliveries.medium, "email"),
        inArray(invoiceDeliveries.status, ["queued", "sending"]),
      ),
    );
  if (!delivery || delivery.status === "sending") return delivery;
  const [started] = await tx
    .update(invoiceDeliveries)
    .set({ status: "sending" })
    .where(and(eq(invoiceDeliveries.id, deliveryId), eq(invoiceDeliveries.status, "queued")))
    .returning();
  return started;
}

export async function expireInvoiceEmail(tx: Transaction, deliveryId: string, now: Date) {
  await tx
    .update(invoiceDeliveries)
    .set({ status: "failed", failureCode: "transport_failed", reportedAt: now.toISOString() })
    .where(
      and(
        eq(invoiceDeliveries.id, deliveryId),
        eq(invoiceDeliveries.medium, "email"),
        inArray(invoiceDeliveries.status, ["queued", "sending"]),
      ),
    );
}

export async function abandonInvoiceEmail(tx: Transaction, deliveryId: string, now: Date) {
  await tx
    .update(invoiceDeliveries)
    .set({
      status: "unknown",
      expiredAt: now.toISOString(),
      failureCode: "timeout",
    })
    .where(
      and(
        eq(invoiceDeliveries.id, deliveryId),
        eq(invoiceDeliveries.medium, "email"),
        eq(invoiceDeliveries.status, "sending"),
      ),
    );
}

/** A print job neither ended by its printer's delete nor belonging to a deleted printer. */
function notEndedByDelete() {
  return and(
    sql`${printJobs.lastError} is not ${PRINTER_DELETED}`,
    sql`not exists (select 1 from ${printers} where ${printers.id} = ${printJobs.printerId}
      and ${isReceiptPrinter()} and ${printers.deletedAt} is not null)`,
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
  claim: InvoiceDeliveryClaim | InvoiceReceiptClaim,
  outcome: InvoiceDeliveryOutcome,
  now = new Date(),
): Promise<{ updated: boolean; historical: boolean }> {
  const hash = tokenHash(claim.token);
  const identity =
    "printJobId" in claim
      ? and(
          eq(invoiceDeliveries.medium, "receipt"),
          eq(invoiceDeliveries.printJobId, claim.printJobId),
          sql`exists (select 1 from ${printJobs} where ${printJobs.id} = ${claim.printJobId}
            and ${printJobs.claimedBy} = ${claim.holder} and ${printJobs.claimTokenHash} = ${hash})`,
        )
      : a4DeliveryClaim(claim);
  const [delivery] = await tx
    .select()
    .from(invoiceDeliveries)
    .where(
      and(
        identity,
        isNull(invoiceDeliveries.reportedAt),
        inArray(invoiceDeliveries.status, ["sending", "unknown"]),
      ),
    );
  if (delivery === undefined) return { updated: false, historical: false };
  return recordDeliveryReport(tx, delivery, outcome, now, claim.holder);
}

async function recordDeliveryReport(
  tx: Transaction,
  delivery: InvoiceDelivery,
  outcome: InvoiceDeliveryOutcome,
  now: Date,
  holder?: string,
) {
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
  // A late email success always completes its attempt: SMTP acceptance is completion for email.
  const historical =
    newer !== undefined && !(delivery.medium === "email" && outcome.status === "sent");
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
  if (newer !== undefined && !historical) {
    // Queued attempts read their designation only when they go out; one already out keeps it.
    await tx
      .update(invoiceDeliveries)
      .set({ designation: "duplicate" })
      .where(
        and(
          eq(invoiceDeliveries.saleId, delivery.saleId),
          gt(invoiceDeliveries.generation, delivery.generation),
          eq(invoiceDeliveries.status, "queued"),
          eq(invoiceDeliveries.designation, "original"),
          inArray(invoiceDeliveries.medium, ["email", "a4"]),
        ),
      );
  }
  if (!historical && delivery.printJobId !== null && holder !== undefined) {
    await tx
      .update(printJobs)
      .set(
        outcome.status === "sent"
          ? { status: "done", deliveredAt: now.toISOString(), lastError: null }
          : { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: outcome.failureCode },
      )
      .where(and(eq(printJobs.id, delivery.printJobId), eq(printJobs.claimedBy, holder)));
  }
  return { updated: !historical, historical };
}

export async function settleInvoiceEmail(
  tx: Transaction,
  claim: Pick<InvoiceDelivery, "id" | "generation">,
  attempt: number,
  outcome: InvoiceDeliveryOutcome,
  now: Date,
) {
  const [delivery] = await tx
    .select()
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.id, claim.id),
        eq(invoiceDeliveries.generation, claim.generation),
        eq(invoiceDeliveries.medium, "email"),
        isNull(invoiceDeliveries.reportedAt),
        inArray(invoiceDeliveries.status, ["sending", "unknown"]),
      ),
    );
  if (!delivery) return;
  const result = await recordDeliveryReport(tx, delivery, outcome, now);
  if (result.updated && delivery.status === "sending" && outcome.status === "failed") {
    await retryInvoiceEmail(tx, delivery, attempt, now);
  }
}

async function retryInvoiceEmail(
  tx: Transaction,
  delivery: InvoiceDelivery,
  attempt: number,
  now: Date,
) {
  const delay = RETRY_DELAYS_MS[attempt - 1];
  if (delay === undefined) return;
  const completed = await saleOriginalCompleted(tx, delivery.saleId);
  const [retry] = await tx
    .insert(invoiceDeliveries)
    .values({
      saleId: delivery.saleId,
      requestKey: randomUUID(),
      medium: "email",
      designation: completed ? "duplicate" : delivery.designation,
      generation: delivery.generation + 1,
      recipient: delivery.recipient,
      personId: delivery.personId,
      createdAt: now.toISOString(),
    })
    .returning();
  await queueInvoiceEmail(tx, retry!.id, now, attempt + 1, new Date(now.getTime() + delay));
}
