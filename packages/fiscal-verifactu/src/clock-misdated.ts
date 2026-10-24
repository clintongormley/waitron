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

/** What a closing found: the wrongly dated records, or that the box cannot tell which they are. */
export type MisdatedAnswer = { known: true; records: MisdatedRecord[] } | { known: false };

const CANNOT_TELL: MisdatedAnswer = { known: false };

function storedClosing(proof: unknown): { start: number; unconfirmed: boolean } | null {
  const closing = (proof as { closing?: unknown } | null)?.closing as
    { correctedStart?: unknown; unconfirmed?: unknown } | null | undefined;
  if (typeof closing?.unconfirmed !== "boolean" || typeof closing.correctedStart !== "string")
    return null;
  const start = Date.parse(closing.correctedStart);
  return Number.isNaN(start) ? null : { start, unconfirmed: closing.unconfirmed };
}

/** The records a closing finds wrongly dated: written before its check opened (within the check's
 * `detail.heads`) and stamped more than a minute after the stop's stored corrected start, ordered
 * by time. Reads only stored values, so the list never moves once written. The stored
 * `proof.closing.unconfirmed` flag, not the source, decides that the box cannot tell; so does a
 * closing whose check, start, flag or heads cannot be read, because an empty list there would read
 * as "nothing dated wrongly". Null when no confirmation has the id. */
export async function misdatedRecords(
  tx: Transaction,
  confirmationId: string,
): Promise<MisdatedAnswer | null> {
  const [row] = await tx
    .select({ proof: clockConfirmations.proof, detail: clockChecks.detail })
    .from(clockConfirmations)
    .leftJoin(clockChecks, eq(clockChecks.id, clockConfirmations.checkId))
    .where(eq(clockConfirmations.id, confirmationId));
  if (row === undefined) return null;
  const closing = storedClosing(row.proof);
  const heads = storedHeads(row.detail);
  if (closing === null || heads === null || closing.unconfirmed) return CANNOT_TELL;
  const { start } = closing;
  // `or()` of nothing would drop the bound altogether.
  if (heads.size === 0) return { known: true, records: [] };
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
  return {
    known: true,
    records: rows.map(({ at, ...record }) => ({ ...record, generatedAt: at.toISOString() })),
  };
}
