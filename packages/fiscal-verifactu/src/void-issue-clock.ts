import "./errors.js";
import { and, eq } from "drizzle-orm";
import { sales, type Transaction } from "@waitron/db";
import { prepareIssueClock, type TrustedClock } from "@waitron/fiscal";
import { AppError, type SaleId } from "@waitron/shared";
import { registrosFacturacion } from "./schema/registros.js";

export async function prepareFiscalVoidClock(
  tx: Transaction,
  saleId: SaleId,
  source: TrustedClock,
): Promise<TrustedClock> {
  const [original] = await tx
    .select({ nodeId: registrosFacturacion.nodeId })
    .from(registrosFacturacion)
    .where(
      and(eq(registrosFacturacion.saleId, saleId), eq(registrosFacturacion.tipoRegistro, "alta")),
    )
    .limit(1);
  if (original === undefined) throw new AppError("fiscal.sale_not_recorded", { saleId });
  const [sale] = await tx.select({ nodeId: sales.nodeId }).from(sales).where(eq(sales.id, saleId));
  if (sale === undefined || sale.nodeId !== original.nodeId)
    throw new AppError("venue.time_zone_target_invalid", { reason: "mismatch" });
  return prepareIssueClock(tx, { nodeId: original.nodeId }, source);
}
