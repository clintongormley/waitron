import { sql, type SQL } from "drizzle-orm";

/** An invoice identity's three columns and its sale, each a bound value or a column reference. */
export interface InvoiceOfSale {
  saleId: string | SQL;
  idEmisorFactura: string | SQL;
  numSerieFactura: string | SQL;
  fechaExpedicionFactura: string | SQL;
}

/**
 * True when an alta under the invoice's identity that no later version replaced is refused, with
 * any code or none. The filing queue sets an ordinary cancellation of such an invoice aside
 * (`drain.ts`), and `recordVoid` and `refuseCreditOf` refuse by this same test.
 *
 * Every alta under one identity carries the sale of that identity's first alta: the identity
 * index admits one first alta, and `appendToChain` refuses a fixed version of another sale or
 * identity. So the sale index bounds the read, where the identity alone would scan every refusal.
 */
export function currentAltaRefused(invoice: InvoiceOfSale): SQL {
  return sql`exists (
    select 1 from verifactu_records original indexed by verifactu_records_sale_idx
    join verifactu_submissions original_envio on original_envio.registro_id = original.id
    where original.sale_id = ${invoice.saleId}
      and original.tipo_registro = 'alta'
      and original.id_emisor_factura = ${invoice.idEmisorFactura}
      and original.num_serie_factura = ${invoice.numSerieFactura}
      and original.fecha_expedicion_factura = ${invoice.fechaExpedicionFactura}
      and not exists (
        select 1 from verifactu_records replacement
        where replacement.corrects_registro_id = original.id
      )
      and original_envio.estado = 'rechazado'
  )`;
}
