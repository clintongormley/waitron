import "./errors.js";
import { and, eq } from "drizzle-orm";
import { printers, receiptReprints, sales, type Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { enqueueReceiptCopy } from "./receipt-print.js";
import type { TillConfig } from "./till-config.js";
import { readSettledTicket } from "./till-sale.js";

/** A receipt copy files nothing and uses a document job, which cannot open the drawer. */
export async function reprintOrderReceipt(
  tx: Transaction,
  deps: { backend: FiscalBackend; till: TillConfig },
  billId: string,
  printerId: string,
  personId: string,
): Promise<{ jobId: string }> {
  const [sale] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, billId));
  if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId: billId });
  const [printer] = await tx
    .select({ id: printers.id, paperWidth: printers.paperWidth, resolution: printers.resolution })
    .from(printers)
    .where(
      and(
        eq(printers.id, printerId),
        eq(printers.locationId, deps.till.locationId),
        eq(printers.active, true),
      ),
    );
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });
  const ticket = await readSettledTicket(deps.backend, tx, deps.till, billId);
  const copy = await enqueueReceiptCopy(tx, deps.till, ticket, sale.id, printer);
  if (copy === undefined) throw new Error("Cannot build a receipt without the taxpayer");
  const { jobId } = copy;
  await tx.insert(receiptReprints).values({ saleId: sale.id, printJobId: jobId, personId });
  return { jobId };
}
