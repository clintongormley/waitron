import { and, asc, eq, lte, or } from "drizzle-orm";
import { invoiceDeliveries, withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  reportInvoiceEmailDelivery,
  type InvoiceDelivery,
  type InvoiceDeliveryOutcome,
} from "./invoice-delivery.js";
import type { InvoiceEmailSender } from "./invoice-email.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { realSleep } from "./loop.js";

type InvoiceEmailPassDeps = {
  db: Database;
  holder: string;
  now: () => Date;
  readDocument: (tx: Transaction, delivery: InvoiceDelivery) => Promise<ReceiptDocumentInput>;
  send: InvoiceEmailSender;
};

export async function runInvoiceEmailLoop(
  deps: InvoiceEmailPassDeps & {
    signal: AbortSignal;
    isPrimary: () => boolean;
    onError: (error: unknown) => void;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<void> {
  const sleep = deps.sleep ?? realSleep;
  while (!deps.signal.aborted) {
    try {
      if (deps.isPrimary()) await runInvoiceEmailPass(deps);
    } catch (error) {
      deps.onError(error);
    }
    // A stop signal does not abandon an SMTP send whose acceptance may already have happened.
    if (deps.signal.aborted) break;
    await sleep(500, deps.signal);
  }
}

export async function runInvoiceEmailPass(
  deps: InvoiceEmailPassDeps,
): Promise<{ processed: false } | { processed: true; deliveryId: string }> {
  const now = deps.now();
  const [pending] = await deps.db
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(
      or(
        and(
          eq(invoiceDeliveries.medium, "email"),
          eq(invoiceDeliveries.status, "queued"),
          lte(invoiceDeliveries.nextAttemptAt, now.toISOString()),
        ),
        and(
          eq(invoiceDeliveries.status, "sending"),
          lte(invoiceDeliveries.claimedAt, new Date(now.getTime() - 60_000).toISOString()),
        ),
      ),
    )
    .limit(1);
  if (pending === undefined) return { processed: false };
  const claimed = await withTransaction(deps.db, async (tx) => {
    const now = deps.now();
    await expireInvoiceDeliveryClaims(tx, now);
    const [delivery] = await tx
      .select()
      .from(invoiceDeliveries)
      .where(
        and(
          eq(invoiceDeliveries.medium, "email"),
          eq(invoiceDeliveries.status, "queued"),
          lte(invoiceDeliveries.nextAttemptAt, now.toISOString()),
        ),
      )
      .orderBy(asc(invoiceDeliveries.nextAttemptAt), asc(invoiceDeliveries.id))
      .limit(1);
    if (delivery === undefined) return undefined;
    const claim = await claimInvoiceDelivery(tx, delivery.id, deps.holder, now);
    return { delivery, claim: claim! };
  });
  if (claimed === undefined) return { processed: false };
  const { delivery, claim } = claimed;
  let outcome: InvoiceDeliveryOutcome;
  try {
    // Commit the claim first; the projection transaction ends before rendering or transport.
    const document = await withTransaction(deps.db, (tx) => deps.readDocument(tx, delivery));
    outcome = await deps.send({
      recipient: delivery.recipient!,
      document: {
        ...document,
        duplicate: delivery.designation === "duplicate",
      },
    });
  } catch {
    outcome = { status: "unknown", failureCode: "transport_failed" };
  }
  await withTransaction(deps.db, (tx) =>
    reportInvoiceEmailDelivery(tx, claim, outcome, deps.now()),
  );
  return { processed: true, deliveryId: delivery.id };
}
