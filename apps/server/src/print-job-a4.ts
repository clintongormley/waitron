import { and, eq } from "drizzle-orm";
import { invoiceDeliveries, isA4Printer, printers, printJobs, type Transaction } from "@waitron/db";
import { renderInvoiceRaster } from "./invoice-raster.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";

export const linkedPrintDelivery = () =>
  and(
    eq(invoiceDeliveries.printJobId, printJobs.id),
    eq(invoiceDeliveries.saleId, printJobs.saleId),
  );

export async function readA4QueueInvoice(tx: Transaction, id: string) {
  const [invoice] = await tx
    .select({
      saleId: invoiceDeliveries.saleId,
      designation: invoiceDeliveries.designation,
      deliveryStatus: invoiceDeliveries.status,
      jobStatus: printJobs.status,
      printerId: printJobs.printerId,
      printerActive: printers.active,
    })
    .from(printJobs)
    .innerJoin(invoiceDeliveries, linkedPrintDelivery())
    .innerJoin(printers, and(isA4Printer(), eq(printers.id, printJobs.printerId)))
    .where(
      and(
        eq(printJobs.id, id),
        eq(printJobs.kind, "a4"),
        eq(printJobs.pageDocument, "invoice"),
        eq(invoiceDeliveries.medium, "a4"),
      ),
    );
  return invoice;
}

export async function activeA4QueuePrinters(tx: Transaction) {
  return (
    await tx
      .select({ id: printers.id })
      .from(printers)
      .where(and(isA4Printer(), eq(printers.active, true)))
  ).map(({ id }) => id);
}

export async function previewA4Invoice(document: ReceiptDocumentInput) {
  const { default: sharp } = await import("sharp");
  const pages = [];
  for (const { pixels, width, height } of await renderInvoiceRaster(document, 300)) {
    const { data, info } = await sharp(pixels, { raw: { width, height, channels: 1 } })
      .resize(900)
      .greyscale()
      .png()
      .toBuffer({ resolveWithObject: true });
    pages.push({ data: data.toString("base64"), width: info.width, height: info.height });
  }
  return { kind: "a4" as const, pages };
}
