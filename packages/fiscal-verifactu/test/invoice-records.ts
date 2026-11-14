import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import type { IdentityChangeView, InvoiceIdView } from "../src/filing-overview-types.js";
import { registrosFacturacion } from "../src/schema/registros.js";
import type { registroSif } from "../src/schema/sif.js";

/** English names for fiscal tables and AEAT's invoice fields, for suites outside this package. */
export const invoiceRecords = registrosFacturacion;

export function recordInvoiceNumber(row: typeof registrosFacturacion.$inferSelect): string {
  return row.numSerieFactura;
}

/** Every stored invoice number, in the order a plain select returns them. */
export function storedInvoiceNumbers(db: Database): string[] {
  return db
    .all<{ n: string }>(sql`select num_serie_factura as n from registros_facturacion`)
    .map((row) => row.n);
}

export function heldInvoice(
  number: string,
  issuedOn: string,
): NonNullable<IdentityChangeView["lastHeldInvoice"]> {
  return { numSerieFactura: number, fechaExpedicionFactura: issuedOn };
}

export function aeatInvoiceNumber(invoice: Pick<InvoiceIdView, "NumSerieFactura">): string {
  return invoice.NumSerieFactura;
}

export function registrationInstallationName(row: typeof registroSif.$inferSelect): string {
  return row.numeroInstalacion;
}
