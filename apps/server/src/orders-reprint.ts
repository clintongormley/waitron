import "./errors.js";
import { and, eq } from "drizzle-orm";
import { printers, receiptReprints, saleVoids, sales, type Transaction } from "@waitron/db";
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
    .select({ id: sales.id, voidId: saleVoids.id })
    .from(sales)
    .leftJoin(saleVoids, eq(saleVoids.saleId, sales.id))
    .where(eq(sales.workingOrderId, billId));
  if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId: billId });
  if (sale.voidId !== null) throw new AppError("sale.voided", { saleId: sale.id });
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
  const { jobId } = await enqueueReceiptCopy(tx, deps.till, ticket, sale.id, printer);
  await tx.insert(receiptReprints).values({ saleId: sale.id, printJobId: jobId, personId });
  return { jobId };
}
