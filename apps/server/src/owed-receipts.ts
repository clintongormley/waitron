import { and, eq, inArray, lt, or } from "drizzle-orm";
import { invoiceDeliveries, printJobs, sales, unpaidDepartures } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";

/**
 * Whether the sale still owes the customer its original ticket: it is neither a corrective nor an
 * unpaid departure, no original receipt print (from any path) is done or still trying, and no
 * original email or A4 page is queued, being sent, sent or may have arrived. A print that gave up
 * and an email that failed both leave it owed.
 */
export async function owesOriginal(tx: Transaction, saleId: string): Promise<boolean> {
  const [sale] = await tx
    .select({ correctsSaleId: sales.correctsSaleId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale === undefined || sale.correctsSaleId !== null) return false;
  const [departure] = await tx
    .select({ id: unpaidDepartures.id })
    .from(unpaidDepartures)
    .where(eq(unpaidDepartures.saleId, saleId))
    .limit(1);
  if (departure !== undefined) return false;
  const [print] = await tx
    .select({ id: printJobs.id })
    .from(printJobs)
    .where(
      and(
        eq(printJobs.saleId, saleId),
        eq(printJobs.receiptCopy, false),
        eq(printJobs.kind, "document"),
        or(
          inArray(printJobs.status, ["queued", "printing", "done"]),
          and(eq(printJobs.status, "failed"), lt(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
        ),
      ),
    )
    .limit(1);
  if (print !== undefined) return false;
  const [delivered] = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.saleId, saleId),
        eq(invoiceDeliveries.designation, "original"),
        inArray(invoiceDeliveries.medium, ["email", "a4"]),
        inArray(invoiceDeliveries.status, ["queued", "sending", "sent", "unknown"]),
      ),
    )
    .limit(1);
  return delivered === undefined;
}
