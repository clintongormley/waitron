import { and, desc, eq, gt } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { FutureDateRefusal } from "@waitron/fiscal";
import { FUTURE_DATE_REFUSAL } from "./drain.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";

/** The highest position above `abovePosition` on `nodeId`'s chain whose filing reply carries
 * AEAT's future-date refusal, with that record's issue date; null when none does. The bound keeps
 * the scan to records written since the caller's mark. */
export async function latestFutureDateRefusal(
  tx: Transaction,
  nodeId: string,
  abovePosition: number,
): Promise<FutureDateRefusal | null> {
  const [row] = await tx
    .select({
      position: registrosFacturacion.secuencia,
      issuedOn: registrosFacturacion.fechaExpedicionFactura,
    })
    .from(registrosFacturacion)
    .innerJoin(envios, eq(envios.registroId, registrosFacturacion.id))
    .where(
      and(
        eq(registrosFacturacion.nodeId, nodeId),
        gt(registrosFacturacion.secuencia, abovePosition),
        eq(envios.codigoError, String(FUTURE_DATE_REFUSAL)),
      ),
    )
    .orderBy(desc(registrosFacturacion.secuencia))
    .limit(1);
  return row === undefined ? null : { position: Number(row.position), issuedOn: row.issuedOn };
}
