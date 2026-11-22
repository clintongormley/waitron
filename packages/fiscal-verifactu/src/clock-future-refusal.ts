import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { FutureDateRefusal } from "@waitron/fiscal";
import { FUTURE_DATE_REFUSAL } from "./drain.js";

/** The highest position above `abovePosition` on `nodeId`'s chain whose filing reply carries
 * AEAT's future-date refusal, with that record's issue date; null when none does. Only a
 * `rechazado` envío ever holds that code, and it never leaves `rechazado`, so the read starts from
 * the refused envíos through `verifactu_submissions_drenaje_idx` rather than from the chain. */
export async function latestFutureDateRefusal(
  tx: Transaction,
  nodeId: string,
  abovePosition: number,
): Promise<FutureDateRefusal | null> {
  const { rows } = await tx.execute<{ position: number; issued_on: string }>(sql`
    select r.secuencia as position, r.fecha_expedicion_factura as issued_on
    from verifactu_submissions e indexed by verifactu_submissions_drenaje_idx
    cross join verifactu_records r
    where e.estado = 'rechazado' and e.codigo_error = ${String(FUTURE_DATE_REFUSAL)}
      and r.id = e.registro_id and r.node_id = ${nodeId} and r.secuencia > ${abovePosition}
    order by r.secuencia desc
    limit 1
  `);
  const [row] = rows;
  return row === undefined ? null : { position: Number(row.position), issuedOn: row.issued_on };
}
