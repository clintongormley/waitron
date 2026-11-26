import { sql, type SQL } from "drizzle-orm";

/** An invoice identity's three columns, each a bound value or a column reference. */
export interface InvoiceIdentity {
  idEmisorFactura: string | SQL;
  numSerieFactura: string | SQL;
  fechaExpedicionFactura: string | SQL;
}

/**
 * `verifactu_records` as `alias`, holding every alta under `invoice`'s identity, found through the
 * sale of the identity's first alta so the read stays within one sale's records. That relies on
 * what the identity index and `appendToChain` enforce: one first alta per identity, and a fixed
 * version carries its target's sale and identity. Nothing checks a cancellation's sale.
 */
export function altasOfIdentity(alias: string, invoice: InvoiceIdentity): SQL {
  const alta = sql.raw(alias);
  const first = sql.raw(`${alias}_first`);
  return sql`verifactu_records ${first} indexed by verifactu_records_identidad_uq
    join verifactu_records ${alta} indexed by verifactu_records_sale_idx
      on ${first}.id_emisor_factura = ${invoice.idEmisorFactura}
      and ${first}.num_serie_factura = ${invoice.numSerieFactura}
      and ${first}.fecha_expedicion_factura = ${invoice.fechaExpedicionFactura}
      and ${first}.tipo_registro = 'alta'
      and ${first}.corrects_registro_id is null
      and ${alta}.sale_id = ${first}.sale_id
      and ${alta}.tipo_registro = 'alta'
      and ${alta}.id_emisor_factura = ${first}.id_emisor_factura
      and ${alta}.num_serie_factura = ${first}.num_serie_factura
      and ${alta}.fecha_expedicion_factura = ${first}.fecha_expedicion_factura`;
}

/**
 * True when an alta under the invoice's identity that no later version replaced is refused, with
 * any code or none. The filing queue sets an ordinary cancellation of such an invoice aside
 * (`drain.ts`), and `recordVoid` and `refuseCreditOf` refuse by this same test.
 */
export function currentAltaRefused(invoice: InvoiceIdentity): SQL {
  return sql`exists (
    select 1 from ${altasOfIdentity("original", invoice)}
    join verifactu_submissions original_envio on original_envio.registro_id = original.id
    where not exists (
        select 1 from verifactu_records replacement
        where replacement.corrects_registro_id = original.id
      )
      and original_envio.estado = 'rechazado'
  )`;
}
