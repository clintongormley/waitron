import { and, eq, min, max, ne } from "drizzle-orm";
import {
  invoiceDeliveries,
  printJobs,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  abandonInvoiceEmail,
  expireInvoiceDeliveryClaims,
  expireInvoiceEmail,
  INVOICE_DELIVERY_LEASE_MS,
  LONGEST_RETRY_WAIT_MS,
  settleInvoiceEmail,
  startInvoiceEmail,
  type InvoiceDelivery,
} from "./invoice-delivery.js";
import { composeInvoiceEmail, invoiceOutcome, type InvoiceEmailPrivacy } from "./invoice-email.js";
import type { MailKindOwner } from "./mail-sender.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";

async function invoicePrintDeadline(db: Transaction, now: Date) {
  const [claims] = await db
    .select({ oldest: min(printJobs.claimedAt), newest: max(printJobs.claimedAt) })
    .from(invoiceDeliveries)
    .innerJoin(printJobs, eq(printJobs.id, invoiceDeliveries.printJobId))
    .where(and(ne(invoiceDeliveries.medium, "email"), eq(invoiceDeliveries.status, "sending")));
  if (!claims?.oldest) return { now: false, nextAt: null };

  const nextAt = new Date(Date.parse(claims.oldest) + INVOICE_DELIVERY_LEASE_MS);
  return {
    now: nextAt <= now || Date.parse(claims.newest!) > now.getTime() + INVOICE_DELIVERY_LEASE_MS,
    nextAt,
  };
}

export function invoiceMail(deps: {
  db: Database;
  readDocument(tx: Transaction, delivery: InvoiceDelivery): Promise<ReceiptDocumentInput>;
  readPrivacy?(tx: Transaction, delivery: InvoiceDelivery): Promise<InvoiceEmailPrivacy>;
  render?: typeof composeInvoiceEmail;
}): MailKindOwner<InvoiceDelivery> {
  return {
    kind: "invoice",
    deliveryRule: "invoice",
    retryDelaysMs: [],
    longestWaitMs: LONGEST_RETRY_WAIT_MS,
    async claim(tx, mail) {
      if (mail.subjectId === null) return null;
      const delivery = await startInvoiceEmail(tx, mail.subjectId);
      return delivery ? { recipient: delivery.recipient!, prepared: delivery } : null;
    },
    async compose(delivery) {
      const { document, privacy } = await withTransaction(deps.db, async (tx) => {
        const document = await deps.readDocument(tx, delivery);
        return { document, privacy: await deps.readPrivacy?.(tx, delivery) };
      });
      return (deps.render ?? composeInvoiceEmail)({
        document: { ...document, duplicate: delivery.designation === "duplicate" },
        ...(privacy === undefined ? {} : { privacy }),
      });
    },
    async settle(tx, mail, outcome, now, delivery) {
      if (mail.subjectId === null) return;
      if (outcome.status === "expired") {
        await expireInvoiceEmail(tx, mail.subjectId, now);
        return;
      }
      const attempt = mail.params.attempt as number;
      if (delivery) {
        await settleInvoiceEmail(tx, delivery, attempt, invoiceOutcome(outcome), now);
      } else if (outcome.status === "unknown" && outcome.failureCode === "mail.claim_abandoned") {
        await abandonInvoiceEmail(tx, mail.subjectId, attempt, now);
      }
    },
    sweep: {
      due: invoicePrintDeadline,
      run: async (tx, now) => {
        await expireInvoiceDeliveryClaims(tx, now, false, true);
      },
    },
  };
}
