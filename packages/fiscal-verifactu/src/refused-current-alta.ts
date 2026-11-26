import { sql, type SQL } from "drizzle-orm";

/** An invoice identity's three columns, each a bound value or a column reference. */
export interface InvoiceIdentity {
  idEmisorFactura: string | SQL;
  numSerieFactura: string | SQL;
  fechaExpedicionFactura: string | SQL;
}

/**
 * True when an alta under the invoice's identity that no later version replaced is refused, with
 * any code or none. The filing queue sets an ordinary cancellation of such an invoice aside
 * (`drain.ts`), and `recordVoid` refuses to write one, by this same test; `refuseCreditOf` refuses
 * a corrective of such an invoice by it too.
 */
export function currentAltaRefused(invoice: InvoiceIdentity): SQL {
  return sql`exists (
    select 1 from verifactu_records original
    join verifactu_submissions original_envio on original_envio.registro_id = original.id
    where original.tipo_registro = 'alta'
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
