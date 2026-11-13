import { and, desc, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { FutureDateRefusal } from "@waitron/fiscal";
import { FUTURE_DATE_REFUSAL } from "./drain.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";

/** The highest position on `nodeId`'s chain whose filing reply carries AEAT's future-date
 * refusal, with that record's issue date; null when none does. */
export async function latestFutureDateRefusal(
  tx: Transaction,
  nodeId: string,
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
        eq(envios.codigoError, String(FUTURE_DATE_REFUSAL)),
      ),
    )
    .orderBy(desc(registrosFacturacion.secuencia))
    .limit(1);
  return row === undefined ? null : { position: Number(row.position), issuedOn: row.issuedOn };
}
