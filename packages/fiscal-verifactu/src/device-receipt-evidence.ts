import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { FiledInvoiceEvidence } from "@waitron/fiscal";
import type { SaleId } from "@waitron/shared";

export async function readDeviceReceiptEvidence(
  tx: Transaction,
  saleId: SaleId,
): Promise<FiledInvoiceEvidence | undefined> {
  const { rows } = await tx.execute<Omit<FiledInvoiceEvidence, "series">>(sql`
    select id_emisor_factura as taxpayerId, entorno as environment,
      num_serie_factura as invoiceNumber, fecha_expedicion_factura as issuedDate,
      huella as recordEvidence
    from registros_facturacion
    where sale_id = ${saleId} and tipo_registro = 'alta'
      and corrects_registro_id is null and entorno is not null
    limit 1
  `);
  const stored = rows[0];
  if (stored === undefined) return undefined;
  return {
    ...stored,
    series: stored.invoiceNumber.slice(0, stored.invoiceNumber.lastIndexOf("/")),
  };
}
