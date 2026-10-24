import { and, asc, eq, gt, lte, or } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { NodeId } from "@waitron/shared";
import { CLOCK_BEHIND_MARGIN_MS, storedHeads } from "./clock-behind.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";
import { registrosFacturacion } from "./schema/registros.js";

export interface MisdatedRecord {
  recordId: string;
  /** The invoice's series and number, as filed. */
  invoiceNumber: string;
  generatedAt: string;
  offsetMinutes: number;
}

function storedStart(proof: unknown): number | null {
  const closing = (proof as { closing?: unknown } | null)?.closing;
  const start = (closing as { correctedStart?: unknown } | null | undefined)?.correctedStart;
  if (typeof start !== "string") return null;
  const ms = Date.parse(start);
  return Number.isNaN(ms) ? null : ms;
}

/** The records a closing finds wrongly dated: written before its check opened (within the check's
 * `detail.heads`) and stamped more than a minute after the stop's stored corrected start, ordered
 * by time. Reads only stored values, so the list never moves once written. An `elapsed` closing,
 * or one whose stored start or heads cannot be read, lists nothing. */
export async function misdatedRecords(
  tx: Transaction,
  confirmationId: string,
): Promise<MisdatedRecord[]> {
  const [closing] = await tx
    .select({
      source: clockConfirmations.source,
      proof: clockConfirmations.proof,
      detail: clockChecks.detail,
    })
    .from(clockConfirmations)
    .innerJoin(clockChecks, eq(clockChecks.id, clockConfirmations.checkId))
    .where(eq(clockConfirmations.id, confirmationId));
  if (closing === undefined || closing.source === "elapsed") return [];
  const start = storedStart(closing.proof);
  const heads = storedHeads(closing.detail);
  if (start === null || heads === null) return [];
  // `or()` of nothing would drop the bound altogether.
  if (heads.size === 0) return [];
  const rows = await tx
    .select({
      recordId: registrosFacturacion.id,
      invoiceNumber: registrosFacturacion.numSerieFactura,
      at: registrosFacturacion.fechaHoraHusoGenRegistro,
      offsetMinutes: registrosFacturacion.offsetMinutos,
    })
    .from(registrosFacturacion)
    .where(
      and(
        or(
          ...[...heads].map(([node, head]) =>
            and(
              eq(registrosFacturacion.nodeId, node as NodeId),
              lte(registrosFacturacion.secuencia, head),
            ),
          ),
        ),
        gt(registrosFacturacion.fechaHoraHusoGenRegistro, new Date(start + CLOCK_BEHIND_MARGIN_MS)),
      ),
    )
    .orderBy(asc(registrosFacturacion.fechaHoraHusoGenRegistro), asc(registrosFacturacion.id));
  return rows.map(({ at, ...row }) => ({ ...row, generatedAt: at.toISOString() }));
}
